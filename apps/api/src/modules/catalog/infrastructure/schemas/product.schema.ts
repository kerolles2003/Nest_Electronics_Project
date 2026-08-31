import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LocalizedText,
  LocalizedTextSchema,
  ProductImage,
  ProductImageSchema,
} from './embedded.schema';

/**
 * The catalogue core and the system's largest read surface.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §4; MONGODB-DESIGN.md §4;
 *            SEARCH-MODEL.md §9 (indexes).
 *
 * Three decisions are visible in this file and are worth stating plainly:
 *
 *  1. NO VARIANTS. One product = one SKU = one stock number. An ESP32-WROOM-32
 *     and an ESP32-S3 are different products, not sizes of one another.
 *  2. Category and brand are REFERENCE + DENORMALISED SNAPSHOT, so a product
 *     grid is a single-collection read. Legacy search returned bare ids, which
 *     is exactly why it rendered brand-less, image-less grids.
 *  3. The EAV attribute system becomes a flat embedded `specs[]` array with one
 *     multikey index — making faceted filtering possible for the first time.
 */

/**
 * The category reference plus the fields every product card renders.
 *
 * `path` here is the FULL chain root-first INCLUDING the product's own category,
 * which makes a subtree filter a single indexed match — exactly the "one indexed
 * $in, no $graphLookup, no recursion at query time" that CATALOG-MODEL.md §6 and
 * SEARCH-MODEL.md §8 require. The `categories.path` field itself stays
 * ancestors-only, because that is what a breadcrumb needs.
 */
@Schema({ _id: false, strict: 'throw' })
export class CategorySnapshot {
  @Prop({ type: Types.ObjectId, required: true })
  id!: Types.ObjectId;

  @Prop({ type: String, required: true })
  slug!: string;

  @Prop({ type: LocalizedTextSchema, required: true })
  name!: LocalizedText;

  @Prop({ type: [Types.ObjectId], default: [] })
  path!: Types.ObjectId[];
}
const CategorySnapshotSchema = SchemaFactory.createForClass(CategorySnapshot);

/** Nullable: 53 of 85 live products have no brand. */
@Schema({ _id: false, strict: 'throw' })
export class BrandSnapshot {
  @Prop({ type: Types.ObjectId, required: true })
  id!: Types.ObjectId;

  @Prop({ type: String, required: true })
  slug!: string;

  @Prop({ type: LocalizedTextSchema, required: true })
  name!: LocalizedText;
}
const BrandSnapshotSchema = SchemaFactory.createForClass(BrandSnapshot);

/**
 * Money as integer minor units (piastres). No floats anywhere.
 *
 * `effectivePrice` is a MAINTAINED redundant field (ADR-SEARCH-002): the rule
 * `salePrice ?? basePrice` must be both sortable and range-filterable, and
 * neither `$expr` with `$ifNull` nor an `$addFields` stage before `$match` can
 * use an index — which would force a collection scan on the hottest query in
 * the system. Redundancy is accepted in exchange for an indexable price.
 *
 * `costPrice` is ADMIN ONLY and must never appear in a public DTO. That is
 * guaranteed structurally: the field does not exist on ProductListItemDto or
 * ProductDetailDto, so no code path can leak it.
 */
@Schema({ _id: false, strict: 'throw' })
export class ProductPricing {
  @Prop({ type: Number, required: true, min: 1 })
  basePrice!: number;

  @Prop({ type: Number, default: null, min: 1 })
  salePrice!: number | null;

  @Prop({ type: Number, required: true, min: 1 })
  effectivePrice!: number;

  @Prop({ type: Number, default: null, min: 0 })
  costPrice!: number | null;
}
const ProductPricingSchema = SchemaFactory.createForClass(ProductPricing);

/**
 * Stock lives INSIDE the product document — single-document atomic updates and
 * no join for the availability badge on every card — but is WRITABLE ONLY BY
 * InventoryModule. Movement history is a separate append-only collection.
 *
 * There is no `reserved` term: reservations were removed.
 */
@Schema({ _id: false, strict: 'throw' })
export class ProductStock {
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  onHand!: number;

