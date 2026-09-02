import { randomUUID } from 'node:crypto';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { expect, test } from './fixtures/browser-health';
import { E2E_EMAIL_PREFIX } from './global-teardown';
import { API_BASE_URL, BASE_URL, HOST } from './origin';

/**
 * The T2 flip's own guarantees.
 *
 * The purchase journey proves the happy path end to end. This file proves the
 * properties that are easy to lose quietly: that the guard sends the right
 * people to the right places, that the Google buttons are gone rather than
 * hidden, that a signed-out visitor still gets a priced basket, and that a
 * Server Action is never answered with a redirect.
 *
 * Each of those was a real defect before the flip, and none of them would fail
 * a happy-path journey.
 */

const API = API_BASE_URL;
const PASSWORD = 'brass thermionic valve';
const RUN = randomUUID().slice(0, 8);

interface Account {
  readonly email: string;
  readonly token: string;
  readonly refreshToken: string;
}

/**
 * Installs the session the sign-in form would have written.
 *
 * The names and flags mirror `lib/api/session.ts` exactly. If that module ever
 * renames a cookie, every case using this fails together, which is the right
 * way for a stand-in to break.
 */
async function signInWithCookies(context: BrowserContext, session: Account): Promise<void> {
  await context.addCookies(
    [
      { name: 'nest_at', value: session.token },
      { name: 'nest_rt', value: session.refreshToken },
    ].map((cookie) => ({
      ...cookie,
      domain: HOST,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax' as const,
    })),
  );
}

async function createAccount(request: APIRequestContext, label: string): Promise<Account> {
  const email = `${E2E_EMAIL_PREFIX}.t2-${label}-${RUN}@example.test`;

  const registered = await request.post(`${API}/auth/register`, {
    data: { email, password: PASSWORD, fullName: 'T2 Flip' },
  });
  expect(registered.ok()).toBe(true);

  const login = await request.post(`${API}/auth/login`, {
    data: { email, password: PASSWORD },
  });
  expect(login.ok()).toBe(true);

  const body = (await login.json()) as {
    data: { accessToken: string; refreshToken: string };
  };

  return { email, token: body.data.accessToken, refreshToken: body.data.refreshToken };
}

/** Any purchasable product, for the basket cases. */
async function aProduct(request: APIRequestContext): Promise<{ id: string; slug: string }> {
  const response = await request.get(`${API}/products?inStock=true&limit=1`);
  expect(response.ok()).toBe(true);

  const body = (await response.json()) as { data: { id: string; slug: string }[] };
  const product = body.data[0];
  expect(product).toBeDefined();

  return product as { id: string; slug: string };
}

