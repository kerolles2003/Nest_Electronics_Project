import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUrl,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { OBJECT_ID_PATTERN } from '../../../../common/dto/object-id';
import type { BrandLean } from '../../infrastructure/schemas/brand.schema';
import type { CategoryLean } from '../../infrastructure/schemas/category.schema';
import {
  IsSlug,
  LocalizedProseInputDto,
  LocalizedTextInputDto,
} from './admin-catalog-shared.dto';
import { AdminLocalizedTextDto } from './admin-product-response.dto';

/**
 * Category and brand write DTOs, and the admin views of both.
 *
 * They share a file because they are the same shape minus a hierarchy: §6 makes
 * brands "a flat list, no hierarchy", so a brand is a category without
 * `parentId`, `path`, `depth` and `sortOrder`. Splitting them would put two
 * near-identical localized-text nestings in two places.
 */

function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === '1' || value === true) return true;
  if (value === 'false' || value === '0' || value === false) return false;
  return value;
}

/** `?includeDeleted=true` on either listing. */
export class TaxonomyListQueryDto {
  @ApiPropertyOptional({
    example: false,
    default: false,
    description:
      'Include soft-deleted rows. Excluded by default: a recoverable deletion has to be ' +
      'findable, but the working list is what an operator is editing.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'includeDeleted must be true or false' })
  includeDeleted?: boolean;
}

export class CreateCategoryDto {
  @ApiProperty({ example: 'microcontrollers' })
  @IsSlug()
  slug!: string;

  @ApiProperty({ type: LocalizedTextInputDto })
  @ValidateNested()
  @Type(() => LocalizedTextInputDto)
  name!: LocalizedTextInputDto;

  @ApiPropertyOptional({ type: LocalizedProseInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedProseInputDto)
  description?: LocalizedProseInputDto | null;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description:
      'The parent, or `null` for a root. The materialised `path` and `depth` are computed ' +
      'server-side from it — they are not accepted, because a caller-supplied ancestor chain ' +
      'is one that can disagree with `parentId`, and `path` is what every subtree query matches.',
  })
  @IsOptional()
  @Matches(OBJECT_ID_PATTERN, { message: 'parentId must be a 24-character hex id' })
  parentId?: string | null;

  @ApiPropertyOptional({ example: 0, default: 0, description: 'Display order among siblings.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description:
      'Categories default to ACTIVE, unlike products. A category is navigation, not merchandise: ' +
      'it has nothing to review before it goes live, and a hidden one is invisible in the very ' +
      'picker an operator needs in order to file the first product under it.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ description: 'Renaming writes a `slugRedirects` row, as for a product.' })
  @IsOptional()
  @IsSlug()
  slug?: string;

  @ApiPropertyOptional({ type: LocalizedTextInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextInputDto)
  name?: LocalizedTextInputDto;

  @ApiPropertyOptional({ type: LocalizedProseInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedProseInputDto)
  description?: LocalizedProseInputDto | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'REPARENTS the category. `null` makes it a root. The whole subtree’s `path` and `depth` ' +
      'are rewritten, cycle detection runs, and the depth limit is checked against the DEEPEST ' +
      'descendant rather than against this category.',
  })
  @IsOptional()
  @Matches(OBJECT_ID_PATTERN, { message: 'parentId must be a 24-character hex id' })
  parentId?: string | null;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateBrandDto {
  @ApiProperty({ example: 'espressif' })
  @IsSlug()
  slug!: string;

  @ApiProperty({ type: LocalizedTextInputDto })
  @ValidateNested()
  @Type(() => LocalizedTextInputDto)
  name!: LocalizedTextInputDto;

  @ApiPropertyOptional({ type: LocalizedProseInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedProseInputDto)
  description?: LocalizedProseInputDto | null;

  @ApiPropertyOptional({ example: 'https://www.espressif.com', nullable: true })
  @IsOptional()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'website must be an http or https URL' },
  )
  website?: string | null;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBrandDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsSlug()
  slug?: string;

  @ApiPropertyOptional({ type: LocalizedTextInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextInputDto)
  name?: LocalizedTextInputDto;

  @ApiPropertyOptional({ type: LocalizedProseInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedProseInputDto)
  description?: LocalizedProseInputDto | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'website must be an http or https URL' },
  )
  website?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// --- responses --------------------------------------------------------------

export class AdminCategoryDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' }) id!: string;
  @ApiProperty({ example: 'microcontrollers' }) slug!: string;
  @ApiProperty({ type: AdminLocalizedTextDto }) name!: AdminLocalizedTextDto;

  @ApiProperty({ type: AdminLocalizedTextDto, nullable: true })
  description!: AdminLocalizedTextDto | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  parentId!: string | null;

  @ApiProperty({
    type: [String],
    description: 'Ancestor ids, root first, EXCLUDING self — what a breadcrumb needs.',
  })
  path!: string[];

  @ApiProperty({ example: 1, description: '`path.length`. A root is 0; the limit is 3.' })
  depth!: number;

  @ApiProperty({ example: 0 }) sortOrder!: number;
  @ApiProperty({ example: true }) isActive!: boolean;

  @ApiProperty({
    example: 12,
    description:
      'Published, non-deleted products in this category’s SUBTREE. Maintained by the catalogue; ' +
      'a display count, never an authority.',
  })
  productCount!: number;

  @ApiProperty({ example: null, nullable: true, type: String }) deletedAt!: string | null;
  @ApiProperty({ example: '2026-09-03T09:14:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: '2026-09-03T09:14:00.000Z' }) updatedAt!: string;

  static from(category: CategoryLean): AdminCategoryDto {
    return {
      id: category._id.toHexString(),
      slug: category.slug,
      name: { en: category.name.en, ar: category.name.ar },
      description: AdminLocalizedTextDto.from(category.description),
      parentId: category.parentId?.toHexString() ?? null,
      path: category.path.map((id) => id.toHexString()),
      depth: category.depth,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      productCount: category.productCount,
      deletedAt: category.deletedAt === null ? null : category.deletedAt.toISOString(),
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
    };
  }
}

export class AdminBrandDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0e' }) id!: string;
  @ApiProperty({ example: 'espressif' }) slug!: string;
  @ApiProperty({ type: AdminLocalizedTextDto }) name!: AdminLocalizedTextDto;

  @ApiProperty({ type: AdminLocalizedTextDto, nullable: true })
  description!: AdminLocalizedTextDto | null;

  @ApiProperty({ example: null, nullable: true, type: String }) website!: string | null;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ example: 8 }) productCount!: number;
  @ApiProperty({ example: null, nullable: true, type: String }) deletedAt!: string | null;
  @ApiProperty({ example: '2026-09-03T09:14:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: '2026-09-03T09:14:00.000Z' }) updatedAt!: string;

  static from(brand: BrandLean): AdminBrandDto {
    return {
      id: brand._id.toHexString(),
      slug: brand.slug,
      name: { en: brand.name.en, ar: brand.name.ar },
      description: AdminLocalizedTextDto.from(brand.description),
      website: brand.website,
      isActive: brand.isActive,
      productCount: brand.productCount,
      deletedAt: brand.deletedAt === null ? null : brand.deletedAt.toISOString(),
      createdAt: brand.createdAt.toISOString(),
      updatedAt: brand.updatedAt.toISOString(),
    };
  }
}

export class AdminCategoryResponseDto {
  @ApiProperty({ type: AdminCategoryDto }) data!: AdminCategoryDto;
}

export class AdminCategoryListResponseDto {
  @ApiProperty({ type: [AdminCategoryDto] }) data!: AdminCategoryDto[];
}

export class AdminBrandResponseDto {
  @ApiProperty({ type: AdminBrandDto }) data!: AdminBrandDto;
}

export class AdminBrandListResponseDto {
  @ApiProperty({ type: [AdminBrandDto] }) data!: AdminBrandDto[];
}
