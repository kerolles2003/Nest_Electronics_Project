'use server';

import { revalidatePath } from 'next/cache';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/api/identity';
import type { AdminOrder } from '@/lib/api/types';

/**
 * The six order lifecycle actions, on the API.
 *
 * ## What this replaces, and why none of it survived
 *
 * `order.actions.ts` held three Supabase actions — order status, payment status
 * and fulfilment status — over three independent columns, and **two copies** of
 * a transition map: one here and one in `OrderDetail.tsx`. Both were deleted
 * with it. Every part of that design was a defect:
 *
 *   - **Three status axes.** 7 x 6 x 5 = 210 combinations with no cross-field
 *     validation anywhere, and live legacy data already held incoherent ones
 *     (shipped-but-unpaid, delivered-but-unfulfilled). The API has one
 *     fulfilment axis and a separate payment axis, and delivery sets both in
 *     one atomic write.
 *   - **The transition matrix lived in the client.** The underlying RPC was
 *     callable by the `anon` role, so the whole state machine was advisory —
 *     anybody who skipped the UI skipped the rules (F-CRIT-1 / F-HIGH-1).
 *   - **Two copies of it.** They had already drifted from each other.
 *
 * There is no transition map in this application now. The API returns
 * `allowedTransitions` on every order, computed by the same function its engine
 * calls before it writes, and the screen renders buttons from that. Two state
 * machines that must agree eventually disagree; there is one.
 *
 * ## No actor is ever sent
 *
 * None of these calls carries an admin id. The API resolves the operator from
 * the TOKEN and writes `{id, role, name}` onto the order's status history in
 * the same guarded update as the status change. Legacy passed `p_admin_id`
 * from the client and never verified it, so the trail was forgeable (F-MED-5).
 *
 * `requireAdmin()` is still called first — not to obtain an id to send, but so
 * an expired session fails here, with a message, rather than as a 401 the form
 * has to interpret.
 */

export interface OrderActionResult {
  ok: boolean;
  /** Present when `ok` is false. Already phrased for an operator. */
  error?: string;
  /** The updated order, so the caller can re-render without a round trip. */
  order?: AdminOrder;
}

/**
 * Every lifecycle action does the same four things, so they are written once.
 *
 * The `revalidatePath` calls matter more here than on most screens: the queue
 * and the detail page are the same data, and an operator who confirms an order
 * and goes back to a cached list showing it still `PLACED` will confirm it
 * again — which the API refuses with a 409, correctly, and which reads as the
 * console being broken.
 */
async function run(
  orderId: string,
  call: () => Promise<{ data: AdminOrder }>,
): Promise<OrderActionResult> {
  await requireAdmin();

  const result = await tryApi(call);

  if (!result.ok) {
    return { ok: false, error: operatorMessage(result.error) };
  }

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);

  return { ok: true, order: result.data.data };
}

/** T1 `PLACED -> CONFIRMED`. The real Cash-on-Delivery step: somebody phoned. */
export async function confirmOrderAction(
  orderId: string,
  note?: string,
): Promise<OrderActionResult> {
  return run(orderId, () => api.confirmOrder(orderId, note));
}

/**
 * T3 `CONFIRMED -> SHIPPED`.
 *
 * `carrier` and `trackingNumber` are required by the API — they are a
 * precondition of the state, not a decoration, which is the fix for the legacy
 * defect where the tracking column did not exist and shipping WITH a tracking
 * number was impossible (F-CRIT-4). They are checked here too so the operator
 * gets a field-level message instead of a 400.
 */
export async function shipOrderAction(
  orderId: string,
  input: { carrier: string; trackingNumber: string; note?: string },
): Promise<OrderActionResult> {
  const carrier = input.carrier.trim();
  const trackingNumber = input.trackingNumber.trim();

  if (carrier === '' || trackingNumber === '') {
    return { ok: false, error: 'A carrier and a tracking number are both required to dispatch.' };
  }

  return run(orderId, () => api.shipOrder(orderId, { carrier, trackingNumber, ...noteOf(input.note) }));
}

/**
 * T5 `SHIPPED -> DELIVERED`.
 *
 * **This collects the cash.** Under COD the courier does not hand over goods
 * without collecting, so the API sets `payment.status = PAID` and
 * `payment.collectedAt` in the SAME atomic write as the status change. There is
 * no separate "mark as paid" action here, and there must not be: that is what
 * made "delivered but unpaid" representable in legacy, and it existed in live
 * data.
 *
 * If cash was not collected, the order was not delivered — use
 * `failDeliveryAction`.
 */
export async function deliverOrderAction(
  orderId: string,
  note?: string,
): Promise<OrderActionResult> {
  return run(orderId, () => api.deliverOrder(orderId, note));
}

/** T6 `SHIPPED -> DELIVERY_FAILED`. `reason` is required and is recorded. */
export async function failDeliveryAction(
  orderId: string,
  reason: string,
): Promise<OrderActionResult> {
  const trimmed = reason.trim();

  if (trimmed.length < 3) {
    return { ok: false, error: 'Say why the delivery failed — it is recorded on the order.' };
  }

  return run(orderId, () => api.failDelivery(orderId, trimmed));
}

/**
 * T7 `DELIVERY_FAILED -> SHIPPED`. Re-dispatch.
 *
 * Carrier and tracking are optional here and only here. `deliveryAttempts` is
 * never reset — it counts what the courier actually attempted, and zeroing it
 * would erase the reason this order is going out again.
 */
export async function retryShipmentAction(
  orderId: string,
  input: { carrier?: string; trackingNumber?: string; note?: string } = {},
): Promise<OrderActionResult> {
  return run(orderId, () => api.retryShipment(orderId, input));
}

/**
 * T8 / T9 `-> RETURNED`. **Restores stock**, in one transaction with the status
 * change, exactly once however many times it is called.
 */
export async function returnOrderAction(
  orderId: string,
  reason: string,
): Promise<OrderActionResult> {
  const trimmed = reason.trim();

  if (trimmed.length < 3) {
    return { ok: false, error: 'Say why the goods came back — it is recorded on the order.' };
  }

  return run(orderId, () => api.returnOrder(orderId, trimmed));
}

function noteOf(note: string | undefined): { note?: string } {
  const trimmed = note?.trim() ?? '';

  return trimmed === '' ? {} : { note: trimmed };
}
