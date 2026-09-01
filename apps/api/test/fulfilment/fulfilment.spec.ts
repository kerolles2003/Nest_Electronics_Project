import { describe, expect, it } from '@jest/globals';
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../src/common/errors/app.exception';
import { ErrorCode } from '../../src/common/errors/error-code.enum';
import { EGYPTIAN_GOVERNORATES } from '../../src/common/constants/governorates';
import type { FulfilmentConfig } from '../../src/config/fulfilment.config';
import { SEED_SHIPPING_RATES } from '../../src/database/seed/shipping.seed-data';
import { FulfilmentService } from '../../src/modules/fulfilment/fulfilment.service';
import type { ShippingRateRepository } from '../../src/modules/fulfilment/infrastructure/repositories/shipping-rate.repository';
import type { ShippingRateLean } from '../../src/modules/fulfilment/infrastructure/schemas/shipping-rate.schema';

/**
 * The shipping cost authority, over the ratified rate table (D-8).
 *
 * No NestJS and no database: the repository is a small stand-in over a plain
 * map, which is exactly the Level-1 shape TESTING-ARCHITECTURE.md §3 asks for.
 * That substitution is deliberate and narrow — it replaces ONE `findOne` by
 * governorate, so nothing about the policy under test is faked. The collection
 * itself, the unique index, the seed and the wiring are exercised against a real
 * database in `test/fulfilment/shipping-rates.spec.ts`.
 *
 * `quote()` returns `{ fee, priced }` rather than a bare number, so that a zero
 * fee can say WHICH zero it is. Every case asserts both halves, because
 * asserting only the fee is what let the two meanings blur together in the first
 * place.
 */

/** The seeded table as a map, so a case can price a governorate for real. */
const SEEDED = new Map(SEED_SHIPPING_RATES.map((rate) => [rate.governorate, rate]));

function rowsFrom(
  overrides: Record<string, { fee: number }> | 'seeded',
): Map<string, ShippingRateLean> {
  const source =
    overrides === 'seeded'
      ? Object.fromEntries(SEED_SHIPPING_RATES.map((rate) => [rate.governorate, rate]))
      : overrides;

  return new Map(
    Object.entries(source).map(([governorate, value]) => [
      governorate,
      { governorate, fee: value.fee } as unknown as ShippingRateLean,
    ]),
  );
}

function service(
  rows: Map<string, ShippingRateLean>,
  config: Partial<FulfilmentConfig> = {},
): FulfilmentService {
  const repository = {
    findByGovernorate: (governorate: string) =>
      Promise.resolve(rows.get(governorate) ?? null),
    findAll: () => Promise.resolve([...rows.values()]),
  } satisfies Pick<ShippingRateRepository, 'findByGovernorate' | 'findAll'>;

  return new FulfilmentService(
    // `null` — the threshold is implemented and off.
    { freeShippingThreshold: null, ...config } as FulfilmentConfig,
    repository as ShippingRateRepository,
  );
}

/** The service over the real seeded table. */
const seeded = (config: Partial<FulfilmentConfig> = {}): FulfilmentService =>
  service(rowsFrom('seeded'), config);

describe('the ratified rate table', () => {
  it('prices all 27 governorates and nothing else', () => {
    expect(SEED_SHIPPING_RATES).toHaveLength(27);
    expect(SEED_SHIPPING_RATES.map((rate) => rate.governorate)).toEqual([
      ...EGYPTIAN_GOVERNORATES,
    ]);
  });

  it('charges Cairo and Giza 5 000 pt and the other 25 governorates 10 000 pt', async () => {
    /*
     * THE FULL TABLE, every row, not a sample.
     *
     * A spot check on two or three governorates would pass just as happily if
     * the metropolitan set had been written as `['Cairo', 'Gizah']` and 26 rows
     * were charging the standard fee. The rate a customer is charged is the
     * output of this whole table, so the whole table is asserted.
     */
    const fulfilment = seeded();
    const metropolitan = ['Cairo', 'Giza'];

    for (const governorate of EGYPTIAN_GOVERNORATES) {
      const expected = metropolitan.includes(governorate) ? 5_000 : 10_000;

      await expect(fulfilment.quote(governorate, 100_000)).resolves.toEqual({
        fee: expected,
        priced: true,
      });
    }
  });

  it('charges the fee on a zero subtotal — an empty cart never reaches here', async () => {
    /*
     * Deliberate, and worth stating because it looks wrong in isolation: a
     * quote for an empty basket with an address selected shows a delivery fee.
     *
     * Placement refuses an empty cart outright (`CART_EMPTY`), and the quote
     * endpoint returns `canPlaceOrder: false` beside this figure, so no
     * customer is ever charged it. Making `quote()` special-case a zero
     * subtotal would put a rule about cart contents inside the shipping
     * authority, which is the one thing it must not know about.
     */
    await expect(seeded().quote('Cairo', 0)).resolves.toEqual({ fee: 5_000, priced: true });
  });

  it('carries a fee and a governorate, and nothing else', () => {
    /*
     * The row shape, asserted exactly.
     *
     * A per-row `freeShippingThreshold` lived here briefly. Nothing set it,
     * nothing read it, and the precedence it implied was invented rather than
     * specified — so it went. This assertion is what stops a field creeping
     * back in without a rule to go with it.
     */
    for (const rate of SEED_SHIPPING_RATES) {
      expect(Object.keys(rate).sort()).toEqual(['fee', 'governorate']);
    }
  });

  it('charges 50.00 and 100.00 EGP, in piastres', () => {
    // The one place the ratified figures appear as the numbers a person said,
    // rather than as constants that could both be wrong together.
    expect(SEEDED.get('Cairo')?.fee).toBe(5_000);
    expect(SEEDED.get('Giza')?.fee).toBe(5_000);
    expect(SEEDED.get('Alexandria')?.fee).toBe(10_000);
    expect(SEEDED.get('Red Sea')?.fee).toBe(10_000);
  });
});

