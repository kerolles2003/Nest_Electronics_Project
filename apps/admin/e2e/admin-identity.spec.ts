import { expect, test } from './fixtures/browser-health';
import { DEAD_API_BASE_URL, route } from './origin';
import { DEV_ADMIN_EMAIL, DEV_ADMIN_NAME, signInAsAdmin } from './fixtures/operations';

/**
 * The console never invents the person operating it.
 *
 * ## What was there
 *
 * `AdminHeader` rendered the literal strings **"Admin User"**, **"admin@nest.com"**
 * and the initials **"AD"** on every page. Not as a loading state — as the
 * answer. Nothing fetched them; they were in the source.
 *
 * On a console that confirms orders, dispatches goods and records cash as
 * collected, that is worse than an empty header. It tells somebody they are
 * signed in as an account that does not exist, so if they are on a colleague's
 * machine, or on a session that ended an hour ago, nothing on screen
 * contradicts them — while every action they take is attributed, correctly and
 * permanently, to whoever the token actually belongs to.
 *
 * ## The two things asserted here
 *
 *  1. When the identity IS available, the header shows the real one from
 *     `GET /auth/me` — and the old fabricated strings appear nowhere.
 *  2. When the request FAILS, the header says so and **names nobody**.
 *
 * The second case runs against a second dev server whose `API_BASE_URL` points
 * at the discard port. `/auth/me` is called server-side by Next, so
 * `page.route()` cannot intercept it and stopping the real API would break the
 * rest of the run — see `e2e/origin.ts`. Cookies are host-scoped rather than
 * port-scoped, so this signs in against the healthy server and then navigates
 * to the broken one carrying the same session: a valid session, an unreachable
 * API, which is exactly the state under test.
 */

/**
 * The strings that used to be the answer. They must not appear, ever.
 *
 * The initials — "AD" — are deliberately NOT in this list. A page-wide
 * `not.toContain('AD')` matches inside any word containing those two letters,
 * which is precisely the overbroad substring assertion this suite is supposed
 * to avoid: it failed on unrelated copy and would equally have passed while the
 * avatar showed "AD". The initials are asserted on the AVATAR, below, where the
 * check is about the thing it claims to be about.
 */
const FABRICATED = ['Admin User', 'admin@nest.com'];

test.describe('the identity comes from the server', () => {
  test('shows the real operator, and none of the fabricated strings', async ({ page }) => {
    await signInAsAdmin(page);

    await expect(page.getByText(DEV_ADMIN_NAME).first()).toBeVisible();

    await page.getByRole('button', { name: DEV_ADMIN_NAME }).click();

    // The email and role come from the API too, not from anything local.
    /*
     * `.first()`: the email is shown in the header dropdown AND in the sidebar,
     * because BOTH used to fabricate an identity and both now render the real
     * one. Two matches is the correct state, not an ambiguity to hide.
     */
    await expect(page.getByText(DEV_ADMIN_EMAIL).first()).toBeVisible();
    await expect(page.getByText('SUPER ADMIN')).toBeVisible();

    const body = await page.locator('body').innerText();

    for (const fake of ['Admin User', 'admin@nest.com']) {
      expect(body, `"${fake}" was hard-coded here and must be gone`).not.toContain(fake);
    }
  });
});

test.describe('when the identity CANNOT be fetched', () => {
  test('says so, and names nobody', async ({ page }) => {
    // A real session, against the healthy server.
    await signInAsAdmin(page);

    // The same browser, the same cookies, an API that is not there.
    await page.goto(`${DEAD_API_BASE_URL}${route('/orders')}`, { waitUntil: 'domcontentloaded' });

    /*
     * The header states the unknown rather than filling it. This is the
     * assertion the whole file exists for.
     */
    await expect(page.getByText('Not identified')).toBeVisible();

    await page.getByRole('button', { name: /not identified/i }).click();

    /*
     * `.first()` — the header dropdown AND the sidebar both say it, because
     * both used to fabricate an identity and both were fixed. Two matches is
     * the correct state.
     */
    await expect(page.getByText('Identity unavailable').first()).toBeVisible();

    const body = await page.locator('body').innerText();

    for (const fake of FABRICATED) {
      expect(body, `no fabricated identity may appear — found "${fake}"`).not.toContain(fake);
    }

    // The avatar's initials, SCOPED to the avatar. "AD" was the hard-coded
    // fallback; with no identity it must be the neutral placeholder.
    await expect(page.getByTestId('header-avatar')).toHaveText('?');

    // Nor the REAL operator's name: the console genuinely does not know who is
    // here, and showing a remembered name would be the same lie one step later.
    expect(body).not.toContain(DEV_ADMIN_NAME);
    expect(body).not.toContain(DEV_ADMIN_EMAIL);
  });

  test('does not sign the operator out over an unreachable API', async ({ page }) => {
    /*
     * The bug this guards. Collapsing "I could not ask" into "you are not
     * signed in" sends somebody to the login page because the API hiccuped for
     * one request — and they will sign in again to fix a problem that was never
     * theirs, which is indistinguishable from their session genuinely ending.
     */
    await signInAsAdmin(page);

    await page.goto(`${DEAD_API_BASE_URL}${route('/orders')}`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(new RegExp(`${route('/orders')}$`));
    await expect(page).not.toHaveURL(new RegExp(`${route('/login')}$`));
  });

  test('says the queue could not be read, rather than showing an empty one', async ({ page }) => {
    /*
     * The most expensive lie a fulfilment console can tell is "there are no
     * orders" when it simply could not look. An empty table would be
     * indistinguishable from a quiet morning.
     */
    await signInAsAdmin(page);

    await page.goto(`${DEAD_API_BASE_URL}${route('/orders')}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('queue-error')).toContainText(/could not be loaded/i);
    await expect(page.getByTestId('empty-queue')).toHaveCount(0);
    await expect(page.getByTestId('order-row')).toHaveCount(0);
  });

  test('shows an em dash for a count it could not fetch, never 0', async ({ page }) => {
    /*
     * Zero is a claim — "no orders are awaiting confirmation" — and a console
     * must not make it because a request failed. This is the dashboard, whose
     * tiles are the first thing an operator reads in the morning.
     */
    await signInAsAdmin(page);

    await page.goto(`${DEAD_API_BASE_URL}${route('/')}`, { waitUntil: 'domcontentloaded' });

    const awaiting = page.getByText('Awaiting confirmation').locator('..');

    await expect(awaiting).toContainText('—');
    await expect(awaiting).not.toContainText(/\b0\b/);
  });
});
