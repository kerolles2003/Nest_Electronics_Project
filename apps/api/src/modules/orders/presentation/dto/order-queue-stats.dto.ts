import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '../../domain/order-status';
import type { OrderStatusCounts } from '../../application/orders.service';

/**
 * How many orders sit in each lifecycle status.
 *
 * ## What this replaces
 *
 * The console asked for seven pages of one order each and read `meta.total` off
 * every response — seven requests and seven index scans to draw one row of
 * tiles. Worse than the cost: the seven numbers were taken at seven different
 * instants, so an order confirmed midway through could be counted twice or not
 * at all, and the tiles would not add up to the total beside them. This is one
 * `$group` at one instant, so they always do.
 *
 * ## Every status is present, including the empty ones
 *
 * `$group` cannot produce a bucket for a value it never saw, so a status that
 * nothing is in is simply absent from the aggregation. The service fills those
 * in with `0` before the response is built, because a console that renders a
 * missing key as an em dash and a zero as "0" would otherwise show "no
 * cancelled orders" and "cancelled orders unknown" identically — and on a
 * fulfilment console those are very different sentences.
 */
export class OrderStatusCountDto {
  @ApiProperty({ enum: OrderStatus, example: OrderStatus.PLACED })
  status!: OrderStatus;

  @ApiProperty({ example: 12, minimum: 0, description: 'Orders currently in this status.' })
  count!: number;
}

export class OrderQueueStatsDto {
  @ApiProperty({
    type: [OrderStatusCountDto],
    description:
      'One entry per lifecycle status, in the state machine’s own order, always complete — a ' +
      'status with no orders is present with a count of `0` rather than omitted.',
  })
  byStatus!: OrderStatusCountDto[];

  @ApiProperty({
    example: 37,
    minimum: 0,
    description:
      'Every order in the system. Equal to the sum of `byStatus` by construction: both come ' +
      'from the same aggregation at the same instant.',
  })
  total!: number;

  static from(counts: OrderStatusCounts): OrderQueueStatsDto {
    return {
      byStatus: [...counts.counts].map(([status, count]) => ({ status, count })),
      total: counts.total,
    };
  }
}

export class OrderQueueStatsResponseDto {
  @ApiProperty({ type: OrderQueueStatsDto })
  data!: OrderQueueStatsDto;
}
