import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures/browser-health';

/**
 * The crash class, in a browser (F-05 / F-14).
 *
 * Phase 2's acceptance criterion is "login-with-full-guest-cart shows no
 * console error". That is this spec, and the assertion that matters is not
 * written here at all — it is the browser-health fixture, which fails the test
 * on any uncaught exception, unhandled rejection, `console.error` or unexpected
 * 5xx. Everything below merely walks the page into the state where the bug used
 * to appear.
 *
 * ## What the T2 flip changed about it
 *
 * The basket it seeds is the real one: `{productId, quantity}` under
 * `nest-guest-cart`. It used to seed `nest-cart-storage` — the legacy Zustand
 * store that held whole product objects including prices — and that key belongs
 * to a store which no longer exists, so the "full cart" in the test's name had
 * quietly become an empty one.
 *
 * The Supabase console-error allowance went with it. A failed sign-in is now an
 * API call in a server action: the browser sees an ordinary action response and
 * logs nothing, so there is nothing left to declare. **An allowance that
 * suppresses nothing is worse than no allowance** — it is a licence nobody is
 * checking, and this suite has already been bitten once by exactly that.
 *
 * ## Why the cart is seeded rather than clicked together
 *
 * Writing the persisted state directly is the same starting condition with none
 * of the coupling to add-to-cart, and it is honest about what is under test:
 * the SUBMIT path.
 *
 * ## Why a login that fails is the right probe
 *
 * The bug never needed valid credentials. It needed a form whose submit path
 * awaited something that could throw — and before the fix, an unhandled throw
 * left the button disabled for ever, with no message. So this asserts the
 * recovery contract directly: the form comes back, says something, and lets the
 * customer try again.
 */

/** The store key and shape `stores/guest-cart-store.ts` persists. */
const STORE_KEY = 'nest-guest-cart';

const SEEDED_BASKET = {
  state: {
    // A product id that does not resolve, on purpose. The API prices what it
    // can and flags what it cannot; neither may break the sign-in form, which
    // is the only thing this spec is about.
    items: [{ productId: '000000000000000000000001', quantity: 2 }],
    pendingMerge: null,
  },
  version: 0,
};

test.describe('a guest with a full basket can use the sign-in form', () => {
  test.beforeEach(async ({ page }) => {
    // Runs before any page script, so the store rehydrates from it rather than
    // starting empty and being overwritten.
    await page.addInitScript(
      ([key, cart]) => {
        window.localStorage.setItem(key, cart);
      },
      [STORE_KEY, JSON.stringify(SEEDED_BASKET)] as const,
    );
  });

  test('submitting the login form never strands it or throws', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email Address').fill(`e2e-guest.${randomUUID().slice(0, 8)}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('not-the-right-password');

    const submit = page.getByRole('button', { name: 'Sign In' });
    await submit.click();

    /*
     * The recovery contract, and the actual regression assertion.
     *
     * Before the fix, an unhandled throw in the submit path left the button
     * disabled for ever and no message appeared. Requiring the button to be
     * usable again, and a message to be present, is what "the form is not
     * stranded" means in a way a test can check.
     */
    await expect(submit).toBeEnabled({ timeout: 30_000 });
    // Scoped: Next renders a permanent, empty `role="alert"` route announcer
    // outside `main`, so an unscoped query is ambiguous.
    await expect(page.locator('main').getByRole('alert')).toBeVisible();

    // And the page is still the page — not a Next.js error overlay.
    await expect(page).toHaveURL(/\/login/);
  });

  test('a guest navigating to a guarded route is still redirected', async ({ page }) => {
    /*
     * The control for the proxy change (F-05).
     *
     * The fix narrowed the guard so it no longer answers Server Action POSTs
     * with a redirect. This asserts the half that must NOT have changed: a
     * browser NAVIGATING to a guarded route without a session still lands on
     * the sign-in page. Without this, a later "simplification" of the proxy
     * could delete the guard entirely and every remaining test would still
     * pass.
     */
    await page.goto('/checkout');

    await expect(page).toHaveURL(/\/login\?redirect=%2Fcheckout/);
  });
});
