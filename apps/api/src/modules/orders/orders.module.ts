import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DatabaseModule } from '../../database/database.module';
import { CartModule } from '../cart/cart.module';
import { FulfilmentModule } from '../fulfilment/fulfilment.module';
import { InventoryModule } from '../inventory/inventory.module';
import { UsersModule } from '../users/users.module';
import { CheckoutService } from './application/checkout.service';
import { OrderLifecycleService } from './application/order-lifecycle.service';
import { OrdersService } from './application/orders.service';
import { IdempotencyRepository } from './infrastructure/repositories/idempotency.repository';
import { OrderCounterRepository } from './infrastructure/repositories/order-counter.repository';
import { OrderRepository } from './infrastructure/repositories/order.repository';
import {
  IdempotencyKeyRecord,
  IdempotencyKeySchema,
} from './infrastructure/schemas/idempotency-key.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderCounter, OrderCounterSchema } from './infrastructure/schemas/order-counter.schema';
import { Order, OrderSchema } from './infrastructure/schemas/order.schema';
import { AdminOrdersController } from './presentation/admin-orders.controller';
import { CheckoutController } from './presentation/checkout.controller';
import { OrdersController } from './presentation/orders.controller';

/**
 * Checkout and orders.
 *
 * Authority: docs/architecture/NESTJS-MODULE-MAP.md §2 and §8 — `OrdersModule`
 * owns `orders`, `orderCounters` and `idempotencyKeys`, and its responsibilities
 * include the checkout quote and transactional placement. Both controllers live
 * here for that reason; `/checkout/quote` is not a separate module.
 *
 * It is the COMPOSITION ROOT of the domain: it depends on Cart, Inventory and
 * Users, and nothing depends on it, so no cycle is possible (§249). The frozen
 * map also lists Catalog, Pricing and Fulfilment as dependencies. Catalog
 * arrives transitively through `CartService`, which is the only thing that needs
 * to resolve a product here; `FulfilmentModule` is imported directly as of this
 * phase, because shipping now has ONE authority instead of a literal zero at the
 * call site; Pricing still does not exist, so the discount term is still 0.
 *
 * `UsersModule` supplies two things now: the customer snapshot, and
 * `AddressesService` — the delivery address is resolved through the Users domain
 * that owns it, inside the placement transaction, rather than by OrdersModule
 * reaching into the `users` collection itself.
 *
 * `DatabaseModule` is imported for `TransactionService`: a transaction is
 * connection lifecycle, owned by no domain.
 *
 * ## Deliberately absent
 *
 * `POST /orders/track` — a PUBLIC, rate-limited surface with its own minimal
 * projection — and the admin PAYMENT operation (`PATCH /admin/orders/:id/payment`,
 * recording a manual refund outcome). The admin LIFECYCLE operations now exist
 * in `AdminOrdersController`; they reuse `OrderLifecycleService.transitionByStaff`
 * rather than owning any rule of their own.
 *
 * No `OrderRepositoryPort`. PORTS-AND-CONTRACTS.md §3 justifies one under J2 —
 * "the state machine and placement rules must be unit-testable without MongoDB"
 * — and the state machine now exists, but the half of it that is worth testing
 * without MongoDB is already MongoDB-free: `domain/order-transitions.ts` is a
 * pure matrix with no injection and no I/O. What a port would isolate is the
 * other half — guarded conditional updates, unique indexes and transaction
 * boundaries — and an in-memory fake cannot evaluate any of them, so the tests
 * it enabled would pass while the real behaviour broke. The port arrives
 * with the fake that gives it a purpose; until then it is one interface with
 * one implementation, which §1 of that same document calls indirection rather
 * than abstraction.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: OrderCounter.name, schema: OrderCounterSchema },
      { name: IdempotencyKeyRecord.name, schema: IdempotencyKeySchema },
    ]),
    DatabaseModule,
    CartModule,
    InventoryModule,
    UsersModule,
    FulfilmentModule,
    // For the post-commit order confirmation. Orders injects
    // `NotificationsService`, never `EmailSenderPort` — the port sits one
    // module deeper, so email semantics cannot ripple into checkout
    // (PROVIDER-ARCHITECTURE.md §2).
    NotificationsModule,
  ],
  controllers: [CheckoutController, OrdersController, AdminOrdersController],
  providers: [
    CheckoutService,
    OrdersService,
    OrderLifecycleService,
    OrderRepository,
    OrderCounterRepository,
    IdempotencyRepository,
  ],
})
export class OrdersModule {}
