import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures/browser-health';
import { API_BASE_URL, route } from './origin';
import {
  DEV_ADMIN_EMAIL,
  DEV_ADMIN_NAME,
  registerCustomer,
  signIn,
  signInAsAdmin,
} from './fixtures/operations';

/**
 * Admin authentication, against the API.
 *
 * Everything here used to be Supabase: the browser called
 * `signInWithPassword`, the proxy verified the role with a **service-role key**
 * on every navigation, and signing out called `supabase.auth.signOut()` — which
 * against this API revoked nothing, because this API had never issued anything.
 */

const RUN_ID = randomUUID().slice(0, 8);

/** The storefront's cookies. An admin session must never land in these. */
const STOREFRONT_COOKIES = ['nest_at', 'nest_rt'];
const ADMIN_ACCESS_COOKIE = 'nest_admin_at';
const ADMIN_REFRESH_COOKIE = 'nest_admin_rt';

test.describe('signing in', () => {
  test('an operator signs in and reaches the console', async ({ page }) => {
    await signInAsAdmin(page);

    await expect(page).toHaveURL(new RegExp(`${route('/')}?$`));
    // The identity comes from the server, so this is the seeded admin's REAL
    // name — not a string this application holds.
    await expect(page.getByText(DEV_ADMIN_NAME).first()).toBeVisible();
  });

  test('stores the session in httpOnly cookies the page cannot read', async ({ page, context }) => {
    await signInAsAdmin(page);

    const cookies = await context.cookies();
    const admin = cookies.filter((cookie) => cookie.name.startsWith('nest_admin_'));

    expect(admin.map((cookie) => cookie.name).sort()).toEqual(
      [ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE].sort(),
    );

    // The whole point. A readable refresh token turns one XSS into a month of
    // access to a console that dispatches goods and marks cash collected.
    for (const cookie of admin) {
      expect(cookie.httpOnly, `${cookie.name} must be httpOnly`).toBe(true);
    }

    // And nothing token-shaped is reachable from client JavaScript.
    const visible = await page.evaluate(() => ({
      cookie: document.cookie,
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));

    expect(visible.cookie).not.toContain('nest_admin');
    expect(JSON.stringify(visible.local)).not.toContain('nest_admin');
    expect(JSON.stringify(visible.session)).not.toContain('nest_admin');
  });

  test('uses cookie names the storefront does not', async ({ page, context }) => {
    /*
     * Both applications are served from one origin, and cookies are scoped by
     * domain and path — not by port and not by application. Shared names would
     * mean one slot: signing in here would overwrite a shopper's session, and
     * neither app could tell whose token it was holding.
     */
    await signInAsAdmin(page);

    const names = (await context.cookies()).map((cookie) => cookie.name);

    for (const storefrontCookie of STOREFRONT_COOKIES) {
      expect(names, `${storefrontCookie} belongs to the storefront`).not.toContain(storefrontCookie);
    }
  });

  test('refuses a CUSTOMER’s correct password', async ({ page }) => {
    /*
     * The API authenticates any valid account, so a customer's credentials
     * produce a perfectly good token pair. Storing it would sign them into the
     * admin shell where every screen then fails with an authorization error
     * that reads like a broken application.
     */
    const customer = await registerCustomer(RUN_ID, 'not-staff');

    await signIn(page, customer);

    /*
     * Scoped by test id, not by `getByRole('alert')`: Next renders its own
     * route announcer with `role="alert"`, so the role selector is ambiguous
     * and the strict-mode violation reads like a missing element.
     */
    await expect(page.getByTestId('login-error')).toContainText(/not valid for this console/i);
    await expect(page).toHaveURL(new RegExp(`${route('/login')}$`));

    // No session was kept for them.
    const names = (await page.context().cookies()).map((cookie) => cookie.name);
    expect(names).not.toContain(ADMIN_REFRESH_COOKIE);
  });

  test('refuses a wrong password without saying which half was wrong', async ({ page }) => {
    await signIn(page, { email: DEV_ADMIN_EMAIL, password: 'not the right password at all' });

    const alert = page.getByTestId('login-error');
    await expect(alert).toBeVisible();

    // The message must not confirm that the address exists.
    await expect(alert).not.toContainText(/no such account|unknown (email|address|user)/i);
  });
});

test.describe('the navigation guard', () => {
  test('sends an anonymous visitor to sign in', async ({ page }) => {
    await page.goto(route('/orders'));

    await expect(page).toHaveURL(new RegExp(`${route('/login')}$`));
  });

  test('does not render a fabricated identity on the way', async ({ page }) => {
    await page.goto(route('/'));

    await expect(page).toHaveURL(new RegExp(`${route('/login')}$`));
    await expect(page.locator('body')).not.toContainText('Admin User');
    await expect(page.locator('body')).not.toContainText('admin@nest.com');
  });
});

test.describe('signing out', () => {
  test('REVOKES the refresh token server-side, not just the cookie', async ({ page, context }) => {
    /*
     * THE test for this change. The old sign-out cleared a client-side Supabase
     * session and set `window.location`; against this API that left a working
     * thirty-day credential in the wild. Clearing a cookie ends the tab.
     *
     * So the refresh token is captured BEFORE signing out and then presented to
     * the API directly afterwards. If sign-out only cleared cookies, it still
     * works — and this test is the only thing that would notice.
     */
    await signInAsAdmin(page);

    const before = (await context.cookies()).find((c) => c.name === ADMIN_REFRESH_COOKIE);
    expect(before, 'a refresh token to revoke').toBeDefined();
    const refreshToken = (before as { value: string }).value;

    // It is a live credential right now — otherwise the assertion after
    // sign-out would pass for the wrong reason.
    const beforeRefresh = await page.request.post(`${API_BASE_URL}/auth/refresh`, {
      data: { refreshToken },
      failOnStatusCode: false,
    });
    expect(beforeRefresh.status(), 'the token is valid before signing out').toBe(200);

    /*
     * That refresh ROTATED the token, so the cookie the browser holds is now
     * the burned one. Sign out and check the token the SERVER last issued —
     * which is the one in the response — is dead too.
     */
    const rotated = ((await beforeRefresh.json()) as { data: { refreshToken: string } }).data
      .refreshToken;

    await page.getByRole('button', { name: DEV_ADMIN_NAME }).click();
    await page.getByRole('button', { name: /sign out/i }).click();
    await page.waitForURL(new RegExp(`${route('/login')}$`), { timeout: 30_000 });

    const names = (await context.cookies()).map((cookie) => cookie.name);
    expect(names, 'the cookies are cleared too').not.toContain(ADMIN_REFRESH_COOKIE);

    for (const token of [refreshToken, rotated]) {
      const after = await page.request.post(`${API_BASE_URL}/auth/refresh`, {
        data: { refreshToken: token },
        failOnStatusCode: false,
      });

      expect(
        after.status(),
        'a refresh token must be dead on the SERVER after signing out',
      ).not.toBe(200);
    }
  });

  test('the console is unreachable afterwards', async ({ page }) => {
    await signInAsAdmin(page);

    await page.getByRole('button', { name: DEV_ADMIN_NAME }).click();
    await page.getByRole('button', { name: /sign out/i }).click();
    await page.waitForURL(new RegExp(`${route('/login')}$`), { timeout: 30_000 });

    await page.goto(route('/orders'));
    await expect(page).toHaveURL(new RegExp(`${route('/login')}$`));
  });
});
