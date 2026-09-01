import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { AppModule } from '../../app.module';
import { appConfig, type AppConfig } from '../../config/app.config';
import { Brand } from '../../modules/catalog/infrastructure/schemas/brand.schema';
import { Category } from '../../modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../modules/catalog/infrastructure/schemas/product.schema';
import { SEED_BRANDS, SEED_CATEGORIES, SEED_PRODUCTS, type SeedProduct } from './catalog.seed-data';

/**
 * Development catalogue seed.
 *
 * IDEMPOTENT: every entity is upserted by its slug, so running it twice leaves
 * the database in the same state. It never drops a collection and never issues
 * an unfiltered delete — a seed that can destroy data it did not create is a
 * production incident waiting for someone to run the wrong command.
 *
 * This is NOT a migration and imports nothing from the legacy system. The frozen
 * architecture starts from a clean database.
 *
 *   pnpm --filter api seed
 */

const logger = new Logger('Seed');

/**
 * The persisted image array for one product.
 *
 * `sortOrder` and `isPrimary` live on the element rather than beside the array
 * (CATALOG-MODEL.md §8), so a reorder is one atomic `$set` of the whole array.
 * The invariant this enforces is "EXACTLY one primary when there is at least
 * one image": the seed data does not state which is primary, and inferring it
 * from position is the only rule that cannot produce zero or two.
 */
function imagesOf(product: SeedProduct): {
  publicId: string;
  version: number;
  format: string;
  width: number;
  height: number;
  bytes: number;
  alt: string | null;
  sortOrder: number;
  isPrimary: boolean;
}[] {
  return (product.images ?? []).map((asset, index) => ({
    ...asset,
    sortOrder: index,
    isPrimary: index === 0,
  }));
}

