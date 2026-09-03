import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BrandsService } from './application/brands.service';
import { CategoriesService } from './application/categories.service';
import { ProductsService } from './application/products.service';
import { SlugService } from './application/slug.service';
import { ProductRepository } from './infrastructure/repositories/product.repository';
import { Brand, BrandSchema } from './infrastructure/schemas/brand.schema';
import { Category, CategorySchema } from './infrastructure/schemas/category.schema';
import { Product, ProductSchema } from './infrastructure/schemas/product.schema';
import { BrandsController } from './presentation/brands.controller';
import { CategoriesController } from './presentation/categories.controller';
import { AdminCatalogController } from './presentation/admin-catalog.controller';
import { ProductsController } from './presentation/products.controller';

/**
 * The catalogue: products, categories and brands.
 *
 * Tier 2 — three layers, per CODEBASE-STRUCTURE.md §3. There is no `domain/`
 * layer because product rules are simple enough to live in the services, and a
 * repository exists for products ONLY (faceted search, subtree filters), not
 * for categories or brands, whose access is trivial.
 *
 * Schemas are registered HERE, not in `database/`: a schema is module-local and
 * owned by exactly one module (§6.1).
 *
 * Deliberately absent, and why:
 *   admin controllers   — this slice is the public read surface only
 *   slugRedirects       — only ever written by a rename, which requires admin
 *                         writes; an always-empty collection would be dead code
 *   specDefinitions     — facet labels come from the embedded `specs[].label`,
 *                         so the dictionary is not on any read path yet
 *   MediaModule         — no upload path exists, so nothing needs a provider
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Brand.name, schema: BrandSchema },
    ]),
  ],
  controllers: [ProductsController, CategoriesController, BrandsController, AdminCatalogController],
  providers: [ProductsService, CategoriesService, BrandsService, ProductRepository, SlugService],
  exports: [ProductsService, CategoriesService, BrandsService, MongooseModule],
})
export class CatalogModule {}