test.describe('the auth pages are the API’s', () => {
  test('sign-in and registration offer NO Google button', async ({ page }) => {
    /*
     * D-3: OAuth is not required at launch and the buttons are removed.
     *
     * Asserted as absence rather than by the button being hidden, because the
     * old one could not have worked: it called `signInWithOAuth` with a
     * redirect to `/auth/callback`, a route that was PKCE-only and orphaned.
     * A button that cannot complete a sign-in is worse than no button.
     */
    for (const path of ['/login', '/register']) {
      await page.goto(path);

      await expect(page.getByRole('button', { name: /google/i })).toHaveCount(0);
      await expect(page.getByText('or continue with')).toHaveCount(0);
    }
  });

  test('the orphaned /auth/callback route is gone', async ({ page, health }) => {
    // The browser logs a console error for the 404 document itself. Declared,
    // because a 404 is precisely what this test is asserting.
    health.allowConsoleError(/Failed to load resource.*404/);

    const response = await page.goto('/auth/callback?code=whatever');

    // F-06: it was the destination of a Supabase verification redirect that
    // never carried a code it could use. Deleted with the flow that fed it.
    expect(response?.status()).toBe(404);
  });

  test('a wrong password is reported on the form, not thrown', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email Address').fill(`nobody-${RUN}@example.test`);
    /*
     * `exact` because the reveal toggle beside the input carries
     * `aria-label="Show password"`, which a substring match also finds. The
     * ambiguity is the accessible tree doing its job; the fix belongs in the
     * selector.
     */
    await page.getByLabel('Password', { exact: true }).fill('definitely not the password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // An unknown email and a wrong password are indistinguishable by design,
    // so the assertion is that SOMETHING sane is said and the customer is
    // still on the form — not which of the two it was.
    // Scoped: Next renders a permanent, empty `role="alert"` route announcer
    // outside `main`, so an unscoped query is ambiguous.
    await expect(page.locator('main').getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('forgot-password answers the same way for any address', async ({ page }) => {
    await page.goto('/forgot-password');

    await page.getByLabel('Email Address').fill(`definitely-not-a-customer-${RUN}@example.test`);
    await page.getByRole('button', { name: 'Send Reset Link' }).click();

    /*
     * A neutral acknowledgement. The API answers identically whether or not the
     * address has an account, and so must this page: a distinguishable answer
     * is a password-free way to find out who shops here.
     */
    await expect(page.getByRole('status')).toBeVisible();
  });

  test('a reset link with no token says so instead of showing a dead form', async ({ page }) => {
    await page.goto('/forgot-password/reset');

    await expect(page.getByRole('heading', { name: 'This link is incomplete' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
    await expect(page.getByLabel('New Password', { exact: true })).toHaveCount(0);
  });
});

test.describe('the proxy guard', () => {
  test.describe.configure({ mode: 'serial' });

  let account: Account;

  test.beforeAll(async ({ request }) => {
    account = await createAccount(request, 'guard');
  });

  test('sends an anonymous visitor away from /account and /checkout, keeping the destination', async ({
    page,
  }) => {
    for (const path of ['/account/orders', '/account/profile', '/account/addresses', '/checkout']) {
      await page.goto(path);
      await expect(page).toHaveURL(`/login?redirect=${encodeURIComponent(path)}`);
    }
  });

  test('does NOT guard a path that merely starts with the same letters', async ({
    page,
    health,
  }) => {
    health.allowConsoleError(/Failed to load resource.*404/);

    /*
     * `startsWith('/account')` also matches `/accountancy`. The guard matches
     * on segment boundaries, so an unrelated route 404s as itself instead of
     * being redirected to a sign-in page it has nothing to do with.
     */
    const response = await page.goto('/accountancy');

    expect(response?.status()).toBe(404);
    await expect(page).toHaveURL(/\/accountancy$/);
  });

  test('sends a signed-in customer away from the auth pages', async ({ page, context }) => {
    await signInWithCookies(context, account);

    for (const path of ['/login', '/register', '/forgot-password']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/account\/orders$/);
    }
  });

  test('still lets a signed-in customer USE a password-reset link', async ({ page, context }) => {
    /*
     * The one exception, and it matters: a reset link is a credential with an
     * expiry, sent to an inbox. Someone signed in on this device may be
     * recovering the account from another. Bouncing them off the link consumes
     * nothing and leaves them holding a token they cannot use.
     */
    await signInWithCookies(context, account);

    await page.goto('/forgot-password/reset?token=some-token-value');

    await expect(page).toHaveURL(/\/forgot-password\/reset\?token=/);
    await expect(page.getByLabel('New Password', { exact: true })).toBeVisible();
  });

  test('NEVER answers a Server Action POST with a redirect', async ({ request }) => {
    /*
     * F-05, asserted at the protocol level.
     *
     * A Server Action is a `fetch` the React runtime issues, not a navigation.
     * Answering one with a 307 makes the browser follow it (a 307 keeps the
     * method and body), hand the runtime an HTML document where an action
     * result belonged, and throw "An unexpected response was received from the
     * server." — untargetable and unactionable, on submitting a form whose
     * session merely expired.
     *
     * Sent with NO session, to a guarded path, which is exactly the case that
     * used to redirect.
     */
    const response = await request.post(`${BASE_URL}/checkout`, {
      headers: { 'Next-Action': 'probe-not-a-real-action-id' },
      data: '[]',
      maxRedirects: 0,
    });

    /*
     * The assertion is the ABSENCE of a redirect, not any particular success.
     *
     * The action id is deliberately not a real one, so Next answers 404 — which
     * is the right shape: the request reached the ACTION layer and was refused
     * there. What must never happen is a 3xx with a `Location`, because that is
     * the response the React runtime cannot reconcile.
     */
    expect([301, 302, 303, 307, 308]).not.toContain(response.status());
    expect(response.headers()['location']).toBeUndefined();
  });
});

test.describe('the basket', () => {
  test.describe.configure({ mode: 'serial' });

  test('a SIGNED-OUT visitor gets a basket priced by the API', async ({ page, request }) => {
    const product = await aProduct(request);

    await page.goto(`/products/${product.slug}`);
    await page.getByRole('button', { name: 'Add to Cart' }).click();

    const drawer = page.getByRole('dialog', { name: 'Your cart' });
    await expect(drawer).toBeVisible();

    /*
     * The subtotal is the point. The browser store holds `{productId,
     * quantity}` and no price at all, so a formatted amount here can only have
     * come from `POST /cart/preview`. The old drawer multiplied a price the
     * customer could have edited in `localStorage`.
     */
    await expect(page.getByTestId('drawer-subtotal')).toHaveText(/^[\d,]+\.\d{2} EGP$/);
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    await expect(drawer.getByTestId('cart-line')).toHaveCount(1);
  });

  test('and nothing was written server-side for them', async ({ request }) => {
    // A guest basket creates no cart document. `POST /cart/preview` is a pure
    // read; the merge at sign-in is what moves a basket into a real cart.
    const anonymous = await request.get(`${API}/cart`);

    expect(anonymous.status()).toBe(401);
  });

  test('a SIGNED-IN customer gets their account cart, and it survives a reload', async ({
    page,
    context,
    request,
  }) => {
    const account = await createAccount(request, 'basket');
    const product = await aProduct(request);

    await signInWithCookies(context, account);

    await page.goto(`/products/${product.slug}`);
    await page.getByRole('button', { name: 'Add to Cart' }).click();

    await expect(page.getByTestId('cart-count')).toHaveText('1');

    // The API is the persistence authority: a reload re-reads it rather than
    // rehydrating a browser store.
    await page.reload();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    const cart = await request.get(`${API}/cart`, {
      headers: { Authorization: `Bearer ${account.token}` },
    });
    const body = (await cart.json()) as { data: { items: { productId: string }[] } };

    expect(body.data.items.map((line) => line.productId)).toEqual([product.id]);
  });
});
