import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import { Types } from 'mongoose';
import { Product } from '../../../catalog/infrastructure/schemas/product.schema';
import { InventoryEvent } from '../schemas/inventory-event.schema';

/** What the product looked like immediately after a successful decrement. */
export interface StockDecrement {
  readonly balanceBefore: number;
  readonly balanceAfter: number;
}

/** Why a decrement matched nothing. Resolved by a diagnostic read, never guessed. */
export interface StockRefusal {
  readonly reason: 'UNAVAILABLE' | 'INSUFFICIENT' | 'MISSING';
  readonly available: number;
}

/**
 * Every write to `products.stock`, and every write to `inventoryEvents`.
 *
 * Authority: docs/architecture/INVENTORY-MODEL.md §5.1, §6;
 *            docs/architecture/NESTJS-MODULE-MAP.md §2 — `InventoryModule` owns
 *            `products.stock` and `inventoryEvents`.
 *
 * `stock` lives inside the product document (so availability needs no join on
 * the hottest read in the system) but is written ONLY from here — the one
 * deliberate exception to aggregate ownership, ADR-INVENTORY-002. The product
 * update DTO rejects `stock`, so a generic admin edit cannot reach it.
 */
@Injectable()
export class InventoryRepository {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(InventoryEvent.name) private readonly events: Model<InventoryEvent>,
  ) {}

  /**
   * THE overselling guard.
   *
   * The availability precondition lives INSIDE the update filter, so the check
   * and the mutation are one atomic operation on one document. Nothing is read
   * first and compared in the application — that is the legacy TOCTOU shape,
   * where two callers both pass a check before either writes.
   *
   * Returns `null` when the filter matched nothing, which means one of: stock
   * fell below `quantity`, the product was delisted or soft-deleted, or it no
   * longer exists. The caller resolves which with `diagnose`, on the failure
   * path only.
   *
   * `returnDocument: 'after'` gives the post-decrement balance from the same
   * round trip, so the ledger's `balanceAfter` is the value the server actually
   * wrote rather than a number the application computed and hoped matched.
   *
   * Authority: INVENTORY-MODEL.md §5.1 — the `$gte` predicate in the filter is
   * a direct port of the one concurrency primitive legacy got right.
   */
  async decrementForSale(
    productId: Types.ObjectId,
    quantity: number,
    session: ClientSession,
  ): Promise<StockDecrement | null> {
    const updated = await this.products
      .findOneAndUpdate(
        {
          _id: productId,
          isActive: true,
          deletedAt: null,
          'stock.onHand': { $gte: quantity },
        },
        { $inc: { 'stock.onHand': -quantity, salesCount: quantity } },
        { session, returnDocument: 'after', projection: { 'stock.onHand': 1 } },
      )
      .lean<{ _id: Types.ObjectId; stock: { onHand: number } }>()
      .exec();

    if (updated === null) {
      return null;
    }

    return { balanceBefore: updated.stock.onHand + quantity, balanceAfter: updated.stock.onHand };
  }

  /**
   * Applies a SIGNED manual adjustment, refusing anything that would drive the
   * balance negative.
   *
   * Authority: INVENTORY-MODEL.md §5.3 — "Resulting `onHand` must be ≥ 0,
   * enforced by a conditional update".
   *
   * ## Why the floor is in the FILTER and not in an `if`
   *
   * Same reason as `decrementForSale`, and it is the whole design: a read, a
   * comparison in the application, and then a write is the legacy TOCTOU shape
   * — two operators can both pass the check before either writes, and the
   * second one takes the balance negative. `{ 'stock.onHand': { $gte: -delta } }`
   * evaluates the precondition inside the same atomic update, so the second one
   * matches nothing.
   *
   * The predicate is only applied when `delta` is negative. A positive
   * adjustment cannot underflow, and a `$gte` against a negative number would
   * be a filter that reads as if it were guarding something while guarding
   * nothing — worse than no filter, because a reader would believe it.
   *
   * ## Unlike a sale, this does NOT filter on `isActive` or `deletedAt`
   *
   * The same reasoning as `incrementForRestore`. Goods physically exist whether
   * or not the product is listed; refusing to record a count on a delisted
   * product would make delisting a way to lose stock silently, and an operator
   * counting a shelf is describing reality, not asking to sell anything.
   *
   * Returns `null` when the update matched nothing — either the product does
   * not exist, or the floor refused it. The caller distinguishes with
   * `diagnose`, on the failure path only.
   */
  async adjust(
    productId: Types.ObjectId,
    delta: number,
    session: ClientSession,
  ): Promise<StockDecrement | null> {
    const filter: Record<string, unknown> = { _id: productId };

    if (delta < 0) {
      filter['stock.onHand'] = { $gte: -delta };
    }

    const updated = await this.products
      .findOneAndUpdate(
        filter,
        { $inc: { 'stock.onHand': delta } },
        { session, returnDocument: 'after', projection: { 'stock.onHand': 1 } },
      )
      .lean<{ _id: Types.ObjectId; stock: { onHand: number } }>()
      .exec();

    if (updated === null) {
      return null;
    }

    return { balanceBefore: updated.stock.onHand - delta, balanceAfter: updated.stock.onHand };
  }

  /**
   * Returns goods to stock. The mirror of `decrementForSale`, sign reversed.
   *
   * Authority: INVENTORY-MODEL.md §5.2 — cancellation and return both increase
   * stock and both write a positive ledger entry.
   *
   * ## There is deliberately NO availability precondition
   *
   * `decrementForSale` filters on `isActive` and `deletedAt` because selling a
   * delisted product is wrong. Putting the same filter here would be a bug:
   * goods coming back from a cancelled order physically exist regardless of
   * whether the product was delisted in the meantime, and refusing to record
   * them would make delisting a way to silently destroy stock — the exact
   * class of defect (F-HIGH-2) this method was written to close. A delisted
   * product simply has stock that is not for sale.
   *
   * There is also no `$gte` guard, because there is nothing to guard: adding
   * stock cannot drive a balance negative, so no concurrent restore can
   * oversell. What prevents a DOUBLE restore is not this filter — it is the
   * unique index on `inventoryEvents {reference.id, productId, type}` plus the
   * guarded status update that gates the whole transaction.
   *
   * Returns `null` only when the product no longer exists as a document, i.e.
   * it was HARD-deleted. Nothing in the system does that; the caller treats it
   * as a line with nowhere to put the stock rather than as a reason to trap the
   * customer's order in a state it can never leave.
   */
  async incrementForRestore(
    productId: Types.ObjectId,
    quantity: number,
    session: ClientSession,
  ): Promise<StockDecrement | null> {
    const updated = await this.products
      .findOneAndUpdate(
        { _id: productId },
        // `salesCount` comes back down with the stock: the sale is being
        // reversed, so a cancelled order must not keep inflating a
        // best-seller ranking (ORDER-LIFECYCLE.md §11).
        { $inc: { 'stock.onHand': quantity, salesCount: -quantity } },
        { session, returnDocument: 'after', projection: { 'stock.onHand': 1 } },
      )
      .lean<{ _id: Types.ObjectId; stock: { onHand: number } }>()
      .exec();

    if (updated === null) {
      return null;
    }

    return { balanceBefore: updated.stock.onHand - quantity, balanceAfter: updated.stock.onHand };
  }

  /**
   * Reads a refused product to say WHY, inside the same session so the answer
   * describes the same snapshot the decrement was evaluated against.
   *
   * Only ever called after a refusal, so the ordinary path costs one round trip,
   * not two. `available` is public catalogue information — the same number the
   * product page shows — so returning it leaks nothing.
   */
  async diagnose(productId: Types.ObjectId, session: ClientSession): Promise<StockRefusal> {
    const product = await this.products
      .findOne({ _id: productId })
      .select({ 'stock.onHand': 1, isActive: 1, deletedAt: 1 })
      .session(session)
      .lean<{ stock: { onHand: number }; isActive: boolean; deletedAt: Date | null }>()
      .exec();

    if (product === null) {
      return { reason: 'MISSING', available: 0 };
    }

    if (!product.isActive || product.deletedAt !== null) {
      return { reason: 'UNAVAILABLE', available: product.stock.onHand };
    }

    return { reason: 'INSUFFICIENT', available: product.stock.onHand };
  }

  /**
   * Appends ledger entries. One write for the whole order.
   *
   * `ordered: true` is the default and is what we want: the unique reference
   * index must reject the batch rather than let a partial ledger through, and
   * the surrounding transaction rolls the whole thing back either way.
   */
  async recordEvents(
    events: readonly Partial<InventoryEvent>[],
    session: ClientSession,
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await this.events.insertMany(events, { session });
  }
}
