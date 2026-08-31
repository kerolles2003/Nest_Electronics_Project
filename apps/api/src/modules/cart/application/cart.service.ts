import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { ClientSession } from 'mongoose';
import { DEFAULT_CURRENCY } from '../../../common/dto/money.dto';
import { AppException } from '../../../common/errors/app.exception';
import type { LocalizedTextValue } from '../../../common/localization/locale';
import { ProductsService, type PurchasableProduct } from '../../catalog/application/products.service';
import { CartRepository } from '../infrastructure/repositories/cart.repository';
import type { CartItem, CartItemSnapshot, CartLean } from '../infrastructure/schemas/cart.schema';
import {
  CartLineStatus,
  countsTowardsSubtotal,
  effectiveMaxQuantity,
  itemsSubtotal,
  resolveLine,
} from './cart-line';

/**
 * One resolved cart line, priced live.
 *
 * This is a DOMAIN shape, not an HTTP DTO. Checkout will consume `CartView`
 * directly from this service — it must never have to scrape a response DTO or
 * reach into the cart's persistence to learn what the customer wants to buy.
 */
export interface CartLineView {
  readonly productId: Types.ObjectId;
  /** The customer's stated intent. Never reduced by a read. */
  readonly quantity: number;
  /** What will actually be charged — `quantity`, clamped to live stock. */
  readonly effectiveQuantity: number;
  readonly addedAt: Date;
  readonly status: CartLineStatus;
  readonly unitPrice: number;
  readonly previousUnitPrice: number;
  readonly lineTotal: number;
  readonly availableQuantity: number;
  readonly currency: string;
  readonly sku: string;
  readonly slug: string;
  readonly name: LocalizedTextValue;
  readonly imagePublicId: string | null;
  /**
   * Not rendered by the cart, and deliberately absent from `CartLineDto`.
   *
   * It is here because checkout SNAPSHOTS it onto the order line, and the cart
   * is where checkout learns everything about a product. Resolving it a second
   * time in OrdersModule would mean a second product read for one string.
   */
  readonly brandName: string | null;
}

/** The authoritative cart, as every consumer sees it. */
export interface CartView {
  readonly lines: readonly CartLineView[];
  /** Distinct products. */
  readonly itemCount: number;
  /** Sum of stored quantities across all lines. */
  readonly totalQuantity: number;
  /** Sum of countable lines only. Excludes OUT_OF_STOCK and UNAVAILABLE. */
  readonly itemsSubtotal: number;
  readonly currency: string;
  /**
   * True when at least one line is OUT_OF_STOCK or UNAVAILABLE.
   *
   * Checkout blocks on this; the client uses it to disable its button and say
   * why. Computing it here means neither has to re-derive the rule from the
   * per-line statuses and get it subtly different.
   */
  readonly hasBlockingIssues: boolean;
  readonly updatedAt: Date | null;
  readonly expiresAt: Date | null;
}

