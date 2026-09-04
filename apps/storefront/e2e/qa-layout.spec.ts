import { test, expect } from './fixtures/browser-health';
import type { Page } from '@playwright/test';

/**
 * The layout defects the first QA pass found, turned into assertions.
 *
 * ## Why these and not "visual regression"
 *
 * Because a screenshot diff fails on every intended change and eventually gets
 * approved without being read. Each of these is a specific, binary property
 * that was FALSE on a shipped page and that a person had to open a browser to
 * discover. A bug a test can catch should not be caught by eye twice.
 *
 * Every one of them was a real defect in this repository, not a hypothetical:
 *
 *   · the body scrolled sideways on six routes, by up to 90px at 360px
 *   · `packages/ui` was not a Tailwind source, so 135 of its classes emitted
 *     no CSS at all
 *   · every product image rendered at `opacity: 0`
 *   · six links in the site chrome were 404s, on every page
 *   · the catalogue had no `<h1>`
 *   · eleven controls in the closed mobile drawer were keyboard-focusable
 *
 * ## 360 and 390
 *
 * This is an Egyptian consumer store. The small phone is the primary case, and
 * 360 is where everything that overflowed overflowed worst.
 */

/** The customer-facing routes, including the two shapes that broke. */
const ROUTES = [
  '/',
  '/products',
  '/products?sort=price_asc',
  '/products/esp32-devkit-v1',
  '/products/usb-logic-analyser-8-channel',
  '/categories',
  '/categories/microcontrollers',
  '/brands/espressif',
  '/search?q=sensor',
  '/cart',
  '/login',
  '/register',
  '/forgot-password',
  '/wishlist',
  '/contact',
];

const PHONE = { width: 360, height: 780 };

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle').catch(() => {
    /* A page that never idles is still measurable. */
  });
  await page.evaluate(() => document.fonts.ready);
}

test.describe('the page fits the phone it is being read on', () => {
  test('no route scrolls the body sideways at 360px', async ({ page }) => {
    await page.setViewportSize(PHONE);

    const wide: string[] = [];

    for (const route of ROUTES) {
      await page.goto(route);
      await settle(page);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      // One pixel of slack for sub-pixel rounding; the real failures were 14
      // to 90 pixels, so nothing marginal is being waved through.
      if (scrollWidth > clientWidth + 1) {
        wide.push(`${route}: ${String(scrollWidth)} > ${String(clientWidth)}`);
      }
    }

    expect(
      wide,
      'These routes are wider than the screen. A body that scrolls sideways also\n' +
        'drags every `position: fixed` bar with it, so the mobile navigation goes\n' +
        'off-screen too. Run `node e2e/qa/overflow.mjs <route> 360` to see which\n' +
        'element is past the edge.',
    ).toEqual([]);
  });
});

test.describe('the document has the landmarks it claims', () => {
  test('exactly one <main> and exactly one <h1> on every route', async ({ page }) => {
    /*
     * Fifteen routes, each of which may be a COLD Turbopack compile.
     *
     * The default 90s is a budget for a test, not for fifteen first-visits to a
     * dev server, and this one exceeded it on `/forgot-password` — thirteenth
     * in the list — while the same assertions passed comfortably with more
     * room. A timeout that depends on how warm the dev server happens to be is
     * a red that means nothing, and a red that means nothing is the thing this
     * whole file argues against.
     */
    test.setTimeout(240_000);

    const wrong: string[] = [];

    for (const route of ROUTES) {
      await page.goto(route);
      await settle(page);

      const counts = await page.evaluate(() => ({
        mains: document.querySelectorAll('main').length,
        h1s: document.querySelectorAll('h1').length,
      }));

      if (counts.mains !== 1) wrong.push(`${route}: ${String(counts.mains)} <main>`);
      if (counts.h1s !== 1) wrong.push(`${route}: ${String(counts.h1s)} <h1>`);
    }

    expect(
      wrong,
      'The root layout owns the only <main>; a page that adds its own gives\n' +
        'assistive technology two "main content" landmarks and no way to choose.\n' +
        'A route with no <h1> is untitled in a heading list and to a crawler —\n' +
        'which is what /products was.',
    ).toEqual([]);
  });
});

