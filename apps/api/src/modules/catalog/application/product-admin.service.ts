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
import { SlugRedirectEntityType } from '../infrastructure/schemas/slug-redirect.schema';
import { SlugRedirectService } from './slug-redirect.service';
import { AdminProductSort, AdminProductState } from '../presentation/dto/admin-product-request.dto';
import { BrandsService } from './brands.service';
import { CategoriesService } from './categories.service';

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

/**
 * A partial edit. `undefined` means "leave it"; `null`, where the field is
 * nullable, means "clear it".
 *
 * `sku` is absent because CATALOG-MODEL.md §2 makes it immutable after
 * creation, and `isActive` because publication is its own audited action.
 */
export interface UpdateProductInput {
  readonly slug?: string;
  readonly name?: LocalizedInput;
  readonly shortDescription?: LocalizedInput | null;
  readonly description?: LocalizedInput | null;
  readonly categoryId?: string;
  readonly brandId?: string | null;
  readonly basePrice?: number;
  readonly salePrice?: number | null;
  readonly costPrice?: number | null;
  readonly specs?: readonly SpecInput[];
  readonly seo?: { title?: string | null; description?: string | null } | null;
  readonly weight?: number | null;
  readonly dimensions?: { length: number; width: number; height: number } | null;
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
    private readonly redirects: SlugRedirectService,
    private readonly categoriesCache: CategoriesService,
    private readonly brandsCache: BrandsService,
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

    // A product created PUBLISHED changes the counts the storefront renders.
    // `before` is the created document itself: nothing existed before it, so
    // there is no earlier category or brand to recount.
    await this.recount(created, created);

