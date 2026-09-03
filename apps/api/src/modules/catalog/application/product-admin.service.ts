import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../../../common/dto/pagination-query.dto';
import { AuditService, type AuditContext } from '../../audit/application/audit.service';
import { toAuditActor } from '../../audit/domain/audit-actor';
import { AuditAction, AuditEntityType } from '../../audit/domain/audit-action';
import { UsersService, type UserProfile } from '../../users/application/users.service';
import { Brand, type BrandLean } from '../infrastructure/schemas/brand.schema';
import { Category, type CategoryLean } from '../infrastructure/schemas/category.schema';
import { Product, type ProductLean } from '../infrastructure/schemas/product.schema';
import { AdminProductSort, AdminProductState } from '../presentation/dto/admin-product-request.dto';

/** MongoDB's duplicate-key error. The unique index is the authority; this is how it speaks. */
const DUPLICATE_KEY = 11000;

/** Everything a spec carries, after defaults are applied. */
export interface SpecInput {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly unit?: string | null;
  readonly filterable?: boolean;
  readonly sortOrder?: number;
}

export interface LocalizedInput {
  readonly en: string;
  readonly ar?: string | null;
}

export interface CreateProductInput {
  readonly sku: string;
  readonly slug: string;
  readonly name: LocalizedInput;
  readonly shortDescription?: LocalizedInput | null;
  readonly description?: LocalizedInput | null;
  readonly categoryId: string;
  readonly brandId?: string | null;
  readonly basePrice: number;
  readonly salePrice?: number | null;
  readonly costPrice?: number | null;
  readonly specs?: readonly SpecInput[];
  readonly seo?: { title?: string | null; description?: string | null } | null;
  readonly weight?: number | null;
  readonly dimensions?: { length: number; width: number; height: number } | null;
  readonly isActive?: boolean;
  readonly isFeatured?: boolean;
}

export interface AdminProductQuery {
  readonly page?: number;
  readonly limit?: number;
  readonly q?: string;
  readonly state?: AdminProductState;
  readonly categoryId?: string;
  readonly brandId?: string;
  readonly lowStock?: boolean;
  readonly sort?: AdminProductSort;
}

export interface AdminProductPage {
  readonly items: readonly ProductLean[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

/**
 * Who is asking, and from where.
 *
 * `actorId` rather than a resolved actor, because the ROLE and the NAME written
 * into the audit trail must come from the database profile and not from the JWT
 * claim — a token minted before a demotion still carries the old role, and an
 * audit record is the last place that should be believed. Same reasoning, same
 * mechanism, as `OrderLifecycleService.transitionByStaff`.
 */
export interface AdminWriteContext {
  readonly actorId: Types.ObjectId;
  readonly forensics: AuditContext;
}

/**
 * Catalogue WRITES for staff, and the admin's own view of the catalogue.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §2, §4, §5, §7, §9;
 *            docs/architecture/AUDIT-MODEL.md §3, §5.
 *
 * ## Why this is a separate service from `ProductsService`
 *
 * `ProductsService` is the public read surface, and every query in it is
 * filtered `{ isActive: true, deletedAt: null }` at the repository — §9 requires
 * that filter to live there rather than in individual queries, precisely so no
 * caller can forget it. An admin surface needs the opposite: it must see drafts
 * and deleted rows, because a soft delete that cannot be found again is a hard
 * delete with extra steps.
 *
 * Putting both in one class would mean one flag deciding whether the visibility
 * rule applies, and a flag defaulting the wrong way in one code path is how
 * legacy defect Z6 leaked seven child tables of unreleased products. Two
 * classes, and the public one has no parameter that could turn the filter off.
 *
 * ## The snapshot, and why it is built here
 *
 * §6 stores category and brand as reference PLUS a denormalised snapshot, so a
 * product grid is a single-collection read. The snapshot is therefore derived
 * data, and derived data written by a caller is data that can disagree with its
 * source: a client that could POST `category.name` could label a product with a
 * category name no category has. Every write here reads the parent and builds
 * the snapshot from it.
 *
 * `category.path` in the snapshot is the full chain root-first INCLUDING the
 * product's own category — which is NOT what `categories.path` holds (that one
 * is ancestors-only, because a breadcrumb wants ancestors). The difference is
 * load-bearing: it is what makes "every product in this subtree" one indexed
 * `$in` with no `$graphLookup`.
 */
@Injectable()
export class ProductAdminService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(Category.name) private readonly categories: Model<Category>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The acting staff profile, as the database has it now.
   *
   * A valid token for a deleted account resolves to nothing and performs no
   * write — the same check, in the same position, as every other privileged
   * path in the codebase.
   */
  private async resolveActor(actorId: Types.ObjectId): Promise<UserProfile> {
    const profile = await this.users.findById(actorId);

    if (profile === null) {
      throw AppException.accountDisabled();
    }

    return profile;
  }

  /**
   * The catalogue as an operator sees it: drafts included, deleted rows
   * excluded unless asked for.
   */
  async list(query: AdminProductQuery): Promise<AdminProductPage> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const filter = buildAdminFilter(query);

    // Two queries, issued together. `countDocuments` on the same filter is the
    // TRUE match count — legacy counted an already-paginated result and was
    // wrong by construction (API-CONTRACT.md §3).
    const [items, total] = await Promise.all([
      this.products
        .find(filter)
        .sort(sortSpecFor(query.sort ?? AdminProductSort.UPDATED))
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<ProductLean[]>()
        .exec(),
      this.products.countDocuments(filter).exec(),
    ]);

    return { items, total, page, limit };
  }

