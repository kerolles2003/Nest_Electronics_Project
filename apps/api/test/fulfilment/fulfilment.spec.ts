import { describe, expect, it } from '@jest/globals';
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../src/common/errors/app.exception';
import { ErrorCode } from '../../src/common/errors/error-code.enum';
import type { FulfilmentConfig } from '../../src/config/fulfilment.config';
import { FulfilmentService } from '../../src/modules/fulfilment/fulfilment.service';

/**
 * The shipping cost authority, tested as the pure function it is.
 *
 * No NestJS, no Mongoose, no database: `FulfilmentService` reads one validated
 * configuration object and performs integer arithmetic, which is exactly the
 * Level-1 shape TESTING-ARCHITECTURE.md §3 asks for. Constructing it directly
 * with a config literal is also the point — the whole reason shipping is one
 * service instead of a literal at the call site is that the policy can now be
 * exercised without placing an order.
 *
 * The DEPLOYED default is NO configured rate and no threshold, so the
 * end-to-end suites can only ever observe an unpriced zero. That is why these
 * cases drive non-zero configurations: without them the only behaviour this
 * phase introduced would be verified nowhere.
 *
 * `quote()` returns `{ fee, priced }` rather than a bare number, so that a zero
 * fee can say WHICH zero it is. The cases below assert both halves everywhere,
 * because asserting only the fee is what let the two meanings blur together in
 * the first place.
 */
