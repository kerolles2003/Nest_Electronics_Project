import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../../../common/dto/pagination-query.dto';
import { AppException } from '../../../common/errors/app.exception';
import { OrderStatus } from '../domain/order-status';
import type { OrderSearchTerm } from '../domain/order-search';
import type { OrderQueueSort } from '../infrastructure/repositories/order.repository';

/** Every status, in declaration order, so a count map is always complete. */
const ORDER_STATUSES = Object.values(OrderStatus);
import {
  OrderRepository,
  type OrderSummaryRow,
} from '../infrastructure/repositories/order.repository';
import type { OrderLean } from '../infrastructure/schemas/order.schema';

export interface OrderHistoryQuery {
  readonly statuses?: readonly OrderStatus[];
  readonly page?: number;
  readonly limit?: number;
}

/**
 * The queue query: the history query plus what only an operator may ask for.
 *
 * A SEPARATE type rather than optional fields on `OrderHistoryQuery`, so that
 * `listForCustomer` cannot accidentally grow a search across other people's
 * orders. A customer's history is scoped by their token; a search that ignored
 * that scope would be an enumeration surface, and the type is the cheapest
 * place to make it impossible rather than merely absent.
 */
export interface OrderQueueQuery extends OrderHistoryQuery {
  readonly search?: OrderSearchTerm;
  readonly placedFrom?: Date;
  readonly placedTo?: Date;
  readonly sort?: OrderQueueSort;
}

/** Every status, including the ones nothing is in. */
export interface OrderStatusCounts {
  readonly counts: ReadonlyMap<OrderStatus, number>;
  readonly total: number;
}

export interface OrderHistoryOutcome {
  readonly items: readonly OrderSummaryRow[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

/**
 * Customer order reads.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §13 (access rules);
 *            API-CONTRACT.md §4 (pagination) and §7 (404 for another user's
 *            resource).
 *
 * READ ONLY. Nothing here writes: placement lives in `CheckoutService` and every
 * status change lives in `OrderLifecycleService`, behind the guarded update. No
 * method on this service could grow into an unguarded status change.
 *
 * Customer methods take a `userId` and cannot be called without one; staff
 * methods cannot take an ownership scope at all. Keeping them as separate
 * methods rather than one with an optional filter is deliberate — an optional
 * ownership scope is one forgotten argument away from a data breach.
 *
 * The rule that shapes every method: **ownership is a QUERY CONDITION.** No
 * order is ever loaded and then compared against the caller — the `userId` from
 * the token is part of the filter, so a foreign order is not "rejected", it is
 * never selected in the first place.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly orders: OrderRepository) {}

  /**
   * One page of the customer's own history, newest first.
   *
   * Two indexed round trips: the page, and the true match count. The count is
   * the frozen contract — API-CONTRACT.md §4 requires `meta.total` to be the
   * real number of matches, closing the legacy defect where an exact count was
   * applied to an already-paginated result and was therefore wrong by
   * construction.
   *
   * No product is loaded and no catalogue collection is touched. Everything a
   * history card renders comes from the order's own immutable snapshot, so a
   * renamed, repriced or deleted product cannot change — or break — this list.
   */
  async listForCustomer(
    userId: Types.ObjectId,
    query: OrderHistoryQuery,
  ): Promise<OrderHistoryOutcome> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const criteria = { userId, page, limit, ...(query.statuses ? { statuses: query.statuses } : {}) };

    const [items, total] = await Promise.all([
      this.orders.findPageForUser(criteria),
      this.orders.countForUser(criteria),
    ]);

    return { items, total, page, limit };
  }

  /**
   * One order, or a 404.
   *
   * A NONEXISTENT order and ANOTHER CUSTOMER'S order return exactly the same
   * response, because they take exactly the same code path: the filter carries
   * both `_id` and `userId`, so neither case can be distinguished from here —
   * there is no branch that knows the difference and could accidentally leak it.
   *
   * That is why it is `404` and not `403`. A `403` would confirm the order
   * exists, turning any id into an existence oracle for other people's orders.
   */
  async findForCustomer(userId: Types.ObjectId, orderId: Types.ObjectId): Promise<OrderLean> {
    const order = await this.orders.findByIdForUser(orderId, userId);

    if (order === null) {
      throw AppException.orderNotFound();
    }

    return order;
  }

  /**
   * One page of the STAFF work queue: every customer's orders, newest first.
   *
   * The minimum read surface an operator needs to do the job — without it there
   * is no way to find the orders waiting to be confirmed, and the six lifecycle
   * endpoints are unreachable except by an id nobody can obtain. It is
   * deliberately the SAME page shape, the same pagination contract and the same
   * summary DTO as the customer history: one card model, no drift.
   *
   * Unscoped by design (ORDER-LIFECYCLE.md §13 — staff view any order). That is
   * why it is a separate method from `listForCustomer` rather than the same one
   * with an optional `userId`: an optional ownership scope is one forgotten
   * argument away from leaking every customer's orders to a customer.
   */
  async listForStaff(query: OrderQueueQuery): Promise<OrderHistoryOutcome> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const criteria = {
      page,
      limit,
      ...(query.statuses ? { statuses: query.statuses } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.placedFrom ? { placedFrom: query.placedFrom } : {}),
      ...(query.placedTo ? { placedTo: query.placedTo } : {}),
      ...(query.sort ? { sort: query.sort } : {}),
    };

    const [items, total] = await Promise.all([
      this.orders.findPageForStaff(criteria),
      this.orders.countForStaff(criteria),
    ]);

    return { items, total, page, limit };
  }

  /**
   * Every status and its count, in one round trip.
   *
   * The map the repository returns omits statuses nothing is in, because
   * `$group` cannot invent a bucket for a value it never saw. Filling those in
   * with `0` happens HERE rather than in the caller: a console that renders a
   * missing key as an em dash and a zero as "0" would otherwise show "no
   * cancelled orders" and "cancelled orders unknown" identically, and only one
   * of those is a fact.
   */
  async countByStatusForStaff(): Promise<OrderStatusCounts> {
    const observed = await this.orders.countByStatusForStaff();
    const counts = new Map<OrderStatus, number>(
      ORDER_STATUSES.map((status) => [status, observed.get(status) ?? 0]),
    );

    let total = 0;
    for (const count of counts.values()) total += count;

    return { counts, total };
  }

  /**
   * One order for staff, unscoped, or a 404.
   *
   * An operator confirming a COD order has to phone the customer and read back
   * the delivery address, so the queue alone is not an operable surface. The
   * response is the canonical `OrderDto`, exactly as the customer sees it —
   * `adminNote`, `statusHistory` and `idempotencyKey` stay unexposed here too,
   * because nothing in this phase needs them and a second order shape would
   * immediately drift from the first.
   */
  async findForStaff(orderId: Types.ObjectId): Promise<OrderLean> {
    const order = await this.orders.findByIdForStaff(orderId);

    if (order === null) {
      throw AppException.orderNotFound();
    }

    return order;
  }
}
