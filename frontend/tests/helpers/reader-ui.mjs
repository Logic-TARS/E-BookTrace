import { expect } from '@playwright/test';

export async function revealReaderChromeFor(page, targetSelector) {
  const target = page.locator(targetSelector);
  if (!(await target.isVisible())) {
    const reveal = page.locator('#btn-reveal-reader-chrome');
    await reveal.waitFor({ state: 'visible', timeout: 10_000 });
    await reveal.dispatchEvent('click');
  }
  await expect(target).toBeVisible();
}
