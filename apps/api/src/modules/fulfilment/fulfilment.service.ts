import { Inject, Injectable } from '@nestjs/common';
import { fulfilmentConfig, type FulfilmentConfig } from '../../config/fulfilment.config';
import { AppException } from '../../common/errors/app.exception';

/**
 * THE shipping cost authority.
 *
 * Authority: docs/architecture/NESTJS-MODULE-MAP.md §9 — "Public API:
 * `FulfilmentService.quote(governorate, subtotal)`";
 *            MONEY-MODEL.md §7.1 — `shippingFee = FulfilmentService.quote(
 *            governorate, itemsSubtotal - discountTotal)`;
 *            BUSINESS-RULES.md RULE-PRICE-009 — "shipping fee is ALWAYS
 *            server-computed from governorate + post-discount subtotal".
 *
 * ## What this replaces
 *
 * A literal `0` written inline in `CheckoutService`, twice — once in the quote
 * and once in placement — with a comment explaining why. That is the same shape
 * as the legacy defect RULE-PRICE-009 records: `p_shipping_fee: 0` hardcoded at
 * the CALL SITE, where shipping policy is invisible and unversioned. The number
 * has not changed; its authority has. There is now exactly one expression in the
 * system that decides what delivery costs.
 *
 * ## What this deliberately is NOT
 *
 * No carrier API, no rate shopping, no geocoder, no delivery-zone graph, no
 * strategy framework, no `shippingRates` collection and no `ShippingRatePort`.
 * OPEN-001 records the rate values as unsupplied business input; a lookup table
 * with nothing in it would let a MISS decide what every customer is charged.
 *
 * ## How the three deferred features land without touching checkout
 *
 * The signature already carries everything each of them needs, which is the
 * whole point of introducing it now:
 *
 *  - **Per-governorate rates** — `governorate` is already a parameter; replace
 *    the flat read with a lookup.
 *  - **Free-shipping threshold** — implemented, and driven by configuration.
 *  - **Delivery zones** — a zone is a function of `governorate`, resolved here.
 *
 * None of them changes `CheckoutService`, the order schema, any DTO or any
 * caller. They change the body of one method.
 */
@Injectable()
export class FulfilmentService {
  constructor(
    @Inject(fulfilmentConfig.KEY) private readonly config: FulfilmentConfig,
  ) {}

  /**
   * The delivery fee for one order, in integer minor units.
   *
   * `governorate` is accepted and, today, not consulted — the configured rate is
   * flat, and OPEN-001 records the per-governorate table as business input that
   * has not been supplied. It is a PARAMETER rather than a future addition
   * because adding it later would change every caller, and because the frozen
   * public API (NESTJS-MODULE-MAP.md §9) is exactly this signature. `null` is
   * accepted for the quote endpoint, where the customer has not yet chosen an
   * address.
   *
   * `postDiscountSubtotal` drives the free-shipping threshold. It is the
   * post-discount figure by the frozen formula: a coupon must be able to carry
   * an order over the threshold, and RULE-COUPON-010 ("discount never applies to
   * shipping") is about the discount not REDUCING the fee, not about the fee
   * ignoring the discount.
   *
   * Pure integer arithmetic — no division, no float, no rounding. The only
   * rounding point MONEY-MODEL.md §7.2 permits is a percentage discount.
   */
  quote(governorate: string | null, postDiscountSubtotal: number): number {
    void governorate;

    if (!Number.isSafeInteger(postDiscountSubtotal) || postDiscountSubtotal < 0) {
      // The caller computed a subtotal it cannot justify. A fee derived from it
      // would be a fabricated amount, so no order may be placed at all — the
      // same posture as `assertPricingInvariants`.
      throw AppException.internal();
    }

    const threshold = this.config.freeShippingThreshold;

    if (threshold !== null && postDiscountSubtotal >= threshold) {
      return 0;
    }

    return this.config.shippingFlatFee;
  }
}
