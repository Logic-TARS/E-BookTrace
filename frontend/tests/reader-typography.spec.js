import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'multichapter.epub');
const TYPOGRAPHY_KEY = 'marginalia.readerTypography';

async function openFixture(page) {
  await page.goto('/index.html');
  await page.evaluate(key => localStorage.removeItem(key), TYPOGRAPHY_KEY);
  await page.reload();
  await page.setInputFiles('#file-input', FIXTURE);
  await expect(page.locator('#toolbar-book-title')).toContainText(/multichapter/i, { timeout: 15_000 });
  await expect(page.locator('#page-text')).toHaveText(/第\s*\d+\s*\/\s*\d+\s*页/, { timeout: 15_000 });
}

async function revealTools(page) {
  const reveal = page.locator('#btn-reveal-reader-chrome');
  if (await reveal.isVisible()) await reveal.click();
  if (await page.locator('#reader-tool-panel').isHidden()) {
    await page.locator('#btn-reader-tools').click();
  }
  await expect(page.locator('#reader-tool-panel')).toBeVisible();
}

async function getReaderTypography(page) {
  return page.locator('#epub-container').evaluate((host) => {
    const iframe = Array.from(host.querySelectorAll('iframe')).find(item => item.contentDocument?.body);
    if (!iframe) return null;
    const doc = iframe.contentDocument;
    const paragraph = doc.querySelector('p');
    const paragraphStyle = paragraph ? getComputedStyle(paragraph) : null;
    const style = doc.getElementById('marginalia-reader-typography-style');
    const selectionStyle = doc.getElementById('marginalia-selection-style');
    return {
      family: doc.documentElement.getAttribute('data-marginalia-reader-font'),
      fontSize: parseFloat(getComputedStyle(doc.body).fontSize),
      lineHeight: paragraphStyle ? parseFloat(paragraphStyle.lineHeight) / parseFloat(paragraphStyle.fontSize) : 0,
      paragraphMarginTop: paragraphStyle ? paragraphStyle.marginTop : '',
      paragraphMarginBottom: paragraphStyle ? paragraphStyle.marginBottom : '',
      styleText: style?.textContent || '',
      selectionStyleText: selectionStyle?.textContent || '',
    };
  });
}

async function getVisibleParagraphs(page) {
  return page.locator('#epub-container').evaluate((host) => {
    const iframe = Array.from(host.querySelectorAll('iframe')).find(item => item.contentDocument?.body);
    if (!iframe) return [];
    const doc = iframe.contentDocument;
    const width = doc.documentElement.clientWidth;
    const height = doc.documentElement.clientHeight;
    return Array.from(doc.querySelectorAll('p'))
      .filter((paragraph) => {
        const rect = paragraph.getBoundingClientRect();
        return rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < height;
      })
      .map(paragraph => (paragraph.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80))
      .filter(Boolean);
  });
}

