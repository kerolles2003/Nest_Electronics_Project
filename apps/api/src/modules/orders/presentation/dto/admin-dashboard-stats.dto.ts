import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { MoneyDto } from '../../../../common/dto/money.dto';
import { DASHBOARD_WINDOWS, type DashboardWindowKey } from '../../domain/dashboard-window';
import { OrderStatusCountDto } from './order-queue-stats.dto';

/**
 * The one thing this endpoint accepts.
 *
 * A closed set, not a pair of dates. An arbitrary range would be a client
 * string reaching a query operator for a screen whose whole job is to be
 * glanced at, and it would let a caller ask for a span no index makes cheap —
 * which is the cost this window exists to bound. Three choices cover the
 * question; a report tool is a different feature.
 */
export class DashboardStatsQueryDto {
  @ApiPropertyOptional({
    enum: DASHBOARD_WINDOWS,
    default: '30d',
    description:
      'Trailing period for the order figures. Defaults to 30 days — all-time is ' +
      'available and is deliberately not the default: it is both the less useful ' +
      'answer and the expensive query.',
  })
  @IsOptional()
  @IsIn(DASHBOARD_WINDOWS, {
    message: `window must be one of: ${DASHBOARD_WINDOWS.join(', ')}`,
  })
  window?: DashboardWindowKey;
}

/**
 * The period every order-derived figure below was computed over.
 *
 * It is in the RESPONSE, not merely in the request, because the caption and the
 * number have to come from one place. A console that formats its own "last 30
 * days" beside a figure the server computed over 90 is a lie that no test
 * catches.
 */
export class DashboardWindowDto {
  @ApiProperty({ enum: DASHBOARD_WINDOWS, example: '30d' })
  key!: DashboardWindowKey;

  @ApiProperty({
    example: 30,
    nullable: true,
    description: 'Trailing days, or null for all-time.',
  })
  days!: number | null;

  @ApiProperty({
    example: 'Orders placed in the last 30 days',
    description:
      'Print this verbatim. It says "orders placed" because the bound is on ' +
      'placedAt while revenue is recognised at delivery — an order placed 32 ' +
      'days ago and delivered yesterday is outside a 30-day figure.',
  })
  label!: string;

  @ApiProperty({
    example: '2026-08-05T00:00:00.000Z',
    nullable: true,
    description: 'Lower bound on placedAt, or null for all-time.',
  })
  since!: string | null;
}

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
    description: 'Orders placed inside the window, across all statuses.',
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
    description:
      'Unique customers who placed an order INSIDE the window. Over the default ' +
      '30 days this is "customers who ordered recently", not "customers who have ' +
      'ever ordered" — ask for window=all if that is the question.',
  })
  withOrdersCount!: number;
}

export class AdminDashboardStatsDto {
  @ApiProperty({
    type: DashboardWindowDto,
    description:
      'The period the revenue, orders and withOrdersCount figures cover. Product ' +
      'and customer totals are current-state and are not windowed.',
  })
  window!: DashboardWindowDto;

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
