import { OrderStatus, PaymentStatus } from './order-status';

/**
 * What counts as revenue, defined once.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §"Payment status" and
 *            ADR-ORDER-002.
 *
 * ## Revenue is recognised at DELIVERY, not at placement
 *
 * Under Cash on Delivery there is no payment step before the goods move: the
 * courier does not hand anything over without collecting, so **delivery IS the
 * payment event**. ADR-ORDER-002 states it directly — "`DELIVERED` implies
 * `PAID`" — and the transition sets `payment.status = PAID` and
 * `payment.collectedAt` in the same atomic operation.
 *
 * Counting revenue at PLACEMENT would therefore be counting money nobody has.
 * It is a real number — the value of orders taken — but it is a pipeline
 * figure, and the two must not share a name on a dashboard. An order can be
 * cancelled, can fail delivery twice and be cancelled, or can be returned; each
 * of those is an order that was placed and never paid for.
 *
 * ## Why the predicate is `payment.status`, not `status === DELIVERED`
 *
 * They agree in the ordinary case and diverge in the one that matters. A
 * `RETURNED` order was `DELIVERED` first, so it still carries `deliveredAt` and
 * its status is no longer `DELIVERED`; a `REFUNDED` one was paid and the money
 * has gone back. Keying on `payment.status = PAID` follows the money rather
 * than the fulfilment axis, and those are deliberately two axes
 * (ADR-ORDER-001) precisely because they answer different questions.
 *
 * A refund therefore leaves revenue by moving `payment.status` to `REFUNDED`,
 * with no separate subtraction to remember and get wrong.
 *
 * ## Why this is a module and not a literal in two files
 *
 * Because the customer's lifetime spend and the dashboard's revenue must be the
 * same rule. Two copies is how a console ends up showing a total that does not
 * equal the sum of its rows, and neither number is obviously the wrong one.
 */

/** The one payment state that means the money is in. */
export const REVENUE_PAYMENT_STATUS = PaymentStatus.PAID;

/**
 * The `$match` for every revenue figure in the system.
 *
 * Deliberately a function returning a fresh object: a shared literal is one an
 * aggregation pipeline builder can mutate, and a filter that changed under a
 * later caller would be a reporting bug nobody would look for in a constant.
 */
export function revenueMatch(): Record<string, unknown> {
  return { 'payment.status': REVENUE_PAYMENT_STATUS };
}

/**
 * Orders that are still working their way toward being revenue.
 *
 * Shown BESIDE revenue rather than added to it. An operator needs both — "what
 * we have taken" and "what is still out with couriers" — and the failure mode
 * this guards against is a dashboard that presents the second as the first.
 */
export const PIPELINE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERY_FAILED,
];
