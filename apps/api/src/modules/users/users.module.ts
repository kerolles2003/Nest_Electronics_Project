import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AddressesService } from './application/addresses.service';
import { UsersService } from './application/users.service';
import { UserRepository } from './infrastructure/repositories/user.repository';
import { User, UserSchema } from './infrastructure/schemas/user.schema';
import { AddressesController } from './presentation/addresses.controller';
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
 * Still deliberately absent: change-password, the admin customer list and role
 * management. Each brings its own DTOs, invariants and authorization tests, and
 * none is reachable from the current surface.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [AddressesController, UsersController],
  providers: [UsersService, AddressesService, UserRepository],
  exports: [UsersService, AddressesService, MongooseModule],
})
export class UsersModule {}
