import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';
import type { ClientSession } from 'mongoose';
import { LocalizedTextValue } from '../../../../common/localization/locale';
import { ProductSort } from '../../presentation/dto/product-query.dto';
import { Product, ProductLean } from '../schemas/product.schema';

/** Money a public consumer may see. `costPrice` is deliberately not a member. */
export interface PublicPricing {
  readonly basePrice: number;
  readonly salePrice: number | null;
  readonly effectivePrice: number;
}

/**
 * A product as returned to the application layer. Plain object, never a
 * hydrated Mongoose document, and `pricing.costPrice` is projected away AT THE
 * DATABASE rather than stripped later.
 *
 * Authority: docs/architecture/CODEBASE-STRUCTURE.md §6.3 — a Mongoose document
 * must never leave its owning module.
 *
 * Card and detail are separate types because they are separate projections:
 * a grid never loads long-form descriptions or the full spec array, and the
 * type says so rather than lying about which fields are present.
 */
export type PublicProductCard = Pick<
  ProductLean,
  | '_id'
  | 'sku'
  | 'slug'
  | 'name'
  | 'shortDescription'
  | 'brand'
  | 'category'
  | 'currency'
  | 'stock'
  | 'images'
  | 'rating'
  | 'salesCount'
  | 'isFeatured'
  | 'createdAt'
  | 'updatedAt'
> & { pricing: PublicPricing };

export type PublicProductDetail = PublicProductCard &
  Pick<ProductLean, 'description' | 'specs' | 'weight' | 'dimensions'>;

/**
 * A product as the cart needs to see it — INCLUDING inactive and soft-deleted
 * ones, which is the whole reason it is a separate shape.
 *
 * Every other read in this repository hides them. The cart must not: a line
 * whose product was delisted has to come back marked UNAVAILABLE, because
 * CART-MODEL.md §5 requires the customer to see WHY their total changed rather
 * than watch a line vanish. `costPrice` is still projected away.
 */
export type CartProductRow = PublicProductCard & Pick<ProductLean, 'isActive' | 'deletedAt'>;

export interface ProductSearchCriteria {
  readonly text?: string;
  readonly categoryId?: Types.ObjectId;
  readonly brandIds?: readonly Types.ObjectId[];
  readonly minPrice?: number;
  readonly maxPrice?: number;
  readonly inStock?: boolean;
  readonly featured?: boolean;
  /** key -> accepted values. AND across keys, OR within a key. */
  readonly specs?: ReadonlyMap<string, readonly string[]>;
  readonly sort: ProductSort;
  readonly page: number;
  readonly limit: number;
}

export interface TermFacet {
  readonly slug: string;
  readonly name: LocalizedTextValue;
  readonly count: number;
}

export interface SpecFacetValue {
  readonly value: string;
  readonly count: number;
}

export interface SpecFacet {
  readonly key: string;
  readonly label: string;
  readonly values: readonly SpecFacetValue[];
}

export interface PriceRange {
  readonly min: number;
  readonly max: number;
}

export interface ProductSearchResult {
  readonly items: readonly PublicProductCard[];
  readonly total: number;
  readonly categories: readonly TermFacet[];
  readonly brands: readonly TermFacet[];
  readonly priceRange: PriceRange | null;
  readonly specs: readonly SpecFacet[];
}

/** Grid fields. `pricing.costPrice` is absent BY CONSTRUCTION. */
const CARD_PROJECTION: Record<string, 0 | 1> = {
  _id: 1,
  sku: 1,
  slug: 1,
  name: 1,
  shortDescription: 1,
  brand: 1,
  category: 1,
  'pricing.basePrice': 1,
  'pricing.salePrice': 1,
  'pricing.effectivePrice': 1,
  currency: 1,
  'stock.onHand': 1,
  'stock.lowStockThreshold': 1,
  images: 1,
  rating: 1,
  salesCount: 1,
  isFeatured: 1,
  createdAt: 1,
  updatedAt: 1,
};

/** Detail adds the long-form copy, the full spec list and physical attributes. */
const DETAIL_PROJECTION: Record<string, 0 | 1> = {
  ...CARD_PROJECTION,
  description: 1,
  specs: 1,
  weight: 1,
  dimensions: 1,
};

