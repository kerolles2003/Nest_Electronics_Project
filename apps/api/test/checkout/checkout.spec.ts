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
import { Cart, type CartLean } from '../../src/modules/cart/infrastructure/schemas/cart.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { InventoryEvent } from '../../src/modules/inventory/infrastructure/schemas/inventory-event.schema';
import { IdempotencyKeyRecord } from '../../src/modules/orders/infrastructure/schemas/idempotency-key.schema';
import { OrderCounter } from '../../src/modules/orders/infrastructure/schemas/order-counter.schema';
import { Order, type OrderLean } from '../../src/modules/orders/infrastructure/schemas/order.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * Checkout and order placement, end to end, against the real application and
 * the real Atlas development replica set.
 *
 * ISOLATION. The suite creates its OWN products, users, carts and orders, and
 * removes them by tracked id in `afterAll`. There is no `dropDatabase`, no
 * `deleteMany({})` and no mutation of the seeded catalogue — several cases need
 * a product with zero stock, a delisted product or a price that moves
 * mid-test, and getting those by editing the seed would leave the shared
 * development catalogue wrong for everybody else. The seeded product count is
 * asserted unchanged at the end.
 *
 * WHAT COUNTS AS PROOF. Observed database state, read after the request
 * returned. An HTTP status is not evidence that stock rolled back: a
 * transaction that half-committed returns the same 409 as one that rolled back
 * correctly. Every atomicity assertion below queries MongoDB afterwards.
 *
 * The throttler's COUNTER is replaced, not its guard, so the real guard still
 * runs while the suite exceeds limits meant for humans.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';

/** How many racers contend for `raceLimited`, which has exactly 3 units. */
const RACERS = 5;
const RACE_STOCK = 3;

const ADDRESS = {
  fullName: 'Mina Kerolles',
  phone: '01012345678',
  street: '12 Sherif Street, Apartment 4',
  city: 'Downtown',
  governorate: 'Cairo',
};

let app: INestApplication;
let users: Model<User>;
let carts: Model<Cart>;
let products: Model<Product>;
let orders: Model<Order>;
let inventoryEvents: Model<InventoryEvent>;
let idempotencyKeys: Model<IdempotencyKeyRecord>;
let orderCounters: Model<OrderCounter>;
let refreshTokens: Model<RefreshToken>;

const createdUserIds: Types.ObjectId[] = [];
const createdProductIds: Types.ObjectId[] = [];
/** Every order this suite causes to exist, including the rollback decoy. */
const createdOrderIds: Types.ObjectId[] = [];

interface Fixtures {
  plentiful: Types.ObjectId;
  onSale: Types.ObjectId;
  repriced: Types.ObjectId;
  scarce: Types.ObjectId;
  empty: Types.ObjectId;
  inactive: Types.ObjectId;
  raceLimited: Types.ObjectId;
  rollback: Types.ObjectId;
}
let productId: Fixtures;

function http(): request.Agent {
  return request(app.getHttpServer());
}

interface Customer {
  readonly id: Types.ObjectId;
  readonly token: string;
  /** A saved address, because placement now names one instead of describing it. */
  readonly addressId: string;
}

/**
 * A saved address id, for a principal who may not have one.
 *
 * Staff never reach the address book (it is a CUSTOMER surface), and staff are
 * only ever used here to assert a 403 — which `RolesGuard` returns BEFORE the
 * validation pipe runs, so a well-formed but meaningless id is enough and is
 * more honest than an empty string.
 */
const NO_ADDRESS = '652f1a9b3c4d5e6f7a8b9c0d';

/**
 * Saves one address through the real API and returns its id.
 *
 * As of the address phase `POST /orders` takes an `addressId` rather than an
 * inline address, so every customer that places an order needs a saved one.
 * Created through the real endpoint rather than by a direct write, so these
 * suites exercise the same path a client does.
 */
async function saveAddress(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await http()
    .post('/api/v1/users/me/addresses')
    .set('Authorization', `Bearer ${token}`)
    .send({ label: 'Home', ...ADDRESS, ...overrides })
    .expect(201);

  return response.body.data.id as string;
}

function bearer(customer: Customer): [string, string] {
  return ['Authorization', `Bearer ${customer.token}`];
}

async function createCustomer(label: string, role: Role = Role.CUSTOMER): Promise<Customer> {
  const email = `checkout-${label}.${RUN_ID}@example.test`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: `Checkout ${label}` })
    .expect(201);

  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } }).exec();

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  const login = await http()
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  const token = login.body.data.accessToken as string;

  return {
    id: created._id,
    token,
    addressId: role === Role.CUSTOMER ? await saveAddress(token) : NO_ADDRESS,
  };
}

interface TestProductOptions {
  readonly onHand: number;
  readonly basePrice: number;
  readonly salePrice?: number | null;
  readonly isActive?: boolean;
}

