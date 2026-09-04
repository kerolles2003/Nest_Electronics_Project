import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { MediaModule } from '../media/media.module';
import { Order, OrderSchema } from '../orders/infrastructure/schemas/order.schema';
import { UsersModule } from '../users/users.module';
import { BrandAdminService } from './application/brand-admin.service';
import { BrandsService } from './application/brands.service';
import { CategoryAdminService } from './application/category-admin.service';
import { CategoriesService } from './application/categories.service';
import { ProductAdminService } from './application/product-admin.service';
import { ProductImageService } from './application/product-image.service';
import { ProductsService } from './application/products.service';
import { SlugRedirectService } from './application/slug-redirect.service';
import { SlugService } from './application/slug.service';
import { ProductRepository } from './infrastructure/repositories/product.repository';
import { Brand, BrandSchema } from './infrastructure/schemas/brand.schema';
import { Category, CategorySchema } from './infrastructure/schemas/category.schema';
import { Product, ProductSchema } from './infrastructure/schemas/product.schema';
import {
  SlugRedirect,
  SlugRedirectSchema,
} from './infrastructure/schemas/slug-redirect.schema';
import { BrandsController } from './presentation/brands.controller';
import { CategoriesController } from './presentation/categories.controller';
import { AdminCatalogController } from './presentation/admin-catalog.controller';
import { AdminProductsController } from './presentation/admin-products.controller';
import { AdminTaxonomyController } from './presentation/admin-taxonomy.controller';
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
 * ## Two write dependencies, and why each is one-directional
 *
 * `AuditModule` — every catalogue write is audited (AUDIT-MODEL.md §3). It
 * exports a service and nothing that could modify the trail, and it depends on
 * nothing here, so importing it cannot close a cycle.
 *
 * `UsersModule` — the audit actor's role and name are read from the database
 * profile rather than from the JWT claim, because a token minted before a
 * demotion still carries the old role. `UsersModule` imports only Mongoose.
 *
 * Deliberately absent, and why:
 *   specDefinitions     — the canonical key dictionary is owner data nobody has
 *                         supplied; deriving one from seeded products would be
 *                         inventing a taxonomy and calling it frozen
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Brand.name, schema: BrandSchema },
      { name: SlugRedirect.name, schema: SlugRedirectSchema },
      /*
       * Another module's model, registered here for ONE read: "has this
       * product ever been ordered", which CATALOG-MODEL.md §9 makes the
       * precondition of a hard delete. Importing OrdersModule would close a
       * cycle — OrdersModule -> CartModule -> CatalogModule — and the
       * precedent for doing it this way is InventoryModule, which registers
       * `Product` for the same kind of reason. Mongoose resolves both to the
       * one compiled model on the shared connection, so `indexes:sync` still
       * sees exactly one `orders` collection. Nothing here writes an order.
       */
      { name: Order.name, schema: OrderSchema },
    ]),
    AuditModule,
    UsersModule,
    /*
     * The upload pipeline and the reference-count ledger. MediaModule imports
     * nothing from the catalogue, so this is one-directional.
     */
    MediaModule,
  ],
  controllers: [
    ProductsController,
    CategoriesController,
    BrandsController,
    AdminCatalogController,
    AdminProductsController,
    AdminTaxonomyController,
  ],
  providers: [
    ProductsService,
    CategoriesService,
    BrandsService,
    ProductAdminService,
    ProductImageService,
    CategoryAdminService,
    BrandAdminService,
    ProductRepository,
    SlugRedirectService,
    SlugService,
  ],
  exports: [ProductsService, CategoriesService, BrandsService, MongooseModule],
})
export class CatalogModule {}
