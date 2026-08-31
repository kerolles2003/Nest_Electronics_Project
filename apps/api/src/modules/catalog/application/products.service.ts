import { Injectable } from '@nestjs/common';
import type { ClientSession, Types } from 'mongoose';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../../../common/dto/pagination-query.dto';
import { AppException } from '../../../common/errors/app.exception';
import {
  PRODUCT_SORT_VALUES,
  ProductQueryDto,
  ProductSort,
} from '../presentation/dto/product-query.dto';
import {
  ProductRepository,
  type ProductSearchCriteria,
  type ProductSearchResult,
  type PublicProductCard,
  type PublicProductDetail,
} from '../infrastructure/repositories/product.repository';
import type { LocalizedTextValue } from '../../../common/localization/locale';
import { BrandsService } from './brands.service';
import { CategoriesService } from './categories.service';

/** Autocomplete returns at most this many rows. */
const SUGGEST_LIMIT = 8;
/** Related products returned per product detail page. */
const RELATED_LIMIT = 8;

/**
 * The authoritative purchasing view of a product.
 *
 * This is the contract other modules buy against. It is a PLAIN DOMAIN SHAPE,
 * not a Mongoose document and not an HTTP DTO — CODEBASE-STRUCTURE.md §6.3 —
 * so the cart (and later checkout) never has to scrape a response DTO or reach
 * into the catalogue's persistence.
 *
 * `purchasable` collapses `isActive && deletedAt === null` into the single
 * question a caller actually asks, so no caller re-implements the visibility
 * rule and gets it subtly wrong.
 */
export interface PurchasableProduct {
  readonly productId: Types.ObjectId;
  readonly sku: string;
  readonly slug: string;
  readonly name: LocalizedTextValue;
  readonly currency: string;
  readonly basePrice: number;
  readonly salePrice: number | null;
  /** `salePrice ?? basePrice`, maintained by the catalogue. THE price to charge. */
  readonly effectivePrice: number;
  readonly onHand: number;
  readonly purchasable: boolean;
  readonly primaryImagePublicId: string | null;
  /**
   * Snapshotted onto an order line so a rebranded or deleted brand cannot
   * rewrite what a past order says it sold. Null for the 53 of 85 live products
   * that have no brand.
   */
  readonly brandName: string | null;
}

export interface ProductSearchOutcome {
  readonly result: ProductSearchResult;
  readonly page: number;
  readonly limit: number;
}

