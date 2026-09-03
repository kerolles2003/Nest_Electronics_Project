import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, FilterQuery, Model, UpdateQuery } from 'mongoose';
import { Types } from 'mongoose';
import { OrderStatus } from '../../domain/order-status';
import type { OrderSearchTerm } from '../../domain/order-search';
import {
  Order,
  type OrderCancellation,
  type OrderLean,
  type OrderShipment,
  type OrderStatusHistoryEntry,
} from '../schemas/order.schema';

/**
 * What an order-history CARD needs, and nothing else.
 *
 * `items` is projected down to the two fields the card uses, so a ten-line
 * order does not ship ten full snapshots to render one thumbnail and a count.
 */
export type OrderSummaryRow = Pick<
  OrderLean,
  '_id' | 'orderNumber' | 'status' | 'currency' | 'pricing' | 'payment' | 'placedAt'
> & {
  items: { quantity: number; imagePublicId: string | null }[];
};

export interface OrderHistoryCriteria {
  readonly userId: Types.ObjectId;
  /** OR within the list. Absent means every status. */
  readonly statuses?: readonly OrderStatus[];
  readonly page: number;
  readonly limit: number;
}

/**
 * How the queue may be ordered.
 *
 * A closed set rather than a field name from the client. A caller-supplied sort
 * key is a query expression built from a string, which is the thing this
 * repository does not do anywhere — and it would also let a caller ask for a
 * sort no index serves, turning one request into a collection-wide in-memory
 * sort.
 */
export type OrderQueueSort = 'newest' | 'oldest' | 'total_high' | 'total_low';

/** The admin queue. The same shape minus the ownership scope. */
export interface OrderQueueCriteria {
  /** OR within the list. Absent means every status. */
  readonly statuses?: readonly OrderStatus[];
  /**
   * Free text, already escaped and compiled by `parseOrderSearch`.
   *
   * The repository never sees the raw string, which is what makes "no client
   * string becomes part of a query expression" checkable here rather than a
   * convention.
   */
  readonly search?: OrderSearchTerm;
  /** Inclusive lower bound on `placedAt`. */
  readonly placedFrom?: Date;
  /** Inclusive upper bound on `placedAt`. */
  readonly placedTo?: Date;
  readonly sort?: OrderQueueSort;
  readonly page: number;
  readonly limit: number;
}

export interface OrderHistoryPage {
  readonly items: readonly OrderSummaryRow[];
  /** The TRUE match count, not the size of the page. */
  readonly total: number;
}

/**
 * The list projection. Deliberately excludes `items.name`, `items.sku`,
 * `items.unitPrice`, `customer`, `shippingAddress`, `statusHistory`,
 * `customerNote` and `idempotencyKey` — a history card renders none of them,
 * and the last of those must never leave the server at all.
 */
const SUMMARY_PROJECTION = {
  _id: 1,
  orderNumber: 1,
  status: 1,
  currency: 1,
  pricing: 1,
  payment: 1,
  placedAt: 1,
  'items.quantity': 1,
  'items.imagePublicId': 1,
} as const;

/**
 * Newest first, with `_id` as the tie-breaker.
 *
 * The tie-breaker is not cosmetic. `placedAt` is set once per order from
 * application time, so two orders placed in the same millisecond — which
 * concurrent checkouts genuinely produce — would otherwise have no defined
 * relative order, and MongoDB is free to return them differently on each call.
 * Under offset pagination that means an order can appear on both page 1 and
 * page 2, or on neither. `_id` is unique and monotonic, so this total order is
 * stable across requests.
 */
const HISTORY_SORT = { placedAt: -1, _id: -1 } as const;

/**
 * The four orderings the queue offers, each matching an index exactly.
 *
 * Every one ends in `_id`, and that is not decoration: two orders can share a
 * placement instant or a grand total, and a sort without a unique tail is
 * unstable — which makes offset pagination silently skip one row and repeat
 * another. The bug looks like missing orders and reproduces on nobody's machine.
 */
const QUEUE_SORTS = {
  newest: { placedAt: -1, _id: -1 },
  oldest: { placedAt: 1, _id: 1 },
  total_high: { 'pricing.grandTotal': -1, _id: -1 },
  total_low: { 'pricing.grandTotal': 1, _id: 1 },
} as const satisfies Record<OrderQueueSort, Record<string, 1 | -1>>;

