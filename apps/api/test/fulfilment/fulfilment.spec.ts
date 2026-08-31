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
 * The DEPLOYED default is `SHIPPING_FLAT_FEE=0` with no threshold, so the
 * end-to-end suites can only ever observe a zero fee. That is why these cases
 * drive non-zero configurations: without them the only behaviour this phase
 * introduced would be verified nowhere.
 */
describe('FulfilmentService', () => {
  const service = (config: Partial<FulfilmentConfig>): FulfilmentService =>
    new FulfilmentService({
      shippingFlatFee: 0,
      freeShippingThreshold: null,
      ...config,
    } as FulfilmentConfig);

  describe('the flat rate', () => {
    it('charges the configured fee regardless of governorate', () => {
      const fulfilment = service({ shippingFlatFee: 5000 });

      for (const governorate of ['Cairo', 'Alexandria', 'Aswan', null]) {
        expect(fulfilment.quote(governorate, 100_000)).toBe(5000);
      }
    });

    it('charges the fee on a zero subtotal — an empty cart never reaches here', () => {
      expect(service({ shippingFlatFee: 5000 }).quote('Cairo', 0)).toBe(5000);
    });

    it('reproduces the pre-phase behaviour under the deployed default', () => {
      expect(service({}).quote('Cairo', 100_000)).toBe(0);
    });
  });

  describe('the free-shipping threshold', () => {
    const fulfilment = service({ shippingFlatFee: 5000, freeShippingThreshold: 50_000 });

    it('charges below the threshold', () => {
      expect(fulfilment.quote('Cairo', 49_999)).toBe(5000);
    });

    /** At or above, not merely above: `>=` is the frozen comparison. */
    it('is free exactly AT the threshold', () => {
      expect(fulfilment.quote('Cairo', 50_000)).toBe(0);
    });

    it('is free above the threshold', () => {
      expect(fulfilment.quote('Cairo', 50_001)).toBe(0);
    });

    it('never applies when no threshold is configured', () => {
      expect(service({ shippingFlatFee: 5000 }).quote('Cairo', Number.MAX_SAFE_INTEGER)).toBe(5000);
    });

    /**
     * A threshold of 0 means "always free", which is different from "absent".
     * `null` and `0` must not collapse into one another.
     */
    it('treats a zero threshold as always free, not as absent', () => {
      expect(service({ shippingFlatFee: 5000, freeShippingThreshold: 0 }).quote('Cairo', 0)).toBe(0);
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
   * MONEY-MODEL.md §5: no float may appear where a payable amount is derived.
   * The fee comes from configuration and is returned unchanged, so the only way
   * a non-integer could escape is a non-integer reaching configuration — which
   * `env.schema.ts` rejects at startup. This asserts the property that makes
   * that guarantee end-to-end.
   */
  it('returns an integer for every configuration it accepts', () => {
    for (const fee of [0, 1, 2500, 1_000_000]) {
      const quoted = service({ shippingFlatFee: fee }).quote('Cairo', 12_345);

      expect(Number.isSafeInteger(quoted)).toBe(true);
      expect(quoted).toBe(fee);
    }
  });
});
