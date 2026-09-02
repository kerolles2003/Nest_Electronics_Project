/**
 * Takes the storefront's picture, at the widths customers actually hold.
 *
 * ## Why a script and not a spec
 *
 * Because its output is images for a person to look at, not assertions. Putting
 * it in `e2e/` as a spec would add minutes to a suite whose value is that it
 * fails; this produces evidence, and evidence is judged by eye. The assertable
 * findings it leads to become real specs in `e2e/` — see `qa-layout.spec.ts`.
 *
 * ## Running it
 *
 *   pnpm --filter api media:placeholders        # once, needs a seeded database
 *   node e2e/qa/screenshot.mjs                  # needs both servers up
 *
 * The storefront must be started with `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` set
 * (any value) or every product renders its letter fallback and the layout is
 * judged against boxes rather than photographs:
 *
 *   API_BASE_URL=http://127.0.0.1:3002/api/v1 DEV_ORIGIN_HOST=127.0.0.1 \
 *   NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=dev-placeholders \
 *   pnpm exec next dev --hostname 127.0.0.1 --port 3200
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { servePlaceholderMedia } from './placeholder-media.mjs';

const BASE = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3200';
const OUT = process.env.QA_OUT ?? join(process.cwd(), 'qa-shots');

/**
 * 360 and 390 first, and deliberately: this is an Egyptian consumer store, so
 * the small phone is the primary case. 360 is the Android median, 390 the
 * modern iPhone, 768 the tablet break, 1024 the small laptop, 1440 the desk.
 */
const WIDTHS = [360, 390, 768, 1024, 1440];

export const VIEWPORTS = WIDTHS.map((width) => ({
  name: String(width),
  width,
  height: width < 700 ? 780 : width < 1100 ? 900 : 900,
  isMobile: width < 700,
}));

/**
 * Next's dev-mode indicator, hidden.
 *
 * It is a floating button the dev server injects and production never serves,
 * and it sits exactly where a mobile bottom bar sits — so leaving it in would
 * put a fake overlap in every phone screenshot and hide a real one.
 */
const HIDE_DEV_OVERLAY = 'nextjs-portal, [data-nextjs-toast] { display: none !important; }';

/** Waits for the page to stop moving, without pinning a fixed sleep. */
async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch {
    /* A page with a long-poll or a retry never idles; the shot is still valid. */
  }
  // Fonts decide final line-breaking, and line-breaking is most of what a
  // responsive bug looks like.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

/**
 * Everything measurable about how the page sits in the viewport.
 *
 * Collected alongside the picture because some defects are easier to read as a
 * number than to see: 3 px of horizontal overflow is invisible in a screenshot
 * and is a body that scrolls sideways on a phone.
 */
export function measurePage() {
  const doc = document.documentElement;
  const overflowing = [];

  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right > doc.clientWidth + 1 || rect.left < -1) {
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.visibility === 'hidden') continue;
      overflowing.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 90),
        text: (el.textContent ?? '').trim().slice(0, 50),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      });
    }
  }

  // Interactive things smaller than the 44px the design system requires.
  const small = [];
  const interactive = 'a[href], button, input, select, textarea, [role="button"], [tabindex]';
  for (const el of Array.from(document.querySelectorAll(interactive))) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    if (rect.height < 44 || rect.width < 44) {
      small.push({
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      });
    }
  }

  return {
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    bodyScrollsSideways: doc.scrollWidth > doc.clientWidth + 1,
    mains: document.querySelectorAll('main').length,
    h1s: Array.from(document.querySelectorAll('h1')).map((h) => (h.textContent ?? '').trim().slice(0, 60)),
    imagesWithoutAlt: Array.from(document.querySelectorAll('img')).filter(
      (img) => img.getAttribute('alt') === null,
    ).length,
    imagesBroken: Array.from(document.querySelectorAll('img')).filter(
      (img) => img.complete && img.naturalWidth === 0,
    ).length,
    imagesInvisible: Array.from(document.querySelectorAll('img')).filter(
      (img) => Number(getComputedStyle(img).opacity) === 0,
    ).length,
    overflowing: overflowing.slice(0, 12),
    smallTargets: small.slice(0, 25),
    smallTargetCount: small.length,
    title: document.title,
  };
}

