import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { validationExceptionFactory } from '../../src/common/pipes/validation-exception.factory';
import { RefreshToken } from '../../src/modules/auth/infrastructure/schemas/refresh-token.schema';
import { Cart } from '../../src/modules/cart/infrastructure/schemas/cart.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { InventoryEvent } from '../../src/modules/inventory/infrastructure/schemas/inventory-event.schema';
import { IdempotencyKeyRecord } from '../../src/modules/orders/infrastructure/schemas/idempotency-key.schema';
import { Order } from '../../src/modules/orders/infrastructure/schemas/order.schema';
import { User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * THE CUSTOMER JOURNEY, end to end, in the exact order the storefront performs
 * it.
 *
 * This is a CONTRACT test for the frontend integration. The storefront's
 * `lib/api/endpoints.ts` calls precisely these paths, with precisely these
 * bodies and headers, and reads precisely these response shapes. If any of them
 * moves, this fails here rather than in a browser — which is the point: the
 * storefront cannot be type-checked against a running server, so the sequence
 * it depends on is pinned in the place that CAN be executed.
 *
 * It deliberately asserts the properties the UI depends on, not merely 2xx:
 * that the cart persists server-side between calls, that the address book comes
 * back WHOLE from a default change, that money is only ever an object, that the
 * order carries an immutable address snapshot, and that a repeated
 * `Idempotency-Key` yields one order rather than two.
 *
 * ISOLATION: it creates its own customer and its own product, and removes both
 * by tracked id in `afterAll`. No seeded catalogue data is read or mutated.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const V1 = '/api/v1';

let app: INestApplication;
let users: Model<User>;
let products: Model<Product>;
let orders: Model<Order>;
let carts: Model<Cart>;
let inventoryEvents: Model<InventoryEvent>;
let idempotencyKeys: Model<IdempotencyKeyRecord>;
let refreshTokens: Model<RefreshToken>;

let userId: Types.ObjectId;
let productId: Types.ObjectId;
let productSlug: string;
let accessToken: string;
let seededProductCount = 0;

function http(): request.Agent {
  return request(app.getHttpServer());
}

function auth(): [string, string] {
  return ['Authorization', `Bearer ${accessToken}`];
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getStorageToken())
    .useValue({
      increment: () =>
        Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
    } satisfies ThrottlerStorage)
    .compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: validationExceptionFactory,
    }),
  );
  await app.init();

  users = app.get<Model<User>>(getModelToken(User.name));
  products = app.get<Model<Product>>(getModelToken(Product.name));
  orders = app.get<Model<Order>>(getModelToken(Order.name));
  carts = app.get<Model<Cart>>(getModelToken(Cart.name));
  inventoryEvents = app.get<Model<InventoryEvent>>(getModelToken(InventoryEvent.name));
  idempotencyKeys = app.get<Model<IdempotencyKeyRecord>>(getModelToken(IdempotencyKeyRecord.name));
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));

  seededProductCount = await products.countDocuments({ sku: { $not: /^JRN-TEST-/ } }).exec();

  // The journey needs a product the suite fully controls, so stock and price
  // cannot be moved by another run.
  const category = await app
    .get<Model<import('../../src/modules/catalog/infrastructure/schemas/category.schema').Category>>(
      getModelToken('Category'),
    )
    .findOne({ slug: 'development-boards' })
    .lean<{ _id: Types.ObjectId; slug: string; name: { en: string }; path: Types.ObjectId[] }>()
    .exec();

  if (category === null) {
    throw new Error('seed category development-boards is missing — run `pnpm --filter api seed`');
  }

  productSlug = `jrn-test-${RUN_ID}`;
  const product = await products.create({
    sku: `JRN-TEST-${RUN_ID}`.toUpperCase(),
    slug: productSlug,
    name: { en: 'Journey Test Board', ar: null },
    shortDescription: { en: 'Created by the customer-journey suite.', ar: null },
    description: null,
    category: {
      id: category._id,
      slug: category.slug,
      name: { en: category.name.en, ar: null },
      path: [...category.path, category._id],
    },
    brand: null,
    pricing: { basePrice: 45000, salePrice: null, effectivePrice: 45000, costPrice: 100 },
    currency: 'EGP',
    stock: { onHand: 100, lowStockThreshold: 5 },
    images: [],
    specs: [],
    salesCount: 0,
    isActive: true,
    isFeatured: false,
    deletedAt: null,
    weight: null,
  });
  productId = product._id;
}, 300_000);

