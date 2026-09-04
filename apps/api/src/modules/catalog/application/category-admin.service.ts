import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import { AuditService, type AuditContext } from '../../audit/application/audit.service';
import { AuditAction, AuditEntityType } from '../../audit/domain/audit-action';
import { toAuditActor } from '../../audit/domain/audit-actor';
import { UsersService, type UserProfile } from '../../users/application/users.service';
import { Category, type CategoryLean } from '../infrastructure/schemas/category.schema';
import { Product } from '../infrastructure/schemas/product.schema';
import { SlugRedirectEntityType } from '../infrastructure/schemas/slug-redirect.schema';
import { CategoriesService } from './categories.service';
import { SlugRedirectService } from './slug-redirect.service';

const DUPLICATE_KEY = 11000;

/**
 * The deepest a category may sit, as `depth` — which is `path.length`, so a
 * root is 0.
 *
 * ## The two frozen documents do not say the same thing, and this is the
 * reading taken
 *
 * `MONGODB-DESIGN.md` §5: "Max depth 3 is enforced." Names the field, states a
 * number: `depth <= 3`.
 *
 * `CATALOG-MODEL.md` §6: "Max 3 levels enforced — the live tree uses 2." Read
 * as levels, three levels would be `depth <= 2`, and the live tree would
 * already be at the ceiling.
 *
 * They reconcile if "the live tree uses 2" means depth 2 — which it must,
 * because the same table's Live-shape row says "max depth 2" and Phase 0.5
 * measured it. So §6's "3 levels" is loose phrasing of §5's precise statement,
 * and `depth <= 3` is the rule both are describing. `category.schema.ts` had
 * already adopted that reading in a comment; this is the first code to enforce
 * it. **Flagged in the work log rather than settled quietly.**
 */
export const MAX_CATEGORY_DEPTH = 3;

export interface LocalizedInput {
  readonly en: string;
  readonly ar?: string | null;
}

export interface CreateCategoryInput {
  readonly slug: string;
  readonly name: LocalizedInput;
  readonly description?: LocalizedInput | null;
  readonly parentId?: string | null;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
}

export interface UpdateCategoryInput {
  readonly slug?: string;
  readonly name?: LocalizedInput;
  readonly description?: LocalizedInput | null;
  readonly parentId?: string | null;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
}

export interface AdminWriteContext {
  readonly actorId: Types.ObjectId;
  readonly forensics: AuditContext;
}

/**
 * Category writes: the tree, and everything that has to move with it.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §6 (tree, snapshots), §2
 *            (slugs), §9 (deletion); MONGODB-DESIGN.md §5.
 *
 * ## Three things change when one category does, and forgetting any of them is
 * a silent defect
 *
 * 1. **The category's own `path` and `depth`**, and those of every descendant.
 *    `path[]` is materialised precisely because MongoDB has no recursive CTE;
 *    the price of that is that a reparent has to rewrite the subtree by hand.
 * 2. **Every product's `category` snapshot.** §6 states the mechanism
 *    explicitly — "renaming a category triggers `updateMany({'category.id': X},
 *    …)`" — and calls the staleness window one operation on a display label.
 *    A product's snapshot `path` also has to move on a reparent, because that
 *    array is what a subtree query matches.
 * 3. **The cached category list.** Fifteen minutes, in-process.
 *
 * A rename that updated the category and not the products would leave every
 * product card showing the old category name until something else rewrote it —
 * which is nothing, because nothing else rewrites it.
 */
@Injectable()
export class CategoryAdminService {
  constructor(
    @InjectModel(Category.name) private readonly categories: Model<Category>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    private readonly users: UsersService,
    private readonly redirects: SlugRedirectService,
    private readonly cache: CategoriesService,
    private readonly audit: AuditService,
  ) {}

  /** The whole tree as an operator sees it: inactive included, deleted on request. */
  async list(includeDeleted: boolean): Promise<readonly CategoryLean[]> {
    const filter: FilterQuery<Category> = includeDeleted ? {} : { deletedAt: null };

    return this.categories
      .find(filter)
      .sort({ depth: 1, sortOrder: 1, 'name.en': 1 })
      .lean<CategoryLean[]>()
      .exec();
  }

  async findById(id: Types.ObjectId): Promise<CategoryLean> {
    const category = await this.categories.findById(id).lean<CategoryLean>().exec();

    if (category === null) throw AppException.categoryNotFound();

    return category;
  }

