import { ApiProperty } from '@nestjs/swagger';
import { MoneyDto } from '../../../../common/dto/money.dto';
import { PaginationMetaDto } from '../../../../common/dto/pagination-meta.dto';
import { resolveOptionalText, resolveText, type Locale } from '../../../../common/localization/locale';
import type {
  PriceRange,
  PublicProductCard,
  PublicProductDetail,
  SpecFacet,
  TermFacet,
} from '../../infrastructure/repositories/product.repository';

/**
 * Stock state as a single enum, so no client re-implements the threshold rule.
 * `available = stock.onHand` — there is no `reserved` term; reservations were
 * removed (INVENTORY-MODEL.md §2).
 */
export enum Availability {
  IN_STOCK = 'IN_STOCK',
  LOW_STOCK = 'LOW_STOCK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}

/**
 * A managed image reference.
 *
 * `publicId` + `version`, never a URL — MEDIA-MODEL.md §3. The delivery URL is
 * derived at read time once MediaModule and its storage provider exist; until
 * then a client renders the placeholder it must already have, because 74% of
 * live products legitimately have no image at all.
 *
 * `width`/`height` are present specifically so a client can reserve layout space
 * before the image loads. Legacy stored neither, guaranteeing layout shift.
 */
export class ProductImageDto {
  @ApiProperty({ example: 'nest/products/652f1a9b3c4d5e6f7a8b9c0d/main-a1b2c3' })
  publicId!: string;

  @ApiProperty({ example: 1712345678, description: 'Busts CDN caches deterministically.' })
  version!: number;

  @ApiProperty({ example: 'webp' })
  format!: string;

  @ApiProperty({ example: 1200 })
  width!: number;

  @ApiProperty({ example: 1200 })
  height!: number;

  @ApiProperty({ example: 'ESP32 DevKit V1 front view', nullable: true, type: String })
  alt!: string | null;

  static from(image: {
    publicId: string;
    version: number;
    format: string;
    width: number;
    height: number;
    alt: string | null;
  }): ProductImageDto {
    return {
      publicId: image.publicId,
      version: image.version,
      format: image.format,
      width: image.width,
      height: image.height,
      alt: image.alt,
    };
  }
}

export class ProductPricingDto {
  @ApiProperty({ type: MoneyDto })
  basePrice!: MoneyDto;

  @ApiProperty({ type: MoneyDto, nullable: true })
  salePrice!: MoneyDto | null;

  @ApiProperty({
    type: MoneyDto,
    description: 'salePrice ?? basePrice. THE price charged at checkout. Never compute this client-side.',
  })
  effectivePrice!: MoneyDto;

  @ApiProperty({
    example: 1385,
    description: 'Discount in basis points (1385 = 13.85%). 0 when there is no sale price.',
  })
  discountPercentBps!: number;

  static from(
    pricing: { basePrice: number; salePrice: number | null; effectivePrice: number },
    currency: string,
  ): ProductPricingDto {
    const { basePrice, salePrice, effectivePrice } = pricing;

    return {
      basePrice: MoneyDto.of(basePrice, currency),
      salePrice: salePrice === null ? null : MoneyDto.of(salePrice, currency),
      effectivePrice: MoneyDto.of(effectivePrice, currency),
      // Integer arithmetic throughout: no float ever touches a money value.
      discountPercentBps:
        salePrice === null || basePrice <= 0
          ? 0
          : Math.round(((basePrice - salePrice) * 10000) / basePrice),
    };
  }
}

export class ProductRatingDto {
  @ApiProperty({
    example: 4.3,
    description: 'Mean score, 0–5, one decimal. 0 when there are no reviews yet.',
  })
  average!: number;

  @ApiProperty({ example: 12 })
  count!: number;

  static from(rating: { average: number; count: number }): ProductRatingDto {
    // Stored in hundredths (430 = 4.30) so it sorts as an integer.
    return { average: Math.round(rating.average) / 100, count: rating.count };
  }
}

export class ProductSpecDto {
  @ApiProperty({ example: 'operating-voltage' })
  key!: string;

  @ApiProperty({ example: 'Operating Voltage' })
  label!: string;

  @ApiProperty({ example: '3.3' })
  value!: string;

  @ApiProperty({ example: 'V', nullable: true, type: String })
  unit!: string | null;

  @ApiProperty({ example: true, description: 'Whether this spec appears as a search facet.' })
  filterable!: boolean;
}

export class CategoryRefDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' })
  id!: string;

  @ApiProperty({ example: 'microcontrollers' })
  slug!: string;

  @ApiProperty({ example: 'Microcontrollers' })
  name!: string;
}

export class BrandRefDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0e' })
  id!: string;

  @ApiProperty({ example: 'espressif' })
  slug!: string;

  @ApiProperty({ example: 'Espressif' })
  name!: string;
}