async function createProduct(label: string, options: TestProductOptions): Promise<Types.ObjectId> {
  const category = await app
    .get<Model<Category>>(getModelToken(Category.name))
    .findOne({ slug: 'development-boards' })
    .lean<{ _id: Types.ObjectId; slug: string; name: { en: string }; path: Types.ObjectId[] }>()
    .exec();

  if (category === null) {
    throw new Error('seed category development-boards is missing — run `pnpm --filter api seed`');
  }

  const salePrice = options.salePrice ?? null;

  const created = await products.create({
    sku: `CHK-TEST-${label.toUpperCase()}-${RUN_ID}`,
    slug: `chk-test-${label}-${RUN_ID}`,
    name: { en: `Checkout Test ${label}`, ar: null },
    shortDescription: { en: 'Created by the checkout test suite.', ar: null },
    description: null,
    category: {
      id: category._id,
      slug: category.slug,
      name: { en: category.name.en, ar: null },
      path: [...category.path, category._id],
    },
    brand: null,
    pricing: {
      basePrice: options.basePrice,
      salePrice,
      effectivePrice: salePrice ?? options.basePrice,
      costPrice: 100,
    },
    currency: 'EGP',
    stock: { onHand: options.onHand, lowStockThreshold: 5 },
    images: [],
    specs: [],
    salesCount: 0,
    isActive: options.isActive ?? true,
    isFeatured: false,
    deletedAt: null,
    weight: null,
  });

  createdProductIds.push(created._id);
  return created._id;
}

/** Puts `quantity` of a product into a customer's cart, through the real API. */
async function addToCart(
  customer: Customer,
  product: Types.ObjectId,
  quantity: number,
): Promise<void> {
  await http()
    .post('/api/v1/cart/items')
    .set(...bearer(customer))
    .send({ productId: product.toHexString(), quantity })
    .expect(200);
}

async function emptyCart(customer: Customer): Promise<void> {
  await http().delete('/api/v1/cart').set(...bearer(customer)).expect(200);
}

interface PlaceOptions {
  readonly key?: string;
  /** A DIFFERENT saved address, for the idempotency-conflict case. */
  readonly addressId?: string;
  readonly note?: string;
}

/** `POST /orders`, with an idempotency key unless one is explicitly omitted. */
function place(customer: Customer, options: PlaceOptions = {}): request.Test {
  const body: Record<string, unknown> = { addressId: options.addressId ?? customer.addressId };

  if (options.note !== undefined) {
    body.customerNote = options.note;
  }

  const pending = http().post('/api/v1/orders').set(...bearer(customer));

  if (options.key !== undefined) {
    pending.set('Idempotency-Key', options.key);
  }

  return pending.send(body);
}

function quote(customer: Customer): request.Test {
  return http().post('/api/v1/checkout/quote').set(...bearer(customer)).send({});
}

async function stockOf(product: Types.ObjectId): Promise<number> {
  const row = await products
    .findById(product)
    .select({ 'stock.onHand': 1 })
    .lean<{ stock: { onHand: number } }>()
    .exec();

  return row?.stock.onHand ?? -1;
}

async function setStock(product: Types.ObjectId, onHand: number): Promise<void> {
  await products.updateOne({ _id: product }, { $set: { 'stock.onHand': onHand } }).exec();
}

async function ordersOf(customer: Customer): Promise<OrderLean[]> {
  const found = await orders.find({ userId: customer.id }).lean<OrderLean[]>().exec();
  for (const order of found) {
    if (!createdOrderIds.some((id) => id.equals(order._id))) {
      createdOrderIds.push(order._id);
    }
  }
  return found;
}

async function cartOf(customer: Customer): Promise<CartLean | null> {
  return carts.findOne({ userId: customer.id }).lean<CartLean>().exec();
}

