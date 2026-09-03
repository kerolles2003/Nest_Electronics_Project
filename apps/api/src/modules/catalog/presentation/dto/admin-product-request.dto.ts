import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OBJECT_ID_PATTERN } from '../../../../common/dto/object-id';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import {
  IsSlug,
  LocalizedProseInputDto,
  LocalizedTextInputDto,
  ProductDimensionsInputDto,
  ProductSeoInputDto,
  ProductSpecInputDto,
} from './admin-catalog-shared.dto';

/**
 * Product write inputs.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §2 (identity), §4
 * (field ownership), §5 (pricing), §7 (specs), §9 (state).
 *
 * ## What is NOT here, and why each absence is the feature
 *
 * `stock`          InventoryModule is the sole writer (§4). Every stock change
 *                  must produce a ledger event, and a generic product update
 *                  that could set `stock.onHand` is legacy defect M7 exactly —
 *                  an admin moving stock with no ledger entry behind it.
 *                  `forbidNonWhitelisted` turns sending it into a 400
 *                  UNKNOWN_FIELD, which is a security signal rather than a
 *                  silently ignored key.
 * `rating`         ReviewsModule.
 * `salesCount`     OrdersModule.
 * `effectivePrice` MAINTAINED, never supplied. It is `salePrice ?? basePrice`
 *                  and a caller that could set it independently could make the
 *                  sortable price disagree with the charged price — the index
 *                  would then order the catalogue by a number nobody pays.
 * `images`         Attaching an image is a reference-counted operation with its
 *                  own endpoints. Accepting an image descriptor here would let
 *                  a caller point a product at an asset without retaining it,
 *                  and the asset would then be deletable while a live page
 *                  showed it — the precise defect the ledger exists to stop.
 * `deletedAt`      Deletion is an endpoint, not a field.
 * `currency`       One currency (MONEY-MODEL.md). A per-product currency would
 *                  be a money bug wearing a feature's clothes.
 */

/** Money arrives as an integer in minor units. A float is a rejected value, not a rounded one. */
const MONEY_MESSAGE = 'must be a whole number of piastres — 15000 means 150.00 EGP';

