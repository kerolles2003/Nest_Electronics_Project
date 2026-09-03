import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { nextAvailableSlug, slugify } from '../domain/slug';
import { Brand } from '../infrastructure/schemas/brand.schema';
import { Category } from '../infrastructure/schemas/category.schema';
import { Product } from '../infrastructure/schemas/product.schema';

/**
 * Is this slug free, and if not, what is?
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §2 — collisions take a numeric
 * suffix "assigned under a uniqueness check".
 *
 * ## The defect this replaces
 *
 * The admin's `check-slug` route answered `{ exists: false }` on **every**
 * failure path — a database error, a missing service, an exception, anything.
 * `exists: false` means "the slug is free", so a check that could not reach the
 * database told the operator their slug was available. The form then submitted
 * and the write failed on the unique index, at which point the operator had
 * already filled in the rest of the product.
 *
 * A uniqueness check that answers "available" when it does not know is worse
 * than no check, because the form is built to trust it. **Nothing here catches
 * anything.** A failure propagates and the endpoint answers 5xx, which is the
 * honest answer to "I could not look".
 */

export type SluggableType = 'product' | 'category' | 'brand';

export interface SlugAvailability {
  readonly slug: string;
  readonly available: boolean;
  /**
   * A free alternative, present only when the requested slug is taken.
   *
   * The next numeric suffix, per §2 rule 2 — `esp32-devkit-2`, not a random
   * discriminator. Suffixes start at 2 because the unsuffixed slug is the
   * first; `esp32-devkit-1` beside `esp32-devkit` reads as though there were a
   * zeroth.
   */
  readonly suggestion: string | null;
}

@Injectable()
export class SlugService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(Category.name) private readonly categories: Model<Category>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
  ) {}

  /** Turns a display name into the slug it would get. */
  suggestFor(name: string): string {
    return slugify(name);
  }

  /**
   * @param excludeId The entity being edited, so it does not collide with
   *                  itself. Without it, opening a product and saving it
   *                  unchanged reports its own slug as taken.
   */
  async check(
    type: SluggableType,
    slug: string,
    excludeId?: Types.ObjectId,
  ): Promise<SlugAvailability> {
    const taken = await this.takenSlugs(type, slug, excludeId);

    if (!taken.has(slug)) {
      return { slug, available: true, suggestion: null };
    }

    return { slug, available: false, suggestion: nextAvailableSlug(slug, taken) };
  }

  /**
   * Every slug that would collide: the exact one, and the suffixed forms.
   *
   * One query rather than a probe per candidate. The alternative — ask whether
   * `x` is free, then `x-2`, then `x-3` — is a round trip per attempt and races
   * with any other operator doing the same thing.
   *
   * A soft-deleted entity still HOLDS its slug. §2's uniqueness is on the
   * collection, and CATALOG-MODEL.md §"SKUs and slugs must not be silently
   * reusable" says so directly: reusing the slug of a deleted product silently
   * repoints every existing link to a different product.
   */
  private async takenSlugs(
    type: SluggableType,
    slug: string,
    excludeId?: Types.ObjectId,
  ): Promise<Set<string>> {
    const model = this.modelFor(type);
    const filter: Record<string, unknown> = {
      // Anchored, and the slug is escaped by construction: it has already been
      // validated as `[a-z0-9-]+` by the DTO, so no character in it is
      // meaningful to a regular expression.
      slug: new RegExp(`^${slug}(-\\d+)?$`),
    };

    if (excludeId !== undefined) filter._id = { $ne: excludeId };

    const rows = await model.find(filter).select({ slug: 1 }).lean<{ slug: string }[]>().exec();

    return new Set(rows.map((row) => row.slug));
  }

  private modelFor(type: SluggableType): Model<Product | Category | Brand> {
    switch (type) {
      case 'product':
        return this.products as unknown as Model<Product | Category | Brand>;
      case 'category':
        return this.categories as unknown as Model<Product | Category | Brand>;
      case 'brand':
        return this.brands as unknown as Model<Product | Category | Brand>;
    }
  }
}
