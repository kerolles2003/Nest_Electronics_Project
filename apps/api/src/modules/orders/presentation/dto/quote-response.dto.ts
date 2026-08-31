import { ApiProperty } from '@nestjs/swagger';
import { MoneyDto } from '../../../../common/dto/money.dto';
import { resolveText, type Locale } from '../../../../common/localization/locale';
import { CartLineStatus } from '../../../cart/application/cart-line';
import type { CartLineView } from '../../../cart/application/cart.service';
import type { CheckoutQuote } from '../../application/checkout.service';

/**
 * One line of the quote, priced live.
 *
 * Every field is always present — none is optional — so a Dart model generated
 * from this has one stable shape.
 */
export class QuoteLineDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' })
  productId!: string;

  @ApiProperty({ example: 'ESP32-DEVKIT-V1' })
  sku!: string;

  @ApiProperty({ example: 'esp32-devkit-v1' })
  slug!: string;

  @ApiProperty({ example: 'ESP32 DevKit V1', description: 'Resolved for the request locale.' })
  name!: string;

  @ApiProperty({
    example: 'nest/products/652f1a9b3c4d5e6f7a8b9c0d/main-a1b2c3',
    nullable: true,
    type: String,
  })
  imagePublicId!: string | null;

  @ApiProperty({ example: 2, description: 'What the customer asked for.' })
  quantity!: number;

  @ApiProperty({
    example: 2,
    description:
      'What will actually be ordered and charged — `quantity` clamped to available stock. ' +
      'Differs from `quantity` only on a REDUCED_STOCK line. THIS is the quantity the order ' +
      'will contain.',
  })
  effectiveQuantity!: number;

  @ApiProperty({ example: 149, description: 'Units currently on hand. Not reserved by this quote.' })
  availableQuantity!: number;

  @ApiProperty({ type: MoneyDto, description: 'Live unit price. Recomputed on every request.' })
  unitPrice!: MoneyDto;

  @ApiProperty({
    type: MoneyDto,
    description: 'The price shown when this line was last added or updated, for a PRICE_CHANGED diff.',
  })
  previousUnitPrice!: MoneyDto;

  @ApiProperty({ type: MoneyDto, description: '`unitPrice x effectiveQuantity`, or zero when the line is excluded.' })
  lineTotal!: MoneyDto;

  @ApiProperty({
    enum: CartLineStatus,
    example: CartLineStatus.OK,
    description:
      'OK · PRICE_CHANGED (the new price applies; checkout proceeds) · REDUCED_STOCK (checkout ' +
      'proceeds at `effectiveQuantity`) · OUT_OF_STOCK and UNAVAILABLE (excluded from the total, ' +
      'and both BLOCK placement).',
  })
  status!: CartLineStatus;

  static from(line: CartLineView, locale: Locale): QuoteLineDto {
    return {
      productId: line.productId.toHexString(),
      sku: line.sku,
      slug: line.slug,
      name: resolveText(line.name, locale),
      imagePublicId: line.imagePublicId,
      quantity: line.quantity,
      effectiveQuantity: line.effectiveQuantity,
      availableQuantity: line.availableQuantity,
      unitPrice: MoneyDto.of(line.unitPrice, line.currency),
      previousUnitPrice: MoneyDto.of(line.previousUnitPrice, line.currency),
      lineTotal: MoneyDto.of(line.lineTotal, line.currency),
      status: line.status,
    };
  }
}

/**
 * The authoritative money breakdown. The SAME shape appears on a placed order,
 * so a checkout screen and an order-success screen render from one Dart model.
 */
export class PricingBreakdownDto {
  @ApiProperty({ type: MoneyDto, description: 'Sum of the countable lines.' })
  itemsSubtotal!: MoneyDto;

  @ApiProperty({
    type: MoneyDto,
    description:
      'ALWAYS ZERO in this release. No coupon domain exists yet, and `couponCode` is not accepted ' +
      'by any endpoint. The field is present so that adding coupons changes a value, not a shape.',
  })
  discountTotal!: MoneyDto;

