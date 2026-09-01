import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { env } from './env.schema';

/**
 * Shipping cost policy — the ONE authority for what delivery costs.
 *
 * Authority: docs/architecture/ARCHITECTURE-FREEZE-RATIFICATION.md OPEN-001 —
 * "Shipping rate table — EGP per governorate, free-shipping threshold. Fallback:
 * **flat rate, configurable**; mechanism fully specified"; MONEY-MODEL.md §6,
 * §7.1; BUSINESS-RULES.md RULE-PRICE-009.
 *
 * ## Why configuration rather than the `shippingRates` collection
 *
 * MONGODB-DESIGN.md §11 lists `shippingRates` as a supporting collection keyed
 * by governorate. OPEN-001 records the RATES THEMSELVES as business input that
 * has not been supplied, and marks the flat rate as the specified fallback. A
 * collection created now would be EMPTY, every lookup would miss, and the miss
 * path — not the data — would decide what every customer is charged. That is a
 * worse authority than a single validated number, and the collection is
 * additive the moment real rates exist: it replaces the body of
 * `FulfilmentService.quote`, not its signature or any caller.
 *
 * ## Why the defaults are zero and null
 *
 * They reproduce the CURRENT behaviour exactly. Shipping has always been 0 here,
 * and inventing a number would be worse than charging nothing: it would present
 * a fabricated amount to a customer as authoritative. What changes in this phase
 * is not the amount but the AUTHORITY — the value now comes from one validated
 * configuration read instead of a literal `0` written inline at the call site,
 * which is the legacy defect BUSINESS-RULES.md RULE-PRICE-009 records
 * (`p_shipping_fee: 0` hardcoded by the caller).
 */
export const fulfilmentConfig = registerAs('fulfilment', () => {
  const e = env();

  return {
    /**
     * The flat delivery fee in integer minor units (piastres), or `null` when
     * NO RATE HAS BEEN SUPPLIED.
     *
     * `null` is not "free" — it is "not priced", and `FulfilmentService` turns
     * it into `{ fee: 0, priced: false }` so the distinction survives all the
     * way to the customer instead of being re-inferred from a zero by every
     * consumer. An explicit `0` is a real decision that delivery is free.
     *
     * Applies to every governorate. When per-governorate rates arrive they are
     * read here instead; no caller changes.
     */
    shippingFlatFee: e.SHIPPING_FLAT_FEE ?? null,

    /**
     * Order value at or above which delivery is free, in integer minor units, or
     * `null` for "no threshold".
     *
     * Compared against the POST-DISCOUNT subtotal, which is the frozen formula
     * (`FulfilmentService.quote(governorate, itemsSubtotal - discountTotal)`,
     * MONEY-MODEL.md §7.1) and the reason `quote` takes a subtotal at all.
     */
    freeShippingThreshold: e.FREE_SHIPPING_THRESHOLD ?? null,
  } as const;
});

export type FulfilmentConfig = ConfigType<typeof fulfilmentConfig>;