test.describe('reader typography settings', () => {
  test.use({ serviceWorkers: 'block' });

  test('opens the tool panel without filtering or shifting the reading canvas', async ({ page }) => {
    await openFixture(page);
    const host = page.locator('#epub-container');
    const before = await host.boundingBox();

    await revealTools(page);
    await expect(page.locator('#reader-tool-panel')).toHaveCSS('backdrop-filter', 'none');
    const open = await host.boundingBox();

    await page.locator('#btn-reader-tools').click();
    await expect(page.locator('#reader-tool-panel')).toBeHidden();
    const closed = await host.boundingBox();

    expect(open).toEqual(before);
    expect(closed).toEqual(before);
  });

  test('applies typography, preserves the reading anchor, and restores preferences', async ({ page }) => {
    await openFixture(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(350);
    const chapterBefore = await page.locator('#toolbar-chapter').textContent();
    const visibleBefore = await getVisibleParagraphs(page);
    expect(visibleBefore.length).toBeGreaterThan(0);

    await revealTools(page);
    await expect(page.locator('#reader-font-family')).toHaveValue('original');
    await expect(page.locator('#reader-font-size')).toHaveValue('100');
    await expect(page.locator('#reader-font-size-value')).toHaveText('100%');
    await expect(page.locator('#reader-line-height')).toHaveValue('1.7');
    await expect(page.locator('#reader-line-height-value')).toHaveText('1.7');
    await expect(page.locator('#reader-paragraph-spacing')).toHaveValue('0.5');
    await expect(page.locator('#reader-paragraph-spacing-value')).toHaveText('0.5em');

    const initialTypography = await getReaderTypography(page);
    expect(initialTypography).not.toBeNull();
    expect(initialTypography.lineHeight).toBeCloseTo(1.7, 1);
    expect(parseFloat(initialTypography.paragraphMarginTop) / initialTypography.fontSize).toBeCloseTo(0.5, 1);
    expect(parseFloat(initialTypography.paragraphMarginBottom) / initialTypography.fontSize).toBeCloseTo(0.5, 1);
    expect(initialTypography.selectionStyleText).not.toContain('line-height');

    await page.locator('#reader-font-family').selectOption('sans');
    await expect.poll(() => getReaderTypography(page)).toMatchObject({ family: 'sans' });
    await expect.poll(async () => (await getReaderTypography(page))?.styleText || '')
      .toContain('PingFang SC');

    await page.locator('#reader-font-size').fill('125');
    await page.locator('#reader-line-height').fill('2.1');
    await page.locator('#reader-paragraph-spacing').fill('1.2');
    await expect(page.locator('#reader-font-size-value')).toHaveText('125%');
    await expect(page.locator('#reader-line-height-value')).toHaveText('2.1');
    await expect(page.locator('#reader-paragraph-spacing-value')).toHaveText('1.2em');
    await page.waitForTimeout(900);
    const adjustedTypography = await getReaderTypography(page);
    expect(adjustedTypography.fontSize).toBeGreaterThan(initialTypography.fontSize);
    expect(adjustedTypography.lineHeight).toBeCloseTo(2.1, 1);
    expect(parseFloat(adjustedTypography.paragraphMarginTop) / adjustedTypography.fontSize).toBeCloseTo(1.2, 1);
    expect(parseFloat(adjustedTypography.paragraphMarginBottom) / adjustedTypography.fontSize).toBeCloseTo(1.2, 1);
    expect(await page.locator('#toolbar-chapter').textContent()).toBe(chapterBefore);
    const visibleAfter = await getVisibleParagraphs(page);
    expect(visibleAfter.some(text => visibleBefore.includes(text))).toBeTruthy();

    await page.locator('#btn-reader-font-reset').click();
    await page.locator('#btn-reader-line-height-reset').click();
    await page.locator('#btn-reader-paragraph-spacing-reset').click();
    await expect(page.locator('#reader-font-size-value')).toHaveText('100%');
    await expect(page.locator('#reader-line-height-value')).toHaveText('1.7');
    await expect(page.locator('#reader-paragraph-spacing-value')).toHaveText('0.5em');
    await page.locator('#reader-font-family').selectOption('original');
    await expect.poll(() => getReaderTypography(page)).toMatchObject({ family: null });
    await expect.poll(async () => (await getReaderTypography(page))?.lineHeight || 0).toBeCloseTo(1.7, 1);

    await page.locator('#reader-font-family').selectOption('kai');
    await page.locator('#reader-font-size').fill('130');
    await page.locator('#reader-line-height').fill('1.9');
    await page.locator('#reader-paragraph-spacing').fill('0.8');
    await page.locator('#epub-container').evaluate((host) => {
      const iframe = Array.from(host.querySelectorAll('iframe')).find(item => item.contentDocument?.body);
      iframe.contentDocument.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -100,
      }));
    });
    await expect(page.locator('#reader-font-size-value')).toHaveText('135%');
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), TYPOGRAPHY_KEY))
      .toEqual({ fontFamily: 'kai', fontSize: 135, lineHeight: 1.9, paragraphSpacing: 0.8 });

    await page.reload();
    // The current line's routing does not auto-reopen the last book; reopen it from the library.
    await expect(page.locator('#library-view')).toHaveClass(/active/, { timeout: 15_000 });
    await page.locator('.book-card', { hasText: /multichapter/i }).locator('.book-card-open').click();
    await expect(page.locator('#toolbar-book-title')).toContainText(/multichapter/i, { timeout: 15_000 });
    await expect(page.locator('#reader-font-family')).toHaveValue('kai');
    await expect(page.locator('#reader-font-size')).toHaveValue('135');
    await expect(page.locator('#reader-font-size-value')).toHaveText('135%');
    await expect(page.locator('#reader-line-height')).toHaveValue('1.9');
    await expect(page.locator('#reader-paragraph-spacing')).toHaveValue('0.8');
    await expect.poll(() => getReaderTypography(page)).toMatchObject({ family: 'kai' });
    await expect.poll(async () => (await getReaderTypography(page))?.lineHeight || 0).toBeCloseTo(1.9, 1);
  });

  test('supports shrinking and enlarging with Ctrl+wheel', async ({ page }) => {
    await openFixture(page);

    const wheelFontSize = async (deltaY, count = 1) => {
      await page.locator('#epub-container').evaluate((host, { delta, repeats }) => {
        const iframe = Array.from(host.querySelectorAll('iframe')).find(item => item.contentDocument?.body);
        for (let index = 0; index < repeats; index += 1) {
          iframe.contentDocument.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: delta,
          }));
        }
      }, { delta: deltaY, repeats: count });
    };

    await wheelFontSize(4, 3);
    await expect(page.locator('#reader-font-size-value')).toHaveText('95%');
    await page.waitForTimeout(700);
    await wheelFontSize(-4, 3);
    await expect(page.locator('#reader-font-size-value')).toHaveText('100%');
  });

  test('supports real Ctrl+mouse-wheel in both directions', async ({ page }) => {
    await openFixture(page);
    const cdp = await page.context().newCDPSession(page);

    const wheelOverReader = async (deltaY) => {
      const bounds = await page.locator('#epub-container').boundingBox();
      expect(bounds).not.toBeNull();
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
        deltaX: 0,
        deltaY,
        modifiers: 2,
        pointerType: 'mouse',
      });
    };

    await wheelOverReader(100);
    await expect(page.locator('#reader-font-size-value')).toHaveText('95%');
    await page.waitForTimeout(700);
    await wheelOverReader(-100);
    await expect(page.locator('#reader-font-size-value')).toHaveText('100%');
  });

  test('loads legacy font-only preferences with spacing defaults', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(key => {
      localStorage.setItem(key, JSON.stringify({ fontFamily: 'sans', fontSize: 120 }));
    }, TYPOGRAPHY_KEY);
    await page.reload();

    await expect(page.locator('#reader-font-family')).toHaveValue('sans');
    await expect(page.locator('#reader-font-size')).toHaveValue('120');
    await expect(page.locator('#reader-line-height')).toHaveValue('1.7');
    await expect(page.locator('#reader-paragraph-spacing')).toHaveValue('0.5');

    await page.setInputFiles('#file-input', FIXTURE);
    await expect(page.locator('#toolbar-book-title')).toContainText(/multichapter/i, { timeout: 15_000 });
    await expect.poll(() => getReaderTypography(page)).toMatchObject({ family: 'sans' });
    await expect.poll(async () => (await getReaderTypography(page))?.lineHeight || 0).toBeCloseTo(1.7, 1);
  });

  test('keeps typography controls inside all target viewport widths', async ({ page }) => {
    for (const width of [360, 390, 768, 1000, 1440]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
      await page.goto('/index.html');
      // Wait for the app to finish initializing before manually switching views.
      await expect(page.locator('#library-view')).toHaveClass(/active/, { timeout: 15_000 });
      await page.evaluate(() => {
        document.querySelector('#library-view').classList.remove('active');
        document.querySelector('#reader-view').classList.add('active');
        document.body.classList.add('reader-active');
      });
      await page.locator('#btn-reader-tools').click();
      const panel = page.locator('#reader-tool-panel');
      await expect(panel).toBeVisible();

      const metrics = await page.evaluate(() => ({
        viewport: window.innerWidth,
        root: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      expect(metrics.root).toBeLessThanOrEqual(metrics.viewport + 1);
      expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1);

      const panelBounds = await panel.boundingBox();
      expect(panelBounds).not.toBeNull();
      expect(panelBounds.x).toBeGreaterThanOrEqual(0);
      expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(width + 1);
      for (const selector of ['#reader-font-family', '#reader-font-size', '#reader-line-height', '#reader-paragraph-spacing']) {
        await expect(page.locator(selector)).toBeVisible();
        const bounds = await page.locator(selector).boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds.x).toBeGreaterThanOrEqual(panelBounds.x - 1);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(panelBounds.x + panelBounds.width + 1);
      }

      if (width <= 900) {
        for (const selector of [
          '#reader-font-family',
          '#btn-reader-font-decrease',
          '#btn-reader-font-reset',
          '#btn-reader-font-increase',
          '#btn-reader-line-height-reset',
          '#btn-reader-paragraph-spacing-reset',
        ]) {
          const bounds = await page.locator(selector).boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds.height).toBeGreaterThanOrEqual(44);
        }
      }
    }
  });
});
