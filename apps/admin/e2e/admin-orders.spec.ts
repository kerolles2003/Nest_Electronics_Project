import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures/browser-health';
import { route } from './origin';
import {
  DEV_ADMIN_NAME,
  placeOrder,
  readOrderAsAdmin,
  signInAsAdmin,
  type PlacedOrder,
} from './fixtures/operations';

/**
 * The order an API customer places, worked from this console.
 *
 * ## The acceptance criterion
 *
 * Since T2 the storefront has placed orders in Mongo through the API while this
 * console read Supabase, so **every order a customer placed was invisible to
 * the console that exists to fulfil it**. These specs place real orders through
 * the same calls the storefront's checkout makes and then drive them through
 * the lifecycle in the browser.
 *
 * ## Every money and status assertion is scoped to an element
 *
 * Not one of them is a substring of the page. `toContainText('50.00 EGP')` on a
 * whole page is satisfied by a line total, a subtotal, a shipping fee or a
 * grand total — indifferently — which is how seven vacuous assertions got into
 * this repository. Every check below names a `data-testid`, so it is about the
 * field it claims to be about.
 */

const RUN_ID = randomUUID().slice(0, 8);

/** A carrier and tracking number distinctive enough to assert on. */
const CARRIER = 'Bosta';
const TRACKING = `BST-${RUN_ID}`;

async function openOrder(page: import('@playwright/test').Page, order: PlacedOrder): Promise<void> {
  await page.goto(route(`/orders/${order.id}`));
  await expect(page.getByTestId('order-number')).toHaveText(order.orderNumber);
}

/** Presses one lifecycle button and waits for the status to actually move. */
async function act(
  page: import('@playwright/test').Page,
  action: string,
  expected: string,
): Promise<void> {
  await page.getByTestId(`action-${action}`).click();
  await expect(page.getByTestId('order-status')).toHaveText(expected, { timeout: 30_000 });
}

test.describe('the work queue', () => {
  test('an order placed through the API appears here, with the server’s own total', async ({
    page,
  }) => {
    const order = await placeOrder(RUN_ID, 'queue');

    await signInAsAdmin(page);
    await page.goto(route('/orders?status=PLACED'));

    const row = page.getByTestId('order-row').filter({ hasText: order.orderNumber });

    await expect(row).toHaveCount(1);

    /*
     * SCOPED to the total cell of THIS row. The same amount very plausibly
     * appears elsewhere on the page — another order of the same product, a
     * count, a tile — and a page-wide substring check would pass on any of them.
     */
    await expect(row.getByTestId('order-total')).toHaveText(order.grandTotalFormatted);
    await expect(row.getByTestId('order-status')).toHaveText('PLACED');
    await expect(row.getByTestId('order-payment')).toHaveText('PENDING');
  });

  test('filters the queue by status, and the filter is the server’s', async ({ page }) => {
    const order = await placeOrder(RUN_ID, 'filter');

    await signInAsAdmin(page);
    await page.goto(route('/orders?status=DELIVERED'));

    // A PLACED order must not appear under DELIVERED.
    await expect(
      page.getByTestId('order-row').filter({ hasText: order.orderNumber }),
    ).toHaveCount(0);

    await page.goto(route('/orders?status=PLACED'));
    await expect(
      page.getByTestId('order-row').filter({ hasText: order.orderNumber }),
    ).toHaveCount(1);
  });

  test('an unknown status in the URL is ignored rather than obeyed', async ({ page }) => {
    const order = await placeOrder(RUN_ID, 'badstatus');

    await signInAsAdmin(page);
    await page.goto(route('/orders?status=pending_payment'));

    /*
     * `pending_payment` is the LEGACY vocabulary. Passing it through to the API
     * would be a 400; treating it as "no filter" is what the page does, so the
     * unfiltered queue renders and the order is in it.
     */
    await expect(
      page.getByTestId('order-row').filter({ hasText: order.orderNumber }),
    ).toHaveCount(1);
  });
});