  async create(input: CreateCategoryInput, context: AdminWriteContext): Promise<CategoryLean> {
    const actor = await this.resolveActor(context.actorId);
    const parent = await this.resolveParent(input.parentId ?? null);
    const path = parent === null ? [] : [...parent.path, parent._id];

    assertDepth(path.length, 'parentId');

    let created: CategoryLean;

    try {
      const document = await this.categories.create({
        slug: input.slug,
        name: toLocalized(input.name),
        description: input.description == null ? null : toLocalized(input.description),
        parentId: parent?._id ?? null,
        path,
        depth: path.length,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      });

      created = document.toObject<CategoryLean>();
    } catch (error) {
      throw translateDuplicateSlug(error, input.slug);
    }

    this.cache.invalidateCache();

    await this.audit.record({
      actor: toAuditActor(actor),
      action: AuditAction.CATEGORY_CREATED,
      entity: { type: AuditEntityType.CATEGORY, id: created._id, label: created.slug },
      metadata: {
        name: created.name.en,
        parentId: created.parentId?.toHexString() ?? null,
        depth: created.depth,
      },
      context: context.forensics,
    });

    return created;
  }

  /**
   * Renames, reparents, or both — and moves everything that has to move.
   */
  async update(
    id: Types.ObjectId,
    input: UpdateCategoryInput,
    context: AdminWriteContext,
  ): Promise<CategoryLean> {
    const actor = await this.resolveActor(context.actorId);
    const current = await this.findById(id);

    if (current.deletedAt !== null) throw AppException.categoryDeleted();

    const set: Record<string, unknown> = {};

    if (input.slug !== undefined) set.slug = input.slug;
    if (input.name !== undefined) set.name = toLocalized(input.name);
    if (input.description !== undefined) {
      set.description = input.description === null ? null : toLocalized(input.description);
    }
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) set.isActive = input.isActive;

    /*
     * The subtree, loaded once. It is needed for cycle detection, for the depth
     * check on the DEEPEST descendant, and for the path rewrite — three
     * questions, one read, over a collection whose live size is 27.
     */
    const descendants =
      input.parentId === undefined
        ? []
        : await this.categories.find({ path: id, deletedAt: null }).lean<CategoryLean[]>().exec();

    let newPath = current.path;

    if (input.parentId !== undefined) {
      const parent = await this.resolveParent(input.parentId);

      assertNotACycle(id, parent, descendants);

      newPath = parent === null ? [] : [...parent.path, parent._id];

      // The check is on the deepest DESCENDANT, not on the category being
      // moved. Moving a two-level subtree one level down is legal only if the
      // bottom of it still fits.
      const deepest = descendants.reduce((max, node) => Math.max(max, node.depth), current.depth);

      assertDepth(newPath.length + (deepest - current.depth), 'parentId');

      set.parentId = parent?._id ?? null;
      set.path = newPath;
      set.depth = newPath.length;
    }

    let updated: CategoryLean;

    try {
      updated =
        (await this.categories
          .findOneAndUpdate({ _id: id }, { $set: set }, { new: true })
          .lean<CategoryLean>()
          .exec()) ?? current;
    } catch (error) {
      throw translateDuplicateSlug(error, input.slug ?? current.slug);
    }

    if (input.parentId !== undefined) {
      await this.rewriteSubtree(current, updated, descendants);
    }

    if (input.slug !== undefined && input.slug !== current.slug) {
      await this.redirects.record({
        entityType: SlugRedirectEntityType.CATEGORY,
        entityId: id,
        oldSlug: current.slug,
        newSlug: input.slug,
      });
    }

    await this.refreshProductSnapshots(updated);

    this.cache.invalidateCache();

    await this.audit.recordChange({
      actor: toAuditActor(actor),
      action: AuditAction.CATEGORY_UPDATED,
      entity: { type: AuditEntityType.CATEGORY, id, label: updated.slug },
      before: auditableCategory(current),
      after: auditableCategory(updated),
      context: context.forensics,
    });

