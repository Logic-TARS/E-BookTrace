import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'multichapter.epub');
const FLOW_KEY = 'marginalia.readerFlow';

async function openFixture(page, { clearPreference = true } = {}) {
  await page.goto('/index.html');
  if (clearPreference) {
    await page.evaluate(key => localStorage.removeItem(key), FLOW_KEY);
    await page.reload();
  }
  await page.setInputFiles('#file-input', FIXTURE);
  await expect(page.locator('#toolbar-book-title')).toContainText(/multichapter/i, { timeout: 15_000 });
  await expect(page.locator('#reader-view')).toHaveClass(/active/);
}

async function revealTools(page) {
  const reveal = page.locator('#btn-reveal-reader-chrome');
  if (await reveal.isVisible()) await reveal.click();
  if (await page.locator('#reader-tool-panel').isHidden()) await page.locator('#btn-reader-tools').click();
  await expect(page.locator('#reader-tool-panel')).toBeVisible();
}

async function renditionState(page) {
  return page.locator('#epub-container').evaluate((host) => {
    const manager = host.querySelector(':scope > .epub-container');
    const frames = Array.from(host.querySelectorAll('iframe')).filter(item => item.contentDocument?.body);
    const visible = [];
    const headings = [];
    const hostRect = host.getBoundingClientRect();
    for (const iframe of frames) {
      const frameRect = iframe.getBoundingClientRect();
      for (const element of iframe.contentDocument.querySelectorAll('h1, p')) {
        const rect = element.getBoundingClientRect();
        const top = frameRect.top + rect.top;
        const bottom = frameRect.top + rect.bottom;
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
        if (!text) continue;
        const item = { text, top: top - hostRect.top, tag: element.tagName };
        if (element.tagName === 'H1') headings.push(item);
        if (bottom > hostRect.top && top < hostRect.bottom) visible.push(item);
      }
    }
    visible.sort((left, right) => left.top - right.top);
    headings.sort((left, right) => Math.abs(left.top) - Math.abs(right.top));
    return {
      overflowY: manager ? getComputedStyle(manager).overflowY : '',
      scrollTop: manager?.scrollTop || 0,
      clientHeight: manager?.clientHeight || 0,
      scrollHeight: manager?.scrollHeight || 0,
      visible,
      headings,
      firstVisibleText: visible[0]?.text || '',
    };
  });
}

async function selectFlow(page, flow = 'scrolled') {
  await revealTools(page);
  await page.locator('#reader-flow').selectOption(flow);
  await expect(page.locator('#reader-view')).toHaveAttribute('data-reader-flow', flow);
  await expect.poll(async () => (await renditionState(page)).visible.length).toBeGreaterThan(0);
}

async function openNavigator(page) {
  const reveal = page.locator('#btn-reveal-reader-chrome');
  if (await reveal.isVisible()) await reveal.click();
  if (!await page.locator('#reader-navigator').evaluate(element => element.classList.contains('open'))) {
    await page.locator('#btn-toggle-navigator').click();
  }
  await expect(page.locator('#reader-navigator')).toHaveClass(/open/);
}

async function gotoChapter(page, title) {
  await openNavigator(page);
  await page.locator('.toc-item', { hasText: title }).click();
  await expect(page.locator('#toolbar-chapter')).toHaveText(title);
}

async function dispatchIframeWheel(page, deltaY) {
  await page.locator('#epub-container').evaluate((host, delta) => {
    const iframe = Array.from(host.querySelectorAll('iframe')).find(item => item.contentDocument?.body);
    if (!iframe) throw new Error('No EPUB iframe found');
    iframe.contentDocument.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: delta,
    }));
  }, deltaY);
}

