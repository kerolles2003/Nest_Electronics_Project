/**
 * Runs one expression in the page and prints the result.
 *
 * A throwaway lens for the QA pass: when a measurement disagrees with the CSS,
 * the fastest way to settle it is to ask the browser rather than to reason
 * about the cascade.
 *
 *   MSYS_NO_PATHCONV=1 node e2e/qa/probe.mjs / 390 "document.title"
 */

import { chromium } from '@playwright/test';
import { servePlaceholderMedia } from './placeholder-media.mjs';

const BASE = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3200';
const [, , path = '/', width = '390', ...rest] = process.argv;
const expression = rest.join(' ');

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: Number(width), height: 800 },
  isMobile: Number(width) < 700,
  hasTouch: Number(width) < 700,
});
await servePlaceholderMedia(context);
const page = await context.newPage();
await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

const result = await page.evaluate(`(() => { ${expression} })()`);
process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);

await browser.close();
