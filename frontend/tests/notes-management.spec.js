import { test, expect } from '@playwright/test';
import {
  INDEXED_DB_NAME,
  INDEXED_DB_VERSION,
  installNotesApiRoutes,
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

  test('creation route upgrades IndexedDB to v6 without deleting old stores', async ({ page }) => {
    await installNotesApiRoutes(page, { notes: [] });
    await page.goto('/manifest.json');
    await page.evaluate(databaseName => new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(databaseName);
      deleteRequest.onerror = () => reject(deleteRequest.error);
      deleteRequest.onsuccess = () => {
        const openRequest = indexedDB.open(databaseName, 5);
        openRequest.onupgradeneeded = () => {
          const database = openRequest.result;
          database.createObjectStore('legacy_notes', { keyPath: 'id' }).put({ id: 'legacy-1' });
        };
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
          openRequest.result.close();
          resolve();
        };
      };
    }), INDEXED_DB_NAME);

    await page.goto('/#/creation');
    const databaseState = await page.evaluate(databaseName => new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const state = {
          version: database.version,
          stores: Array.from(database.objectStoreNames),
        };
        database.close();
        resolve(state);
      };
    }), INDEXED_DB_NAME);

    expect(databaseState.version).toBe(INDEXED_DB_VERSION);
    expect(databaseState.stores).toEqual(expect.arrayContaining([
      'legacy_notes',
      'books',
      'highlights',
      'deleted_highlights',
      'bookmarks',
      'sync_queue',
    ]));
  });
});
