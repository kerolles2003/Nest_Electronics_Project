import { EGYPTIAN_GOVERNORATES } from '../../common/constants/governorates';

/**
 * The ratified rate table (D-8).
 *
 * > 27 seeded `shippingRates` rows, one per governorate. No default row, no
 * > fallback, no sentinel. Cairo and Giza 5 000 pt, the other 25 governorates
 * > 10 000 pt, every row independently editable in admin.
 *
 * ## This is business data, not test infrastructure
 *
 * The catalogue seed is explicitly retained as development fixtures (D-6) and
 * must never reach production. This file is the opposite: with no fallback row,
 * an empty `shippingRates` collection means **every checkout in the country
 * raises**. These 27 rows are a release step, in the same class as
 * `indexes:sync`, and `shipping:seed` exists separately from `seed` so it can
 * be run in an environment where the catalogue seed must not be.
 */

/** Integer minor units — piastres. 5 000 pt = 50.00 EGP. */
const METROPOLITAN_FEE = 5_000;
const STANDARD_FEE = 10_000;

/**
 * The two governorates that carry the lower rate.
 *
 * A `Set`, and checked against `EGYPTIAN_GOVERNORATES` at module load, so a
 * typo here becomes a boot failure rather than a silent 10 000 pt charge on
 * every Cairo delivery.
 */
const METROPOLITAN = new Set(['Cairo', 'Giza']);

for (const name of METROPOLITAN) {
  if (!EGYPTIAN_GOVERNORATES.includes(name as (typeof EGYPTIAN_GOVERNORATES)[number])) {
    throw new Error(`shipping seed: "${name}" is not an Egyptian governorate`);
  }
}

export interface SeedShippingRate {
  readonly governorate: string;
  readonly fee: number;
  readonly freeShippingThreshold: number | null;
}

/**
 * Derived from `EGYPTIAN_GOVERNORATES` rather than written out, so the table
 * cannot be short of a row. A hand-written list of 27 strings is a list that
 * eventually has 26 in it, and the missing one is only discovered by a customer
 * in that governorate failing to check out.
 *
 * `freeShippingThreshold` is `null` on every row: the threshold stays
 * implemented and off.
 */
export const SEED_SHIPPING_RATES: readonly SeedShippingRate[] = EGYPTIAN_GOVERNORATES.map(
  (governorate) => ({
    governorate,
    fee: METROPOLITAN.has(governorate) ? METROPOLITAN_FEE : STANDARD_FEE,
    freeShippingThreshold: null,
  }),
);