function availabilityOf(stock: { onHand: number; lowStockThreshold: number }): Availability {
  if (stock.onHand <= 0) {
    return Availability.OUT_OF_STOCK;
  }
  return stock.onHand <= stock.lowStockThreshold ? Availability.LOW_STOCK : Availability.IN_STOCK;
}

function primaryImageOf(images: PublicProductCard['images']): ProductImageDto | null {
  if (images.length === 0) {
    return null;
  }

  const primary =
    images.find((image) => image.isPrimary) ??
    [...images].sort((a, b) => a.sortOrder - b.sortOrder)[0];

  return primary === undefined ? null : ProductImageDto.from(primary);
}

/**
 * A product as it appears in a grid.
 *
 * Carries the primary image, brand, category and rating — closing legacy search
 * failure 4, where the RPC returned 12 scalar columns and no join, so grids
 * rendered brand-less and image-less.
 *
 * `costPrice`, raw `stock` numbers and internal flags are absent BY
 * CONSTRUCTION. Audience separation here is structural, not a runtime strip:
 * the guarantee depends on the field not existing, not on a decorator being
 * remembered (DTO-STRATEGY.md §6).
 */
export class ProductListItemDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' })
  id!: string;

  @ApiProperty({ example: 'esp32-devkit-v1', description: 'Public identifier. Use for /products/{slug}.' })
  slug!: string;

  @ApiProperty({ example: 'ESP32-DEVKIT-V1', description: 'Warehouse/part identifier. Also searchable.' })
  sku!: string;

  @ApiProperty({ example: 'ESP32 DevKit V1' })
  name!: string;

  @ApiProperty({ example: 'Wi-Fi + Bluetooth development board', nullable: true, type: String })
  shortDescription!: string | null;

  @ApiProperty({ type: CategoryRefDto })
  category!: CategoryRefDto;

  @ApiProperty({ type: BrandRefDto, nullable: true, description: 'Null for 53 of 85 live products — always render without one.' })
  brand!: BrandRefDto | null;

  @ApiProperty({ type: ProductPricingDto })
  pricing!: ProductPricingDto;

  @ApiProperty({ type: ProductImageDto, nullable: true })
  primaryImage!: ProductImageDto | null;

  @ApiProperty({ type: ProductRatingDto })
  rating!: ProductRatingDto;

  @ApiProperty({ enum: Availability, example: Availability.IN_STOCK })
  availability!: Availability;

  @ApiProperty({ example: false })
  isFeatured!: boolean;

  static from(product: PublicProductCard, locale: Locale): ProductListItemDto {
    return {
      id: product._id.toHexString(),
      slug: product.slug,
      sku: product.sku,
      name: resolveText(product.name, locale),
      shortDescription: resolveOptionalText(product.shortDescription, locale),
      category: {
        id: product.category.id.toHexString(),
        slug: product.category.slug,
        name: resolveText(product.category.name, locale),
      },
      brand:
        product.brand === null
          ? null
          : {
              id: product.brand.id.toHexString(),
              slug: product.brand.slug,
              name: resolveText(product.brand.name, locale),
            },
      pricing: ProductPricingDto.from(product.pricing, product.currency),
      primaryImage: primaryImageOf(product.images),
      rating: ProductRatingDto.from(product.rating),
      availability: availabilityOf(product.stock),
      isFeatured: product.isFeatured,
    };
  }

  static fromList(products: readonly PublicProductCard[], locale: Locale): ProductListItemDto[] {
    return products.map((product) => ProductListItemDto.from(product, locale));
  }
}

/** Product detail: everything in a card, plus the long copy, all images and the specs. */
export class ProductDetailDto extends ProductListItemDto {
  @ApiProperty({ example: 'The ESP32 DevKit V1 is a…', nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ type: [ProductImageDto] })
  images!: ProductImageDto[];

  @ApiProperty({ type: [ProductSpecDto] })
  specs!: ProductSpecDto[];

  @ApiProperty({ example: 12, description: 'Units on hand. 0 means out of stock.' })
  stockOnHand!: number;

  @ApiProperty({ example: 37, description: 'Units sold to date.' })
  salesCount!: number;

  // Required AND nullable, not optional: API-CONTRACT.md §1 — "optional fields
  // are null, not omitted", so a generated Dart model has one stable shape.
  @ApiProperty({ example: 25, nullable: true, type: Number, description: 'Grams.' })
  weight!: number | null;

  @ApiProperty({ example: '2026-08-30T14:22:31.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-08-30T14:22:31.000Z', format: 'date-time' })
  updatedAt!: string;

