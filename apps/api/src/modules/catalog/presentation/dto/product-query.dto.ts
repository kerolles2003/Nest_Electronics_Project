import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import { SLUG_PATTERN } from '../../../../common/dto/slug-param.dto';

/**
 * The sort allow-list for `GET /products`.
 *
 * Authority: docs/architecture/SEARCH-MODEL.md §5.
 *
 * This is failure 1 of the legacy search fixed: the old UI already offered
 * exactly these five options, and the backend had no parameter to receive them
 * because the RPC hardcoded `ORDER BY rank DESC, is_featured DESC, created_at DESC`.
 */
export enum ProductSort {
  /** Text relevance, then featured, then newest. Default WITH `q`; falls back to `newest` without it. */
  RELEVANCE = 'relevance',
  /** Default WITHOUT `q`. */
  NEWEST = 'newest',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  RATING = 'rating',
  NAME_ASC = 'name_asc',
}

export const PRODUCT_SORT_VALUES: readonly string[] = Object.values(ProductSort);

/** `?brand=a&brand=b` arrives as an array; `?brand=a` as a string. Normalise both. */
function toStringArray({ value }: { value: unknown }): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const raw = Array.isArray(value) ? value : [value];
  const cleaned = raw.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);

  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Accepts only the documented spellings. Anything else is passed through
 * unchanged so `@IsBoolean` rejects it — `enableImplicitConversion` is disabled
 * precisely so a bogus value fails loudly rather than coercing to `true`.
 */
function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === '1' || value === true) {
    return true;
  }
  if (value === 'false' || value === '0' || value === false) {
    return false;
  }
  return value;
}

/**
 * The full discovery query surface.
 *
 * Authority: docs/architecture/SEARCH-MODEL.md §4.
 *
 * One endpoint serves browse, category, brand and search — search is a
 * PARAMETER, not a different resource. Legacy ran `/products` and `/search` as
 * two pages over one query with duplicated URL-to-filter mapping.
 *
 * Every filter is a named, typed parameter. There is deliberately no generic
 * filter passthrough: legacy interpolated user input into PostgREST `.or()` and
 * `.ilike()` filter strings in six places, letting a caller restructure the
 * filter tree.
 */
export class ProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: 100,
    example: 'esp32',
    description:
      'Free-text search across name, SKU, brand and descriptions. SKU is weighted almost as ' +
      'highly as the name, so an exact part number matches first. Absent or empty = browse mode.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'q must not exceed 100 characters' })
  q?: string;

  @ApiPropertyOptional({
    example: 'microcontrollers',
    description:
      'Category slug. Matches the ENTIRE SUBTREE, so a parent category includes every ' +
      'descendant category’s products.',
  })
  @IsOptional()
  @IsString()
  @Matches(SLUG_PATTERN, { message: 'category must be a lowercase kebab-case slug' })
  category?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['espressif'],
    description: 'Brand slug. Repeatable: `?brand=espressif&brand=arduino` is an OR within brands.',
  })
  @IsOptional()
  @Transform(toStringArray)
  @Matches(SLUG_PATTERN, { each: true, message: 'brand must be a lowercase kebab-case slug' })
  brand?: string[];

  @ApiPropertyOptional({
    minimum: 0,
    example: 10000,
    description:
      'Minimum price in integer minor units (piastres), applied to the EFFECTIVE price ' +
      '(salePrice ?? basePrice) — the same value checkout charges.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minPrice must be an integer number of minor units' })
  @Min(0, { message: 'minPrice must not be negative' })
  minPrice?: number;

  @ApiPropertyOptional({
    minimum: 0,
    example: 50000,
    description: 'Maximum effective price in integer minor units (piastres).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'maxPrice must be an integer number of minor units' })
  @Min(0, { message: 'maxPrice must not be negative' })
  maxPrice?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'When true, returns only products with stock on hand.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'inStock must be true or false' })
  inStock?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'When true, returns only featured products. Useful for a home-screen rail.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'featured must be true or false' })
  featured?: boolean;

  @ApiPropertyOptional({
    type: [String],
    example: ['operating-voltage:3.3'],
    description:
      'Spec facet filter as `key:value`. Repeatable. AND across different keys, OR within one ' +
      'key: `?spec=operating-voltage:3.3&spec=connectivity:Wi-Fi` means voltage 3.3 AND Wi-Fi.',
  })
  @IsOptional()
  @Transform(toStringArray)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*:.+$/, {
    each: true,
    message: 'spec must be in the form key:value, where key is lowercase kebab-case',
  })
  spec?: string[];

  @ApiPropertyOptional({
    enum: ProductSort,
    example: ProductSort.NEWEST,
    description:
      'Sort order. Defaults to `relevance` when `q` is present and `newest` otherwise. ' +
      'Requesting `relevance` without `q` falls back to `newest` rather than erroring. ' +
      'Any other value returns 400 UNSUPPORTED_SORT.',
  })
  @IsOptional()
  @IsString()
  sort?: string;
}
