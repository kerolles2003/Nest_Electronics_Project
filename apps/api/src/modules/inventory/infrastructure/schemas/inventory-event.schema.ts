import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Role } from '../../../users/infrastructure/schemas/user.schema';

/**
 * Authority: docs/architecture/INVENTORY-MODEL.md §4.
 *
 * The full frozen vocabulary is declared even though this phase emits only
 * `SALE`. The values are a persisted enum: adding one later is a schema change
 * every existing document must tolerate, and adding one to a generated Dart
 * enum is a breaking change for an installed mobile client. Declaring the
 * agreed set once, now, makes every later event type additive in the code that
 * WRITES it rather than in the contract that READS it.
 *
 * `RESERVATION` and `RESERVATION_RELEASE` are deliberately absent — reservations
 * were removed (§2), and legacy's copies of them recorded zero events in
 * production.
 */
export enum InventoryEventType {
  OPENING_BALANCE = 'OPENING_BALANCE',
  SALE = 'SALE',
  CANCELLATION = 'CANCELLATION',
  RETURN = 'RETURN',
  RESTOCK = 'RESTOCK',
  ADJUSTMENT = 'ADJUSTMENT',
  DAMAGE = 'DAMAGE',
}

/** What a movement points at. Only orders exist as a reference today. */
export enum InventoryReferenceType {
  ORDER = 'ORDER',
}

@Schema({ _id: false, strict: 'throw' })
export class InventoryEventReference {
  @Prop({ type: String, required: true, enum: Object.values(InventoryReferenceType) })
  type!: InventoryReferenceType;

  @Prop({ type: Types.ObjectId, required: true })
  id!: Types.ObjectId;
}
const InventoryEventReferenceSchema = SchemaFactory.createForClass(InventoryEventReference);

/**
 * WHO caused the movement, resolved from the JWT.
 *
 * Legacy left `created_by` NULL on every single sale event (F-MED-2), so no
 * stock movement could be attributed to anyone. `name` is a snapshot for the
 * same reason the rest of the ledger snapshots: a renamed or deleted account
 * must not erase who moved the stock.
 */
@Schema({ _id: false, strict: 'throw' })
export class InventoryEventActor {
  @Prop({ type: Types.ObjectId, required: true })
  id!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(Role) })
  role!: Role;

  @Prop({ type: String, required: true })
  name!: string;
}
const InventoryEventActorSchema = SchemaFactory.createForClass(InventoryEventActor);

/**
 * One immutable stock movement.
 *
 * Authority: docs/architecture/INVENTORY-MODEL.md §4.
 *
 * Append-only. Nothing in the system updates or deletes a row here; a
 * correction is a new `ADJUSTMENT` event, never an edit.
 *
 * `balanceBefore` / `balanceAfter` are what make the ledger SELF-VERIFYING —
 * any single entry can be checked without replaying history, and a gap between
 * one event's `balanceAfter` and the next event's `balanceBefore` proves an
 * out-of-band mutation happened. Legacy had neither, which is why Phase 0.5
 * could not explain a single stock number.
 *
 * `sku` is snapshotted so the ledger reads standalone after a product is
 * renamed or hard-deleted.
 */
@Schema({ collection: 'inventoryEvents', timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' })
export class InventoryEvent {
  @Prop({ type: Types.ObjectId, required: true })
  productId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  sku!: string;

  @Prop({ type: String, required: true, enum: Object.values(InventoryEventType) })
  type!: InventoryEventType;

  /** SIGNED. Negative when stock leaves. A `SALE` is always negative. */
  @Prop({ type: Number, required: true })
  quantityDelta!: number;

  @Prop({ type: Number, required: true, min: 0 })
  balanceBefore!: number;

  @Prop({ type: Number, required: true, min: 0 })
  balanceAfter!: number;

  @Prop({ type: String, required: true })
  reason!: string;

  @Prop({ type: InventoryEventReferenceSchema, default: null })
  reference!: InventoryEventReference | null;

  @Prop({ type: InventoryEventActorSchema, default: null })
  actor!: InventoryEventActor | null;
}

export type InventoryEventDocument = HydratedDocument<InventoryEvent>;

export const InventoryEventSchema = SchemaFactory.createForClass(InventoryEvent);

/**
 * ONE index, and it exists to enforce an INVARIANT rather than to serve a query.
 *
 * Authority: INVENTORY-MODEL.md §5.2 and §11 — "a unique index on
 * `inventoryEvents {reference.id, productId, type}` makes a double restore
 * impossible". The same index makes a double SALE impossible: a retried
 * placement that somehow reached the ledger twice for one order line fails the
 * constraint instead of decrementing stock twice.
 *
 * PARTIAL, on `reference.id` existing, because a future admin `ADJUSTMENT` or
 * `RESTOCK` has no reference and many nulls would collide under a plain unique
 * index. The partial filter is the difference between an index that keeps
 * working when Inventory grows and one that has to be dropped.
 *
 * A second index arrives below. The comment that used to stand here said there
 * was "deliberately NO `{ productId, createdAt }` index" because "movement
 * history per product is an admin screen that does not exist". The screen
 * exists now — `GET /admin/inventory/:productId/events` — so the reason for the
 * absence has ended rather than been overruled. The rule it was applying is
 * intact: an index nothing reads is pure write cost, which is the legacy defect
 * where a GIN index recorded 0 scans against 1,282 sequential ones.
 */
InventoryEventSchema.index(
  { 'reference.id': 1, productId: 1, type: 1 },
  {
    unique: true,
    name: 'inventory_event_reference_unique',
    partialFilterExpression: { 'reference.id': { $exists: true } },
  },
);

/**
 * Movement history for one product, newest first (INVENTORY-MODEL.md §7).
 *
 * Added with the endpoint that reads it, and not before. Descending on
 * `createdAt` because that is the only order a history is ever read in, and a
 * descending index serves it without a sort stage; `_id` closes the key so a
 * page boundary is stable when two events share a timestamp — which they do,
 * because every line of one order is written in a single `insertMany`.
 */
InventoryEventSchema.index(
  { productId: 1, createdAt: -1, _id: -1 },
  { name: 'inventory_event_product_history' },
);