afterAll(async () => {
  /*
   * Cleanup keys off the RUN_ID EMAIL, not only the tracked `userId`.
   *
   * `userId` is assigned inside the first test, so a failure before that line —
   * an assertion on the registration response, say — would leave the account
   * that registration had already created behind forever. Resolving the id here
   * instead means the account is removed however the run ended.
   */
  const registered = await users
    .findOne({ email: `journey.${RUN_ID}@example.test` })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }>()
    .exec();
  const ownerId = userId ?? registered?._id;

  if (ownerId !== undefined) {
    await orders.deleteMany({ userId: ownerId }).exec();
    await idempotencyKeys.deleteMany({ userId: ownerId }).exec();
    await carts.deleteMany({ userId: ownerId }).exec();
    await refreshTokens.deleteMany({ userId: ownerId }).exec();
    await users.deleteOne({ _id: ownerId }).exec();
  }
  if (productId !== undefined) {
    await inventoryEvents.deleteMany({ productId }).exec();
    await products.deleteOne({ _id: productId }).exec();
  }

  // The seeded catalogue must be exactly as it was found.
  expect(await products.countDocuments({ sku: { $not: /^JRN-TEST-/ } }).exec()).toBe(
    seededProductCount,
  );

  const connection = app.get<Connection>(getConnectionToken());
  await app.close();
  await connection.close();
}, 300_000);

/**
 * Ordered on purpose. Each step is a screen in the storefront, and every step
 * consumes state the previous one created — which is exactly the property a
 * per-endpoint test cannot check.
 */