/**
 * Every order query in the system.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §13 (access rules).
 *
 * There is no DELETE method, and no generic update. An order is a financial
 * record that nobody may delete, and the only write that can change a status is
 * `applyTransition` — which requires the caller to state the status it expects
 * to replace. A generic `update` here would be the seam through which a status
 * could change without passing the state machine, which is precisely how legacy
 * ended up with orders `delivered` while unpaid.
 */
@Injectable()
export class OrderRepository {
  constructor(@InjectModel(Order.name) private readonly model: Model<Order>) {}

  /**
   * Writes the order. ONE insert with the final totals already computed — no
   * placeholder row, no second pass to fill in a total.
   *
   * `create` with a session so the write joins the caller's transaction. A
   * duplicate-key error propagates unchanged: the caller distinguishes a
   * duplicate `idempotencyKey` (a replay to be served) from a duplicate
   * `orderNumber` (a counter race to be retried), and swallowing it here would
   * take that decision away from the only layer that can make it.
   */
  async insert(order: Order & { _id: Types.ObjectId }, session: ClientSession): Promise<void> {
    await this.model.create([order], { session });
  }

  /**
   * One order, scoped to its owner IN THE QUERY.
   *
   * `userId` is a filter condition, never a fetch-then-compare in the service.
   * A missing order and another customer's order are indistinguishable from
   * here, which is what lets the caller answer 404 for both — a 403 would
   * confirm that the id exists.
   */
  async findByIdForUser(orderId: Types.ObjectId, userId: Types.ObjectId): Promise<OrderLean | null> {
    return this.model.findOne({ _id: orderId, userId }).lean<OrderLean>().exec();
  }

  /**
   * Loads an order for a transition, INSIDE the caller's transaction.
   *
   * `ownerId` is optional and that is the whole reason this method is separate
   * from `findByIdForUser`: a customer operation passes it, so ownership is a
   * condition of the query exactly as it is on every read; a future ADMIN
   * operation omits it, because an admin may act on any order. Neither caller
   * fetches an order and then compares an id in application memory.
   *
   * Reading in the session matters: the status this returns must come from the
   * same snapshot the guarded update below is evaluated against, or the
   * validation would be advisory.
   */
  async findForTransition(
    orderId: Types.ObjectId,
    session: ClientSession,
    ownerId?: Types.ObjectId,
  ): Promise<OrderLean | null> {
    const filter: FilterQuery<Order> = { _id: orderId };

    if (ownerId !== undefined) {
      filter.userId = ownerId;
    }

    return this.model.findOne(filter).session(session).lean<OrderLean>().exec();
  }

  /**
   * THE guarded transition. The one write in the system that changes a status.
   *
   * Authority: ORDER-LIFECYCLE.md §6 step 5 — "guarded update: `{_id, status:
   * <from>}`; matchedCount === 0 means 409".
   *
   * `expectedStatus` in the FILTER is what closes the legacy TOCTOU race
   * (M8/O9). Legacy read the current status, checked the matrix in application
   * code, then issued a separate RPC — two actors could both pass the check
   * before either wrote. Here the check and the write are one atomic operation
   * on one document: if anybody changed the status in between, this matches
   * nothing and returns `null`. Legacy's `FOR UPDATE` row lock did not help,
   * because the validation happened in a previous round trip, outside it.
   *
   * This is also the MUTUAL EXCLUSION point for concurrent cancellations, and
   * the caller runs it BEFORE touching stock. Under snapshot isolation a second
   * transaction attempting the same document either aborts with a write
   * conflict — which the driver retries, and the retry then reads the new status
   * and refuses — or arrives afterwards and matches nothing. Either way exactly
   * one caller proceeds to restore inventory.
   *
   * The status change and the history append are ONE update, so an order whose
   * status moved without a trail is not representable. Legacy permitted a direct
   * `UPDATE orders` under RLS, which changed a status with no history row at all.
   */
  async applyTransition(
    input: {
      readonly orderId: Types.ObjectId;
      readonly expectedStatus: OrderStatus;
      readonly to: OrderStatus;
      readonly historyEntry: OrderStatusHistoryEntry;
      /** Set only by transitions that produce one. `undefined` leaves it alone. */
      readonly cancellation?: OrderCancellation;
      /** Written whole when an order is dispatched for the first time. */
      readonly shipment?: OrderShipment;
      /**
       * Field-level updates the target status implies — dotted paths such as
       * `payment.status` or `shipment.deliveredAt`.
       *
       * They ride in the SAME `findOneAndUpdate` as the status change, which is
       * the point: ADR-ORDER-002 requires `DELIVERED` to imply `PAID`, and
       * "delivered but unpaid" is unrepresentable only because the two land in
       * one atomic write rather than two.
       */
      readonly set?: Readonly<Record<string, unknown>>;
      /** Counters the target status implies, e.g. `shipment.deliveryAttempts`. */
      readonly inc?: Readonly<Record<string, number>>;
      /** Present for customer-scoped operations, absent for admin ones. */
      readonly ownerId?: Types.ObjectId;
    },
    session: ClientSession,
  ): Promise<OrderLean | null> {
    const filter: FilterQuery<Order> = {
      _id: input.orderId,
      status: input.expectedStatus,
    };

    if (input.ownerId !== undefined) {
      filter.userId = input.ownerId;
    }

    // Assembled as a plain object rather than an inline literal: spreading an
    // open `Record` into a `findOneAndUpdate` literal makes TypeScript check
    // the result against Mongoose's deeply recursive `UpdateQuery`, which
    // exhausts the default compiler heap. One annotated value is checked once.
    const set: Record<string, unknown> = { status: input.to };

    if (input.cancellation !== undefined) {
      set.cancellation = input.cancellation;
    }

    if (input.shipment !== undefined) {
      set.shipment = input.shipment;
    }

    Object.assign(set, input.set ?? {});

    const update: UpdateQuery<Order> = {
      $set: set,
      $push: { statusHistory: input.historyEntry },
      ...(input.inc !== undefined ? { $inc: input.inc } : {}),
    };

    return this.model
      .findOneAndUpdate(filter, update, { session, returnDocument: 'after' })
      .lean<OrderLean>()
      .exec();
  }

