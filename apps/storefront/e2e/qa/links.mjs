/**
 * Every internal link the storefront renders, and whether it resolves.
 *
 * Crawls the customer-facing routes, collects every same-origin `href`, and
 * asks the server for each one. A link to a route that was deleted is a dead
 * end a customer finds by tapping it, and nothing in the suite was looking.
 *
 *   MSYS_NO_PATHCONV=1 node e2e/qa/links.mjs
 */

import { chromium } from '@playwright/test';
import { servePlaceholderMedia } from './placeholder-media.mjs';

const BASE = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3200';

/** Where the links are gathered from — chrome plus one page of each shape. */
const PAGES = [
  '/',
  '/products',
  '/products/esp32-devkit-v1',
  '/categories',
  '/categories/microcontrollers',
  '/brands/espressif',
  '/search?q=sensor',
  '/cart',
  '/login',
  '/register',
  '/forgot-password',
  '/blog',
  '/contact',
  '/wishlist',
  '/this-route-does-not-exist',
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await servePlaceholderMedia(context);
const page = await context.newPage();

/** href -> the pages that link to it. */
const links = new Map();

for (const path of PAGES) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href'))
      .filter((h) => h !== null && h.startsWith('/')),
  );

  for (const href of hrefs) {
    // The query string is the page's business; the ROUTE is what can 404.
    const route = href.split('#')[0];
    if (!links.has(route)) links.set(route, new Set());
    links.get(route).add(path);
  }
}

process.stdout.write(`${links.size} distinct internal links across ${PAGES.length} pages\n\n`);

const broken = [];

for (const [href, sources] of [...links].sort()) {
  const response = await page.request.get(`${BASE}${href}`, { maxRedirects: 0 });
  const status = response.status();
  const location = response.headers()['location'] ?? '';

  if (status >= 400) {
    broken.push({ href, status, sources: [...sources] });
  } else if (status >= 300) {
    process.stdout.write(`  ${status} ${href} -> ${location}\n`);
  }
}

process.stdout.write(`\n${broken.length} broken:\n`);
for (const b of broken) {
  process.stdout.write(`  ${b.status} ${b.href}\n        linked from: ${b.sources.join(', ')}\n`);
}

await browser.close();
