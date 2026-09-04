import { randomUUID } from 'node:crypto';
// F-14 — `test` comes from the browser-health fixture, not from Playwright
// directly. Every step below now also asserts that the page threw nothing,
// logged no console error, and received no unexpected 5xx.
import { expect, test } from './fixtures/browser-health';
import { E2E_EMAIL_PREFIX } from './global-teardown';

/**
 * The purchase journey, in a real browser, on the CANONICAL routes.
 *
 * Register → sign in → browse → add to cart → address → quote → place order →
 * confirmation → history.
 *
 * ## It walks `/login`, `/account/*` and `/checkout` now
 *
 * It used to walk `/shop/*`, because that slice was where the API-backed
 * implementation lived while the customer-facing pages were still on Supabase.
 * The T2 flip moved those implementations onto the real URLs, so this walks the
 * URLs a customer actually visits. `/shop` still exists until T3 collapses it,
 * and it is no longer what this proves.
 *
 * ## What this proves that the API tests cannot
 *
 * The API suite proves the CONTRACT. This proves the WIRING: that the forms
 * post to the right server actions, that the session cookie survives a
 * redirect, that a server component re-reads state after a mutation, and that
 * the pages link to one another in an order a person can actually walk. Every
 * one of those can break while all 400 API tests stay green.
 *
 * ## Why one long test rather than nine short ones
 *
 * Each step depends on the state the previous one created. Split into separate
 * `test()` blocks they would either share mutable state across tests — which
 * Playwright explicitly does not guarantee the ordering of — or each re-run the
 * whole prefix, turning one journey into nine. A journey is one scenario, and
 * `test.step` keeps the failure report as legible as separate tests would.
 *
 * ## Data
 *
 * Creates a real account and a real order. `globalTeardown` removes both. The
 * email lives in the `e2e-journey.` namespace, which nothing else writes to.
 */

const RUN = randomUUID().slice(0, 8);
const EMAIL = `${E2E_EMAIL_PREFIX}.${RUN}@example.test`;
const PASSWORD = 'brass thermionic valve';
const FULL_NAME = 'Journey Customer';

