import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsDate, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { OBJECT_ID_PATTERN } from '../../../../common/dto/object-id';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import { MAX_SEARCH_LENGTH } from '../../domain/order-search';
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
 * How the queue may be ordered. A closed set, never a field name.
 *
 * A caller-supplied sort key is a query expression built from a client string,
 * which is the one thing this API does not do anywhere — and it would also let
 * a caller ask for an ordering no index serves, turning one request into a
 * collection-wide in-memory sort.
 */
export enum OrderQueueSortOption {
  NEWEST = 'newest',
  OLDEST = 'oldest',
  TOTAL_HIGH = 'total_high',
  TOTAL_LOW = 'total_low',
}

/**
 * Parses a date bound, treating a DATE-ONLY upper bound as the end of that day.
 *
 * `?placedTo=2026-09-03` means "up to and including the third", which is what
 * an operator means by it. Parsed as a plain instant it is midnight at the
 * START of the third, and every order placed that day is silently excluded —
 * the filter returns fewer orders than it should and looks like it worked.
 *
 * UTC, in line with the order-number counter, which is the only other place in
 * this system that turns an instant into a day. No timezone is configured
 * anywhere, and inventing one in a DTO would put a business rule in a parser.
 */
function toDateBound(endOfDay: boolean) {
  return ({ value }: { value: unknown }): unknown => {
    /*
     * IDEMPOTENT, and that is not defensive programming — it is required.
     *
     * The transform runs more than once on the same request: the validation
     * pipe converts the string to a `Date`, and a later pass hands that `Date`
     * straight back in. Without this line the second pass sees something that
     * is not a string and returns `undefined`, so the parameter validates
     * correctly and then vanishes before the controller reads it — a filter
     * that is accepted, reported as valid, and silently not applied.
     *
     * It cost four failing tests to find, and the symptom was the worst kind:
     * a malformed date was still rejected with a 400, so the parameter looked
     * completely wired up.
     */
    if (value instanceof Date) return value;

    if (typeof value !== 'string' || value.trim().length === 0) return undefined;

    const text = value.trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const parsed = new Date(dateOnly && endOfDay ? `${text}T23:59:59.999Z` : text);

    // An unparseable date becomes NaN, which `@IsDate` rejects with a 400. It
    // must NOT become `undefined`: that would drop the filter and answer a
    // malformed request with the unfiltered queue.
    return parsed;
  };
}

/**
 * The admin work queue's query surface.
 *
 * Authority: docs/architecture/API-CONTRACT.md §4 — offset pagination and
 * explicit named parameters only. There is no generic filter passthrough and
 * no sort-by-field-name, for the same reason there is no `userId` on the
 * customer's history: a parameter that becomes part of a query expression is a
 * parameter a caller can restructure.
 *
 * `forbidNonWhitelisted` is on globally, so an unknown parameter is a 400
 * rather than a silently ignored filter — which matters most for the ones a
 * caller is likely to guess, like `?userId=` or `?sort=createdAt`.
 */
export class AdminOrderQueueQueryDto extends OrderHistoryQueryDto {
  @ApiPropertyOptional({
    example: 'NE-20260903',
    maxLength: MAX_SEARCH_LENGTH,
    description:
      'Free text, matched against the order number and the customer SNAPSHOT on the order — ' +
      'name, email and phone. The order number and email match from the start; the name ' +
      'matches anywhere; the phone matches on digits alone, so `010-1234` and `0101234` are ' +
      'the same search. The term is escaped before it reaches the database, so regular ' +
      'expression syntax in it is matched literally. Whitespace-only is not a filter.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  q?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description:
      'Only orders placed at or after this instant. Accepts a date (`2026-09-01`) or a full ' +
      'ISO 8601 timestamp. Interpreted in UTC.',
  })
  @IsOptional()
  @Transform(toDateBound(false))
  @IsDate({ message: 'placedFrom must be a date (2026-09-01) or an ISO 8601 timestamp' })
  placedFrom?: Date;

  @ApiPropertyOptional({
    example: '2026-09-03',
    description:
      'Only orders placed at or before this instant. A DATE with no time means the END of ' +
      'that day in UTC, so `2026-09-03` includes everything placed on the third.',
  })
  @IsOptional()
  @Transform(toDateBound(true))
  @IsDate({ message: 'placedTo must be a date (2026-09-03) or an ISO 8601 timestamp' })
  placedTo?: Date;

  @ApiPropertyOptional({
    enum: OrderQueueSortOption,
    default: OrderQueueSortOption.NEWEST,
    description:
      'Ordering. Every option is served by an index and every one breaks ties on the order ' +
      'id, so paging through the queue cannot skip or repeat a row.',
  })
  @IsOptional()
  @IsEnum(OrderQueueSortOption, {
    message: `sort must be one of: ${Object.values(OrderQueueSortOption).join(', ')}`,
  })
  sort?: OrderQueueSortOption;
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
