import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures/browser-health';
import { route } from './origin';
import { adminApi, apiUrl, placeOrder, signInAsAdmin } from './fixtures/operations';
import type { PlacedOrder } from './fixtures/operations';

/**
 * `/customers` — and the 100× error this screen printed on every row.
 *
 * ## What happened, and why a browser test is the only thing that catches it
 *
 * `totalSpent` is documented by the API as *lifetime spend in MINOR UNITS*. The
 * table printed it as `EGP {total.toLocaleString()}`. Every figure on the screen
 * was a hundred times the real one — fifty pounds shown as "EGP 5,000" — and the
 * stat strip above the table had the same defect independently, found one commit
 * apart.
 *
 * Nothing failed. The API was right, the number was right, the type was right;
 * a unit test on either side passes while the screen lies. The only place the
 * mistake exists is the boundary, and the only observation that crosses it is a
 * rendered page.
 *
 * The fix was to send `formattedTotalSpent` — a STRING, so there is nothing left
 * to divide by anything. That fix has had **no coverage at all** until this file.
 *
 * ## So the assertion is not "the cell contains a number"
 *
 * It is that the cell equals the string the SERVER formatted, and — separately —
 * that the amount is not a hundred times the real one. The second assertion is
 * written out explicitly rather than left implicit in the first, because "equals
 * the server's string" would keep passing if somebody re-derived the string here
 * from the same minor units. A test that repeats the bug it is checking for is
 * how the bug survived twice.
 */

const RUN = randomUUID().slice(0, 8);

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await adminApi();
});

test.afterAll(async () => {
  await api.dispose();
});

interface CustomerSummary {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly orderCount: number;
  readonly totalSpent: number;
  readonly formattedTotalSpent: string;
}

/**
 * Drives one order to DELIVERED, through the API.
 *
 * Lifetime spend and delivered revenue both count DELIVERED orders — a placed
 * one contributes nothing, which is correct under cash on delivery: no money
 * has changed hands until the courier collects it. So a spec about money on
 * this screen needs an order that actually completed.
 *
 * The lifecycle itself is `admin-orders.spec.ts`'s subject and is walked in the
 * browser there. Here it is a precondition, so it goes through the API — the
 * exception `adminApi()` asks callers to state.
 */
async function deliver(order: PlacedOrder): Promise<void> {
  for (const step of ['confirm', 'ship', 'deliver']) {
    const body =
      step === 'ship' ? { carrier: 'Bosta', trackingNumber: `BST-${RUN}` } : {};

    const response = await api.post(apiUrl(`/admin/orders/${order.id}/${step}`), { data: body });
    expect(response.status(), `driving the order to ${step}`).toBe(200);
  }
}

/** The API's own summary for one customer, found by the address the run used. */
async function summaryFor(email: string): Promise<CustomerSummary> {
  const response = await api.get(apiUrl(`/admin/customers?q=${encodeURIComponent(email)}&limit=5`));
  expect(response.status(), 'reading the customer list from the API').toBe(200);

  const rows = ((await response.json()) as { data: CustomerSummary[] }).data;
  const found = rows.find((row) => row.email === email);

  expect(found, `no customer summary for ${email}`).toBeDefined();

  return found as CustomerSummary;
}

