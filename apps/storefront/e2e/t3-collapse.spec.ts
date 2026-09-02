import { randomUUID } from 'node:crypto';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { expect, test } from './fixtures/browser-health';
import { E2E_EMAIL_PREFIX } from './global-teardown';

/**
 * The T3 collapse: `/shop` is gone, and the URLs it had still resolve.
 *
 * ## Why the redirects are tested rather than assumed
 *
 * `/shop/*` was live. It was linked from verification emails, order emails and
 * anything anybody bookmarked while it existed — and those emails are in
 * inboxes now, with tokens that are still valid. A redirect table is exactly
 * the kind of thing that looks right in a config file and silently sends
 * `/shop/orders/abc` to `/products/abc`, because the catch-all was listed
 * first.
 *
 * ## And why the landmark count is here
 *
 * F-12 was two nested `<main>` elements on every `/shop` page. Deleting the
 * slice removed one of them and revealed the other: `/account/*` had the same
 * defect, from a different layout. Counting the landmark is how neither comes
 * back.
 */

/** Every retired URL, and where it must land. */
const REDIRECTS: readonly [string, string][] = [
  ['/shop', '/products'],
  ['/shop/login', '/login'],
  ['/shop/register', '/register'],
  ['/shop/cart', '/cart'],
  ['/shop/checkout', '/checkout'],
  ['/shop/addresses', '/account/addresses'],
  ['/shop/orders', '/account/orders'],
  // The parameterised ones: the id and the slug must survive the move.
  ['/shop/orders/68b000000000000000000001', '/account/orders/68b000000000000000000001'],
  ['/shop/raspberry-pi-pico-2-w', '/products/raspberry-pi-pico-2-w'],
  ['/shop/verify-email', '/verify-email'],
];

test.describe('the /shop slice is gone', () => {
  test('every retired URL answers 301 and names its canonical destination', async ({ request }) => {
    for (const [from, to] of REDIRECTS) {
      const response = await request.get(`http://127.0.0.1:3100${from}`, {
        maxRedirects: 0,
      });

      expect(response.status(), `${from} should be a permanent redirect`).toBe(301);
      expect(response.headers()['location'], `${from} -> ${to}`).toBe(to);
    }
  });

  test('a product URL keeps its slug rather than being swallowed by the catch-all', async ({
    page,
  }) => {
    /*
     * The ordering hazard, walked for real. `/shop/:slug` matches `orders`,
     * `cart` and `login` too, so if it were listed before them every one of
     * those would land on a product page that does not exist.
     */
    await page.goto('/shop/raspberry-pi-pico-2-w');

    await expect(page).toHaveURL('/products/raspberry-pi-pico-2-w');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Raspberry Pi Pico 2 W');
  });

  test('the sitemap lists no /shop URL', async ({ page }) => {
    // F-03 was `/shop` being unreachable and absent from the sitemap. The
    // absence is now permanent rather than an omission, and this says so.
    const response = await page.goto('/sitemap.xml');
    const xml = (await response?.text()) ?? '';

    expect(xml.length).toBeGreaterThan(0);
    expect(xml).not.toContain('/shop');
  });
});

test.describe('exactly one main landmark — F-12', () => {
  /*
   * A page per layout, not a page per route: the defect lives in layouts, and
   * one page under each is what proves the layout.
   */
  const PAGES = [
    '/',
    '/products',
    '/categories',
    '/cart',
    '/login',
    '/contact',
    '/definitely-not-a-route',
  ];

  for (const path of PAGES) {
    test(`${path} has one <main>`, async ({ page, health }) => {
      // The 404 case logs the browser's own message for the 404 document.
      health.allowConsoleError(/Failed to load resource.*404/);

      await page.goto(path);

      await expect(page.locator('main')).toHaveCount(1);
    });
  }

  test('an /account page has one <main> too — which is where the second one hid', async ({
    page,
    context,
    request,
  }) => {
    /*
     * This one needs a SESSION.
     *
     * The guard sends an anonymous visitor to `/login`, which is a different
     * layout — so an anonymous check would assert the landmark count of a page
     * that was never the problem. The account layout is where the surviving
     * nested `<main>` was, and only a signed-in render draws it.
     */
    const email = `${E2E_EMAIL_PREFIX}.t3-main-${randomUUID().slice(0, 8)}@example.test`;
    await signIn(context, request, email);

    await page.goto('/account/orders');

    await expect(page).toHaveURL(/\/account\/orders$/);
    await expect(page.locator('main')).toHaveCount(1);
    // The replacement is a labelled section, so the region is still announced.
    await expect(page.getByRole('region', { name: 'Account' })).toBeVisible();
  });
});


/**
 * Creates an account and installs its session cookies.
 *
 * The cookie names and flags mirror `lib/api/session.ts`. Driving the sign-in
 * form would work too and would only be a slower way to reach the same state —
 * what is under test here is a layout, not a login.
 */
async function signIn(
  context: BrowserContext,
  request: APIRequestContext,
  email: string,
): Promise<void> {
  const api = 'http://127.0.0.1:3002/api/v1';
  const password = 'brass thermionic valve';

  const registered = await request.post(`${api}/auth/register`, {
    data: { email, password, fullName: 'T3 Collapse' },
  });
  expect(registered.ok()).toBe(true);

  const login = await request.post(`${api}/auth/login`, { data: { email, password } });
  expect(login.ok()).toBe(true);

  const body = (await login.json()) as {
    data: { accessToken: string; refreshToken: string };
  };

  await context.addCookies(
    [
      { name: 'nest_at', value: body.data.accessToken },
      { name: 'nest_rt', value: body.data.refreshToken },
    ].map((cookie) => ({
      ...cookie,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax' as const,
    })),
  );
}
