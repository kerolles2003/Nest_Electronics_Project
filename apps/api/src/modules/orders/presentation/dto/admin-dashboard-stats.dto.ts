import { ApiProperty } from '@nestjs/swagger';
import { MoneyDto } from '../../../../common/dto/money.dto';
import { OrderStatusCountDto } from './order-queue-stats.dto';

/**
 * Revenue metrics for the dashboard.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §"Payment status",
 *            ADR-ORDER-002, and `orders/domain/revenue.ts`.
 *
 * ## Revenue is counted at DELIVERY, not placement
 * Under Cash on Delivery, delivery IS the payment event (`payment.status = PAID`).
 * Counting revenue at placement would count cash nobody has collected.
 *
 * In-flight orders (PLACED, CONFIRMED, SHIPPED, DELIVERY_FAILED) are tracked
 * BESIDE revenue as `pipeline`, never added to it.
 */
export class DashboardRevenueDto {
  @ApiProperty({
    type: MoneyDto,
    description: 'Revenue recognised at DELIVERY where payment.status = PAID.',
  })
  delivered!: MoneyDto;

  @ApiProperty({
    example: 42,
    minimum: 0,
    description: 'Count of orders delivered and paid.',
  })
  deliveredCount!: number;

  @ApiProperty({
    type: MoneyDto,
    description:
      'Pipeline value: in-flight orders with payment.status = PENDING and ' +
      'status in [PLACED, CONFIRMED, SHIPPED, DELIVERY_FAILED].',
  })
  pipeline!: MoneyDto;

  @ApiProperty({
    example: 15,
    minimum: 0,
    description: 'Count of orders currently in the delivery pipeline.',
  })
  pipelineCount!: number;
}

export class DashboardOrdersDto {
  @ApiProperty({
    example: 60,
    minimum: 0,
    description: 'Total orders placed across all statuses.',
  })
  total!: number;

  @ApiProperty({
    type: [OrderStatusCountDto],
    description:
      'Complete breakdown by lifecycle status (all 7 statuses present, 0 if empty).',
  })
  byStatus!: OrderStatusCountDto[];
}

export class DashboardLowStockItemDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' })
  id!: string;

  @ApiProperty({ example: 'ESP32 DevKit V1' })
  name!: string;

  @ApiProperty({ example: 'esp32-devkit-v1' })
  slug!: string;

  @ApiProperty({ example: 'ESP32-DEV-V1' })
  sku!: string;

  @ApiProperty({ example: 2, minimum: 0, description: 'Current units on hand.' })
  onHand!: number;

  @ApiProperty({
    example: 5,
    minimum: 0,
    description: 'Threshold below which item is flagged low-stock.',
  })
  lowStockThreshold!: number;
}

export class DashboardProductsDto {
  @ApiProperty({
    example: 34,
    minimum: 0,
    description: 'Total active, non-deleted products.',
  })
  total!: number;

  @ApiProperty({
    example: 4,
    minimum: 0,
    description: 'Count of active products with onHand <= lowStockThreshold.',
  })
  lowStockCount!: number;

  @ApiProperty({
    example: 1,
    minimum: 0,
    description: 'Count of active products with onHand = 0.',
  })
  outOfStockCount!: number;

  @ApiProperty({
    type: [DashboardLowStockItemDto],
    description: 'Lowest-stock active products (up to 8 items).',
  })
  lowStock!: DashboardLowStockItemDto[];
}

export class DashboardCustomersDto {
  @ApiProperty({
    example: 120,
    minimum: 0,
    description: 'Total registered customer accounts (excluding soft-deleted and staff).',
  })
  total!: number;

  @ApiProperty({
    example: 8,
    minimum: 0,
    description: 'Customer accounts registered in the last 7 days.',
  })
  newThisWeek!: number;

  @ApiProperty({
    example: 45,
    minimum: 0,
    description: 'Unique customers who have placed at least one order.',
  })
  withOrdersCount!: number;
}

export class AdminDashboardStatsDto {
  @ApiProperty({ type: DashboardRevenueDto })
  revenue!: DashboardRevenueDto;

  @ApiProperty({ type: DashboardOrdersDto })
  orders!: DashboardOrdersDto;

  @ApiProperty({ type: DashboardProductsDto })
  products!: DashboardProductsDto;

  @ApiProperty({ type: DashboardCustomersDto })
  customers!: DashboardCustomersDto;
}

export class AdminDashboardStatsResponseDto {
  @ApiProperty({ type: AdminDashboardStatsDto })
  data!: AdminDashboardStatsDto;
}