describe('the lookup miss', () => {
  it('RAISES rather than inventing a fee', async () => {
    /*
     * The centre of D-8. There is no default row, no fallback and no sentinel,
     * so a governorate with no row has no price — and the only honest answer is
     * to fail.
     *
     * Every alternative ends with a customer quoted a number nobody decided: a
     * default row answers for a governorate nobody priced, `?? 0` gives free
     * delivery to whichever one was forgotten, and a sentinel is a default row
     * that is harder to notice.
     */
    const fulfilment = service(rowsFrom({ Cairo: { fee: 5_000 } }));

    await expect(fulfilment.quote('Luxor', 100_000)).rejects.toBeInstanceOf(AppException);
  });

  it('raises a 500 with SHIPPING_RATE_MISSING, not a client error', async () => {
    /*
     * The governorate is closed to a validated list on both sides, so this is
     * unreachable through the API by any input a customer can send. Reaching it
     * means the TABLE is incomplete — a server fault — and answering 400 would
     * blame the customer for the operator's missing row.
     */
    const fulfilment = service(rowsFrom({ Cairo: { fee: 5_000 } }));

    await expect(fulfilment.quote('Luxor', 100_000)).rejects.toMatchObject({
      code: ErrorCode.SHIPPING_RATE_MISSING,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    });
  });

  it('does not disclose which governorate is unpriced', async () => {
    // The message is the generic one. Which parts of the rate table are
    // incomplete is operational information, and this can surface on a
    // checkout the customer is in the middle of.
    const fulfilment = service(rowsFrom({ Cairo: { fee: 5_000 } }));

    const error = await fulfilment.quote('Luxor', 100_000).catch((raised: unknown) => raised);

    expect(error).toBeInstanceOf(AppException);
    expect(JSON.stringify(error)).not.toContain('Luxor');
  });

  it('raises even when a threshold would have made delivery free anyway', async () => {
    /*
     * A miss is not rescued by the answer happening to be zero. "Free because
     * the order is large" and "free because we could not find a rate" are
     * different facts, and quietly returning the first when the second is true
     * is the whole class of defect the raise exists to prevent.
     */
    const fulfilment = service(rowsFrom({ Cairo: { fee: 5_000 } }), {
      freeShippingThreshold: 50_000,
    });

    await expect(fulfilment.quote('Luxor', 100_000)).rejects.toBeInstanceOf(AppException);
  });
});

describe('no governorate yet, which is NOT a miss', () => {
  it('reports unpriced rather than raising', async () => {
    /*
     * The checkout quote endpoint is reachable before an address is chosen.
     * There is nothing to look up, which is exactly what `priced: false` says.
     * Raising here would turn an ordinary step of checkout into a 500.
     */
    await expect(seeded().quote(null, 100_000)).resolves.toEqual({ fee: 0, priced: false });
  });

  it('stays unpriced whatever the threshold says', async () => {
    // A threshold cannot make an unknown destination free: there is no rate to
    // discount, and `priced: true` would assert a price nobody computed.
    const fulfilment = seeded({ freeShippingThreshold: 1 });

    await expect(fulfilment.quote(null, 100_000)).resolves.toEqual({ fee: 0, priced: false });
  });
});

