import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** 24 hours, per CONSISTENCY-MODEL.md §4. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * One recorded checkout attempt.
 *
 * Authority: docs/architecture/CONSISTENCY-MODEL.md §4; MONGODB-DESIGN.md §11
 * (`idempotencyKeys` — `{key, userId, orderId, createdAt}`, `{key:1}` unique,
 * TTL 24 h); NESTJS-MODULE-MAP.md §2 (owned by `OrdersModule`).
 *
 * PERSISTED, not in memory. A mobile client retries across process restarts and
 * across API instances, so an in-process map would fail in exactly the
 * situations idempotency exists for — and would silently produce a second order
 * after a deploy. ANTI-OVERENGINEERING.md §85 names idempotency keys as one of
 * the two things that genuinely need durability.
 *
 * The record is written INSIDE the placement transaction, carrying the id of
 * the order it will create. That is what removes the "key consumed but no
 * result" state entirely: either both exist or neither does. A checkout that
 * fails validation, runs out of stock, or aborts for any other reason releases
 * its key, so the client may retry with the same one.
 *
 * ## Why this exists alongside `orders.idempotencyKey`
 *
 * They answer different questions and both are frozen:
 *
 *  - `orders.idempotencyKey` unique is PERMANENT. One key can never produce a
 *    second order, at any point in the future.
 *  - This record is the 24-HOUR REPLAY WINDOW. It also holds the two things an
 *    order document has no reason to store: the `requestHash`, which is how a
 *    key replayed with a materially different body is detected, and a direct
 *    `userId` binding for the ownership check that happens before any order is
 *    loaded.
 */
@Schema({ collection: 'idempotencyKeys', timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' })
export class IdempotencyKeyRecord {
  /** The client-supplied `Idempotency-Key` header, lower-cased. Unique. */
  @Prop({ type: String, required: true })
  key!: string;

  /**
   * The account the key belongs to.
   *
   * Every replay is checked against this BEFORE the order is loaded, so one
   * account can never receive another account's order by presenting its key.
   */
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /**
   * SHA-256 over the canonicalised checkout inputs.
   *
   * A replay is only a replay if it asks for the same thing. Reusing a key with
   * a different delivery address is a client bug — answering it with the first
   * order would ship goods to the wrong place — so it is refused rather than
   * served from the record.
   *
   * Deliberately NOT over the cart: the cart is server state, not a request
   * input, and hashing it would make a legitimate retry fail whenever the
   * catalogue re-priced in between.
   */
  @Prop({ type: String, required: true })
  requestHash!: string;

  /** The order this attempt created. Never null in a committed record. */
  @Prop({ type: Types.ObjectId, required: true })
  orderId!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export type IdempotencyKeyDocument = HydratedDocument<IdempotencyKeyRecord>;
export type IdempotencyKeyLean = IdempotencyKeyRecord & {
  _id: Types.ObjectId;
  createdAt: Date;
};

export const IdempotencyKeySchema = SchemaFactory.createForClass(IdempotencyKeyRecord);

/**
 * TWO indexes.
 *
 * `{ key: 1 }` unique is THE enforcement point. It is what makes two concurrent
 * requests carrying the same key produce at most one order: the loser's insert
 * is rejected by the database, not by an application check both could pass. It
 * also serves the pre-flight replay lookup, which is the hot read on this
 * collection.
 *
 * It is unique on `key` ALONE rather than on `{key, userId}`, per
 * MONGODB-DESIGN.md §11. That is deliberately stricter: a compound index would
 * let two accounts hold the same key, and the cross-account check would then
 * depend on remembering to filter by `userId` on every query. Here the second
 * account simply cannot claim the key, and the ownership check is a comparison
 * on a record that can only have one owner.
 *
 * `{ expiresAt: 1 }` TTL closes the window at 24 hours. Expiry cannot resurrect
 * a duplicate order, because `orders.idempotencyKey` remains unique forever.
 */
IdempotencyKeySchema.index({ key: 1 }, { unique: true, name: 'idempotency_key_unique' });
IdempotencyKeySchema.index({ expiresAt: 1 }, { name: 'idempotency_ttl', expireAfterSeconds: 0 });
