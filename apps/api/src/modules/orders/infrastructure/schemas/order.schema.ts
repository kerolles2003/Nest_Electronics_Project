import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { DEFAULT_CURRENCY } from '../../../../common/dto/money.dto';
import {
  LocalizedText,
  LocalizedTextSchema,
} from '../../../catalog/infrastructure/schemas/embedded.schema';
import { Role } from '../../../users/infrastructure/schemas/user.schema';
import { OrderStatus, PaymentMethod, PaymentStatus } from '../../domain/order-status';

/**
 * Who the order was for, frozen at placement.
 *
 * A snapshot rather than a join: the customer may later change their name,
 * email or phone, and an invoice must still say what it said on the day. It is
 * also what keeps an order readable after an account is soft-deleted.
 */
@Schema({ _id: false, strict: 'throw' })
export class OrderCustomer {
  @Prop({ type: String, required: true })
  fullName!: string;

  @Prop({ type: String, required: true })
  email!: string;

  @Prop({ type: String, default: null })
  phone!: string | null;
}
const OrderCustomerSchema = SchemaFactory.createForClass(OrderCustomer);

/**
 * ONE line, as a complete historical record.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §10; MONEY-MODEL.md §9.
 *
 * Everything a client needs to render this line is stored here, so an order
 * detail screen never joins to `products`. That is not a performance decision —
 * it is a CORRECTNESS one. A later rename, re-slug, re-price, delisting or hard
 * delete must not change what this order says, and it cannot, because nothing
 * about this line is read from the catalogue at display time.
 *
 * `lineTotal` is STORED rather than derived from `unitPrice x quantity` for the
 * same reason: a change to the rounding or pricing rules must not retroactively
 * alter an order. The two are asserted equal at placement and never again.
 */
@Schema({ _id: false, strict: 'throw' })
export class OrderItem {
  @Prop({ type: Types.ObjectId, required: true })
  productId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  sku!: string;

  @Prop({ type: String, required: true })
  slug!: string;

  @Prop({ type: LocalizedTextSchema, required: true })
  name!: LocalizedText;

  @Prop({ type: String, default: null })
  brandName!: string | null;

  @Prop({ type: String, default: null })
  imagePublicId!: string | null;

  /** Minor units. The server-authoritative price at the moment of placement. */
  @Prop({ type: Number, required: true, min: 0 })
  unitPrice!: number;

  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;

  /** `unitPrice x quantity`, computed once and frozen. */
  @Prop({ type: Number, required: true, min: 0 })
  lineTotal!: number;
}
const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

/**
 * The financial snapshot. Immutable after placement.
 *
 * Authority: MONEY-MODEL.md §5, §7.1, §9.
 *
 * `grandTotal = itemsSubtotal - discountTotal + shippingFee`, asserted before
 * this document is written. There is no tax term: prices are VAT-inclusive, and
 * `vatRateBps` is carried as metadata so an invoice can derive a VAT component
 * without changing what the customer paid.
 *
 * `discountTotal` is structurally present and always 0 — no coupon domain
 * exists. `shippingFee` is written from `FulfilmentService.quote(governorate,
 * postDiscountSubtotal)`, so it is a real computed term whose VALUE is 0 only
 * because the configured flat rate is 0; the order records what was charged on
 * the day, and a later rate change cannot rewrite it. Both are fields rather
 * than omissions so that a coupon domain, or a per-governorate rate, writes a
 * number into a slot that already exists instead of migrating every historical
 * order.
 */
@Schema({ _id: false, strict: 'throw' })
export class OrderPricingSnapshot {
  @Prop({ type: Number, required: true, min: 0 })
  itemsSubtotal!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  discountTotal!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  shippingFee!: number;

  /**
   * Whether `shippingFee` above is a price at all.
   *
   * Persisted rather than derived because `shippingFee === 0` is ambiguous —
   * it means both "delivery is free" and "no rate was supplied" — and the order
   * email is rendered from this snapshot long after placement, when the
   * configuration that produced the number may have changed. The order must be
   * able to say what was true on the day.
   *
   * `default: false` is the truthful reading for any document written before
   * this field existed: no rate had been supplied then, so nothing about their
   * delivery was priced.
   */
  @Prop({ type: Boolean, required: true, default: false })
  shippingPriced!: boolean;

  @Prop({ type: Number, required: true, min: 0 })
  grandTotal!: number;

