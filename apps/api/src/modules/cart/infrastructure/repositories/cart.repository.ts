import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { ClientSession } from 'mongoose';
import { CART_TTL_MS } from '../../application/cart-line';
import { Cart, type CartItemSnapshot, type CartLean } from '../schemas/cart.schema';

/**
 * MongoDB's duplicate-key error code.
 *
 * **Every `catch` on this code below is a CONCURRENCY CONTROL, not error
 * handling.** The unique index is what makes the operation correct under
 * concurrency; the catch is only how the refusal is translated. Drop the
 * index and the error never arrives, the catch never runs, and the race
 * silently succeeds — no exception, no log line, nothing to notice.
 *
 * `GET /health/ready` refuses traffic when a declared index is missing, and
 * `test/infrastructure/index-health.spec.ts` lists every invariant that
 * depends on one. Do not remove an index named there.
 */
const DUPLICATE_KEY = 11000;

/**
 * How many times an add will re-read and retry when it loses a race.
 *
 * Three is not arbitrary: each retry is triggered by another request having
 * just written this user's cart, and a single user's own concurrent adds are
 * the only source of contention. Two rounds cover the realistic case; the third
 * is slack.
 */
const MAX_ADD_ATTEMPTS = 3;

export interface NewCartLine {
  readonly productId: Types.ObjectId;
  readonly quantity: number;
  readonly snapshot: CartItemSnapshot;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY
  );
}

/**
 * Every cart query in the system.
 *
 * TWO properties hold across all of it:
 *
 *  1. **`userId` is in the filter of every single operation.** Ownership is a
 *     QUERY CONDITION, never a fetch-then-compare in the service
 *     (AUTHORIZATION-MODEL.md §4). There is no method here that can be called
 *     with someone else's cart id, because no method accepts a cart id at all.
 *
 *  2. **No operation spans two documents,** so none needs a transaction. Every
 *     write below is a single-document update, which MongoDB already applies
 *     atomically. Reaching for `TransactionService` here would add a session
 *     round trip and buy nothing.
 */
@Injectable()
export class CartRepository {
  constructor(@InjectModel(Cart.name) private readonly model: Model<Cart>) {}

  private static expiry(): Date {
    return new Date(Date.now() + CART_TTL_MS);
  }

  /**
   * Null when the user has never added anything — the document is created
   * lazily.
   *
   * The optional session is for CHECKOUT, which must read the cart inside its
   * placement transaction. Reading it outside would mean pricing an order from
   * one snapshot and clearing the cart in another, so a line added between the
   * two would be silently discarded without ever being ordered.
   */
  async findByUser(userId: Types.ObjectId, session?: ClientSession): Promise<CartLean | null> {
    return this.model.findOne({ userId }).session(session ?? null).lean<CartLean>().exec();
  }

