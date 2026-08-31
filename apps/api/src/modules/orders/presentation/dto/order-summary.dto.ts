import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../../common/dto/pagination-meta.dto';
import { OrderStatus } from '../../domain/order-status';
import type { OrderSummaryRow } from '../../infrastructure/repositories/order.repository';
import { OrderPaymentDto } from './order-response.dto';
import { PricingBreakdownDto } from './quote-response.dto';

/**
 * One order, as an order-history CARD.
 *
 * Deliberately smaller than `OrderDto`: no line items, no customer, no delivery
 * address, no note. A history list renders none of them, and shipping the whole
 * embedded document for every row would put a customer's full address into a
 * response that only needs a total and a status.
 *
 * Everything here still comes from the order's own IMMUTABLE SNAPSHOT. No
 * product is read, so this list cannot be changed — or broken — by a rename, a
 * re-price or a deletion in the catalogue.
 *
 * Every field is always present, so a generated Dart model has one stable shape.
 */
export class OrderSummaryDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d', description: 'Pass to `GET /orders/{id}`.' })
  id!: string;

  @ApiProperty({ example: 'NE-20260830-0001', description: 'The human-readable reference.' })
  orderNumber!: string;

  @ApiProperty({
    enum: OrderStatus,
    example: OrderStatus.PLACED,
    description:
      'Handle every value exhaustively — an order moves through this vocabulary over its life, ' +
      'and a client that assumes only PLACED will break the first time an order is confirmed.',
  })
  status!: OrderStatus;

  @ApiProperty({ type: OrderPaymentDto })
  payment!: OrderPaymentDto;

  @ApiProperty({
    type: PricingBreakdownDto,
    description:
      'The frozen financial snapshot. `grandTotal` is the amount due on delivery — render it ' +
      'directly and never re-derive it from anything.',
  })
  pricing!: PricingBreakdownDto;

  @ApiProperty({ example: 2, description: 'Distinct products on the order. One line per product.' })
  itemCount!: number;

  @ApiProperty({ example: 5, description: 'Sum of quantities across all lines.' })
  totalQuantity!: number;

  @ApiProperty({
    example: 'nest/products/652f1a9b3c4d5e6f7a8b9c0d/main-a1b2c3',
    nullable: true,
    type: String,
    description:
      'Image of the first line, for the card thumbnail. Taken from the ORDER SNAPSHOT, not from ' +
      'the live catalogue. Null when that line had no image.',
  })
  previewImagePublicId!: string | null;

  @ApiProperty({ example: '2026-08-30T14:22:31.000Z', format: 'date-time' })
  placedAt!: string;

  static from(row: OrderSummaryRow): OrderSummaryDto {
    return {
      id: row._id.toHexString(),
      orderNumber: row.orderNumber,
      status: row.status,
      payment: {
        method: row.payment.method,
        status: row.payment.status,
        collectedAt: row.payment.collectedAt?.toISOString() ?? null,
      },
      pricing: PricingBreakdownDto.of(
        row.pricing,
        row.currency,
        row.pricing.vatInclusive,
        row.pricing.vatRateBps,
      ),
      itemCount: row.items.length,
      totalQuantity: row.items.reduce((total, item) => total + item.quantity, 0),
      previewImagePublicId: row.items[0]?.imagePublicId ?? null,
      placedAt: row.placedAt.toISOString(),
    };
  }
}

/**
 * The collection envelope — `{ data, meta }`, identical to every other list
 * endpoint in the API, so one Dart pagination helper serves all of them.
 */
export class OrderHistoryResponseDto {
  @ApiProperty({ type: [OrderSummaryDto] })
  data!: OrderSummaryDto[];

  @ApiProperty({
    type: PaginationMetaDto,
    description: '`total` is the TRUE match count across all pages, not the size of this page.',
  })
  meta!: PaginationMetaDto;
}
