import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import { AuditService, type AuditContext } from '../../audit/application/audit.service';
import { AuditAction, AuditEntityType } from '../../audit/domain/audit-action';
import { toAuditActor } from '../../audit/domain/audit-actor';
import { UsersService, type UserProfile } from '../../users/application/users.service';
import { Brand, type BrandLean } from '../infrastructure/schemas/brand.schema';
import { Product } from '../infrastructure/schemas/product.schema';
import { SlugRedirectEntityType } from '../infrastructure/schemas/slug-redirect.schema';
import { BrandsService } from './brands.service';
import { SlugRedirectService } from './slug-redirect.service';

const DUPLICATE_KEY = 11000;

export interface LocalizedInput {
  readonly en: string;
  readonly ar?: string | null;
}

export interface CreateBrandInput {
  readonly slug: string;
  readonly name: LocalizedInput;
  readonly description?: LocalizedInput | null;
  readonly website?: string | null;
  readonly isActive?: boolean;
}

export interface UpdateBrandInput {
  readonly slug?: string;
  readonly name?: LocalizedInput;
  readonly description?: LocalizedInput | null;
  readonly website?: string | null;
  readonly isActive?: boolean;
}

export interface AdminWriteContext {
  readonly actorId: Types.ObjectId;
  readonly forensics: AuditContext;
}

/**
 * Brand writes.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §6 (brands, snapshots), §2
 *            (slugs), §9 (deletion).
 *
 * ## Why this is a much smaller class than its category counterpart
 *
 * Brands are a FLAT list — no `parentId`, no `path`, no reparenting, no cycle
 * detection, no depth limit and no subtree to rewrite. §6 says so in one line,
 * and that one line is the difference between two hundred lines and sixty.
 *
 * What it keeps is the part that is not about hierarchy: the denormalised
 * snapshot on every product has to follow a rename, and a brand slug that moves
 * has to leave a redirect behind.
 *
 * ## Deleting a brand does NOT refuse when products reference it
 *
 * Unlike a category, and the asymmetry is deliberate. `product.brand` is
 * NULLABLE by design — 53 of 85 live products have no brand and every listing
 * already renders without one — so a product whose brand goes away is in a
 * state the whole system already handles. A category is required; a product
 * cannot be un-categorised, which is why that deletion is refused instead.
 *
 * So this CLEARS the snapshot on every product that referenced the brand,
 * rather than leaving them pointing at a brand that renders nowhere.
 */
@Injectable()
export class BrandAdminService {
  constructor(
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    private readonly users: UsersService,
    private readonly redirects: SlugRedirectService,
    private readonly cache: BrandsService,
    private readonly audit: AuditService,
  ) {}

  async list(includeDeleted: boolean): Promise<readonly BrandLean[]> {
    const filter: FilterQuery<Brand> = includeDeleted ? {} : { deletedAt: null };

    return this.brands.find(filter).sort({ 'name.en': 1 }).lean<BrandLean[]>().exec();
  }

  async findById(id: Types.ObjectId): Promise<BrandLean> {
    const brand = await this.brands.findById(id).lean<BrandLean>().exec();

    if (brand === null) throw AppException.brandNotFound();

    return brand;
  }

  async create(input: CreateBrandInput, context: AdminWriteContext): Promise<BrandLean> {
    const actor = await this.resolveActor(context.actorId);

    let created: BrandLean;

    try {
      const document = await this.brands.create({
        slug: input.slug,
        name: toLocalized(input.name),
        description: input.description == null ? null : toLocalized(input.description),
        website: input.website ?? null,
        isActive: input.isActive ?? true,
      });

      created = document.toObject<BrandLean>();
    } catch (error) {
      throw translateDuplicateSlug(error, input.slug);
    }

    this.cache.invalidateCache();

    await this.audit.record({
      actor: toAuditActor(actor),
      action: AuditAction.BRAND_CREATED,
      entity: { type: AuditEntityType.BRAND, id: created._id, label: created.slug },
      metadata: { name: created.name.en },
      context: context.forensics,
    });

    return created;
  }

