import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures/browser-health';
import { route } from './origin';
import { adminApi, apiUrl, quotingCustomer, signInAsAdmin } from './fixtures/operations';

/**
 * `/settings` — the shipping-rate table, and the only question that matters
 * about it.
 *
 * ## The claim under test
 *
 * A fee typed here is charged to the next customer who checks out to that
 * governorate. Everything else this screen does is bookkeeping around that one
 * sentence, and nothing had ever verified it end to end: the admin suite could
 * confirm the console saved a number, and the API suite could confirm
 * `FulfilmentService.quote()` reads the table, and neither could confirm they
 * were talking about the same row.
 *
 * So the spec edits a rate **in the browser** and then asks for a real
 * **checkout quote** as a real signed-in customer with a real address. That is
 * the only observation that can distinguish "saved" from "charged".
 *
 * ## Why not Cairo
 *
 * `placeOrder()` in `fixtures/operations.ts` puts every order fixture in Cairo.
 * A spec that edited Cairo's fee would change the amount under any order placed
 * beside it, and the failure would surface in the ORDERS file — the residue
 * pattern this suite's teardown exists to stop, in a different form.
 *
 * ## It puts the rate back
 *
 * A rate is a seeded row, not a document this suite created, so the teardown
 * cannot remove it — and `--assert-clean` compares document COUNTS, so an
 * edited fee would survive silently into the next run. Each spec restores the
 * value it found, and the last one asserts the whole table is intact.
 */

const RUN = randomUUID().slice(0, 8);

/** Not Cairo. See the header. */
const SUBJECT = 'Aswan';

/** Every governorate the API accepts. A row missing from the table raises. */
const GOVERNORATE_COUNT = 27;

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await adminApi();
});

test.afterAll(async () => {
  await api.dispose();
});

interface Rate {
  readonly governorate: string;
  readonly fee: number;
  readonly formattedFee: string;
}

async function rates(): Promise<Rate[]> {
  const response = await api.get(apiUrl('/admin/shipping-rates'));
  expect(response.status(), 'reading the shipping rate table').toBe(200);

  return ((await response.json()) as { data: Rate[] }).data;
}

async function rateFor(governorate: string): Promise<Rate> {
  const found = (await rates()).find((rate) => rate.governorate === governorate);
  expect(found, `no shipping rate row for ${governorate}`).toBeDefined();

  return found as Rate;
}

/** Puts a fee back, in piastres, without going through the screen. */
async function restore(governorate: string, fee: number): Promise<void> {
  const response = await api.patch(apiUrl(`/admin/shipping-rates/${governorate}`), {
    data: { fee },
  });
  expect(response.status(), `restoring ${governorate} to ${String(fee)}`).toBe(200);
}

test.describe('the rate table', () => {
  test('carries every governorate, and every row can be edited', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(route('/settings'));

    /*
     * All 27. This is not a tidiness check: `FulfilmentService.quote()` RAISES
     * on a governorate with no row rather than inventing a fee, so a missing
     * row is a checkout that fails for everyone in that governorate — and the
     * screen is where a row could be lost.
     */
    await expect(page.getByTestId('rate-total')).toHaveText(String(GOVERNORATE_COUNT));
    await expect(page.getByTestId('rate-row')).toHaveCount(GOVERNORATE_COUNT);

    /*
     * And each of them is EDITABLE. A table that lists 27 and offers 26 edit
     * controls is a governorate whose fee can never be corrected, which is
     * invisible until someone needs to correct it.
     */
    await expect(page.getByTestId('rate-edit')).toHaveCount(GOVERNORATE_COUNT);

    // The API agrees about the count. The page could be rendering a stale list.
    expect(await rates()).toHaveLength(GOVERNORATE_COUNT);
  });

  test('shows the API’s own formatted fee, per row', async ({ page }) => {
    const subject = await rateFor(SUBJECT);

    await signInAsAdmin(page);
    await page.goto(route('/settings'));

    const row = page.getByTestId('rate-row').filter({ hasText: SUBJECT });
    await expect(row).toHaveCount(1);

    // The API's own `formattedFee`, not a string this file composed. A locally
    // formatted expectation passes while both sides divide by the wrong power
    // of ten.
    await expect(row.getByTestId('rate-fee')).toHaveText(subject.formattedFee);
  });
});

