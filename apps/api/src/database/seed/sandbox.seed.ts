import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../app.module';
import {
  SANDBOX_ADDRESSES,
  SANDBOX_CART,
  SANDBOX_DEFAULT_ADDRESS_LABEL,
  SANDBOX_EMAIL,
  SANDBOX_FULL_NAME,
  SANDBOX_ORDER,
  SANDBOX_PASSWORD,
  SANDBOX_PHONE,
} from './sandbox.seed-data';
import { appConfig, type AppConfig } from '../../config/app.config';
import { AuthService } from '../../modules/auth/application/auth.service';
import { CartService } from '../../modules/cart/application/cart.service';
import { Product } from '../../modules/catalog/infrastructure/schemas/product.schema';
import { CheckoutService } from '../../modules/orders/application/checkout.service';
import { AddressesService } from '../../modules/users/application/addresses.service';
import { User, type UserLean } from '../../modules/users/infrastructure/schemas/user.schema';

/**
 * The sandbox customer.
 *
 *   pnpm --filter api sandbox:seed            converge to the documented state
 *   pnpm --filter api sandbox:seed -- --reset erase this account's history first
 *
 * ## Why this exists
 *
 * `POST /auth/register` is capped at **3 per hour per IP**. A mobile developer
 * building against this API re-registers constantly, hits the ceiling within
 * minutes, and reads a `429` as a broken API — which is the worst possible
 * first impression and is entirely avoidable. So there is a permanent account,
 * already verified, with credentials written down.
 *
 * ## Why it places a REAL order rather than inserting one
 *
 * An order document written by hand is a guess about what the order model
 * looks like, and it goes stale the first time that model changes — silently,
 * because nothing type-checks a `db.orders.insertOne`. This seed calls
 * `CheckoutService.placeOrder`, the same method the HTTP layer calls, so the
 * history is a real one: real pricing, a real shipping fee resolved from the
 * governorate, a real stock decrement, a real inventory event, and the cart
 * cleared in the same transaction. If placement ever changes, this changes with
 * it or fails loudly.
 *
 * For the same reason the account is created through `AuthService.register`
 * rather than by inserting a user with a bcrypt hash: it runs the real password
 * policy, so **the password documented in SANDBOX.md is provably one the API
 * will accept.** A seed that wrote a hash directly could document a password
 * that registration itself would reject.
 *
 * ## Idempotent, and safe to re-run
 *
 * Everything converges. Re-running does not add a second order, a third
 * address, or duplicate cart lines. `--reset` is the way back to a clean
 * history, and it removes only what this account created — by id, never by a
 * broad delete, and never touching the seeded catalogue except to give back
 * exactly the stock its own orders took.
 */

const logger = new Logger('SandboxSeed');

interface Services {
  readonly auth: AuthService;
  readonly addresses: AddressesService;
  readonly cart: CartService;
  readonly checkout: CheckoutService;
  readonly users: Model<User>;
  readonly products: Model<Product>;
  readonly connection: Connection;
}

/** Resolves a seeded product id by slug, refusing to guess if the catalogue is not there. */
async function productIdOf(services: Services, slug: string): Promise<Types.ObjectId> {
  const product = await services.products
    .findOne({ slug })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }>()
    .exec();

  if (product === null) {
    throw new Error(
      `sandbox seed: product "${slug}" is missing. Run \`pnpm --filter api seed\` first.`,
    );
  }

  return product._id;
}

/**
 * Creates the account if it is absent, and repairs it if it has drifted.
 *
 * Repair matters more than creation: a developer will change this password, or
 * un-verify the account, or delete it, and the fix must be "run the command
 * again" rather than "work out what is different".
 */
async function ensureAccount(services: Services): Promise<Types.ObjectId> {
  const existing = await services.users
    .findOne({ email: SANDBOX_EMAIL })
    .lean<UserLean>()
    .exec();

  if (existing === null) {
    await services.auth.register({
      email: SANDBOX_EMAIL,
      password: SANDBOX_PASSWORD,
      fullName: SANDBOX_FULL_NAME,
      phone: SANDBOX_PHONE,
    });

    logger.log('account     created through the real registration path');
  }

  /*
   * Verified WITHOUT going through the token.
   *
   * The console mail sender prints a verification link, and a seed cannot read
   * its own log. Marking it here is the honest shortcut: the account exists
   * because registration created it, and only the click is skipped. §4 of
   * SANDBOX.md still walks a human through the real flow with their own
   * address, which is where that path gets exercised.
   */
  const updated = await services.users
    .findOneAndUpdate(
      { email: SANDBOX_EMAIL },
      { $set: { emailVerifiedAt: new Date(), emailVerification: null, deletedAt: null } },
      { new: true },
    )
    .lean<UserLean>()
    .exec();

  if (updated === null) {
    throw new Error('sandbox seed: the account vanished between creating and verifying it');
  }

  if (existing !== null) {
    logger.log('account     already present — verified and re-enabled');
  }

  return updated._id;
}

/**
 * Converges the address book to exactly the two documented addresses.
 *
 * Matched by LABEL, because that is the thing a developer reads in the API
 * response. An address with a documented label but the wrong governorate is
 * corrected rather than duplicated, so the shipping band stays what the docs
 * claim it is.
 */
async function ensureAddresses(services: Services, userId: Types.ObjectId): Promise<void> {
  const book = await services.addresses.list(userId);

  for (const wanted of SANDBOX_ADDRESSES) {
    const { makeDefault, ...input } = wanted;
    const found = book.find((address) => address.label === wanted.label);

    if (found === undefined) {
      const created = await services.addresses.create(userId, input, makeDefault);

      if (makeDefault) {
        await services.addresses.setDefault(userId, created._id);
      }
      continue;
    }

    await services.addresses.update(userId, found._id, input);

    if (makeDefault) {
      await services.addresses.setDefault(userId, found._id);
    }
  }

  logger.log(
    `addresses   ${String(SANDBOX_ADDRESSES.length)} (${SANDBOX_ADDRESSES.map((a) => a.governorate).join(', ')})`,
  );
}