  @ApiProperty({
    type: MoneyDto,
    description:
      'The delivery fee, computed by the SERVER from the chosen address governorate and the ' +
      'post-discount subtotal. A client never sends it and never derives it; the same ' +
      'calculation runs here and at `POST /orders`, so a quote and the order it becomes agree. ' +
      'Quote without an `addressId` and it is computed without a governorate. ' +
      'It is `0` under the CURRENT configuration — the per-governorate rate table is unresolved ' +
      'business input (OPEN-001), so the server charges nothing rather than inventing a fee. ' +
      'Present a zero as shipping not yet calculated, NOT as a free-shipping promotion.',
  })
  shippingFee!: MoneyDto;

  @ApiProperty({
    type: MoneyDto,
    description:
      'THE payable amount: `itemsSubtotal - discountTotal + shippingFee`. Collected in cash on ' +
      'delivery. Never compute this on the client.',
  })
  grandTotal!: MoneyDto;

  @ApiProperty({
    example: true,
    description: 'Prices INCLUDE VAT. There is no additive tax line anywhere in this API.',
  })
  vatInclusive!: boolean;

  @ApiProperty({
    example: 1400,
    description:
      'VAT rate in basis points (1400 = 14%). Informational: the VAT already inside `grandTotal` ' +
      'is `round(grandTotal x vatRateBps / (10000 + vatRateBps))`. It is NOT added to anything.',
  })
  vatRateBps!: number;

  static of(
    pricing: { itemsSubtotal: number; discountTotal: number; shippingFee: number; grandTotal: number },
    currency: string,
    vatInclusive: boolean,
    vatRateBps: number,
  ): PricingBreakdownDto {
    return {
      itemsSubtotal: MoneyDto.of(pricing.itemsSubtotal, currency),
      discountTotal: MoneyDto.of(pricing.discountTotal, currency),
      shippingFee: MoneyDto.of(pricing.shippingFee, currency),
      grandTotal: MoneyDto.of(pricing.grandTotal, currency),
      vatInclusive,
      vatRateBps,
    };
  }
}

/**
 * A server-calculated view of the current checkout state.
 *
 * It is NOT a reservation, NOT a stock lock, NOT a payment authorisation, and
 * NOT a promise that placement will succeed. Nothing is persisted: there is no
 * quote id, because there is nothing to refer back to. `POST /orders`
 * recomputes every figure here from scratch, inside its transaction, and would
 * ignore this response even if the client sent it back.
 */
export class CheckoutQuoteViewDto {
  @ApiProperty({ type: [QuoteLineDto] })
  items!: QuoteLineDto[];

  @ApiProperty({ example: 3, description: 'Distinct products.' })
  itemCount!: number;

  @ApiProperty({ example: 7, description: 'Sum of `quantity` across lines.' })
  totalQuantity!: number;

  @ApiProperty({ example: 'EGP', enum: ['EGP'] })
  currency!: string;

  @ApiProperty({ type: PricingBreakdownDto })
  pricing!: PricingBreakdownDto;

  @ApiProperty({
    example: false,
    description: 'True when any line is OUT_OF_STOCK or UNAVAILABLE.',
  })
  hasBlockingIssues!: boolean;

  @ApiProperty({
    example: true,
    description:
      'Whether `POST /orders` would be accepted RIGHT NOW: the cart is non-empty and no line is ' +
      'blocking. Use it to enable the button — do not re-derive it from the line statuses, and do ' +
      'not treat it as a guarantee, because stock can change between this call and placement.',
  })
  canPlaceOrder!: boolean;

  @ApiProperty({
    example: '2026-08-30T14:22:31.000Z',
    format: 'date-time',
    description: 'When the server computed this. Quotes go stale immediately and are never stored.',
  })
  generatedAt!: string;

  static from(quote: CheckoutQuote, locale: Locale): CheckoutQuoteViewDto {
    return {
      items: quote.lines.map((line) => QuoteLineDto.from(line, locale)),
      itemCount: quote.itemCount,
      totalQuantity: quote.totalQuantity,
      currency: quote.currency,
      pricing: PricingBreakdownDto.of(
        quote.pricing,
        quote.currency,
        quote.vatInclusive,
        quote.vatRateBps,
      ),
      hasBlockingIssues: quote.hasBlockingIssues,
      canPlaceOrder: quote.canPlaceOrder,
      generatedAt: quote.generatedAt.toISOString(),
    };
  }
}

export class CheckoutQuoteResponseDto {
  @ApiProperty({ type: CheckoutQuoteViewDto })
  data!: CheckoutQuoteViewDto;
}
