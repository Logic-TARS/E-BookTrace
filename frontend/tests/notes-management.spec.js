import { test, expect } from '@playwright/test';
import {
  INDEXED_DB_NAME,
  INDEXED_DB_VERSION,
  installNotesApiRoutes,
  makeNote,
  readNotesIndexedDb,
  readSyncQueue,
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

  test('creation route upgrades IndexedDB from v5 to v6 without deleting old stores or data', async ({ page }) => {
    await installNotesApiRoutes(page, { notes: [] });
    await page.goto('/manifest.json');
    await page.evaluate(databaseName => new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(databaseName);
      deleteRequest.onerror = () => reject(deleteRequest.error);
      deleteRequest.onblocked = () => reject(new Error('database delete was blocked'));
      deleteRequest.onsuccess = () => {
        const openRequest = indexedDB.open(databaseName, 5);
        openRequest.onupgradeneeded = () => {
          const database = openRequest.result;
          const transaction = openRequest.transaction;
          database.createObjectStore('legacy_notes', { keyPath: 'id' }).put({ id: 'legacy-1', text: 'legacy' });
          database.createObjectStore('books', { keyPath: 'id' });
          database.createObjectStore('highlights', { keyPath: 'id' });
          database.createObjectStore('bookmarks', { keyPath: 'id' });
          transaction.oncomplete = () => {};
        };
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const transaction = database.transaction('legacy_notes', 'readwrite');
          transaction.objectStore('legacy_notes').put({ id: 'legacy-1', text: 'legacy' });
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
        };
      };
    }), INDEXED_DB_NAME);

    await page.goto('/#/creation');
    const databaseState = await page.evaluate(databaseName => new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('legacy_notes', 'readonly');
        const legacyRequest = transaction.objectStore('legacy_notes').get('legacy-1');
        transaction.oncomplete = () => {
          resolve({
            version: database.version,
            stores: Array.from(database.objectStoreNames),
            legacy: legacyRequest.result,
          });
          database.close();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    }), INDEXED_DB_NAME);

    expect(databaseState.version).toBe(INDEXED_DB_VERSION);
    expect(databaseState.legacy).toEqual({ id: 'legacy-1', text: 'legacy' });
    expect(databaseState.stores).toEqual(expect.arrayContaining([
      'legacy_notes', 'books', 'highlights', 'deleted_highlights', 'bookmarks', 'sync_queue',
    ]));
  });

  test('detail edits note tags and color while metadata stays read only', async ({ page }) => {
    const note = makeNote();
    await installNotesApiRoutes(page, { notes: [note] });
    await page.goto('/#/creation');
    await seedNotesIndexedDb(page, { highlights: [note] });
    await page.reload();
    await page.getByText('测试划线').click();

    await expect(page.getByLabel('划线原文')).toHaveAttribute('readonly', '');
    await page.getByRole('textbox', { name: '感悟' }).fill('新的感悟');
    await page.getByRole('textbox', { name: '标签' }).fill(' 哲学，阅读, 哲学 ');
    await page.locator('#managed-note-color').selectOption('green');
    await page.getByRole('button', { name: '保存笔记' }).click();

    const rows = await readNotesIndexedDb(page);
    expect(rows.find(item => item.id === note.id)).toMatchObject({
      note: '新的感悟', tags: ['哲学', '阅读'], color: 'green', synced: false,
    });
    const queue = await readSyncQueue(page);
    expect(queue.some(item => item.type === 'highlight.upsert')).toBe(true);
  });

  test('switching notes protects an unsaved draft', async ({ page }) => {
    const first = makeNote({ id: 'note-1', client_id: 'client-1', server_id: 'server-1', highlight_text: '第一条' });
    const second = makeNote({ id: 'note-2', client_id: 'client-2', server_id: 'server-2', highlight_text: '第二条' });
    await installNotesApiRoutes(page, { notes: [first, second] });
    await page.goto('/#/creation');
    await expect(page.getByText('第一条')).toBeVisible();
    await page.getByText('第一条').click();
    await page.getByRole('textbox', { name: '感悟' }).fill('尚未保存');
    await page.getByText('第二条').click();

    await expect(page.getByRole('dialog', { name: '未保存的修改' })).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByRole('textbox', { name: '感悟' })).toHaveValue('尚未保存');
  });

  test('canceling browser route navigation restores the current notes route', async ({ page }) => {
    const note = makeNote();
    await installNotesApiRoutes(page, { notes: [note] });
    await page.goto('/#/creation');
    await page.getByText('测试划线').click();
    await page.getByRole('textbox', { name: '感悟' }).fill('尚未保存');

    await page.evaluate(() => {
      history.pushState({}, '', '#/');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await expect(page.getByRole('dialog', { name: '未保存的修改' })).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page).toHaveURL(/#\/creation$/);
    await expect(page.locator('#creation-view')).toHaveClass(/active/);
    await expect(page.locator('#library-view')).not.toHaveClass(/active/);

    await page.locator('#btn-notes-back').click();
    await page.getByRole('button', { name: '放弃修改' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('#library-view')).toHaveClass(/active/);
  });

  test('failed reflection deletion keeps draft and does not offer undo', async ({ page }) => {
    await page.addInitScript(() => {
      window.__failHighlightPut = false;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (this.name === 'highlights' && window.__failHighlightPut) {
          window.__failHighlightPut = false;
          throw new DOMException('forced highlight write failure', 'UnknownError');
        }
        return put.call(this, value, ...args);
      };
    });
    const note = makeNote({ note: '原感悟' });
    await installNotesApiRoutes(page, { notes: [note] });
    await page.goto('/#/creation');
    await seedNotesIndexedDb(page, { highlights: [note] });
    await page.reload();
    await page.getByText('测试划线').click();
    await page.evaluate(() => { window.__failHighlightPut = true; });
    await page.getByRole('button', { name: '删除感悟' }).click();

    await expect(page.getByText('感悟删除失败')).toBeVisible();
    await expect(page.getByRole('button', { name: '撤销' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '感悟' })).toHaveValue('原感悟');
  });

  test('undoing reflection deletion keeps retry state when restore fails', async ({ page }) => {
    await page.addInitScript(() => {
      window.__failHighlightPut = false;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (this.name === 'highlights' && window.__failHighlightPut) {
          window.__failHighlightPut = false;
          throw new DOMException('forced undo write failure', 'UnknownError');
        }
        return put.call(this, value, ...args);
      };
    });
    const note = makeNote({ note: '原感悟' });
    await installNotesApiRoutes(page, { notes: [note] });
    await page.goto('/#/creation');
    await seedNotesIndexedDb(page, { highlights: [note] });
    await page.reload();
    await page.getByText('测试划线').click();
    await page.getByRole('button', { name: '删除感悟' }).click();
    await page.evaluate(() => { window.__failHighlightPut = true; });
    await page.getByRole('button', { name: '撤销' }).click();

    await expect(page.getByText('撤销失败')).toBeVisible();
    await expect(page.getByRole('button', { name: '撤销' })).toHaveCount(1);
    await expect(page.getByRole('textbox', { name: '感悟' })).toHaveValue('');

    await page.getByRole('button', { name: '撤销' }).click();
    await expect(page.getByRole('textbox', { name: '感悟' })).toHaveValue('原感悟');
  });

  test('reader back button is routed through notes draft protection', async ({ page }) => {
    await installNotesApiRoutes(page, { notes: [makeNote()] });
    await page.goto('/#/creation');
    await page.getByText('测试划线').click();
    await page.getByRole('textbox', { name: '感悟' }).fill('尚未保存');
    await page.evaluate(() => {
      document.querySelector('#btn-back').click();
    });
    await expect(page.getByRole('dialog', { name: '未保存的修改' })).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page).toHaveURL(/#\/creation$/);
  });

  test('deleting reflection keeps highlight and can be undone', async ({ page }) => {
    const note = makeNote({ note: '原感悟' });
    await installNotesApiRoutes(page, { notes: [note] });
    await page.goto('/#/creation');
    await seedNotesIndexedDb(page, { highlights: [note] });
    await page.reload();
    await page.getByText('测试划线').click();
    await page.getByRole('button', { name: '删除感悟' }).click();

    await expect(page.getByText('感悟已删除')).toBeVisible();
    await page.getByRole('button', { name: '撤销' }).click();
    await expect(page.getByRole('textbox', { name: '感悟' })).toHaveValue('原感悟');
  });

  test('select all affects only the current page and batch adds tags', async ({ page }) => {
    const notes = Array.from({ length: 55 }, (_, index) => makeNote({
      id: `note-${index}`,
      client_id: `client-${index}`,
      server_id: `server-${index}`,
      highlight_text: `划线 ${index}`,
    }));
    const state = { notes, batchRequests: [] };
    await installNotesApiRoutes(page, state);
    await page.goto('/#/creation');
    await page.getByLabel('全选当前页').check();
    await expect(page.getByText('已选择 50 条')).toBeVisible();
    await page.getByRole('button', { name: '添加标签' }).click();
    await page.getByLabel('批量标签').fill('整理，重读');
    await page.getByRole('button', { name: '确认添加' }).click();

    expect(state.batchRequests[0].ids).toHaveLength(50);
    expect(state.batchRequests[0].tags).toEqual(['整理', '重读']);
  });

  test('trash undo restore and permanent delete stay distinct', async ({ page }) => {
    const note = makeNote();
    const state = { notes: [note], batchRequests: [] };
    await installNotesApiRoutes(page, state);
    await page.goto('/#/creation');
    await page.getByLabel('选择 测试划线').check();
    await page.getByRole('button', { name: '移入回收站' }).click();
    await expect(page.getByText('将 1 条笔记移入回收站')).toBeVisible();
    await page.getByRole('button', { name: '确认移入' }).click();
    await page.getByRole('button', { name: '撤销' }).click();
    expect(state.batchRequests.at(-1).type).toBe('restore');

    await page.getByLabel('选择 测试划线').check();
    await page.getByRole('button', { name: '移入回收站' }).click();
    await page.getByRole('button', { name: '确认移入' }).click();
    await page.getByRole('button', { name: '回收站', exact: true }).click();
    await page.getByLabel('选择 测试划线').check();
    await page.getByRole('button', { name: '永久删除' }).click();
    await expect(page.getByText('永久删除 1 条笔记')).toBeVisible();
    await page.getByRole('button', { name: '确认永久删除' }).click();
    expect(state.batchRequests.at(-1).type).toBe('delete');
  });

  test('failed batch refreshes server state and preserves selection for retry', async ({ page }) => {
    const note = makeNote();
    const state = { notes: [note], failBatchType: 'trash', batchRequests: [] };
    await installNotesApiRoutes(page, state);
    await page.goto('/#/creation');
    await page.getByLabel('选择 测试划线').check();
    await page.getByRole('button', { name: '移入回收站' }).click();
    await page.getByRole('button', { name: '确认移入' }).click();
    await expect(page.getByText('批量操作失败，请重试')).toBeVisible();
    await expect(page.getByText('已选择 1 条')).toBeVisible();
    expect(state.notes[0].deleted_at).toBeNull();
  });

  test('legacy offline note is not changed before book validation', async ({ page }) => {
    const legacy = makeNote({ book_id: null });
    await installNotesApiRoutes(page, { notes: [legacy] });
    await page.goto('/#/creation');
    await seedNotesIndexedDb(page, { highlights: [legacy] });
    await page.reload();
    await page.context().setOffline(true);
    await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
    await page.getByLabel('选择 测试划线').check();
    await page.getByRole('button', { name: '移入回收站' }).click();
    await page.getByRole('button', { name: '确认移入' }).click();
    await expect(page.getByText('批量操作失败，请重试')).toBeVisible();
    expect((await readNotesIndexedDb(page))[0].deleted_at).toBeNull();
  });

  test('online batch accepts a legacy note with a server identity', async ({ page }) => {
    const legacy = makeNote({ book_id: null, server_id: 'legacy-server', highlight_text: '联网历史划线' });
    const state = { notes: [legacy], batchRequests: [] };
    await installNotesApiRoutes(page, state);
    await page.goto('/#/creation');
    await page.getByLabel('选择 联网历史划线').check();
    await page.getByRole('button', { name: '添加标签' }).click();
    await page.getByLabel('批量标签').fill('联网整理');
    await page.getByRole('button', { name: '确认添加' }).click();
    expect(state.batchRequests[0].ids).toEqual(['legacy-server']);
    expect(state.batchRequests[0].tags).toEqual(['联网整理']);
  });

  test('mixed offline selection with legacy note fails atomically before local writes', async ({ page }) => {
    const normal = makeNote({ id: 'normal-note', client_id: 'normal-client', server_id: 'normal-server', highlight_text: '正常划线' });
    const legacy = makeNote({ id: 'legacy-note', client_id: 'legacy-client', server_id: 'legacy-server', book_id: null, highlight_text: '历史划线' });
    await installNotesApiRoutes(page, { notes: [normal, legacy] });
    await page.goto('/#/creation');
    await seedNotesIndexedDb(page, { highlights: [normal, legacy] });
    await page.reload();
    await expect(page.getByText('历史划线')).toBeVisible();
    await page.context().setOffline(true);
    await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
    await page.getByLabel('选择 正常划线').check();
    await page.getByLabel('选择 历史划线').check();
    await page.getByRole('button', { name: '移入回收站' }).click();
    await page.getByRole('button', { name: '确认移入' }).click();
    await expect(page.getByText('批量操作失败，请重试')).toBeVisible();
    const local = await readNotesIndexedDb(page);
    expect(local.find(note => note.id === normal.id).deleted_at).toBeNull();
    expect(local.find(note => note.id === legacy.id).deleted_at).toBeNull();
    expect(await readSyncQueue(page)).toEqual([]);
  });

  test('offline trash queues protocol v2 operations by book and undo updates local state', async ({ page }) => {
    const note = makeNote({ server_id: 'server-note-1' });
    await installNotesApiRoutes(page, { notes: [note] });
    await page.goto('/#/creation');
    await seedNotesIndexedDb(page, { highlights: [note] });
    await page.reload();
    await page.context().setOffline(true);
    await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
    await page.getByLabel('选择 测试划线').check();
    await page.getByRole('button', { name: '移入回收站' }).click();
    await page.getByRole('button', { name: '确认移入' }).click();
    await expect.poll(async () => (await readSyncQueue(page)).length).toBeGreaterThan(0);
    const queuedAfterTrash = await readSyncQueue(page);
    expect(queuedAfterTrash[0]).toMatchObject({ book_id: 'book-1', type: 'highlight.trash' });
    expect(queuedAfterTrash[0].payload.deleted_at).toEqual(expect.any(String));
    await page.getByRole('button', { name: '撤销' }).click();
    await expect.poll(async () => (await readSyncQueue(page)).some(item => item.type === 'highlight.restore')).toBe(true);
    const queuedAfterUndo = await readSyncQueue(page);
    expect(queuedAfterUndo.find(item => item.type === 'highlight.restore')).toMatchObject({ book_id: 'book-1', type: 'highlight.restore', payload: {} });
    expect((await readNotesIndexedDb(page))[0].deleted_at).toBeNull();
  });
});