test.describe('the chrome does not link to pages that do not exist', () => {
  test('every internal link in the header, footer and body resolves', async ({ page, request }) => {
    /*
     * Six of these were 404s — `/about`, `/brands`, `/faq`, `/returns`,
     * `/shipping`, `/vendors` — and because they live in the header and footer
     * they were on every page of the site. `/shipping` and `/returns` are
     * exactly what a first-time cash-on-delivery customer looks for.
     */
    const hrefs = new Set<string>();

    for (const route of ['/', '/products', '/products/esp32-devkit-v1', '/cart', '/login']) {
      await page.goto(route);
      await settle(page);

      const found = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map((a) => a.getAttribute('href') ?? '')
          .filter((href) => href.startsWith('/')),
      );

      for (const href of found) hrefs.add(href.split('#')[0] ?? href);
    }

    expect(hrefs.size).toBeGreaterThan(20);

    const broken: string[] = [];

    for (const href of [...hrefs].sort()) {
      // `maxRedirects: 0` so an auth redirect reads as the 307 it is rather
      // than as whatever the login page happens to return.
      const response = await request.get(href, { maxRedirects: 0 });

      if (response.status() >= 400) broken.push(`${String(response.status())} ${href}`);
    }

    expect(broken, 'Linked from the site chrome and not a page.').toEqual([]);
  });
});

test.describe('the shared component library is styled', () => {
  test('a class used only in packages/ui produces a rule', async ({ page }) => {
    /*
     * Tailwind v4 detects its sources automatically and excludes
     * `node_modules`. `@nest/ui` is reached through a workspace symlink inside
     * it, so 135 utilities used only there produced no CSS: the sale badge's
     * background (white text on transparent), the gold star fill, the toast's
     * width and z-index, the dialog's centring, `sr-only`. The classes the
     * storefront also used were emitted, so the library was styled in patches
     * and looked like a design rather than a build failure.
     *
     * `globals.css` names the package with `@source`. This asserts the result
     * rather than the directive, because the directive being present is not the
     * same as it resolving.
     */
    await page.goto('/products');
    await settle(page);

    const sheets = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map(
        (link) => link.href,
      ),
    );

    expect(sheets.length).toBeGreaterThan(0);

    let css = '';
    for (const href of sheets) {
      const response = await page.request.get(href);
      css += await response.text();
    }

    /*
     * Chosen because each appears in `packages/ui/src` and NOWHERE in
     * `apps/storefront/src`, so each is only in the stylesheet if the package
     * itself was scanned. If one of them is later used in the app too it stops
     * proving anything — hence three, from three different files.
     */
    const uiOnly = [
      String.raw`.bg-\[\#E14A5C\]`, // product-card.tsx — the sale badge
      String.raw`.min-h-\[38px\]`, // product-card.tsx — two lines of title
      String.raw`.z-\[9999\]`, // toast.tsx — above everything
    ];

    const absent = uiOnly.filter((selector) => !css.includes(selector));

    expect(
      absent,
      'These classes exist in packages/ui/src and produced no CSS, which means\n' +
        'Tailwind is not scanning that package. Check the `@source` line at the\n' +
        'top of src/app/globals.css.',
    ).toEqual([]);
  });
});

test.describe('product images are visible, not merely loaded', () => {
  test('no image on a catalogue page is left at zero opacity', async ({ page }) => {
    /*
     * `ProductCard` fades its image in on `onLoad`. The card is
     * server-rendered, so the browser usually finishes the fetch before React
     * hydrates: the event has already fired, the state never flips, and the
     * image sits at `opacity-0` forever. Twelve of twenty-one images on the
     * home page were in that state — complete, decoded, laid out, invisible —
     * and the faster the connection the more certain it is.
     *
     * This can only be asserted because the suite now makes product images
     * resolve (see `playwright.config.ts` and the browser-health fixture).
     */
    for (const route of ['/', '/products']) {
      await page.goto(route);
      await settle(page);

      const images = await page.evaluate(() =>
        Array.from(document.querySelectorAll('img')).map((img) => ({
          src: img.currentSrc || img.src,
          complete: img.complete,
          natural: img.naturalWidth,
          opacity: Number(getComputedStyle(img).opacity),
        })),
      );

      const loaded = images.filter((img) => img.complete && img.natural > 0);

      expect(loaded.length, `${route} rendered no images at all`).toBeGreaterThan(0);

      const invisible = loaded.filter((img) => img.opacity === 0).map((img) => img.src);

      expect(
        invisible,
        `${route}: these images loaded successfully and are drawn at opacity 0.`,
      ).toEqual([]);
    }
  });
});

