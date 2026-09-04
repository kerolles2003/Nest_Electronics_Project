'use server';

import { refresh, revalidatePath } from 'next/cache';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { requireAdminActor } from '@/lib/api/identity';
import { ADJUSTMENT_TYPES } from '@/lib/api/types';
import type { AdjustmentResult, AdjustmentType, InventoryEvent } from '@/lib/api/types';

/**
 * Stock operations, through the API.
 *
 * ## What this replaces
 *
 * `adjust_stock_v2`, a Supabase RPC with two facts in the frozen record: its
 * `EXECUTE` was granted to `anon` (F-CRIT-1 — anybody who could reach the
 * database could move stock), and **zero `adjustment` events exist in
 * production, so it never once completed successfully.** The screen above it
 * has been writing into a function that does not work, into a database nothing
 * reads.
 *
 * Its SEMANTICS survive because they were well designed and are now enforced
 * server-side: a signed delta rather than a target, a required reason of at
 * least three characters, a floor at zero. What is new is that the stock change
 * and the ledger entry commit in ONE transaction, which is what makes
 * `Σ quantityDelta == stock.onHand` an invariant instead of an aspiration —
 * legacy wrote its ledger from a different code path, so the two diverged.
 *
 * ## No Zod here, and no local audit write
 *
 * Both were doing the API's job. The `AdjustStockDto` validates the delta, the
 * reason length and the type, and returns a 400 with a per-field message that
 * `operatorMessage` renders; a second copy of those rules in this file is a
 * second place for them to drift. The audit record is written by the API inside
 * the same transaction as the movement, so an adjustment that is not audited is
 * not representable — which is a stronger guarantee than a `logAdminAction`
 * call that can fail on its own after the stock has already moved.
 */

export interface AdjustStockResult {
  ok: boolean;
  error?: string;
  result?: AdjustmentResult;
}

/**
 * A plain object, not `FormData`.
 *
 * The dialog is a client component that already holds typed state; passing
 * `FormData` meant stringifying a number and parsing it back, which is where
 * the old action's `parseInt` lived — and `parseInt('')` is `NaN`, which its
 * schema then reported as "Expected number, received nan".
 */
export async function adjustStockAction(input: {
  productId: string;
  delta: number;
  reason: string;
  type: AdjustmentType;
}): Promise<AdjustStockResult> {
  await requireAdminActor();

  /*
   * Two checks are made here and only two, both because they are about the
   * REQUEST being well formed rather than about the rule:
   *
   *   - a non-integer delta cannot be sent as JSON `delta` at all
   *   - a type outside the three an operator may post is a caller bug, not
   *     something to show an operator a server error for
   *
   * Everything else — the non-zero delta, the reason length, the floor at zero,
   * whether the product exists — is the API's, and its message is shown.
   */
  if (!Number.isInteger(input.delta)) {
    return { ok: false, error: 'Enter a whole number of units.' };
  }

  if (!ADJUSTMENT_TYPES.includes(input.type)) {
    return { ok: false, error: 'Choose what kind of movement this is.' };
  }

  const res = await tryApi(() =>
    api.adjustStock(input.productId, {
      delta: input.delta,
      reason: input.reason.trim(),
      type: input.type,
    }),
  );

  if (!res.ok) return { ok: false, error: operatorMessage(res.error) };

  /*
   * The dashboard's low-stock panel and the products list both read stock, so
   * both are stale the moment this returns.
   *
   * These are ROUTE paths, not URLs: `revalidatePath` takes the route file
   * structure, so `basePath` is NOT included. An `/admin/inventory` alongside
   * `/inventory` — which this console did in a couple of places — names a route
   * that does not exist and revalidates nothing.
   *
   * `refresh()` then updates the client router, so the screen the operator is
   * looking at re-reads without the component having to ask.
   */
  revalidatePath('/inventory');
  revalidatePath('/products');
  revalidatePath('/');
  refresh();

  return { ok: true, result: res.data.data };
}

export interface StockHistoryResult {
  ok: boolean;
  error?: string;
  events?: InventoryEvent[];
  total?: number;
  page?: number;
  totalPages?: number;
}

/**
 * One product's movement history.
 *
 * The whole ledger, not only what an operator posted: a `SALE` written inside
 * an order's transaction is exactly what makes a balance explicable, and the
 * legacy drawer could not show one because legacy left `created_by` NULL on
 * every sale event (F-MED-2) and the rows were written by a path that did not
 * always run.
 */
export async function getStockHistoryAction(
  productId: string,
  page = 1,
  limit = 20,
): Promise<StockHistoryResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.stockHistory(productId, { page, limit }));

  if (!res.ok) return { ok: false, error: operatorMessage(res.error) };

  return {
    ok: true,
    events: res.data.data,
    total: res.data.meta.total,
    page: res.data.meta.page,
    totalPages: res.data.meta.totalPages,
  };
}