/** Card fields plus the two visibility flags the cart reports on. */
const CART_PROJECTION: Record<string, 0 | 1> = {
  ...CARD_PROJECTION,
  isActive: 1,
  deletedAt: 1,
};

/** The maximum number of distinct terms returned per facet. */
const FACET_TERM_LIMIT = 60;

/** Escapes a user-supplied string for safe use inside a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface TermFacetRow {
  _id: { slug: string; name: LocalizedTextValue };
  count: number;
}

interface SpecFacetRow {
  _id: { key: string; label: string; value: string };
  count: number;
}

interface SearchAggregation {
  results: PublicProductCard[];
  total: { value: number }[];
  categories: TermFacetRow[];
  brands: TermFacetRow[];
  priceBounds: { min: number; max: number }[];
  specs: SpecFacetRow[];
}

/**
 * Every product query in the system.
 *
 * A repository is justified here — and ONLY here within the catalogue — by
 * CODEBASE-STRUCTURE.md §6.2: a Tier-2 module earns a concrete repository when
 * it has a complex query surface (faceted search, aggregation, subtree filters).
 * Categories and brands get none, because their access is trivial and a
 * repository there would be a one-line wrapper.
 *
 * The search ENGINE is confined to this file. SEARCH-MODEL.md §3 defers Atlas
 * Search behind explicit revisit triggers (>20k products, fuzzy matching,
 * autocomplete-as-you-type, Arabic); when one fires, the swap is this file, not
 * a rewrite of controllers or DTOs.
 */
@Injectable()
export class ProductRepository {
  constructor(@InjectModel(Product.name) private readonly model: Model<Product>) {}

  /**
   * The visibility filter, applied HERE rather than left to each caller.
   *
   * Authority: docs/architecture/CATALOG-MODEL.md §9 — "enforced in the
   * repository layer, not left to individual queries". Legacy relied on every
   * caller remembering, and inactive and soft-deleted products were publicly
   * readable and even purchasable as a result.
   */
  private static visible(): FilterQuery<Product> {
    return { isActive: true, deletedAt: null };
  }

  private static buildMatch(criteria: ProductSearchCriteria): FilterQuery<Product> {
    const match: FilterQuery<Product> = ProductRepository.visible();

    if (criteria.text !== undefined && criteria.text.length > 0) {
      match.$text = { $search: criteria.text };
    }

    // A single indexed match over the materialised ancestor chain. No
    // $graphLookup, no recursion at query time — and a parent category
    // therefore includes every descendant's products.
    if (criteria.categoryId !== undefined) {
      match['category.path'] = criteria.categoryId;
    }

    if (criteria.brandIds !== undefined && criteria.brandIds.length > 0) {
      match['brand.id'] = { $in: criteria.brandIds };
    }

    // Range on the MAINTAINED effective price, so the filter is indexable and
    // agrees with what checkout charges.
    const price: Record<string, number> = {};
    if (criteria.minPrice !== undefined) {
      price.$gte = criteria.minPrice;
    }
    if (criteria.maxPrice !== undefined) {
      price.$lte = criteria.maxPrice;
    }
    if (Object.keys(price).length > 0) {
      match['pricing.effectivePrice'] = price;
    }

    if (criteria.inStock === true) {
      match['stock.onHand'] = { $gt: 0 };
    }

    if (criteria.featured !== undefined) {
      match.isFeatured = criteria.featured;
    }

    // One $elemMatch per key: AND across keys, OR within a key.
    if (criteria.specs !== undefined && criteria.specs.size > 0) {
      match.$and = [...criteria.specs.entries()].map(([key, values]) => ({
        specs: { $elemMatch: { key, value: { $in: [...values] } } },
      }));
    }

    return match;
  }