let alice: Customer;
let bob: Customer;
let admin: Customer;
let racers: Customer[] = [];
/** Seeded product count, asserted unchanged at the end. */
let seededProductCount = 0;

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
  carts = app.get<Model<Cart>>(getModelToken(Cart.name));
  products = app.get<Model<Product>>(getModelToken(Product.name));
  orders = app.get<Model<Order>>(getModelToken(Order.name));
  inventoryEvents = app.get<Model<InventoryEvent>>(getModelToken(InventoryEvent.name));
  idempotencyKeys = app.get<Model<IdempotencyKeyRecord>>(getModelToken(IdempotencyKeyRecord.name));
  orderCounters = app.get<Model<OrderCounter>>(getModelToken(OrderCounter.name));
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));

  seededProductCount = await products.countDocuments({ sku: { $not: /^CHK-TEST-/ } }).exec();

  productId = {
    plentiful: await createProduct('plentiful', { onHand: 50, basePrice: 32500 }),
    onSale: await createProduct('onsale', { onHand: 40, basePrice: 40000, salePrice: 30000 }),
    repriced: await createProduct('repriced', { onHand: 30, basePrice: 20000 }),
    scarce: await createProduct('scarce', { onHand: 2, basePrice: 15000 }),
    empty: await createProduct('empty', { onHand: 0, basePrice: 9000 }),
    inactive: await createProduct('inactive', { onHand: 10, basePrice: 9000 }),
    raceLimited: await createProduct('race', { onHand: RACE_STOCK, basePrice: 11100 }),
    rollback: await createProduct('rollback', { onHand: 12, basePrice: 7700 }),
  };

  alice = await createCustomer('alice');
  bob = await createCustomer('bob');
  admin = await createCustomer('admin', Role.ADMIN);

  racers = [];
  for (let index = 0; index < RACERS; index += 1) {
    racers.push(await createCustomer(`racer${String(index)}`));
  }
}, 300_000);

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await inventoryEvents.deleteMany({ 'reference.id': { $in: createdOrderIds } }).exec();
    await orders.deleteMany({ _id: { $in: createdOrderIds } }).exec();
  }
  if (createdUserIds.length > 0) {
    // Sweep by owner too: an order created by a test that failed before it could
    // record the id must not survive this suite.
    await orders.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await idempotencyKeys.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await carts.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }
  if (createdProductIds.length > 0) {
    await inventoryEvents.deleteMany({ productId: { $in: createdProductIds } }).exec();
    await products.deleteMany({ _id: { $in: createdProductIds } }).exec();
  }

  // The seeded catalogue must be exactly as it was found. `orderCounters` is
  // deliberately LEFT ALONE: it is a shared daily sequence, and deleting it
  // would be a destructive act against a collection this suite only borrows.
  const remaining = await products.countDocuments({ sku: { $not: /^CHK-TEST-/ } }).exec();
  expect(remaining).toBe(seededProductCount);

  const connection = app.get<Connection>(getConnectionToken());
  await app.close();
  await connection.close();
}, 300_000);

// ---------------------------------------------------------------------------

describe('authentication and authorization', () => {
  it.each([
    ['POST', '/api/v1/checkout/quote'],
    ['POST', '/api/v1/orders'],
  ])('%s %s requires a token', async (_method, path) => {
    const response = await http().post(path).send({});

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a non-CUSTOMER principal on both endpoints', async () => {
    const quoted = await quote(admin);
    const placed = await place(admin, { key: randomUUID() });

    expect(quoted.status).toBe(403);
    expect(quoted.body.error.code).toBe('FORBIDDEN');
    expect(placed.status).toBe(403);
    expect(placed.body.error.code).toBe('FORBIDDEN');
  });
});

