import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { Product, ProductSchema } from '../catalog/infrastructure/schemas/product.schema';
import { DatabaseModule } from '../../database/database.module';
import { UsersModule } from '../users/users.module';
import { InventoryAdminService } from './application/inventory-admin.service';
import { InventoryService } from './application/inventory.service';
import { InventoryRepository } from './infrastructure/repositories/inventory.repository';
import { InventoryEvent, InventoryEventSchema } from './infrastructure/schemas/inventory-event.schema';
import { AdminInventoryController } from './presentation/admin-inventory.controller';

/**
 * Stock and its ledger.
 *
 * Authority: docs/architecture/NESTJS-MODULE-MAP.md §2 — `InventoryModule` owns
 * `products.stock` and `inventoryEvents`.
 *
 * It registers the `Product` model because it writes `stock` inside that
 * document — the documented exception to aggregate ownership
 * (ADR-INVENTORY-002). Registering the same model in two modules resolves to
 * the one compiled model on the shared connection, so `indexes:sync` still sees
 * exactly one `products` collection.
 *
 * `AdminInventoryController` is `/admin/inventory` — stock levels, manual
 * adjustment, the ledger view and the reconciliation report. The comment that
 * used to stand here said this module had NO controller because that surface
 * "is separate, with its own authorization and DTOs, and nothing in checkout
 * needs it". The second half is still true and is why the admin service is a
 * separate class: `InventoryService` takes a session from its caller because it
 * is a step inside an order's transaction, while an adjustment owns its own.
 *
 * No `InventoryRepositoryPort` yet. PORTS-AND-CONTRACTS.md §3 justifies one
 * under J2, "the ledger invariant and stock guard must be testable without
 * MongoDB" — but the guard being tested IS a MongoDB conditional update, and an
 * in-memory fake would prove nothing about it. The port arrives with the
 * in-memory implementation that gives it a purpose; extracting an abstract
 * class from this concrete one is mechanical.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: InventoryEvent.name, schema: InventoryEventSchema },
    ]),
    // An adjustment is its own unit of work, so this module now opens
    // transactions rather than only joining its callers'.
    DatabaseModule,
    AuditModule,
    UsersModule,
  ],
  controllers: [AdminInventoryController],
  providers: [InventoryService, InventoryAdminService, InventoryRepository],
  exports: [InventoryService],
})
export class InventoryModule {}
