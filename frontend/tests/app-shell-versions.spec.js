import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = join(__dirname, '..');

test.describe('app shell version invariant', () => {
  test('index.html and sw.js APP_SHELL agree on app.js/style.css versions; cache name is well-formed', () => {
    const indexHtml = readFileSync(join(FRONTEND_DIR, 'index.html'), 'utf8');
    const swJs = readFileSync(join(FRONTEND_DIR, 'sw.js'), 'utf8');

    // Collect every (app.js|style.css)?v=\d+ reference from index.html
    const indexVersions = new Set();
    for (const match of indexHtml.matchAll(/(app\.js|style\.css)\?v=(\d+)/g)) {
      indexVersions.add(`${match[1]}?v=${match[2]}`);
    }
    expect(indexVersions.size).toBeGreaterThan(0);

    // Collect every (app.js|style.css)?v=\d+ reference from sw.js APP_SHELL
    // (ignore the book-chat/* entries' own versions)
    const swVersions = new Set();
    for (const match of swJs.matchAll(/(?:^|\s)'((?:app\.js|style\.css)\?v=\d+)'/g)) {
      swVersions.add(match[1]);
    }

    // Every top-level version pin in index.html must be in sw.js APP_SHELL, and vice versa
    const missingFromSw = [...indexVersions].filter((v) => !swVersions.has(v));
    const missingFromIndex = [...swVersions].filter((v) => !indexVersions.has(v));
    expect(missingFromSw).toEqual([]);
    expect(missingFromIndex).toEqual([]);

    // Cache name must match /marginalia-shell-v\d+/
    const cacheMatch = swJs.match(/marginalia-shell-v(\d+)/);
    expect(cacheMatch).not.toBeNull();
    expect(cacheMatch[0]).toMatch(/^marginalia-shell-v\d+$/);
  });
});
