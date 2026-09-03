import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../../common/dto/pagination-meta.dto';
import type { ProductLean } from '../../infrastructure/schemas/product.schema';

/**
 * The ADMIN view of a product.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §5 — "`costPrice` … must never
 * appear in a public DTO — enforced by separate `ProductPublicDto` /
 * `ProductAdminDto` types, not by field-stripping at runtime."
 *
 * This is that second type. The separation is the enforcement: `costPrice`,
 * `deletedAt` and the raw `{ en, ar }` pairs exist on this class and on no
 * public one, so there is no code path — no serializer option, no forgotten
 * `select`, no `toJSON` override — by which a margin reaches a customer.
 *
 * ## Why the text is NOT locale-resolved here
 *
 * Public DTOs collapse `{ en, ar }` to one string for the requested locale.
 * An editor must see and set both, and a form bound to a resolved string would
 * write the resolved value back into whichever field the locale happened to
 * pick — quietly overwriting the Arabic name with the English one for any
 * operator whose browser asked for English.
 */

export class AdminLocalizedTextDto {
  @ApiProperty({ example: 'ESP32 DevKit V1' })
  en!: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  ar!: string | null;

  static from(text: { en: string; ar: string | null } | null): AdminLocalizedTextDto | null {
    return text === null ? null : { en: text.en, ar: text.ar };
  }
}

export class AdminSnapshotRefDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' })
  id!: string;

  @ApiProperty({ example: 'microcontrollers' })
  slug!: string;

  @ApiProperty({ type: AdminLocalizedTextDto })
  name!: AdminLocalizedTextDto;
}

export class AdminProductSpecDto {
  @ApiProperty({ example: 'operating-voltage' }) key!: string;
  @ApiProperty({ example: 'Operating voltage' }) label!: string;
  @ApiProperty({ example: '3.3' }) value!: string;
  @ApiProperty({ example: 'V', nullable: true, type: String }) unit!: string | null;
  @ApiProperty({ example: true }) filterable!: boolean;
  @ApiProperty({ example: 0 }) sortOrder!: number;
}

export class AdminProductImageDto {
  @ApiProperty({ example: 'nest/products/652f1a9b3c4d5e6f7a8b9c0d/a1b2c3' }) publicId!: string;
  @ApiProperty({ example: 1 }) version!: number;
  @ApiProperty({ example: 'webp' }) format!: string;
  @ApiProperty({ example: 1200 }) width!: number;
  @ApiProperty({ example: 1200 }) height!: number;
  @ApiProperty({ example: 184320 }) bytes!: number;
  @ApiProperty({ example: 'Front view', nullable: true, type: String }) alt!: string | null;
  @ApiProperty({ example: 0 }) sortOrder!: number;
  @ApiProperty({ example: true }) isPrimary!: boolean;
}

/**
 * Money as the integer it is stored as, NOT a `MoneyDto`.
 *
 * The public DTO formats money for display. An editor round-trips it: the value
 * this endpoint returns is the value the form posts back, and passing it
 * through a display format and back is where a currency string, a rounding rule
 * or a locale separator gets a chance to change the number.
 */
export class AdminProductPricingDto {
  @ApiProperty({ example: 15000, description: 'Minor units (piastres).' })
  basePrice!: number;

  @ApiProperty({ example: 12900, nullable: true, type: Number })
  salePrice!: number | null;

  @ApiProperty({
    example: 12900,
    description: 'MAINTAINED: `salePrice ?? basePrice`. Read-only — the write endpoints reject it.',
  })
  effectivePrice!: number;

  @ApiProperty({
    example: 9800,
    nullable: true,
    type: Number,
    description: 'ADMIN ONLY. Absent from every public DTO by construction.',
  })
  costPrice!: number | null;
}

export class AdminProductStockDto {
  @ApiProperty({
    example: 42,
    description: 'Read-only here. Stock moves only through the inventory endpoints, which ledger it.',
  })
  onHand!: number;

  @ApiProperty({ example: 5 })
  lowStockThreshold!: number;
}

