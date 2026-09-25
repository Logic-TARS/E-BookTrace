import { test, expect } from '@playwright/test';
import { installNotesApiRoutes } from './helpers/notes-management.mjs';

const book = {
  id: 'visual-book',
  book_title: '在安静的书斋里阅读一段很长的中文书名',
  book_author: '边注者',
  title: '在安静的书斋里阅读一段很长的中文书名',
  author: '边注者',
  filename: 'visual-book.epub',
  original_filename: 'visual-book.epub',
  content_hash: 'visual-polish-hash',
  state_revision: 0,
  _source: 'server',
  server_book_id: 'visual-book',
  progress_percent: 0,
  last_opened: Date.now(),
};

const material = {
  id: 'visual-highlight',
  book_id: book.id,
  book_title: '一本用于验证笔记管理页面素材书名能够自然换行并完整显示的超长中文书名',
  chapter: '关于文字布局与长内容呈现的章节',
  cfi: 'epubcfi(/6/4!/4/2/2)',
  highlight_text: '第一段摘录需要保留原始换行，并在内容列中自然折行。\n\n第二段包含无空格长英文串ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ。',
  note: '这是一段很长的个人感悟，用来确认笔记管理页面能够在内容列里连续自然地换行并完整显示。即使屏幕变窄，也应保留所有摘录与思考，不出现文字重叠。\n下一段感悟也应保留换行。',
  tags: ['这是一个用于验证标签自动换行能力的超长中文标签', 'UnbrokenTagABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'],
  progress_percent: 67,
  status: 'raw',
  synced: false,
};

async function seedBook(page) {
  await page.evaluate(item => new Promise((resolve, reject) => {
    const request = indexedDB.open('marginalia', 6);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('books', 'readwrite');
      transaction.objectStore('books').put(item);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }), book);
}

async function seedMaterial(page) {
  await page.evaluate(item => new Promise((resolve, reject) => {
    const request = indexedDB.open('marginalia', 6);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('highlights', 'readwrite');
      transaction.objectStore('highlights').put(item);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }), material);
}

async function mockShellApi(page) {
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/books' && request.method() === 'GET') {
      await route.fulfill({ json: { books: [book] } });
      return;
    }
    if (pathname === `/api/books/${book.id}/sync`) {
      await route.fulfill({ json: {
        book_id: book.id,
        revision: 0,
        progress: null,
        bookmarks: [],
        highlights: [],
      } });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: 'not mocked' } });
  });
}

async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    root: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(metrics.root).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1);
}