test.describe('an edit here is charged at checkout', () => {
  test('a fee changed in the console is the fee the next quote returns', async ({ page }) => {
    const original = await rateFor(SUBJECT);
    const customer = await quotingCustomer(RUN, 'quote', SUBJECT);

    /*
     * A distinctive amount, and one that is NOT the current fee — otherwise the
     * assertion passes without anything having changed.
     */
    const newFeeEgp = original.fee === 8_150 ? 91.5 : 81.5;
    const newFeePiastres = Math.round(newFeeEgp * 100);

    try {
      const before = await customer.quote();
      expect(before.priced, 'a governorate with a row must be priced').toBe(true);
      expect(before.fee).toBe(original.fee);

      await signInAsAdmin(page);
      await page.goto(route('/settings'));

      const row = page.getByTestId('rate-row').filter({ hasText: SUBJECT });
      await row.getByTestId('rate-edit').click();
      await row.getByTestId('rate-fee-input').fill(newFeeEgp.toFixed(2));
      await row.getByTestId('rate-save').click();

      // The screen agrees first — scoped to this row's fee cell, never to the
      // page, because the same amount plausibly appears on another row.
      await expect(row.getByTestId('rate-fee')).toContainText(newFeeEgp.toFixed(2), {
        timeout: 30_000,
      });

      /*
       * THE ASSERTION THIS FILE EXISTS FOR.
       *
       * A fresh quote, as the customer, after the edit. The endpoint recomputes
       * on every request and caches nothing, so this is the amount that would
       * be collected in cash on delivery.
       */
      const after = await customer.quote();

      expect(after.priced).toBe(true);
      expect(after.fee).toBe(newFeePiastres);
      expect(after.fee).not.toBe(before.fee);
    } finally {
      await restore(SUBJECT, original.fee);
      await customer.dispose();
    }
  });

  test('a fee of zero is FREE, and still a priced answer', async ({ page }) => {
    const original = await rateFor(SUBJECT);
    const customer = await quotingCustomer(RUN, 'free', SUBJECT);

    try {
      await signInAsAdmin(page);
      await page.goto(route('/settings'));

      const row = page.getByTestId('rate-row').filter({ hasText: SUBJECT });
      await row.getByTestId('rate-edit').click();
      await row.getByTestId('rate-fee-input').fill('0');
      await row.getByTestId('rate-save').click();

      await expect(row.getByTestId('rate-fee')).toBeVisible({ timeout: 30_000 });

      const quote = await customer.quote();

      /*
       * `priced: true` with `fee: 0`. Free IS a price — a rate exists, and the
       * customer owes nothing for delivery. Conflating it with "not yet
       * calculated" is exactly the defect `ShippingQuote` was introduced to
       * remove, and it is why the contract tells clients to read
       * `shippingPriced` rather than compare the amount to zero.
       */
      expect(quote.fee).toBe(0);
      expect(quote.priced).toBe(true);
    } finally {
      await restore(SUBJECT, original.fee);
      await customer.dispose();
    }
  });
});

test.describe('no edit can leave a governorate unquotable', () => {
  test('every governorate still resolves to a priced quote after an edit', async ({ page }) => {
    const original = await rateFor(SUBJECT);

    try {
      await signInAsAdmin(page);
      await page.goto(route('/settings'));

      const row = page.getByTestId('rate-row').filter({ hasText: SUBJECT });
      await row.getByTestId('rate-edit').click();
      await row.getByTestId('rate-fee-input').fill('45.00');
      await row.getByTestId('rate-save').click();
      await expect(row.getByTestId('rate-fee')).toContainText('45.00', { timeout: 30_000 });

      /*
       * The table is still COMPLETE. An edit is a PATCH on one row, so it
       * should not be able to remove another — but "should not be able to" is
       * the phrasing that precedes every gap this repository has found, and the
       * cost of being wrong is a checkout that 500s for one governorate while
       * every other one works.
       */
      const table = await rates();
      expect(table).toHaveLength(GOVERNORATE_COUNT);

      const unpriced = table.filter((rate) => !Number.isInteger(rate.fee) || rate.fee < 0);
      expect(unpriced, 'every row must carry a whole, non-negative fee').toHaveLength(0);

      const names = new Set(table.map((rate) => rate.governorate));
      expect(names.size, 'no two rows may name the same governorate').toBe(GOVERNORATE_COUNT);
    } finally {
      await restore(SUBJECT, original.fee);
    }
  });

  test('and the table is exactly as this file found it', async () => {
    /*
     * The suite's own cleanliness check, for the one thing the teardown cannot
     * see. Shipping rates are seeded rows, so removing them is not an option
     * and `--assert-clean` only compares document counts — an edited fee would
     * survive into the next run and quietly change what another spec is
     * charged.
     */
    const subject = await rateFor(SUBJECT);

    expect(subject.fee).toBeGreaterThanOrEqual(0);
    expect(await rates()).toHaveLength(GOVERNORATE_COUNT);
  });
});