test.describe('lifetime spend', () => {
  test('is the SERVER’s formatted string, and is not a hundred times the truth', async ({
    page,
  }) => {
    /*
     * A real order through the real checkout, so `totalSpent` is a real figure
     * rather than a number typed into a database. The amount does not matter;
     * what matters is that it is large enough for a 100× error to be visible,
     * and every seeded product is.
     */
    const order = await placeOrder(RUN, 'spend');
    await deliver(order);

    const summary = await summaryFor(order.customerEmail);

    expect(summary.orderCount).toBeGreaterThanOrEqual(1);
    expect(
      summary.totalSpent,
      'lifetime spend counts DELIVERED orders — nothing to assert about if it is zero',
    ).toBeGreaterThan(0);

    await signInAsAdmin(page);
    await page.goto(route(`/customers?search=${encodeURIComponent(order.customerEmail)}`));

    const row = page.getByTestId('customer-row');
    await expect(row).toHaveCount(1);

    // 1. The server's own string, scoped to the spend cell. Not a page
    //    substring: the same amount appears in the stat strip above.
    await expect(row.getByTestId('customer-spent')).toHaveText(summary.formattedTotalSpent);

    /*
     * 2. And it is NOT the minor-unit figure. This is the assertion that would
     *    have failed before the fix, and it is deliberately independent of the
     *    one above: if somebody re-derived the displayed string here from
     *    `totalSpent`, the first assertion would still pass.
     *
     *    `totalSpent` is piastres. Rendering it directly gives a number a
     *    hundred times too large, so the cell must not contain that digit
     *    sequence anywhere.
     */
    const minorUnits = String(summary.totalSpent);
    const shown = (await row.getByTestId('customer-spent').textContent()) ?? '';

    expect(
      shown.replace(/[,\s]/g, ''),
      `the cell shows the MINOR-UNIT figure — this is the 100× defect, back`,
    ).not.toContain(minorUnits);

    // 3. And it parses to the major-unit amount, to the piastre.
    const parsed = Number.parseFloat(shown.replace(/[^\d.]/g, ''));
    expect(Math.round(parsed * 100)).toBe(summary.totalSpent);
  });

  test('the order count beside it is the API’s own count', async ({ page }) => {
    const order = await placeOrder(RUN, 'count');
    const summary = await summaryFor(order.customerEmail);

    await signInAsAdmin(page);
    await page.goto(route(`/customers?search=${encodeURIComponent(order.customerEmail)}`));

    const row = page.getByTestId('customer-row');
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('customer-order-count')).toHaveText(String(summary.orderCount));
    await expect(row.getByTestId('customer-name')).toHaveText(summary.fullName);
  });
});

test.describe('the stat strip', () => {
  test('delivered revenue is a formatted string, never an amount this page divided', async ({
    page,
  }) => {
    // A delivered order, so the figure is non-zero: a 100× error on zero is
    // still zero, and an assertion that cannot fail is not one.
    await deliver(await placeOrder(RUN, 'revenue'));

    const dashboard = await api.get(apiUrl('/admin/dashboard/stats'));
    expect(dashboard.status()).toBe(200);

    const stats = (
      (await dashboard.json()) as {
        data: { revenue: { delivered: { amount: number; formatted: string } } };
      }
    ).data;

    await signInAsAdmin(page);
    await page.goto(route('/customers'));

    /*
     * The same defect as the table cell, one card along, found one commit
     * apart. `revenue.delivered.amount` is piastres; the card printed
     * `EGP ${amount.toLocaleString()}` and read "EGP 5,000" for fifty pounds.
     */
    expect(
      stats.revenue.delivered.amount,
      'the window must contain the order just delivered',
    ).toBeGreaterThan(0);

    await expect(page.getByTestId('stat-revenue')).toHaveText(stats.revenue.delivered.formatted);

    const shown = (await page.getByTestId('stat-revenue').textContent()) ?? '';
    expect(
      shown.replace(/[,\s]/g, ''),
      'the revenue card shows the MINOR-UNIT figure',
    ).not.toContain(String(stats.revenue.delivered.amount));
  });

  test('the counts are counts, and come from the aggregate the page names', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(route('/customers'));

    /*
     * Read AFTER the page rendered, and from the same endpoint the page uses.
     * The first version compared the card against `/admin/customers` meta,
     * which is a different figure — and read it before the page loaded, so two
     * of this run's own customers landed in between. The card was right and the
     * test was wrong, which is the failure mode a scoped assertion is supposed
     * to make obvious.
     */
    const dashboard = await api.get(apiUrl('/admin/dashboard/stats'));
    expect(dashboard.status()).toBe(200);

    const customers = (
      (await dashboard.json()) as { data: { customers: { total: number; newThisWeek: number } } }
    ).data.customers;

    /*
     * Scoped per card. An unscoped number check on this page matches four
     * cards, a pagination control and a row count indifferently — the shape of
     * assertion that let both money defects through.
     *
     * A range rather than equality: this suite creates customers as it runs, so
     * pinning the exact number would make the assertion about test ordering.
     * What must hold is that the card carries the aggregate's own count and not
     * something else — a page count, a window count, or a zero.
     */
    const shown = Number.parseInt(
      (await page.getByTestId('stat-total').textContent()) ?? 'NaN',
      10,
    );

    expect(Number.isInteger(shown)).toBe(true);
    expect(shown).toBeGreaterThanOrEqual(customers.newThisWeek);
    expect(Math.abs(shown - customers.total)).toBeLessThanOrEqual(4);
  });
});

test.describe('search', () => {
  test('a search that matches nobody says so rather than listing everybody', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(route(`/customers?search=${encodeURIComponent(`nobody-${RUN}@example.invalid`)}`));

    await expect(page.getByTestId('customer-row')).toHaveCount(0);
  });
});