test.describe('visual polish structure', () => {
  test.use({ serviceWorkers: 'block' });

  test('presents the E-书痕 brand throughout the main shell', async ({ page }) => {
    await installNotesApiRoutes(page, { notes: [] });
    await page.goto('/index.html');

    await expect(page).toHaveTitle('E-书痕 · E-BookTrace');
    await expect(page.locator('.home-nav .brand-mark')).toHaveText('E');
    await expect(page.locator('.home-nav .brand-copy strong')).toHaveText('E-书痕');
    await expect(page.locator('.home-nav .brand-copy')).toContainText('E-BookTrace');
    await expect(page.locator('#empty-library .empty-icon')).toHaveText('E');

    await page.evaluate(() => {
      document.querySelector('#library-view').classList.remove('active');
      document.querySelector('#reader-view').classList.add('active');
    });
    await expect(page.locator('.reader-product-name')).toHaveText('E-书痕');
  });

  test('keeps the polished library and notes workspace structured across target widths', async ({ page }) => {
    await installNotesApiRoutes(page, { notes: [] });
    for (const width of [360, 390, 768, 1000, 1440]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
      await page.goto('/index.html');
      await expect(page.locator('#library-view')).toHaveClass(/active/, { timeout: 10000 });
      await expect(page.locator('.app-title')).toHaveText('你的阅读素材库');
      await expect(page.locator('.app-title strong')).toHaveText('素材库');
      await expect(page.locator('.library-header')).toHaveCSS('border-radius', width <= 900 ? '18px' : '22px');
      await expectNoHorizontalOverflow(page);
    }

    // Also check the workspace at a wide width where nav is accessible
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html');
    await expect(page.locator('#library-view')).toHaveClass(/active/, { timeout: 10000 });
    await page.locator('#btn-library-create').click();
    await expect(page.locator('#creation-view')).toHaveClass(/active/, { timeout: 10000 });
    await expect(page.locator('#creation-view h1')).toHaveText('笔记管理');
    await expectNoHorizontalOverflow(page);

    // And at narrow widths, check workspace doesn't overflow when navigated to directly
    for (const width of [360, 390, 768, 1000]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
      await expectNoHorizontalOverflow(page);
    }
  });

  test('book cards expose a semantic open action with separate controls and keyboard support', async ({ page }) => {
    await mockShellApi(page);
    await page.goto('/index.html');
    await seedBook(page);
    await page.reload();

    const card = page.locator('.book-card').filter({ hasText: book.book_title });
    const openButton = card.getByRole('button', { name: `打开《${book.book_title}》` });
    await expect(openButton).toBeVisible();
    await expect(card.getByRole('button', { name: `删除《${book.book_title}》` })).toBeVisible();
    await expect(card.locator('.book-card-cover')).toHaveText('在');
    await expect(card.locator('.book-card-progress')).toHaveAttribute('role', 'progressbar');
    await expect(card.locator('.book-card-progress')).toHaveAttribute('aria-valuenow', '0');

    await page.evaluate(() => {
      const readerList = document.querySelector('#notes-list');
      const managementList = document.querySelector('#notes-management-list');
      readerList.dataset.readerContainerProbe = 'reader';
      managementList.dataset.readerContainerProbe = 'management';
    });
    await openButton.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/reader$/);
    await expect(page.locator('#notes-list .empty-notes')).toContainText('选中文字开始划线');
    await expect(page.locator('#notes-list')).toHaveAttribute('data-reader-container-probe', 'reader');
    await expect(page.locator('#notes-management-list')).toHaveAttribute('data-reader-container-probe', 'management');
  });

  test('uses warm paper reader surfaces without unused sidebar columns', async ({ page }) => {
    await installNotesApiRoutes(page, { notes: [] });
    await page.goto('/index.html');
    await page.evaluate(() => {
      document.querySelector('#library-view').classList.remove('active');
      document.querySelector('#reader-view').classList.add('active');
      document.body.classList.add('reader-active');
    });
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => {
        const reader = getComputedStyle(document.querySelector('#reader-view'));
        const main = document.querySelector('.reader-main').getBoundingClientRect();
        const viewport = document.querySelector('.reader-viewport').getBoundingClientRect();
        return {
          canvas: reader.getPropertyValue('--reader-canvas').trim(),
          sidebar: reader.getPropertyValue('--reader-sidebar').trim(),
          text: reader.getPropertyValue('--reader-text').trim(),
          mainWidth: main.width,
          viewportWidth: viewport.width,
        };
      });
      expect(metrics).toMatchObject({ canvas: '#f4f1ea', sidebar: '#fffdf8', text: '#20231f' });
      expect(Math.abs(metrics.mainWidth - metrics.viewportWidth)).toBeLessThanOrEqual(1);
      await expectNoHorizontalOverflow(page);
    }
  });

  test('keeps reader safe-area, danger, and selection-toolbar overrides correctly scoped', async ({ page }) => {
    await installNotesApiRoutes(page, { notes: [] });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/index.html');
    // Wait for the app to finish initialization before overriding DOM state
    await expect(page.locator('#library-view')).toHaveClass(/active/, { timeout: 10000 });
    await page.evaluate(() => {
      document.querySelector('#library-view').classList.remove('active');
      document.querySelector('#reader-view').classList.add('active');
      document.body.classList.add('reader-active');
      const danger = document.createElement('button');
      danger.id = 'reader-danger-probe';
      danger.className = 'btn btn-danger';
      document.querySelector('#reader-view').appendChild(danger);
      document.querySelector('#selection-toolbar').hidden = false;
    });

    const styles = await page.evaluate(() => {
      const toolbar = document.querySelector('.reader-tool-bar') || document.querySelector('.reader-toolbar');
      const danger = document.querySelector('#reader-danger-probe');
      const selection = document.querySelector('#selection-toolbar');
      const note = document.querySelector('#btn-add-note') || document.querySelector('#btn-add-bookmark');
      return {
        toolbarHeight: toolbar.getBoundingClientRect().height,
        dangerBackground: getComputedStyle(danger).backgroundColor,
        dangerColor: getComputedStyle(danger).color,
        selectionBackground: getComputedStyle(selection).backgroundColor,
        noteBackground: note ? getComputedStyle(note).backgroundColor : '',
      };
    });
    expect(styles.toolbarHeight).toBeGreaterThan(0);
    expect(styles.dangerBackground).toBe('rgb(179, 66, 53)');
    expect(styles.dangerColor).toBe('rgb(255, 255, 255)');
    expect(styles.selectionBackground).toBe('rgba(255, 253, 248, 0.97)');

    await page.locator('#reader-danger-probe').hover();
    await expect.poll(() => page.locator('#reader-danger-probe').evaluate(element => (
      getComputedStyle(element).backgroundColor
    ))).toBe('rgb(147, 54, 43)');

    const safeAreaCss = await page.locator('link[rel="stylesheet"]').evaluate(async link => (
      fetch(link.href).then(response => response.text())
    ));
    expect(safeAreaCss).toContain('height: calc(var(--toolbar-height) + env(safe-area-inset-top));');
    expect(safeAreaCss).toContain('padding: calc(6px + env(safe-area-inset-top)) 8px 6px;');

    await page.evaluate(() => document.body.classList.remove('reader-active'));
    await expect.poll(() => page.locator('#selection-toolbar').evaluate(element => (
      getComputedStyle(element).backgroundColor
    ))).not.toBe('rgba(255, 253, 248, 0.97)');
  });
});
