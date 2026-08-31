import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { OBJECT_ID_PATTERN } from '../../../../common/dto/object-id';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import { OrderStatus } from '../../domain/order-status';

/** `?status=A&status=B` arrives as an array, `?status=A` as a string. Normalise both. */
function toStringArray({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }

  const raw = Array.isArray(value) ? value : [value];
  const cleaned = raw.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);

  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * The order-history query surface.
 *
 * Authority: docs/architecture/API-CONTRACT.md §4 — offset pagination, and
 * explicit named parameters only. There is deliberately no generic filter
 * passthrough: legacy interpolated user input into PostgREST filter strings in
 * six places, letting a caller restructure the filter tree. Here `status` is
 * narrowed to an enum before it can reach a query operator, so no client string
 * ever becomes part of a MongoDB expression.
 *
 * There is no `userId` parameter, and there never will be. Ownership comes from
 * the token and is a condition of the repository query.
 */
export class OrderHistoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    isArray: true,
    enum: OrderStatus,
    example: [OrderStatus.PLACED],
    description:
      'Filter by lifecycle status. Repeatable — `?status=PLACED&status=CONFIRMED` matches ' +
      'EITHER, so one request can back an "active orders" tab. Omit it for every status. ' +
      'An unrecognised value is a `400`, not a silent empty page.',
  })
  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsEnum(OrderStatus, {
    each: true,
    message: `status must be one of: ${Object.values(OrderStatus).join(', ')}`,
  })
  status?: OrderStatus[];
}

/**
 * The order id path parameter.
 *
 * Validating the SHAPE here is not tidiness: an unvalidated string reaches
 * `new Types.ObjectId(...)`, which throws a BSONError that would surface as a
 * 500 rather than the 400 it actually is.
 *
 * A malformed id is a `400`, while a well-formed id that is unknown OR belongs
 * to another customer is a `404`. That is not an ownership oracle — the 400
 * depends only on the string's shape, never on whether any order exists.
 */
export class OrderIdParamDto {
  @ApiProperty({
    example: '652f1a9b3c4d5e6f7a8b9c0d',
    pattern: OBJECT_ID_PATTERN.source,
    description: 'The order id, as returned by `POST /orders` or `GET /orders`.',
  })
  @IsString()
  @Matches(OBJECT_ID_PATTERN, { message: 'id must be a 24-character hex id' })
  id!: string;
}
