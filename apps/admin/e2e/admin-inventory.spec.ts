import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures/browser-health';
import { route } from './origin';
import { adminApi, apiUrl, signInAsAdmin } from './fixtures/operations';
import { E2E_NAME_PREFIX, E2E_SKU_PREFIX, E2E_SLUG_PREFIX } from './fixtures/catalogue';

/**
 * `/inventory` — the money path that does not look like one.
 *
 * Stock is not a display field. It decides whether a customer can buy, what the
 * storefront's availability filter says, and what a picker is sent to find. An
 * adjustment that moves the number without writing the event leaves a ledger
 * that no longer explains the balance; an adjustment that writes the event
 * without moving the number leaves the opposite. Both are silent.
 *
 * So every spec here asserts BOTH ends: what the balance became, and what the
 * ledger says about how it got there — read back from the API, never from the
 * page that just claimed it.
 *
 * ## The floor at zero is asserted twice, on purpose
 *
 * The dialog refuses to submit a movement that would go negative, and the API
 * refuses to apply one. Those are different guarantees and only one of them
 * matters: a caller that is not this console — the mobile client, a script, a
 * future screen — meets the API alone. A spec that only proved the button was
 * disabled would be proving the courtesy and not the rule.
 */

const RUN = randomUUID().slice(0, 8);

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await adminApi();
});

test.afterAll(async () => {
  await api.dispose();
});

interface Subject {
  readonly id: string;
  readonly sku: string;
}

/**
 * A product of this suite's own, at a known stock level.
 *
 * Created through the API rather than the console — the exception `adminApi()`
 * asks callers to state. The screen under test is `/inventory`, and `/products`
 * has its own file proving the create path; driving a form here would be
 * testing that screen twice and this one no later.
 *
 * A product of its OWN rather than a seeded one, because the ledger assertions
 * need a product whose entire movement history this spec wrote. A seeded
 * product carries events from the order suites, and "the newest event is mine"
 * is a weaker claim than "these are all the events there are".
 */
async function aProductWithStock(label: string, onHand: number): Promise<Subject> {
  const sku = `${E2E_SKU_PREFIX}${RUN.toUpperCase()}-${label.toUpperCase()}`;

  const categories = await api.get(apiUrl('/admin/catalog/categories'));
  expect(categories.status()).toBe(200);
  const categoryId = ((await categories.json()) as { data: { id: string }[] }).data[0]?.id as string;
  expect(categoryId, 'the scratch catalogue has no categories').toBeDefined();

  const created = await api.post(apiUrl('/admin/catalog/products'), {
    data: {
      sku,
      slug: `${E2E_SLUG_PREFIX}${RUN}-${label}`,
      name: { en: `${E2E_NAME_PREFIX}Stock ${label} ${RUN}` },
      categoryId,
      basePrice: 5000,
    },
  });
  expect(created.status(), 'creating the product this spec adjusts').toBe(201);

  const id = ((await created.json()) as { data: { id: string } }).data.id;

  if (onHand > 0) {
    const seeded = await api.post(apiUrl(`/admin/inventory/${id}/adjust`), {
      data: {
        delta: onHand,
        // Prefixed so `global-teardown.ts` can find and reverse this movement
        // even if the product itself somehow survives.
        reason: `${E2E_SKU_PREFIX}opening balance for ${label}`,
        type: 'RESTOCK',
      },
    });
    expect(seeded.status(), 'setting the opening balance').toBe(200);
  }

  return { id, sku };
}

/** What the API says the product's stock is now. */
async function onHand(id: string): Promise<number> {
  const response = await api.get(apiUrl(`/admin/catalog/products/${id}`));
  expect(response.status()).toBe(200);

  return ((await response.json()) as { data: { stock: { onHand: number } } }).data.stock.onHand;
}

interface LedgerEvent {
  readonly type: string;
  readonly quantityDelta: number;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
  readonly reason: string;
}

/** The product's whole ledger, newest first, as the API holds it. */
async function ledger(id: string): Promise<LedgerEvent[]> {
  const response = await api.get(apiUrl(`/admin/inventory/${id}/events`));
  expect(response.status()).toBe(200);

  return ((await response.json()) as { data: LedgerEvent[] }).data;
}