export class CreateProductDto {
  @ApiProperty({
    example: 'ESP32-WROOM-32',
    maxLength: 60,
    description:
      'The warehouse identifier. Unique, uppercased on write, and IMMUTABLE afterwards — ' +
      'there is no `sku` on the update DTO.',
  })
  @IsString()
  @MinLength(1, { message: 'sku must not be empty' })
  @MaxLength(60)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, {
    message: 'sku may contain letters, digits and . _ / - and must not start with a separator',
  })
  sku!: string;

  @ApiProperty({
    example: 'esp32-devkit-v1',
    description:
      'The PUBLIC URL identifier. Ask `GET /admin/catalog/slug-availability` first; that ' +
      'answer is advice, and the unique index is the authority — a race answers 409 ' +
      'DUPLICATE_SLUG.',
  })
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
  shortDescription?: LocalizedProseInputDto | null;

  @ApiPropertyOptional({ type: LocalizedProseInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedProseInputDto)
  description?: LocalizedProseInputDto | null;

  @ApiProperty({
    example: '652f1a9b3c4d5e6f7a8b9c0d',
    description:
      'REQUIRED. A product with no category cannot be browsed to — it exists only via search ' +
      'and a direct link, which is how legacy accumulated products nobody could find.',
  })
  @Matches(OBJECT_ID_PATTERN, { message: 'categoryId must be a 24-character hex id' })
  categoryId!: string;

  @ApiPropertyOptional({
    example: '652f1a9b3c4d5e6f7a8b9c0e',
    nullable: true,
    description: 'Optional. 53 of 85 live products have no brand.',
  })
  @IsOptional()
  @Matches(OBJECT_ID_PATTERN, { message: 'brandId must be a 24-character hex id' })
  brandId?: string | null;

  @ApiProperty({ example: 15000, description: `List price. ${MONEY_MESSAGE}` })
  @Type(() => Number)
  @IsInt({ message: `basePrice ${MONEY_MESSAGE}` })
  @Min(1, { message: 'basePrice must be greater than zero' })
  basePrice!: number;

  @ApiPropertyOptional({
    example: 12900,
    nullable: true,
    description:
      `The sale price, or null for no sale. ${MONEY_MESSAGE}. Must be strictly less than ` +
      '`basePrice` (§5) — a "sale" at or above list is a pricing error the customer sees as a lie.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: `salePrice ${MONEY_MESSAGE}` })
  @Min(1, { message: 'salePrice must be greater than zero' })
  salePrice?: number | null;

  @ApiPropertyOptional({
    example: 9800,
    nullable: true,
    description: `ADMIN ONLY — never appears in a public DTO. ${MONEY_MESSAGE}`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: `costPrice ${MONEY_MESSAGE}` })
  @Min(0)
  costPrice?: number | null;

  @ApiPropertyOptional({
    type: [ProductSpecInputDto],
    description: 'Replaces the whole array when supplied. Bounded at 40.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40, { message: 'a product may carry at most 40 specs' })
  @ValidateNested({ each: true })
  @Type(() => ProductSpecInputDto)
  specs?: ProductSpecInputDto[];

  @ApiPropertyOptional({ type: ProductSeoInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductSeoInputDto)
  seo?: ProductSeoInputDto | null;

  @ApiPropertyOptional({ example: 12, nullable: true, description: 'Grams.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'weight must be a whole number of grams' })
  @Min(0)
  weight?: number | null;

  @ApiPropertyOptional({ type: ProductDimensionsInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductDimensionsInputDto)
  dimensions?: ProductDimensionsInputDto | null;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description:
      'Whether the product is publicly visible. **Defaults to FALSE on create**, unlike the ' +
      'schema default: a product created through this endpoint has no images and no stock yet, ' +
      'and publishing it the instant it is named puts a bare row in front of customers. ' +
      'Publishing is a separate, audited action.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}

/**
 * A partial update. Every field optional; an ABSENT key means "leave it".
 *
 * Deliberately NOT `PartialType(CreateProductDto)`. Two fields differ in kind
 * rather than in optionality, and generating this would get both wrong:
 *
 *   `sku`      immutable after creation (§2), so it must not appear at all.
 *              Generated, it would appear and be silently accepted.
 *   `isActive` publishing is its own audited action with its own audit code
 *              (`PRODUCT_PUBLISHED` / `PRODUCT_UNPUBLISHED`), so a field that
 *              could flip visibility inside a general edit would record the
 *              wrong thing in the trail.
 */
export class UpdateProductDto {
  @ApiPropertyOptional({
    description:
      'Renaming the slug WRITES A REDIRECT: the old slug is recorded in `slugRedirects` and ' +
      'the public product route answers 301 for it thereafter (CATALOG-MODEL.md §2 rules 3–5).',
  })
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
  shortDescription?: LocalizedProseInputDto | null;

  @ApiPropertyOptional({ type: LocalizedProseInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedProseInputDto)
  description?: LocalizedProseInputDto | null;

  @ApiPropertyOptional({ example: '652f1a9b3c4d5e6f7a8b9c0d' })
  @IsOptional()
  @Matches(OBJECT_ID_PATTERN, { message: 'categoryId must be a 24-character hex id' })
  categoryId?: string;

  @ApiPropertyOptional({ example: null, nullable: true, description: 'null CLEARS the brand.' })
  @IsOptional()
  @Matches(OBJECT_ID_PATTERN, { message: 'brandId must be a 24-character hex id' })
  brandId?: string | null;

  @ApiPropertyOptional({ example: 15000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: `basePrice ${MONEY_MESSAGE}` })
  @Min(1, { message: 'basePrice must be greater than zero' })
  basePrice?: number;

  @ApiPropertyOptional({ example: 12900, nullable: true, description: 'null ENDS the sale.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: `salePrice ${MONEY_MESSAGE}` })
  @Min(1, { message: 'salePrice must be greater than zero' })
  salePrice?: number | null;

  @ApiPropertyOptional({ example: 9800, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: `costPrice ${MONEY_MESSAGE}` })
  @Min(0)
  costPrice?: number | null;

  @ApiPropertyOptional({ type: [ProductSpecInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40, { message: 'a product may carry at most 40 specs' })
  @ValidateNested({ each: true })
  @Type(() => ProductSpecInputDto)
  specs?: ProductSpecInputDto[];

  @ApiPropertyOptional({ type: ProductSeoInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductSeoInputDto)
  seo?: ProductSeoInputDto | null;

  @ApiPropertyOptional({ example: 12, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'weight must be a whole number of grams' })
  @Min(0)
  weight?: number | null;

  @ApiPropertyOptional({ type: ProductDimensionsInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductDimensionsInputDto)
  dimensions?: ProductDimensionsInputDto | null;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}

/** What an admin list can be ordered by. Narrow on purpose. */
export enum AdminProductSort {
  NEWEST = 'newest',
  OLDEST = 'oldest',
  NAME_ASC = 'name_asc',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  STOCK_ASC = 'stock_asc',
  UPDATED = 'updated',
}

/** The three states §9 defines, named so a query can ask for one. */
export enum AdminProductState {
  /** `isActive: true, deletedAt: null` — publicly visible. */
  PUBLISHED = 'published',
  /** `isActive: false, deletedAt: null` — a draft, or unlisted. */
  DRAFT = 'draft',
  /** `deletedAt` set. */
  DELETED = 'deleted',
}

function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === '1' || value === true) return true;
  if (value === 'false' || value === '0' || value === false) return false;
  return value;
}

/**
 * The admin catalogue listing query.
 *
 * ## Why the default EXCLUDES soft-deleted products
 *
 * §9 makes soft delete recoverable, and a recoverable thing has to be findable
 * — so `?state=deleted` exists. But an operator opening the catalogue is
 * looking at what they sell; mixing deleted rows into that view by default is
 * how somebody edits a product that no customer can see and does not notice for
 * a week. Absent `state`, deleted products are omitted and drafts are included,
 * because a draft is work in progress and is exactly what the screen is for.
 */
export class AdminProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'esp32',
    maxLength: 100,
    description:
      'Matches SKU, slug and English name, case-insensitively. ESCAPED before it reaches the ' +
      'database — no character in it can mean anything to a query expression.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @ApiPropertyOptional({ enum: AdminProductState })
  @IsOptional()
  @IsEnum(AdminProductState, {
    message: `state must be one of: ${Object.values(AdminProductState).join(', ')}`,
  })
  state?: AdminProductState;

  @ApiPropertyOptional({ example: '652f1a9b3c4d5e6f7a8b9c0d', description: 'Exact category, not the subtree.' })
  @IsOptional()
  @Matches(OBJECT_ID_PATTERN, { message: 'categoryId must be a 24-character hex id' })
  categoryId?: string;

  @ApiPropertyOptional({ example: '652f1a9b3c4d5e6f7a8b9c0e' })
  @IsOptional()
  @Matches(OBJECT_ID_PATTERN, { message: 'brandId must be a 24-character hex id' })
  brandId?: string;

  @ApiPropertyOptional({ example: true, description: 'Only products at or below their low-stock threshold.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'lowStock must be true or false' })
  lowStock?: boolean;

  @ApiPropertyOptional({ enum: AdminProductSort, default: AdminProductSort.UPDATED })
  @IsOptional()
  @IsEnum(AdminProductSort, {
    message: `sort must be one of: ${Object.values(AdminProductSort).join(', ')}`,
  })
  sort?: AdminProductSort;
}