  @Prop({ type: Boolean, required: true })
  vatInclusive!: boolean;

  @Prop({ type: Number, required: true, min: 0 })
  vatRateBps!: number;
}
const OrderPricingSnapshotSchema = SchemaFactory.createForClass(OrderPricingSnapshot);

/**
 * Payment, on its own axis, separate from fulfilment.
 *
 * `PENDING` for the whole life of a COD order until the courier collects. The
 * refund fields record an OUTCOME, not a workflow: with no payment provider, a
 * refund is a bank transfer somebody makes by hand, and modelling a five-state
 * refund lifecycle would describe nothing real (BEHAVIOR-DECISIONS O13).
 */
@Schema({ _id: false, strict: 'throw' })
export class OrderPayment {
  @Prop({ type: String, required: true, enum: Object.values(PaymentMethod) })
  method!: PaymentMethod;

  @Prop({ type: String, required: true, enum: Object.values(PaymentStatus) })
  status!: PaymentStatus;

  @Prop({ type: Date, default: null })
  collectedAt!: Date | null;

  @Prop({ type: Number, default: null, min: 0 })
  refundedAmount!: number | null;

  @Prop({ type: String, default: null })
  refundNote!: string | null;
}
const OrderPaymentSchema = SchemaFactory.createForClass(OrderPayment);

/**
 * Where it goes, snapshotted.
 *
 * There is no `addresses` collection and no `addressId` reference. UsersModule
 * address CRUD does not exist yet — `user.schema.ts` records `addresses[]` as
 * deliberately not declared — so the checkout request carries the address
 * inline and the order stores what it was given, validated server-side.
 *
 * That is not a workaround. An order MUST snapshot its delivery address
 * regardless, because editing a saved address years later must never rewrite
 * where a past order was sent. When `addressId` arrives it merely selects the
 * values that land here; this sub-document does not change.
 */
@Schema({ _id: false, strict: 'throw' })
export class OrderShippingAddress {
  @Prop({ type: String, required: true })
  fullName!: string;

  @Prop({ type: String, required: true })
  phone!: string;

  @Prop({ type: String, required: true })
  street!: string;

  @Prop({ type: String, required: true })
  city!: string;

  @Prop({ type: String, required: true })
  governorate!: string;

  @Prop({ type: String, default: null })
  postalCode!: string | null;
}
const OrderShippingAddressSchema = SchemaFactory.createForClass(OrderShippingAddress);

/** The actor on a history entry, always derived from the token. */
@Schema({ _id: false, strict: 'throw' })
export class OrderHistoryActor {
  @Prop({ type: Types.ObjectId, default: null })
  id!: Types.ObjectId | null;

  @Prop({ type: String, required: true, enum: Object.values(Role) })
  role!: Role;

  @Prop({ type: String, required: true })
  name!: string;
}
const OrderHistoryActorSchema = SchemaFactory.createForClass(OrderHistoryActor);

/**
 * Dispatch, tracking and delivery outcome. Null until the order ships.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §8.
 *
 * Typed now because the shipping transition that writes it exists as of this
 * phase. `carrier` and `trackingNumber` are REQUIRED — §8 makes them a
 * precondition of entering `SHIPPED`, not an afterthought. That is the direct
 * fix for the Phase 0.5 defect where `update_order_status_v2` wrote a
 * `tracking_number` column that did not exist, the error was swallowed into
 * `{success:false}`, and shipping an order with a tracking number was therefore
 * impossible (F-CRIT-4). Here the value has a home before anything can be
 * dispatched.
 *
 * DELIBERATELY OMITTED from §8: `trackingUrl` and `estimatedDeliveryAt` (both
 * optional there, and no operation produces either), and the `attempts[]`
 * array. A failed delivery already records its reason on the matching
 * `statusHistory` entry, so a parallel array would be a second, divergeable
 * copy of the same trail; `deliveryAttempts` keeps the count the courier
 * workflow actually needs.
 */
@Schema({ _id: false, strict: 'throw' })
export class OrderShipment {
  /** Free text. The carrier list is a business input, not a frozen enum (§8). */
  @Prop({ type: String, required: true })
  carrier!: string;

  @Prop({ type: String, required: true })
  trackingNumber!: string;

  /** Refreshed on a re-dispatch after a failed delivery (T7). */
  @Prop({ type: Date, required: true })
  shippedAt!: Date;