  static fromProduct(product: PublicProductDetail, locale: Locale): ProductDetailDto {
    return {
      ...ProductListItemDto.from(product, locale),
      description: resolveOptionalText(product.description, locale),
      images: [...product.images]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((image) => ProductImageDto.from(image)),
      specs: [...product.specs]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((spec) => ({
          key: spec.key,
          label: spec.label,
          value: spec.value,
          unit: spec.unit,
          filterable: spec.filterable,
        })),
      stockOnHand: product.stock.onHand,
      salesCount: product.salesCount,
      weight: product.weight,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }
}

/** A lightweight autocomplete row. */
export class ProductSuggestionDto {
  @ApiProperty({ example: 'esp32-devkit-v1' })
  slug!: string;

  @ApiProperty({ example: 'ESP32 DevKit V1' })
  name!: string;

  @ApiProperty({ example: 'ESP32-DEVKIT-V1' })
  sku!: string;

  @ApiProperty({ type: ProductImageDto, nullable: true })
  primaryImage!: ProductImageDto | null;

  static from(product: PublicProductCard, locale: Locale): ProductSuggestionDto {
    return {
      slug: product.slug,
      name: resolveText(product.name, locale),
      sku: product.sku,
      primaryImage: primaryImageOf(product.images),
    };
  }
}

// --- Facets ----------------------------------------------------------------

export class TermFacetDto {
  @ApiProperty({ example: 'microcontrollers' })
  slug!: string;

  @ApiProperty({ example: 'Microcontrollers' })
  name!: string;

  @ApiProperty({ example: 42 })
  count!: number;

  static fromList(facets: readonly TermFacet[], locale: Locale): TermFacetDto[] {
    return facets.map((facet) => ({
      slug: facet.slug,
      name: resolveText(facet.name, locale),
      count: facet.count,
    }));
  }
}

export class SpecFacetValueDto {
  @ApiProperty({ example: '3.3' })
  value!: string;

  @ApiProperty({ example: 31 })
  count!: number;
}

export class SpecFacetDto {
  @ApiProperty({ example: 'operating-voltage' })
  key!: string;

  @ApiProperty({ example: 'Operating Voltage' })
  label!: string;

  @ApiProperty({ type: [SpecFacetValueDto] })
  values!: SpecFacetValueDto[];

  static fromList(facets: readonly SpecFacet[]): SpecFacetDto[] {
    return facets.map((facet) => ({
      key: facet.key,
      label: facet.label,
      values: facet.values.map((value) => ({ value: value.value, count: value.count })),
    }));
  }
}

export class PriceRangeDto {
  @ApiProperty({ type: MoneyDto })
  min!: MoneyDto;

  @ApiProperty({ type: MoneyDto })
  max!: MoneyDto;

  static from(range: PriceRange | null, currency: string): PriceRangeDto | null {
    return range === null
      ? null
      : { min: MoneyDto.of(range.min, currency), max: MoneyDto.of(range.max, currency) };
  }
}

/**
 * Facets computed SERVER-SIDE over the whole filtered result set, never derived
 * from the current page — closing legacy failure 7.
 */
export class ProductFacetsDto {
  @ApiProperty({ type: [TermFacetDto] })
  categories!: TermFacetDto[];

  @ApiProperty({ type: [TermFacetDto] })
  brands!: TermFacetDto[];

  @ApiProperty({ type: PriceRangeDto, nullable: true, description: 'Null when nothing matched.' })
  priceRange!: PriceRangeDto | null;

  @ApiProperty({ type: [SpecFacetDto] })
  specs!: SpecFacetDto[];
}

// --- Envelopes -------------------------------------------------------------
// Declared as concrete classes rather than a generic, so the OpenAPI document
// carries named schemas and the generated Dart models are stable.

export class ProductListResponseDto {
  @ApiProperty({ type: [ProductListItemDto] })
  data!: ProductListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;

  @ApiProperty({ type: ProductFacetsDto })
  facets!: ProductFacetsDto;
}

export class ProductDetailResponseDto {
  @ApiProperty({ type: ProductDetailDto })
  data!: ProductDetailDto;
}

export class ProductSuggestionListResponseDto {
  @ApiProperty({ type: [ProductSuggestionDto] })
  data!: ProductSuggestionDto[];
}

export class RelatedProductListResponseDto {
  @ApiProperty({ type: [ProductListItemDto] })
  data!: ProductListItemDto[];
}

/**
 * The body of a `301` from `GET /products/:slug`.
 *
 * A redirect's meaning is in its `Location` header, and every browser and HTTP
 * client follows it. This body exists for the ones that do not — a Dart client
 * configured with `followRedirects: false`, or a server-side fetch that wants
 * to issue its OWN 301 to the customer rather than proxying the target. Without
 * it those callers would have to parse a header to learn a slug the API
 * already knows.
 */
export class ProductMovedDto {
  @ApiProperty({
    example: 'esp32-devkit-v1',
    description: 'The slug this product now lives at.',
  })
  movedTo!: string;
}

export class ProductMovedResponseDto {
  @ApiProperty({ type: ProductMovedDto })
  data!: ProductMovedDto;
}
