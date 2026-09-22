import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'multichapter.epub');
const EPUB_BYTES = fs.readFileSync(FIXTURE);

function libraryBook(overrides = {}) {
  return {
    id: 'library-1',
    title: 'MultiChapter',
    author: 'Fixture Author',
    filename: 'multichapter.epub',
    original_filename: 'multichapter.epub',
    ...overrides,
  };
}

async function mockReaderApi(page, options = {}) {
  const book = libraryBook(options.book);
  const requests = [];
  const progressPayloads = [];
  let uploadCount = 0;
  let uploaded = !options.empty;

  page.on('request', request => requests.push({
    method: request.method(),
    pathname: new URL(request.url()).pathname,
  }));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();

    if (pathname === '/api/books' && method === 'GET') {
      await route.fulfill({ json: { books: uploaded ? [book] : [] } });
      return;
    }
    if (pathname === `/api/books/${book.id}/sync` && method === 'GET') {
      await route.fulfill({ json: {
        book_id: book.id,
        revision: 0,
        progress: options.progress || null,
        bookmarks: [],
        highlights: [],
      } });
      return;
    }
    if (pathname === `/api/books/${book.id}/sync` && method === 'POST') {
      progressPayloads.push(request.postDataJSON());
      await route.fulfill({ json: {
        book_id: book.id,
        revision: progressPayloads.length,
        progress: request.postDataJSON().operations[0].payload,
        bookmarks: [],
        highlights: [],
      } });
      return;
    }
    if (pathname === `/api/books/${book.id}/file` && method === 'GET') {
      if (options.fileError) {
        await route.fulfill({ status: 500, json: { detail: 'fixture download failed' } });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/epub+zip',
          body: EPUB_BYTES,
        });
      }
      return;
    }
    if (pathname === '/api/books/upload' && method === 'POST') {
      uploadCount += 1;
      uploaded = true;
      await route.fulfill({ status: 202, json: { book, created: true } });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: `not mocked: ${method} ${pathname}` } });
  });

  return {
    book,
    requests,
    progressPayloads,
    uploadCount: () => uploadCount,
  };
}