  private static buildSort(criteria: ProductSearchCriteria): Record<string, 1 | -1> {
    const hasText = criteria.text !== undefined && criteria.text.length > 0;

    switch (criteria.sort) {
      case ProductSort.RELEVANCE:
        // Requesting relevance without `q` falls back to newest rather than
        // erroring — SEARCH-MODEL.md §5.
        return hasText
          ? { textScore: -1, isFeatured: -1, createdAt: -1, _id: -1 }
          : { createdAt: -1, _id: -1 };
      case ProductSort.PRICE_ASC:
        return { 'pricing.effectivePrice': 1, _id: 1 };
      case ProductSort.PRICE_DESC:
        return { 'pricing.effectivePrice': -1, _id: -1 };
      case ProductSort.RATING:
        // Count as a tiebreak, so one 5-star review does not outrank a
        // well-reviewed product.
        return { 'rating.average': -1, 'rating.count': -1, _id: -1 };
      case ProductSort.NAME_ASC:
        return { 'name.en': 1, _id: 1 };
      case ProductSort.NEWEST:
      default:
        return { createdAt: -1, _id: -1 };
    }
  }

  /**
   * Results, the TRUE total and every facet in ONE round trip.
   *
   * Authority: docs/architecture/SEARCH-MODEL.md §7.
   *
   * Legacy issued a paginated RPC and then a separate count against the already
   * paginated result, so `total` was wrong by construction, and it computed
   * price bounds from the current page only. Both are closed here: the facets
   * are computed over the whole filtered set.
   *
   * Facet-count caveat, documented rather than surprising: facets are computed
   * over the FILTERED set, so counts reflect currently-applied filters.
   * Recomputing each facet against the set excluding its own filter is more
   * sophisticated and is deliberately not built for MVP.
   */
  async search(criteria: ProductSearchCriteria): Promise<ProductSearchResult> {
    const match = ProductRepository.buildMatch(criteria);
    const hasText = criteria.text !== undefined && criteria.text.length > 0;
    const skip = (criteria.page - 1) * criteria.limit;

    const pipeline: PipelineStage[] = [{ $match: match }];

    // Text metadata does not survive into a $facet sub-pipeline, so it is
    // materialised into a real field first. Only added when `q` is present.
    if (hasText) {
      pipeline.push({ $addFields: { textScore: { $meta: 'textScore' } } });
    }

    pipeline.push({
      $facet: {
        results: [
          { $sort: ProductRepository.buildSort(criteria) },
          { $skip: skip },
          { $limit: criteria.limit },
          { $project: CARD_PROJECTION },
        ],
        total: [{ $count: 'value' }],
        categories: [
          {
            $group: {
              _id: { slug: '$category.slug', name: '$category.name' },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1, '_id.slug': 1 } },
          { $limit: FACET_TERM_LIMIT },
        ],
        brands: [
          { $match: { brand: { $ne: null } } },
          {
            $group: {
              _id: { slug: '$brand.slug', name: '$brand.name' },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1, '_id.slug': 1 } },
          { $limit: FACET_TERM_LIMIT },
        ],
        priceBounds: [
          {
            $group: {
              _id: null,
              min: { $min: '$pricing.effectivePrice' },
              max: { $max: '$pricing.effectivePrice' },
            },
          },
        ],
        specs: [
          { $unwind: '$specs' },
          { $match: { 'specs.filterable': true } },
          {
            $group: {
              _id: { key: '$specs.key', label: '$specs.label', value: '$specs.value' },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1, '_id.value': 1 } },
          { $limit: FACET_TERM_LIMIT * 4 },
        ],
      },
    });

    const aggregation = this.model.aggregate<SearchAggregation>(pipeline);

    // Case- and diacritic-insensitive alphabetical order. Applied only without
    // `q`, because $text requires the simple collation.
    if (criteria.sort === ProductSort.NAME_ASC && !hasText) {
      aggregation.collation({ locale: 'en', strength: 2 });
    }

    const [facetResult] = await aggregation.exec();

    if (facetResult === undefined) {
      return { items: [], total: 0, categories: [], brands: [], priceRange: null, specs: [] };
    }

    return {
      items: facetResult.results,
      total: facetResult.total[0]?.value ?? 0,
      categories: facetResult.categories.map((row) => ({ ...row._id, count: row.count })),
      brands: facetResult.brands.map((row) => ({ ...row._id, count: row.count })),
      priceRange: ProductRepository.toPriceRange(facetResult.priceBounds[0]),
      specs: ProductRepository.groupSpecFacets(facetResult.specs),
    };
  }

  private static toPriceRange(bounds: { min: number; max: number } | undefined): PriceRange | null {
    return bounds === undefined ? null : { min: bounds.min, max: bounds.max };
  }

