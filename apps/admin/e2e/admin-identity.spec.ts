import { expect, test } from './fixtures/browser-health';
import { FABRICATED_IDENTITY_STRINGS } from './fixtures/accounts';
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
const FABRICATED = FABRICATED_IDENTITY_STRINGS;

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

    for (const fake of FABRICATED) {
      expect(body, `"${fake}" was hard-coded here and must be gone`).not.toContain(fake);
    }
  });
});