test.describe('reader flow modes', () => {
  test.use({ serviceWorkers: 'block' });

  test('defaults to paginated and switches to a continuous scroller', async ({ page }) => {
    await openFixture(page);
    await revealTools(page);

    await expect(page.locator('#reader-flow')).toHaveValue('paginated');
    await expect(page.locator('#reader-view')).toHaveAttribute('data-reader-flow', 'paginated');
    await expect(page.locator('#page-text')).toHaveText(/第\s*\d+\s*\/\s*\d+\s*页/, { timeout: 15_000 });

    await page.locator('#reader-flow').selectOption('scrolled');
    await expect(page.locator('#reader-view')).toHaveAttribute('data-reader-flow', 'scrolled');
    await expect(page.locator('#page-text')).toContainText('滚动阅读');
    await expect.poll(async () => (await renditionState(page)).overflowY).toBe('auto');
  });

  test('scrolls with wheel and vertical keys while horizontal keys navigate sections', async ({ page }) => {
    await openFixture(page);
    await selectFlow(page);
    await expect.poll(async () => (await renditionState(page)).scrollHeight).toBeGreaterThan(0);

    const initial = await renditionState(page);
    await dispatchIframeWheel(page, 420);
    await expect.poll(async () => (await renditionState(page)).scrollTop).toBeGreaterThan(initial.scrollTop);

    const afterWheel = await renditionState(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await renditionState(page)).scrollTop).toBeGreaterThan(afterWheel.scrollTop);

    const afterArrow = await renditionState(page);
    await page.keyboard.press('PageDown');
    await expect.poll(async () => (await renditionState(page)).scrollTop)
      .toBeGreaterThanOrEqual(afterArrow.scrollTop + Math.max(100, afterArrow.clientHeight - 120));

    const beforeHorizontal = await renditionState(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await renditionState(page)).scrollTop).toBeGreaterThanOrEqual(beforeHorizontal.scrollTop);
  });

  test('lands a fragmentless TOC chapter at the first viewport and remains stable', async ({ page }) => {
    await openFixture(page);
    await selectFlow(page);
    await gotoChapter(page, 'Chapter 3');

    await expect.poll(async () => (await renditionState(page)).headings[0]).toMatchObject({ text: 'Chapter 3', tag: 'H1' });
    await expect(page.locator('.toc-item[aria-current="location"]')).toHaveText('Chapter 3');
    const settled = (await renditionState(page)).headings[0];
    expect(Math.abs(settled.top)).toBeLessThan(80);
    await page.waitForTimeout(1000);
    expect((await renditionState(page)).headings[0]).toMatchObject({ text: 'Chapter 3', tag: 'H1' });
    await expect(page.locator('.toc-item[aria-current="location"]')).toHaveText('Chapter 3');
  });

  test('preserves visible text through continuous viewport resizing', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 });
    await openFixture(page);
    await selectFlow(page);
    await dispatchIframeWheel(page, 2600);
    await page.waitForTimeout(750);
    const before = await renditionState(page);
    expect(before.visible.length).toBeGreaterThan(0);

    await page.setViewportSize({ width: 980, height: 700 });
    await page.setViewportSize({ width: 860, height: 660 });
    await page.setViewportSize({ width: 1040, height: 740 });
    await expect.poll(async () => {
      const after = await renditionState(page);
      return after.visible.some(item => before.visible.some(previous => previous.text === item.text));
    }).toBeTruthy();
  });

  test('preserves visible text through rapid typography input', async ({ page }) => {
    await openFixture(page);
    await selectFlow(page);
    await dispatchIframeWheel(page, 2300);
    await page.waitForTimeout(750);
    const before = await renditionState(page);
    expect(before.visible.length).toBeGreaterThan(0);

    await revealTools(page);
    for (const value of ['110', '125', '140', '130']) {
      await page.locator('#reader-font-size').fill(value);
    }
    for (const value of ['1.8', '2', '1.9']) {
      await page.locator('#reader-line-height').fill(value);
    }
    await expect.poll(async () => {
      const after = await renditionState(page);
      return after.visible.some(item => before.visible.some(previous => previous.text === item.text));
    }).toBeTruthy();
    await page.waitForTimeout(1000);
    const settled = await renditionState(page);
    expect(settled.visible.some(item => before.visible.some(previous => previous.text === item.text))).toBeTruthy();
  });

  test('TOC navigation wins a race with viewport resize', async ({ page }) => {
    await openFixture(page);
    await selectFlow(page);
    await page.setViewportSize({ width: 1050, height: 720 });
    await openNavigator(page);
    await page.locator('#btn-reader-tools').click();
    await expect(page.locator('#reader-tool-panel')).toBeHidden();
    await page.locator('.toc-item', { hasText: 'Chapter 3' }).click();
    await page.setViewportSize({ width: 880, height: 680 });
    await page.setViewportSize({ width: 920, height: 700 });

    await expect(page.locator('#toolbar-chapter')).toHaveText('Chapter 3');
    await expect.poll(async () => (await renditionState(page)).headings[0]).toMatchObject({ text: 'Chapter 3', tag: 'H1' });
    await page.waitForTimeout(500);
    expect((await renditionState(page)).headings[0]).toMatchObject({ text: 'Chapter 3', tag: 'H1' });
  });

  test('persists preference and preserves the reading position across rebuilds', async ({ page }) => {
    await openFixture(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const chapterBefore = await page.locator('#toolbar-chapter').textContent();
    const visibleBefore = (await renditionState(page)).visible.map(item => item.text);
    expect(visibleBefore.length).toBeGreaterThan(0);

    await selectFlow(page);
    await expect.poll(async () => page.locator('#toolbar-chapter').textContent()).toBe(chapterBefore);
    await expect.poll(async () => (await renditionState(page)).visible.some(item => visibleBefore.includes(item.text))).toBeTruthy();
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), FLOW_KEY)).toBe('scrolled');

    await page.reload();
    await expect(page.locator('#library-view')).toHaveClass(/active/, { timeout: 15_000 });
    await page.locator('.book-card', { hasText: /multichapter/i }).locator('.book-card-open').click();
    await expect(page.locator('#toolbar-book-title')).toContainText(/multichapter/i, { timeout: 15_000 });
    await expect(page.locator('#reader-flow')).toHaveValue('scrolled');
    await expect(page.locator('#page-text')).toContainText('滚动阅读');
    await expect.poll(async () => page.locator('#toolbar-chapter').textContent()).toBe(chapterBefore);
  });
});
