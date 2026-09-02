/**
 * Finds what makes the body scroll sideways, rather than reporting that it does.
 *
 * The naive version — "list every element wider than the viewport" — names
 * hundreds of innocent ancestors and misses the culprit, because an overflowing
 * child makes every block above it report the same width. This walks down from
 * the body and stops at the SHALLOWEST element that overflows on its own,
 * which is the one whose CSS is wrong.
 *
 *   node e2e/qa/overflow.mjs /  360
 */

import { chromium } from '@playwright/test';
import { servePlaceholderMedia } from './placeholder-media.mjs';

const BASE = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3200';
const [, , path = '/', width = '390'] = process.argv;

export function findOverflow() {
  const limit = document.documentElement.clientWidth;
  const culprits = [];

  const describe = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      position: style.position,
      overflowX: style.overflowX,
      text: (el.textContent ?? '').trim().slice(0, 60),
      path: (() => {
        const parts = [];
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          parts.unshift(
            n.tagName.toLowerCase() +
              (typeof n.className === 'string' && n.className
                ? `.${n.className.trim().split(/\s+/).slice(0, 2).join('.')}`
                : ''),
          );
        }
        return parts.slice(-6).join(' > ');
      })(),
    };
  };

  // An element inside a scroll container of its own is that container's
  // business, not the page's — a horizontally scrollable strip is a design,
  // not a bug.
  const scrolls = (el) => {
    const ox = getComputedStyle(el).overflowX;
    return ox === 'auto' || ox === 'scroll' || ox === 'hidden';
  };

  const walk = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);

    if (style.position === 'fixed' || style.display === 'none' || style.visibility === 'hidden') return;
    if (rect.width === 0 || rect.height === 0) return;

    // Only rightward overflow can extend the scroll area in a left-to-right
    // document; content at a negative x is simply clipped.
    if (rect.right <= limit + 1) return;

    const children = Array.from(el.children).filter((child) => {
      const r = child.getBoundingClientRect();
      const s = getComputedStyle(child);
      return s.position !== 'fixed' && r.right > limit + 1 && r.width > 0 && r.height > 0;
    });

    if (children.length === 0 || scrolls(el)) {
      culprits.push(describe(el));
      return;
    }

    children.forEach(walk);
  };

  Array.from(document.body.children).forEach(walk);

  /*
   * A second, blunter pass that includes fixed elements.
   *
   * The walk above deliberately skips `position: fixed`, because a fixed
   * element is out of flow and normally cannot lengthen the document. Chrome
   * disagrees when the fixed element is itself wider than the viewport, so a
   * page can scroll sideways with the walk finding nothing at all. When that
   * happens, this is the list that names it.
   */
  const anything = [];
  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right <= limit + 1) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    anything.push(describe(el));
  }

  return {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: limit,
    culprits: culprits.slice(0, 20),
    anything: anything.slice(0, 20),
  };
}

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
await page.waitForTimeout(400);

const result = await page.evaluate(findOverflow);
process.stdout.write(`${path} @ ${width}px — scrollWidth ${result.scrollWidth}, viewport ${result.clientWidth}\n\n`);
if (result.culprits.length === 0 && result.anything.length > 0) {
  process.stdout.write('  (nothing in flow — below is everything past the edge, fixed included)\n\n');
}

for (const c of result.culprits.length > 0 ? result.culprits : result.anything) {
  process.stdout.write(
    `  <${c.tag}${c.id ? `#${c.id}` : ''}> right=${c.right} width=${c.width} ` +
      `pos=${c.position} overflow-x=${c.overflowX}\n    class: ${c.cls}\n` +
      `    path:  ${c.path}\n    text:  ${c.text}\n\n`,
  );
}

await browser.close();