test.describe('the lifecycle, walked in the browser', () => {
  test('confirm → ship → deliver, with the cash collected on delivery', async ({ page }) => {
    const order = await placeOrder(RUN_ID, 'walk');

    await signInAsAdmin(page);
    await openOrder(page, order);

    await expect(page.getByTestId('order-status')).toHaveText('PLACED');
    await expect(page.getByTestId('payment-status')).toHaveText('PENDING');

    // --- confirm ----------------------------------------------------------
    await page.getByTestId('note').fill('Customer confirmed by phone.');
    await act(page, 'confirm', 'CONFIRMED');

    // --- ship -------------------------------------------------------------
    await page.getByTestId('carrier').fill(CARRIER);
    await page.getByTestId('tracking-number').fill(TRACKING);
    await act(page, 'ship', 'SHIPPED');

    await expect(page.getByTestId('shipment-carrier')).toHaveText(CARRIER);
    await expect(page.getByTestId('shipment-tracking')).toHaveText(TRACKING);

    // --- deliver ----------------------------------------------------------
    await act(page, 'deliver', 'DELIVERED');

    /*
     * ADR-ORDER-002. Under COD the courier does not hand over goods without
     * collecting, so delivery IS the payment event and the API sets both in one
     * atomic write. There is no "mark as paid" control, and this is what proves
     * there does not need to be.
     */
    await expect(page.getByTestId('payment-status')).toHaveText('PAID');

    // The frozen total did not move because the order did.
    await expect(page.getByTestId('grand-total')).toHaveText(order.grandTotalFormatted);
  });

  test('records WHO made each transition, from the token', async ({ page }) => {
    const order = await placeOrder(RUN_ID, 'attribution');

    await signInAsAdmin(page);
    await openOrder(page, order);

    await act(page, 'confirm', 'CONFIRMED');

    /*
     * The console sends no actor — there is no field for one. The API derives
     * it from the token and writes it in the same guarded update as the status
     * change, which is what makes the trail unforgeable. This is the first time
     * any screen in this console could answer "who confirmed this order".
     */
    const actors = page.getByTestId('history-actor');

    await expect(actors.first()).toContainText(DEV_ADMIN_NAME);
    await expect(actors.first()).toContainText('super admin');

    // And the placement entry is the CUSTOMER's, not staff's.
    await expect(actors.last()).not.toContainText(DEV_ADMIN_NAME);
  });

  test('the shipment carries the tracking the operator typed', async ({ page }) => {
    const order = await placeOrder(RUN_ID, 'tracking');

    await signInAsAdmin(page);
    await openOrder(page, order);

    await act(page, 'confirm', 'CONFIRMED');

    // The API makes carrier and tracking a PRECONDITION of `SHIPPED` — the fix
    // for the legacy defect where shipping WITH a tracking number was
    // impossible (F-CRIT-4). The button stays disabled until both are present.
    await expect(page.getByTestId('action-ship')).toBeDisabled();

    await page.getByTestId('carrier').fill(CARRIER);
    await expect(page.getByTestId('action-ship')).toBeDisabled();

    await page.getByTestId('tracking-number').fill(TRACKING);
    await expect(page.getByTestId('action-ship')).toBeEnabled();

    await act(page, 'ship', 'SHIPPED');
    await expect(page.getByTestId('shipment-tracking')).toHaveText(TRACKING);
  });

  test('a failed delivery counts attempts and can be re-dispatched', async ({ page }) => {
    const order = await placeOrder(RUN_ID, 'failed');

    await signInAsAdmin(page);
    await openOrder(page, order);

    await act(page, 'confirm', 'CONFIRMED');
    await page.getByTestId('carrier').fill(CARRIER);
    await page.getByTestId('tracking-number').fill(TRACKING);
    await act(page, 'ship', 'SHIPPED');

    await expect(page.getByTestId('delivery-attempts')).toHaveText('0');

    await page.getByTestId('reason').fill('Customer unreachable on three call attempts.');
    await act(page, 'delivery-failed', 'DELIVERY FAILED');

    await expect(page.getByTestId('delivery-attempts')).toHaveText('1');

    // Re-dispatch. Carrier and tracking are optional on THIS edge only.
    await act(page, 'retry-shipment', 'SHIPPED');

    // Deliberately NOT reset: the count is what the courier attempted, and
    // zeroing it would erase the reason this order is going out again.
    await expect(page.getByTestId('delivery-attempts')).toHaveText('1');
  });
});