  /**
   * One order by id, UNSCOPED. Staff only.
   *
   * Separate from `findByIdForUser` on purpose. That method takes a `userId`
   * and cannot be called without one; this one cannot take an ownership scope
   * at all. Keeping them apart means no customer-facing caller can reach an
   * unscoped read by passing `undefined`, which a single optional parameter
   * would have allowed.
   */
  async findByIdForStaff(orderId: Types.ObjectId): Promise<OrderLean | null> {
    return this.model.findOne({ _id: orderId }).lean<OrderLean>().exec();
  }

  /**
   * One page of the ADMIN work queue, newest first, across every customer.
   *
   * Query shape: `{}` or `{status: {$in: [...]}}`, sorted `{placedAt: -1,
   * _id: -1}` — exactly `order_admin_queue`. There is no `userId` predicate,
   * which is precisely why `order_user_history` cannot serve this: that key
   * leads with `userId` and a query that does not constrain a leading field
   * cannot seek on it.
   */
  async findPageForStaff(criteria: OrderQueueCriteria): Promise<readonly OrderSummaryRow[]> {
    return this.model
      .find(OrderRepository.queueFilter(criteria))
      .select(SUMMARY_PROJECTION)
      .sort(QUEUE_SORTS[criteria.sort ?? 'newest'])
      .skip((criteria.page - 1) * criteria.limit)
      .limit(criteria.limit)
      .lean<OrderSummaryRow[]>()
      .exec();
  }

  /** The TRUE match count for the same filter, served by the same index. */
  async countForStaff(criteria: OrderQueueCriteria): Promise<number> {
    return this.model.countDocuments(OrderRepository.queueFilter(criteria)).exec();
  }

