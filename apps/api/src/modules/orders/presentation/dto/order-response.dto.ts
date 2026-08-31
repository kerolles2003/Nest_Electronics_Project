import { ApiProperty } from '@nestjs/swagger';
import { MoneyDto } from '../../../../common/dto/money.dto';
import { resolveText, type Locale } from '../../../../common/localization/locale';
import { Role } from '../../../users/infrastructure/schemas/user.schema';
import type { PlacedOrder } from '../../application/checkout.service';
import { OrderStatus, PaymentMethod, PaymentStatus } from '../../domain/order-status';
import { PricingBreakdownDto } from './quote-response.dto';

/**
 * One ordered line, exactly as it was frozen at placement.
 *
 * These values come from the ORDER, never from the live catalogue. A product
 * renamed, re-priced or delisted tomorrow does not change one character of this
 * response — which is the whole reason an order snapshots its lines.
 */
export class OrderItemDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' })
  productId!: string;

  @ApiProperty({ example: 'ESP32-DEVKIT-V1' })
  sku!: string;

  @ApiProperty({ example: 'esp32-devkit-v1', description: 'The slug AS SOLD. May 404 today.' })
  slug!: string;

  @ApiProperty({ example: 'ESP32 DevKit V1', description: 'The name as sold, for the request locale.' })
  name!: string;

  @ApiProperty({ example: 'Espressif', nullable: true, type: String })
  brandName!: string | null;

  @ApiProperty({ example: 'nest/products/652f.../main-a1b2c3', nullable: true, type: String })
  imagePublicId!: string | null;

  @ApiProperty({ type: MoneyDto, description: 'The price charged. Immutable.' })
  unitPrice!: MoneyDto;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ type: MoneyDto, description: '`unitPrice x quantity`, stored rather than derived.' })
  lineTotal!: MoneyDto;
}

/** Where the goods were sent, snapshotted at placement. */
export class OrderShippingAddressDto {
  @ApiProperty({ example: 'Mina Kerolles' })
  fullName!: string;

  @ApiProperty({ example: '01012345678' })
  phone!: string;

  @ApiProperty({ example: '12 Sherif Street, Apartment 4' })
  street!: string;

  @ApiProperty({ example: 'Downtown' })
  city!: string;

  @ApiProperty({ example: 'Cairo' })
  governorate!: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  postalCode!: string | null;
}

/** Who the order was for, snapshotted at placement. */
export class OrderCustomerDto {
  @ApiProperty({ example: 'Mina Kerolles' })
  fullName!: string;

  @ApiProperty({ example: 'customer@example.com' })
  email!: string;

  @ApiProperty({ example: '01012345678', nullable: true, type: String })
  phone!: string | null;
}

/** Cash on Delivery, and whether the cash has been collected. */
export class OrderPaymentDto {
  @ApiProperty({
    enum: PaymentMethod,
    example: PaymentMethod.COD,
    description: 'Cash on Delivery is the only method. No payment provider is integrated.',
  })
  method!: PaymentMethod;

  @ApiProperty({
    enum: PaymentStatus,
    example: PaymentStatus.PENDING,
    description:
      'PENDING until the courier collects the cash, which happens when the order becomes ' +
      'DELIVERED. A newly placed order is ALWAYS PENDING.',
  })
  status!: PaymentStatus;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'When cash was collected. Null until delivery.',
  })
  collectedAt!: string | null;
}

/**
 * Dispatch and tracking. Null until the order ships.
 *
 * `trackingNumber` is visible to the order OWNER and to staff
 * (ORDER-LIFECYCLE.md §8); it is never returned by the public tracking
 * endpoint, which does not exist yet.
 */
export class OrderShipmentDto {
  @ApiProperty({ example: 'Bosta', description: 'The courier company carrying the order.' })
  carrier!: string;

  @ApiProperty({ example: 'BST-123456789', description: 'Quote this to the carrier.' })
  trackingNumber!: string;

  @ApiProperty({
    example: '2026-08-31T09:14:02.000Z',
    format: 'date-time',
    description: 'When it left the warehouse. Refreshed if a failed delivery is re-dispatched.',
  })
  shippedAt!: string;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'When the customer received it. Null until delivery succeeds.',
  })
  deliveredAt!: string | null;

  @ApiProperty({
    example: 0,
    description: 'How many times the courier has attempted delivery and failed.',
  })
  deliveryAttempts!: number;
}

/**
 * Why and when an order was cancelled. Null on every order that was not.
 *
 * `by` is the ROLE that cancelled, not the person. A customer needs to know
 * whether they cancelled or the shop did; which admin pressed the button is
 * internal, and lives on the `statusHistory` entry, which is not exposed.
 */
export class OrderCancellationDto {
  @ApiProperty({ example: 'Ordered the wrong variant.' })
  reason!: string;

  @ApiProperty({
    enum: Role,
    example: Role.CUSTOMER,
    description: 'Who cancelled: `CUSTOMER` if you did, otherwise the shop.',
  })
  by!: Role;

  @ApiProperty({ example: '2026-08-31T09:14:02.000Z', format: 'date-time' })
  at!: string;
}