describe('the customer purchase journey', () => {
  let addressId: string;
  let orderId: string;
  let orderNumber: string;
  const idempotencyKey = randomUUID();

  /**
   * Registration issues NO SESSION. The API returns a confirmation and requires
   * the address to be verified before the account can sign in, so the storefront
   * must show "check your email" here rather than navigating to a guarded route.
   * Pinning that is the point: assuming a session is the obvious wrong guess.
   */
  it('1. registers a customer, and gets NO session back', async () => {
    const email = `journey.${RUN_ID}@example.test`;

    const response = await http()
      .post(`${V1}/auth/register`)
      .send({ email, password: PASSWORD, fullName: 'Journey Customer' })
      .expect(201);

    expect(response.body.data.emailVerificationRequired).toBe(true);
    expect(response.body.data).not.toHaveProperty('accessToken');
    expect(response.body.data).not.toHaveProperty('tokens');

    const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
    userId = created._id;

    await users.updateOne({ _id: userId }, { $set: { emailVerifiedAt: new Date() } }).exec();
  });

  /** Sign-in is what mints the pair, and both tokens sit at the TOP of `data`. */
  it('2. signs in, and the tokens are at the top of the payload', async () => {
    const response = await http()
      .post(`${V1}/auth/login`)
      .send({ email: `journey.${RUN_ID}@example.test`, password: PASSWORD })
      .expect(200);

    expect(typeof response.body.data.accessToken).toBe('string');
    expect(typeof response.body.data.refreshToken).toBe('string');
    expect(response.body.data.user.role).toBe('CUSTOMER');

    accessToken = response.body.data.accessToken as string;
  });

  it('3. authenticates a request with that session', async () => {
    const response = await http().get(`${V1}/auth/me`).set(...auth()).expect(200);

    expect(response.body.data.id).toBe(userId.toHexString());
  });

  it('4. browses products without a token, and money is never a bare number', async () => {
    const response = await http().get(`${V1}/products?limit=50`).expect(200);

    const found = (response.body.data as { slug: string; pricing: { effectivePrice: unknown } }[]).find(
      (p) => p.slug === productSlug,
    );

    expect(found).toBeDefined();
    // The storefront renders `formatted` and never does arithmetic, so the
    // shape matters as much as the value.
    expect(found?.pricing.effectivePrice).toEqual({
      amount: 45000,
      currency: 'EGP',
      formatted: expect.any(String) as unknown as string,
    });
    expect(response.body.meta).toEqual(
      expect.objectContaining({ page: 1, hasNext: expect.any(Boolean) as unknown as boolean }),
    );
  });

  it('5. opens the product detail page by slug', async () => {
    const response = await http().get(`${V1}/products/${productSlug}`).expect(200);

    expect(response.body.data.id).toBe(productId.toHexString());
    expect(response.body.data.availability).toBe('IN_STOCK');
  });

  it('6. adds the product to the cart, and the cart PERSISTS on the server', async () => {
    await http()
      .post(`${V1}/cart/items`)
      .set(...auth())
      .send({ productId: productId.toHexString(), quantity: 2 })
      .expect(200);

    // Re-read in a SEPARATE request: this is what proves the cart is server
    // state rather than a response echo.
    const reread = await http().get(`${V1}/cart`).set(...auth()).expect(200);

    expect(reread.body.data.items).toHaveLength(1);
    expect(reread.body.data.items[0].quantity).toBe(2);
    expect(reread.body.data.itemsSubtotal.amount).toBe(90_000);
    expect(reread.body.data.hasBlockingIssues).toBe(false);
  });

  it('7. changes the quantity through the API', async () => {
    const response = await http()
      .patch(`${V1}/cart/items/${productId.toHexString()}`)
      .set(...auth())
      .send({ quantity: 3 })
      .expect(200);

    expect(response.body.data.items[0].quantity).toBe(3);
    expect(response.body.data.itemsSubtotal.amount).toBe(135_000);
  });

  it('8. creates a delivery address, and the FIRST one becomes the default', async () => {
    const response = await http()
      .post(`${V1}/users/me/addresses`)
      .set(...auth())
      .send({
        label: 'Home',
        fullName: 'Journey Customer',
        phone: '01012345678',
        street: '12 Sherif Street, Apartment 4',
        city: 'Downtown',
        governorate: 'Cairo',
      })
      .expect(201);

    addressId = response.body.data.id as string;

    expect(response.body.data.isDefault).toBe(true);
    // Required-and-nullable: the key is present even when empty, so a Dart or
    // TypeScript model never has to distinguish absent from null.
    expect(response.body.data).toHaveProperty('postalCode', null);
  });

  it('9. returns the WHOLE address book from a default change', async () => {
    const second = await http()
      .post(`${V1}/users/me/addresses`)
      .set(...auth())
      .send({
        label: 'Work',
        fullName: 'Journey Customer',
        phone: '01012345678',
        street: '9 Tahrir Square',
        city: 'Downtown',
        governorate: 'Giza',
      })
      .expect(201);

    const response = await http()
      .post(`${V1}/users/me/addresses/${second.body.data.id as string}/default`)
      .set(...auth())
      .expect(200);

    // The storefront must REPLACE its list with this, not merge the one address
    // it named — the default moved on an address it did not name.
    const book = response.body.data as { id: string; isDefault: boolean }[];
    expect(book).toHaveLength(2);
    expect(book.filter((a) => a.isDefault)).toHaveLength(1);

    // Put the default back on the address the journey ships to.
    await http()
      .post(`${V1}/users/me/addresses/${addressId}/default`)
      .set(...auth())
      .expect(200);
  });

  it('10. quotes the cart against the chosen address', async () => {
    const response = await http()
      .post(`${V1}/checkout/quote`)
      .set(...auth())
      .send({ addressId })
      .expect(200);

    const pricing = response.body.data.pricing as {
      itemsSubtotal: { amount: number };
      discountTotal: { amount: number };
      shippingFee: { amount: number };
      grandTotal: { amount: number };
    };

    expect(response.body.data.canPlaceOrder).toBe(true);
    // The identity the checkout screen renders, asserted server-side.
    expect(pricing.grandTotal.amount).toBe(
      pricing.itemsSubtotal.amount - pricing.discountTotal.amount + pricing.shippingFee.amount,
    );
  });

  it('11. refuses a quote for an address the customer does not own', async () => {
    const response = await http()
      .post(`${V1}/checkout/quote`)
      .set(...auth())
      .send({ addressId: '000000000000000000000000' })
      .expect(404);

    expect(response.body.error.code).toBe('ADDRESS_NOT_FOUND');
  });

  it('12. places the order with an Idempotency-Key', async () => {
    const response = await http()
      .post(`${V1}/orders`)
      .set(...auth())
      .set('Idempotency-Key', idempotencyKey)
      .send({ addressId, customerNote: 'Please call before delivery.' })
      .expect(201);

    orderId = response.body.data.id as string;
    orderNumber = response.body.data.orderNumber as string;

    expect(response.body.data.status).toBe('PLACED');
    expect(response.body.data.payment.method).toBe('COD');
    // The order carries a SNAPSHOT, not a reference: no address id anywhere.
    expect(response.body.data.shippingAddress).toEqual({
      fullName: 'Journey Customer',
      phone: '01012345678',
      street: '12 Sherif Street, Apartment 4',
      city: 'Downtown',
      governorate: 'Cairo',
      postalCode: null,
    });
    expect(JSON.stringify(response.body.data)).not.toContain(addressId);
  });

  it('13. empties the cart as part of placement', async () => {
    const response = await http().get(`${V1}/cart`).set(...auth()).expect(200);

    expect(response.body.data.items).toHaveLength(0);
  });

  /**
   * The duplicate-submit guarantee the storefront relies on instead of building
   * its own. A double-tap replays the SAME key and must not produce a second
   * order.
   */
  it('14. replays the same Idempotency-Key to the SAME order, not a second one', async () => {
    const replay = await http()
      .post(`${V1}/orders`)
      .set(...auth())
      .set('Idempotency-Key', idempotencyKey)
      .send({ addressId, customerNote: 'Please call before delivery.' })
      .expect(200);

    expect(replay.body.data.id).toBe(orderId);
    expect(replay.body.data.orderNumber).toBe(orderNumber);
    expect(await orders.countDocuments({ userId }).exec()).toBe(1);
  });

  it('15. shows the order in the customer history', async () => {
    const response = await http().get(`${V1}/orders`).set(...auth()).expect(200);

    const row = (response.body.data as { id: string }[]).find((o) => o.id === orderId);
    expect(row).toBeDefined();
  });

  it('16. opens the order detail', async () => {
    const response = await http().get(`${V1}/orders/${orderId}`).set(...auth()).expect(200);

    expect(response.body.data.orderNumber).toBe(orderNumber);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].quantity).toBe(3);
  });

  /**
   * THE property the order-detail page depends on. The page renders
   * `order.shippingAddress` and never reads the address book; this proves that
   * is the right call.
   */
  it('17. keeps the order address unchanged after the source address is deleted', async () => {
    const before = await http().get(`${V1}/orders/${orderId}`).set(...auth()).expect(200);

    await http()
      .patch(`${V1}/users/me/addresses/${addressId}`)
      .set(...auth())
      .send({ street: 'A completely different street', city: 'Alexandria' })
      .expect(200);

    await http().delete(`${V1}/users/me/addresses/${addressId}`).set(...auth()).expect(200);

    const after = await http().get(`${V1}/orders/${orderId}`).set(...auth()).expect(200);

    expect(after.body.data.shippingAddress).toEqual(before.body.data.shippingAddress);
    expect(JSON.stringify(after.body.data)).toBe(JSON.stringify(before.body.data));
  });

  it('18. refuses the whole journey to an unauthenticated caller', async () => {
    for (const [method, path] of [
      ['get', `${V1}/cart`],
      ['get', `${V1}/users/me/addresses`],
      ['post', `${V1}/checkout/quote`],
      ['get', `${V1}/orders`],
    ] as const) {
      const response = await http()[method](path).send({});
      expect(response.status).toBe(401);
    }
  });
});