  async update(
    id: Types.ObjectId,
    input: UpdateBrandInput,
    context: AdminWriteContext,
  ): Promise<BrandLean> {
    const actor = await this.resolveActor(context.actorId);
    const current = await this.findById(id);

    if (current.deletedAt !== null) throw AppException.brandDeleted();

    const set: Record<string, unknown> = {};

    if (input.slug !== undefined) set.slug = input.slug;
    if (input.name !== undefined) set.name = toLocalized(input.name);
    if (input.description !== undefined) {
      set.description = input.description === null ? null : toLocalized(input.description);
    }
    if (input.website !== undefined) set.website = input.website;
    if (input.isActive !== undefined) set.isActive = input.isActive;

    let updated: BrandLean;

    try {
      updated =
        (await this.brands
          .findOneAndUpdate({ _id: id }, { $set: set }, { new: true })
          .lean<BrandLean>()
          .exec()) ?? current;
    } catch (error) {
      throw translateDuplicateSlug(error, input.slug ?? current.slug);
    }

    if (input.slug !== undefined && input.slug !== current.slug) {
      await this.redirects.record({
        entityType: SlugRedirectEntityType.BRAND,
        entityId: id,
        oldSlug: current.slug,
        newSlug: input.slug,
      });
    }

    // §6: "renaming a brand triggers updateMany({'brand.id': X}, …)". Without
    // it every product card keeps showing the old brand name, because nothing
    // else ever rewrites that snapshot.
    await this.products
      .updateMany(
        { 'brand.id': id },
        {
          $set: {
            'brand.slug': updated.slug,
            'brand.name': { en: updated.name.en, ar: updated.name.ar },
          },
        },
      )
      .exec();

    this.cache.invalidateCache();

    await this.audit.recordChange({
      actor: toAuditActor(actor),
      action: AuditAction.BRAND_UPDATED,
      entity: { type: AuditEntityType.BRAND, id, label: updated.slug },
      before: auditableBrand(current),
      after: auditableBrand(updated),
      context: context.forensics,
    });

    return updated;
  }

  /**
   * Soft-deletes a brand and un-brands its products.
   *
   * The products are NOT deleted and are NOT refused. `product.brand` is
   * nullable by design and most of the catalogue has no brand at all, so
   * clearing the snapshot puts those products in a state every listing already
   * renders. Leaving them pointing at a deleted brand would not: the brand
   * facet would offer a filter that returns products whose brand page 404s.
   *
   * How many products were un-branded is returned in the audit metadata,
   * because it is the consequence an operator did not explicitly ask for.
   */
  async softDelete(id: Types.ObjectId, context: AdminWriteContext): Promise<BrandLean> {
    const actor = await this.resolveActor(context.actorId);
    const current = await this.findById(id);

    if (current.deletedAt !== null) throw AppException.brandDeleted();

    const updated =
      (await this.brands
        .findOneAndUpdate(
          { _id: id, deletedAt: null },
          { $set: { deletedAt: new Date(), isActive: false, productCount: 0 } },
          { new: true },
        )
        .lean<BrandLean>()
        .exec()) ?? current;

    const detached = await this.products.updateMany({ 'brand.id': id }, { $set: { brand: null } }).exec();

    this.cache.invalidateCache();

    await this.audit.record({
      actor: toAuditActor(actor),
      action: AuditAction.BRAND_DELETED,
      entity: { type: AuditEntityType.BRAND, id, label: updated.slug },
      changes: { before: { deletedAt: null }, after: { deletedAt: updated.deletedAt } },
      metadata: { name: updated.name.en, productsUnbranded: detached.modifiedCount },
      context: context.forensics,
    });

    return updated;
  }

  private async resolveActor(actorId: Types.ObjectId): Promise<UserProfile> {
    const profile = await this.users.findById(actorId);

    if (profile === null) throw AppException.accountDisabled();

    return profile;
  }
}

function toLocalized(input: LocalizedInput): { en: string; ar: string | null } {
  return { en: input.en, ar: input.ar ?? null };
}

function translateDuplicateSlug(error: unknown, slug: string): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === DUPLICATE_KEY
  ) {
    return AppException.duplicateSlug(slug);
  }

  return error;
}

function auditableBrand(brand: BrandLean): Record<string, unknown> {
  return {
    slug: brand.slug,
    name: { en: brand.name.en, ar: brand.name.ar },
    description: brand.description,
    website: brand.website,
    isActive: brand.isActive,
  };
}