/**
 * Public product reads.
 *
 * The service answers "is this allowed right now?"; the DTO already answered
 * "is this well-formed?". Neither substitutes for the other — DTO-STRATEGY.md §5.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoriesService,
    private readonly brands: BrandsService,
  ) {}

  /**
   * Resolves the sort parameter against the allow-list.
   *
   * Default is `relevance` with `q` and `newest` without it. Requesting
   * `relevance` without `q` is NOT an error — it falls back to `newest`
   * (SEARCH-MODEL.md §5). Anything outside the allow-list is 400
   * UNSUPPORTED_SORT rather than a silent default, so a client bug surfaces.
   */
  private static resolveSort(requested: string | undefined, text: string | undefined): ProductSort {
    if (requested === undefined) {
      return text !== undefined && text.length > 0 ? ProductSort.RELEVANCE : ProductSort.NEWEST;
    }

    if (!PRODUCT_SORT_VALUES.includes(requested)) {
      throw AppException.unsupportedSort(PRODUCT_SORT_VALUES);
    }

    return requested as ProductSort;
  }

  /** `key:value` pairs to `key -> values`. AND across keys, OR within a key. */
  private static parseSpecs(entries: readonly string[] | undefined): Map<string, string[]> {
    const specs = new Map<string, string[]>();

    for (const entry of entries ?? []) {
      const separator = entry.indexOf(':');
      const key = entry.slice(0, separator);
      const value = entry.slice(separator + 1);

      if (key.length === 0 || value.length === 0) {
        continue;
      }

      const existing = specs.get(key);
      if (existing === undefined) {
        specs.set(key, [value]);
      } else {
        existing.push(value);
      }
    }

    return specs;
  }

  async search(query: ProductQueryDto): Promise<ProductSearchOutcome> {
    const text = query.q?.trim();
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    if (query.minPrice !== undefined && query.maxPrice !== undefined && query.minPrice > query.maxPrice) {
      throw AppException.validation([
        { field: 'minPrice', message: 'minPrice must not exceed maxPrice', code: 'RANGE' },
      ]);
    }

    // A category page for an unknown slug is a 404, not an empty grid: the slug
    // identifies a page, so a typo must be visible rather than look like an
    // empty catalogue.
    let categoryId;
    if (query.category !== undefined) {
      const resolved = await this.categories.findIdBySlug(query.category);
      if (resolved === null) {
        throw AppException.categoryNotFound();
      }
      categoryId = resolved;
    }

    // Brands are a multi-select refinement, so an unknown slug simply
    // contributes no id and narrows the result set.
    const brandIds =
      query.brand === undefined ? undefined : await this.brands.findIdsBySlugs(query.brand);

    const specs = ProductsService.parseSpecs(query.spec);

    const criteria: ProductSearchCriteria = {
      ...(text !== undefined && text.length > 0 ? { text } : {}),
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(brandIds !== undefined ? { brandIds } : {}),
      ...(query.minPrice !== undefined ? { minPrice: query.minPrice } : {}),
      ...(query.maxPrice !== undefined ? { maxPrice: query.maxPrice } : {}),
      ...(query.inStock !== undefined ? { inStock: query.inStock } : {}),
      ...(query.featured !== undefined ? { featured: query.featured } : {}),
      ...(specs.size > 0 ? { specs } : {}),
      sort: ProductsService.resolveSort(query.sort, text),
      page,
      limit,
    };

    return { result: await this.products.search(criteria), page, limit };
  }

  async findBySlug(slug: string): Promise<PublicProductDetail> {
    const product = await this.products.findPublicBySlug(slug);

    if (product === null) {
      // Inactive and soft-deleted products are indistinguishable from absent
      // ones here, deliberately: an id must never become an existence oracle.
      throw AppException.productNotFound();
    }

    return product;
  }

  async findRelated(slug: string): Promise<readonly PublicProductCard[]> {
    const product = await this.findBySlug(slug);

    return this.products.findRelated(product.category.id, product._id, RELATED_LIMIT);
  }

  async suggest(term: string): Promise<readonly PublicProductCard[]> {
    const trimmed = term.trim();

    return trimmed.length === 0 ? [] : this.products.suggest(trimmed, SUGGEST_LIMIT);
  }

  /**
   * The authoritative state of several products at once, keyed by id.
   *
   * ONE database round trip for an entire cart. Unknown ids are simply absent
   * from the map, which is what lets a caller distinguish "product was deleted
   * outright" from "product is delisted".
   *
   * Unlike every other method here, this returns inactive and soft-deleted
   * products — flagged `purchasable: false` rather than hidden. See
   * `ProductRepository.findByIdsForCart`.
   */
  async findPurchasableByIds(
    ids: readonly Types.ObjectId[],
    session?: ClientSession,
  ): Promise<Map<string, PurchasableProduct>> {
    const rows = await this.products.findByIdsForCart(ids, session);

    return new Map(
      rows.map((row) => {
        const primary =
          row.images.find((image) => image.isPrimary) ??
          [...row.images].sort((a, b) => a.sortOrder - b.sortOrder)[0];

        return [
          row._id.toHexString(),
          {
            productId: row._id,
            sku: row.sku,
            slug: row.slug,
            name: row.name,
            currency: row.currency,
            basePrice: row.pricing.basePrice,
            salePrice: row.pricing.salePrice,
            effectivePrice: row.pricing.effectivePrice,
            onHand: row.stock.onHand,
            purchasable: row.isActive && row.deletedAt === null,
            primaryImagePublicId: primary?.publicId ?? null,
            brandName: row.brand?.name.en ?? null,
          },
        ];
      }),
    );
  }
}
