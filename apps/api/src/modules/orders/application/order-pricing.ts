import { AppException } from '../../../common/errors/app.exception';

/**
 * Money for an order, as pure integer arithmetic.
 *
 * Authority: docs/architecture/MONEY-MODEL.md §7.
 *
 * Every amount is int64 minor units (piastres). There is no float anywhere in
 * this file — no division, no `toFixed`, no `parseFloat` — because the only
 * rounding point the frozen model permits is a PERCENTAGE DISCOUNT, and no
 * discount infrastructure exists yet. Line totals are integer multiplication
 * and are therefore exact.
 *
 * These are functions, not a `PricingService`, and they live in `orders/`
 * rather than in a `PricingModule`. The frozen map gives `PricingModule` the
 * `coupons` and `couponRedemptions` collections; with neither in existence, a
 * module holding four arithmetic helpers would be a directory pretending to be
 * a boundary. They move there, unchanged, when coupons arrive.
 */

/**
 * Prices are VAT-INCLUSIVE and there is no additive tax term.
 *
 * Authority: MONEY-MODEL.md §7.4 — Egyptian retail convention, the product page
 * already states it, and every legacy order carried `tax = 0`. The rate is
 * recorded on each order as metadata so an invoice can DERIVE a VAT component
 * without changing what the customer paid, and so a future rate change cannot
 * rewrite historical orders.
 */
export const VAT_INCLUSIVE = true;

/** Egypt's standard rate, 14%, in basis points. Informational only. */
export const VAT_RATE_BPS = 1400;

export interface OrderPricing {
  readonly itemsSubtotal: number;
  readonly discountTotal: number;
  readonly shippingFee: number;
  readonly grandTotal: number;
}

/** Exact by construction: two integers multiplied. */
export function lineTotal(unitPrice: number, quantity: number): number {
  return unitPrice * quantity;
}

/**
 * THE canonical total. The only expression in the system permitted to produce a
 * payable amount.
 *
 *   grandTotal = itemsSubtotal - discountTotal + shippingFee
 *
 * `discountTotal` and `shippingFee` are parameters rather than hard-coded zeros
 * so the formula is the real one and each term has an authority elsewhere:
 *
 *  - **`discountTotal` is 0, and honestly so.** No coupon domain exists:
 *    `coupons` and `couponRedemptions` are not created, and `couponCode` is
 *    absent from every checkout DTO, so a client cannot even ask for a discount
 *    that could not be validated.
 *  - **`shippingFee` comes from `FulfilmentService`**, which is THE authority
 *    for what delivery costs (BUSINESS-RULES.md RULE-PRICE-009). It is computed
 *    from the governorate of the address the customer chose and the
 *    post-discount subtotal, and it evaluates to 0 under the CURRENT
 *    configuration because OPEN-001 records the per-governorate rate table as
 *    unsupplied business input — a configured number rather than a literal one
 *    written here, which is the difference this phase introduced.
 *
 * This function does not decide either term. It combines them, and refuses the
 * result if the combination does not hold.
 */
export function computeOrderPricing(
  itemsSubtotal: number,
  discountTotal: number,
  shippingFee: number,
): OrderPricing {
  const clampedDiscount = Math.min(Math.max(discountTotal, 0), itemsSubtotal);
  const grandTotal = itemsSubtotal - clampedDiscount + shippingFee;

  const pricing: OrderPricing = {
    itemsSubtotal,
    discountTotal: clampedDiscount,
    shippingFee,
    grandTotal,
  };

  assertPricingInvariants(pricing);

  return pricing;
}

/**
 * Re-derives the total and refuses to continue if it disagrees.
 *
 * Called immediately before persistence. A violation is not a client error and
 * carries no useful client-facing detail — it means the server computed a total
 * it cannot justify, and the only safe response is to place no order at all.
 * MONEY-MODEL.md §7.1 requires these invariants to be "asserted in code, not
 * merely documented"; this is that assertion.
 */
export function assertPricingInvariants(pricing: OrderPricing): void {
  const consistent =
    Number.isSafeInteger(pricing.itemsSubtotal) &&
    Number.isSafeInteger(pricing.discountTotal) &&
    Number.isSafeInteger(pricing.shippingFee) &&
    Number.isSafeInteger(pricing.grandTotal) &&
    pricing.itemsSubtotal >= 0 &&
    pricing.discountTotal >= 0 &&
    pricing.discountTotal <= pricing.itemsSubtotal &&
    pricing.shippingFee >= 0 &&
    pricing.grandTotal >= 0 &&
    pricing.grandTotal === pricing.itemsSubtotal - pricing.discountTotal + pricing.shippingFee;

  if (!consistent) {
    throw AppException.internal();
  }
}