describe('FulfilmentService', () => {
  const service = (config: Partial<FulfilmentConfig>): FulfilmentService =>
    new FulfilmentService({
      // `null`, not `0` — the deployed default is "no rate supplied", which is
      // a different thing from "the rate is zero" and now reports differently.
      shippingFlatFee: null,
      freeShippingThreshold: null,
      ...config,
    } as FulfilmentConfig);

  describe('the flat rate', () => {
    it('charges the configured fee regardless of governorate', () => {
      const fulfilment = service({ shippingFlatFee: 5000 });

      for (const governorate of ['Cairo', 'Alexandria', 'Aswan', null]) {
        expect(fulfilment.quote(governorate, 100_000)).toEqual({ fee: 5000, priced: true });
      }
    });

    it('charges the fee on a zero subtotal — an empty cart never reaches here', () => {
      expect(service({ shippingFlatFee: 5000 }).quote('Cairo', 0)).toEqual({
        fee: 5000,
        priced: true,
      });
    });

    it('reproduces the pre-phase AMOUNT under the deployed default, and says it is not a price', () => {
      // The number a customer sees is unchanged. What is new is that the zero
      // now declares itself a placeholder rather than leaving every consumer to
      // guess — which is the whole of the fix.
      expect(service({}).quote('Cairo', 100_000)).toEqual({ fee: 0, priced: false });
    });

    /**
     * The distinction the old bare-number contract could not express.
     *
     * An operator who genuinely decides delivery is free sets the fee to 0
     * explicitly; that is a PRICE, and must render as free. An operator who has
     * supplied no rate at all gets the same 0, and it must render as "not yet
     * calculated". Same amount, opposite meanings.
     */
    it('distinguishes a deliberate zero fee from no rate at all', () => {
      expect(service({ shippingFlatFee: 0 }).quote('Cairo', 100_000)).toEqual({
        fee: 0,
        priced: true,
      });

      expect(service({ shippingFlatFee: null }).quote('Cairo', 100_000)).toEqual({
        fee: 0,
        priced: false,
      });
    });
  });

  describe('the free-shipping threshold', () => {
    const fulfilment = service({ shippingFlatFee: 5000, freeShippingThreshold: 50_000 });

    it('charges below the threshold', () => {
      expect(fulfilment.quote('Cairo', 49_999)).toEqual({ fee: 5000, priced: true });
    });

    /** At or above, not merely above: `>=` is the frozen comparison. */
    it('is free exactly AT the threshold — and free is a PRICE', () => {
      // `priced: true` is the assertion that matters here. This is the case
      // that was already reachable before real rates existed, and the one that
      // used to be reported to the customer as "not yet calculated".
      expect(fulfilment.quote('Cairo', 50_000)).toEqual({ fee: 0, priced: true });
    });

    it('is free above the threshold', () => {
      expect(fulfilment.quote('Cairo', 50_001)).toEqual({ fee: 0, priced: true });
    });

    it('never applies when no threshold is configured', () => {
      expect(service({ shippingFlatFee: 5000 }).quote('Cairo', Number.MAX_SAFE_INTEGER)).toEqual({
        fee: 5000,
        priced: true,
      });
    });

    /**
     * A threshold of 0 means "always free", which is different from "absent".
     * `null` and `0` must not collapse into one another.
     */
    it('treats a zero threshold as always free, not as absent', () => {
      expect(service({ shippingFlatFee: 5000, freeShippingThreshold: 0 }).quote('Cairo', 0)).toEqual({
        fee: 0,
        priced: true,
      });
    });
  });

  /**
   * The subtotal arrives from `CheckoutService`, which computed it from live
   * catalogue prices. A value that is negative or not a safe integer means the
   * server has already produced a figure it cannot justify, and a fee derived
   * from it would be fabricated — so no order may be placed at all. The same
   * posture as `assertPricingInvariants`, and deliberately a 500 with no
   * detail rather than a client error: no client input can reach this state.
   */
  describe('the subtotal guard', () => {
    it.each([
      ['negative', -1],
      ['fractional', 10.5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['beyond int53', Number.MAX_SAFE_INTEGER + 2],
    ])('refuses a %s subtotal rather than pricing it', (_label, subtotal) => {
      const fulfilment = service({ shippingFlatFee: 5000 });

      expect(() => fulfilment.quote('Cairo', subtotal)).toThrow(AppException);

      try {
        fulfilment.quote('Cairo', subtotal);
      } catch (error) {
        const thrown = error as AppException;
        expect(thrown.code).toBe(ErrorCode.INTERNAL_ERROR);
        expect(thrown.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      }
    });

    it('refuses even when the threshold would have made shipping free', () => {
      const fulfilment = service({ shippingFlatFee: 5000, freeShippingThreshold: 1 });

      expect(() => fulfilment.quote('Cairo', -100)).toThrow(AppException);
    });
  });

  /**
   * The invariant `ShippingQuote` documents: an unpriced fee is always zero.
   *
   * Asserted as a PROPERTY over every configuration this service accepts,
   * rather than as one example, because the failure it guards against is a
   * future `quote()` body returning a fee it has not actually priced — and a
   * single example would not notice.
   */
  it('never returns an unpriced non-zero fee, under any configuration', () => {
    const configs = [
      { shippingFlatFee: null, freeShippingThreshold: null },
      { shippingFlatFee: null, freeShippingThreshold: 0 },
      { shippingFlatFee: null, freeShippingThreshold: 50_000 },
      { shippingFlatFee: 0, freeShippingThreshold: null },
      { shippingFlatFee: 5000, freeShippingThreshold: null },
      { shippingFlatFee: 5000, freeShippingThreshold: 0 },
      { shippingFlatFee: 5000, freeShippingThreshold: 50_000 },
    ];

    for (const config of configs) {
      for (const subtotal of [0, 1, 49_999, 50_000, 1_000_000]) {
        const quoted = service(config as Partial<FulfilmentConfig>).quote('Cairo', subtotal);

        if (!quoted.priced) {
          expect(quoted.fee).toBe(0);
        }
      }
    }
  });

  /**
   * MONEY-MODEL.md §5: no float may appear where a payable amount is derived.
   * The fee comes from configuration and is returned unchanged, so the only way
   * a non-integer could escape is a non-integer reaching configuration — which
   * `env.schema.ts` rejects at startup. This asserts the property that makes
   * that guarantee end-to-end.
   */
  it('returns an integer for every configuration it accepts', () => {
    for (const fee of [0, 1, 2500, 1_000_000]) {
      const quoted = service({ shippingFlatFee: fee }).quote('Cairo', 12_345);

      expect(Number.isSafeInteger(quoted.fee)).toBe(true);
      expect(quoted.fee).toBe(fee);
      expect(quoted.priced).toBe(true);
    }

    // The unpriced case still yields a safe integer, so no consumer has to
    // special-case the arithmetic — only the presentation.
    const unpriced = service({ shippingFlatFee: null }).quote('Cairo', 12_345);
    expect(Number.isSafeInteger(unpriced.fee)).toBe(true);
    expect(unpriced).toEqual({ fee: 0, priced: false });
  });
});
