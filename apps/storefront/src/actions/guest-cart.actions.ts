'use server';

import { revalidatePath } from 'next/cache';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import {
  normaliseGuestLines,
  planMerge,
  summariseMerge,
  type GuestLine,
  type MergeNotice,
} from '@/lib/cart/guest-cart';

/**
 * Merging an anonymous basket into a customer's cart at sign-in.
 *
 * Authority: PLAN.md §8. Replaces `syncCartToDatabase`, which sent
 * client-held prices to a server action that trusted them.
 *
 * ## Two calls, and why it cannot be one
 *
 * `planGuestCartMerge` reads and computes. `applyGuestCartMerge` writes. The
 * split exists for exactly one reason: **the client must be able to persist the
 * plan before any of it is applied.**
 *
 * A single action would compute and write in one breath, and a connection that
 * dropped after the write but before the response would leave the browser
 * holding a basket it believes is unmerged. Retrying would re-read a cart that
 * already contains those quantities and add them again — the customer's basket
 * silently doubles.
 *
 * With the plan frozen first, a retry re-applies the SAME absolute quantities,
 * and converging a line to five twice leaves five.
 *
 * ## Why nothing here decides anything
 *
 * Stock, price, availability and the per-line cap are all the API's. This file
 * arithmetics quantities and reports what happened. The one number it computes
 * — the sum — is the product rule in `planMerge`, and even that is re-clamped
 * server-side on every write.
 */

export interface MergePlan {
  readonly ok: true;
  /** Absolute quantities. The caller persists these BEFORE applying them. */
  readonly targets: GuestLine[];
}

export interface MergeApplied {
  readonly ok: true;
  readonly notices: MergeNotice[];
}

export interface MergeFailed {
  readonly ok: false;
  readonly error: string;
}

/**
 * Works out what the cart should contain, without changing anything.
 *
 * Read-only by design: if this fails, nothing has happened and the caller can
 * simply try again, with no state to reconcile.
 */
export async function planGuestCartMerge(
  items: readonly unknown[],
): Promise<MergePlan | MergeFailed> {
  const guest = normaliseGuestLines(items);

  if (guest.length === 0) {
    return { ok: true, targets: [] };
  }

  const cart = await tryApi(() => api.getCart());

  if (!cart.ok) {
    return { ok: false, error: 'could not read the cart' };
  }

  return {
    ok: true,
    targets: planMerge(
      guest,
      cart.data.data.items.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
      })),
    ),
  };
}

/**
 * Converges the cart to `targets`. Safe to call twice with the same targets.
 *
 * ## Per line, never all-or-nothing
 *
 * A product that was delisted, deleted or sold out while it sat in somebody's
 * basket makes ONE line fail. The rest are still merged, the customer is told,
 * and — the part that matters — **the sign-in itself is unaffected.** A dead
 * product must never be able to stop a customer logging in.
 *
 * ## PATCH when the line exists, POST when it does not
 *
 * `PATCH` sets an exact quantity and is therefore idempotent; `POST` adds to
 * whatever is already there and is not. Choosing between them from a FRESH read
 * of the cart is what makes a retry safe: on the second attempt the line
 * created by the first attempt exists, so the retry patches it to the same
 * target instead of adding the quantity again.
 */
export async function applyGuestCartMerge(
  targets: readonly unknown[],
): Promise<MergeApplied | MergeFailed> {
  const plan = normaliseGuestLines(targets);

  if (plan.length === 0) {
    return { ok: true, notices: [] };
  }

  const before = await tryApi(() => api.getCart());

  if (!before.ok) {
    return { ok: false, error: 'could not read the cart' };
  }

  const existing = new Set(before.data.data.items.map((line) => line.productId));

  for (const target of plan) {
    /*
     * One failed line is a notice, not an exception. `tryApi` already turns an
     * API error into a value, so this loop cannot throw its way out and leave
     * the remaining lines unmerged.
     */
    await (existing.has(target.productId)
      ? tryApi(() => api.updateCartItem(target.productId, target.quantity))
      : tryApi(() => api.addCartItem(target.productId, target.quantity)));
  }

  /*
   * The outcome is read back rather than inferred from the writes. The API
   * clamps to live stock, so what a write "succeeded" at is not the same
   * question as what the cart now holds — and the customer is being told about
   * the second one.
   */
  const after = await tryApi(() => api.getCart());

  if (!after.ok) {
    return { ok: false, error: 'could not confirm the cart' };
  }

  revalidatePath('/cart');
  revalidatePath('/checkout');

  return {
    ok: true,
    notices: summariseMerge(
      plan,
      after.data.data.items.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
      })),
    ),
  };
}