  /**
   * One product by id, whatever its state.
   *
   * No visibility filter, deliberately: an operator opening a soft-deleted
   * product from the deleted list must see it, and a 404 there would make the
   * restore action impossible to reach.
   */
  async findById(id: Types.ObjectId): Promise<ProductLean> {
    const product = await this.products.findById(id).lean<ProductLean>().exec();

    if (product === null) {
      throw AppException.productNotFound();
    }

    return product;
  }

  /**
   * Creates a product and audits it.
   *
   * ## Order of operations, and why it is this one
   *
   * The parents are resolved BEFORE the insert, so a bad `categoryId` is a 404
   * and not a product with a snapshot of nothing. The insert is next, and the
   * unique indexes on `sku` and `slug` decide the race — not a pre-flight
   * existence check, which two operators can both pass. The audit row is last
   * and post-commit (§5 rule 2): a created product is more important than its
   * audit line, and `record` cannot throw.
   */
  async create(input: CreateProductInput, context: AdminWriteContext): Promise<ProductLean> {
    const actor = await this.resolveActor(context.actorId);
    const { category, brand } = await this.resolveParents(input.categoryId, input.brandId ?? null);

    assertSalePriceBelowBase(input.basePrice, input.salePrice ?? null);

    const effectivePrice = input.salePrice ?? input.basePrice;

    let created: ProductLean;

    try {
      const document = await this.products.create({
        sku: input.sku,
        slug: input.slug,
        name: toLocalized(input.name),
        shortDescription: input.shortDescription == null ? null : toLocalized(input.shortDescription),
        description: input.description == null ? null : toLocalized(input.description),
        category: snapshotCategory(category),
        brand: brand === null ? null : snapshotBrand(brand),
        pricing: {
          basePrice: input.basePrice,
          salePrice: input.salePrice ?? null,
          effectivePrice,
          costPrice: input.costPrice ?? null,
        },
        currency: 'EGP',
        specs: (input.specs ?? []).map(toSpec),
        seo:
          input.seo == null
            ? null
            : { title: input.seo.title ?? null, description: input.seo.description ?? null },
        weight: input.weight ?? null,
        dimensions: input.dimensions ?? null,
        /*
         * Unpublished unless the caller says otherwise — the opposite of the
         * schema default, and stated in the DTO. A product created here has no
         * images and no stock; publishing it at the moment it is named puts an
         * empty row in a customer's search results.
         */
        isActive: input.isActive ?? false,
        isFeatured: input.isFeatured ?? false,
      });

      created = document.toObject<ProductLean>();
    } catch (error) {
      throw this.translateDuplicate(error, input.sku, input.slug);
    }

    await this.audit.record({
      actor: toAuditActor(actor),
      action: AuditAction.PRODUCT_CREATED,
      entity: { type: AuditEntityType.PRODUCT, id: created._id, label: created.sku },
      /*
       * No `before`, because there was none — §4's `changes` is a diff, and a
       * diff against nothing is the whole document, which is the thing §4
       * forbids storing. The facts that make a creation reconstructable go in
       * `metadata` instead: what it is, what it costs, and whether it went live.
       */
      metadata: {
        slug: created.slug,
        name: created.name.en,
        categoryId: created.category.id.toHexString(),
        basePrice: created.pricing.basePrice,
        salePrice: created.pricing.salePrice,
        isActive: created.isActive,
      },
      context: context.forensics,
    });

    return created;
  }

