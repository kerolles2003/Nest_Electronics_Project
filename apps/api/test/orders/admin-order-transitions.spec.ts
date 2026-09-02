import { describe, expect, it } from '@jest/globals';
import { OrderStatus } from '../../src/modules/orders/domain/order-status';
import {
  ORDER_TRANSITIONS,
  allowedTransitions,
  checkTransition,
} from '../../src/modules/orders/domain/order-transitions';
import { adminActionFor } from '../../src/modules/orders/presentation/admin-order-actions';
import { Role } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * The admin console is about to stop holding a transition map of its own.
 *
 * It held `VALID_ORDER_TRANSITIONS` in `order.actions.ts` AND a second copy in
 * `OrderDetail.tsx`, over a status vocabulary (`pending_payment`, `paid`,
 * `processing`) that the API does not even have. Both are deleted in this
 * phase; the console now renders its buttons from `allowedTransitions` on the
 * admin order response.
 *
 * That moves the risk rather than removing it. The new failure mode is a SERVER
 * one: the list the API advertises drifting from the rules the API enforces, or
 * from the routes the API exposes. Both are silent — an advertised move that is
 * refused looks like a bug in the console, and an advertised move with no route
 * is a button that 404s.
 *
 * These are pure, so they run in milliseconds and fail on the commit that
 * breaks them. The end-to-end half — that the server really does refuse what it
 * did not advertise — is in `admin-order-attribution.spec.ts`, over HTTP.
 */

const EVERY_STATUS = Object.values(OrderStatus);

describe('allowedTransitions is the enforcement rule, not a second copy of it', () => {
  it.each(EVERY_STATUS)('advertises exactly what checkTransition permits from %s', (from) => {
    const advertised = allowedTransitions(from, Role.ADMIN);

    /*
     * Both directions. Only checking that everything advertised is permitted
     * would pass on an empty list, which is the failure that hides an operator
     * being unable to do anything at all.
     */
    for (const to of advertised) {
      expect(checkTransition(from, to, Role.ADMIN)).toBeNull();
    }

    for (const to of EVERY_STATUS.filter((status) => !advertised.includes(status))) {
      expect(checkTransition(from, to, Role.ADMIN)).not.toBeNull();
    }
  });

  it('never advertises a no-op, from any status', () => {
    // T12. A "move to the status you are already in" button is meaningless, and
    // the engine answers 409 for it.
    for (const from of EVERY_STATUS) {
      expect(allowedTransitions(from, Role.ADMIN)).not.toContain(from);
    }
  });

  it('advertises nothing at all from a terminal status', () => {
    expect(allowedTransitions(OrderStatus.CANCELLED, Role.ADMIN)).toEqual([]);
    expect(allowedTransitions(OrderStatus.RETURNED, Role.ADMIN)).toEqual([]);
  });

  it('gives a CUSTOMER a strictly smaller answer than staff', () => {
    /*
     * The guarantee that this function is role-aware at all. If it ever started
     * ignoring the role — returning the raw matrix row — this is what would
     * catch it, because a customer would suddenly be told they may ship.
     */
    const staff = allowedTransitions(OrderStatus.PLACED, Role.ADMIN);
    const customer = allowedTransitions(OrderStatus.PLACED, Role.CUSTOMER);

    expect(staff).toContain(OrderStatus.CONFIRMED);
    expect(customer).not.toContain(OrderStatus.CONFIRMED);
    expect(customer).toEqual([OrderStatus.CANCELLED]);
  });
});

describe('every admin-drivable edge has a decided route', () => {
  /**
   * The coverage check `admin-order-actions.ts` promises.
   *
   * A new edge added to the matrix without a matching entry here is a move the
   * API would advertise and the console could not perform. `undefined` is the
   * failure; `{action: null}` is a decision that this API exposes no staff
   * route, and is allowed.
   */
  it('names an action, or explicitly names none, for every edge in the matrix', () => {
    const undecided: string[] = [];

    for (const from of EVERY_STATUS) {
      for (const to of allowedTransitions(from, Role.ADMIN)) {
        if (adminActionFor(from, to) === undefined) undecided.push(`${from} -> ${to}`);
      }
    }

    expect(undecided).toEqual([]);
  });

  it('routes the two ways into SHIPPED to DIFFERENT endpoints', () => {
    /*
     * The reason the table is keyed by EDGE and not by target status. A map
     * from `to` alone would have to pick one of these and would be wrong half
     * the time — and wrong in the expensive direction, because `ship` demands a
     * carrier and a tracking number that `retry-shipment` does not.
     */
    expect(adminActionFor(OrderStatus.CONFIRMED, OrderStatus.SHIPPED)).toEqual({
      action: 'ship',
      requires: ['carrier', 'trackingNumber'],
    });

    expect(adminActionFor(OrderStatus.DELIVERY_FAILED, OrderStatus.SHIPPED)).toEqual({
      action: 'retry-shipment',
      requires: [],
    });
  });

  it('reports cancellation as legal-but-unroutable rather than omitting it', () => {
    // §13: cancelling is the customer's own operation. The matrix permits an
    // admin actor to drive the edge and no admin route exists, so the honest
    // answer is a move with no action — not a missing entry, and not a button.
    for (const from of [OrderStatus.PLACED, OrderStatus.CONFIRMED]) {
      expect(allowedTransitions(from, Role.ADMIN)).toContain(OrderStatus.CANCELLED);
      expect(adminActionFor(from, OrderStatus.CANCELLED)).toEqual({ action: null, requires: [] });
    }
  });

  it('names no route for an edge the matrix does not contain', () => {
    // Skipping a step, and resurrecting a terminal order. Neither is an edge,
    // so neither has an action — a lookup that answered one would mean the
    // table had grown a rule the state machine does not have.
    expect(adminActionFor(OrderStatus.PLACED, OrderStatus.DELIVERED)).toBeUndefined();
    expect(adminActionFor(OrderStatus.CANCELLED, OrderStatus.CONFIRMED)).toBeUndefined();
  });
});

describe('the matrix these are derived from is the frozen one', () => {
  /**
   * A guard on the guard.
   *
   * Everything above is derived from `ORDER_TRANSITIONS`, so all of it would
   * still pass if somebody rewrote the matrix — consistently — into something
   * the business never agreed. This pins the shape itself against
   * ORDER-LIFECYCLE.md §5, written out rather than computed.
   */
  it('matches ORDER-LIFECYCLE.md §5 edge for edge', () => {
    expect(ORDER_TRANSITIONS).toEqual({
      [OrderStatus.PLACED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
      [OrderStatus.CONFIRMED]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
      [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.DELIVERY_FAILED],
      [OrderStatus.DELIVERY_FAILED]: [OrderStatus.SHIPPED, OrderStatus.RETURNED],
      [OrderStatus.DELIVERED]: [OrderStatus.RETURNED],
      [OrderStatus.CANCELLED]: [],
      [OrderStatus.RETURNED]: [],
    });
  });
});