  @Prop({ type: Date, default: null })
  deliveredAt!: Date | null;

  /** Incremented on every `-> DELIVERY_FAILED`. Never reset by a re-dispatch. */
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  deliveryAttempts!: number;
}
const OrderShipmentSchema = SchemaFactory.createForClass(OrderShipment);

/**
 * Why an order was cancelled, and by whom.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §10 — `{reason, by, at}`.
 *
 * Typed now, rather than left as a loose `Object`, because the cancellation
 * transition that writes it exists as of this phase. `coupon` and `shipment`
 * stay loose for exactly the opposite reason: nothing writes them yet, and a
 * sub-schema invented ahead of its domain would be `strict: 'throw'` rejecting
 * the shape the real design settles on.
 *
 * `by` is the actor's ROLE, not their identity. A customer must be able to see
 * that an admin cancelled their order without learning which admin — and the
 * full actor, id and name included, is already on the matching `statusHistory`
 * entry, which is internal.
 */
@Schema({ _id: false, strict: 'throw' })
export class OrderCancellation {
  /** Free text, length-bounded at the DTO. Stored verbatim, never parsed. */
  @Prop({ type: String, required: true })
  reason!: string;

  @Prop({ type: String, required: true, enum: Object.values(Role) })
  by!: Role;

  @Prop({ type: Date, required: true })
  at!: Date;
}
const OrderCancellationSchema = SchemaFactory.createForClass(OrderCancellation);

/**
 * Append-only business history.
 *
 * `from` is null for the placement entry, which is the only entry this phase
 * writes. The actor is derived from the token — legacy accepted `changed_by`
 * from the caller and never verified it, so the trail was forgeable (F-MED-5).
 *
 * Embedded rather than a collection: bounded by workflow length, always read
 * with the order, never queried on its own.
 */
@Schema({ _id: false, strict: 'throw' })
export class OrderStatusHistoryEntry {
  @Prop({ type: String, default: null, enum: [...Object.values(OrderStatus), null] })
  from!: OrderStatus | null;

  @Prop({ type: String, required: true, enum: Object.values(OrderStatus) })
  to!: OrderStatus;

  @Prop({ type: OrderHistoryActorSchema, required: true })
  actor!: OrderHistoryActor;

  @Prop({ type: String, default: null })
  note!: string | null;

  @Prop({ type: Date, required: true })
  at!: Date;
}
const OrderStatusHistoryEntrySchema = SchemaFactory.createForClass(OrderStatusHistoryEntry);

/**
 * A point-in-time commercial contract.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §10; MONGODB-DESIGN.md.
 *
 * Everything is embedded, because an order is not a view over current data — it
 * is a record of what was agreed. The cart supplies `{productId, quantity}` and
 * nothing else; every other value in this document was computed by the server
 * inside the placement transaction.
 *
 * Orders are never deleted, by anyone, and no field here is mutable by a client.
 */
@Schema({ collection: 'orders', timestamps: true, strict: 'throw' })
export class Order {
  /** `NE-YYYYMMDD-NNNN`, unique. The counter resets daily. */
  @Prop({ type: String, required: true })
  orderNumber!: string;

  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** Server-controlled. No request DTO in the system contains a status field. */
  @Prop({ type: String, required: true, enum: Object.values(OrderStatus) })
  status!: OrderStatus;

  @Prop({ type: OrderCustomerSchema, required: true })
  customer!: OrderCustomer;

  @Prop({ type: [OrderItemSchema], required: true })
  items!: OrderItem[];

  @Prop({ type: String, required: true, default: DEFAULT_CURRENCY })
  currency!: string;

  @Prop({ type: OrderPricingSnapshotSchema, required: true })
  pricing!: OrderPricingSnapshot;

  @Prop({ type: OrderPaymentSchema, required: true })
  payment!: OrderPayment;

  @Prop({ type: OrderShippingAddressSchema, required: true })
  shippingAddress!: OrderShippingAddress;

  /**
   * The coupon SNAPSHOT, once coupons exist — never a reference, so editing or
   * deleting a coupon can never rewrite an order. Always null in this phase.
   *
   * Typed loosely on purpose: a sub-schema invented now would be designing the
   * discount domain from the wrong end, and `strict: 'throw'` would then reject
   * the shape the real design settles on.
   */
  @Prop({ type: Object, default: null })
  coupon!: Record<string, unknown> | null;