test.describe('the console has no state machine of its own', () => {
  test('offers only the moves the SERVER says are available', async ({ page }) => {
    const order = await placeOrder(RUN_ID, 'moves');

    await signInAsAdmin(page);
    await openOrder(page, order);

    /*
     * The buttons on screen are compared against `allowedTransitions` read
     * straight from the API. Two state machines that must agree eventually
     * disagree — this console used to hold two copies of the matrix itself,
     * which had already drifted — so the check is that the screen holds none.
     */
    const fromApi = (await readOrderAsAdmin(order.id))['allowedTransitions'] as {
      action: string | null;
    }[];

    const expected = fromApi
      .map((move) => move.action)
      .filter((action): action is string => action !== null)
      .sort();

    const onScreen = (
      await page.getByTestId(/^action-/).evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-testid')?.replace('action-', '') ?? ''),
      )
    ).sort();

    expect(onScreen).toEqual(expected);
    expect(expected.length, 'a PLACED order must offer something').toBeGreaterThan(0);
  });

  test('a legal-but-unroutable move is stated, not offered as a button', async ({ page }) => {
    const order = await placeOrder(RUN_ID, 'unroutable');

    await signInAsAdmin(page);
    await openOrder(page, order);

    /*
     * The matrix permits a staff actor to cancel a PLACED order, and this API
     * exposes no staff route for it — cancelling is the customer's own
     * operation (§13). The console says so rather than drawing a button that
     * would post to nothing.
     */
    await expect(page.getByTestId('unroutable-moves')).toContainText('cancelled');
    await expect(page.getByTestId('action-none')).toHaveCount(0);
  });

  test('a terminal order offers nothing, and says that is the answer', async ({ page }) => {
    const order = await placeOrder(RUN_ID, 'terminal');

    await signInAsAdmin(page);
    await openOrder(page, order);

    await act(page, 'confirm', 'CONFIRMED');
    await page.getByTestId('carrier').fill(CARRIER);
    await page.getByTestId('tracking-number').fill(TRACKING);
    await act(page, 'ship', 'SHIPPED');
    await act(page, 'deliver', 'DELIVERED');

    await page.getByTestId('reason').fill('Customer returned it within the window.');
    await act(page, 'return', 'RETURNED');

    await expect(page.getByTestId('terminal-order')).toBeVisible();
    await expect(page.getByTestId(/^action-/)).toHaveCount(0);
  });
});

test.describe('a forbidden transition', () => {
  test('is refused by the SERVER and rendered, not swallowed', async ({ page }) => {
    /*
     * The refusal is provoked honestly: two browser contexts on the same order.
     * The first confirms it; the second is still showing a PLACED order and
     * still offering "confirm", so pressing it asks the server to repeat a
     * transition that already happened — `409 INVALID_STATE_TRANSITION`, which
     * the API documents as never succeeding on retry.
     *
     * This is not a contrived state. It is exactly what two operators working
     * the same queue produce, and before this change the console would have
     * decided the answer itself from a local map.
     */
    const order = await placeOrder(RUN_ID, 'conflict');

    await signInAsAdmin(page);
    await openOrder(page, order);
    await expect(page.getByTestId('action-confirm')).toBeVisible();

    // Somebody else confirms it, out of band.
    const other = await page.context().browser()?.newContext();

    if (other === undefined) throw new Error('could not open a second context');

    try {
      const otherPage = await other.newPage();
      await signInAsAdmin(otherPage);
      await otherPage.goto(route(`/orders/${order.id}`));
      await otherPage.getByTestId('action-confirm').click();
      await expect(otherPage.getByTestId('order-status')).toHaveText('CONFIRMED', {
        timeout: 30_000,
      });
    } finally {
      await other.close();
    }

    // This page is still showing the stale view. Press the button it still has.
    await page.getByTestId('action-confirm').click();

    /*
     * The refusal is RENDERED — in place, where the operator is looking, not
     * only as a toast that may already have gone. And it says what to do next.
     */
    const refusal = page.getByTestId('action-refusal');

    await expect(refusal).toBeVisible({ timeout: 30_000 });
    await expect(refusal).toContainText(/reload/i);

    // The order did not move twice.
    await page.reload();
    await expect(page.getByTestId('order-status')).toHaveText('CONFIRMED');

    // Exactly one CONFIRMED entry in the trail — the second attempt wrote
    // nothing, which is the guarantee the 409 is protecting.
    const history = (await readOrderAsAdmin(order.id))['statusHistory'] as { to: string }[];

    expect(history.filter((entry) => entry.to === 'CONFIRMED')).toHaveLength(1);
  });
});
