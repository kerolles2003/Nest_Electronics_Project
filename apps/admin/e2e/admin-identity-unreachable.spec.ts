import { expect, test } from './fixtures/browser-health';
import { DEAD_API_BASE_URL, route } from './origin';
import { FABRICATED_IDENTITY_STRINGS } from './fixtures/accounts';
import { DEV_ADMIN_EMAIL, DEV_ADMIN_NAME, signInAsAdmin } from './fixtures/operations';

/**
 * What the console says when it cannot ask the API who is operating it.
 *
 * ## Why these four specs are in a file of their own
 *
 * They are the only ones that need a THIRD web server: the same application
 * pointed at a port nothing listens on. `GET /auth/me` is issued SERVER-side by
 * the Next process, so `page.route()` cannot intercept it, and stopping the
 * real API would break every other spec in the run — a second copy of the app
 * with a dead `API_BASE_URL` is the only honest way to reach the branch.
 *
 * Playwright has no per-project web server, so while these lived alongside the
 * rest that third server was a hard dependency of EVERY admin spec. It failed
 * to start once, on a machine short of memory, and took all thirty-seven down
 * with it rather than the four that need it. They now run from
 * `playwright.unreachable-api.config.ts`, which starts three servers; the other
 * thirty-three run on the two they use.
 *
 * Moved verbatim from `admin-identity.spec.ts` — not one assertion changed.
 *
 * ## What they are actually about
 *
 * `readAdminIdentity()` has three outcomes, and only two of them are "no". No
 * session and a rejected session mean sign in again; an API that could not be
 * REACHED means nothing about the operator at all. Collapsing the third into
 * the other two signs somebody out over a hiccup, and on a fulfilment console
 * an empty queue rendered as though it were an answer is the most expensive lie
 * available: it is indistinguishable from a quiet morning.
 */

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

    for (const fake of FABRICATED_IDENTITY_STRINGS) {
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
