import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { Order, OrderSchema } from '../orders/infrastructure/schemas/order.schema';
import { AddressesService } from './application/addresses.service';
import { CustomersAdminService } from './application/customers-admin.service';
import { UsersService } from './application/users.service';
import { UserRepository } from './infrastructure/repositories/user.repository';
import { User, UserSchema } from './infrastructure/schemas/user.schema';
import { AddressesController } from './presentation/addresses.controller';
import { AdminCustomersController } from './presentation/admin-customers.controller';
import { UsersController } from './presentation/users.controller';

/**
 * Identity, profile and the address book.
 *
 * Authority: docs/architecture/NESTJS-MODULE-MAP.md §2 — UsersModule owns the
 * `users` collection, and its responsibilities include "embedded address CRUD ·
 * default-address invariant".
 *
 * `MongooseModule` is re-exported so `AuthModule` can bind its own credential
 * repository to the same model. That is the frozen arrangement: the collection
 * is owned here, the CREDENTIAL FIELDS are owned by AuthModule through a
 * dedicated repository (§1), and `passwordHash` therefore never passes through
 * `UsersService` at all.
 *
 * `AddressesService` is exported because OrdersModule must resolve the address a
 * checkout names — inside the placement transaction, through the same
 * ownership-filtered query used everywhere else. It exports the SERVICE, never
 * the repository: an address may only be reached through the rules that decide
 * what happens when it is not yours.
 *
 * `UsersController` carries `PATCH /users/me` — the profile edit `/account/profile`
 * needs (PLAN §9). It is here rather than beside `GET /auth/me` because the
 * `users` collection is owned here; auth reads a profile through `UsersService`,
 * and reversing that would make UsersModule depend on AuthModule and close a
 * cycle.
 *
 * `AdminCustomersController` is the admin customer list and role management,
 * which the comment here used to list as deliberately absent because neither
 * "is reachable from the current surface". Both are now. The two SUPER_ADMIN-only
 * operations in AUTHORIZATION-MODEL.md §3's table that concern accounts —
 * change a role, delete a user — live there.
 *
 * It registers the `Order` model for READS ONLY: an account's order count and
 * lifetime spend. Importing OrdersModule would close a cycle, because
 * OrdersModule already imports this one to resolve the address a checkout
 * names. Registering another module's model on the shared connection is the
 * precedent InventoryModule sets; Mongoose resolves it to the one compiled
 * model, and nothing here writes an order.
 *
 * Still deliberately absent: change-password. It brings its own DTOs and
 * invariants and belongs with the credential surface AuthModule owns.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    AuditModule,
  ],
  controllers: [AddressesController, UsersController, AdminCustomersController],
  providers: [UsersService, AddressesService, CustomersAdminService, UserRepository],
  exports: [UsersService, AddressesService, MongooseModule],
})
export class UsersModule {}