  private static groupSpecFacets(rows: readonly SpecFacetRow[]): SpecFacet[] {
    const byKey = new Map<string, { label: string; values: SpecFacetValue[] }>();

    for (const row of rows) {
      const existing = byKey.get(row._id.key);
      const bucket = existing ?? { label: row._id.label, values: [] };

      bucket.values.push({ value: row._id.value, count: row.count });

      if (existing === undefined) {
        byKey.set(row._id.key, bucket);
      }
    }

    return [...byKey.entries()].map(([key, bucket]) => ({
      key,
      label: bucket.label,
      values: bucket.values,
    }));
  }

  /** Product detail. Returns null for an unknown, inactive or soft-deleted slug. */
  async findPublicBySlug(slug: string): Promise<PublicProductDetail | null> {
    return this.model
      .findOne({ ...ProductRepository.visible(), slug })
      .select(DETAIL_PROJECTION)
      .lean<PublicProductDetail>()
      .exec();
  }

  /**
   * Same category, excluding self, ordered by `salesCount`.
   * Authority: docs/architecture/SEARCH-MODEL.md §10.
   */
  async findRelated(
    categoryId: Types.ObjectId,
    excludeId: Types.ObjectId,
    limit: number,
  ): Promise<PublicProductCard[]> {
    return this.model
      .find({
        ...ProductRepository.visible(),
        'category.id': categoryId,
        _id: { $ne: excludeId },
      })
      .sort({ salesCount: -1, _id: -1 })
      .limit(limit)
      .select(CARD_PROJECTION)
      .lean<PublicProductCard[]>()
      .exec();
  }

  /**
   * Lightweight autocomplete: anchored prefix match on name and SKU.
   *
   * Anchored — never a leading wildcard. Legacy's search ORed a tsvector match
   * with two `ILIKE '%term%'` branches, and a disjunction is only index
   * accessible if EVERY branch is, so it paid the write cost of a GIN index it
   * could never read (0 scans against 1,282 sequential scans).
   */
  async suggest(term: string, limit: number): Promise<PublicProductCard[]> {
    const prefix = `^${escapeRegExp(term)}`;

    return this.model
      .find({
        ...ProductRepository.visible(),
        $or: [
          { 'name.en': { $regex: prefix, $options: 'i' } },
          { sku: { $regex: prefix, $options: 'i' } },
        ],
      })
      .limit(limit)
      .select(CARD_PROJECTION)
      .lean<PublicProductCard[]>()
      .exec();
  }

  /**
   * Batch-loads products by id for cart pricing — ONE query for the whole cart,
   * never one per line.
   *
   * Deliberately does NOT apply the visibility filter. This is the single
   * exception to the rule in `visible()`, and it exists so an inactive or
   * soft-deleted product still returns and its cart line can be flagged rather
   * than silently disappearing. Nothing here reaches a public catalogue
   * response; the cart maps it into its own line DTO.
   */
  async findByIdsForCart(
    ids: readonly Types.ObjectId[],
    session?: ClientSession,
  ): Promise<CartProductRow[]> {
    if (ids.length === 0) {
      return [];
    }

    /**
     * The optional session is what lets CHECKOUT re-read authoritative prices
     * and stock INSIDE its transaction, against the same snapshot the stock
     * decrement will be evaluated against. Without it, checkout would have to
     * either duplicate this query or price an order from a read taken outside
     * the transaction — the second of which is the read-then-write shape the
     * whole consistency model exists to remove.
     *
     * Omitted by the cart, which needs no transaction: passing `undefined` to
     * `.session()` is a no-op, so there is one query with one behaviour.
     */
    return this.model
      .find({ _id: { $in: [...ids] } })
      .select(CART_PROJECTION)
      .session(session ?? null)
      .lean<CartProductRow[]>()
      .exec();
  }

  /** Product counts per category id, for the category tree. */
  async countByCategory(): Promise<Map<string, number>> {
    const rows = await this.model
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: ProductRepository.visible() },
        { $unwind: '$category.path' },
        { $group: { _id: '$category.path', count: { $sum: 1 } } },
      ])
      .exec();

    return new Map(rows.map((row) => [row._id.toHexString(), row.count]));
  }
}