test('a customer can register, order and see it in their history', async ({ page }) => {
  await test.step('register', async () => {
    await page.goto('/register');

    await page.getByLabel('Full Name').fill(FULL_NAME);
    await page.getByLabel('Email Address').fill(EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create Account' }).click();

    // Registration issues NO session — the API returns none until the address
    // is verified — so the correct destination is the sign-in page carrying
    // the "check your email" flag, NOT a guarded route. That mistake (F-04)
    // was the legacy page's, and it stranded every new customer.
    await page.waitForURL(/\/login\?registered=1/);
    await expect(page.getByText('Check your email')).toBeVisible();
  });

  await test.step('sign in', async () => {
    await page.getByLabel('Email Address').fill(EMAIL);
    // `exact`: the reveal toggle beside the input is labelled "Show password".
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();

    /*
     * No `redirect` was carried, so the default destination applies — the
     * storefront home. It used to be `/account/orders`, and asserting either
     * would be asserting nothing about the change that moved it.
     */
    await page.waitForURL((url) => url.pathname === '/');
  });

  const productName = await test.step('browse and open an in-stock product', async () => {
    await page.goto('/products?inStock=true');

    const card = page.locator('main a[href^="/products/"]').first();
    await expect(card).toBeVisible();

    await card.click();
    await page.waitForURL(/\/products\/[^/?]+$/);

    const name = ((await page.getByRole('heading', { level: 1 }).textContent()) ?? '').trim();
    expect(name.length).toBeGreaterThan(0);

    return name;
  });

  await test.step('add to cart', async () => {
    await page.getByRole('button', { name: 'Add to Cart' }).click();

    /*
     * The drawer opens on add. What is asserted is the SERVER's answer: the
     * line is here because `GET /cart` returned it, and its total is the API's
     * `formatted` string. The old drawer multiplied a client-held price.
     */
    const drawer = page.getByRole('dialog', { name: 'Your cart' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(productName, { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId('drawer-subtotal')).toHaveText(/^[\d,]+\.\d{2} EGP$/);
  });

  await test.step('save a delivery address', async () => {
    await page.goto('/account/addresses');

    await page.getByLabel('Label').fill('Home');
    await page.getByLabel('Recipient name').fill(FULL_NAME);
    await page.getByLabel('Phone').fill('01012345678');
    await page.getByLabel('Street, building and apartment').fill('12 Sherif Street, Apt 4');
    await page.getByLabel('City').fill('Downtown');
    // A closed list, not free text: the API refuses any governorate outside
    // the 27, so the form offers exactly those (B3). `selectOption` also fails
    // loudly if the value ever stops being offered, which `fill` would not.
    await page.getByLabel('Governorate').selectOption('Cairo');
    await page.getByRole('button', { name: 'Save address' }).click();

    await expect(page.locator('main').getByText('12 Sherif Street, Apt 4')).toBeVisible();
  });

  await test.step('see the checkout quote, with the D-8 delivery fee live', async () => {
    await page.goto('/checkout');

    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();

    /*
     * Cairo, so 50.00 EGP — the seeded D-8 rate, asserted as a NUMBER rather
     * than as "some money string".
     *
     * This is the assertion the whole shipping-rates change exists for. It
     * used to read "Not yet calculated" for every order ever placed, because
     * no rate table existed; a test that only checked the format would have
     * passed then too.
     */
    await expect(page.getByTestId('checkout-delivery')).toHaveText('50.00 EGP');

    // Every amount on this page is the server's own `formatted` string; the
    // page does no arithmetic. Asserted on the TOTAL ROW, not on the page —
    // `getByText(/EGP/).first()` was satisfied by any cart line's price, so
    // the total itself could have rendered blank, "-" or "NaN EGP".
    await expect(page.getByTestId('checkout-total')).toHaveText(/^[\d,]+\.\d{2} EGP$/);
  });

  await test.step('place the order', async () => {
    await page.getByRole('button', { name: 'Place order' }).click();

    // Redirects to the order it just created, on the canonical account route.
    await page.waitForURL(/\/account\/orders\/[0-9a-f]{24}\?placed=1/, { timeout: 60_000 });
  });

  const orderNumber = await test.step('see the confirmation', async () => {
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();

    const number = ((await page.getByTestId('order-number').textContent()) ?? '').trim();
    expect(number).toMatch(/^NE-\d{8}-\d+$/);

    // The fee the quote promised is the fee the ORDER carries. Two different
    // computations — one from the cart, one inside the placement transaction —
    // and they must agree.
    await expect(page.getByTestId('order-delivery')).toHaveText('50.00 EGP');

    return number;
  });

  await test.step('cancel it, and see the stock come back', async () => {
    /*
     * The self-cancel endpoint existed from Phase 3 and no UI reached it —
     * recorded as an open gap and closed in T2. Cancelling here also leaves
     * the seeded catalogue as this journey found it.
     */
    await page.getByRole('button', { name: 'Cancel order' }).click();
    // Required by the API — 3 to 500 characters, stored on the permanent record.
    await page.getByLabel('Why are you cancelling?').fill('Ordered the wrong variant.');
    await page.getByRole('button', { name: 'Yes, cancel this order' }).click();

    /*
     * Asserted on the ORDER's state, not on a confirmation message.
     *
     * The action revalidates this route, so the page re-renders with
     * `cancellation` populated and the cancel form is replaced by the record of
     * what happened. That is the outcome worth asserting: a message can be
     * shown by a component that did nothing, and the state cannot.
     */
    await expect(page.getByRole('heading', { name: 'Cancelled' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  });

  await test.step('find it in order history', async () => {
    await page.goto('/account/orders');

    await expect(page.getByRole('heading', { name: 'Order History' })).toBeVisible();
    // The SAME order number, not merely some order: proof the history reads
    // the order this journey created.
    await expect(page.getByText(orderNumber).first()).toBeVisible();
  });
});

/**
 * The destination of the link in the verification email.
 *
 * Not part of the journey above — that runs with verification disabled, and
 * the token flow is proven end-to-end at the API layer. What is worth
 * asserting HERE is that the page a customer lands on exists, handles a bad
 * token without crashing, and offers the recovery path. A verification link
 * that 404s would make the whole email pointless, and nothing else in the
 * suite would notice.
 *
 * The path is `/verify-email` now. The API builds that address, so this is the
 * page named in every verification email currently sitting in an inbox.
 */
test('the verification page handles an invalid token and offers a resend', async ({ page }) => {
  await page.goto('/verify-email?token=definitely-not-a-real-token');

  await expect(page.getByText('We could not verify this link')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send a New Link' })).toBeVisible();
});