describe('quote', () => {
  it('returns an empty, unplaceable quote for a customer with no cart', async () => {
    await emptyCart(alice);

    const response = await quote(alice).expect(200);

    expect(response.body.data.items).toEqual([]);
    expect(response.body.data.itemCount).toBe(0);
    expect(response.body.data.pricing.itemsSubtotal.amount).toBe(0);
    expect(response.body.data.pricing.grandTotal.amount).toBe(0);
    expect(response.body.data.canPlaceOrder).toBe(false);
    expect(response.body.data.hasBlockingIssues).toBe(false);
  });

  it('prices from live catalogue data, with a self-describing money shape', async () => {
    await emptyCart(alice);
    await addToCart(alice, productId.plentiful, 2);
    await addToCart(alice, productId.onSale, 3);

    const response = await quote(alice).expect(200);
    const data = response.body.data;

    // 2 x 32500 + 3 x 30000 (the SALE price, not the base price).
    expect(data.pricing.itemsSubtotal.amount).toBe(2 * 32500 + 3 * 30000);
    expect(data.pricing.itemsSubtotal.currency).toBe('EGP');
    expect(data.pricing.itemsSubtotal.formatted).toBe('1,550.00 EGP');
    expect(data.pricing.discountTotal.amount).toBe(0);
    expect(data.pricing.shippingFee.amount).toBe(0);
    expect(data.pricing.grandTotal.amount).toBe(data.pricing.itemsSubtotal.amount);
    expect(data.pricing.vatInclusive).toBe(true);
    expect(data.pricing.vatRateBps).toBe(1400);
    expect(data.canPlaceOrder).toBe(true);
    expect(data.generatedAt).toMatch(/Z$/);
  });

  it('reflects a repriced product immediately, and flags the line', async () => {
    await emptyCart(alice);
    await addToCart(alice, productId.repriced, 2);

    const before = await quote(alice).expect(200);
    expect(before.body.data.pricing.grandTotal.amount).toBe(40000);
    expect(before.body.data.items[0].status).toBe('OK');

    await products
      .updateOne(
        { _id: productId.repriced },
        { $set: { 'pricing.basePrice': 25000, 'pricing.effectivePrice': 25000 } },
      )
      .exec();

    const after = await quote(alice).expect(200);

    expect(after.body.data.items[0].status).toBe('PRICE_CHANGED');
    expect(after.body.data.items[0].unitPrice.amount).toBe(25000);
    expect(after.body.data.items[0].previousUnitPrice.amount).toBe(20000);
    // The NEW price is authoritative. A price change does not block checkout.
    expect(after.body.data.pricing.grandTotal.amount).toBe(50000);
    expect(after.body.data.canPlaceOrder).toBe(true);
  });

  it('excludes an out-of-stock line from the total and refuses placement', async () => {
    await emptyCart(alice);
    await addToCart(alice, productId.plentiful, 1);
    // Added while in stock, then emptied underneath the customer.
    await addToCart(alice, productId.scarce, 1);
    await setStock(productId.scarce, 0);

    const response = await quote(alice).expect(200);
    const data = response.body.data;

    expect(data.items).toHaveLength(2);
    expect(data.pricing.itemsSubtotal.amount).toBe(32500);
    expect(data.hasBlockingIssues).toBe(true);
    expect(data.canPlaceOrder).toBe(false);
    expect(data.items.map((item: { status: string }) => item.status)).toContain('OUT_OF_STOCK');

    await setStock(productId.scarce, 2);
  });

  it('excludes a delisted line from the total and refuses placement', async () => {
    await emptyCart(alice);
    await addToCart(alice, productId.plentiful, 1);
    await addToCart(alice, productId.inactive, 1);
    await products.updateOne({ _id: productId.inactive }, { $set: { isActive: false } }).exec();

    const response = await quote(alice).expect(200);

    expect(response.body.data.pricing.itemsSubtotal.amount).toBe(32500);
    expect(response.body.data.canPlaceOrder).toBe(false);
    expect(
      response.body.data.items.map((item: { status: string }) => item.status),
    ).toContain('UNAVAILABLE');
  });

  it('rejects a body field whose domain does not exist rather than ignoring it', async () => {
    const response = await http()
      .post('/api/v1/checkout/quote')
      .set(...bearer(alice))
      .send({ couponCode: 'MAKER10' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('writes nothing — a quote is not a reservation', async () => {
    await emptyCart(alice);
    await addToCart(alice, productId.plentiful, 2);

    const stockBefore = await stockOf(productId.plentiful);
    await quote(alice).expect(200);
    await quote(alice).expect(200);

    expect(await stockOf(productId.plentiful)).toBe(stockBefore);
    expect(await ordersOf(alice)).toHaveLength(0);
    expect((await cartOf(alice))?.items).toHaveLength(1);
  });
});

describe('placement — request contract', () => {
  it('refuses a request with no Idempotency-Key', async () => {
    await emptyCart(alice);
    await addToCart(alice, productId.plentiful, 1);

    const response = await place(alice);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
    expect(await ordersOf(alice)).toHaveLength(0);
  });

  it('refuses an Idempotency-Key that is not a UUID', async () => {
    const response = await place(alice, { key: 'not-a-uuid' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await ordersOf(alice)).toHaveLength(0);
  });

  it.each([
    ['items', { items: [{ productId: '652f1a9b3c4d5e6f7a8b9c0d', quantity: 1 }] }],
    ['userId', { userId: '652f1a9b3c4d5e6f7a8b9c0d' }],
    ['grandTotal', { grandTotal: 1 }],
    ['status', { status: 'DELIVERED' }],
    ['currency', { currency: 'USD' }],
    ['orderNumber', { orderNumber: 'NE-20000101-0001' }],
  ])('refuses an injected %s field outright', async (_field, injected) => {
    const response = await http()
      .post('/api/v1/orders')
      .set(...bearer(alice))
      .set('Idempotency-Key', randomUUID())
      .send({ addressId: alice.addressId, ...injected });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    expect(await ordersOf(alice)).toHaveLength(0);
  });

  /**
   * CHANGED DELIBERATELY by the address phase. This case used to send an inline
   * address with a bad phone number and assert that the server, not the browser,
   * validated it. `POST /orders` no longer accepts an address at all, so the
   * assertion moves with the field: address validation is exercised against
   * `POST /users/me/addresses` in `test/users/addresses.spec.ts`, and what this
   * endpoint must now prove is that an inline address is REFUSED outright rather
   * than validated and used.
   */
  it('refuses an inline delivery address outright', async () => {
    const response = await http()
      .post('/api/v1/orders')
      .set(...bearer(alice))
      .set('Idempotency-Key', randomUUID())
      .send({
        addressId: alice.addressId,
        shippingAddress: { ...ADDRESS, phone: '5551234' },
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    expect(response.body.error.details[0].field).toBe('shippingAddress');
  });

  it('refuses an addressId belonging to another customer, as a 404', async () => {
    await emptyCart(alice);
    await addToCart(alice, productId.plentiful, 1);

    const response = await place(alice, { key: randomUUID(), addressId: bob.addressId });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ADDRESS_NOT_FOUND');
    expect(await ordersOf(alice)).toHaveLength(0);

    await emptyCart(alice);
  });

  it('refuses an empty cart with CART_EMPTY', async () => {
    await emptyCart(alice);

    const response = await place(alice, { key: randomUUID() });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('CART_EMPTY');
    expect(await ordersOf(alice)).toHaveLength(0);
  });

  it('refuses a cart containing an out-of-stock line, naming the SKU', async () => {
    await emptyCart(alice);
    await addToCart(alice, productId.plentiful, 1);
    await addToCart(alice, productId.scarce, 1);
    await setStock(productId.scarce, 0);

    const stockBefore = await stockOf(productId.plentiful);
    const response = await place(alice, { key: randomUUID() });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('OUT_OF_STOCK');
    expect(response.body.error.details[0].message).toContain(
      `CHK-TEST-SCARCE-${RUN_ID}`.toUpperCase(),
    );
    // Nothing moved: the good line was not decremented on the way to the bad one.
    expect(await stockOf(productId.plentiful)).toBe(stockBefore);
    expect(await ordersOf(alice)).toHaveLength(0);

    await setStock(productId.scarce, 2);
  });

  it('refuses a cart containing a delisted line', async () => {
    await emptyCart(alice);
    await addToCart(alice, productId.plentiful, 1);
    // Re-listed only long enough to get it into the cart: the cart refuses to
    // ADD a delisted product, and the case under test is a product delisted
    // AFTER it was added.
    await products.updateOne({ _id: productId.inactive }, { $set: { isActive: true } }).exec();
    await addToCart(alice, productId.inactive, 1);
    await products.updateOne({ _id: productId.inactive }, { $set: { isActive: false } }).exec();

    const response = await place(alice, { key: randomUUID() });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PRODUCT_UNAVAILABLE');
    expect(await ordersOf(alice)).toHaveLength(0);
  });

  it('never leaks MongoDB internals through an error', async () => {
    await emptyCart(alice);

    const response = await place(alice, { key: randomUUID() });
    const body = JSON.stringify(response.body);

    for (const forbidden of ['E11000', 'MongoServerError', 'mongodb', 'index', 'collection', 'stack']) {
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(Object.keys(response.body.error).sort()).toEqual([
      'code',
      'message',
      'requestId',
      'timestamp',
    ]);
  });
});

describe('placement — the happy path', () => {
  const key = randomUUID();
  let placedId: string;
  let stockBefore = { plentiful: 0, onSale: 0 };

  it('creates exactly one order, with a server-authoritative financial snapshot', async () => {
    await emptyCart(alice);
    await addToCart(alice, productId.plentiful, 2);
    await addToCart(alice, productId.onSale, 3);

    stockBefore = {
      plentiful: await stockOf(productId.plentiful),
      onSale: await stockOf(productId.onSale),
    };

    const response = await place(alice, { key, note: 'Please call before delivery.' });

    expect(response.status).toBe(201);

    const order = response.body.data;
    placedId = order.id as string;

    expect(order.orderNumber).toMatch(/^NE-\d{8}-\d{4,}$/);
    expect(order.status).toBe('PLACED');
    expect(order.payment).toEqual({ method: 'COD', status: 'PENDING', collectedAt: null });
    expect(order.currency).toBe('EGP');
    expect(order.customerNote).toBe('Please call before delivery.');
    expect(order.shippingAddress).toEqual({ ...ADDRESS, postalCode: null });
    expect(order.customer.email).toBe(`checkout-alice.${RUN_ID}@example.test`);

    // Money: integer minor units, exact, and internally consistent.
    const lines = order.items as { unitPrice: { amount: number }; quantity: number; lineTotal: { amount: number } }[];
    for (const line of lines) {
      expect(line.lineTotal.amount).toBe(line.unitPrice.amount * line.quantity);
    }
    const subtotal = lines.reduce((total, line) => total + line.lineTotal.amount, 0);
    expect(order.pricing.itemsSubtotal.amount).toBe(subtotal);
    expect(order.pricing.itemsSubtotal.amount).toBe(2 * 32500 + 3 * 30000);
    expect(order.pricing.discountTotal.amount).toBe(0);
    expect(order.pricing.shippingFee.amount).toBe(0);
    expect(order.pricing.grandTotal.amount).toBe(
      order.pricing.itemsSubtotal.amount - order.pricing.discountTotal.amount + order.pricing.shippingFee.amount,
    );
    expect(order.pricing.vatInclusive).toBe(true);

    // Exactly ONE order exists for this customer.
    const stored = await ordersOf(alice);
    expect(stored).toHaveLength(1);
    expect(stored[0]?._id.toHexString()).toBe(placedId);
  });

  it('stores a durable snapshot rather than a reference to live product data', async () => {
    const stored = (await ordersOf(alice))[0] as OrderLean;

    expect(stored.items).toHaveLength(2);
    for (const item of stored.items) {
      expect(item.sku).toMatch(/^CHK-TEST-/);
      expect(item.slug.length).toBeGreaterThan(0);
      expect(item.name.en.length).toBeGreaterThan(0);
      expect(Number.isSafeInteger(item.unitPrice)).toBe(true);
      expect(item.lineTotal).toBe(item.unitPrice * item.quantity);
    }

    // Renaming and re-pricing the product afterwards must not touch the order.
    await products
      .updateOne(
        { _id: productId.plentiful },
        {
          $set: {
            'name.en': 'RENAMED AFTER THE ORDER',
            'pricing.basePrice': 999_999,
            'pricing.effectivePrice': 999_999,
          },
        },
      )
      .exec();

    const reread = (await orders.findById(stored._id).lean<OrderLean>().exec()) as OrderLean;
    const line = reread.items.find((item) => item.productId.equals(productId.plentiful));

    expect(line?.name.en).toBe('Checkout Test plentiful');
    expect(line?.unitPrice).toBe(32500);
    expect(reread.pricing.itemsSubtotal).toBe(2 * 32500 + 3 * 30000);

    // Restore, so later cases in this file work from a predictable catalogue.
    await products
      .updateOne(
        { _id: productId.plentiful },
        {
          $set: {
            'name.en': 'Checkout Test plentiful',
            'pricing.basePrice': 32500,
            'pricing.effectivePrice': 32500,
          },
        },
      )
      .exec();
  });

  it('decremented stock by exactly the ordered quantity', async () => {
    expect(await stockOf(productId.plentiful)).toBe(stockBefore.plentiful - 2);
    expect(await stockOf(productId.onSale)).toBe(stockBefore.onSale - 3);
  });

  it('wrote one ledger entry per line, with self-verifying balances', async () => {
    const order = (await ordersOf(alice))[0] as OrderLean;
    const events = await inventoryEvents
      .find({ 'reference.id': order._id })
      .lean<
        {
          productId: Types.ObjectId;
          type: string;
          quantityDelta: number;
          balanceBefore: number;
          balanceAfter: number;
          reason: string;
          actor: { id: Types.ObjectId; role: string } | null;
        }[]
      >()
      .exec();

    expect(events).toHaveLength(2);

    for (const event of events) {
      const line = order.items.find((item) => item.productId.equals(event.productId));

      expect(event.type).toBe('SALE');
      expect(event.quantityDelta).toBe(-(line?.quantity ?? 0));
      expect(event.balanceAfter).toBe(event.balanceBefore + event.quantityDelta);
      expect(event.reason).toBe(`Order ${order.orderNumber}`);
      // Attribution, which legacy left NULL on every sale it ever recorded.
      expect(event.actor?.id.toHexString()).toBe(alice.id.toHexString());
      expect(event.actor?.role).toBe('CUSTOMER');
    }
  });

  it('emptied the cart inside the same transaction', async () => {
    const cart = await cartOf(alice);

    expect(cart?.items).toEqual([]);
    expect((await quote(alice).expect(200)).body.data.canPlaceOrder).toBe(false);
  });
});

describe('idempotency', () => {
  it('a retry with the same key returns the original order and creates no second one', async () => {
    await emptyCart(bob);
    await addToCart(bob, productId.plentiful, 1);

    const key = randomUUID();
    const stockBefore = await stockOf(productId.plentiful);

    const first = await place(bob, { key });
    expect(first.status).toBe(201);

    const retry = await place(bob, { key });

    // 200 rather than 201, and the SAME order — byte for byte.
    expect(retry.status).toBe(200);
    expect(retry.body.data).toEqual(first.body.data);

    expect(await ordersOf(bob)).toHaveLength(1);
    // The decisive assertion: stock moved ONCE, not twice.
    expect(await stockOf(productId.plentiful)).toBe(stockBefore - 1);
    expect(
      await inventoryEvents.countDocuments({ 'reference.id': new Types.ObjectId(first.body.data.id as string) }).exec(),
    ).toBe(1);
    expect((await cartOf(bob))?.items).toEqual([]);
  });

  it('persists the key in the database, not in process memory', async () => {
    const record = await idempotencyKeys.findOne({ userId: bob.id }).lean<{
      key: string;
      userId: Types.ObjectId;
      orderId: Types.ObjectId;
      requestHash: string;
      expiresAt: Date;
    }>().exec();

    expect(record).not.toBeNull();
    expect(record?.userId.toHexString()).toBe(bob.id.toHexString());
    expect(record?.requestHash).toMatch(/^[0-9a-f]{64}$/);
    // 24 hours, so a retry survives a process restart and reaches any instance.
    expect((record as { expiresAt: Date }).expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('still refuses a second order once the key record has expired', async () => {
    const order = (await ordersOf(bob))[0] as OrderLean;
    const key = order.idempotencyKey;

    // Simulate the 24-hour TTL having fired, leaving only the order behind.
    await idempotencyKeys.deleteOne({ key }).exec();

    await addToCart(bob, productId.plentiful, 1);
    const stockBefore = await stockOf(productId.plentiful);

    const retry = await place(bob, { key });

    // Recovered through `orders.idempotencyKey`, which is unique FOREVER.
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(order._id.toHexString());
    expect(await ordersOf(bob)).toHaveLength(1);
    expect(await stockOf(productId.plentiful)).toBe(stockBefore);

    await emptyCart(bob);
  });

  it('refuses the same key with a materially different request', async () => {
    await emptyCart(bob);
    await addToCart(bob, productId.plentiful, 1);

    const key = randomUUID();
    const first = await place(bob, { key });
    expect(first.status).toBe(201);

    // A DIFFERENT saved address is what now makes the request materially
    // different — the address is no longer on the wire, its id is.
    const elsewhere = await saveAddress(bob.token, {
      label: 'Elsewhere',
      street: 'A COMPLETELY DIFFERENT ADDRESS, 99',
    });
    const conflicting = await place(bob, { key, addressId: elsewhere });

    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // Crucially, it does NOT return the first order: shipping to the wrong
    // address is worse than refusing.
    expect(JSON.stringify(conflicting.body)).not.toContain(first.body.data.orderNumber as string);
    expect(await ordersOf(bob)).toHaveLength(2);
  });

  it('never lets one account read or reuse another account key', async () => {
    // A key whose RECORD still exists, so the refusal happens in the pre-flight
    // check — before a transaction opens and before any order is loaded.
    const record = (await idempotencyKeys
      .findOne({ userId: bob.id })
      .lean<{ key: string; orderId: Types.ObjectId }>()
      .exec()) as { key: string; orderId: Types.ObjectId };
    const stolen = (await orders.findById(record.orderId).lean<OrderLean>().exec()) as OrderLean;

    await emptyCart(alice);
    await addToCart(alice, productId.plentiful, 1);

    const response = await place(alice, { key: record.key });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // No order for alice, and no stock moved: the refusal is before the
    // transaction, not a rollback after one.
    expect(await ordersOf(alice)).toHaveLength(1);

    const leaked = JSON.stringify(response.body);
    expect(leaked).not.toContain(stolen.orderNumber);
    expect(leaked).not.toContain(stolen._id.toHexString());
    expect(leaked).not.toContain(bob.id.toHexString());

    await emptyCart(alice);
  });

  it('produces at most one order when the same key arrives concurrently', async () => {
    await emptyCart(bob);
    await addToCart(bob, productId.plentiful, 2);

    const key = randomUUID();
    const ordersBefore = (await ordersOf(bob)).length;
    const stockBefore = await stockOf(productId.plentiful);

    const responses = await Promise.all([
      place(bob, { key }),
      place(bob, { key }),
      place(bob, { key }),
      place(bob, { key }),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    const created = statuses.filter((status) => status === 201);
    const replayed = statuses.filter((status) => status === 200);

    // Every response is a success, and exactly one of them did the creating.
    expect(created).toHaveLength(1);
    expect(replayed).toHaveLength(3);

    const ids = new Set(responses.map((response) => response.body.data.id as string));
    expect(ids.size).toBe(1);

    expect(await ordersOf(bob)).toHaveLength(ordersBefore + 1);
    // Stock left for ONE order of 2, not four.
    expect(await stockOf(productId.plentiful)).toBe(stockBefore - 2);
  }, 120_000);
});

describe('transaction rollback', () => {
  /**
   * Forces a failure AFTER the transaction has already written.
   *
   * The order number is reserved, stock is decremented and the ledger is written
   * BEFORE the order document is inserted. Parking a decoy order on the exact
   * number the counter will hand out next makes that insert fail on the unique
   * `orderNumber` index — a real failure at a real point in the sequence, not a
   * mock and not an injected fault.
   *
   * That is what makes the assertions below meaningful: the writes genuinely
   * happened and were genuinely undone, rather than never having been attempted.
   */
  it('undoes every write when the order insert fails', async () => {
    await emptyCart(alice);
    await addToCart(alice, productId.rollback, 4);

    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const counter = await orderCounters.findById(day).lean<{ seq: number }>().exec();
    const nextNumber = `NE-${day}-${String((counter?.seq ?? 0) + 1).padStart(4, '0')}`;

    const template = (await orders.findOne({ userId: alice.id }).lean<OrderLean>().exec()) as OrderLean;
    const decoy = await orders.collection.insertOne({
      ...template,
      _id: new Types.ObjectId(),
      orderNumber: nextNumber,
      idempotencyKey: randomUUID(),
    });
    createdOrderIds.push(decoy.insertedId as unknown as Types.ObjectId);

    const stockBefore = await stockOf(productId.rollback);
    const ordersBefore = (await ordersOf(alice)).length;
    const key = randomUUID();

    const response = await place(alice, { key });

    // A duplicate order number is a counter race: the client is told to retry,
    // and is told nothing about indexes, collections or drivers.
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONCURRENT_MODIFICATION');
    expect(JSON.stringify(response.body)).not.toContain('E11000');

    // NO PARTIAL STATE. Every one of these was written inside the transaction.
    expect(await stockOf(productId.rollback)).toBe(stockBefore);
    expect(await inventoryEvents.countDocuments({ productId: productId.rollback }).exec()).toBe(0);
    // Only the decoy holds that number — the aborted placement wrote nothing.
    expect(
      await orders
        .countDocuments({ orderNumber: nextNumber, _id: { $ne: decoy.insertedId } })
        .exec(),
    ).toBe(0);
    expect((await ordersOf(alice)).length).toBe(ordersBefore);

    // The cart is untouched, so the customer has not silently lost their basket.
    const cart = await cartOf(alice);
    expect(cart?.items).toHaveLength(1);
    expect(cart?.items[0]?.quantity).toBe(4);

    // And the key was NOT consumed: the same key still works once the cause is
    // gone, which is what makes a client retry meaningful.
    expect(await idempotencyKeys.countDocuments({ key }).exec()).toBe(0);

    await orders.deleteOne({ _id: decoy.insertedId }).exec();

    const retry = await place(alice, { key });
    expect(retry.status).toBe(201);
    expect(await stockOf(productId.rollback)).toBe(stockBefore - 4);
    expect((await cartOf(alice))?.items).toEqual([]);
  }, 120_000);
});

describe('stock race', () => {
  it('never oversells, and a loser leaves nothing behind', async () => {
    await setStock(productId.raceLimited, RACE_STOCK);

    for (const racer of racers) {
      await emptyCart(racer);
      await addToCart(racer, productId.raceLimited, 1);
    }

    const responses = await Promise.all(
      racers.map((racer) => place(racer, { key: randomUUID() })),
    );

    const winners = responses.filter((response) => response.status === 201);
    const losers = responses.filter((response) => response.status !== 201);

    // AT MOST the available number succeed. Exactly three here, because every
    // racer wanted one unit and three existed.
    expect(winners).toHaveLength(RACE_STOCK);
    expect(losers).toHaveLength(RACERS - RACE_STOCK);
    for (const loser of losers) {
      expect(loser.status).toBe(409);
      expect(loser.body.error.code).toBe('OUT_OF_STOCK');
    }

    // Inventory never went negative, and every unit is accounted for.
    const remaining = await stockOf(productId.raceLimited);
    expect(remaining).toBe(0);
    expect(remaining).toBeGreaterThanOrEqual(0);

    // One order per winner and not one more, across all five accounts.
    const placed = await orders
      .find({ userId: { $in: racers.map((racer) => racer.id) } })
      .lean<OrderLean[]>()
      .exec();
    for (const order of placed) {
      createdOrderIds.push(order._id);
    }
    expect(placed).toHaveLength(RACE_STOCK);

    // The ledger agrees with the stock that actually moved.
    const events = await inventoryEvents
      .find({ productId: productId.raceLimited })
      .lean<{ quantityDelta: number }[]>()
      .exec();
    expect(events).toHaveLength(RACE_STOCK);
    expect(events.reduce((total, event) => total + event.quantityDelta, 0)).toBe(-RACE_STOCK);

    // A loser wrote nothing at all — no order, and no consumed key.
    const loserIds = racers
      .filter((racer) => !placed.some((order) => order.userId.equals(racer.id)))
      .map((racer) => racer.id);
    expect(await orders.countDocuments({ userId: { $in: loserIds } }).exec()).toBe(0);
    expect(await idempotencyKeys.countDocuments({ userId: { $in: loserIds } }).exec()).toBe(0);
    // Their carts survive, so they can retry once stock returns.
    for (const id of loserIds) {
      const cart = await carts.findOne({ userId: id }).lean<CartLean>().exec();
      expect(cart?.items).toHaveLength(1);
    }
  }, 180_000);
});

describe('index usage', () => {
  it('serves the idempotency replay lookup from an index, not a collection scan', async () => {
    const plan = await idempotencyKeys.collection
      .find({ key: randomUUID() })
      .explain('queryPlanner');

    const winning = JSON.stringify(
      (plan as { queryPlanner?: { winningPlan?: unknown } }).queryPlanner?.winningPlan ?? {},
    );

    expect(winning).toContain('IXSCAN');
    expect(winning).toContain('idempotency_key_unique');
  });

  it('serves the expired-key order recovery from an index', async () => {
    const plan = await orders.collection
      .find({ idempotencyKey: randomUUID() })
      .explain('queryPlanner');

    const winning = JSON.stringify(
      (plan as { queryPlanner?: { winningPlan?: unknown } }).queryPlanner?.winningPlan ?? {},
    );

    expect(winning).toContain('IXSCAN');
    expect(winning).toContain('order_idempotency_key_unique');
  });
});