  /**
   * Adds `line.quantity` to an existing line, or creates the line, or creates
   * the whole cart — whichever applies — without ever producing two lines for
   * one product.
   *
   * ## Why this is written as a loop of conditional updates
   *
   * The obvious implementation is read-then-write: load the cart, look for the
   * product, decide, save. That is exactly the shape that produces duplicate
   * lines, because two requests can both read "not present" before either
   * writes. "We checked first" is not a concurrency strategy.
   *
   * Instead every step is a conditional single-document update whose FILTER
   * carries the precondition:
   *
   *   A. `$inc` the existing line, but only while the result would stay within
   *      `effectiveMax`. Matching zero means either the line is absent or it is
   *      already at the cap.
   *   B. Clamp an existing line to `effectiveMax`. Matching zero means absent.
   *   C. Push a new line, but ONLY if no line for this product exists
   *      (`$ne`), upserting the cart document if the user has none.
   *
   * Step C is the load-bearing one. MongoDB re-evaluates an update's filter
   * when it retries after a write conflict, so if a concurrent request pushed
   * the same product first, the `$ne` predicate no longer holds and this update
   * matches nothing rather than appending a duplicate. With `upsert: true` a
   * non-match becomes an insert attempt, which the unique `userId` index then
   * rejects with a duplicate-key error — the signal that another request
   * created the cart underneath us.
   *
   * Either failure means the world changed; the loop re-reads and tries again.
   */
  async addItem(
    userId: Types.ObjectId,
    line: NewCartLine,
    effectiveMax: number,
  ): Promise<void> {
    const expiresAt = CartRepository.expiry();

    for (let attempt = 0; attempt < MAX_ADD_ATTEMPTS; attempt += 1) {
      // --- A: increase an existing line, staying inside the cap -------------
      const increased = await this.model
        .updateOne(
          {
            userId,
            items: {
              $elemMatch: {
                productId: line.productId,
                quantity: { $lte: effectiveMax - line.quantity },
              },
            },
          },
          {
            $inc: { 'items.$.quantity': line.quantity },
            $set: { 'items.$.snapshot': line.snapshot, expiresAt },
          },
        )
        .exec();

      if (increased.matchedCount === 1) {
        return;
      }

      // --- B: the line exists but adding would exceed the cap; clamp --------
      // Frozen behaviour (CART-MODEL.md §6): an add CLAMPS rather than fails.
      // It is not silent — the response reports the resulting quantity and
      // flags the line REDUCED_STOCK when stock is what capped it.
      //
      // The `$gt` is the EXACT COMPLEMENT of A's `$lte`, and it is load-bearing
      // rather than redundant. A misses for two different reasons — the line is
      // at the cap, or the line is not there at all — and this step must only
      // handle the first. Filtering on "a line for this product exists" would
      // handle both, so a line CREATED BY A CONCURRENT REQUEST between A and B
      // would be clamped straight to `effectiveMax`: eight simultaneous adds of
      // one unit produced a line of 50 instead of 8, because one of them
      // inferred "A missed, therefore we are at the cap" from a read that was
      // already stale. Inferring a precondition instead of stating it in the
      // filter is the same TOCTOU shape this whole method exists to avoid.
      //
      // With the predicate in the filter, a line that is below the cap simply
      // does not match here; the loop falls through to C, which cannot append a
      // duplicate either, and the next pass finds the line at A and increments
      // it correctly.
      const clamped = await this.model
        .updateOne(
          {
            userId,
            items: {
              $elemMatch: {
                productId: line.productId,
                quantity: { $gt: effectiveMax - line.quantity },
              },
            },
          },
          {
            $set: {
              'items.$.quantity': effectiveMax,
              'items.$.snapshot': line.snapshot,
              expiresAt,
            },
          },
        )
        .exec();

      if (clamped.matchedCount === 1) {
        return;
      }

      // --- C: no line for this product; append, creating the cart if needed -
      try {
        const appended = await this.model
          .updateOne(
            { userId, 'items.productId': { $ne: line.productId } },
            {
              $push: {
                items: {
                  productId: line.productId,
                  quantity: Math.min(line.quantity, effectiveMax),
                  addedAt: new Date(),
                  snapshot: line.snapshot,
                },
              },
              $set: { expiresAt },
              $setOnInsert: { userId },
            },
            { upsert: true },
          )
          .exec();

        if (appended.matchedCount === 1 || appended.upsertedCount === 1) {
          return;
        }
      } catch (error) {
        if (!isDuplicateKey(error)) {
          throw error;
        }
        /*
         * `carts.cart_user_unique` IS what makes this loop terminate correctly.
         *
         * Another request created this user's cart between C's filter and its
         * insert. Fall through and retry — the line may now exist, so the next
         * pass starts again at A.
         *
         * Without the index both upserts succeed, the customer has two carts,
         * and which one they see depends on which document the query returns.
         * The loop would never notice: it is waiting for exactly this error.
         */
      }
    }

    // Only reachable if the same user hammered their own cart concurrently for
    // three full rounds. Surfacing it beats looping forever or writing a
    // duplicate line.
    throw new Error('cart add could not converge after repeated concurrent modification');
  }

  /**
   * Sets a line to an exact quantity. Returns false when the user has no such
   * line, which the service turns into CART_ITEM_NOT_FOUND.
   */
  async setQuantity(
    userId: Types.ObjectId,
    productId: Types.ObjectId,
    quantity: number,
    snapshot: CartItemSnapshot,
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { userId, 'items.productId': productId },
        {
          $set: {
            'items.$.quantity': quantity,
            'items.$.snapshot': snapshot,
            expiresAt: CartRepository.expiry(),
          },
        },
      )
      .exec();

    return result.matchedCount === 1;
  }

  /**
   * Removes a line. Idempotent by contract: a line that is already gone is not
   * an error, because the caller's intent — "this product should not be in my
   * cart" — is already satisfied.
   *
   * The filter requires the line to EXIST, so an idempotent no-op touches
   * nothing. That matters twice over: `updatedAt` keeps meaning "when the cart
   * last actually changed", and a client polling DELETE cannot keep pushing the
   * 30-day expiry forward on a cart nobody is really using.
   */
  async removeItem(userId: Types.ObjectId, productId: Types.ObjectId): Promise<void> {
    await this.model
      .updateOne(
        { userId, 'items.productId': productId },
        { $pull: { items: { productId } }, $set: { expiresAt: CartRepository.expiry() } },
      )
      .exec();
  }

  /**
   * Empties the cart. Idempotent, a no-op for a user who has no cart, and — as
   * with `removeItem` — a no-op that does not write when there is nothing to
   * clear.
   *
   * ## The session parameter
   *
   * Order placement clears the cart as PART OF the order transaction, after the
   * order document is written. That is what makes both of these impossible:
   *
   *   order created + cart not cleared
   *   cart cleared + no order
   *
   * An optional parameter rather than a second method, because the two callers
   * want identical semantics and only differ in whether a transaction is open —
   * and a `clearInTransaction` twin is how the two copies start to drift. This
   * is the same shape `findByUser` uses above.
   *
   * Checkout does NOT reimplement this. `CART-MODEL.md` §9 puts the clear inside
   * the order transaction; duplicating the update in OrdersModule would put a
   * second writer on the `carts` collection, which CartModule owns.
   */
  async clear(userId: Types.ObjectId, session?: ClientSession): Promise<void> {
    await this.model
      .updateOne(
        { userId, 'items.0': { $exists: true } },
        { $set: { items: [], expiresAt: CartRepository.expiry() } },
      )
      .session(session ?? null)
      .exec();
  }
}
