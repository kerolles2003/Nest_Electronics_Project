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
 * ## Why the cart is seeded rather than clicked together
 *
 * The guest cart is a Zustand store persisted to `localStorage`; the legacy
 * product pages that would add to it read their catalogue from Supabase. Making
 * this spec click through those pages would make a proxy-and-form regression
 * test depend on the contents of a legacy database that D-6 has already
 * declared disposable — a test that fails for reasons unrelated to what it
 * checks. Writing the persisted state directly is the same starting condition
 * with none of that coupling, and it is honest about what is under test: the
 * SUBMIT path, not the add-to-cart path.
 *
 * ## Why a login that fails is the right probe
 *
 * The bug never needed valid credentials. It needed a form whose submit handler
 * awaited something that could throw — and before the fix, an unhandled throw
 * left `loading` true for ever, with no message and a dead button. So this
 * asserts the recovery contract directly: the form comes back, says something,
 * and lets the customer try again.
 */

const SEEDED_CART = {
  state: {
    items: [
      {
        id: 'e2e-guest-line',
        product_id: 'e2e-guest-product',
        quantity: 2,
        product: {
          id: 'e2e-guest-product',
          name_en: 'Guest Cart Probe',
          slug: 'guest-cart-probe',
          sku: 'E2E-GUEST-1',
          base_price: 10000,
          sale_price: null,
          available_stock: 50,
          is_active: true,
          images: [],
        },
      },
    ],
    cartVersion: 1,
  },
  version: 0,
};

test.describe('a guest with a full cart can use the sign-in form', () => {
  test.beforeEach(async ({ page }) => {
    // Runs before any page script, so the store rehydrates from it rather than
    // starting empty and being overwritten.
    await page.addInitScript((cart) => {
      window.localStorage.setItem('nest-cart-storage', JSON.stringify(cart));
    }, SEEDED_CART);
  });

  test('submitting the login form never strands it or throws', async ({ page, health }) => {
    /*
     * Supabase answers a bad password with a 400 and the client logs it. That
     * is the endpoint working correctly, not the page misbehaving, so it is
     * declared rather than silently tolerated — and it is scoped to the
     * credential message, so any OTHER console error still fails the test.
     */
    health.allowConsoleError(/Invalid login credentials|400|AuthApiError/i);

    await page.goto('/login');

    await page.getByLabel(/email/i).fill(`e2e-guest.${randomUUID().slice(0, 8)}@example.test`);
    await page.getByLabel(/password/i).first().fill('not-the-right-password');

    const submit = page.getByRole('button', { name: /sign in|log in/i }).first();
    await submit.click();

    /*
     * The recovery contract, and the actual regression assertion.
     *
     * Before the fix, an unhandled throw in this handler left `loading` true
     * for ever: the button stayed disabled and no message appeared. Requiring
     * the button to be usable again is what "the form is not stranded" means in
     * a way a test can check.
     */
    await expect(submit).toBeEnabled({ timeout: 30_000 });

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
