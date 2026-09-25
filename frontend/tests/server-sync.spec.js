import { test, expect } from '@playwright/test';
import fs from 'fs';
import { installNotesApiRoutes, makeNote, readSyncQueue } from './helpers/notes-management.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'multichapter.epub');

/**
 * The v2 reader keeps the sync button inside the tool panel, and the toolbar
 * only exists while the chrome is revealed. Make both reachable first.
 */
async function openReaderTools(page) {
  if (!(await page.locator('#btn-reader-tools').isVisible().catch(() => false))) {
    const reveal = page.locator('#btn-reveal-reader-chrome');
    await reveal.waitFor({ state: 'visible', timeout: 10_000 });
    await reveal.dispatchEvent('click');
  }
  if (await page.locator('#reader-tool-panel').isHidden()) {
    await page.click('#btn-reader-tools');
  }
}

test.describe('server library sync', () => {
  test.use({ serviceWorkers: 'block' });

  test('an imported server book and bookmark appear on a second device', async ({ browser }) => {
    test.setTimeout(60_000);
    const serverBook = {
      id: 'server-book-1',
      title: 'Multichapter Test Fixture',
      author: 'Test Fixture Generator',
      filename: 'server-book-1.epub',
      original_filename: 'multichapter.epub',
      content_hash: 'fixture-hash',
      knowledge_book_id: 'knowledge-1',
      knowledge_status: 'ready',
      knowledge_error: '',
    };
    const state = {
      book_id: serverBook.id,
      revision: 0,
      progress: null,
      bookmarks: [],
      highlights: [],
    };
    const seenOperations = new Set();
    let uploaded = false;

    const installRoutes = async page => {
      await page.route('**/api/**', async route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        const method = request.method();

        if (pathname === '/api/books' && method === 'GET') {
          await route.fulfill({ json: { books: uploaded ? [serverBook] : [] } });
          return;
        }
        if (pathname === '/api/books/upload' && method === 'POST') {
          uploaded = true;
          await route.fulfill({ status: 202, json: { created: true, book: serverBook } });
          return;
        }
        if (pathname === `/api/books/${serverBook.id}/file` && method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/epub+zip',
            body: fs.readFileSync(FIXTURE),
          });
          return;
        }
        if (pathname === `/api/books/${serverBook.id}/sync`) {
          if (method === 'POST') {
            const body = request.postDataJSON();
            expect(body.protocol_version).toBe(2);
            for (const operation of body.operations || []) {
              if (seenOperations.has(operation.op_id)) continue;
              seenOperations.add(operation.op_id);
              state.revision += 1;
              if (operation.type === 'progress.set') {
                state.progress = {
                  cfi: operation.payload.cfi || '',
                  progress_percent: operation.payload.progress_percent || 0,
                  last_opened: operation.payload.last_opened || 0,
                  updated_at: new Date().toISOString(),
                };
              } else if (operation.type === 'bookmark.upsert') {
                state.bookmarks = state.bookmarks.filter(item => item.id !== operation.entity_id);
                state.bookmarks.push({
                  id: operation.entity_id,
                  book_id: serverBook.id,
                  ...operation.payload,
                });
              } else if (operation.type === 'highlight.upsert') {
                state.highlights = state.highlights.filter(item => item.client_id !== operation.entity_id && item.id !== operation.entity_id);
                state.highlights.push({ id: operation.payload.server_id || operation.entity_id, ...operation.payload, deleted_at: null });
              } else if (operation.type === 'highlight.trash') {
                const item = state.highlights.find(item => item.client_id === operation.entity_id || item.id === operation.entity_id);
                if (item) item.deleted_at = operation.payload.deleted_at || new Date().toISOString();
              } else if (operation.type === 'highlight.restore') {
                const item = state.highlights.find(item => item.client_id === operation.entity_id || item.id === operation.entity_id);
                if (item) item.deleted_at = null;
              } else if (operation.type === 'highlight.delete') {
                state.highlights = state.highlights.filter(item => item.client_id !== operation.entity_id && item.id !== operation.entity_id);
              }
            }
          }
          await route.fulfill({ json: state });
          return;
        }
        if (pathname === '/api/knowledge/books/knowledge-1' && method === 'GET') {
          await route.fulfill({ json: { id: 'knowledge-1', status: 'ready' } });
          return;
        }
        if (pathname.endsWith('/conversations') && method === 'GET') {
          await route.fulfill({ json: { conversations: [], count: 0 } });
          return;
        }
        await route.fulfill({ status: 404, json: { detail: 'not mocked' } });
      });
    };

    const contextA = await browser.newContext({ serviceWorkers: 'block' });
    const pageA = await contextA.newPage();
    await installRoutes(pageA);
    await pageA.goto('/index.html');
    await pageA.setInputFiles('#file-input', FIXTURE);
    await expect(pageA.locator('#toolbar-book-title')).toContainText('Multichapter');
    await openReaderTools(pageA);
    await pageA.click('#btn-add-bookmark');
    await expect(pageA.locator('#bookmarks-count')).toHaveText('1');
    await pageA.waitForFunction(() => {
      const badge = document.querySelector('#sync-badge');
      return badge && badge.hidden;
    }, null, { timeout: 10_000 });

    const contextB = await browser.newContext({ serviceWorkers: 'block' });
    const pageB = await contextB.newPage();
    await installRoutes(pageB);
    await pageB.goto('/index.html');
    await expect(pageB.locator('.book-card')).toHaveCount(1);
    await expect(pageB.locator('.book-card-meta')).toContainText('服务器');
    await pageB.locator('.book-card-open').click();
    await expect(pageB.locator('#toolbar-book-title')).toContainText('Multichapter');
    await expect(pageB.locator('#bookmarks-count')).toHaveText('1');

    await contextA.close();
    await contextB.close();
  });

  test('offline trash is consumed by real sync after reconnect', async ({ page }) => {
    const note = makeNote({ server_id: 'server-note-1' });
    const state = { notes: [note], syncRequests: [] };
    await installNotesApiRoutes(page, state);
    await page.goto('/#/creation');
    await page.evaluate(async () => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); });
    await page.context().setOffline(true);
    await page.evaluate(async note => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('marginalia', 6); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(['books', 'highlights', 'sync_queue'], 'readwrite');
        transaction.objectStore('books').put({ id: 'book-1', server_book_id: 'book-1', source: 'server', book_title: '测试书' });
        transaction.objectStore('highlights').put(note);
        transaction.objectStore('sync_queue').put({ id: 'highlight.trash:book-1:client-note-1', op_id: 'offline-trash-op', book_id: 'book-1', type: 'highlight.trash', entity_id: note.client_id, payload: { deleted_at: '2026-09-21T00:00:00Z' } });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      db.close();
    }, note);
    await page.context().setOffline(false);
    await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }));
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => state.syncRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(state.syncRequests[0].protocol_version).toBe(2);
    expect(state.syncRequests[0].operations[0]).toMatchObject({ type: 'highlight.trash', entity_id: 'client-note-1', payload: { deleted_at: '2026-09-21T00:00:00Z' } });
    await expect.poll(async () => readSyncQueue(page)).toEqual([]);
  });

  test('trash and restore are visible through notes management UI on two devices', async ({ browser }) => {
    const note = makeNote({ server_id: 'server-ui-note' });
    const state = { notes: [note], batchRequests: [] };
    const contextA = await browser.newContext({ serviceWorkers: 'block' });
    const pageA = await contextA.newPage();
    await installNotesApiRoutes(pageA, state);
    await pageA.goto('/#/creation');
    await pageA.getByLabel('选择 测试划线').check();
    await pageA.getByRole('button', { name: '移入回收站' }).click();
    await pageA.getByRole('button', { name: '确认移入' }).click();
    const contextB = await browser.newContext({ serviceWorkers: 'block' });
    const pageB = await contextB.newPage();
    await installNotesApiRoutes(pageB, state);
    await pageB.goto('/#/creation');
    await pageB.getByRole('button', { name: '回收站', exact: true }).click();
    await expect(pageB.getByText('测试划线')).toBeVisible();
    await pageB.getByLabel('选择 测试划线').check();
    await pageB.getByRole('button', { name: '恢复' }).click();
    await expect(pageB.getByText('恢复 1 条笔记')).toBeVisible();
    await pageB.getByRole('button', { name: '确认' }).click();
    await pageA.reload();
    await expect(pageA.getByText('测试划线')).toBeVisible();
    await expect(pageA.locator('#btn-toggle-notes-trash')).toHaveAttribute('aria-pressed', 'false');
    await contextA.close();
    await contextB.close();
  });

  test('trash on device A and restore on device B propagate through protocol v2', async ({ browser }) => {
    const serverBook = { ...{ id: 'trash-book', title: 'Trash Fixture', author: 'Test', filename: 'trash.epub', original_filename: 'trash.epub', content_hash: 'trash-hash' } };
    const note = { id: 'server-note', client_id: 'client-note', book_id: serverBook.id, highlight_text: '跨设备划线', deleted_at: null };
    const state = { book_id: serverBook.id, revision: 0, progress: null, bookmarks: [], highlights: [note] };
    const seen = new Set();
    const install = async page => page.route('**/api/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.pathname === '/api/books' && request.method() === 'GET') return route.fulfill({ json: { books: [serverBook] } });
      if (url.pathname === `/api/books/${serverBook.id}/file`) return route.fulfill({ status: 200, contentType: 'application/epub+zip', body: fs.readFileSync(FIXTURE) });
      if (url.pathname === `/api/books/${serverBook.id}/sync`) {
        if (request.method() === 'POST') {
          const body = request.postDataJSON(); expect(body.protocol_version).toBe(2);
          for (const op of body.operations || []) { if (seen.has(op.op_id)) continue; seen.add(op.op_id); state.revision += 1; const item = state.highlights.find(h => h.client_id === op.entity_id || h.id === op.entity_id); if (op.type === 'highlight.trash' && item) item.deleted_at = op.payload.deleted_at; if (op.type === 'highlight.restore' && item) item.deleted_at = null; }
        }
        return route.fulfill({ json: state });
      }
      return route.fulfill({ status: 404, json: { detail: 'not mocked' } });
    });
    const contextA = await browser.newContext({ serviceWorkers: 'block' }); const pageA = await contextA.newPage(); await install(pageA); await pageA.goto('/index.html');
    await pageA.evaluate(async () => { const db = await new Promise((resolve, reject) => { const r = indexedDB.open('marginalia', 6); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); const tx = db.transaction(['books', 'highlights'], 'readwrite'); tx.objectStore('books').put({ id: 'trash-book', server_book_id: 'trash-book', source: 'server', book_title: 'Trash Fixture' }); tx.objectStore('highlights').put({ id: 'local-note', client_id: 'client-note', server_id: 'server-note', book_id: 'trash-book', highlight_text: '跨设备划线', deleted_at: null, synced: true }); await new Promise(resolve => { tx.oncomplete = resolve; }); db.close(); });
    await pageA.evaluate(() => window.dispatchEvent(new Event('online'))); await pageA.evaluate(() => window.__trashSync = true);
    await pageA.evaluate(async () => { const r = indexedDB.open('marginalia', 6); r.onsuccess = () => { const db = r.result; const tx = db.transaction('sync_queue', 'readwrite'); tx.objectStore('sync_queue').put({ id: 'trash-book-op', op_id: 'trash-book-op', book_id: 'trash-book', type: 'highlight.trash', entity_id: 'client-note', payload: { deleted_at: new Date().toISOString() } }); tx.oncomplete = () => db.close(); }; });
    await pageA.locator('.book-card-open').click();
    await expect(pageA.locator('#toolbar-book-title')).toContainText('Trash Fixture');
    await openReaderTools(pageA); await pageA.click('#btn-sync'); await expect.poll(() => state.highlights[0].deleted_at).not.toBeNull();
    const contextB = await browser.newContext({ serviceWorkers: 'block' }); const pageB = await contextB.newPage(); await install(pageB); await pageB.goto('/index.html'); await expect(pageB.locator('.book-card')).toHaveCount(1);
    await pageB.evaluate(async () => { const r = indexedDB.open('marginalia', 6); r.onsuccess = () => { const db = r.result; const tx = db.transaction('sync_queue', 'readwrite'); tx.objectStore('sync_queue').put({ id: 'restore-book-op', op_id: 'restore-book-op', book_id: 'trash-book', type: 'highlight.restore', entity_id: 'client-note', payload: {} }); tx.oncomplete = () => db.close(); }; });
    await pageB.locator('.book-card-open').click();
    await expect(pageB.locator('#toolbar-book-title')).toContainText('Trash Fixture');
    await openReaderTools(pageB); await pageB.click('#btn-sync'); await expect.poll(() => state.highlights[0].deleted_at).toBeNull();
    await contextA.close(); await contextB.close();
  });
});
