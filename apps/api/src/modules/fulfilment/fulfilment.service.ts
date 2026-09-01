import { Inject, Injectable, Logger } from '@nestjs/common';
import { fulfilmentConfig, type FulfilmentConfig } from '../../config/fulfilment.config';
import { AppException } from '../../common/errors/app.exception';
import { ShippingRateRepository } from './infrastructure/repositories/shipping-rate.repository';

/**
 * What delivery costs, AND whether that is a price at all.
 *
 * ## Why a bare `number` was not enough
 *
 * `quote()` used to return the fee alone, so `0` had to carry two unrelated
 * meanings: "delivery is free" and "no rate has been supplied, so nothing has
 * been calculated". Both consumers guessed the second one — the checkout UI
 * rendered `amount === 0` as "Not yet calculated" and the order email set
 * `shippingUnpriced` from `shippingFee === 0`.
 *
 * That guess is already wrong today: this service returns `0` when a
 * free-shipping threshold is met, so the moment a threshold is configured a
 * genuinely free order tells the customer its delivery has not been worked out.
 * It becomes wrong for every order once real per-governorate rates land.
 *
 * ## Why the fix could not wait for the rates
 *
 * Adding a field is additive and a contract drift gate reports it. Redefining
 * what `0` MEANS changes no field, no name and no type — the gate sees nothing,
 * and every client that already shipped `0 → "not calculated"` silently
 * misreports free orders. So the representation is settled before the contract
 * freezes, and the rate values arrive later against a shape that already tells
 * the truth.
 *
 * `priced: false` always carries `fee: 0`; there is no such thing as an
 * unpriced non-zero fee.
 */
export interface ShippingQuote {
  /** Integer minor units. Always 0 when `priced` is false. */
  readonly fee: number;
  /**
   * True when a rate exists and this fee is what the customer owes — INCLUDING
   * when that is zero because a free-shipping threshold was met.
   */
  readonly priced: boolean;
}

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
 * ## Per-governorate rates, as ratified (D-8)
 *
 * The rate now comes from `shippingRates`: 27 rows, one per governorate, no
 * default row, no fallback and no sentinel. `SHIPPING_FLAT_FEE` was OPEN-001's
 * specified fallback while the real rates were unsupplied business input; they
 * have been supplied, so it is gone.
 *
 * This landed the way the method was designed for. `governorate` was already a
 * parameter — introduced before it was consulted, precisely so that adding the
 * lookup would not change a single caller — and the frozen public API
 * (NESTJS-MODULE-MAP.md §9) is still `quote(governorate, subtotal)`. What did
 * change is that the method is now `async`, because the answer lives in the
 * database rather than in a config object.
 *
 * ## What this deliberately is NOT
 *
 * No carrier API, no rate shopping, no geocoder, no delivery-zone graph, no
 * strategy framework and no `ShippingRatePort`. A zone, if one is ever wanted,
 * is a function of `governorate` and is resolved here.
 */
@Injectable()
export class FulfilmentService {
  private readonly logger = new Logger(FulfilmentService.name);

  constructor(
    @Inject(fulfilmentConfig.KEY) private readonly config: FulfilmentConfig,
    private readonly rates: ShippingRateRepository,
  ) {}

  /**
   * The delivery fee for one order, in integer minor units.
   *
   * `governorate` is looked up in `shippingRates`. `null` is accepted for the
   * quote endpoint, where the customer has not yet chosen an address — that is
   * "nothing to look up", which is `priced: false`, and it is NOT the same as a
   * miss. A miss is a governorate that should have a row and does not, and it
   * raises.
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
  async quote(governorate: string | null, postDiscountSubtotal: number): Promise<ShippingQuote> {
    if (!Number.isSafeInteger(postDiscountSubtotal) || postDiscountSubtotal < 0) {
      // The caller computed a subtotal it cannot justify. A fee derived from it
      // would be a fabricated amount, so no order may be placed at all — the
      // same posture as `assertPricingInvariants`.
      throw AppException.internal();
    }

    /*
     * NO GOVERNORATE YET, which is not a missing rate.
     *
     * The checkout quote endpoint is reachable before an address is chosen.
     * There is nothing to look up, so there is no fee to state — and `priced:
     * false` is exactly the vocabulary for that. Raising here would turn a
     * normal step of checkout into a 500.
     */
    if (governorate === null) {
      return { fee: 0, priced: false };
    }

    const rate = await this.rates.findByGovernorate(governorate);

    /*
     * A MISS RAISES. It never invents a fee (D-8).
     *
     * This is unreachable through the API: `governorate` is closed to a
     * validated list on both sides (`common/constants/governorates.ts` exists
     * for this reason), and the seed derives its 27 rows from that same list. So
     * reaching here means the table is incomplete — bad data, not bad input.
     *
     * Failing loudly beats silently charging a made-up amount. The alternative
     * designs all end with a customer being quoted a number nobody decided: a
     * default row answers for a governorate nobody priced, a `?? 0` gives free
     * delivery to whichever one was forgotten, and a sentinel is a default row
     * that is harder to notice.
     */
    if (rate === null) {
      this.logger.error(
        `no shippingRates row for "${governorate}". Run: pnpm --filter api shipping:seed`,
      );

      throw AppException.shippingRateMissing();
    }

    /*
     * ONE threshold, global, from configuration.
     *
     * There is no per-governorate override. A row-level threshold was written
     * here and removed: nothing set it, nothing tested it, and the precedence it
     * implied — row beats config — was invented rather than specified. See the
     * note at the bottom of `shipping-rate.schema.ts`.
     *
     * `null` unless someone sets `FREE_SHIPPING_THRESHOLD`, so today no order is
     * free. The mechanism stays implemented and off.
     */
    const threshold = this.config.freeShippingThreshold;

    /*
     * Free, and `priced: true` — deliberately.
     *
     * Free IS a price: a rate exists, the threshold was met, and the customer
     * owes nothing for delivery. Conflating this with "not yet calculated" is
     * exactly the defect `ShippingQuote` was introduced to remove.
     */
    if (threshold !== null && postDiscountSubtotal >= threshold) {
      return { fee: 0, priced: true };
    }

    return { fee: rate.fee, priced: true };
  }
}
