import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from '../catalog/infrastructure/schemas/product.schema';
import { InventoryService } from './application/inventory.service';
import { InventoryRepository } from './infrastructure/repositories/inventory.repository';
import { InventoryEvent, InventoryEventSchema } from './infrastructure/schemas/inventory-event.schema';

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
 * NO CONTROLLER. `/admin/inventory` — stock levels, manual adjustment, the
 * ledger view and the reconciliation report — is a separate surface with its own
 * authorization and DTOs, and nothing in checkout needs it.
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
  ],
  providers: [InventoryService, InventoryRepository],
  exports: [InventoryService],
})
export class InventoryModule {}
