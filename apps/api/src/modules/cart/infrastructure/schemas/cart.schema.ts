import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { LocalizedText, LocalizedTextSchema } from '../../../catalog/infrastructure/schemas/embedded.schema';

/**
 * DISPLAY-ONLY. Never trusted for money, stock or availability.
 *
 * Authority: docs/architecture/CART-MODEL.md §4.
 *
 * Legacy stored NO price on a cart line, so `CartService.mapToCart` summed
 * `item.price` — always `undefined` — and the subtotal was permanently 0. The
 * naive fix is to store a price and let it go stale, creating a second price
 * authority. This snapshot is the third option: it is written at the moment the
 * customer acted, it is never summed, and every figure the API returns is
 * recomputed from live catalogue data.
 *
 * Its one load-bearing field is `unitPrice`, which is what `PRICE_CHANGED`
 * compares against — "the price has changed since you put this in your basket".
 */
@Schema({ _id: false, strict: 'throw' })
export class CartItemSnapshot {
  @Prop({ type: LocalizedTextSchema, required: true })
  name!: LocalizedText;

  @Prop({ type: String, required: true })
  sku!: string;

  @Prop({ type: String, required: true })
  slug!: string;

  /** Minor units, as shown to the customer when the line was last written. */
  @Prop({ type: Number, required: true })
  unitPrice!: number;

  @Prop({ type: String, default: null })
  imagePublicId!: string | null;
}
const CartItemSnapshotSchema = SchemaFactory.createForClass(CartItemSnapshot);

/**
 * One line. `productId` and `quantity` are the ONLY persisted intent.
 *
 * There is at most one line per product — see `CartRepository.addItem` for how
 * that invariant survives concurrent requests.
 */
@Schema({ _id: false, strict: 'throw' })
export class CartItem {
  @Prop({ type: Types.ObjectId, required: true })
  productId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;

  @Prop({ type: Date, required: true })
  addedAt!: Date;

  @Prop({ type: CartItemSnapshotSchema, required: true })
  snapshot!: CartItemSnapshot;
}
const CartItemSchema = SchemaFactory.createForClass(CartItem);

/**
 * A draft intent to purchase. Exactly one per authenticated user.
 *
 * Authority: docs/architecture/CART-MODEL.md §4; MONGODB-DESIGN.md §6.
 *
 * Items are EMBEDDED: bounded in practice, always loaded with the cart, never
 * queried independently. Legacy kept `cart_items` in its own table and the cart
 * was write-only — `getCart()` had zero call sites — so the storage cost was
 * paid for a feature nobody could read.
 *
 * The document is created LAZILY, on the first add. A registered user who has
 * never added anything gets an empty cart response, not a stored document.
 */
@Schema({ collection: 'carts', timestamps: true, strict: 'throw' })
export class Cart {
  /** Unique. The ownership key, present in the filter of EVERY cart query. */
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ type: [CartItemSchema], default: [] })
  items!: CartItem[];

  /** Pushed forward by every write. Drives the TTL index. */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export type CartDocument = HydratedDocument<Cart>;
export type CartLean = Cart & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const CartSchema = SchemaFactory.createForClass(Cart);

/**
 * Two indexes, and no more.
 *
 * `{ userId }` unique does double duty: it enforces "exactly one cart per user"
 * at the DATABASE — which is what makes the concurrent-add upsert safe, because
 * the loser of a race gets a duplicate-key error instead of a second cart — and
 * it serves every query in the repository, all of which lead with `userId`.
 *
 * There is deliberately NO index on `items.productId`. Every read already
 * narrows to one document by `userId`, and scanning a bounded embedded array
 * inside a document that is already in memory costs nothing an index could
 * recover.
 */
CartSchema.index({ userId: 1 }, { unique: true, name: 'cart_user_unique' });

/**
 * TTL, 30 days from the last write. Legacy had no expiry at all, so carts
 * accumulated forever.
 */
CartSchema.index({ expiresAt: 1 }, { name: 'cart_ttl', expireAfterSeconds: 0 });