    return created;
  }


  /**
   * Applies a partial edit, writes a redirect when the slug moves, and audits
   * whichever of the two things happened.
   *
   * ## The `$set` is built from named fields, never from the body
   *
   * `{ $set: body }` would be shorter and would be a write-anything bug: with a
   * DTO this wide, one field added to the class later becomes a field written
   * to the document with no thought given to whether it should be. The global
   * `forbidNonWhitelisted` pipe rejects an unknown key at the boundary, but that
   * is a second line of defence, not this one.
   *
   * ## An ABSENT key means "leave it"; `null` means "clear it"
   *
   * The distinction is why `salePrice: null` can end a sale and omitting
   * `salePrice` cannot. A partial update that could not express "clear this"
   * would leave an operator unable to take a product off sale without a second
   * endpoint for it.
   */
  async update(
    id: Types.ObjectId,
    input: UpdateProductInput,
    context: AdminWriteContext,
  ): Promise<ProductLean> {
    const actor = await this.resolveActor(context.actorId);
    const current = await this.findById(id);

    if (current.deletedAt !== null) {
      throw AppException.productDeleted();
    }

    /*
     * Validated against the RESULTING pair, not against what was sent. Lowering
     * `basePrice` below an untouched `salePrice` is the trap this catches: both
     * fields are individually valid, the request mentions only one of them, and
     * the product ends up "on sale" above list.
     */
    const nextBase = input.basePrice ?? current.pricing.basePrice;
    const nextSale = input.salePrice === undefined ? current.pricing.salePrice : input.salePrice;

    assertSalePriceBelowBase(nextBase, nextSale);

    const set: Record<string, unknown> = {};

    if (input.slug !== undefined) set.slug = input.slug;
    if (input.name !== undefined) set.name = toLocalized(input.name);
    if (input.shortDescription !== undefined) {
      set.shortDescription =
        input.shortDescription === null ? null : toLocalized(input.shortDescription);
    }
    if (input.description !== undefined) {
      set.description = input.description === null ? null : toLocalized(input.description);
    }
    if (input.specs !== undefined) set.specs = input.specs.map(toSpec);
    if (input.seo !== undefined) {
      set.seo =
        input.seo === null
          ? null
          : { title: input.seo.title ?? null, description: input.seo.description ?? null };
    }
    if (input.weight !== undefined) set.weight = input.weight;
    if (input.dimensions !== undefined) set.dimensions = input.dimensions;
    if (input.isFeatured !== undefined) set.isFeatured = input.isFeatured;

    // Pricing is set as a WHOLE so `effectivePrice` can never be left behind by
    // a partial write. It is derived, and a derived field that some paths
    // recompute and others do not is worse than one that is always recomputed.
    if (
      input.basePrice !== undefined ||
      input.salePrice !== undefined ||
      input.costPrice !== undefined
    ) {
      set.pricing = {
        basePrice: nextBase,
        salePrice: nextSale,
        effectivePrice: nextSale ?? nextBase,
        costPrice: input.costPrice === undefined ? current.pricing.costPrice : input.costPrice,
      };
    }

    if (input.categoryId !== undefined || input.brandId !== undefined) {
      const { category, brand } = await this.resolveParents(
        input.categoryId ?? current.category.id.toHexString(),
        input.brandId === undefined ? (current.brand?.id.toHexString() ?? null) : input.brandId,
      );

      if (input.categoryId !== undefined) set.category = snapshotCategory(category);
      if (input.brandId !== undefined) set.brand = brand === null ? null : snapshotBrand(brand);
    }

    let updated: ProductLean;

    try {
      updated =
        (await this.products
          .findOneAndUpdate({ _id: id }, { $set: set }, { new: true })
          .lean<ProductLean>()
          .exec()) ?? current;
    } catch (error) {
      throw this.translateDuplicate(error, current.sku, input.slug ?? current.slug);
    }

    /*
     * The redirect is written AFTER the product has actually been renamed, and
     * only then. Writing it first would leave a redirect pointing at a slug
     * nothing holds if the update were refused by the unique index — which is
     * the single most likely way a rename fails.
     *
     * This is CATALOG-MODEL.md §2 rules 3–5, and it is the second half of
     * legacy defect K4: the old system wrote this row faithfully and never read
     * one, so every rename left a permanent 404 at the old URL with a database
     * row recording exactly where the page had gone.
     */
    if (input.slug !== undefined && input.slug !== current.slug) {
      await this.redirects.record({
        entityType: SlugRedirectEntityType.PRODUCT,
        entityId: id,
        oldSlug: current.slug,
        newSlug: input.slug,
      });
    }

    /*
     * ONE audit row, whose `action` names the most consequential thing that
     * changed. A price change is recorded as `PRODUCT_PRICE_CHANGED` even when
     * the same request also renamed the product: `changes` carries every
     * changed field either way, and the `{action, createdAt}` index exists so
     * "every price change" is one query. Two rows for one operator action would
     * double-count that query.
     *
     * `recordChange` writes NOTHING when the diff is empty, so saving a form
     * without altering anything leaves no row.
     */
    // Moving a product between categories or brands changes two counts, and
    // `recount` is given both states so the one it LEFT is corrected too.
    await this.recount(current, updated);

    await this.audit.recordChange({
      actor: toAuditActor(actor),
      action: 'pricing' in set ? AuditAction.PRODUCT_PRICE_CHANGED : AuditAction.PRODUCT_UPDATED,
      entity: { type: AuditEntityType.PRODUCT, id, label: updated.sku },
      before: auditableProduct(current),
      after: auditableProduct(updated),
      context: context.forensics,
    });

    return updated;
  }

  /**
   * Publishes or unpublishes, as its own action.
   *
   * ## Why this is not a field on the update DTO
   *
   * AUDIT-MODEL.md §3 audits publication state separately from an ordinary
   * catalogue edit, with its own two action codes. A boolean inside a general
   * update would be recorded as `PRODUCT_UPDATED` with `isActive` among the
   * changed fields, and "when did this go live" would stop being answerable
   * from the action index — it would become a scan of every product update ever
   * made, reading diffs.
   *
   * ## Idempotent, and silent when it is a no-op
   *
   * Publishing an already-published product succeeds and writes NO audit row,
   * because the diff is empty. A row saying somebody published something that
   * was already published is noise in a log kept for two years.
   */
  async setPublished(
    id: Types.ObjectId,
    isActive: boolean,
    context: AdminWriteContext,
  ): Promise<ProductLean> {
    const actor = await this.resolveActor(context.actorId);
    const current = await this.findById(id);

    if (current.deletedAt !== null) {
      // Publishing a deleted product would put it back in front of customers
      // through a route whose name says nothing about deletion. Restore is the
      // operation that means that, and it is audited as one.
      throw AppException.productDeleted();
    }

    const updated =
      (await this.products
        .findOneAndUpdate({ _id: id }, { $set: { isActive } }, { new: true })
        .lean<ProductLean>()
        .exec()) ?? current;

    // Publication is exactly what the counts count.
    await this.recount(current, updated);

    await this.audit.recordChange({
      actor: toAuditActor(actor),
      action: isActive ? AuditAction.PRODUCT_PUBLISHED : AuditAction.PRODUCT_UNPUBLISHED,
      entity: { type: AuditEntityType.PRODUCT, id, label: updated.sku },
      before: { isActive: current.isActive },
      after: { isActive: updated.isActive },
      context: context.forensics,
    });

    return updated;
  }


  /**
   * Soft-deletes a product, per CATALOG-MODEL.md §9.
   *
   * Sets `deletedAt` **and** `isActive: false`. Both, because they answer
   * different questions and a restore has to be able to tell them apart: after
   * this, "was it published?" is unambiguously no, so bringing the product back
   * is a separate, separately audited decision rather than something a restore
   * does silently.
   *
   * ## Why soft
   *
   * §9, three reasons, and none of them is squeamishness. Orders embed product
   * SNAPSHOTS so history survives either way — but analytics, reviews and
   * reporting still resolve the product id; SKUs and slugs must not become
   * silently reusable; and an accidental deletion of a catalogue item is
   * recoverable.
   *
   * The slug stays held. `slugRedirects` rows are NOT removed: the product is
   * recoverable, and dropping them would make a restore silently lose every old
   * URL that worked the day before.
   */
  async softDelete(id: Types.ObjectId, context: AdminWriteContext): Promise<ProductLean> {
    const actor = await this.resolveActor(context.actorId);
    const current = await this.findById(id);

    if (current.deletedAt !== null) {
      // Already gone. Refused rather than answered 200, for the same reason a
      // repeated order transition is: a caller that gets 200 twice cannot tell
      // whether it deleted once or twice, and the second answer would carry a
      // `deletedAt` from an operator who is not the one asking.
      throw AppException.productDeleted();
    }

    const updated =
      (await this.products
        .findOneAndUpdate(
          { _id: id, deletedAt: null },
          { $set: { deletedAt: new Date(), isActive: false } },
          { new: true },
        )
        .lean<ProductLean>()
        .exec()) ?? current;

    await this.recount(current, updated);

    await this.audit.record({
      actor: toAuditActor(actor),
      action: AuditAction.PRODUCT_DELETED,
      entity: { type: AuditEntityType.PRODUCT, id, label: updated.sku },
      changes: {
        before: { deletedAt: null, isActive: current.isActive },
        after: { deletedAt: updated.deletedAt, isActive: false },
      },
      /*
       * The slug and name are snapshotted into the record. §4 wants a log that
       * reads without joins, and this is the one action after which the entity
       * stops being visible in every listing an investigator would reach for.
       */
      metadata: { slug: updated.slug, name: updated.name.en },
      context: context.forensics,
    });

    return updated;
  }

  /**
   * Undoes a soft delete.
   *
   * The product comes back as a **draft** — `isActive` stays false. Restoring
   * does not republish, because putting a product back in front of customers is
   * a publication decision and AUDIT-MODEL.md §3 audits that separately. A
   * restore that also republished would record "restored" while doing something
   * the `PRODUCT_PUBLISHED` index is supposed to be the record of.
   *
   * It also means the operator gets to look at the product before customers do,
   * which is usually why it was deleted.
   */
  async restore(id: Types.ObjectId, context: AdminWriteContext): Promise<ProductLean> {
    const actor = await this.resolveActor(context.actorId);
    const current = await this.findById(id);

    if (current.deletedAt === null) {
      throw AppException.validation([
        { field: 'id', message: 'That product is not deleted.', code: 'STATE' },
      ]);
    }

    const updated =
      (await this.products
        .findOneAndUpdate({ _id: id }, { $set: { deletedAt: null } }, { new: true })
        .lean<ProductLean>()
        .exec()) ?? current;

    await this.recount(current, updated);

    await this.audit.record({
      actor: toAuditActor(actor),
      action: AuditAction.PRODUCT_RESTORED,
      entity: { type: AuditEntityType.PRODUCT, id, label: updated.sku },
      changes: { before: { deletedAt: current.deletedAt }, after: { deletedAt: null } },
      metadata: { slug: updated.slug, isActive: updated.isActive },
      context: context.forensics,
    });

    return updated;
  }

  /**
   * Brings `categories.productCount` and `brands.productCount` back into
   * agreement with the products, for the categories and brands this write
   * touched.
   *
   * ## Why it RECOMPUTES rather than adjusting by ±1
   *
   * Because the thing being counted is not "products", it is "products that are
   * published, not deleted, and in this subtree" — and a single write can move
   * a product across all three axes at once. A create can be published or a
   * draft; an edit can move a product between category subtrees of different
   * depths; publish, unpublish, delete and restore each flip its
   * countability without touching its category at all. An increment/decrement
   * scheme has to get every one of those combinations right, and every one it
   * gets wrong is a permanent drift that nothing detects, because a stale count
   * looks exactly like a real one.
   *
   * Recomputation cannot drift. The cost is one indexed `countDocuments` per
   * affected document, on an operator action that happens a few times an hour —
   * and both counts are served by an existing index prefix
   * (`product_category_price` leads with `{isActive, deletedAt, category.path}`,
   * `product_brand` with `{isActive, deletedAt, brand.id}`).
   *
   * ## Why the counts were stale before this
   *
   * `seed.ts` recomputed them and nothing else ever did — so until now a
   * product created through the API left every category and brand count
   * reporting the number it had at seed time. Both counts are PUBLIC: they are
   * on `CategoryResponseDto` and `BrandResponseDto`, and the storefront renders
   * them.
   *
   * The category count is a SUBTREE count, which is why the whole
   * `category.path` is recounted and not just the leaf: a product's path is the
   * inclusive chain, so a parent legitimately counts its children's products.
   */
  private async recount(before: ProductLean, after: ProductLean): Promise<void> {
    const categoryIds = new Map<string, Types.ObjectId>();
    const brandIds = new Map<string, Types.ObjectId>();

    for (const product of [before, after]) {
      for (const id of product.category.path) categoryIds.set(id.toHexString(), id);
      if (product.brand !== null) brandIds.set(product.brand.id.toHexString(), product.brand.id);
    }

    await Promise.all([
      ...[...categoryIds.values()].map(async (id) => {
        const count = await this.products
          .countDocuments({ isActive: true, deletedAt: null, 'category.path': id })
          .exec();

        await this.categories.updateOne({ _id: id }, { $set: { productCount: count } }).exec();
      }),
      ...[...brandIds.values()].map(async (id) => {
        const count = await this.products
          .countDocuments({ isActive: true, deletedAt: null, 'brand.id': id })
          .exec();

        await this.brands.updateOne({ _id: id }, { $set: { productCount: count } }).exec();
      }),
    ]);

    /*
     * The public category and brand lists are cached in-process for FIFTEEN
     * MINUTES (SEARCH-MODEL.md §11), and `productCount` is on both of them. The
     * cache's own `invalidate()` has carried the comment "called by catalogue
     * writes once they exist" since it was written; they exist now, and without
     * this call an operator watches the storefront disagree with the console
     * for a quarter of an hour after every publish.
     */
    this.categoriesCache.invalidateCache();
    this.brandsCache.invalidateCache();
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

/**
 * The fields of a product an audit diff is computed over.
 *
 * A projection, not the whole document, and the omissions are the point.
 * `stock`, `rating` and `salesCount` are written by OTHER modules, and a
 * concurrent sale landing between this read and the write would otherwise show
 * up as a spurious "change" inside a catalogue edit's audit row — an
 * investigator would read it as the operator having moved stock. `_id`,
 * `createdAt` and `updatedAt` carry nothing anybody looks for.
 *
 * `costPrice` IS included. §4's phrase is "`costPrice` in a customer-visible
 * context", and §8 restricts `auditLogs` to ADMIN — redacting it would hide the
 * before and after of a margin change from the only people entitled to see it,
 * which is the opposite of what auditing a money change is for.
 */
function auditableProduct(product: ProductLean): Record<string, unknown> {
  return {
    slug: product.slug,
    name: { en: product.name.en, ar: product.name.ar },
    shortDescription: product.shortDescription,
    description: product.description,
    category: { id: product.category.id.toHexString(), slug: product.category.slug },
    brand:
      product.brand === null
        ? null
        : { id: product.brand.id.toHexString(), slug: product.brand.slug },
    pricing: {
      basePrice: product.pricing.basePrice,
      salePrice: product.pricing.salePrice,
      effectivePrice: product.pricing.effectivePrice,
      costPrice: product.pricing.costPrice,
    },
    specs: product.specs.map((spec) => ({ key: spec.key, value: spec.value, unit: spec.unit })),
    seo: product.seo,
    weight: product.weight,
    dimensions: product.dimensions,
    isFeatured: product.isFeatured,
  };
}
