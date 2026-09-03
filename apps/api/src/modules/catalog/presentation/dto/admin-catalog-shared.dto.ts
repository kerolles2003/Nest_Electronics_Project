import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OBJECT_ID_PATTERN } from '../../../../common/dto/object-id';
import { MAX_SLUG_LENGTH } from '../../domain/slug';

/**
 * Input shapes shared by the product, category and brand write endpoints.
 *
 * These live together rather than being duplicated per entity because the three
 * write surfaces agree on what a name, a slug and a spec ARE, and three copies
 * of a localized-text validator is the shape drift starts in — the same
 * argument `embedded.schema.ts` makes for the persistence side.
 */

/** Lowercase alphanumerics separated by single hyphens. */
export const ADMIN_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * `{ en, ar? }`, per CATALOG-MODEL.md §3.
 *
 * `en` is REQUIRED on every write. The document says MVP populates `en` only
 * and every public read falls back to it, so a product whose `en` were absent
 * would render blank everywhere — legacy allowed exactly that and 100% of
 * `name_ar` was null.
 *
 * `ar` accepts `null` explicitly rather than only being omittable, because
 * CLEARING an Arabic name is a thing an operator does and "omit the field"
 * cannot express it: with a partial update, an absent key means "leave it".
 */
export class LocalizedTextInputDto {
  @ApiProperty({ example: 'ESP32 DevKit V1', maxLength: 200 })
  @IsString({ message: 'name.en must be a string' })
  @MinLength(1, { message: 'name.en must not be empty' })
  @MaxLength(200, { message: 'name.en must not exceed 200 characters' })
  en!: string;

  @ApiPropertyOptional({ example: null, nullable: true, type: String, maxLength: 200 })
  @IsOptional()
  @IsString({ message: 'the Arabic text must be a string or null' })
  @MaxLength(200)
  ar?: string | null;
}

/** The long-form variant. Same rules, room for prose. */
export class LocalizedProseInputDto {
  @ApiProperty({ example: 'A 38-pin ESP32 development board.', maxLength: 5000 })
  @IsString()
  @MinLength(1, { message: 'the English text must not be empty' })
  @MaxLength(5000, { message: 'the English text must not exceed 5000 characters' })
  en!: string;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  ar?: string | null;
}

/**
 * One embedded spec, replacing the legacy three-table EAV.
 *
 * `label` and `unit` are supplied by the caller rather than looked up, and that
 * is a consequence of an OPEN owner decision rather than a design preference:
 * CATALOG-MODEL.md §7 puts the canonical `key → label/unit/filterable`
 * dictionary in a `specDefinitions` collection, and what belongs in that
 * collection is owner data nobody has supplied. Until it exists the admin form
 * is the only place those values can come from. See the handoff — this is the
 * `attributes` item, and it is why the admin's attribute route is untouched.
 */
export class ProductSpecInputDto {
  @ApiProperty({
    example: 'operating-voltage',
    description: 'Stable machine key. Facet filters group on this, so it must not drift.',
    maxLength: 60,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'a spec key must be lowercase alphanumerics separated by single hyphens',
  })
  key!: string;

  @ApiProperty({ example: 'Operating voltage', maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @ApiProperty({
    example: '3.3',
    maxLength: 200,
    description:
      'A STRING, always. Component specs are heterogeneous — "3.3", "Wi-Fi + Bluetooth", ' +
      '"-40 to 85" — and numeric range filtering is not in MVP.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  value!: string;

  @ApiPropertyOptional({ example: 'V', nullable: true, type: String, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string | null;

  @ApiPropertyOptional({ example: true, default: false, description: 'Only filterable specs become facets.' })
  @IsOptional()
  @IsBoolean()
  filterable?: boolean;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** SEO overrides. Both nullable — an absent override means "derive it". */
export class ProductSeoInputDto {
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 70 })
  @IsOptional()
  @IsString()
  @MaxLength(70, { message: 'an SEO title over 70 characters is truncated by search engines' })
  title?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string | null;
}

/** Millimetres, all three required together — a partial box is not a box. */
export class ProductDimensionsInputDto {
  @ApiProperty({ example: 55 })
  @Type(() => Number)
  @IsInt({ message: 'length must be a whole number of millimetres' })
  @Min(1)
  length!: number;

  @ApiProperty({ example: 28 })
  @Type(() => Number)
  @IsInt({ message: 'width must be a whole number of millimetres' })
  @Min(1)
  width!: number;

  @ApiProperty({ example: 13 })
  @Type(() => Number)
  @IsInt({ message: 'height must be a whole number of millimetres' })
  @Min(1)
  height!: number;
}

/** A 24-character hex id in the path. */
export class EntityIdParamDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d', pattern: OBJECT_ID_PATTERN.source })
  @Matches(OBJECT_ID_PATTERN, { message: 'id must be a 24-character hex id' })
  id!: string;
}

/**
 * The slug field, wherever a write accepts one.
 *
 * VALIDATED, never normalised. §2 rule 6 makes the slug admin-editable, and a
 * malformed edit that is silently rewritten leaves the operator looking at one
 * value in the form and another in the URL — neither wrong enough to notice.
 * A 400 is the honest answer.
 *
 * Composed once because four request DTOs need the identical three rules, and
 * a slug validated by three of them in one place and two in another is a
 * difference nobody would find by reading either file.
 */
export function IsSlug(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MaxLength(MAX_SLUG_LENGTH, {
      message: `a slug must not exceed ${String(MAX_SLUG_LENGTH)} characters`,
    }),
    Matches(ADMIN_SLUG_PATTERN, {
      message: 'a slug must be lowercase alphanumerics separated by single hyphens',
    }),
  );
}
