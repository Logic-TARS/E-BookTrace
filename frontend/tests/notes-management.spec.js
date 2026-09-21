import { test, expect } from '@playwright/test';
import {
  INDEXED_DB_NAME,
  INDEXED_DB_VERSION,
  installNotesApiRoutes,
  makeNote,
  seedNotesIndexedDb,
} from './helpers/notes-management.mjs';

test.describe('notes management shell', () => {
  test.use({ serviceWorkers: 'block' });

  test('creation route renders notes management without draft tools', async ({ page }) => {
    await installNotesApiRoutes(page, { notes: [] });
    await page.goto('/#/creation');

    await expect(page.getByRole('heading', { name: '笔记管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '导出 Markdown' })).toBeVisible();
    await expect(page.getByRole('button', { name: '回收站', exact: true })).toBeVisible();
    await expect(page.getByText('公众号稿件')).toHaveCount(0);
    await expect(page.getByText('视频号稿件')).toHaveCount(0);
    await expect(page.getByText('导出到 Obsidian')).toHaveCount(0);
    await expect(page.locator('#draft-editor, #draft-list, #btn-generate-video, #btn-generate-article')).toHaveCount(0);
  });

  test('online notes query sends filters after debounce', async ({ page }) => {
    const state = { notes: [makeNote()], requests: [] };
    await installNotesApiRoutes(page, state);
    await page.goto('/#/creation');
    await expect.poll(() => state.requests.filter(request => request.pathname === '/api/notes').length).toBeGreaterThan(0);
    state.requests.length = 0;

    await page.getByLabel('搜索笔记').fill('思想');
    await page.getByLabel('内容类型').selectOption('reflected');
    await page.getByLabel('高亮颜色').selectOption('yellow');
    await page.getByLabel('排序').selectOption('position');

    await expect.poll(() => state.requests.filter(request => request.pathname === '/api/notes').length).toBe(1);
    const url = new URL('http://localhost' + state.requests.find(request => request.pathname === '/api/notes').search);
    expect(url.searchParams.get('q')).toBe('思想');
    expect(url.searchParams.get('note_kind')).toBe('reflected');
    expect(url.searchParams.get('color')).toBe('yellow');
    expect(url.searchParams.get('sort')).toBe('position');
    expect(url.searchParams.get('offset')).toBe('0');
  });

  test('one character search stays local and shows guidance', async ({ page }) => {
    const state = { notes: [makeNote({ highlight_text: '字本地内容' })], requests: [] };
    await installNotesApiRoutes(page, state);
    await page.goto('/#/creation');
    await expect.poll(() => state.requests.filter(request => request.pathname === '/api/notes').length).toBeGreaterThan(0);
    state.requests.length = 0;
    await seedNotesIndexedDb(page, { highlights: [makeNote({ highlight_text: '字本地内容' })] });
    await page.reload();
    await expect.poll(() => state.requests.filter(request => request.pathname === '/api/notes').length).toBeGreaterThan(0);
    state.requests.length = 0;
    await page.getByLabel('搜索笔记').fill('字');
    await page.waitForTimeout(400);
    expect(state.requests.filter(request => request.pathname === '/api/notes')).toHaveLength(0);
    await expect(page.getByText('至少输入 2 个字符')).toBeVisible();
    await expect(page.getByText('字本地内容')).toBeVisible();
  });

  test('facets populate filter controls and selection clears on filter change', async ({ page }) => {
    const state = {
      notes: [makeNote()],
      facets: { books: [{ id: 'book-1', title: '测试书' }], tags: ['阅读'], note_kinds: ['reflected'], colors: ['yellow'] },
      requests: [],
    };
    await installNotesApiRoutes(page, state);
    await page.goto('/#/creation');
    await expect(page.locator('#notes-book-filter option[value="book-1"]')).toHaveCount(1);
    await expect(page.locator('#notes-tag-filter option[value="阅读"]')).toHaveCount(1);
    await expect(page.locator('#notes-color-filter option[value="yellow"]')).toHaveCount(1);
    await page.locator('#notes-select-page').check();
    await page.getByLabel('高亮颜色').selectOption('yellow');
    await expect(page.locator('#notes-select-page')).not.toBeChecked();
  });

  test('queued aliases override server identity without adding cached unrelated notes', async ({ page }) => {
    const local = makeNote({ id: 'local-id', client_id: 'client-id', server_id: null, highlight_text: '本地覆盖', synced: false });
    await page.goto('/#/creation');
    await seedNotesIndexedDb(page, { highlights: [local], operations: [{
      id: 'highlight.upsert:book-1:local-id', op_id: 'op-1', book_id: 'book-1',
      type: 'highlight.upsert', entity_id: 'local-id', payload: local,
    }] });
    const state = { notes: [makeNote({ id: 'server-id', server_id: 'server-id', client_id: 'client-id', highlight_text: '服务器旧值' })], requests: [] };
    await installNotesApiRoutes(page, state);
    await page.reload();
    await expect(page.getByText('本地覆盖')).toBeVisible();
    await expect(page.getByText('服务器旧值')).toHaveCount(0);
  });

  test('initial API failure falls back to IndexedDB with incomplete warning', async ({ page }) => {
    await page.goto('/#/creation');
    await seedNotesIndexedDb(page, { highlights: [makeNote({ synced: false })] });
    await page.route('**/api/notes**', route => route.abort('failed'));
    await page.reload();

    await expect(page.getByText('测试划线')).toBeVisible();
    await expect(page.getByText('离线数据，可能不完整')).toBeVisible();
  });

  test('pending view uses local queue instead of filtering server page', async ({ page }) => {
    const pending = makeNote({ id: 'local-note', server_id: null, synced: false });
    await page.goto('/#/creation');
    await seedNotesIndexedDb(page, {
      highlights: [pending],
      operations: [{
        id: 'highlight.upsert:book-1:local-note',
        op_id: 'pending-op',
        book_id: 'book-1',
        type: 'highlight.upsert',
        entity_id: 'local-note',
        payload: pending,
      }],
    });
    await installNotesApiRoutes(page, { notes: [makeNote()] });
    await page.reload();
    await page.getByLabel('数据范围').selectOption('pending');

    await expect(page.getByText('测试划线')).toBeVisible();
    await expect(page.locator('#notes-management-list').getByText('待同步')).toBeVisible();
  });

  test('notes management returns to library and browser history restores route', async ({ page }) => {
    await installNotesApiRoutes(page, { notes: [] });
    await page.goto('/#/');
    await page.locator('#btn-library-create').click();
    await expect(page).toHaveURL(/#\/creation$/);
    await page.getByRole('button', { name: '返回主界面' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await page.goBack();
    await expect(page).toHaveURL(/#\/creation$/);
    await expect(page.locator('#creation-view')).toHaveClass(/active/);
  });

  test('one history navigation leaves reader once', async ({ page }) => {
    await page.addInitScript(() => {
      window.__progressQueuePuts = 0;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (this.name === 'sync_queue' && value?.type === 'progress.set') {
          window.__progressQueuePuts += 1;
        }
        return put.call(this, value, ...args);
      };
    });
    await installNotesApiRoutes(page, { notes: [] });
    await page.goto('/#/');
    await page.evaluate(async databaseVersion => {
      const fileBlob = await fetch('/tests/fixtures/multichapter.epub').then(response => response.arrayBuffer());
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('marginalia', databaseVersion);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('books', 'readwrite');
          transaction.objectStore('books').put({
            id: 'server-reader-book',
            server_book_id: 'server-reader-book',
            source: 'server',
            _source: 'server',
            book_title: 'History Reader',
            book_author: 'Test Author',
            filename: 'history-reader.epub',
            file_blob: fileBlob,
            progress_percent: 0,
            last_opened: Date.now(),
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    }, INDEXED_DB_VERSION);
    await page.reload();
    await page.getByText('History Reader').click();
    await expect(page.locator('#toolbar-book-title')).toHaveText('History Reader', { timeout: 15_000 });
    await expect(page).toHaveURL(/#\/reader$/);

    await page.evaluate(() => { window.__progressQueuePuts = 0; });
    await page.goBack();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('#library-view')).toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => window.__progressQueuePuts)).toBe(1);
  });

  test('route queue recovers after a failed reader lifecycle', async ({ page }) => {
    await page.addInitScript(() => {
      window.__failNextBookPut = false;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (this.name === 'books' && window.__failNextBookPut) {
          window.__failNextBookPut = false;
          throw new DOMException('forced route lifecycle failure', 'UnknownError');
        }
        return put.call(this, value, ...args);
      };
    });
    await installNotesApiRoutes(page, { notes: [] });
    await page.goto('/#/');
    await page.evaluate(async databaseVersion => {
      const fileBlob = await fetch('/tests/fixtures/multichapter.epub').then(response => response.arrayBuffer());
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('marginalia', databaseVersion);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('books', 'readwrite');
          transaction.objectStore('books').put({
            id: 'failing-reader-book',
            book_title: 'Failing Reader',
            book_author: 'Test Author',
            file_blob: fileBlob,
            progress_percent: 0,
            last_opened: Date.now(),
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    }, INDEXED_DB_VERSION);
    await page.reload();
    await page.getByText('Failing Reader', { exact: true }).click();
    await expect(page.locator('#toolbar-book-title')).toHaveText('Failing Reader', { timeout: 15_000 });
    await expect(page).toHaveURL(/#\/reader$/);

    await page.evaluate(() => { window.__failNextBookPut = true; });
    await page.locator('#btn-nav-create').click();
    await expect(page.locator('#toast')).toContainText('页面切换失败');
    await expect(page).toHaveURL(/#\/reader$/);
    await expect(page.locator('#reader-view')).toHaveClass(/active/);

    await page.locator('#btn-nav-create').click();
    await expect(page).toHaveURL(/#\/creation$/);
    await expect(page.locator('#creation-view')).toHaveClass(/active/);
    await expect(page.locator('#reader-view')).not.toHaveClass(/active/);
  });

  test('duplicate history notifications do not replay a failed route target', async ({ page }) => {
    await page.addInitScript(() => {
      window.__failNextBookPut = false;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (this.name === 'books' && window.__failNextBookPut) {
          window.__failNextBookPut = false;
          throw new DOMException('forced duplicate history failure', 'UnknownError');
        }
        return put.call(this, value, ...args);
      };
    });
    await installNotesApiRoutes(page, { notes: [] });
    await page.goto('/#/');
    await page.evaluate(async databaseVersion => {
      const fileBlob = await fetch('/tests/fixtures/multichapter.epub').then(response => response.arrayBuffer());
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('marginalia', databaseVersion);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('books', 'readwrite');
          transaction.objectStore('books').put({
            id: 'duplicate-history-book',
            book_title: 'Duplicate History Reader',
            book_author: 'Test Author',
            file_blob: fileBlob,
            progress_percent: 0,
            last_opened: Date.now(),
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    }, INDEXED_DB_VERSION);
    await page.reload();
    await page.getByText('Duplicate History Reader', { exact: true }).click();
    await expect(page.locator('#toolbar-book-title')).toHaveText('Duplicate History Reader', { timeout: 15_000 });
    await expect(page).toHaveURL(/#\/reader$/);

    await page.evaluate(() => {
      window.__failNextBookPut = true;
      history.replaceState({}, '', '#/');
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await expect(page.locator('#toast')).toContainText('页面切换失败');
    await expect(page).toHaveURL(/#\/reader$/);
    await expect(page.locator('#reader-view')).toHaveClass(/active/);
    await page.waitForTimeout(100);
    await expect(page).toHaveURL(/#\/reader$/);
    await expect(page.locator('#reader-view')).toHaveClass(/active/);

    await page.locator('#btn-nav-create').click();
    await expect(page).toHaveURL(/#\/creation$/);
    await expect(page.locator('#creation-view')).toHaveClass(/active/);
  });

  test('reader route without an open book falls back to library', async ({ page }) => {
    await installNotesApiRoutes(page, { notes: [] });
    await page.goto('/#/reader');

    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('#library-view')).toHaveClass(/active/);
  });

  test('reader hint describes expandable note actions', async ({ page }) => {
    await installNotesApiRoutes(page, { notes: [] });
    await page.goto('/#/');

    await expect(page.getByText('展开后可定位原文或编辑感悟')).toHaveCount(1);
    await expect(page.getByText('单击跳回原文，双击编辑感悟')).toHaveCount(0);
  });

  test('creation route upgrades IndexedDB to v6 without deleting old stores', async ({ page }) => {
    await installNotesApiRoutes(page, { notes: [] });
    await page.goto('/manifest.json');
    await page.evaluate(databaseName => new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(databaseName);
      deleteRequest.onerror = () => reject(deleteRequest.error);
      deleteRequest.onsuccess = () => {
        const openRequest = indexedDB.open(databaseName, INDEXED_DB_VERSION);
        openRequest.onupgradeneeded = () => {
          const database = openRequest.result;
          database.createObjectStore('legacy_notes', { keyPath: 'id' }).put({ id: 'legacy-1' });
        };
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
          openRequest.result.close();
          resolve();
        };
      };
    }), INDEXED_DB_NAME);

    await page.goto('/#/creation');
    const databaseState = await page.evaluate(databaseName => new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const state = {
          version: database.version,
          stores: Array.from(database.objectStoreNames),
        };
        database.close();
        resolve(state);
      };
    }), INDEXED_DB_NAME);

    expect(databaseState.version).toBe(INDEXED_DB_VERSION);
    expect(databaseState.stores).toEqual(expect.arrayContaining([
      'legacy_notes',
      'books',
      'highlights',
      'deleted_highlights',
      'bookmarks',
      'sync_queue',
    ]));
  });
});
