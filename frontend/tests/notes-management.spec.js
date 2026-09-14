import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { revealReaderChromeFor } from './helpers/reader-ui.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(root, 'fixtures', 'multichapter.epub');
const removedRequests = /\/api\/(knowledge|tts|drafts|agent|qa)(?:\/|$)|\/tts(?:\/|$)/;

test.describe('notes management', () => {
  test.use({ serviceWorkers: 'block' });

  test('removes retired feature code while keeping matching app-shell versions', () => {
    const app = fs.readFileSync(path.join(root, '..', 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, '..', 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, '..', 'style.css'), 'utf8');
    const worker = fs.readFileSync(path.join(root, '..', 'sw.js'), 'utf8');
    expect(app).not.toMatch(/knowledge|\btts|\baiPanel|\bdraft|selectedMaterialIds/i);
    expect(html + css).not.toMatch(/ai-panel|ai-collapsed|tts-|draft-|material-check|selected-material-count/);
    for (const resource of html.matchAll(/(?:src|href)="((?:app\.js|style\.css)\?v=\d+)"/g)) {
      expect(worker).toContain(`'${resource[1]}'`);
    }
    expect(worker).toContain("'marginalia-epub-v1'");
  });

  async function openUnsavedNotes(page, { reader = false } = {}) {
    const highlights = [1, 2].map(id => ({
      id: `unsaved-${id}`, book_id: 'unsaved-book', book_title: '保护感悟测试',
      highlight_text: `测试摘录 ${id}`, note: `已保存感悟 ${id}`, tags: ['原标签'],
      created_at: '2026-07-01T00:00:00Z', progress_percent: id, color: 'yellow',
    }));
    await page.route('**/api/**', route => route.fulfill({ json: { books: [], highlights: [], bookmarks: [] } }));
    await page.goto('/index.html');
    await expect(page).toHaveURL(/#\/$/);
    await page.evaluate(async ({ highlights, bytes }) => {
      const db = await new Promise(resolve => {
        const request = indexedDB.open('marginalia');
        request.onsuccess = () => resolve(request.result);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['highlights', 'books'], 'readwrite');
        highlights.forEach(item => tx.objectStore('highlights').put(item));
        if (bytes) tx.objectStore('books').put({
          id: 'unsaved-book', book_title: '保护感悟测试', book_author: '测试',
          file_blob: new Uint8Array(bytes).buffer, last_opened: Date.now(),
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, { highlights, bytes: reader ? [...fs.readFileSync(fixture)] : null });
    if (reader) {
      await page.reload();
      await page.click('.book-card');
      await expect(page.locator('#reader-view')).toHaveClass(/active/);
      await page.locator('#btn-reveal-notes').dispatchEvent('click');
      await page.locator('.note-item-toggle').first().click();
      await page.locator('[data-action="edit"]').first().click();
      await expect(page.locator('#note-modal')).toBeVisible();
    } else {
      await page.click('#btn-library-create');
      await page.locator('[data-highlight-id="unsaved-1"]').click();
      await expect(page.locator('#reflection-editor')).toHaveValue('已保存感悟 1');
    }
  }

  async function chooseConfirmation(page, action, accept) {
    const messages = [];
    const listener = async dialog => {
      messages.push(dialog.message());
      await (accept ? dialog.accept() : dialog.dismiss());
    };
    page.on('dialog', listener);
    await action();
    await expect.poll(() => messages.length).toBe(1);
    page.off('dialog', listener);
    expect(messages[0]).toMatch(/未保存|放弃/);
  }

  async function unloadPrevented(page) {
    return page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  }

  test('unsaved workspace keeps edits on same selection, canceled switch and filtering', async ({ page }) => {
    await openUnsavedNotes(page);
    await page.fill('#reflection-editor', '尚未保存');
    await page.locator('[data-highlight-id="unsaved-1"]').click();
    await expect(page.locator('#reflection-editor')).toHaveValue('尚未保存');
    await chooseConfirmation(page, () => page.locator('[data-highlight-id="unsaved-2"]').click(), false);
    await expect(page.locator('[data-highlight-id="unsaved-1"]')).toHaveAttribute('aria-pressed', 'true');
    await page.fill('#material-book-filter', '不存在');
    await expect(page.locator('.material-card')).toHaveCount(0);
    await expect(page.locator('#reflection-editor')).toHaveValue('尚未保存');
    await expect(page.locator('#btn-save-reflection')).toBeEnabled();
    await page.fill('#material-book-filter', '');
    await chooseConfirmation(page, () => page.locator('[data-highlight-id="unsaved-2"]').click(), true);
    await expect(page.locator('#reflection-editor')).toHaveValue('已保存感悟 2');
    expect(await unloadPrevented(page)).toBe(false);
  });

  test('unsaved workspace back cancellation preserves history and confirmed back can go forward', async ({ page }) => {
    await openUnsavedNotes(page);
    await page.fill('#reflection-editor', '离开前保留');
    await chooseConfirmation(page, () => page.click('#btn-creation-back'), false);
    await expect(page).toHaveURL(/#\/creation$/);
    await expect(page.locator('#creation-view')).toHaveClass(/active/);
    await chooseConfirmation(page, () => page.evaluate(() => history.back()), false);
    await expect(page).toHaveURL(/#\/creation$/);
    await expect(page.locator('#reflection-editor')).toHaveValue('离开前保留');
    await chooseConfirmation(page, () => page.evaluate(() => history.back()), true);
    await expect(page.locator('#library-view')).toHaveClass(/active/);
    await expect(page).toHaveURL(/#\/$/);
    await page.goForward();
    await expect(page.locator('#creation-view')).toHaveClass(/active/);
    await page.locator('[data-highlight-id="unsaved-1"]').click();
    await expect(page.locator('#reflection-editor')).toHaveValue('已保存感悟 1');
  });

  test('unsaved workspace save resets protection and deletion asks only once', async ({ page }) => {
    await openUnsavedNotes(page);
    await page.fill('#reflection-editor', '已保存新内容');
    expect(await unloadPrevented(page)).toBe(true);
    await page.click('#btn-save-reflection');
    await expect(page.locator('.material-note').first()).toHaveText('已保存新内容');
    expect(await unloadPrevented(page)).toBe(false);
    await page.fill('#reflection-editor', '删除时放弃');
    const dialogs = [];
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
    await page.click('#btn-delete-reflection');
    await expect(page.locator('#reflection-editor')).toHaveValue('');
    expect(dialogs).toHaveLength(1);
    expect(await unloadPrevented(page)).toBe(false);
    await page.click('#btn-creation-back');
    await expect(page.locator('#library-view')).toHaveClass(/active/);
    expect(dialogs).toHaveLength(1);
  });

  test('unsaved workspace blocks service-worker reload and browser reload can be canceled', async ({ page }) => {
    await openUnsavedNotes(page);
    await page.fill('#reflection-editor', '更新不能丢失');
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
    await expect(page.locator('#operation-status-detail')).toContainText('当前操作不会被打断');
    await expect(page.locator('#reflection-editor')).toHaveValue('更新不能丢失');
    const dialogPromise = page.waitForEvent('dialog');
    await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
    const dialog = await dialogPromise;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    await expect(page.locator('#reflection-editor')).toHaveValue('更新不能丢失');
  });

  for (const close of ['button', 'backdrop', 'escape']) {
    test(`unsaved reader tags protect modal ${close} close`, async ({ page }) => {
      await openUnsavedNotes(page, { reader: true });
      await page.fill('#tag-input', '修改标签');
      const action = () => close === 'button' ? page.click('#btn-close-modal')
        : close === 'escape' ? page.keyboard.press('Escape')
          : page.locator('#note-modal').click({ position: { x: 5, y: 5 } });
      await chooseConfirmation(page, action, false);
      await expect(page.locator('#note-modal')).toBeVisible();
      await expect(page.locator('#tag-input')).toHaveValue('修改标签');
      expect(await unloadPrevented(page)).toBe(true);
      await chooseConfirmation(page, action, true);
      await expect(page.locator('#note-modal')).toBeHidden();
      expect(await unloadPrevented(page)).toBe(false);
    });
  }

  test('unsaved reader browser back retains modal and tags until discard is confirmed', async ({ page }) => {
    await openUnsavedNotes(page, { reader: true });
    await page.fill('#note-textarea', '返回前保留正文');
    await page.fill('#tag-input', '返回前保留标签');
    await chooseConfirmation(page, () => page.evaluate(() => history.back()), false);
    await expect(page).toHaveURL(/#\/reader$/);
    await expect(page.locator('#note-modal')).toBeVisible();
    await expect(page.locator('#note-textarea')).toHaveValue('返回前保留正文');
    await expect(page.locator('#tag-input')).toHaveValue('返回前保留标签');
    await chooseConfirmation(page, () => page.evaluate(() => history.back()), true);
    await expect(page.locator('#library-view')).toHaveClass(/active/);
    await expect(page.locator('#note-modal')).toBeHidden();
    expect(await unloadPrevented(page)).toBe(false);
  });

  test('unsaved reader confirmed deletion closes without another discard prompt', async ({ page }) => {
    await openUnsavedNotes(page, { reader: true });
    await page.fill('#note-textarea', '删除前的未保存内容');
    const messages = [];
    page.on('dialog', async dialog => { messages.push(dialog.message()); await dialog.accept(); });
    await page.click('#btn-delete-note');
    await expect(page.locator('#note-modal')).toBeHidden();
    await expect(page.locator('#notes-count')).toHaveText('1 条');
    expect(messages).toHaveLength(1);
    expect(await unloadPrevented(page)).toBe(false);
  });

  test('unsaved reader deletion locks editing and excludes concurrent save', async ({ page }) => {
    await openUnsavedNotes(page, { reader: true });
    await page.fill('#note-textarea', '确认删除的内容');
    await page.evaluate(() => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args) {
        const request = get.apply(this, args);
        if (this.name !== 'highlights' || args[0] !== 'unsaved-1') return request;
        IDBObjectStore.prototype.get = get;
        const held = {};
        request.onsuccess = () => {
          held.result = request.result;
          window.releaseNoteDelete = () => held.onsuccess();
        };
        return held;
      };
    });
    page.on('dialog', dialog => dialog.accept());
    await page.click('#btn-delete-note');
    await expect.poll(() => page.evaluate(() => typeof window.releaseNoteDelete)).toBe('function');
    await expect(page.locator('#note-textarea')).toBeDisabled();
    await expect(page.locator('#tag-input')).toBeDisabled();
    await expect(page.locator('#btn-save-note')).toBeDisabled();
    await expect(page.locator('#btn-delete-note')).toBeDisabled();
    await page.locator('#btn-save-note').dispatchEvent('click');
    await page.evaluate(() => window.releaseNoteDelete());
    await expect(page.locator('#note-modal')).toBeHidden();
    await expect(page.locator('#notes-count')).toHaveText('1 条');
    await page.locator('.note-item-toggle').click();
    await page.locator('[data-action="edit"]').click();
    await expect(page.locator('#note-textarea')).toBeEnabled();
    await expect(page.locator('#tag-input')).toBeEnabled();
    await expect(page.locator('#btn-save-note')).toBeEnabled();
    await expect(page.locator('#btn-delete-note')).toBeEnabled();
    await expect(page.locator('#note-textarea')).toHaveValue('已保存感悟 2');
  });

  for (const failedStore of ['highlights', 'sync_queue']) {
    test(`unsaved new reader note retries after ${failedStore} failure without losing selection or duplicating records`, async ({ page }) => {
      const book = { id: 'recovery-book', title: '恢复测试', filename: 'recovery.epub', content_hash: 'recovery' };
      const state = { book_id: book.id, revision: 0, highlights: [], bookmarks: [], progress: null };
      await page.route('**/api/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/api/books/upload') return route.fulfill({ status: 202, json: { created: true, book } });
        if (pathname === '/api/books') return route.fulfill({ json: { books: [] } });
        if (pathname.endsWith('/sync')) {
          for (const op of route.request().method() === 'POST' ? route.request().postDataJSON().operations : []) {
            if (op.type === 'highlight.upsert') {
              state.highlights = state.highlights.filter(h => h.id !== op.entity_id);
              state.highlights.push({ ...op.payload, id: op.entity_id });
            }
            state.revision++;
          }
          return route.fulfill({ json: state });
        }
        return route.fulfill({ status: 404, json: {} });
      });
      await page.goto('/index.html');
      await page.setInputFiles('#file-input', fixture);
      await expect(page.locator('#operation-status-message')).toContainText('已保存到服务器');
      await page.locator('#epub-container').evaluate(host => {
        const doc = host.querySelector('iframe').contentDocument;
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode()) && node.textContent.trim().length < 40) {}
        const range = doc.createRange();
        range.setStart(node, Math.max(0, node.textContent.search(/\S/)));
        range.setEnd(node, range.startOffset + 30);
        doc.getSelection().removeAllRanges();
        doc.getSelection().addRange(range);
        doc.dispatchEvent(new Event('selectionchange'));
      });
      await page.click('#btn-add-note');
      const quote = await page.locator('#note-preview-text').textContent();
      await page.fill('#note-textarea', '失败后恢复的新笔记');
      await page.fill('#tag-input', '恢复标签');
      await page.evaluate(failedStore => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === failedStore && (failedStore !== 'sync_queue' || args[0].type === 'highlight.upsert')) {
            IDBObjectStore.prototype.put = put;
            throw new DOMException('one-time storage failure', 'QuotaExceededError');
          }
          return put.apply(this, args);
        };
      }, failedStore);
      await page.click('#btn-save-note');
      await expect(page.locator('#toast')).toContainText('保存失败');
      await expect(page.locator('#note-textarea')).toHaveValue('失败后恢复的新笔记');
      await expect(page.locator('#tag-input')).toHaveValue('恢复标签');
      expect(await unloadPrevented(page)).toBe(true);
      const storedBeforeRetry = await page.evaluate(async () => {
        const db = await new Promise(resolve => {
          const request = indexedDB.open('marginalia');
          request.onsuccess = () => resolve(request.result);
        });
        const records = await new Promise(resolve => {
          const request = db.transaction('highlights').objectStore('highlights').getAll();
          request.onsuccess = () => resolve(request.result);
        });
        db.close();
        return records;
      });
      expect(storedBeforeRetry).toHaveLength(failedStore === 'highlights' ? 0 : 1);
      await page.click('#btn-save-note');
      await expect(page.locator('#note-modal')).toBeHidden();
      await expect(page.locator('#notes-count')).toHaveText('1 条');
      await expect.poll(() => state.highlights.length).toBe(1);
      if (failedStore === 'sync_queue') expect(state.highlights[0].id).toBe(storedBeforeRetry[0].id);
      expect(state.highlights[0]).toMatchObject({ note: '失败后恢复的新笔记', tags: ['恢复标签'], highlight_text: quote });
      expect(state.highlights[0].cfi).toBeTruthy();
      expect(await unloadPrevented(page)).toBe(false);
    });
  }

  test('unsaved workspace deletion preserves typing made after confirmation', async ({ page }) => {
    await openUnsavedNotes(page);
    await page.fill('#reflection-editor', '确认放弃的内容');
    page.on('dialog', async dialog => {
      await dialog.accept();
    });
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const result = put.apply(this, args);
        if (this.name === 'highlights') {
          IDBObjectStore.prototype.put = put;
          document.querySelector('#reflection-editor').value = '删除期间新输入';
        }
        return result;
      };
    });
    await page.click('#btn-delete-reflection');
    await expect(page.locator('#toast')).toContainText('感悟已删除');
    await expect(page.locator('#reflection-editor')).toHaveValue('删除期间新输入');
    expect(await unloadPrevented(page)).toBe(true);
  });

  for (const reader of [false, true]) {
    test(`unsaved ${reader ? 'reader' : 'workspace'} save keeps later typing and cannot switch records mid-save`, async ({ page }) => {
      await openUnsavedNotes(page, { reader });
      const editor = reader ? '#note-textarea' : '#reflection-editor';
      const save = reader ? '#btn-save-note' : '#btn-save-reflection';
      await page.fill(editor, '本次保存');
      await page.evaluate(({ editor, save, reader }) => {
        document.querySelector(save).click();
        document.querySelector(editor).value = '保存期间新输入';
        document.querySelector(editor).dispatchEvent(new Event('input', { bubbles: true }));
        if (reader) document.querySelector('#btn-close-modal').click();
        else document.querySelector('[data-highlight-id="unsaved-2"]').click();
      }, { editor, save, reader });
      await expect(page.locator('#toast')).toContainText('后续修改尚未保存');
      await expect(page.locator(editor)).toHaveValue('保存期间新输入');
      expect(await unloadPrevented(page)).toBe(true);
      await page.click(save);
      await expect(page.locator('#toast')).toContainText('已保存');
      await expect.poll(() => unloadPrevented(page)).toBe(false);
      if (reader) await expect(page.locator('#note-modal')).toBeHidden();
      else {
        await page.locator('[data-highlight-id="unsaved-2"]').click();
        await expect(page.locator(editor)).toHaveValue('已保存感悟 2');
        await page.locator('[data-highlight-id="unsaved-1"]').click();
        await expect(page.locator(editor)).toHaveValue('保存期间新输入');
      }
    });

    test(`unsaved ${reader ? 'reader' : 'workspace'} failed save keeps protection and allows retry`, async ({ page }) => {
      await openUnsavedNotes(page, { reader });
      const editor = reader ? '#note-textarea' : '#reflection-editor';
      const save = reader ? '#btn-save-note' : '#btn-save-reflection';
      await page.fill(editor, '失败后仍保留');
      await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === 'highlights') {
            IDBObjectStore.prototype.put = put;
            throw new DOMException('test storage failure', 'QuotaExceededError');
          }
          return put.apply(this, args);
        };
      });
      await page.click(save);
      await expect(page.locator('#toast')).toContainText('保存失败');
      await expect(page.locator(editor)).toHaveValue('失败后仍保留');
      expect(await unloadPrevented(page)).toBe(true);
      await page.click(save);
      await expect(page.locator('#toast')).toContainText('已保存');
      await expect.poll(() => unloadPrevented(page)).toBe(false);
    });
  }

  test('imports, navigates, edits and exports book notes without retired API calls', async ({ page }) => {
    const requests = [];
    const errors = [];
    const exports = [];
    const book = {
      id: 'notes-book', title: 'Multichapter Test Fixture', author: 'Test Fixture Generator',
      filename: 'notes-book.epub', original_filename: 'multichapter.epub', content_hash: 'notes-fixture',
    };
    const state = { book_id: book.id, revision: 0, progress: null, bookmarks: [], highlights: [] };
    let uploaded = false;
    page.on('pageerror', error => errors.push(error.stack));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      requests.push(pathname);
      if (pathname === '/api/books') {
        await route.fulfill({ json: { books: uploaded ? [book] : [] } });
      } else if (pathname === '/api/books/upload') {
        uploaded = true;
        await route.fulfill({ status: 202, json: { created: true, book } });
      } else if (pathname === `/api/books/${book.id}/sync`) {
        for (const operation of request.method() === 'POST' ? request.postDataJSON().operations : []) {
          state.revision += 1;
          if (operation.type === 'progress.set') state.progress = operation.payload;
          if (operation.type === 'highlight.upsert') {
            state.highlights = state.highlights.filter(item => item.id !== operation.entity_id);
            state.highlights.push({ ...operation.payload, id: operation.entity_id });
          }
          if (operation.type === 'bookmark.upsert') {
            state.bookmarks = state.bookmarks.filter(item => item.id !== operation.entity_id);
            state.bookmarks.push({ ...operation.payload, id: operation.entity_id });
          }
        }
        await route.fulfill({ json: state });
      } else if (pathname === '/api/obsidian/export') {
        exports.push(request.postDataJSON());
        await route.fulfill({ json: { path: 'Books/fixture.md' } });
      } else {
        await route.fulfill({ status: 404, json: { detail: 'not mocked' } });
      }
    });

    await page.goto('/index.html');
    await page.setInputFiles('#file-input', fixture);
    await expect(page.locator('#toolbar-book-title')).toHaveText(book.title);
    await expect(page.locator('#operation-status-message')).toContainText('已保存到服务器');
    await expect(page.locator('#ai-panel, #tts-panel, .draft-pane')).toHaveCount(0);
    await revealReaderChromeFor(page, '#btn-reader-tools');
    await page.click('#btn-reader-tools');
    await page.click('#btn-add-bookmark');
    await expect(page.locator('#bookmarks-count')).toHaveText('1');
    await page.click('#btn-reader-tools');
    await page.locator('#epub-container').evaluate(host => {
      const doc = host.querySelector('iframe').contentDocument;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) && node.textContent.trim().length < 40) {}
      if (!node) throw new Error('Fixture has no selectable text');
      const range = doc.createRange();
      range.setStart(node, Math.max(0, node.textContent.search(/\S/)));
      range.setEnd(node, Math.min(node.textContent.length, range.startOffset + 30));
      const selection = doc.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      doc.dispatchEvent(new Event('selectionchange'));
    });
    await expect(page.locator('#selection-toolbar')).toBeVisible();
    await page.click('#btn-add-note');
    await page.fill('#note-textarea', '初始阅读感悟');
    await page.fill('#tag-input', '阅读, 回归');
    await page.click('#btn-save-note');
    await expect(page.locator('#notes-count')).toHaveText('1 条');
    await expect.poll(() => state.highlights.length).toBe(1);

    await revealReaderChromeFor(page, '#btn-back');
    await page.click('#btn-back');
    await expect(page.locator('#library-view')).toHaveClass(/active/);
    await page.click('#btn-library-create');
    await expect(page.locator('#creation-view h1')).toHaveText('笔记管理');
    await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await expect(page.locator('.material-card input')).toHaveCount(0);
    await page.fill('#material-tag-filter', '回归');
    await expect(page.locator('.material-card')).toHaveCount(1);
    await page.click('.material-card');
    await expect(page.locator('#reflection-editor')).toHaveValue('初始阅读感悟');
    await page.fill('#reflection-editor', '修改后的阅读感悟');
    await page.click('#btn-save-reflection');
    await expect(page.locator('.material-note')).toHaveText('修改后的阅读感悟');
    await page.click('#btn-export-book');
    await expect.poll(() => exports.length).toBe(1);
    expect(exports[0]).toEqual({ kind: 'book', book_title: book.title });
    expect(state.highlights[0]).toMatchObject({ note: '修改后的阅读感悟', tags: ['阅读', '回归'] });
    await expect(page.locator('#toast')).toContainText('Books/fixture.md');
    await page.fill('#material-book-filter', '不存在的笔记');
    await expect(page.locator('.material-card')).toHaveCount(0);
    await expect(page.locator('#btn-save-reflection')).toBeDisabled();
    expect(requests.filter(url => removedRequests.test(url))).toEqual([]);
    expect(errors).toEqual([]);
  });
});