describe('the free-shipping threshold', () => {
  it('charges below the threshold', async () => {
    const fulfilment = seeded({ freeShippingThreshold: 50_000 });

    await expect(fulfilment.quote('Cairo', 49_999)).resolves.toEqual({
      fee: 5_000,
      priced: true,
    });
  });

  it('is free exactly AT the threshold — and free is a PRICE', async () => {
    const fulfilment = seeded({ freeShippingThreshold: 50_000 });

    await expect(fulfilment.quote('Cairo', 50_000)).resolves.toEqual({ fee: 0, priced: true });
  });

  it('is free above the threshold', async () => {
    const fulfilment = seeded({ freeShippingThreshold: 50_000 });

    await expect(fulfilment.quote('Aswan', 50_001)).resolves.toEqual({ fee: 0, priced: true });
  });

  it('never applies when none is configured — which is the deployed state', async () => {
    await expect(seeded().quote('Cairo', 100_000_000)).resolves.toEqual({
      fee: 5_000,
      priced: true,
    });
  });

  it('treats a zero threshold as always free, not as absent', async () => {
    // `0` and `null` are different answers, and the config models them as
    // different values precisely so this case is expressible.
    const fulfilment = seeded({ freeShippingThreshold: 0 });

    await expect(fulfilment.quote('Cairo', 0)).resolves.toEqual({ fee: 0, priced: true });
  });

  it('applies the SAME threshold to every governorate', async () => {
    /*
     * There is one threshold and it is global. A per-row override lived here
     * briefly, with a precedence rule nothing specified; both are gone.
     *
     * Asserted across the whole table rather than on one governorate, because
     * "global" is a statement about all 27 and a single example would pass just
     * as happily if Cairo were special-cased.
     */
    const fulfilment = seeded({ freeShippingThreshold: 50_000 });

    for (const governorate of EGYPTIAN_GOVERNORATES) {
      await expect(fulfilment.quote(governorate, 49_999)).resolves.toMatchObject({ priced: true });
      await expect(fulfilment.quote(governorate, 50_000)).resolves.toEqual({
        fee: 0,
        priced: true,
      });
    }
  });
});

describe('the subtotal guard', () => {
  it('refuses a negative subtotal', async () => {
    await expect(seeded().quote('Cairo', -1)).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
    });
  });

  it('refuses a non-integer subtotal', async () => {
    await expect(seeded().quote('Cairo', 10.5)).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
    });
  });

  it('refuses even when the threshold would have made shipping free', async () => {
    const fulfilment = seeded({ freeShippingThreshold: 0 });

    await expect(fulfilment.quote('Cairo', -1)).rejects.toBeInstanceOf(AppException);
  });

  it('refuses BEFORE reading the table', async () => {
    /*
     * Order matters. A bad subtotal is the caller's fault and must be reported
     * as one; if the lookup ran first, a bad subtotal for an unpriced
     * governorate would surface as SHIPPING_RATE_MISSING and send whoever read
     * the log to fix the rate table instead of the caller.
     */
    let consulted = false;
    const fulfilment = new FulfilmentService(
      { freeShippingThreshold: null } as FulfilmentConfig,
      {
        findByGovernorate: () => {
          consulted = true;
          return Promise.resolve(null);
        },
        findAll: () => Promise.resolve([]),
      } as unknown as ShippingRateRepository,
    );

    await expect(fulfilment.quote('Cairo', -1)).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
    });
    expect(consulted).toBe(false);
  });
});

describe('the three states, with real rates in place', () => {
  /*
   * The property that made `ShippingQuote` worth introducing, re-proven now
   * that the fee is a lookup rather than a constant. Stated as a property over
   * every governorate and several subtotals rather than as three examples,
   * because the failure it guards against is a future `quote()` body returning
   * a fee it has not actually priced — and three examples would not notice.
   */
  it('never returns an unpriced NON-ZERO fee, for any governorate or subtotal', async () => {
    for (const threshold of [null, 0, 50_000]) {
      const fulfilment = seeded({ freeShippingThreshold: threshold });

      for (const governorate of EGYPTIAN_GOVERNORATES) {
        for (const subtotal of [0, 1, 49_999, 50_000, 1_000_000]) {
          const quoted = await fulfilment.quote(governorate, subtotal);

          if (!quoted.priced) {
            expect(quoted.fee).toBe(0);
          }
        }
      }
    }
  });

  it('reaches all three states, so the property above is not vacuous', async () => {
    /*
     * A property test that never observes the interesting state passes for the
     * wrong reason. These three assertions prove each state is actually
     * reachable with the seeded table:
     *
     *   priced, fee > 0   an ordinary delivery
     *   priced, fee = 0   free because the threshold was met
     *   unpriced, fee = 0 no address chosen yet
     */
    await expect(seeded().quote('Cairo', 100)).resolves.toEqual({ fee: 5_000, priced: true });

    await expect(
      seeded({ freeShippingThreshold: 50_000 }).quote('Cairo', 50_000),
    ).resolves.toEqual({ fee: 0, priced: true });

    await expect(seeded().quote(null, 100)).resolves.toEqual({ fee: 0, priced: false });
  });

  it('returns a safe integer for every governorate', async () => {
    /*
     * MONEY-MODEL.md §5: no float may appear where a payable amount is derived.
     * The fee now comes from the database rather than from configuration, so
     * the schema's `min: 0` on an integer field is what backs this, and this is
     * the assertion that would notice if a row ever carried 50.5.
     */
    const fulfilment = seeded();

    for (const governorate of EGYPTIAN_GOVERNORATES) {
      const quoted = await fulfilment.quote(governorate, 12_345);

      expect(Number.isSafeInteger(quoted.fee)).toBe(true);
      expect(quoted.fee).toBeGreaterThan(0);
      expect(quoted.priced).toBe(true);
    }
  });
});
