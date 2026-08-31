import type { PurchasableProduct } from '../../catalog/application/products.service';

/**
 * Cart rules, expressed as pure functions.
 *
 * No NestJS, no Mongoose, no I/O — so every one of them is unit-testable in
 * microseconds, and none can be quietly coupled to transport or persistence.
 */

export const MIN_QUANTITY = 1;

/**
 * THE maximum per line. ONE constant.
 *
 * Authority: docs/architecture/CART-MODEL.md §6. Legacy defined 99 in four
 * separate places — `cart-store.ts`, `constants.ts`, `CartService` and
 * `cartItemSchema` — and enforced it only in the browser, which any client can
 * skip.
 */
export const MAX_QUANTITY_PER_LINE = 99;

/** 30 days from the last write. */
export const CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Per-line state, resolved live on every read.
 *
 * Authority: docs/architecture/CART-MODEL.md §5.
 */
export enum CartLineStatus {
  /** Available, and the price is what the customer last saw. */
  OK = 'OK',
  /** Live price differs from the price shown when the line was last written. */
  PRICE_CHANGED = 'PRICE_CHANGED',
  /** `0 < onHand < quantity` — the line is counted at the reduced quantity. */
  REDUCED_STOCK = 'REDUCED_STOCK',
  /** `onHand === 0`. Retained, but excluded from the subtotal. */
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  /** Delisted, soft-deleted, or gone. Retained, but excluded from the subtotal. */
  UNAVAILABLE = 'UNAVAILABLE',
}

/** Statuses that keep a line visible but out of the money. */
const NON_COUNTING: ReadonlySet<CartLineStatus> = new Set([
  CartLineStatus.OUT_OF_STOCK,
  CartLineStatus.UNAVAILABLE,
]);

export function countsTowardsSubtotal(status: CartLineStatus): boolean {
  return !NON_COUNTING.has(status);
}

/**
 * The most quantity that may sit on one line right now.
 *
 * `min(MAX_QUANTITY_PER_LINE, onHand)` — the hard product cap and the live
 * stock cap are the same rule applied twice, so they are resolved in one place.
 */
export function effectiveMaxQuantity(onHand: number): number {
  return Math.max(0, Math.min(MAX_QUANTITY_PER_LINE, onHand));
}

export interface ResolvedLine {
  readonly status: CartLineStatus;
  /**
   * What the customer will actually be charged for. Equals the stored quantity
   * except when stock has fallen below it, where it is clamped to `onHand`.
   *
   * The STORED quantity is deliberately left alone — it is the customer's
   * intent, and if stock is replenished the line recovers on its own rather
   * than having been quietly reduced by a page load.
   */
  readonly effectiveQuantity: number;
  /** Live unit price in minor units. Zero when there is no product to price. */
  readonly unitPrice: number;
  /** What the line was worth when last written, for a PRICE_CHANGED diff. */
  readonly previousUnitPrice: number;
  readonly availableQuantity: number;
}

/**
 * Resolves one line against live catalogue state.
 *
 * The status ladder is ordered by severity — UNAVAILABLE beats OUT_OF_STOCK
 * beats REDUCED_STOCK beats PRICE_CHANGED — because a client renders ONE badge
 * per line and must be told the most blocking thing first. A delisted product
 * whose price also moved is delisted; the price is irrelevant.
 */
export function resolveLine(
  storedQuantity: number,
  snapshotUnitPrice: number,
  product: PurchasableProduct | undefined,
): ResolvedLine {
  // Absent from the catalogue entirely: hard-deleted, which only a SUPER_ADMIN
  // can do and only for a product no order references.
  if (product === undefined) {
    return {
      status: CartLineStatus.UNAVAILABLE,
      effectiveQuantity: storedQuantity,
      unitPrice: 0,
      previousUnitPrice: snapshotUnitPrice,
      availableQuantity: 0,
    };
  }

  const base = {
    unitPrice: product.effectivePrice,
    previousUnitPrice: snapshotUnitPrice,
    availableQuantity: product.onHand,
  };

  if (!product.purchasable) {
    return { ...base, status: CartLineStatus.UNAVAILABLE, effectiveQuantity: storedQuantity };
  }

  if (product.onHand <= 0) {
    return { ...base, status: CartLineStatus.OUT_OF_STOCK, effectiveQuantity: storedQuantity };
  }

  if (product.onHand < storedQuantity) {
    return { ...base, status: CartLineStatus.REDUCED_STOCK, effectiveQuantity: product.onHand };
  }

  if (product.effectivePrice !== snapshotUnitPrice) {
    return { ...base, status: CartLineStatus.PRICE_CHANGED, effectiveQuantity: storedQuantity };
  }

  return { ...base, status: CartLineStatus.OK, effectiveQuantity: storedQuantity };
}

/**
 * The only money the cart computes: the sum of its countable lines.
 *
 * Integer multiplication and addition throughout — exact, with no rounding, so
 * MONEY-MODEL.md §7.2's single rounding point (percentage discounts) is not
 * touched here. Discounts, shipping and a grand total are deliberately NOT
 * computed: they belong to the checkout quote, where a coupon can be validated
 * live and shipping resolved from an address.
 */
export function itemsSubtotal(lines: readonly ResolvedLine[]): number {
  return lines.reduce(
    (total, line) =>
      countsTowardsSubtotal(line.status)
        ? total + line.unitPrice * line.effectiveQuantity
        : total,
    0,
  );
}
