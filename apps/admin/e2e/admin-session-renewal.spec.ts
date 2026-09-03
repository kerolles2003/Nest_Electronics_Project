import { expect, test } from './fixtures/browser-health';
import { DEV_ADMIN_NAME, signInAsAdmin } from './fixtures/operations';
import { route } from './origin';

/**
 * What happens when an operator leaves the console open for fifteen minutes.
 *
 * ## The bug these exist because of
 *
 * The access token lives fifteen minutes. `apiFetch` used to notice a 401,
 * refresh, and store the new pair — and storing means writing cookies, which
 * **Next forbids during a page render**. `tryApi` only catches `ApiError`, so
 * the write threw and the page 500'd: a stack trace where an order should be,
 * on a console that moves money.
 *
 * The half that was worse than the crash: the refresh had already succeeded, so
 * the API had rotated the refresh token and burned the old one. The new pair was
 * never persisted, so the browser kept presenting the burned token, and the next
 * attempt came back `REFRESH_TOKEN_REUSED` — which the API correctly treats as
 * theft and answers by revoking the whole family. A 500, then a silent sign-out,
 * from sitting still.
 *
 * ## Why the suite never caught it
 *
 * Every other spec signs in and finishes in seconds, so no access token in this
 * suite has ever expired. Waiting fifteen minutes is not a test, so these
 * specs BREAK the access token instead and leave the refresh token intact —
 * `TOKEN_INVALID` and `TOKEN_EXPIRED` take the identical path through the API
 * and the console, which is what makes the substitution honest rather than
 * convenient.
 */

/** A syntactically plausible bearer token the API will reject. */
const BROKEN_TOKEN = 'not.a.valid.token';

const ACCESS_COOKIE = 'nest_admin_at';
const REFRESH_COOKIE = 'nest_admin_rt';

/** Overwrites one cookie's value, leaving its flags exactly as they were. */
async function breakCookie(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  const existing = (await page.context().cookies()).find((c) => c.name === name);

  if (existing === undefined) {
    throw new Error(`${name} is not set, so this spec is not testing what it claims`);
  }

  await page.context().addCookies([{ ...existing, value: BROKEN_TOKEN }]);
}

async function cookieValue(
  page: import('@playwright/test').Page,
  name: string,
): Promise<string | undefined> {
  return (await page.context().cookies()).find((c) => c.name === name)?.value;
}

test.describe('an access token that is no longer usable', () => {
  test('renews on the next navigation, and the operator sees nothing', async ({ page }) => {
    await signInAsAdmin(page);
    await breakCookie(page, ACCESS_COOKIE);

    await page.goto(route('/orders'));

    /*
     * Waiting for the heading, NOT asserting on the navigation's status code.
     *
     * Renewal is a chain — `/orders` -> `/session/renew` -> `/orders` — and the
     * console shell has already streamed by the time the page segment decides
     * to renew. HTTP cannot redirect a response that has begun, so Next
     * performs it client-side and the FIRST response is a 200 carrying the
     * instruction. `expect(response.status()).toBe(200)` would therefore pass
     * against a broken implementation as easily as a working one, which is the
     * kind of assertion this repository has been burned by before.
     *
     * The heading only appears once the chain has finished with a working
     * session. Against the previous implementation the page 500'd instead, and
     * the browser-health fixture fails any test that saw a 5xx, a console error
     * or a page error — the old code produced all three here.
     */
    await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('leaves a WORKING session behind, not just a rendered page', async ({ page }) => {
    await signInAsAdmin(page);
    await breakCookie(page, ACCESS_COOKIE);

    await page.goto(route('/orders'));
    await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible({
      timeout: 30_000,
    });

    /*
     * The cookie is the assertion, not the page.
     *
     * A page can render from a renewal whose result was never stored — that is
     * exactly what the old code did, and the next request then presented a
     * burned refresh token and lost the session. Checking that the stored
     * access token is no longer the broken one proves the new pair was
     * PERSISTED, which is the part that was missing.
     */
    expect(await cookieValue(page, ACCESS_COOKIE)).not.toBe(BROKEN_TOKEN);

    // And the rotation reached the browser: the refresh token is replaced on
    // every use, so an unchanged one would mean the rotation went unrecorded.
    expect(await cookieValue(page, REFRESH_COOKIE)).not.toBe(BROKEN_TOKEN);
  });

  test('the operator is still the operator afterwards', async ({ page }) => {
    // Renewal must not quietly become "signed out and signed back in as
    // nobody". The identity comes from the API, so this asserts the renewed
    // token actually authenticates the same person.
    await signInAsAdmin(page);
    await breakCookie(page, ACCESS_COOKIE);

    await page.goto(route('/orders'));

    await expect(page.getByRole('button', { name: DEV_ADMIN_NAME })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('a second navigation does not renew again', async ({ page }) => {
    await signInAsAdmin(page);
    await breakCookie(page, ACCESS_COOKIE);

    await page.goto(route('/orders'));
    await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible({
      timeout: 30_000,
    });

    const afterFirst = await cookieValue(page, REFRESH_COOKIE);

    await page.goto(route('/orders'));
    await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible({
      timeout: 30_000,
    });

    /*
     * The renewed access token is good for fifteen minutes, so the second
     * navigation must not touch the session at all. If it did, this console
     * would be rotating a refresh token on every page view — which is how a
     * parallel request ends up presenting a burned one.
     */
    expect(await cookieValue(page, REFRESH_COOKIE)).toBe(afterFirst);
  });
});

test.describe('a session that cannot be renewed', () => {
  test('goes to sign-in rather than looping or crashing', async ({ page }) => {
    await signInAsAdmin(page);
    await breakCookie(page, ACCESS_COOKIE);
    await breakCookie(page, REFRESH_COOKIE);

    await page.goto(route('/orders'));

    /*
     * The refusal has to be a redirect, not an error page. Before this change
     * an unrenewable session reached `clearSession()` inside a render and threw
     * the same "cookies can only be modified in a Server Action or Route
     * Handler" as the success path did.
     */
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('does not leave a dead session in the browser', async ({ page }) => {
    await signInAsAdmin(page);
    await breakCookie(page, ACCESS_COOKIE);
    await breakCookie(page, REFRESH_COOKIE);

    await page.goto(route('/orders'));

    // Keeping the cookies would make every later navigation repeat the whole
    // failed round trip, and would leave the navigation guard letting somebody
    // through on the strength of a credential nothing can use.
    expect(await cookieValue(page, REFRESH_COOKIE)).toBeFalsy();
  });
});

test.describe('the renewal route refuses to be an open redirect', () => {
  test('sends a protocol-relative destination to the console instead', async ({ page }) => {
    /*
     * `//evil.example` is a URL, not a path: most parsers read it as another
     * ORIGIN. A renewal route that echoed `next` back would hand anybody a
     * signed-in redirect to a site of their choosing.
     */
    await signInAsAdmin(page);

    await page.goto(route('/session/renew?next=%2F%2Fevil.example'));

    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test('sends an absolute URL to the console instead', async ({ page }) => {
    await signInAsAdmin(page);

    await page.goto(route('/session/renew?next=https%3A%2F%2Fevil.example%2F'));

    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test('honours an ordinary local path', async ({ page }) => {
    // The other half: refusing everything would be safe and useless. A real
    // destination has to survive, or renewal always dumps operators on the
    // dashboard and the `next` parameter is decoration.
    await signInAsAdmin(page);

    await page.goto(route('/session/renew?next=%2Forders'));

    await expect(page).toHaveURL(/\/admin\/orders$/);
    await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
  });
});
