import { OrderStatus } from '../domain/order-status';

/**
 * THE map from a legal edge to the staff endpoint that drives it.
 *
 * Authority: ORDER-LIFECYCLE.md §5 (the matrix) and `admin-orders.controller.ts`
 * (the routes). This module is the join between the two, and it exists so that
 * an admin client needs neither.
 *
 * ## Why the client is told the endpoint and not just the status
 *
 * `allowedTransitions` on its own is not actionable. Two things stop it being
 * so, and both are invisible from a status name:
 *
 *  1. **The same target status has two different endpoints.** `-> SHIPPED` is
 *     `ship` from `CONFIRMED` and `retry-shipment` from `DELIVERY_FAILED`, and
 *     they take different bodies — carrier and tracking are mandatory on the
 *     first and optional on the second. So the mapping is a property of the
 *     EDGE, never of the target.
 *
 *  2. **The matrix permits edges this API does not expose to staff.**
 *     `PLACED -> CANCELLED` and `CONFIRMED -> CANCELLED` are legal for an admin
 *     actor in the matrix, but the only cancellation route in the system is the
 *     customer's own `POST /orders/{id}/cancel` (§13). An admin console that
 *     rendered a button per allowed status would draw a "Cancel" that posts to
 *     nothing.
 *
 * Reporting `action: null` for those is the honest answer, and it is far better
 * than silently omitting them: an operator can see that cancelling is a thing
 * the order permits and not a thing this console can do, which is the truth.
 *
 * ## The table cannot quietly fall behind the matrix
 *
 * Every admin-drivable edge must appear here. `test/orders/admin-order-
 * transitions.spec.ts` walks `ORDER_TRANSITIONS` and fails if one is missing —
 * so adding an edge to the matrix without deciding how staff drive it is a red
 * test, not a dead button discovered in production.
 */

/** The body fields an edge REQUIRES. Empty for the edges that need only a note. */
export interface AdminOrderAction {
  /**
   * The path segment under `POST /admin/orders/{id}/`, or `null` when this API
   * exposes no staff route for the edge.
   */
  readonly action: string | null;
  readonly requires: readonly string[];
}

function edgeKey(from: OrderStatus, to: OrderStatus): string {
  return `${from}->${to}`;
}

/** No staff route. Legal in the matrix; driven from somewhere else, or nowhere. */
const NO_STAFF_ROUTE: AdminOrderAction = Object.freeze({ action: null, requires: Object.freeze([]) });

const ACTIONS: ReadonlyMap<string, AdminOrderAction> = new Map<string, AdminOrderAction>([
  [edgeKey(OrderStatus.PLACED, OrderStatus.CONFIRMED), { action: 'confirm', requires: [] }],
  [
    edgeKey(OrderStatus.CONFIRMED, OrderStatus.SHIPPED),
    { action: 'ship', requires: ['carrier', 'trackingNumber'] },
  ],
  [edgeKey(OrderStatus.SHIPPED, OrderStatus.DELIVERED), { action: 'deliver', requires: [] }],
  [
    edgeKey(OrderStatus.SHIPPED, OrderStatus.DELIVERY_FAILED),
    { action: 'delivery-failed', requires: ['reason'] },
  ],
  /*
   * Re-dispatch. `carrier` and `trackingNumber` are accepted but NOT required —
   * the order already has a shipment, so omitting them re-sends with the
   * current carrier (§8, T7). This is the one edge where they are optional, and
   * it is why the requirement is recorded per edge rather than per endpoint.
   */
  [edgeKey(OrderStatus.DELIVERY_FAILED, OrderStatus.SHIPPED), { action: 'retry-shipment', requires: [] }],
  [
    edgeKey(OrderStatus.DELIVERY_FAILED, OrderStatus.RETURNED),
    { action: 'return', requires: ['reason'] },
  ],
  [edgeKey(OrderStatus.DELIVERED, OrderStatus.RETURNED), { action: 'return', requires: ['reason'] }],

  /*
   * Cancellation is the CUSTOMER's, and only theirs (§13). The matrix permits
   * an admin actor to drive these edges — `checkTransition` says yes for a
   * staff role — but no admin route exists that would. Declared rather than
   * omitted so the coverage test above stays meaningful: a missing entry is a
   * mistake, and `null` is a decision.
   */
  [edgeKey(OrderStatus.PLACED, OrderStatus.CANCELLED), NO_STAFF_ROUTE],
  [edgeKey(OrderStatus.CONFIRMED, OrderStatus.CANCELLED), NO_STAFF_ROUTE],
]);

/**
 * How staff drive `from -> to`, or `undefined` when the pair is not an edge
 * this table knows.
 *
 * `undefined` is never expected for a legal edge — the coverage test forbids
 * it — so a caller may treat it as "not drivable" without hiding a gap.
 */
export function adminActionFor(from: OrderStatus, to: OrderStatus): AdminOrderAction | undefined {
  return ACTIONS.get(edgeKey(from, to));
}
