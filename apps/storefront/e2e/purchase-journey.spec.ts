import { randomUUID } from 'node:crypto';
// F-14 — `test` comes from the browser-health fixture, not from Playwright
// directly. Every step below now also asserts that the page threw nothing,
// logged no console error, and received no unexpected 5xx.
import { expect, test } from './fixtures/browser-health';
import { E2E_EMAIL_PREFIX } from './global-teardown';

/**
 * The purchase journey, in a real browser.
 *
 * Register → sign in → browse → add to cart → address → quote → place order →
 * confirmation → history.
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
    await page.goto('/shop/register');

    await page.getByLabel('Full name').fill(FULL_NAME);
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    // Registration issues NO session — the API returns none until the address
    // is verified — so the correct destination is the sign-in page carrying
    // the "check your email" flag, NOT a guarded route.
    await page.waitForURL(/\/shop\/login\?registered=1/);
    await expect(page.getByText('Check your email')).toBeVisible();
  });

  await test.step('sign in', async () => {
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForURL('**/shop');
  });

  const productName = await test.step('browse and open an in-stock product', async () => {
    await page.goto('/shop');

    // Scoped to the product LIST, not to `a[href^="/shop/"]` — that would also
    // match the four navigation links in the layout, and `.first()` would pick
    // one of those instead of a product.
    //
    // Filtered to "In stock" because add-to-cart is a real server call against
    // real inventory: an out-of-stock product would fail the next step for a
    // legitimate reason and read as a broken journey.
    const card = page
      .locator('main ul > li')
      .filter({ hasText: 'In stock' })
      .first();

    await expect(card).toBeVisible();
    const name = ((await card.locator('h2').textContent()) ?? '').trim();

    await card.locator('a').first().click();
    await page.waitForURL(/\/shop\/[^/?]+$/);

    return name;
  });

  await test.step('add to cart', async () => {
    await page.getByRole('button', { name: 'Add to cart' }).click();

    await page.goto('/shop/cart');
    await expect(page.getByRole('heading', { name: 'Your cart' })).toBeVisible();
    // The cart is SERVER state: this line is here because the API returned it,
    // not because a client store was updated optimistically.
    await expect(page.getByText(productName, { exact: false }).first()).toBeVisible();
  });

  await test.step('save a delivery address', async () => {
    await page.goto('/shop/addresses');

    await page.getByLabel('Label').fill('Home');
    await page.getByLabel('Recipient name').fill(FULL_NAME);
    await page.getByLabel('Phone').fill('01012345678');
    await page.getByLabel('Street, building and apartment').fill('12 Sherif Street, Apt 4');
    await page.getByLabel('City').fill('Downtown');
    // A closed list now, not free text: the API refuses any governorate outside
    // the 27, so the form offers exactly those (B3). `selectOption` also fails
    // loudly if the value ever stops being offered, which `fill` would not.
    await page.getByLabel('Governorate').selectOption('Cairo');
    await page.getByRole('button', { name: 'Save address' }).click();

    // Asserted on the STREET, not on the label "Home": the root layout wraps
    // these pages in the legacy site chrome, whose navigation contains three
    // separate "Home" links. A unique string scoped to `main` is the only
    // assertion that means "the address was saved".
    await expect(page.locator('main').getByText('12 Sherif Street, Apt 4')).toBeVisible();
  });

  await test.step('see the checkout quote', async () => {
    await page.goto('/shop/checkout');

    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    // Every amount on this page is the server's own `formatted` string; the
    // page does no arithmetic. Asserting the currency proves a real quote came
    // back rather than a placeholder.
    await expect(page.getByText('Total to pay')).toBeVisible();
    await expect(page.getByText(/EGP/).first()).toBeVisible();
  });

  await test.step('place the order', async () => {
    await page.getByRole('button', { name: 'Place order' }).click();

    // Redirects to the order it just created.
    await page.waitForURL(/\/shop\/orders\/[0-9a-f]{24}\?placed=1/, { timeout: 60_000 });
  });

  const orderNumber = await test.step('see the confirmation', async () => {
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();

    const heading = page.getByRole('heading', { level: 2 });
    const number = ((await heading.first().textContent()) ?? '').trim();
    expect(number).toMatch(/^NE-\d{8}-\d+$/);

    return number;
  });

  await test.step('find it in order history', async () => {
    await page.goto('/shop/orders');

    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
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
 */
test('the verification page handles an invalid token and offers a resend', async ({ page }) => {
  await page.goto('/shop/verify-email?token=definitely-not-a-real-token');

  await expect(page.getByText('We could not verify this link')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send a new link' })).toBeVisible();
});
