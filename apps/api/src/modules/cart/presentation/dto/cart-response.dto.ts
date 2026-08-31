import { ApiProperty } from '@nestjs/swagger';
import { MoneyDto } from '../../../../common/dto/money.dto';
import { resolveText, type Locale } from '../../../../common/localization/locale';
import { CartLineStatus } from '../../application/cart-line';
import type { CartLineView, CartView } from '../../application/cart.service';

/**
 * One cart line, priced live at the moment of the request.
 *
 * EVERY field is always present — none is optional. A Dart model generated from
 * this has one stable shape across all five cart endpoints, which is why all of
 * them return the whole cart rather than a partial or a bare acknowledgement.
 */
export class CartLineDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' })
  productId!: string;

  @ApiProperty({ example: 'esp32-devkit-v1', description: 'For linking to the product page.' })
  slug!: string;

  @ApiProperty({ example: 'ESP32-DEVKIT-V1' })
  sku!: string;

  @ApiProperty({ example: 'ESP32 DevKit V1', description: 'Resolved for the request locale.' })
  name!: string;

  @ApiProperty({
    example: 'nest/products/652f1a9b3c4d5e6f7a8b9c0d/main-a1b2c3',
    nullable: true,
    type: String,
    description: 'Primary image reference, or null. Most products have no image.',
  })
  imagePublicId!: string | null;

  @ApiProperty({
    example: 2,
    description: 'What the customer asked for. A read never reduces this.',
  })
  quantity!: number;

  @ApiProperty({
    example: 2,
    description:
      'What will actually be charged — `quantity` clamped to available stock. Differs from ' +
      '`quantity` only when the line is REDUCED_STOCK.',
  })
  effectiveQuantity!: number;

  @ApiProperty({ example: 149, description: 'Units currently on hand.' })
  availableQuantity!: number;

  @ApiProperty({
    type: MoneyDto,
    description: 'Live price. Recomputed on every request — never a stored value.',
  })
  unitPrice!: MoneyDto;

  @ApiProperty({
    type: MoneyDto,
    description:
      'The price shown when this line was last added or updated. Compare with `unitPrice` to ' +
      'render a PRICE_CHANGED line; they are equal otherwise.',
  })
  previousUnitPrice!: MoneyDto;

  @ApiProperty({
    type: MoneyDto,
    description: '`unitPrice x effectiveQuantity`, or zero for a line excluded from the subtotal.',
  })
  lineTotal!: MoneyDto;

  @ApiProperty({
    enum: CartLineStatus,
    example: CartLineStatus.OK,
    description:
      'OK · PRICE_CHANGED (price moved; the new price applies) · REDUCED_STOCK (clamped) · ' +
      'OUT_OF_STOCK and UNAVAILABLE (kept visible, excluded from the subtotal, and both block ' +
      'checkout). Reported most-blocking-first, so exactly one badge per line.',
  })
  status!: CartLineStatus;

  @ApiProperty({ example: '2026-08-30T14:22:31.000Z', format: 'date-time' })
  addedAt!: string;

  static from(line: CartLineView, locale: Locale): CartLineDto {
    return {
      productId: line.productId.toHexString(),
      slug: line.slug,
      sku: line.sku,
      name: resolveText(line.name, locale),
      imagePublicId: line.imagePublicId,
      quantity: line.quantity,
      effectiveQuantity: line.effectiveQuantity,
      availableQuantity: line.availableQuantity,
      unitPrice: MoneyDto.of(line.unitPrice, line.currency),
      previousUnitPrice: MoneyDto.of(line.previousUnitPrice, line.currency),
      lineTotal: MoneyDto.of(line.lineTotal, line.currency),
      status: line.status,
      addedAt: line.addedAt.toISOString(),
    };
  }
}

/**
 * The whole cart. Returned identically by all five endpoints, so a client
 * replaces its cart state wholesale after any mutation and never has to merge.
 */
export class CartDto {
  @ApiProperty({ type: [CartLineDto] })
  items!: CartLineDto[];

  @ApiProperty({ example: 3, description: 'Distinct products. One line per product, always.' })
  itemCount!: number;

  @ApiProperty({ example: 7, description: 'Sum of `quantity` across lines — for the badge.' })
  totalQuantity!: number;

  @ApiProperty({
    type: MoneyDto,
    description:
      'Sum of the countable lines. EXCLUDES OUT_OF_STOCK and UNAVAILABLE lines. This is a ' +
      'display subtotal, not an order total: it carries no discount, no shipping and no tax, ' +
      'and the authoritative payable amount comes from checkout.',
  })
  itemsSubtotal!: MoneyDto;

  @ApiProperty({ example: 'EGP', enum: ['EGP'] })
  currency!: string;

  @ApiProperty({
    example: false,
    description:
      'True when any line is OUT_OF_STOCK or UNAVAILABLE. Checkout will refuse while this is ' +
      'true, so use it to disable the button and explain why.',
  })
  hasBlockingIssues!: boolean;

  @ApiProperty({
    example: '2026-08-30T14:22:31.000Z',
    format: 'date-time',
    nullable: true,
    type: String,
    description: 'Null until the first item is added — the cart is created lazily.',
  })
  updatedAt!: string | null;

  @ApiProperty({
    example: '2026-09-29T14:22:31.000Z',
    format: 'date-time',
    nullable: true,
    type: String,
    description: 'Carts expire 30 days after the last write. Any write pushes this forward.',
  })
  expiresAt!: string | null;

  static from(cart: CartView, locale: Locale): CartDto {
    return {
      items: cart.lines.map((line) => CartLineDto.from(line, locale)),
      itemCount: cart.itemCount,
      totalQuantity: cart.totalQuantity,
      itemsSubtotal: MoneyDto.of(cart.itemsSubtotal, cart.currency),
      currency: cart.currency,
      hasBlockingIssues: cart.hasBlockingIssues,
      updatedAt: cart.updatedAt?.toISOString() ?? null,
      expiresAt: cart.expiresAt?.toISOString() ?? null,
    };
  }
}

export class CartResponseDto {
  @ApiProperty({ type: CartDto })
  data!: CartDto;
}