/** Finds this product's row on the inventory screen. */
function rowFor(page: Page, sku: string) {
  return page.getByTestId('inventory-row').filter({ hasText: sku });
}

/**
 * Opens the adjust dialog on the row for `sku`.
 *
 * `inactive=true` because a product created through the API arrives UNPUBLISHED
 * — deliberately, since one with no images and no stock does not belong in a
 * customer's search results — and the stock screen hides unpublished rows by
 * default. Stock still has to be adjustable before a product is published, or
 * nothing could ever be published with any.
 */
async function openAdjust(page: Page, sku: string): Promise<void> {
  await page.goto(route(`/inventory?search=${encodeURIComponent(sku)}&inactive=true`));

  const row = rowFor(page, sku);
  await expect(row).toHaveCount(1);
  await row.getByTestId('inventory-adjust').click();
}

test.describe('the stock list', () => {
  test('shows the API’s own balance and the SERVER’s state, per row', async ({ page }) => {
    const subject = await aProductWithStock('list', 12);

    await signInAsAdmin(page);
    await page.goto(route(`/inventory?search=${encodeURIComponent(subject.sku)}&inactive=true`));

    const row = rowFor(page, subject.sku);
    await expect(row).toHaveCount(1);

    await expect(row.getByTestId('inventory-on-hand')).toHaveText(String(await onHand(subject.id)));
    await expect(row.getByTestId('inventory-sku')).toHaveText(subject.sku);

    /*
     * The state chip is the SERVER's `state`, which the component's own comment
     * says is never re-derived here — that re-derivation in five places is how
     * legacy produced five different answers. Twelve on hand against the
     * default threshold is IN_STOCK, and the assertion is on the attribute
     * rather than on the label, so a wording change does not silently become a
     * behaviour change.
     */
    await expect(row.getByTestId('inventory-state')).toHaveAttribute('data-state', 'IN_STOCK');
  });
});

test.describe('adjusting stock', () => {
  test('moves the balance AND writes a typed, explicable event', async ({ page }) => {
    const subject = await aProductWithStock('adjust', 10);

    await signInAsAdmin(page);
    await openAdjust(page, subject.sku);

    await page.getByTestId('adjust-type-RESTOCK').click();
    await page.getByTestId('adjust-in').click();
    await page.getByTestId('adjust-units').fill('7');
    await page.getByTestId('adjust-reason').fill(`${E2E_SKU_PREFIX}delivery from the supplier`);

    // The arithmetic the operator is shown BEFORE committing. It is the number
    // they are agreeing to, so it is asserted as a number and not as prose.
    await expect(page.getByTestId('adjust-projected')).toHaveText('17');

    await page.getByTestId('adjust-apply').click();

    await expect
      .poll(async () => onHand(subject.id), {
        message: 'the balance the API holds after the adjustment',
        timeout: 30_000,
      })
      .toBe(17);

    /*
     * And the LEDGER. A balance that moved without an event is a number nobody
     * can explain a year later, which is the failure the reason field exists to
     * prevent. `balanceBefore`/`balanceAfter` are RECORDED by the API, not
     * recomputed here, so asserting them proves the event describes the move
     * that actually happened.
     */
    const events = await ledger(subject.id);
    const newest = events[0] as LedgerEvent;

    expect(newest.type).toBe('RESTOCK');
    expect(newest.quantityDelta).toBe(7);
    expect(newest.balanceBefore).toBe(10);
    expect(newest.balanceAfter).toBe(17);
    expect(newest.reason).toContain('delivery from the supplier');
  });

  test('a DAMAGE movement is recorded as damage, not as a generic decrement', async ({ page }) => {
    const subject = await aProductWithStock('damage', 20);

    await signInAsAdmin(page);
    await openAdjust(page, subject.sku);

    await page.getByTestId('adjust-type-DAMAGE').click();
    await page.getByTestId('adjust-out').click();
    await page.getByTestId('adjust-units').fill('3');
    await page.getByTestId('adjust-reason').fill(`${E2E_SKU_PREFIX}water ingress on the top shelf`);
    await page.getByTestId('adjust-apply').click();

    await expect.poll(async () => onHand(subject.id), { timeout: 30_000 }).toBe(17);

    /*
     * The TYPE is the point. "Stock went down by three" and "three were
     * destroyed" are different facts, and a single generic movement type makes
     * the second permanently unrecoverable from the ledger.
     */
    const newest = (await ledger(subject.id))[0] as LedgerEvent;

    expect(newest.type).toBe('DAMAGE');
    expect(newest.quantityDelta).toBe(-3);
  });
});