  /** ONE place builds the queue filter, so the page and its count cannot diverge. */
  private static queueFilter(criteria: OrderQueueCriteria): FilterQuery<Order> {
    const filter: FilterQuery<Order> = {};

    if (criteria.statuses !== undefined && criteria.statuses.length > 0) {
      // `$in` over values already narrowed to the OrderStatus enum by the DTO.
      filter.status = { $in: [...criteria.statuses] };
    }

    /*
     * The range is built from whichever bounds are present, so "everything
     * since Monday" and "everything before Friday" are both expressible. An
     * absent bound is absent, not a sentinel date — `new Date(0)` as a floor
     * would quietly exclude anything predating the epoch and would read as a
     * real bound to whoever changed it next.
     */
    if (criteria.placedFrom !== undefined || criteria.placedTo !== undefined) {
      filter.placedAt = {
        ...(criteria.placedFrom !== undefined ? { $gte: criteria.placedFrom } : {}),
        ...(criteria.placedTo !== undefined ? { $lte: criteria.placedTo } : {}),
      };
    }

    if (criteria.search !== undefined) {
      const { prefix, contains, digits } = criteria.search;

      /*
       * Four denormalised fields, because the order carries a SNAPSHOT of the
       * customer rather than a join — an operator searching for an order by the
       * name on the delivery note must find it even if that customer has since
       * changed their name.
       *
       * The patterns arrive already escaped from `parseOrderSearch`. Nothing
       * here interpolates a client string.
       */
      filter.$or = [
        { orderNumber: prefix },
        { 'customer.email': prefix },
        { 'customer.fullName': contains },
        /*
         * BOTH phone numbers, and the second is the one that matters.
         *
         * `customer.phone` comes from the account profile and is frequently
         * null — registration does not ask for one. `shippingAddress.phone` is
         * required at checkout and is the number printed on the delivery note,
         * so it is the number an operator is holding when they search. Omitting
         * it made phone search find nothing at all for any customer who had not
         * separately filled in their profile.
         */
        ...(digits === null
          ? []
          : [{ 'customer.phone': digits }, { 'shippingAddress.phone': digits }]),
      ];
    }

    return filter;
  }

  /**
   * Every status and its count, in ONE round trip.
   *
   * The console used to ask for seven pages of one order each and read the
   * total off each response — seven requests, seven index scans and seven
   * chances for the numbers to disagree with each other, because they were
   * taken at seven different instants. A `$group` answers all of them from a
   * single pass at a single point in time.
   *
   * Statuses with no orders are absent from the result, which the caller fills
   * in: `$group` cannot invent a bucket for something it never saw.
   */
  async countByStatusForStaff(): Promise<ReadonlyMap<OrderStatus, number>> {
    const rows = await this.model
      .aggregate<{ _id: OrderStatus; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();

    return new Map(rows.map((row) => [row._id, row.count]));
  }

  /**
   * One page of the customer's history, newest first.
   *
   * `userId` is the FIRST condition of the filter and is never absent, so the
   * query cannot be widened by anything a client sends. There is no code path
   * that reads orders without it.
   *
   * The filter and the sort together are exactly the shape of the
   * `order_user_history` index, which is why this is an IXSCAN with no in-memory
   * sort stage. A `status` filter rides along as a residual predicate on the
   * same index rather than needing one of its own.
   */
  async findPageForUser(criteria: OrderHistoryCriteria): Promise<readonly OrderSummaryRow[]> {
    return this.model
      .find(OrderRepository.historyFilter(criteria))
      .select(SUMMARY_PROJECTION)
      .sort(HISTORY_SORT)
      .skip((criteria.page - 1) * criteria.limit)
      .limit(criteria.limit)
      .lean<OrderSummaryRow[]>()
      .exec();
  }

  /**
   * The TRUE match count for the same filter.
   *
   * A second round trip rather than a `$facet`: a `$sort` inside a facet
   * sub-pipeline cannot use an index, so folding the count in would trade an
   * indexed scan for an in-memory sort on the hot path. Two indexed queries beat
   * one unindexed aggregation, and `countDocuments` on this filter is served by
   * the same index.
   */
  async countForUser(criteria: OrderHistoryCriteria): Promise<number> {
    return this.model.countDocuments(OrderRepository.historyFilter(criteria)).exec();
  }

  /** ONE place builds the history filter, so the page and its count cannot diverge. */
  private static historyFilter(criteria: OrderHistoryCriteria): FilterQuery<Order> {
    const filter: FilterQuery<Order> = { userId: criteria.userId };

    if (criteria.statuses !== undefined && criteria.statuses.length > 0) {
      // `$in` over values already narrowed to the OrderStatus enum by the DTO.
      // No client string reaches a query operator.
      filter.status = { $in: [...criteria.statuses] };
    }

    return filter;
  }

  /**
   * Recovery path for a replay whose `idempotencyKeys` record has passed its
   * 24-hour TTL but whose order still exists — `orders.idempotencyKey` is
   * unique forever, so the order is still reachable.
   *
   * Unscoped on purpose, for the same reason as `IdempotencyRepository.findByKey`:
   * the caller must be able to tell "another account owns this key" apart from
   * "no such key", and only an unscoped read can tell them apart.
   */
  async findByIdempotencyKey(key: string): Promise<OrderLean | null> {
    return this.model.findOne({ idempotencyKey: key }).lean<OrderLean>().exec();
  }
}