    return updated;
  }

  /**
   * Soft-deletes an EMPTY category.
   *
   * Refused while products or live child categories still point at it, and the
   * refusal names both counts. A cascade was rejected: it would soft-delete a
   * subtree in one click with no way for the operator to know what went with
   * it, and every product left behind would be filed under a category that
   * renders nowhere — the same state `POST /admin/catalog/products` already
   * refuses to create, which would make it reachable by a different door.
   */
  async softDelete(id: Types.ObjectId, context: AdminWriteContext): Promise<CategoryLean> {
    const actor = await this.resolveActor(context.actorId);
    const current = await this.findById(id);

    if (current.deletedAt !== null) throw AppException.categoryDeleted();

    const [productCount, childCount] = await Promise.all([
      // Products directly in it. A child category's products belong to the
      // child, and the child is counted separately below — reporting them here
      // as well would tell the operator to move products they cannot see.
      this.products.countDocuments({ 'category.id': id, deletedAt: null }).exec(),
      this.categories.countDocuments({ parentId: id, deletedAt: null }).exec(),
    ]);

    if (productCount > 0 || childCount > 0) {
      throw AppException.categoryNotEmpty(productCount, childCount);
    }

    const updated =
      (await this.categories
        .findOneAndUpdate(
          { _id: id, deletedAt: null },
          { $set: { deletedAt: new Date(), isActive: false } },
          { new: true },
        )
        .lean<CategoryLean>()
        .exec()) ?? current;

    this.cache.invalidateCache();

    await this.audit.record({
      actor: toAuditActor(actor),
      action: AuditAction.CATEGORY_DELETED,
      entity: { type: AuditEntityType.CATEGORY, id, label: updated.slug },
      changes: { before: { deletedAt: null }, after: { deletedAt: updated.deletedAt } },
      metadata: { name: updated.name.en },
      context: context.forensics,
    });

    return updated;
  }

  /**
   * Undoes a soft delete.
   *
   * ## Why this exists now rather than earlier
   *
   * Because the API already promised it. `PATCH /admin/catalog/categories/:id`
   * answers a deleted category with `CATEGORY_DELETED — restore it first`, and
   * there was no "first" to do: the only way out of a soft delete was a
   * database edit. Meanwhile the delete keeps the slug reserved — deliberately,
   * because reusing it would repoint existing links — so a mis-click cost the
   * name permanently.
   *
   * ## It comes back INACTIVE, and under a live parent or not at all
   *
   * `softDelete` sets `isActive: false` alongside `deletedAt`, and restore
   * leaves it false: the category returns to the editor, not to the storefront.
   * That mirrors `ProductAdminService.restore`, which deliberately does not
   * republish.
   *
   * A category whose PARENT is still deleted is refused. `path[]` is the
   * materialised ancestor chain, and a chain through a deleted node names a
   * category that renders nowhere — the tree read would either drop the branch
   * or show a child with no visible parent. Restoring the parent first is the
   * answer, and the message says so.
   */
  async restore(id: Types.ObjectId, context: AdminWriteContext): Promise<CategoryLean> {
    const actor = await this.resolveActor(context.actorId);
    const current = await this.findById(id);

    if (current.deletedAt === null) {
      throw AppException.validation([
        { field: 'id', message: 'That category is not deleted.', code: 'STATE' },
      ]);
    }

    if (current.parentId !== null) {
      const parent = await this.categories
        .findOne({ _id: current.parentId })
        .lean<CategoryLean>()
        .exec();

      if (parent === null || parent.deletedAt !== null) {
        throw AppException.validation([
          {
            field: 'parentId',
            message:
              'Its parent category is deleted, so restoring this one would file it under a ' +
              'category that renders nowhere. Restore the parent first.',
            code: 'PARENT_DELETED',
          },
        ]);
      }
    }

    const updated =
      (await this.categories
        .findOneAndUpdate({ _id: id }, { $set: { deletedAt: null } }, { new: true })
        .lean<CategoryLean>()
        .exec()) ?? current;

    this.cache.invalidateCache();

    await this.audit.record({
      actor: toAuditActor(actor),
      action: AuditAction.CATEGORY_RESTORED,
      entity: { type: AuditEntityType.CATEGORY, id, label: updated.slug },
      changes: { before: { deletedAt: current.deletedAt }, after: { deletedAt: null } },
      metadata: { name: updated.name.en, isActive: updated.isActive },
      context: context.forensics,
    });

    return updated;
  }

  private async resolveActor(actorId: Types.ObjectId): Promise<UserProfile> {
    const profile = await this.users.findById(actorId);

    if (profile === null) throw AppException.accountDisabled();

    return profile;
  }

  /** `null` means "make it a root". A soft-deleted parent is refused. */
  private async resolveParent(parentId: string | null): Promise<CategoryLean | null> {
    if (parentId === null) return null;

    const parent = await this.categories
      .findOne({ _id: new Types.ObjectId(parentId), deletedAt: null })
      .lean<CategoryLean>()
      .exec();

    if (parent === null) throw AppException.categoryNotFound();

    return parent;
  }

  /**
   * Rewrites `path` and `depth` for every descendant after a reparent.
   *
   * Each descendant's path is `[...the moved category's new inclusive path,
   * ...whatever came AFTER the moved category in its old path]`. Splicing at
   * the position of the moved id — rather than assuming the descendant is a
   * direct child — is what makes this correct for a subtree more than one level
   * deep.
   *
   * `bulkWrite` because the paths differ per document, so there is no single
   * `updateMany` that expresses it. One round trip either way.
   */
  private async rewriteSubtree(
    before: CategoryLean,
    after: CategoryLean,
    descendants: readonly CategoryLean[],
  ): Promise<void> {
    if (descendants.length === 0) return;

    const inclusive = [...after.path, after._id];
    const operations = descendants.map((node) => {
      const cut = node.path.findIndex((ancestor) => ancestor.equals(before._id));
      const tail = cut === -1 ? [] : node.path.slice(cut + 1);
      const path = [...inclusive, ...tail];

      return {
        updateOne: {
          filter: { _id: node._id },
          update: { $set: { path, depth: path.length } },
        },
      };
    });

    await this.categories.bulkWrite(operations);

    // Every descendant's own products carry that descendant's inclusive path,
    // so each one needs its snapshot rewritten too — not just the category that
    // moved. Missing this leaves a subtree query returning products from the
    // tree's old shape.
    const moved = await this.categories
      .find({ _id: { $in: descendants.map((node) => node._id) } })
      .lean<CategoryLean[]>()
      .exec();

    for (const node of moved) {
      await this.refreshProductSnapshots(node);
    }
  }

  /**
   * Pushes a category's current identity into every product that references it.
   *
   * §6's stated mechanism, and §4's field-ownership rule: the snapshot is
   * written by CatalogModule and refreshed by a targeted `updateMany` when the
   * parent changes. Rare, bounded by the number of products in one category,
   * and it touches a display label plus the subtree key — never money, stock or
   * identity.
   */
  private async refreshProductSnapshots(category: CategoryLean): Promise<void> {
    await this.products
      .updateMany(
        { 'category.id': category._id },
        {
          $set: {
            'category.slug': category.slug,
            'category.name': { en: category.name.en, ar: category.name.ar },
            'category.path': [...category.path, category._id],
          },
        },
      )
      .exec();
  }
}