/** Empties the cart and refills it with the documented lines. */
async function ensureCart(services: Services, userId: Types.ObjectId): Promise<void> {
  await services.cart.clear(userId);

  for (const line of SANDBOX_CART) {
    await services.cart.addItem(userId, await productIdOf(services, line.slug), line.quantity);
  }

  logger.log(`cart        ${String(SANDBOX_CART.length)} line(s)`);
}

/**
 * Places one order, if the account has none.
 *
 * Guarded by a count rather than by an idempotency key, because the key is a
 * property of one REQUEST and this is a property of the account: running the
 * seed on three different days should still leave one historical order, not
 * three.
 */
async function ensureOrder(services: Services, userId: Types.ObjectId): Promise<void> {
  const placed = await services.connection
    .collection('orders')
    .countDocuments({ userId });

  if (placed > 0) {
    logger.log(`orders      ${String(placed)} already on the account — left alone`);
    return;
  }

  const book = await services.addresses.list(userId);
  const home = book.find((address) => address.label === SANDBOX_DEFAULT_ADDRESS_LABEL);

  if (home === undefined) {
    throw new Error(
      `sandbox seed: the ${SANDBOX_DEFAULT_ADDRESS_LABEL} address is missing, `
        + 'so nothing can be shipped',
    );
  }

  // The cart is what gets bought, so it is loaded with the order's lines first
  // and refilled with the resting ones afterwards by the caller.
  await services.cart.clear(userId);

  for (const line of SANDBOX_ORDER) {
    await services.cart.addItem(userId, await productIdOf(services, line.slug), line.quantity);
  }

  const outcome = await services.checkout.placeOrder({
    userId,
    idempotencyKey: randomUUID(),
    addressId: home._id,
    customerNote: 'Seeded by sandbox:seed so the history is not empty.',
    locale: 'en',
  });

  logger.log(
    `orders      1 placed — ${outcome.order.orderNumber}, ` +
      `shipping ${String(outcome.order.pricing.shippingFee / 100)} EGP to ${home.governorate}`,
  );
}

/**
 * Undoes everything this account has done, and nothing else.
 *
 * Stock is given back FIRST and from the inventory events, not from the order
 * lines: the events are the authority for what actually moved, so the reversal
 * stays exact even for an order that was partially fulfilled. Deleting an order
 * does not restock by itself, and a reset that skipped this would drain the
 * seeded catalogue one run at a time until a product the docs name went out of
 * stock — with nothing to point at.
 */
async function reset(services: Services): Promise<void> {
  const user = await services.users
    .findOne({ email: SANDBOX_EMAIL })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }>()
    .exec();

  if (user === null) {
    logger.log('reset       no sandbox account yet — nothing to undo');
    return;
  }

  const db = services.connection;
  const orders = await db
    .collection('orders')
    .find({ userId: user._id }, { projection: { _id: 1, idempotencyKey: 1 } })
    .toArray();

  const orderIds = orders.map((order) => order._id);
  let restocked = 0;

  if (orderIds.length > 0) {
    const events = await db
      .collection('inventoryEvents')
      .find({ 'reference.id': { $in: orderIds } })
      .toArray();

    for (const event of events) {
      const delta = event['quantityDelta'];

      if (typeof delta !== 'number' || delta === 0) {
        continue;
      }

      await db
        .collection('products')
        .updateOne(
          { _id: event['productId'] as Types.ObjectId },
          { $inc: { 'stock.onHand': -delta, salesCount: delta } },
        );
      restocked += 1;
    }

    await db.collection('inventoryEvents').deleteMany({ 'reference.id': { $in: orderIds } });
    await db.collection('orders').deleteMany({ _id: { $in: orderIds } });
    await db.collection('idempotencyKeys').deleteMany({
      key: { $in: orders.map((order) => order['idempotencyKey']).filter(Boolean) as string[] },
    });
  }

  await db.collection('carts').deleteMany({ userId: user._id });
  await db.collection('refreshTokens').deleteMany({ userId: user._id });

  logger.log(
    `reset       ${String(orderIds.length)} order(s) removed, ` +
      `${String(restocked)} stock movement(s) reversed, cart and sessions cleared`,
  );
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const config = app.get<AppConfig>(appConfig.KEY);

    if (config.nodeEnv === 'production') {
      /*
       * The whole point of this account is that its password is written in a
       * document anyone can read. Refusing here is not a formality.
       */
      logger.error('refusing to seed a sandbox account: NODE_ENV=production');
      process.exitCode = 1;
      return;
    }

    const services: Services = {
      auth: app.get(AuthService),
      addresses: app.get(AddressesService),
      cart: app.get(CartService),
      checkout: app.get(CheckoutService),
      users: app.get<Model<User>>(getModelToken(User.name)),
      products: app.get<Model<Product>>(getModelToken(Product.name)),
      connection: app.get<Connection>(getConnectionToken()),
    };

    if (process.argv.includes('--reset')) {
      await reset(services);
    }

    const userId = await ensureAccount(services);
    await ensureAddresses(services, userId);
    await ensureOrder(services, userId);
    await ensureCart(services, userId);

    logger.log(`sandbox account ready: ${SANDBOX_EMAIL}`);
  } catch (error) {
    logger.error(
      `sandbox seed failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
