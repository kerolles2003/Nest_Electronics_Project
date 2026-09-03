import 'server-only';

import { tryApi } from './client';
import * as api from './endpoints';
import type { OrderStatus } from './types';

/**
 * How many orders are in each lifecycle status, from the API.
 *
 * ## Why counts rather than a stats endpoint
 *
 * There is no aggregate endpoint. `GET /admin/orders` answers `meta.total` —
 * the TRUE match count across all pages, not the size of the page — so seven
 * requests with `limit=1` produce seven real numbers that the server computed
 * over the whole collection. They run in parallel and each rides the
 * `order_admin_queue` index.
 *
 * It is more requests than a `GROUP BY` would be. It is also the only version
 * that cannot be wrong: the alternative on offer was summing a page, which
 * gives a number that changes when you paginate.
 *
 * An aggregate endpoint is the right fix and is noted in the report. Until it
 * exists, this is what honest looks like.
 *
 * ## A failed count is `null`, never `0`
 *
 * Zero is a claim — "no orders are awaiting confirmation" — and a fulfilment
 * console must not make it because a request failed. Callers render `null` as
 * an em dash. The total is `null` if ANY count failed, because a partial sum is
 * a confident number that is quietly too low, which is worse than no number on
 * a queue somebody works from.
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
  /** `null` unless every count answered. */
  readonly total: number | null;
}

export async function orderStatusCounts(): Promise<OrderStatusCounts> {
  const results = await Promise.all(
    ORDER_STATUSES.map(async (status) => {
      const result = await tryApi(() => api.listOrders({ status: [status], limit: 1 }));

      return [status, result.ok ? result.data.meta.total : null] as const;
    }),
  );

  const values = results.map(([, count]) => count);
  const answered = values.filter((count): count is number => count !== null);

  return {
    counts: Object.fromEntries(results),
    total:
      answered.length === values.length ? answered.reduce((sum, count) => sum + count, 0) : null,
  };
}