  @Prop({ type: Number, required: true, default: 5, min: 0 })
  lowStockThreshold!: number;
}
const ProductStockSchema = SchemaFactory.createForClass(ProductStock);

/**
 * A flattened spec, replacing the legacy 3-table EAV system that was never
 * populated (0 assignments, so zero migration cost and complete design freedom).
 *
 * `value` is a STRING: component specs are heterogeneous ("3.3",
 * "Wi-Fi + Bluetooth", "-40 to 85"). Numeric range filtering is not in MVP; an
 * optional `numericValue` alongside would be additive, not a redesign.
 */
@Schema({ _id: false, strict: 'throw' })
export class ProductSpec {
  @Prop({ type: String, required: true })
  key!: string;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, required: true })
  value!: string;

  @Prop({ type: String, default: null })
  unit!: string | null;

  /** Only filterable specs become facets. */
  @Prop({ type: Boolean, default: false })
  filterable!: boolean;

  @Prop({ type: Number, default: 0 })
  sortOrder!: number;
}
const ProductSpecSchema = SchemaFactory.createForClass(ProductSpec);

/**
 * Written ONLY by ReviewsModule. `average` is stored in HUNDREDTHS (430 = 4.30)
 * — an integer, consistent with the no-floats rule, and it sorts correctly.
 */
@Schema({ _id: false, strict: 'throw' })
export class ProductRating {
  @Prop({ type: Number, default: 0, min: 0, max: 500 })
  average!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  count!: number;

  @Prop({
    type: raw({
      '1': { type: Number, default: 0 },
      '2': { type: Number, default: 0 },
      '3': { type: Number, default: 0 },
      '4': { type: Number, default: 0 },
      '5': { type: Number, default: 0 },
    }),
    default: (): Record<string, number> => ({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }),
  })
  distribution!: Record<string, number>;
}
const ProductRatingSchema = SchemaFactory.createForClass(ProductRating);

@Schema({ _id: false, strict: 'throw' })
export class ProductSeo {
  @Prop({ type: String, default: null })
  title!: string | null;

  @Prop({ type: String, default: null })
  description!: string | null;
}
const ProductSeoSchema = SchemaFactory.createForClass(ProductSeo);

/** Millimetres. */
@Schema({ _id: false, strict: 'throw' })
export class ProductDimensions {
  @Prop({ type: Number, required: true })
  length!: number;

  @Prop({ type: Number, required: true })
  width!: number;

  @Prop({ type: Number, required: true })
  height!: number;
}
const ProductDimensionsSchema = SchemaFactory.createForClass(ProductDimensions);

@Schema({ collection: 'products', timestamps: true, strict: 'throw' })
export class Product {
  /** Unique, uppercase-normalised, immutable after creation. */
  @Prop({ type: String, required: true, uppercase: true, trim: true })
  sku!: string;

  /** Unique, lowercase kebab-case. The PUBLIC identifier; `_id` is not. */
  @Prop({ type: String, required: true, lowercase: true, trim: true })
  slug!: string;

  @Prop({ type: LocalizedTextSchema, required: true })
  name!: LocalizedText;

  @Prop({ type: LocalizedTextSchema, default: null })
  shortDescription!: LocalizedText | null;

  @Prop({ type: LocalizedTextSchema, default: null })
  description!: LocalizedText | null;

  @Prop({ type: CategorySnapshotSchema, required: true })
  category!: CategorySnapshot;

  @Prop({ type: BrandSnapshotSchema, default: null })
  brand!: BrandSnapshot | null;

  @Prop({ type: ProductPricingSchema, required: true })
  pricing!: ProductPricing;

  @Prop({ type: String, required: true, default: 'EGP' })
  currency!: string;

  @Prop({ type: ProductStockSchema, required: true, default: (): object => ({}) })
  stock!: ProductStock;

  /** Bounded at 8; a product with ZERO images is valid — 74% of live products have none. */
  @Prop({ type: [ProductImageSchema], default: [] })
  images!: ProductImage[];

  @Prop({ type: [ProductSpecSchema], default: [] })
  specs!: ProductSpec[];

  @Prop({ type: ProductRatingSchema, required: true, default: (): object => ({}) })
  rating!: ProductRating;

