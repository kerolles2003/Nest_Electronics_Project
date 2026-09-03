import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import { Brand, BrandLean } from '../infrastructure/schemas/brand.schema';
import { CATALOG_CACHE_TTL_MS, TtlCache } from './ttl-cache';

/**
 * Brands. Flat, tiny (17 live) and static enough to cache for 15 minutes.
 * No repository — see CODEBASE-STRUCTURE.md §6.2.
 */
@Injectable()
export class BrandsService {
  private readonly cache = new TtlCache<BrandLean[]>(CATALOG_CACHE_TTL_MS);

  constructor(@InjectModel(Brand.name) private readonly model: Model<Brand>) {}

  async listAll(): Promise<readonly BrandLean[]> {
    return this.cache.get(async () =>
      this.model
        .find({ isActive: true, deletedAt: null })
        .sort({ 'name.en': 1 })
        .lean<BrandLean[]>()
        .exec(),
    );
  }

  async findBySlug(slug: string): Promise<BrandLean> {
    const brands = await this.listAll();
    const brand = brands.find((candidate) => candidate.slug === slug);

    if (brand === undefined) {
      throw AppException.brandNotFound();
    }

    return brand;
  }

  /**
   * Slugs to ids, for the product filter.
   *
   * Resolving here rather than filtering products by `brand.slug` is what keeps
   * the frozen `{ isActive, deletedAt, 'brand.id' }` index usable. The lookup is
   * free: the brand list is already cached in memory.
   *
   * An unknown slug simply contributes no id, so it narrows to zero results
   * rather than being silently ignored.
   */
  async findIdsBySlugs(slugs: readonly string[]): Promise<Types.ObjectId[]> {
    const brands = await this.listAll();
    const bySlug = new Map(brands.map((brand) => [brand.slug, brand._id]));

    return slugs
      .map((slug) => bySlug.get(slug))
      .filter((id): id is Types.ObjectId => id !== undefined);
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
}
