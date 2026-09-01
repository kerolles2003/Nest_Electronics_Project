import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { env } from './env.schema';

/**
 * Shipping policy that is not the rate table.
 *
 * Authority: docs/architecture/MONEY-MODEL.md §6, §7.1; BUSINESS-RULES.md
 * RULE-PRICE-009; PLAN.md D-8.
 *
 * ## What moved out of here, and why
 *
 * This namespace used to carry `shippingFlatFee`, read from `SHIPPING_FLAT_FEE`.
 * That was OPEN-001's specified fallback for as long as the per-governorate
 * rates were unsupplied business input — and the reasoning for preferring one
 * validated number over an empty collection was that a lookup table with
 * nothing in it would let a MISS decide what every customer is charged.
 *
 * D-8 removed the premise. The rates exist: 27 rows, one per governorate, no
 * default row, no fallback and no sentinel, seeded from the same validated list
 * the address DTO accepts. The table is never empty, so a miss means bad data
 * rather than missing data, and it raises.
 *
 * The variable was deleted rather than deprecated. A configuration knob that
 * nothing reads is worse than one that does not exist: it stays in `.env.example`
 * files and deployment manifests, somebody eventually sets it expecting an
 * effect, and nothing anywhere says why there was none.
 *
 * ## What stayed
 *
 * The free-shipping threshold, which is genuinely global policy rather than a
 * per-place rate — and which remains **implemented and off**.
 */
export const fulfilmentConfig = registerAs('fulfilment', () => {
  const e = env();

  return {
    /**
     * Order value at or above which delivery is free, in integer minor units, or
     * `null` for "no threshold".
     *
     * Compared against the POST-DISCOUNT subtotal, which is the frozen formula
     * (`FulfilmentService.quote(governorate, itemsSubtotal - discountTotal)`,
     * MONEY-MODEL.md §7.1) and the reason `quote` takes a subtotal at all.
     *
     * A `shippingRates` row may carry a threshold of its own, which wins for
     * that governorate. None does today, so this is the only live mechanism —
     * and it is unset, so no order is free.
     */
    freeShippingThreshold: e.FREE_SHIPPING_THRESHOLD ?? null,
  } as const;
});

export type FulfilmentConfig = ConfigType<typeof fulfilmentConfig>;