  /** Incremented by OrdersModule on placement. */
  @Prop({ type: Number, default: 0, min: 0 })
  salesCount!: number;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false })
  isFeatured!: boolean;

  /** Soft delete. Orders embed product snapshots, so a deleted product never breaks history. */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  @Prop({ type: ProductSeoSchema, default: null })
  seo!: ProductSeo | null;

  /** Grams. */
  @Prop({ type: Number, default: null })
  weight!: number | null;

  @Prop({ type: ProductDimensionsSchema, default: null })
  dimensions!: ProductDimensions | null;
}

export type ProductDocument = HydratedDocument<Product>;
export type ProductLean = Product & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const ProductSchema = SchemaFactory.createForClass(Product);

// --- Indexes ---------------------------------------------------------------
// Every index below is justified by a named access pattern in SEARCH-MODEL.md
// §9. autoIndex is disabled; these are created by the explicit, idempotent
// `indexes:sync` step (CODEBASE-STRUCTURE.md §6.1, OBSERVABILITY.md §9).

ProductSchema.index({ slug: 1 }, { unique: true, name: 'product_slug_unique' });
ProductSchema.index({ sku: 1 }, { unique: true, name: 'product_sku_unique' });

/**
 * MongoDB permits ONE text index per collection, so every free-text field lives
 * here. `sku` is weighted 8 of 10 — nearly as high as the product name — because
 * for a components store part numbers ARE search terms: a maker typing
 * "ESP32-WROOM-32" must get an exact hit first. A generic e-commerce weighting
 * would get this wrong.
 *
 * `specs.value` is deliberately EXCLUDED: specs are facet filters, not free
 * text. Searching "3.3" should not return every 3.3 V component.
 */
ProductSchema.index(
  {
    'name.en': 'text',
    sku: 'text',
    'brand.name.en': 'text',
    'shortDescription.en': 'text',
    'description.en': 'text',
  },
  {
    name: 'product_text_search',
    default_language: 'english',
    weights: {
      'name.en': 10,
      sku: 8,
      'brand.name.en': 4,
      'shortDescription.en': 3,
      'description.en': 1,
    },
  },
);

// Category browse + price sort — the most common path in the application.
ProductSchema.index(
  { isActive: 1, deletedAt: 1, 'category.path': 1, 'pricing.effectivePrice': 1 },
  { name: 'product_category_price' },
);
ProductSchema.index({ isActive: 1, deletedAt: 1, 'brand.id': 1 }, { name: 'product_brand' });
// SEARCH-MODEL.md §9 lists the next four with `isActive` alone. `deletedAt` is
// added to each on MEASURED evidence: every public read filters
// { isActive, deletedAt } together, and without the second field the planner
// fetches and post-filters instead of sorting from the index — `explain()` on
// the default listing showed a blocking SORT stage. The two frozen indexes that
// already carry `deletedAt` (category browse and brand) confirm this is the
// intended shape; the omission elsewhere reads as an oversight. `_id` closes the
// sort key so pagination is both stable and index-ordered.
// Homepage — legacy's hottest product index (621 scans).
ProductSchema.index({ isActive: 1, deletedAt: 1, isFeatured: 1 }, { name: 'product_featured' });
ProductSchema.index({ isActive: 1, deletedAt: 1, createdAt: -1, _id: -1 }, { name: 'product_newest' });
ProductSchema.index(
  { isActive: 1, deletedAt: 1, 'rating.average': -1, 'rating.count': -1 },
  { name: 'product_rating' },
);
ProductSchema.index(
  { isActive: 1, deletedAt: 1, 'pricing.effectivePrice': 1 },
  { name: 'product_price' },
);
// Multikey — makes faceted spec filtering a single-collection query.
ProductSchema.index({ 'specs.key': 1, 'specs.value': 1 }, { name: 'product_specs' });
// `related` reads by exact category ordered by sales, which the browse index
// cannot serve because `category.path` leads it.
ProductSchema.index(
  { isActive: 1, deletedAt: 1, 'category.id': 1, salesCount: -1 },
  { name: 'product_category_bestselling' },
);

// Deliberately NOT indexed: `stock.onHand` — low selectivity, most products are
// in stock. It is a post-filter, not a query driver.