/** `salePrice ?? basePrice`, asserted rather than assumed. */
function effectivePriceOf(product: SeedProduct): number {
  const { basePrice, salePrice } = product;

  if (basePrice <= 0) {
    throw new Error(`${product.sku}: basePrice must be greater than zero`);
  }

  if (salePrice !== null && (salePrice <= 0 || salePrice >= basePrice)) {
    // CATALOG-MODEL.md §5: if salePrice is set then 0 < salePrice < basePrice.
    throw new Error(`${product.sku}: salePrice must be greater than 0 and less than basePrice`);
  }

  return salePrice ?? basePrice;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const config = app.get<AppConfig>(appConfig.KEY);

    if (config.nodeEnv === 'production') {
      // A seed is development data. Refusing here is cheaper than explaining
      // later why a production catalogue contains an Arduino Uno.
      logger.error('refusing to seed: NODE_ENV=production');
      process.exitCode = 1;
      return;
    }

    const categories = app.get<Model<Category>>(getModelToken(Category.name));
    const brands = app.get<Model<Brand>>(getModelToken(Brand.name));
    const products = app.get<Model<Product>>(getModelToken(Product.name));

    // --- Categories: roots first, so a child can resolve its parent ---------
    const categoryIdBySlug = new Map<string, Types.ObjectId>();
    const categoryPathBySlug = new Map<string, Types.ObjectId[]>();

    const ordered = [...SEED_CATEGORIES].sort(
      (a, b) => Number(a.parentSlug !== null) - Number(b.parentSlug !== null),
    );

    for (const seed of ordered) {
      const parentId = seed.parentSlug === null ? null : categoryIdBySlug.get(seed.parentSlug);

      if (parentId === undefined) {
        throw new Error(`category ${seed.slug}: unknown parent ${String(seed.parentSlug)}`);
      }

      // `path` on the CATEGORY is ancestors only, root first — that is what a
      // breadcrumb needs. The product snapshot carries the inclusive chain.
      const parentPath = seed.parentSlug === null ? [] : (categoryPathBySlug.get(seed.parentSlug) ?? []);
      const path = parentId === null ? [] : [...parentPath, parentId];

      const saved = await categories
        .findOneAndUpdate(
          { slug: seed.slug },
          {
            $set: {
              slug: seed.slug,
              name: { en: seed.name, ar: null },
              description: { en: seed.description, ar: null },
              parentId,
              path,
              depth: path.length,
              sortOrder: seed.sortOrder,
              isActive: true,
              deletedAt: null,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
        )
        .exec();

      if (saved === null) {
        throw new Error(`category ${seed.slug}: upsert returned no document`);
      }

      categoryIdBySlug.set(seed.slug, saved._id);
      categoryPathBySlug.set(seed.slug, path);
    }

    logger.log(`categories  ${String(SEED_CATEGORIES.length)} upserted`);

    // --- Brands ------------------------------------------------------------
    const brandIdBySlug = new Map<string, Types.ObjectId>();

    for (const seed of SEED_BRANDS) {
      const saved = await brands
        .findOneAndUpdate(
          { slug: seed.slug },
          {
            $set: {
              slug: seed.slug,
              name: { en: seed.name, ar: null },
              description: { en: seed.description, ar: null },
              website: seed.website,
              isActive: true,
              deletedAt: null,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
        )
        .exec();

      if (saved === null) {
        throw new Error(`brand ${seed.slug}: upsert returned no document`);
      }

      brandIdBySlug.set(seed.slug, saved._id);
    }

    logger.log(`brands      ${String(SEED_BRANDS.length)} upserted`);

    // --- Products ----------------------------------------------------------
    for (const seed of SEED_PRODUCTS) {
      const categoryId = categoryIdBySlug.get(seed.categorySlug);
      const categorySeed = SEED_CATEGORIES.find((entry) => entry.slug === seed.categorySlug);

      if (categoryId === undefined || categorySeed === undefined) {
        throw new Error(`${seed.sku}: unknown category ${seed.categorySlug}`);
      }

      const brandId = seed.brandSlug === null ? null : brandIdBySlug.get(seed.brandSlug);
      const brandSeed =
        seed.brandSlug === null ? null : SEED_BRANDS.find((entry) => entry.slug === seed.brandSlug);

      if (brandId === undefined || brandSeed === undefined) {
        throw new Error(`${seed.sku}: unknown brand ${String(seed.brandSlug)}`);
      }

      // The FULL chain including the product's own category, so a subtree
      // filter is a single indexed match.
      const ancestors = categoryPathBySlug.get(seed.categorySlug) ?? [];

      await products
        .findOneAndUpdate(
          { slug: seed.slug },
          {
            $set: {
              sku: seed.sku,
              slug: seed.slug,
              name: { en: seed.name, ar: null },
              shortDescription: { en: seed.shortDescription, ar: null },
              description: { en: seed.description, ar: null },
              category: {
                id: categoryId,
                slug: categorySeed.slug,
                name: { en: categorySeed.name, ar: null },
                path: [...ancestors, categoryId],
              },
              brand:
                brandId === null || brandSeed === null
                  ? null
                  : {
                      id: brandId,
                      slug: brandSeed.slug,
                      name: { en: brandSeed.name, ar: null },
                    },
              pricing: {
                basePrice: seed.basePrice,
                salePrice: seed.salePrice,
                effectivePrice: effectivePriceOf(seed),
                costPrice: seed.costPrice,
              },
              currency: 'EGP',
              stock: { onHand: seed.onHand, lowStockThreshold: seed.lowStockThreshold },
              images: imagesOf(seed),
              specs: seed.specs.map((entry, index) => ({ ...entry, sortOrder: index })),
              rating: {
                average: seed.ratingAverage,
                count: seed.ratingCount,
                distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
              },
              salesCount: seed.salesCount,
              isActive: true,
              isFeatured: seed.isFeatured,
              deletedAt: null,
              weight: seed.weight,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
        )
        .exec();
    }

    const withImages = SEED_PRODUCTS.filter((entry) => (entry.images?.length ?? 0) > 0).length;
    logger.log(
      `products    ${String(SEED_PRODUCTS.length)} upserted ` +
        `(${String(withImages)} with images, ${String(SEED_PRODUCTS.length - withImages)} without)`,
    );

    // --- Denormalised counts ----------------------------------------------
    // Category counts are SUBTREE counts, because `category.path` on a product
    // is the inclusive chain: a parent therefore counts its children's products.
    const categoryCounts = await products
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { isActive: true, deletedAt: null } },
        { $unwind: '$category.path' },
        { $group: { _id: '$category.path', count: { $sum: 1 } } },
      ])
      .exec();

    await categories.updateMany({}, { $set: { productCount: 0 } }).exec();
    for (const row of categoryCounts) {
      await categories.updateOne({ _id: row._id }, { $set: { productCount: row.count } }).exec();
    }

    const brandCounts = await products
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { isActive: true, deletedAt: null, brand: { $ne: null } } },
        { $group: { _id: '$brand.id', count: { $sum: 1 } } },
      ])
      .exec();

    await brands.updateMany({}, { $set: { productCount: 0 } }).exec();
    for (const row of brandCounts) {
      await brands.updateOne({ _id: row._id }, { $set: { productCount: row.count } }).exec();
    }

    logger.log('counts      recomputed');
    logger.log('seed complete');
  } catch (error) {
    logger.error(`seed failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