  /**
   * Loads the category and (optionally) the brand a product will point at.
   *
   * A SOFT-DELETED parent is refused. Nothing in the schema stops a product
   * referencing one, and the result would be a product filed under a category
   * that renders nowhere — invisible in navigation, present in the database,
   * and indistinguishable from a bug when somebody eventually looks for it.
   */
  private async resolveParents(
    categoryId: string,
    brandId: string | null,
  ): Promise<{ category: CategoryLean; brand: BrandLean | null }> {
    const [category, brand] = await Promise.all([
      this.categories
        .findOne({ _id: new Types.ObjectId(categoryId), deletedAt: null })
        .lean<CategoryLean>()
        .exec(),
      brandId === null
        ? Promise.resolve(null)
        : this.brands
            .findOne({ _id: new Types.ObjectId(brandId), deletedAt: null })
            .lean<BrandLean>()
            .exec(),
    ]);

    if (category === null) throw AppException.categoryNotFound();
    if (brandId !== null && brand === null) throw AppException.brandNotFound();

    return { category, brand };
  }

  /**
   * Turns a duplicate-key error into the 409 that names the field.
   *
   * The index NAME is what distinguishes them, and both indexes are named in
   * `product.schema.ts` for exactly this reason: an unnamed index produces a
   * generated name that a message cannot be derived from, and `keyPattern` is
   * absent on some driver paths. If neither name matches, the error is
   * re-thrown rather than guessed at — a 409 blaming the wrong field would send
   * an operator editing a value that was never the problem.
   */
  private translateDuplicate(error: unknown, sku: string, slug: string): unknown {
    if (typeof error !== 'object' || error === null || (error as { code?: number }).code !== DUPLICATE_KEY) {
      return error;
    }

    const message = (error as { message?: string }).message ?? '';
    const keyPattern = (error as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};

    if ('sku' in keyPattern || message.includes('product_sku_unique')) {
      return AppException.duplicateSku(sku);
    }

    if ('slug' in keyPattern || message.includes('product_slug_unique')) {
      return AppException.duplicateSlug(slug);
    }

    return error;
  }
}

// --- pure helpers -----------------------------------------------------------

/**
 * `0 < salePrice < basePrice`, per §5.
 *
 * Not expressible in class-validator: it is a relation between two fields, and
 * `@Min(1)` on each cannot see the other. A sale price at or above list is not
 * a rounding question — the storefront renders a struck-through "was" price
 * beside it, so the customer is shown a discount that is not one.
 */
export function assertSalePriceBelowBase(basePrice: number, salePrice: number | null): void {
  if (salePrice === null) return;

  if (salePrice >= basePrice) {
    throw AppException.validation([
      {
        field: 'salePrice',
        message: `salePrice (${String(salePrice)}) must be strictly less than basePrice (${String(basePrice)}).`,
        code: 'RANGE',
      },
    ]);
  }
}

export function toLocalized(input: LocalizedInput): { en: string; ar: string | null } {
  return { en: input.en, ar: input.ar ?? null };
}