// --- pure helpers -----------------------------------------------------------

function toLocalized(input: LocalizedInput): { en: string; ar: string | null } {
  return { en: input.en, ar: input.ar ?? null };
}

function assertDepth(depth: number, field: string): void {
  if (depth > MAX_CATEGORY_DEPTH) {
    throw AppException.validation([
      {
        field,
        message:
          `That would put the category at depth ${String(depth)}; the limit is ` +
          `${String(MAX_CATEGORY_DEPTH)}. A deeper tree is a navigation smell — the live tree ` +
          'is two levels.',
        code: 'MAX_DEPTH',
      },
    ]);
  }
}

/**
 * Refuses a move that would make a category its own ancestor.
 *
 * Mandatory per §6, and the reason is not tidiness: a cycle makes `path[]`
 * unwritable — there is no finite ancestor chain — and every tree read
 * afterwards either loops or silently drops the branch. Both cases are checked:
 * a category cannot become its own parent, and it cannot be moved under one of
 * its own descendants.
 */
function assertNotACycle(
  id: Types.ObjectId,
  parent: CategoryLean | null,
  descendants: readonly CategoryLean[],
): void {
  if (parent === null) return;

  const isSelf = parent._id.equals(id);
  const isDescendant = descendants.some((node) => node._id.equals(parent._id));

  if (isSelf || isDescendant) {
    throw AppException.validation([
      {
        field: 'parentId',
        message: isSelf
          ? 'A category cannot be its own parent.'
          : 'A category cannot be moved underneath one of its own subcategories.',
        code: 'CYCLE',
      },
    ]);
  }
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

function auditableCategory(category: CategoryLean): Record<string, unknown> {
  return {
    slug: category.slug,
    name: { en: category.name.en, ar: category.name.ar },
    description: category.description,
    parentId: category.parentId?.toHexString() ?? null,
    depth: category.depth,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
  };
}