/**
 * A placed order.
 *
 * ## The shape is IDENTICAL on a first placement and on a replay
 *
 * `POST /orders` answers `201` the first time and `200` when an
 * `Idempotency-Key` is replayed, but the body is the same object either way —
 * the same fields, the same types, the same order id and the same
 * `orderNumber`. A client can therefore treat any 2xx as success and parse one
 * model, which is exactly what makes a retry safe to write.
 *
 * Nothing internal is exposed: `adminNote` is absent by construction, and so is
 * `idempotencyKey` — echoing a key back would let a response confirm which keys
 * exist.
 */
export class OrderDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d', description: 'The order id.' })
  id!: string;

  @ApiProperty({
    example: 'NE-20260830-0001',
    description:
      'Human-readable reference. `NE-<UTC date>-<sequence>`, where the sequence resets daily, so ' +
      'it discloses nothing about total order volume.',
  })
  orderNumber!: string;

  @ApiProperty({
    enum: OrderStatus,
    example: OrderStatus.PLACED,
    description:
      'A newly placed order is ALWAYS `PLACED` — the status is server-controlled and no request ' +
      'body can set it. `CANCELLED` is reachable by the customer via ' +
      '`POST /orders/{id}/cancel` while the order is `PLACED` or `CONFIRMED`; every other ' +
      'transition is driven by the shop. Handle all seven values exhaustively.',
  })
  status!: OrderStatus;

  @ApiProperty({ type: OrderCustomerDto })
  customer!: OrderCustomerDto;

  @ApiProperty({ type: [OrderItemDto] })
  items!: OrderItemDto[];

  @ApiProperty({ example: 'EGP', enum: ['EGP'] })
  currency!: string;

  @ApiProperty({
    type: PricingBreakdownDto,
    description: 'The frozen financial record. `grandTotal` is the cash amount due on delivery.',
  })
  pricing!: PricingBreakdownDto;

  @ApiProperty({ type: OrderPaymentDto })
  payment!: OrderPaymentDto;

  @ApiProperty({ type: OrderShippingAddressDto })
  shippingAddress!: OrderShippingAddressDto;

  @ApiProperty({ example: 'Please call before delivery.', nullable: true, type: String })
  customerNote!: string | null;

  /**
   * Present ONLY when `status` is `CANCELLED`, and always present as a key.
   *
   * Required-and-nullable rather than optional, so a generated Dart model never
   * has to distinguish "absent" from "null" (API-CONTRACT.md §1).
   */
  @ApiProperty({
    type: OrderCancellationDto,
    nullable: true,
    description: 'Why the order was cancelled, and by whom. `null` unless `status` is `CANCELLED`.',
  })
  cancellation!: OrderCancellationDto | null;

  /**
   * Present once the order has shipped, and always present as a key.
   *
   * Null while `PLACED` or `CONFIRMED`, and null forever on an order cancelled
   * before dispatch.
   */
  @ApiProperty({
    type: OrderShipmentDto,
    nullable: true,
    description: 'Carrier and tracking. `null` until the order reaches `SHIPPED`.',
  })
  shipment!: OrderShipmentDto | null;

  @ApiProperty({ example: '2026-08-30T14:22:31.000Z', format: 'date-time' })
  placedAt!: string;

  static from(order: PlacedOrder, locale: Locale): OrderDto {
    return {
      id: order._id.toHexString(),
      orderNumber: order.orderNumber,
      status: order.status,
      customer: {
        fullName: order.customer.fullName,
        email: order.customer.email,
        phone: order.customer.phone,
      },
      items: order.items.map((item) => ({
        productId: item.productId.toHexString(),
        sku: item.sku,
        slug: item.slug,
        name: resolveText(item.name, locale),
        brandName: item.brandName,
        imagePublicId: item.imagePublicId,
        unitPrice: MoneyDto.of(item.unitPrice, order.currency),
        quantity: item.quantity,
        lineTotal: MoneyDto.of(item.lineTotal, order.currency),
      })),
      currency: order.currency,
      pricing: PricingBreakdownDto.of(
        order.pricing,
        order.currency,
        order.pricing.vatInclusive,
        order.pricing.vatRateBps,
      ),
      payment: {
        method: order.payment.method,
        status: order.payment.status,
        collectedAt: order.payment.collectedAt?.toISOString() ?? null,
      },
      shippingAddress: {
        fullName: order.shippingAddress.fullName,
        phone: order.shippingAddress.phone,
        street: order.shippingAddress.street,
        city: order.shippingAddress.city,
        governorate: order.shippingAddress.governorate,
        postalCode: order.shippingAddress.postalCode,
      },
      customerNote: order.customerNote,
      cancellation:
        order.cancellation === null
          ? null
          : {
              reason: order.cancellation.reason,
              by: order.cancellation.by,
              at: order.cancellation.at.toISOString(),
            },
      shipment:
        order.shipment === null
          ? null
          : {
              carrier: order.shipment.carrier,
              trackingNumber: order.shipment.trackingNumber,
              shippedAt: order.shipment.shippedAt.toISOString(),
              deliveredAt: order.shipment.deliveredAt?.toISOString() ?? null,
              deliveryAttempts: order.shipment.deliveryAttempts,
            },
      placedAt: order.placedAt.toISOString(),
    };
  }
}

export class OrderResponseDto {
  @ApiProperty({ type: OrderDto })
  data!: OrderDto;
}