/**
 * The cart.
 *
 * Authority: docs/architecture/CART-MODEL.md.
 *
 * The rule the whole module is built around: **the cart is a draft intent to
 * purchase, and is never a source of truth for price, stock or availability.**
 * It persists `{productId, quantity}`. Every figure it returns is recomputed
 * from live catalogue data on the request that returns it.
 *
 * `userId` always arrives from the JWT — no cart DTO has such a field, and no
 * method here accepts a cart id, so there is nothing for a caller to forge.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly carts: CartRepository,
    private readonly products: ProductsService,
  ) {}

  /**
   * The authoritative cart. THE method Checkout calls.
   *
   * One database read for the cart, one batched read for every referenced
   * product — never one query per line. Legacy's cart could not compute money
   * at all, because `cart_items` had no price column and nothing ever joined
   * back to the catalogue.
   *
   * `session` is supplied by order placement so that BOTH reads happen inside
   * its transaction, against the same snapshot the stock decrement is evaluated
   * against. Checkout therefore re-uses this exact resolution — the same
   * clamping, the same status ladder, the same live prices — rather than
   * reimplementing it and drifting from the cart the customer was shown.
   */
  async getCart(userId: Types.ObjectId, session?: ClientSession): Promise<CartView> {
    const cart = await this.carts.findByUser(userId, session);

    if (cart === null || cart.items.length === 0) {
      return CartService.emptyCart(cart);
    }

    const products = await this.products.findPurchasableByIds(
      cart.items.map((item) => item.productId),
      session,
    );

    return CartService.project(cart, products);
  }

  /**
   * Empties the cart as part of somebody else's transaction.
   *
   * THE reason this method exists: order placement must clear the cart in the
   * same transaction that writes the order, so neither "order created, cart
   * still full" nor "cart emptied, no order" is representable
   * (CART-MODEL.md §9).
   *
   * It returns nothing, unlike `clear()`, because the caller is mid-transaction
   * and re-reading the cart it just emptied would cost a round trip to learn
   * that it is empty. `clear()` keeps returning the whole cart for HTTP callers
   * that render the result.
   *
   * The alternative — OrdersModule updating `carts` itself — would put a second
   * writer on a collection CartModule owns, and the TTL refresh and the
   * only-write-if-non-empty filter would immediately exist in two places.
   */
  async clearInTransaction(userId: Types.ObjectId, session: ClientSession): Promise<void> {
    await this.carts.clear(userId, session);
  }

  /**
   * Adds a product, or increases the line that already holds it.
   *
   * `quantity` is ADDITIVE: sending 2 for a product already at 3 yields 5,
   * which is what "add to cart" means everywhere. The result is capped at
   * `min(99, onHand)`; the response reports the resulting quantity and flags
   * the line, so a cap is never silent.
   */
  async addItem(
    userId: Types.ObjectId,
    productId: Types.ObjectId,
    quantity: number,
  ): Promise<CartView> {
    const product = await this.requirePurchasable(productId);

    await this.carts.addItem(
      userId,
      { productId, quantity, snapshot: CartService.snapshotOf(product) },
      effectiveMaxQuantity(product.onHand),
    );

    return this.getCart(userId);
  }

  /**
   * Sets a line to an exact quantity.
   *
   * `quantity: 0` is rejected by the DTO — removing is DELETE, which is
   * idempotent, whereas a 0 here would silently mean two different things.
   */
  async updateQuantity(
    userId: Types.ObjectId,
    productId: Types.ObjectId,
    quantity: number,
  ): Promise<CartView> {
    const product = await this.requirePurchasable(productId);
    const clamped = Math.min(quantity, effectiveMaxQuantity(product.onHand));

    const updated = await this.carts.setQuantity(
      userId,
      productId,
      clamped,
      CartService.snapshotOf(product),
    );

    if (!updated) {
      throw AppException.cartItemNotFound();
    }

    return this.getCart(userId);
  }

  /** Idempotent: removing a line that is not there is a success, not a 404. */
  async removeItem(userId: Types.ObjectId, productId: Types.ObjectId): Promise<CartView> {
    await this.carts.removeItem(userId, productId);

    return this.getCart(userId);
  }

  /** Idempotent, including for a user who has never had a cart. */
  async clear(userId: Types.ObjectId): Promise<CartView> {
    await this.carts.clear(userId);

    return this.getCart(userId);
  }

  // --- internals ------------------------------------------------------------

  /**
   * Loads a product and refuses the three states a customer must not be able to
   * add.
   *
   * Every one of these is checked against the DATABASE, never against anything
   * the client sent. The client supplies a product id and a quantity; price,
   * currency, availability and stock are all read here.
   */
  private async requirePurchasable(productId: Types.ObjectId): Promise<PurchasableProduct> {
    const products = await this.products.findPurchasableByIds([productId]);
    const product = products.get(productId.toHexString());

    if (product === undefined) {
      throw AppException.productNotFound();
    }

    if (!product.purchasable) {
      throw AppException.productUnavailable();
    }

    if (product.onHand <= 0) {
      // Adding something with zero stock is refused outright; a line that runs
      // out AFTER it was added is retained and flagged instead, because the
      // customer should see why their total changed.
      throw AppException.outOfStock(product.sku, 0);
    }

    return product;
  }

  private static snapshotOf(product: PurchasableProduct): CartItemSnapshot {
    return {
      // Normalised to the stored shape: the catalogue's `ar` is optional,
      // the persisted one is explicitly nullable, and `strict: 'throw'` would
      // reject an undefined path.
      name: { en: product.name.en, ar: product.name.ar ?? null },
      sku: product.sku,
      slug: product.slug,
      // The price the customer is being shown right now. PRICE_CHANGED later
      // compares against exactly this.
      unitPrice: product.effectivePrice,
      imagePublicId: product.primaryImagePublicId,
    };
  }

  private static emptyCart(cart: CartLean | null): CartView {
    return {
      lines: [],
      itemCount: 0,
      totalQuantity: 0,
      itemsSubtotal: 0,
      currency: DEFAULT_CURRENCY,
      hasBlockingIssues: false,
      updatedAt: cart?.updatedAt ?? null,
      expiresAt: cart?.expiresAt ?? null,
    };
  }

  private static project(
    cart: CartLean,
    products: ReadonlyMap<string, PurchasableProduct>,
  ): CartView {
    const resolved = cart.items.map((item: CartItem) => {
      const product = products.get(item.productId.toHexString());
      const line = resolveLine(item.quantity, item.snapshot.unitPrice, product);

      return {
        productId: item.productId,
        quantity: item.quantity,
        effectiveQuantity: line.effectiveQuantity,
        addedAt: item.addedAt,
        status: line.status,
        unitPrice: line.unitPrice,
        previousUnitPrice: line.previousUnitPrice,
        lineTotal: countsTowardsSubtotal(line.status)
          ? line.unitPrice * line.effectiveQuantity
          : 0,
        availableQuantity: line.availableQuantity,
        currency: product?.currency ?? DEFAULT_CURRENCY,
        // The live product where it exists; the snapshot is the fallback that
        // lets a hard-deleted product still render as a named line rather than
        // a blank row the customer cannot recognise.
        sku: product?.sku ?? item.snapshot.sku,
        slug: product?.slug ?? item.snapshot.slug,
        name: product?.name ?? item.snapshot.name,
        imagePublicId: product?.primaryImagePublicId ?? item.snapshot.imagePublicId,
        // No snapshot fallback: the cart never stored a brand, so a
        // hard-deleted product simply has none rather than a stale one.
        brandName: product?.brandName ?? null,
      } satisfies CartLineView;
    });

    return {
      lines: resolved,
      itemCount: resolved.length,
      totalQuantity: resolved.reduce((total, line) => total + line.quantity, 0),
      itemsSubtotal: itemsSubtotal(
        resolved.map((line) => ({
          status: line.status,
          effectiveQuantity: line.effectiveQuantity,
          unitPrice: line.unitPrice,
          previousUnitPrice: line.previousUnitPrice,
          availableQuantity: line.availableQuantity,
        })),
      ),
      // One currency exists system-wide and conversion is forbidden
      // (MONEY-MODEL.md §7.5), so the cart total is always in it.
      currency: DEFAULT_CURRENCY,
      hasBlockingIssues: resolved.some((line) => !countsTowardsSubtotal(line.status)),
      updatedAt: cart.updatedAt,
      expiresAt: cart.expiresAt,
    };
  }
}

export { CartLineStatus };