/** The customer-facing surface. `setup` runs before the shot when one is given. */
const SCREENS = [
  { id: 'home', path: '/' },
  { id: 'products', path: '/products' },
  { id: 'products-page2', path: '/products?page=2' },
  { id: 'products-empty', path: '/products?minPrice=99999900' },
  { id: 'products-one', path: '/products?search=UT61E' },
  { id: 'product-detail', path: '/products/esp32-devkit-v1' },
  { id: 'product-noimage', path: '/products/usb-logic-analyser-8-channel' },
  { id: 'product-oos', path: '/products/raspberry-pi-4-model-b-4gb' },
  { id: 'categories', path: '/categories' },
  { id: 'category', path: '/categories/microcontrollers' },
  { id: 'brand', path: '/brands/espressif' },
  { id: 'search-results', path: '/search?q=sensor' },
  { id: 'search-empty', path: '/search?q=zzzznothing' },
  { id: 'cart-empty', path: '/cart' },
  { id: 'login', path: '/login' },
  { id: 'register', path: '/register' },
  { id: 'forgot-password', path: '/forgot-password' },
  { id: 'verify-email', path: '/verify-email' },
  { id: 'not-found', path: '/this-route-does-not-exist' },
  { id: 'blog', path: '/blog' },
  { id: 'contact', path: '/contact' },
  { id: 'wishlist-empty', path: '/wishlist' },
  { id: 'checkout-signedout', path: '/checkout' },
  { id: 'account-signedout', path: '/account' },
];

/**
 * The screens behind sign-in, shot in a second context.
 *
 * The sandbox account is seeded with a real placed order and two addresses —
 * one in Cairo and one outside it — so order history, order detail and the
 * checkout quote all have something to render. Without it these five screens
 * are the sign-in page five times.
 */
const SIGNED_IN = [
  { id: 'account', path: '/account' },
  { id: 'account-orders', path: '/account/orders' },
  { id: 'account-addresses', path: '/account/addresses' },
  { id: 'account-profile', path: '/account/profile' },
  { id: 'checkout', path: '/checkout' },
  { id: 'cart-full', path: '/cart' },
];

const SANDBOX = {
  email: process.env.QA_EMAIL ?? 'sandbox@nest-electronics.test',
  password: process.env.QA_PASSWORD ?? 'brass thermionic valve',
};

/** Signs in through the real form, so the session is a real session. */
async function signIn(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', SANDBOX.email);
  await page.fill('input[name="password"]', SANDBOX.password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.close();
}

async function shoot(context, screen, viewport, report) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message.slice(0, 200)}`));

  const url = `${BASE}${screen.path}`;
  let status = 0;

  try {
    const response = await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });
    status = response?.status() ?? 0;
    await settle(page);
    // After the first settle: with `waitUntil: 'commit'` a slow route can have
    // no <head> yet, and injecting into one that does not exist throws.
    await page.addStyleTag({ content: HIDE_DEV_OVERLAY }).catch(() => {});
    if (screen.setup) await screen.setup(page);
    await settle(page);

    const metrics = await page.evaluate(measurePage);
    const file = join(OUT, `${screen.id}@${viewport.name}.png`);
    await page.screenshot({ path: file, fullPage: true });

    report.push({ screen: screen.id, width: viewport.width, url, status, ...metrics, consoleErrors });
    process.stdout.write(
      `  ${screen.id}@${viewport.name} ${status} ` +
        `${metrics.bodyScrollsSideways ? `OVERFLOW ${metrics.scrollWidth}>${metrics.clientWidth} ` : ''}` +
        `${metrics.mains !== 1 ? `MAINS=${metrics.mains} ` : ''}` +
        `${metrics.h1s.length !== 1 ? `H1s=${metrics.h1s.length} ` : ''}` +
        `${metrics.imagesBroken > 0 ? `BROKENIMG=${metrics.imagesBroken} ` : ''}` +
        `${consoleErrors.length > 0 ? `ERR=${consoleErrors.length}` : ''}\n`,
    );
  } catch (error) {
    report.push({ screen: screen.id, width: viewport.width, url, status, failed: String(error).slice(0, 300) });
    process.stdout.write(`  ${screen.id}@${viewport.name} FAILED ${String(error).slice(0, 120)}\n`);
  } finally {
    await page.close();
  }
}

async function main() {
  const only = process.argv.slice(2);
  const screens = only.length > 0 ? SCREENS.filter((s) => only.includes(s.id)) : SCREENS;
  const widths = process.env.QA_WIDTHS
    ? VIEWPORTS.filter((v) => process.env.QA_WIDTHS.split(',').includes(v.name))
    : VIEWPORTS;

  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const report = [];

  for (const viewport of widths) {
    process.stdout.write(`\n== ${viewport.width}px ==\n`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
      deviceScaleFactor: 1,
    });
    await servePlaceholderMedia(context);

    for (const screen of screens) {
      await shoot(context, screen, viewport, report);
    }

    await context.close();

    if (process.env.QA_SKIP_AUTH === undefined && only.length === 0) {
      const authed = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.isMobile,
        deviceScaleFactor: 1,
      });
      await servePlaceholderMedia(authed);

      try {
        await signIn(authed);
        for (const screen of SIGNED_IN) {
          await shoot(authed, screen, viewport, report);
        }
      } catch (error) {
        process.stdout.write(`  sign-in FAILED: ${String(error).slice(0, 160)}\n`);
      }

      await authed.close();
    }
  }

  await browser.close();
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`\n${report.length} shots in ${OUT}\n`);
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