  /**
   * Null until dispatch. Written by the shipping transition, not by checkout,
   * and only ever in the same atomic update that sets `status = SHIPPED`.
   */
  @Prop({ type: OrderShipmentSchema, default: null })
  shipment!: OrderShipment | null;

  /**
   * Null unless cancelled. Written ONLY by the cancellation transition, in the
   * same atomic update that sets `status = CANCELLED`, so an order carrying a
   * cancellation record but a live status is not representable.
   */
  @Prop({ type: OrderCancellationSchema, default: null })
  cancellation!: OrderCancellation | null;

  @Prop({ type: [OrderStatusHistoryEntrySchema], required: true })
  statusHistory!: OrderStatusHistoryEntry[];

  /** Free text from the customer. Length-capped, stored verbatim, never parsed. */
  @Prop({ type: String, default: null })
  customerNote!: string | null;

  /** Internal. NEVER serialised into a customer-facing DTO. */
  @Prop({ type: String, default: null })
  adminNote!: string | null;

  /**
   * The client-supplied `Idempotency-Key` this order was created for.
   *
   * Unique, and this is the PERMANENT half of the idempotency guarantee: the
   * `idempotencyKeys` record expires after 24 hours, but a key can never
   * produce a second order at any point in the future, because the database
   * refuses to store one.
   */
  @Prop({ type: String, required: true })
  idempotencyKey!: string;

  @Prop({ type: Date, required: true })
  placedAt!: Date;
}

export type OrderDocument = HydratedDocument<Order>;
export type OrderLean = Order & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const OrderSchema = SchemaFactory.createForClass(Order);

/**
 * FOUR indexes. Two enforce an invariant; two serve the two list queries this
 * module executes. Every one of them has a reader in the code today.
 *
 * Authority: MONGODB-DESIGN.md §4 (orders); CONSISTENCY-MODEL.md §4.
 *
 * `orderNumber` unique — with the daily counter, this makes a duplicate order
 * number impossible even if two placements race on the same counter document.
 *
 * `idempotencyKey` unique — the invariant "one key, at most one order",
 * enforced by the DATABASE rather than by an application check that two
 * concurrent requests could both pass. It is also the lookup used to recover a
 * replay whose `idempotencyKeys` record has passed its 24-hour TTL. Not sparse:
 * the field is required, so a sparse index would add a condition that is always
 * true.
 *
 * `{ userId, placedAt, _id }` — THE order-history index, added with the endpoint
 * that reads it rather than in advance of one. It is the exact shape of the only
 * list query in the module: equality on `userId`, then the compound sort
 * `{placedAt: -1, _id: -1}` in matching order and direction, so MongoDB walks
 * the index already sorted and adds no SORT stage. `_id` is in the key because
 * it is in the sort, and it is in the sort because `placedAt` alone is not a
 * total order — two orders placed in the same millisecond would otherwise
 * paginate unstably.
 *
 * A `status` filter rides on this same index as a residual predicate. A
 * dedicated `{userId, status, placedAt}` was rejected: the UNFILTERED history is
 * the hot query, that index could not serve it without an in-memory sort, and
 * carrying a second index to save a filter over a per-customer result set of a
 * few dozen documents is write cost on every placement for nothing.
 *
 * `{ placedAt, _id }` — THE admin work queue. It exists because the admin list
 * has NO `userId` predicate, so `order_user_history` cannot serve it: that key
 * leads with `userId`, and a query that does not constrain the leading field
 * cannot seek on it. The shape is the same argument one field shorter —
 * equality on nothing, then the compound sort in matching order and direction,
 * so MongoDB walks it already sorted and adds no SORT stage.
 *
 * A `{status, placedAt, _id}` alternative was rejected for the same reason as
 * on the customer side: it would serve a status-filtered queue slightly better
 * while forcing a blocking in-memory sort on the UNFILTERED "every order,
 * newest first" view, which is the screen an operator opens first. One index
 * serves both, because a `status` filter rides it as a residual predicate.
 */
OrderSchema.index({ orderNumber: 1 }, { unique: true, name: 'order_number_unique' });
OrderSchema.index({ idempotencyKey: 1 }, { unique: true, name: 'order_idempotency_key_unique' });
OrderSchema.index({ userId: 1, placedAt: -1, _id: -1 }, { name: 'order_user_history' });
OrderSchema.index({ placedAt: -1, _id: -1 }, { name: 'order_admin_queue' });