function toSpec(spec: SpecInput): {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  filterable: boolean;
  sortOrder: number;
} {
  return {
    key: spec.key,
    label: spec.label,
    value: spec.value,
    unit: spec.unit ?? null,
    filterable: spec.filterable ?? false,
    sortOrder: spec.sortOrder ?? 0,
  };
}

/**
 * The category snapshot a product carries.
 *
 * `path` is `[...ancestors, self]` — the full chain including the product's own
 * category. `categories.path` excludes self; this one must not, or a subtree
 * query for a leaf category would match none of its own products.
 */
export function snapshotCategory(category: CategoryLean): {
  id: Types.ObjectId;
  slug: string;
  name: { en: string; ar: string | null };
  path: Types.ObjectId[];
} {
  return {
    id: category._id,
    slug: category.slug,
    name: { en: category.name.en, ar: category.name.ar },
    path: [...category.path, category._id],
  };
}

export function snapshotBrand(brand: BrandLean): {
  id: Types.ObjectId;
  slug: string;
  name: { en: string; ar: string | null };
} {
  return {
    id: brand._id,
    slug: brand.slug,
    name: { en: brand.name.en, ar: brand.name.ar },
  };
}

/**
 * Escapes every character a regular expression treats as syntax.
 *
 * The admin search box reaches a `$regex`, so an unescaped `(` is a 500 and an
 * unescaped `.*` is a scan of the whole catalogue. Same rule, same reason, as
 * the order queue's search.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAdminFilter(query: AdminProductQuery): FilterQuery<Product> {
  const filter: FilterQuery<Product> = {};

  switch (query.state) {
    case AdminProductState.PUBLISHED:
      filter.isActive = true;
      filter.deletedAt = null;
      break;
    case AdminProductState.DRAFT:
      filter.isActive = false;
      filter.deletedAt = null;
      break;
    case AdminProductState.DELETED:
      filter.deletedAt = { $ne: null };
      break;
    default:
      // Drafts in, deleted out. See the DTO for why this is the default.
      filter.deletedAt = null;
  }

  if (query.categoryId !== undefined) {
    filter['category.id'] = new Types.ObjectId(query.categoryId);
  }

  if (query.brandId !== undefined) {
    filter['brand.id'] = new Types.ObjectId(query.brandId);
  }

  if (query.lowStock === true) {
    // `$expr` compares two fields of the same document, which no index can
    // serve. Accepted: the low-stock list is an operator query run a handful of
    // times a day over a catalogue of hundreds, not a customer-facing path.
    filter.$expr = { $lte: ['$stock.onHand', '$stock.lowStockThreshold'] };
  }

  if (query.q !== undefined && query.q.length > 0) {
    const term = new RegExp(escapeRegExp(query.q), 'i');

    // NOT the text index: an operator typing "esp32" expects it to match
    // "ESP32-WROOM-32" mid-token, and a text index tokenises on word
    // boundaries, so it would not.
    filter.$or = [{ sku: term }, { slug: term }, { 'name.en': term }];
  }

  return filter;
}

/** `_id` closes every sort key so pagination is stable when values tie. */
function sortSpecFor(sort: AdminProductSort): Record<string, 1 | -1> {
  switch (sort) {
    case AdminProductSort.NEWEST:
      return { createdAt: -1, _id: -1 };
    case AdminProductSort.OLDEST:
      return { createdAt: 1, _id: 1 };
    case AdminProductSort.NAME_ASC:
      return { 'name.en': 1, _id: 1 };
    case AdminProductSort.PRICE_ASC:
      return { 'pricing.effectivePrice': 1, _id: 1 };
    case AdminProductSort.PRICE_DESC:
      return { 'pricing.effectivePrice': -1, _id: -1 };
    case AdminProductSort.STOCK_ASC:
      return { 'stock.onHand': 1, _id: 1 };
    case AdminProductSort.UPDATED:
      return { updatedAt: -1, _id: -1 };
  }
}
