import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import { Category, CategoryLean } from '../infrastructure/schemas/category.schema';
import { CATALOG_CACHE_TTL_MS, TtlCache } from './ttl-cache';

export interface CategoryWithBreadcrumb {
  readonly category: CategoryLean;
  readonly breadcrumb: readonly CategoryLean[];
}

/**
 * Categories. No repository: the access surface is `find` and `findOne`, and
 * CODEBASE-STRUCTURE.md §6.2 is explicit that a repository here would be a
 * one-line wrapper with no purpose.
 */
@Injectable()
export class CategoriesService {
  private readonly cache = new TtlCache<CategoryLean[]>(CATALOG_CACHE_TTL_MS);

  constructor(@InjectModel(Category.name) private readonly model: Model<Category>) {}

  /**
   * Every visible category, ordered for display.
   *
   * ONE find() over the whole collection — 27 rows live — is cheaper than any
   * tree query, and it is what makes in-memory assembly the right answer.
   */
  async listAll(): Promise<readonly CategoryLean[]> {
    return this.cache.get(async () =>
      this.model
        .find({ isActive: true, deletedAt: null })
        .sort({ depth: 1, sortOrder: 1, 'name.en': 1 })
        .lean<CategoryLean[]>()
        .exec(),
    );
  }


  /**
   * Drops the cached list, so the next read sees the write that just happened.
   *
   * The TTL is 15 minutes (SEARCH-MODEL.md §11), which is right for a list that
   * barely changes and wrong for the moment it does: without this, an operator
   * who creates a category, moves a product or publishes one watches the
   * storefront disagree with the admin console for a quarter of an hour and
   * reasonably concludes the save did not work.
   *
   * In-process, so it clears this instance only. Multi-instance deployment is
   * a Redis trigger (REDIS-DECISION.md) and stays out of scope here — but it is
   * worth naming, because on a second instance the stale window returns.
   */
  invalidateCache(): void {
    this.cache.invalidate();
  }

  /** Roots first, each carrying its children. Assembled in memory from one read. */
  async tree(): Promise<readonly TreeNode[]> {
    const categories = await this.listAll();
    const nodes = new Map<string, TreeNode>(
      categories.map((category) => [category._id.toHexString(), { category, children: [] }]),
    );

    const roots: TreeNode[] = [];

    for (const node of nodes.values()) {
      const parentId = node.category.parentId;
      const parent = parentId === null ? undefined : nodes.get(parentId.toHexString());

      // A child whose parent is hidden is promoted to a root rather than
      // silently vanishing from navigation.
      if (parent === undefined) {
        roots.push(node);
      } else {
        parent.children.push(node);
      }
    }

    return roots;
  }

  /** Resolves a slug to its id, for the product subtree filter. Null when unknown. */
  async findIdBySlug(slug: string): Promise<Types.ObjectId | null> {
    const categories = await this.listAll();
    return categories.find((category) => category.slug === slug)?._id ?? null;
  }

  /** Detail plus ancestors, root first. Throws CATEGORY_NOT_FOUND for an unknown slug. */
  async findBySlug(slug: string): Promise<CategoryWithBreadcrumb> {
    const categories = await this.listAll();
    const category = categories.find((candidate) => candidate.slug === slug);

    if (category === undefined) {
      throw AppException.categoryNotFound();
    }

    const byId = new Map(categories.map((candidate) => [candidate._id.toHexString(), candidate]));
    const breadcrumb = category.path
      .map((ancestorId) => byId.get(ancestorId.toHexString()))
      .filter((ancestor): ancestor is CategoryLean => ancestor !== undefined);

    return { category, breadcrumb };
  }
}

export interface TreeNode {
  readonly category: CategoryLean;
  readonly children: TreeNode[];
}