test.describe('stock cannot go below zero', () => {
  test('the dialog says so and refuses to submit', async ({ page }) => {
    const subject = await aProductWithStock('floor-ui', 4);

    await signInAsAdmin(page);
    await openAdjust(page, subject.sku);

    await page.getByTestId('adjust-out').click();
    await page.getByTestId('adjust-units').fill('9');
    await page.getByTestId('adjust-reason').fill(`${E2E_SKU_PREFIX}more than there are`);

    await expect(page.getByTestId('adjust-projected')).toHaveText('-5');
    await expect(page.getByTestId('adjust-negative-warning')).toBeVisible();

    /*
     * DISABLED, not merely warned. A form that renders a warning beside a live
     * button is a form that lets the movement through on a fast click.
     */
    await expect(page.getByTestId('adjust-apply')).toBeDisabled();

    // And nothing moved, which the warning alone would not establish.
    expect(await onHand(subject.id)).toBe(4);
  });

  test('and the API refuses it too, for callers that are not this console', async () => {
    const subject = await aProductWithStock('floor-api', 4);

    /*
     * The guarantee that actually matters. The dialog's check is a courtesy to
     * the operator; this is the rule. A mobile client, a script or a future
     * screen meets the API alone, and the floor has to hold there.
     */
    const refused = await api.post(apiUrl(`/admin/inventory/${subject.id}/adjust`), {
      data: {
        delta: -9,
        reason: `${E2E_SKU_PREFIX}below the floor, on purpose`,
        type: 'DAMAGE',
      },
    });

    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'INSUFFICIENT_STOCK_FOR_ADJUSTMENT',
    );

    // Refused means refused: the balance is untouched and no event was written.
    expect(await onHand(subject.id)).toBe(4);
    expect(await ledger(subject.id)).toHaveLength(1);
  });
});

test.describe('the movement history', () => {
  test('shows every movement this product has had, with its own balances', async ({ page }) => {
    const subject = await aProductWithStock('history', 30);

    await signInAsAdmin(page);
    await openAdjust(page, subject.sku);

    await page.getByTestId('adjust-type-DAMAGE').click();
    await page.getByTestId('adjust-out').click();
    await page.getByTestId('adjust-units').fill('5');
    await page.getByTestId('adjust-reason').fill(`${E2E_SKU_PREFIX}dropped during picking`);
    await page.getByTestId('adjust-apply').click();

    await expect.poll(async () => onHand(subject.id), { timeout: 30_000 }).toBe(25);

    await page.goto(route(`/inventory?search=${encodeURIComponent(subject.sku)}&inactive=true`));
    await rowFor(page, subject.sku).getByTestId('inventory-history').click();

    const entries = page.getByTestId('history-event');

    /*
     * TWO, and exactly two: the opening balance and the damage. An assertion
     * that the newest one is present would pass on a drawer showing one event
     * out of two, and a half-shown ledger is the same lie as a wrong one.
     */
    await expect(entries).toHaveCount(2, { timeout: 30_000 });

    const damage = entries.first();
    await expect(damage).toHaveAttribute('data-event-type', 'DAMAGE');
    await expect(damage.getByTestId('history-delta')).toHaveText('-5');
    await expect(damage.getByTestId('history-balance-after')).toHaveText('25');
    await expect(damage.getByTestId('history-reason')).toContainText('dropped during picking');
  });

  test('a product with no movements says so, rather than showing an empty list', async ({
    page,
  }) => {
    const subject = await aProductWithStock('quiet', 0);

    await signInAsAdmin(page);
    await page.goto(route(`/inventory?search=${encodeURIComponent(subject.sku)}&inactive=true`));
    await rowFor(page, subject.sku).getByTestId('inventory-history').click();

    /*
     * "No movements recorded" is a CLAIM about a product, and the component's
     * own docstring says it is only made when the request succeeded and came
     * back empty. A failed request that rendered the same words would be
     * telling the operator something false about their stock.
     */
    await expect(page.getByTestId('history-empty')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('history-event')).toHaveCount(0);
  });
});
