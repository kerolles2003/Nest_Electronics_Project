import { ApiProperty } from '@nestjs/swagger';

/**
 * The one pagination shape, returned by every collection endpoint.
 *
 * Authority: docs/architecture/API-CONTRACT.md §3.
 *
 * `total` is the TRUE match count. Legacy totals were wrong by construction —
 * an exact count applied to an already-paginated result — so this is computed
 * in the same aggregation round trip as the page itself.
 */
export class PaginationMetaDto {
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 24 }) limit!: number;
  @ApiProperty({ example: 137, description: 'Total matching items across all pages.' })
  total!: number;
  @ApiProperty({ example: 6 }) totalPages!: number;
  @ApiProperty({ example: true }) hasNext!: boolean;
  @ApiProperty({ example: false }) hasPrev!: boolean;

  static of(page: number, limit: number, total: number): PaginationMetaDto {
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    return {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1 && total > 0,
    };
  }
}