async function openReader(page, api, options = {}) {
  await page.addInitScript(({ bookId, position }) => {
    localStorage.setItem('marginalia.chatReader.selectedBookId', bookId);
    if (position) {
      localStorage.setItem(`marginalia.chatReader.position.${bookId}`, JSON.stringify(position));
    }
    localStorage.setItem('marginalia.unrelated', 'keep-me');
    window.indexedDB = new Proxy(window.indexedDB, {
      get() { throw new Error('GPT reader must not access IndexedDB'); },
    });
  }, { bookId: api.book.id, position: options.position || null });
  await page.goto('/book-chat/');
  await expect(page.locator('#epub-container iframe').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#epub-container iframe').first()).not.toHaveCSS('height', '0px');
  await expect(page.locator('#search-input')).toBeEnabled();
  await expect.poll(() => page.evaluate(bookId => {
    const position = JSON.parse(localStorage.getItem(`marginalia.chatReader.position.${bookId}`));
    return position && position.cfi;
  }, api.book.id)).toMatch(/^epubcfi\(/);
}

function forbiddenRequests(requests) {
  return requests.filter(item => /knowledge|conversation|message|stream/i.test(item.pathname));
}

async function iframeTheme(page) {
  return page.locator('#epub-container iframe').first().evaluate(frame => {
    const view = frame.contentWindow;
    const bodyStyle = view.getComputedStyle(frame.contentDocument.body);
    const link = frame.contentDocument.querySelector('a');
    return {
      backgroundColor: bodyStyle.backgroundColor,
      color: bodyStyle.color,
      linkColor: link ? view.getComputedStyle(link).color : null,
    };
  });
}

test.describe('EPUB reader', () => {
  test.use({ serviceWorkers: 'block' });

  test('uses the system theme initially and follows it until the user chooses a theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const api = await mockReaderApi(page);
    await page.goto('/book-chat/');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ffffff');
    await expect(page.getByRole('button', { name: '切换到护眼模式' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('marginalia.chatReader.theme'))).toBeNull();

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#171717');
    expect(forbiddenRequests(api.requests)).toEqual([]);
  });

  test('persists a theme button choice across refreshes and overrides the system theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const api = await mockReaderApi(page);
    await page.goto('/book-chat/');

    const toggle = page.locator('#theme-toggle');
    await expect(toggle).toHaveAttribute('aria-label', '切换到浅色模式');
    await expect(toggle).toHaveAttribute('title', '切换到浅色模式');
    await expect(page.locator('#theme-icon')).toHaveText('☀');
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(toggle).toHaveAttribute('aria-label', '切换到护眼模式');
    await expect(toggle).toHaveAttribute('title', '切换到护眼模式');
    await expect(page.locator('#theme-icon')).toHaveText('❀');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ffffff');
    expect(await page.evaluate(() => localStorage.getItem('marginalia.chatReader.theme'))).toBe('light');

    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia');
    await expect(toggle).toHaveAttribute('aria-label', '切换到深色模式');
    await expect(toggle).toHaveAttribute('title', '切换到深色模式');
    await expect(page.locator('#theme-icon')).toHaveText('☾');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f6efdd');
    expect(await page.evaluate(() => localStorage.getItem('marginalia.chatReader.theme'))).toBe('sepia');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia');
    expect(forbiddenRequests(api.requests)).toEqual([]);
  });

  test('uses mutually exclusive accessible sidebar tabs and opens a book on the directory tab', async ({ page }) => {
    const api = await mockReaderApi(page);
    await page.goto('/book-chat/');

    const tablist = page.getByRole('tablist', { name: '导航' });
    await expect(tablist).toBeVisible();
    await expect(page.getByRole('tab', { name: '聊天' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: '聊天' })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: '大纲' })).toBeHidden();

    await page.locator('#book-list .book-button', { hasText: 'MultiChapter' }).click();
    await expect(page.locator('#epub-container iframe').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tab', { name: '大纲' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: '聊天' })).toBeHidden();
    await expect(page.getByRole('tabpanel', { name: '大纲' })).toBeVisible();
    await expect(page.locator('#toc-book-title')).toContainText(/Multichapter/i);

    await page.getByRole('tab', { name: '聊天' }).click();
    await expect(page.getByRole('tabpanel', { name: '聊天' })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: '大纲' })).toBeHidden();
  });

  test('isolates resources and APIs while rendering the server EPUB in an iframe', async ({ page }) => {
    const allPaths = [];
    page.on('request', request => allPaths.push(new URL(request.url()).pathname));
    const api = await mockReaderApi(page);
    await openReader(page, api);

    await expect(page.locator('#toc-book-title')).toContainText(/Multichapter/i);
    await expect(page.locator('#book-list .book-button')).toHaveCount(1);
    await expect(page.locator('#toc-list .toc-button')).toHaveCount(3);
    expect(allPaths).toContain('/jszip.min.js');
    expect(allPaths).toContain('/epub.min.js');
    expect(allPaths).toContain('/book-chat/style.css');
    expect(allPaths).toContain('/book-chat/app.js');
    expect(allPaths).not.toContain('/style.css');
    expect(allPaths).not.toContain('/app.js');
    expect(forbiddenRequests(api.requests)).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('marginalia.unrelated'))).toBe('keep-me');
  });

  test('keeps the topbar minimal with a full-width scrolling canvas', async ({ page }) => {
    const api = await mockReaderApi(page);
    await openReader(page, api);

    await expect(page.locator('.topbar h1')).toHaveCount(1);
    await expect(page.locator('.topbar')).toContainText('Chapter 1');
    await expect(page.locator('.topbar')).not.toContainText('MultiChapter');
    await expect(page.locator('.topbar')).not.toContainText('Fixture Author');
    await expect(page.locator('#progress-label')).toBeHidden();
    await expect(page.locator('#page-navigation')).toBeHidden();
    await expect(page.locator('.brand')).toContainText('ChatGPT');

    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('.reading-canvas').getBoundingClientRect();
      const content = document.querySelector('.reader-content');
      const contentStyle = getComputedStyle(content);
      const contentWidth = content.clientWidth
        - parseFloat(contentStyle.paddingLeft)
        - parseFloat(contentStyle.paddingRight);
      const inner = document.querySelector('#epub-container > .epub-container');
      return {
        canvasWidth: canvas.width,
        contentWidth,
        innerOverflowY: getComputedStyle(inner).overflowY,
      };
    });
    expect(Math.abs(layout.canvasWidth - layout.contentWidth)).toBeLessThanOrEqual(1);
    expect(layout.innerOverflowY).toBe('auto');
  });

  test('collapses and expands the sidebar on desktop', async ({ page }) => {
    const api = await mockReaderApi(page);
    await openReader(page, api);

    await expect(page.locator('#open-sidebar')).toBeHidden();
    await expect(page.locator('#sidebar')).toBeVisible();

    await page.locator('#close-sidebar').click();
    await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
    await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#open-sidebar')).toBeVisible();

    await page.locator('#open-sidebar').click();
    await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-collapsed/);
    await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#open-sidebar')).toBeHidden();
    expect(forbiddenRequests(api.requests)).toEqual([]);
  });

  test('jumps with the recursive table of contents and highlights the active chapter', async ({ page }) => {
    const api = await mockReaderApi(page);
    await openReader(page, api);

    await page.locator('#toc-list .toc-button', { hasText: 'Chapter 2' }).click();
    await expect(page.locator('#chapter-title')).toContainText('Chapter 2', { timeout: 10_000 });
    await expect(page.locator('#toc-list .toc-button', { hasText: 'Chapter 2' })).toHaveAttribute('aria-current', 'location');
  });

  test('matches chapter names immediately and searches EPUB text locally', async ({ page }) => {
    const api = await mockReaderApi(page);
    await openReader(page, api);
    const input = page.locator('#search-input');

    await expect(input).toHaveAttribute('placeholder', '询问任何问题');
    await expect(page.locator('#search-jump')).toHaveAttribute('aria-label', '跳转到搜索结果');
    await expect(page.locator('#search-jump')).not.toHaveText('↑');
    await expect(page.locator('.composer-hint')).toHaveCount(0);
    await input.focus();
    await expect(page.locator('#search-popover')).toBeVisible();
    await expect(page.locator('#search-status')).toContainText('输入关键词检索当前内容');

    await input.fill('Chapter 3');
    await expect(page.locator('.search-result').first()).toContainText('Chapter 3');
    await input.press('Enter');
    await expect(page.locator('#chapter-title')).toContainText('Chapter 3', { timeout: 10_000 });

    await input.fill('voluptate');
    await expect(page.locator('#search-status')).toContainText('内容匹配', { timeout: 15_000 });
    await expect(page.locator('.search-result small', { hasText: '内容' }).first()).toBeVisible();
    await input.press('ArrowDown');
    await input.press('ArrowUp');
    await input.press('Enter');
    await expect(page.locator('#search-popover')).toBeHidden();
    expect(forbiddenRequests(api.requests)).toEqual([]);
  });

  test('restores a saved CFI without first overwriting its nonzero progress', async ({ page }) => {
    const progress = {
      cfi: 'epubcfi(/6/4[chapter-2]!/4/2/2/1:0)',
      progress_percent: 47,
      last_opened: 123456,
    };
    const api = await mockReaderApi(page, { progress });
    await openReader(page, api);

    await expect(page.locator('#chapter-title')).toContainText('Chapter 2', { timeout: 10_000 });
    if (api.progressPayloads.length) {
      expect(api.progressPayloads[0].operations[0].payload.progress_percent).toBeGreaterThan(0);
    }
    expect(await page.evaluate(bookId => localStorage.getItem(`marginalia.chatReader.position.${bookId}`), api.book.id)).not.toBeNull();
  });

  test('preserves the current CFI while resizing the reading canvas', async ({ page }) => {
    const api = await mockReaderApi(page);
    await openReader(page, api);
    const before = await page.evaluate(() => localStorage.getItem('marginalia.chatReader.position.library-1'));

    await page.setViewportSize({ width: 1000, height: 700 });
    await expect.poll(() => page.locator('#epub-container > .epub-container').evaluate(inner => (
      inner.clientHeight === inner.parentElement.clientHeight &&
      inner.clientWidth <= inner.parentElement.clientWidth &&
      inner.clientWidth > inner.parentElement.clientWidth - 20
    ))).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const position = JSON.parse(localStorage.getItem('marginalia.chatReader.position.library-1'));
      return position && position.last_opened;
    })).toBeGreaterThan(JSON.parse(before).last_opened);

    const after = await page.evaluate(() => localStorage.getItem('marginalia.chatReader.position.library-1'));
    expect(JSON.parse(after).cfi).toBe(JSON.parse(before).cfi);
    const metrics = await page.locator('#epub-container > .epub-container').evaluate(inner => ({
      hostWidth: inner.parentElement.clientWidth,
      innerWidth: inner.clientWidth,
      hostHeight: inner.parentElement.clientHeight,
      innerHeight: inner.clientHeight,
    }));
    expect(metrics.innerWidth).toBeLessThanOrEqual(metrics.hostWidth);
    expect(metrics.innerWidth).toBeGreaterThan(metrics.hostWidth - 20);
    expect(metrics.innerHeight).toBe(metrics.hostHeight);
  });

  test('updates the open EPUB iframe theme without changing its CFI', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const api = await mockReaderApi(page);
    await openReader(page, api);

    const before = JSON.parse(await page.evaluate(() => localStorage.getItem('marginalia.chatReader.position.library-1'))).cfi;
    const fileRequestsBefore = api.requests.filter(item => item.pathname === '/api/books/library-1/file').length;
    await expect.poll(() => iframeTheme(page)).toMatchObject({
      backgroundColor: 'rgb(29, 29, 29)',
      color: 'rgb(221, 215, 206)',
    });

    await page.locator('#theme-toggle').click();
    await expect.poll(() => iframeTheme(page)).toMatchObject({
      backgroundColor: 'rgb(255, 255, 255)',
      color: 'rgb(43, 41, 37)',
    });
    const after = JSON.parse(await page.evaluate(() => localStorage.getItem('marginalia.chatReader.position.library-1'))).cfi;
    expect(after).toBe(before);
    expect(api.requests.filter(item => item.pathname === '/api/books/library-1/file')).toHaveLength(fileRequestsBefore);
    expect(forbiddenRequests(api.requests)).toEqual([]);
  });

  test('debounces relocated progress.set with the required payload and no AI requests', async ({ page }) => {
    const api = await mockReaderApi(page);
    await openReader(page, api);
    await page.keyboard.press('ArrowRight');

    await expect.poll(() => api.progressPayloads.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const operation = api.progressPayloads.at(-1).operations[0];
    expect(operation.type).toBe('progress.set');
    expect(operation.op_id).toMatch(/^chat-reader-progress-library-1-/);
    expect(operation.payload.cfi).toMatch(/^epubcfi\(/);
    expect(operation.payload.progress_percent).toBeGreaterThanOrEqual(0);
    expect(operation.payload.last_opened).toBeGreaterThan(0);
    expect(forbiddenRequests(api.requests)).toEqual([]);
  });

  test('keeps the 390px light layout clean and closes the tabbed drawer after selections', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    const api = await mockReaderApi(page);
    await openReader(page, api);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
    await expect(page.locator('.topbar h1')).toHaveCount(1);
    await expect(page.locator('.topbar')).not.toContainText('MultiChapter');
    await expect(page.locator('.topbar')).not.toContainText('Fixture Author');
    await page.locator('#open-sidebar').click();
    await expect(page.locator('#sidebar')).toHaveClass(/open/);
    await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#backdrop')).toBeVisible();
    await expect(page.getByRole('button', { name: '切换到护眼模式' })).toBeVisible();
    await page.getByRole('tab', { name: '聊天' }).click();
    await page.locator('#book-list .book-button', { hasText: 'MultiChapter' }).click();
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);

    await page.locator('#open-sidebar').click();
    await expect(page.getByRole('tab', { name: '大纲' })).toHaveAttribute('aria-selected', 'true');
    await page.locator('#toc-list .toc-button', { hasText: 'Chapter 2' }).click();
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
    await expect(page.locator('#chapter-title')).toContainText('Chapter 2');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('imports the fixture through the upload endpoint', async ({ page }) => {
    const api = await mockReaderApi(page, { empty: true });
    await page.goto('/book-chat/');
    await expect(page.locator('#state-title')).toContainText('有什么可以帮忙的？');

    await page.setInputFiles('#epub-input', FIXTURE);
    await expect.poll(api.uploadCount).toBe(1);
    await expect(page.locator('#epub-container iframe').first()).toBeVisible({ timeout: 15_000 });
    expect(forbiddenRequests(api.requests)).toEqual([]);
  });

  test('retries library loading after repeated failures without opening the file chooser', async ({ page }) => {
    const api = await mockReaderApi(page);
    const pageErrors = [];
    const fileChoosers = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('filechooser', chooser => fileChoosers.push(chooser));
    let attempts = 0;
    await page.route('**/api/books', async route => {
      attempts += 1;
      if (attempts <= 2) {
        await route.fulfill({ status: 503, json: { detail: `library unavailable ${attempts}` } });
      } else {
        await route.fallback();
      }
    });
    await page.goto('/book-chat/');
    await expect(page.locator('#state-description')).toHaveText('library unavailable 1');

    await page.locator('#state-action').click();
    await expect(page.locator('#state-description')).toHaveText('library unavailable 2');
    await expect(page.locator('#state-action')).toBeVisible();
    await page.locator('#state-action').click();
    await expect(page.locator('#book-list .book-button')).toHaveText('MultiChapter');
    await expect(page.locator('#library-empty')).toBeHidden();
    await expect(page.locator('#reader-state')).toHaveAttribute('data-state', 'idle');
    await page.locator('#book-list .book-button').click();
    await expect(page.locator('#epub-container iframe').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#search-input')).toBeEnabled();
    expect(api.requests.filter(item => item.pathname === '/api/books')).toHaveLength(3);
    expect(fileChoosers).toHaveLength(0);
    expect(pageErrors).toEqual([]);
  });

  test('retries a failed upload by choosing a file instead of reopening the previous book', async ({ page }) => {
    const api = await mockReaderApi(page);
    await openReader(page, api);
    await page.route('**/api/books/upload', async route => {
      await route.fulfill({ status: 422, json: { detail: 'invalid EPUB upload' } });
    }, { times: 1 });
    await page.setInputFiles('#epub-input', FIXTURE);
    await expect(page.locator('#state-description')).toHaveText('invalid EPUB upload');
    const fileRequestsBefore = api.requests.filter(item => item.pathname.endsWith('/file')).length;

    const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
    const [chooser] = await Promise.all([chooserPromise, page.locator('#state-action').click()]);
    await expect(page.locator('#reader-state')).toHaveAttribute('data-state', 'error');
    expect(api.requests.filter(item => item.pathname.endsWith('/file'))).toHaveLength(fileRequestsBefore);
    await chooser.setFiles(FIXTURE);
    await expect(page.locator('#reader-state')).toBeHidden();
    await expect(page.locator('#epub-container iframe').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#search-input')).toBeEnabled();
    expect(api.requests.filter(item => item.pathname === '/api/books/upload')).toHaveLength(2);
  });

  test('retries library refresh after upload without uploading again or reopening the old book', async ({ page }) => {
    const api = await mockReaderApi(page);
    await openReader(page, api);
    const uploadedBook = libraryBook({ id: 'library-2', title: 'New upload' });
    await page.route('**/api/books/upload', async route => {
      await route.fulfill({ status: 202, json: { book: uploadedBook, created: true } });
    });
    let refreshAttempts = 0;
    await page.route('**/api/books', async route => {
      refreshAttempts += 1;
      if (refreshAttempts === 1) {
        await route.fulfill({ status: 503, json: { detail: 'library refresh unavailable' } });
      } else {
        await route.fulfill({ json: { books: [api.book, uploadedBook] } });
      }
    });
    await page.route('**/api/books/library-2/sync', async route => {
      await route.fulfill({ json: {
        book_id: uploadedBook.id, revision: 0, progress: null, bookmarks: [], highlights: [],
      } });
    });
    await page.route('**/api/books/library-2/file', async route => {
      await route.fulfill({ contentType: 'application/epub+zip', body: EPUB_BYTES });
    });
    await page.setInputFiles('#epub-input', FIXTURE);
    await expect(page.locator('#state-description')).toHaveText('library refresh unavailable');
    await page.locator('#state-action').click();

    await expect(page.locator('#book-list .book-button[aria-current="true"]')).toHaveText('New upload');
    await expect(page.locator('#reader-state')).toBeHidden();
    await expect(page.locator('#epub-container iframe').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#search-input')).toBeEnabled();
    expect(api.requests.filter(item => item.pathname === '/api/books/upload')).toHaveLength(1);
    expect(api.requests.filter(item => item.pathname === '/api/books/library-1/file')).toHaveLength(1);
    expect(api.requests.filter(item => item.pathname === '/api/books/library-2/file')).toHaveLength(1);
  });

  test('shows an explicit download error state and retries the selected book', async ({ page }) => {
    const options = { fileError: true };
    const api = await mockReaderApi(page, options);
    await page.addInitScript(bookId => {
      localStorage.setItem('marginalia.chatReader.selectedBookId', bookId);
    }, api.book.id);
    await page.goto('/book-chat/');

    await expect(page.locator('#reader-state')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#state-title')).toContainText('无法载入内容');
    await expect(page.locator('#state-description')).toContainText('fixture download failed');
    options.fileError = false;
    await page.locator('#state-action').click();
    await expect(page.locator('#reader-state')).toBeHidden();
    await expect(page.locator('#epub-container iframe').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#search-input')).toBeEnabled();
    expect(api.requests.filter(item => item.pathname === `/api/books/${api.book.id}/file`)).toHaveLength(2);
    expect(forbiddenRequests(api.requests)).toEqual([]);
  });

  test('sidebar toggling keeps the reading position and still reports progress', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const api = await mockReaderApi(page);
    await openReader(page, api);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => api.progressPayloads.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const before = await page.locator('#progress-label').textContent();
    await page.locator('#open-sidebar').click();
    await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'false');
    await page.locator('#backdrop').click();
    await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#progress-label')).toHaveText(before || '');
    expect(api.progressPayloads.length).toBeGreaterThan(0);
  });
});
