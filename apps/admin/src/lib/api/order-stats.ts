import 'server-only';

import { tryApi } from './client';
import * as api from './endpoints';
import type { OrderStatus } from './types';

/**
 * How many orders are in each lifecycle status, from the API.
 *
 * ## One request, and why that is a correctness change rather than a saving
 *
 * This used to issue SEVEN requests with `limit=1` and read `meta.total` off
 * each. Every number was real — the server computed each over the whole
 * collection — but they were taken at seven different instants. An order
 * confirmed midway through the fan-out was counted in the status it left and
 * the status it entered, or in neither, so the tiles did not always add up to
 * the total printed beside them. On a screen an operator works a queue from,
 * numbers that disagree with each other are worse than numbers that are late.
 *
 * `GET /admin/orders/stats` is one `$group` at one instant. The parts sum to
 * the whole by construction.
 *
 * ## A failed count is `null`, never `0`
 *
 * Unchanged, and the reason is unchanged: zero is a claim — "no orders are
 * awaiting confirmation" — and a fulfilment console must not make it because a
 * request failed. Callers render `null` as an em dash.
 *
 * What DID change is that the failure is now all-or-nothing rather than
 * per-status, because there is one request. That is a simplification in the
 * right direction: a partial answer was never rendered as one anyway, since
 * the total was `null` unless every count arrived.
 */

/** The seven statuses, in lifecycle order. */
export const ORDER_STATUSES: readonly OrderStatus[] = [
  'PLACED',
  'CONFIRMED',
  'SHIPPED',
  'DELIVERED',
  'DELIVERY_FAILED',
  'CANCELLED',
  'RETURNED',
];

export interface OrderStatusCounts {
  /** Keyed by status. `null` for one the API did not answer. */
  readonly counts: Record<string, number | null>;
  /** `null` when the request failed. */
  readonly total: number | null;
}

/** Every count unknown. Rendered as em dashes, never as zeroes. */
function unknown(): OrderStatusCounts {
  return {
    counts: Object.fromEntries(ORDER_STATUSES.map((status) => [status, null])),
    total: null,
  };
}

export async function orderStatusCounts(): Promise<OrderStatusCounts> {
  const result = await tryApi(() => api.orderQueueStats());

  if (!result.ok) return unknown();

  const { byStatus, total } = result.data.data;

  /*
   * Built from THIS console's status list rather than from the response, so a
   * status the API stopped sending renders as unknown instead of disappearing
   * from the screen. A missing tile is a silent change to what the operator is
   * looking at; an em dash is a visible one.
   */
  const answered = new Map(byStatus.map((row) => [row.status, row.count]));

  return {
    counts: Object.fromEntries(
      ORDER_STATUSES.map((status) => [status, answered.get(status) ?? null]),
    ),
    total,
  };
}