test.describe('the closed mobile menu is closed', () => {
  test('holds no keyboard-focusable control while off-screen', async ({ page }) => {
    /*
     * The drawer is always in the DOM and merely translated off-screen. With no
     * `inert`, its eleven links and buttons stayed in the tab order on every
     * page: a keyboard user tabbing from the logo fell into an invisible menu,
     * and a screen reader read out a navigation that was not on screen.
     *
     * ## This test used to assert the wrong thing, and could never have passed
     *
     * It counted `drawer.querySelectorAll('a[href], button, …')` and expected
     * zero. `inert` does not remove elements from the DOM — it removes them
     * from the tab order and the accessibility tree — so that count is ten
     * whether the fix is present or not, and the test failed against **correct**
     * code. It read as an unfixed defect for as long as it sat there, which is
     * the worse half: a permanently red test trains people to skip the colour.
     *
     * Tabbing is what the finding was actually about, so tabbing is what is
     * asserted. Focus is walked from the top of the document and must never
     * land inside the drawer. That fails without `inert` — there is nothing
     * else stopping it — and passes with it, which is the property a guard has
     * to have.
     */
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await settle(page);

    const DRAWER = 'div[role="dialog"][aria-label="Menu"]';

    // The premise. If the drawer is not there, or is not off-screen, every
    // assertion below is vacuously true and the test is worthless.
    await expect(page.locator(DRAWER)).toHaveCount(1);

    const offScreen = await page.locator(DRAWER).evaluate((el) => el.getBoundingClientRect().right <= 0);
    expect(offScreen, 'The drawer is not off-screen; is it open, or has its markup changed?').toBe(true);

    const controls = await page.locator(`${DRAWER} a[href], ${DRAWER} button`).count();
    expect(controls, 'The drawer holds no controls, so nothing here is being tested.').toBeGreaterThan(5);

    /*
     * Forty is comfortably more than the page's own focusable count and far
     * more than the drawer's ten, so if `inert` were removed the walk would
     * reach them well inside the budget.
     */
    await page.locator('body').press('Tab');

    const landed: string[] = [];

    for (let step = 0; step < 40; step += 1) {
      const where = await page.evaluate((selector) => {
        const active = document.activeElement;
        if (active === null || active === document.body) return null;

        const drawer = document.querySelector(selector);
        if (drawer !== null && drawer.contains(active)) {
          return `${active.tagName.toLowerCase()}: ${(active.textContent ?? '').trim().slice(0, 40)}`;
        }

        return null;
      }, DRAWER);

      if (where !== null) landed.push(where);

      await page.keyboard.press('Tab');
    }

    expect(
      landed,
      [
        'Tab reached a control inside the closed drawer. `inert` removes it from',
        'the tab order and the accessibility tree in one attribute, and is what',
        'the drawer uses when `isOpen` is false.',
      ].join('\n'),
    ).toEqual([]);
  });
});

test.describe('the controls are big enough to hit with a thumb', () => {
  test('every header and bottom-bar control is at least 44px', async ({ page }) => {
    /*
     * DESIGN.md 8: "Minimum tap area: 44px x 44px (all buttons, interactive
     * elements)". The header's cart, account and wishlist buttons — the three
     * most-used controls on a phone — were 32x28.
     *
     * Scoped to the two persistent bars rather than to every link on the page:
     * an inline text link inside a paragraph is not a tap target in the sense
     * the rule is about, and asserting otherwise would make this test noise.
     */
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await settle(page);

    const small = await page.evaluate(() => {
      const bars = ['header', 'nav[aria-label="Mobile navigation"]'];
      const out: { where: string; label: string; size: string }[] = [];

      for (const selector of bars) {
        const bar = document.querySelector(selector);
        if (bar === null) continue;

        for (const el of Array.from(bar.querySelectorAll('a[href], button'))) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (getComputedStyle(el).visibility === 'hidden') continue;
          // Inside the off-screen drawer, which is `inert` and untappable.
          if (rect.right <= 0) continue;

          if (rect.width < 44 || rect.height < 44) {
            out.push({
              where: selector,
              label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30),
              size: `${String(Math.round(rect.width))}x${String(Math.round(rect.height))}`,
            });
          }
        }
      }

      return out;
    });

    expect(small, 'DESIGN.md 8 requires 44x44 for every interactive element.').toEqual([]);
  });
});
