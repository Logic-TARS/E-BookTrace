import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'multichapter.epub');

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
              }
            }
          }
          await route.fulfill({ json: state });
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
    // Desktop reader chrome starts hidden; reveal it before using the toolbar.
    if (!(await pageA.locator('#btn-reader-tools').isVisible())) {
      const revealA = pageA.locator('#btn-reveal-reader-chrome');
      await revealA.waitFor({ state: 'visible', timeout: 10_000 });
      await revealA.dispatchEvent('click');
    }
    if (await pageA.locator('#reader-tool-panel').isHidden()) {
      await pageA.click('#btn-reader-tools');
    }
    await pageA.click('#btn-add-bookmark');
    await expect(pageA.locator('#bookmarks-count')).toHaveText('1');
    await pageA.waitForFunction(() => {
      const badge = document.querySelector('#sync-badge');
      return badge && badge.hidden;
    }, null, { timeout: 10_000 });

    await pageA.locator('#btn-reveal-navigator').dispatchEvent('click');
    await pageA.locator('.toc-item', { hasText: 'Chapter 2' }).click();
    await expect.poll(() => state.progress?.progress_percent || 0).toBeGreaterThan(0);
    const savedProgress = { ...state.progress };
    await pageA.close();

    const contextB = await browser.newContext({ serviceWorkers: 'block' });
    const pageB = await contextB.newPage();
    await pageB.addInitScript(() => {
      let factory;
      Object.defineProperty(window, 'ePub', {
        get: () => factory,
        set: original => {
          factory = (...args) => {
            const book = original(...args);
            const generate = book.locations.generate.bind(book.locations);
            book.locations.generate = async (...values) => {
              await new Promise(resolve => { window.releaseLocations = resolve; });
              const result = await generate(...values);
              window.locationsGenerated = true;
              return result;
            };
            return book;
          };
        },
      });
    });
    await installRoutes(pageB);
    await pageB.goto('/index.html');
    await expect(pageB.locator('.book-card')).toHaveCount(1);
    await expect(pageB.locator('.book-card-meta')).toContainText('服务器');
    await pageB.click('.book-card');
    await expect(pageB.locator('#toolbar-book-title')).toContainText('Multichapter');
    await expect(pageB.locator('#bookmarks-count')).toHaveText('1');
    await expect(pageB.locator('.toc-item.active')).toContainText('Chapter 2');
    await expect(pageB.locator('#progress-text')).toHaveText(`${savedProgress.progress_percent}%`);
    expect(state.progress.progress_percent).toBe(savedProgress.progress_percent);
    await pageB.waitForFunction(() => typeof window.releaseLocations === 'function');
    await pageB.evaluate(() => window.releaseLocations());
    await pageB.waitForFunction(() => window.locationsGenerated);
    await expect(pageB.locator('#progress-text')).toHaveText(`${savedProgress.progress_percent}%`);
    await pageB.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(pageB.locator('#sync-badge')).toBeHidden();
    await expect(pageB.locator('#progress-text')).toHaveText(`${savedProgress.progress_percent}%`);
    await pageB.locator('#btn-reveal-navigator').dispatchEvent('click');
    await pageB.locator('.toc-item', { hasText: 'Chapter 1' }).click();
    await expect(pageB.locator('.toc-item.active')).toContainText('Chapter 1');
    await expect.poll(() => state.progress.progress_percent).toBe(0);
    await expect(pageB.locator('#progress-text')).toHaveText('0%');

    await contextA.close();
    await contextB.close();
  });

  test('shows legacy local progress until real locations finish generating', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'offline' } }));
    await page.goto('/index.html');
    await page.evaluate(bytes => new Promise((resolve, reject) => {
      const request = indexedDB.open('marginalia', 5);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('books', 'readwrite');
        tx.objectStore('books').put({
          id: 'legacy-progress', book_title: 'Legacy local reading',
          file_blob: Uint8Array.from(bytes).buffer,
          last_cfi: 'epubcfi(/6/4!/4/2/1:0)', progress_percent: 47,
          transfer_status: 'failed',
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }), Array.from(fs.readFileSync(FIXTURE)));
    await page.addInitScript(() => {
      let factory;
      Object.defineProperty(window, 'ePub', {
        get: () => factory,
        set: original => {
          factory = (...args) => {
            const book = original(...args);
            const generate = book.locations.generate.bind(book.locations);
            book.locations.generate = async (...values) => {
              await new Promise(resolve => { window.releaseLocations = resolve; });
              return generate(...values);
            };
            return book;
          };
        },
      });
    });
    await page.reload();
    await page.click('.book-card');
    await expect(page.locator('#toolbar-book-title')).toHaveText('Legacy local reading');
    await expect(page.locator('.toc-item.active')).toContainText('Chapter 2');
    await expect(page.locator('#progress-text')).toHaveText('47%');
    await page.waitForFunction(() => typeof window.releaseLocations === 'function');
    await page.evaluate(() => window.releaseLocations());
    await expect(page.locator('#progress-text')).toHaveText('34%');
  });
});
