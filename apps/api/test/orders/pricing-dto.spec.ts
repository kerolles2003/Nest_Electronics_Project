import { describe, expect, it } from '@jest/globals';
import { PricingBreakdownDto } from '../../src/modules/orders/presentation/dto/quote-response.dto';

/**
 * The money serialiser, tested as the pure function it is.
 *
 * ## Why this suite exists
 *
 * `shippingPriced` is part of the FROZEN v1 contract and is the field that
 * stops a client mistaking an unpriced zero for free delivery. Until now
 * nothing asserted it at the serialisation boundary at all: the integration
 * suites only ever observe the deployed configuration, where no rate is
 * supplied, so `false` was the only value any test had ever seen. A boolean
 * observed in one state is not a tested boolean — the DTO could have hardcoded
 * it and every suite would still have passed.
 *
 * `PricingBreakdownDto.of` is pure, so all three states can be exercised here
 * without a database, an HTTP request, or a configuration change that would
 * leak into other suites.
 *
 * This DTO is shared by `CheckoutQuoteViewDto`, `OrderDto` and
 * `OrderSummaryDto`, so what is proven here holds for the quote, the order
 * detail and the order history alike.
 */

const CURRENCY = 'EGP';

describe('PricingBreakdownDto.of', () => {
  describe('shippingPriced — the three states a delivery fee can be in', () => {
    it('reports NOT priced when no rate has been supplied', () => {
      const dto = PricingBreakdownDto.of(
        { itemsSubtotal: 530000, discountTotal: 0, shippingFee: 0, shippingPriced: false, grandTotal: 530000 },
        CURRENCY,
        true,
        1400,
      );

      expect(dto.shippingPriced).toBe(false);
      expect(dto.shippingFee.amount).toBe(0);
    });

    /**
     * The case the old `shippingFee === 0` test got wrong, and the reason this
     * field exists. Identical amount to the case above; opposite meaning.
     */
    it('reports PRICED for a zero fee produced by a free-shipping threshold', () => {
      const dto = PricingBreakdownDto.of(
        { itemsSubtotal: 530000, discountTotal: 0, shippingFee: 0, shippingPriced: true, grandTotal: 530000 },
        CURRENCY,
        true,
        1400,
      );

      expect(dto.shippingPriced).toBe(true);
      expect(dto.shippingFee.amount).toBe(0);
    });

    it('reports PRICED for a normal fee', () => {
      const dto = PricingBreakdownDto.of(
        { itemsSubtotal: 530000, discountTotal: 0, shippingFee: 5000, shippingPriced: true, grandTotal: 535000 },
        CURRENCY,
        true,
        1400,
      );

      expect(dto.shippingPriced).toBe(true);
      expect(dto.shippingFee.amount).toBe(5000);
      expect(dto.shippingFee.formatted).toBe('50.00 EGP');
    });

    /**
     * Two orders that differ ONLY in this flag must serialise differently.
     * Stated as its own assertion because it is the whole contract in one line.
     */
    it('distinguishes two otherwise identical zero-fee orders', () => {
      const base = { itemsSubtotal: 530000, discountTotal: 0, shippingFee: 0, grandTotal: 530000 };

      const unpriced = PricingBreakdownDto.of({ ...base, shippingPriced: false }, CURRENCY, true, 1400);
      const free = PricingBreakdownDto.of({ ...base, shippingPriced: true }, CURRENCY, true, 1400);

      expect(unpriced.shippingFee).toEqual(free.shippingFee);
      expect(unpriced.shippingPriced).not.toBe(free.shippingPriced);
    });
  });

  /**
   * An order persisted before `shippingPriced` existed reads back without it.
   *
   * `false` is the truthful answer for those documents — no rate had been
   * supplied when they were placed — and the API surface must stay a plain
   * boolean so no client has to handle a missing value. Verified against a real
   * document in Mongo as well; this pins the coercion itself.
   */
  it('coerces a missing shippingPriced to false rather than emitting undefined', () => {
    const dto = PricingBreakdownDto.of(
      { itemsSubtotal: 530000, discountTotal: 0, shippingFee: 0, grandTotal: 530000 },
      CURRENCY,
      true,
      1400,
    );

    expect(dto.shippingPriced).toBe(false);
    expect(typeof dto.shippingPriced).toBe('boolean');
    expect(Object.prototype.hasOwnProperty.call(dto, 'shippingPriced')).toBe(true);
  });

  it('keeps every money term an integer in minor units', () => {
    const dto = PricingBreakdownDto.of(
      { itemsSubtotal: 530000, discountTotal: 1500, shippingFee: 5000, shippingPriced: true, grandTotal: 533500 },
      CURRENCY,
      true,
      1400,
    );

    for (const money of [dto.itemsSubtotal, dto.discountTotal, dto.shippingFee, dto.grandTotal]) {
      expect(Number.isSafeInteger(money.amount)).toBe(true);
      expect(money.currency).toBe(CURRENCY);
    }

    // The frozen formula, re-derived from what the client actually receives.
    expect(dto.grandTotal.amount).toBe(
      dto.itemsSubtotal.amount - dto.discountTotal.amount + dto.shippingFee.amount,
    );
  });
});
