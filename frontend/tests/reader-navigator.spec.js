import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'multichapter.epub');

async function openFixture(page) {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', FIXTURE);
  await expect(page.locator('#toolbar-book-title')).toContainText(/multichapter/i, { timeout: 15_000 });
}

async function openNavigator(page) {
  if (await page.locator('#reader-tool-panel').isHidden()) {
    await page.locator('#btn-reader-tools').click();
  }
  await page.locator('#btn-toggle-navigator').click();
  await expect(page.locator('#reader-navigator')).toBeVisible();
}

test.describe('reader navigator', () => {
  test.use({ serviceWorkers: 'block' });

  test('lists chapters, jumps on click, and marks the active one', async ({ page }) => {
    await openFixture(page);
    await openNavigator(page);
    const items = page.locator('#toc-list .toc-item');
    await expect(items.first()).toBeVisible();
    const count = await items.count();
    expect(count).toBeGreaterThan(1);
    await items.nth(count - 1).click();
    await expect(page.locator('#toc-list .toc-item.active')).toHaveCount(1);
    await expect(page.locator('#page-text')).toHaveText(/第\s*\d+\s*\/\s*\d+\s*页/);
  });

  test('keeps bookmarks in the navigator and out of the notes panel', async ({ page }) => {
    await openFixture(page);
    // Open the reader tool panel first so the bookmark button is visible
    if (await page.locator('#reader-tool-panel').isHidden()) {
      await page.locator('#btn-reader-tools').click();
    }
    await page.locator('#btn-add-bookmark').click();
    await openNavigator(page);
    await expect(page.locator('#reader-navigator #bookmarks-list')).toBeVisible();
    await expect(page.locator('#reader-navigator #bookmarks-list .bookmark-item')).toHaveCount(1);
    // Opening the navigator closes the tool panel; reopen it to access the notes toggle
    if (await page.locator('#reader-tool-panel').isHidden()) {
      await page.locator('#btn-reader-tools').click();
    }
    await page.locator('#btn-toggle-notes').click();
    await expect(page.locator('#notes-panel #bookmarks-list')).toHaveCount(0);
  });
});