export class AdminProductDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' }) id!: string;
  @ApiProperty({ example: 'ESP32-WROOM-32' }) sku!: string;
  @ApiProperty({ example: 'esp32-devkit-v1' }) slug!: string;
  @ApiProperty({ type: AdminLocalizedTextDto }) name!: AdminLocalizedTextDto;

  @ApiProperty({ type: AdminLocalizedTextDto, nullable: true })
  shortDescription!: AdminLocalizedTextDto | null;

  @ApiProperty({ type: AdminLocalizedTextDto, nullable: true })
  description!: AdminLocalizedTextDto | null;

  @ApiProperty({ type: AdminSnapshotRefDto }) category!: AdminSnapshotRefDto;
  @ApiProperty({ type: AdminSnapshotRefDto, nullable: true }) brand!: AdminSnapshotRefDto | null;
  @ApiProperty({ type: AdminProductPricingDto }) pricing!: AdminProductPricingDto;
  @ApiProperty({ example: 'EGP' }) currency!: string;
  @ApiProperty({ type: AdminProductStockDto }) stock!: AdminProductStockDto;
  @ApiProperty({ type: [AdminProductImageDto] }) images!: AdminProductImageDto[];
  @ApiProperty({ type: [AdminProductSpecDto] }) specs!: AdminProductSpecDto[];

  @ApiProperty({ example: 4.3, description: 'Read-only. Written by ReviewsModule.' })
  ratingAverage!: number;

  @ApiProperty({ example: 12 }) ratingCount!: number;

  @ApiProperty({ example: 71, description: 'Read-only. Written by OrdersModule.' })
  salesCount!: number;

  @ApiProperty({ example: true, description: 'Publicly visible. Changed only by publish/unpublish.' })
  isActive!: boolean;

  @ApiProperty({ example: false }) isFeatured!: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Soft-delete timestamp, ISO-8601. Non-null means hidden everywhere public.',
  })
  deletedAt!: string | null;

  @ApiPropertyOptional({ example: 'Optimised for search', nullable: true, type: String })
  seoTitle!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  seoDescription!: string | null;

  @ApiProperty({ example: 12, nullable: true, type: Number, description: 'Grams.' })
  weight!: number | null;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'Millimetres.',
    example: { length: 55, width: 28, height: 13 },
  })
  dimensions!: { length: number; width: number; height: number } | null;

  @ApiProperty({ example: '2026-09-03T09:14:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: '2026-09-03T09:14:00.000Z' }) updatedAt!: string;

  static from(product: ProductLean): AdminProductDto {
    return {
      id: product._id.toHexString(),
      sku: product.sku,
      slug: product.slug,
      name: { en: product.name.en, ar: product.name.ar },
      shortDescription: AdminLocalizedTextDto.from(product.shortDescription),
      description: AdminLocalizedTextDto.from(product.description),
      category: {
        id: product.category.id.toHexString(),
        slug: product.category.slug,
        name: { en: product.category.name.en, ar: product.category.name.ar },
      },
      brand:
        product.brand === null
          ? null
          : {
              id: product.brand.id.toHexString(),
              slug: product.brand.slug,
              name: { en: product.brand.name.en, ar: product.brand.name.ar },
            },
      pricing: {
        basePrice: product.pricing.basePrice,
        salePrice: product.pricing.salePrice,
        effectivePrice: product.pricing.effectivePrice,
        costPrice: product.pricing.costPrice,
      },
      currency: product.currency,
      stock: { onHand: product.stock.onHand, lowStockThreshold: product.stock.lowStockThreshold },
      images: product.images.map((image) => ({
        publicId: image.publicId,
        version: image.version,
        format: image.format,
        width: image.width,
        height: image.height,
        bytes: image.bytes,
        alt: image.alt,
        sortOrder: image.sortOrder,
        isPrimary: image.isPrimary,
      })),
      specs: product.specs.map((spec) => ({
        key: spec.key,
        label: spec.label,
        value: spec.value,
        unit: spec.unit,
        filterable: spec.filterable,
        sortOrder: spec.sortOrder,
      })),
      // Stored in hundredths, shown as the number a person reads. Divided at
      // the boundary, never in the database, so the no-floats rule holds
      // everywhere a value is compared or sorted.
      ratingAverage: product.rating.average / 100,
      ratingCount: product.rating.count,
      salesCount: product.salesCount,
      isActive: product.isActive,
      isFeatured: product.isFeatured,
      deletedAt: product.deletedAt === null ? null : product.deletedAt.toISOString(),
      seoTitle: product.seo?.title ?? null,
      seoDescription: product.seo?.description ?? null,
      weight: product.weight,
      dimensions:
        product.dimensions === null
          ? null
          : {
              length: product.dimensions.length,
              width: product.dimensions.width,
              height: product.dimensions.height,
            },
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }
}

export class AdminProductResponseDto {
  @ApiProperty({ type: AdminProductDto })
  data!: AdminProductDto;
}

export class AdminProductListResponseDto {
  @ApiProperty({ type: [AdminProductDto] })
  data!: AdminProductDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
