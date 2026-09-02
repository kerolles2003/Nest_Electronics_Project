import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CatalogModule } from '../catalog/catalog.module';
import { CartService } from './application/cart.service';
import { CartRepository } from './infrastructure/repositories/cart.repository';
import { Cart, CartSchema } from './infrastructure/schemas/cart.schema';
import { CartController } from './presentation/cart.controller';
import { GuestCartController } from './presentation/guest-cart.controller';

/**
 * The cart.
 *
 * Tier 2 — three layers, per CODEBASE-STRUCTURE.md §7, with a concrete
 * repository and no ports. PORTS-AND-CONTRACTS.md §4 lists `CartService` among
 * the services that explicitly have NO contract: one implementation, tested
 * through the module against a real database.
 *
 * Depends on `CatalogModule` for `ProductsService`, which is the only way the
 * cart learns a price or a stock level. It does NOT import the catalogue's
 * repository: the dependency is a business-meaningful call
 * (`findPurchasableByIds`) returning a plain domain shape, so no Mongoose
 * document crosses the boundary (§6.3).
 *
 * `CartService` is EXPORTED because Checkout will need the authoritative cart —
 * `getCart()` returns a `CartView`, so checkout never has to scrape an HTTP DTO
 * or reach into `carts` itself.
 *
 * No `TransactionService`: every cart write is a single-document update, which
 * MongoDB already applies atomically. See `CartRepository`.
 *
 * Two controllers, one prefix. `CartController` is the signed-in customer's
 * cart and requires a CUSTOMER principal on every route; `GuestCartController`
 * serves the one public route, which prices a browser-held basket and stores
 * nothing. Splitting them keeps "this route is not guarded" a visible property
 * of the file rather than a decorator overriding its own class.
 *
 * Deliberately absent: `POST /cart/merge` (guest-cart merge at login), which
 * the frozen contract defines. The storefront merges with the routes that
 * already exist — read the cart, then converge each line with PATCH or POST —
 * because that split lets the client persist the plan BEFORE any write, which
 * is what makes an interrupted merge safe to retry. A single merge call cannot
 * offer that: a dropped connection after it lands leaves the browser holding a
 * basket it believes is unmerged, and the retry doubles it.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: Cart.name, schema: CartSchema }]), CatalogModule],
  controllers: [CartController, GuestCartController],
  providers: [CartService, CartRepository],
  exports: [CartService],
})
export class CartModule {}
