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
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { InventoryEvent } from '../../src/modules/inventory/infrastructure/schemas/inventory-event.schema';
import { IdempotencyKeyRecord } from '../../src/modules/orders/infrastructure/schemas/idempotency-key.schema';
import { Order } from '../../src/modules/orders/infrastructure/schemas/order.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * The customer Orders READ API, end to end, against the real application and
 * the real development database.
 *
 * Orders here are placed through the REAL `POST /orders`, not inserted by
 * hand — a read test that fabricates its own rows proves the reader agrees with
 * the test author, not with the writer.
 *
 * ISOLATION. Own products, own users, own orders; everything removed by tracked
 * id in `afterAll`. No `dropDatabase`, no `deleteMany({})`, and the seeded
 * catalogue count is asserted unchanged at the end.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';

/** Enough orders for three pages at `limit=2`, with a remainder. */
const ALICE_ORDERS = 5;

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
let refreshTokens: Model<RefreshToken>;

const createdUserIds: Types.ObjectId[] = [];
const createdProductIds: Types.ObjectId[] = [];
const createdOrderIds: Types.ObjectId[] = [];

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

function http(): request.Agent {
  return request(app.getHttpServer());
}

function bearer(customer: Customer): [string, string] {
  return ['Authorization', `Bearer ${customer.token}`];
}

async function createCustomer(label: string, role: Role = Role.CUSTOMER): Promise<Customer> {
  const email = `ordersread-${label}.${RUN_ID}@example.test`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: `Orders ${label}` })
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

async function createProduct(label: string, onHand: number, basePrice: number): Promise<Types.ObjectId> {
  const category = await app
    .get<Model<Category>>(getModelToken(Category.name))
    .findOne({ slug: 'development-boards' })
    .lean<{ _id: Types.ObjectId; slug: string; name: { en: string }; path: Types.ObjectId[] }>()
    .exec();

  if (category === null) {
    throw new Error('seed category development-boards is missing — run `pnpm --filter api seed`');
  }

  const created = await products.create({
    sku: `ORD-TEST-${label.toUpperCase()}-${RUN_ID}`,
    slug: `ord-test-${label}-${RUN_ID}`,
    name: { en: `Orders Test ${label}`, ar: null },
    shortDescription: { en: 'Created by the orders-read test suite.', ar: null },
    description: null,
    category: {
      id: category._id,
      slug: category.slug,
      name: { en: category.name.en, ar: null },
      path: [...category.path, category._id],
    },
    brand: null,
    pricing: { basePrice, salePrice: null, effectivePrice: basePrice, costPrice: 100 },
    currency: 'EGP',
    stock: { onHand, lowStockThreshold: 5 },
    images: [
      {
        publicId: `nest/products/ord-${label}-${RUN_ID}`,
        version: 1,
        format: 'webp',
        width: 800,
        height: 800,
        bytes: 12345,
        alt: null,
        sortOrder: 0,
        isPrimary: true,
      },
    ],
    specs: [],
    salesCount: 0,
    isActive: true,
    isFeatured: false,
    deletedAt: null,
    weight: null,
  });

  createdProductIds.push(created._id);
  return created._id;
}

/** Places one REAL order: add to cart, then `POST /orders`. Returns the order id. */
async function placeOrder(
  customer: Customer,
  product: Types.ObjectId,
  quantity: number,
): Promise<string> {
  await http()
    .post('/api/v1/cart/items')
    .set(...bearer(customer))
    .send({ productId: product.toHexString(), quantity })
    .expect(200);

  const response = await http()
    .post('/api/v1/orders')
    .set(...bearer(customer))
    .set('Idempotency-Key', randomUUID())
    .send({ addressId: customer.addressId })
    .expect(201);

  const id = response.body.data.id as string;
  createdOrderIds.push(new Types.ObjectId(id));
  return id;
}

let alice: Customer;
let bob: Customer;
let newcomer: Customer;
let admin: Customer;
let stock: Types.ObjectId;
/** Used by exactly one order, then HARD-DELETED to prove snapshot resilience. */
let doomed: Types.ObjectId;
let aliceOrderIds: string[] = [];
let bobOrderId = '';
let doomedOrderId = '';
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
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));

  seededProductCount = await products.countDocuments({ sku: { $not: /^ORD-TEST-/ } }).exec();

  stock = await createProduct('stock', 200, 32500);
  doomed = await createProduct('doomed', 20, 18000);

  alice = await createCustomer('alice');
  bob = await createCustomer('bob');
  newcomer = await createCustomer('newcomer');
  admin = await createCustomer('admin', Role.ADMIN);

  // Placed one at a time, oldest first, so "newest first" is a real assertion.
  aliceOrderIds = [];
  for (let index = 0; index < ALICE_ORDERS; index += 1) {
    aliceOrderIds.push(await placeOrder(alice, stock, index + 1));
  }

  doomedOrderId = await placeOrder(alice, doomed, 2);
  aliceOrderIds.push(doomedOrderId);

  bobOrderId = await placeOrder(bob, stock, 1);
}, 300_000);

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await inventoryEvents.deleteMany({ 'reference.id': { $in: createdOrderIds } }).exec();
    await orders.deleteMany({ _id: { $in: createdOrderIds } }).exec();
  }
  if (createdUserIds.length > 0) {
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

  expect(await products.countDocuments({ sku: { $not: /^ORD-TEST-/ } }).exec()).toBe(
    seededProductCount,
  );

  const connection = app.get<Connection>(getConnectionToken());
  await app.close();
  await connection.close();
}, 300_000);

// ---------------------------------------------------------------------------

describe('authentication and authorization', () => {
  it('refuses an unauthenticated list', async () => {
    const response = await http().get('/api/v1/orders');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses an unauthenticated detail', async () => {
    const response = await http().get(`/api/v1/orders/${aliceOrderIds[0] ?? ''}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a non-CUSTOMER principal on both routes', async () => {
    const list = await http().get('/api/v1/orders').set(...bearer(admin));
    const detail = await http()
      .get(`/api/v1/orders/${aliceOrderIds[0] ?? ''}`)
      .set(...bearer(admin));

    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe('FORBIDDEN');
    expect(detail.status).toBe(403);
    expect(detail.body.error.code).toBe('FORBIDDEN');
  });
});

describe('empty history', () => {
  it('returns 200 with an empty page and correct metadata', async () => {
    const response = await http().get('/api/v1/orders').set(...bearer(newcomer)).expect(200);

    expect(response.body.data).toEqual([]);
    expect(response.body.meta).toEqual({
      page: 1,
      limit: 24,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    });
  });
});

describe('ownership', () => {
  it('returns only the caller own orders', async () => {
    const response = await http()
      .get('/api/v1/orders')
      .query({ limit: 100 })
      .set(...bearer(alice))
      .expect(200);

    const ids = (response.body.data as { id: string }[]).map((row) => row.id);

    expect(ids.sort()).toEqual([...aliceOrderIds].sort());
    expect(ids).not.toContain(bobOrderId);
    expect(response.body.meta.total).toBe(aliceOrderIds.length);

    const bobs = await http()
      .get('/api/v1/orders')
      .set(...bearer(bob))
      .expect(200);

    expect((bobs.body.data as { id: string }[]).map((row) => row.id)).toEqual([bobOrderId]);
  });

  it('answers a foreign order EXACTLY as it answers a nonexistent one', async () => {
    const foreign = await http()
      .get(`/api/v1/orders/${bobOrderId}`)
      .set(...bearer(alice));

    const missing = await http()
      .get(`/api/v1/orders/${new Types.ObjectId().toHexString()}`)
      .set(...bearer(alice));

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body.error.code).toBe('ORDER_NOT_FOUND');

    // Byte-identical apart from the per-request correlation fields. There is no
    // observable difference, so an id cannot be probed for existence.
    // Everything except the per-request correlation fields, which differ by
    // design on every response.
    const strip = (body: { error: Record<string, unknown> }): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(body.error).filter(([key]) => key !== 'requestId' && key !== 'timestamp'),
      );
    expect(strip(foreign.body)).toEqual(strip(missing.body));

    // And nothing about the real order leaked.
    const leaked = JSON.stringify(foreign.body);
    expect(leaked).not.toContain(bobOrderId);
    expect(leaked).not.toContain(bob.id.toHexString());
  });

  it('rejects a malformed id as a 400, which depends only on the string shape', async () => {
    const response = await http().get('/api/v1/orders/not-an-object-id').set(...bearer(alice));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('cannot be widened by a userId query parameter', async () => {
    const response = await http()
      .get('/api/v1/orders')
      .query({ userId: bob.id.toHexString() })
      .set(...bearer(alice));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });
});

describe('ordering', () => {
  it('returns newest first', async () => {
    const response = await http()
      .get('/api/v1/orders')
      .query({ limit: 100 })
      .set(...bearer(alice))
      .expect(200);

    const rows = response.body.data as { id: string; placedAt: string }[];
    const times = rows.map((row) => Date.parse(row.placedAt));

    for (let index = 1; index < times.length; index += 1) {
      expect(times[index - 1] as number).toBeGreaterThanOrEqual(times[index] as number);
    }
    // The most recently placed order is first.
    expect(rows[0]?.id).toBe(aliceOrderIds[aliceOrderIds.length - 1]);
  });

  it('breaks a placedAt tie deterministically, by descending id', async () => {
    // Force a collision that concurrent checkouts genuinely produce.
    const tied = aliceOrderIds.slice(0, 3).map((id) => new Types.ObjectId(id));
    const sameInstant = new Date('2026-08-01T10:00:00.000Z');
    await orders.updateMany({ _id: { $in: tied } }, { $set: { placedAt: sameInstant } }).exec();

    const first = await http()
      .get('/api/v1/orders')
      .query({ limit: 100 })
      .set(...bearer(alice))
      .expect(200);
    const second = await http()
      .get('/api/v1/orders')
      .query({ limit: 100 })
      .set(...bearer(alice))
      .expect(200);

    const idsOf = (body: { data: { id: string }[] }): string[] => body.data.map((row) => row.id);

    // Stable across calls — without the `_id` tie-break these could differ.
    expect(idsOf(first.body)).toEqual(idsOf(second.body));

    const tiedInOrder = idsOf(first.body).filter((id) => tied.some((t) => t.toHexString() === id));
    const expected = [...tied].sort((a, b) => (a.toHexString() < b.toHexString() ? 1 : -1));
    expect(tiedInOrder).toEqual(expected.map((id) => id.toHexString()));

    // Restore, so pagination below runs against distinct timestamps too.
    for (const [index, id] of tied.entries()) {
      await orders
        .updateOne({ _id: id }, { $set: { placedAt: new Date(sameInstant.getTime() + index) } })
        .exec();
    }
  });
});

describe('pagination', () => {
  it('walks every page with no duplicates and no gaps', async () => {
    const limit = 2;
    const seen: string[] = [];
    let page = 1;
    let guard = 0;

    for (;;) {
      guard += 1;
      expect(guard).toBeLessThan(20);

      const response = await http()
        .get('/api/v1/orders')
        .query({ page, limit })
        .set(...bearer(alice))
        .expect(200);

      const rows = response.body.data as { id: string }[];
      const meta = response.body.meta as {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
      };

      expect(meta.page).toBe(page);
      expect(meta.limit).toBe(limit);
      expect(meta.total).toBe(aliceOrderIds.length);
      expect(meta.totalPages).toBe(Math.ceil(aliceOrderIds.length / limit));
      expect(meta.hasPrev).toBe(page > 1);
      expect(rows.length).toBeLessThanOrEqual(limit);

      seen.push(...rows.map((row) => row.id));

      if (!meta.hasNext) {
        break;
      }
      page += 1;
    }

    // Every order exactly once: no duplicates across page boundaries, nothing
    // skipped. That is the property the `_id` tie-break exists to guarantee.
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual([...aliceOrderIds].sort());
  });

  it('returns an empty page past the end, without inventing metadata', async () => {
    const response = await http()
      .get('/api/v1/orders')
      .query({ page: 99, limit: 2 })
      .set(...bearer(alice))
      .expect(200);

    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(aliceOrderIds.length);
    expect(response.body.meta.hasNext).toBe(false);
  });

  it.each([
    ['page', { page: 0 }],
    ['page', { page: -1 }],
    ['limit', { limit: 0 }],
    ['limit', { limit: 101 }],
    ['limit', { limit: 'many' }],
  ])('rejects a bad %s', async (_field, query) => {
    const response = await http()
      .get('/api/v1/orders')
      .query(query)
      .set(...bearer(alice));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('filtering', () => {
  it('matches every order when the filter names their status', async () => {
    const response = await http()
      .get('/api/v1/orders')
      .query({ status: 'PLACED', limit: 100 })
      .set(...bearer(alice))
      .expect(200);

    expect(response.body.meta.total).toBe(aliceOrderIds.length);
  });

  it('excludes orders whose status is not named', async () => {
    const response = await http()
      .get('/api/v1/orders')
      .query({ status: 'CANCELLED' })
      .set(...bearer(alice))
      .expect(200);

    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
  });

  it('treats a repeated status as OR', async () => {
    const response = await http()
      .get('/api/v1/orders?status=PLACED&status=CANCELLED&limit=100')
      .set(...bearer(alice))
      .expect(200);

    expect(response.body.meta.total).toBe(aliceOrderIds.length);
  });

  it('rejects a status outside the frozen vocabulary', async () => {
    const response = await http()
      .get('/api/v1/orders')
      .query({ status: 'DEFINITELY_NOT_A_STATUS' })
      .set(...bearer(alice));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an undocumented query parameter', async () => {
    const response = await http()
      .get('/api/v1/orders')
      .query({ sort: 'total_desc' })
      .set(...bearer(alice));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('does not let a Mongo operator through a filter value', async () => {
    const response = await http()
      .get('/api/v1/orders?status[$ne]=CANCELLED')
      .set(...bearer(alice));

    // Whatever the parser makes of it, the enum guard refuses it. No client
    // string can become part of a query expression.
    expect(response.status).toBe(400);
    expect(await orders.countDocuments({ userId: alice.id }).exec()).toBe(aliceOrderIds.length);
  });
});

describe('summary shape', () => {
  it('is a compact card built entirely from the order snapshot', async () => {
    const response = await http()
      .get('/api/v1/orders')
      .query({ limit: 1 })
      .set(...bearer(alice))
      .expect(200);

    const row = response.body.data[0] as Record<string, unknown>;

    expect(Object.keys(row).sort()).toEqual([
      'id',
      'itemCount',
      'orderNumber',
      'payment',
      'placedAt',
      'previewImagePublicId',
      'pricing',
      'status',
      'totalQuantity',
    ]);

    expect(row.status).toBe('PLACED');
    expect(row.itemCount).toBe(1);
    expect(row.previewImagePublicId).toMatch(/^nest\/products\/ord-/);
    expect(row.placedAt).toMatch(/Z$/);

    // Canonical money everywhere, never a bare number.
    const pricing = row.pricing as Record<string, { amount: number; currency: string; formatted: string }>;
    for (const field of ['itemsSubtotal', 'discountTotal', 'shippingFee', 'grandTotal']) {
      const money = pricing[field] as { amount: number; currency: string; formatted: string };
      expect(Object.keys(money).sort()).toEqual(['amount', 'currency', 'formatted']);
      expect(Number.isSafeInteger(money.amount)).toBe(true);
      expect(money.currency).toBe('EGP');
    }
    expect(pricing.grandTotal?.amount).toBe(
      (pricing.itemsSubtotal?.amount ?? 0) -
        (pricing.discountTotal?.amount ?? 0) +
        (pricing.shippingFee?.amount ?? 0),
    );

    /*
     * The order-summary serialiser is a DIFFERENT class from the order-detail
     * one, and both are part of the frozen contract. A client reading the
     * history list must be able to tell an unpriced delivery from a free one
     * exactly as it can on the detail page, so the flag is asserted on this
     * shape too rather than assumed to travel with the money.
     */
    expect(typeof (row.pricing as Record<string, unknown>)['shippingPriced']).toBe('boolean');
  });

  it('leaks nothing internal', async () => {
    const response = await http()
      .get('/api/v1/orders')
      .query({ limit: 100 })
      .set(...bearer(alice))
      .expect(200);

    const body = JSON.stringify(response.body);
    for (const forbidden of [
      'idempotencyKey',
      'requestHash',
      'statusHistory',
      'adminNote',
      'userId',
      '__v',
      'E11000',
      'MongoServerError',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe('detail', () => {
  it('returns the full customer-facing order, from the snapshot', async () => {
    const id = aliceOrderIds[0] as string;

    const response = await http()
      .get(`/api/v1/orders/${id}`)
      .set(...bearer(alice))
      .expect(200);

    const order = response.body.data as Record<string, unknown>;

    expect(Object.keys(order).sort()).toEqual([
      'cancellation',
      'currency',
      'customer',
      'customerNote',
      'id',
      'items',
      'orderNumber',
      'payment',
      'placedAt',
      'pricing',
      'shipment',
      'shippingAddress',
      'status',
    ]);

    expect(order.id).toBe(id);
    expect(order.status).toBe('PLACED');
    // Present as a KEY on every order, null on one that was not cancelled —
    // required-and-nullable, so a generated Dart model never has to tell
    // "absent" apart from "null".
    expect(order.cancellation).toBeNull();
    // Same rule: present as a key on every order, null until it ships.
    expect(order.shipment).toBeNull();
    expect(order.payment).toEqual({ method: 'COD', status: 'PENDING', collectedAt: null });
    expect(order.shippingAddress).toEqual({ ...ADDRESS, postalCode: null });

    const items = order.items as Record<string, unknown>[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual([
        'brandName',
        'imagePublicId',
        'lineTotal',
        'name',
        'productId',
        'quantity',
        'sku',
        'slug',
        'unitPrice',
      ]);
      const unitPrice = item.unitPrice as { amount: number };
      const lineTotal = item.lineTotal as { amount: number };
      expect(lineTotal.amount).toBe(unitPrice.amount * (item.quantity as number));
    }
  });

  it('returns the identical shape POST /orders returned', async () => {
    const placed = await http()
      .post('/api/v1/cart/items')
      .set(...bearer(bob))
      .send({ productId: stock.toHexString(), quantity: 1 })
      .expect(200);
    expect(placed.status).toBe(200);

    const created = await http()
      .post('/api/v1/orders')
      .set(...bearer(bob))
      .set('Idempotency-Key', randomUUID())
      .send({ addressId: bob.addressId })
      .expect(201);

    createdOrderIds.push(new Types.ObjectId(created.body.data.id as string));

    const fetched = await http()
      .get(`/api/v1/orders/${created.body.data.id as string}`)
      .set(...bearer(bob))
      .expect(200);

    // ONE Dart model serves the order-success screen and the order-detail screen.
    expect(fetched.body.data).toEqual(created.body.data);
  });
});

describe('snapshot durability', () => {
  it('is unaffected by renaming, repricing and delisting the product', async () => {
    const id = aliceOrderIds[0] as string;

    const before = await http()
      .get(`/api/v1/orders/${id}`)
      .set(...bearer(alice))
      .expect(200);

    const beforeList = await http()
      .get('/api/v1/orders')
      .query({ limit: 100 })
      .set(...bearer(alice))
      .expect(200);

    await products
      .updateOne(
        { _id: stock },
        {
          $set: {
            'name.en': 'RENAMED LONG AFTER THE ORDER',
            slug: `ord-test-stock-renamed-${RUN_ID}`,
            'pricing.basePrice': 1,
            'pricing.effectivePrice': 1,
            isActive: false,
            deletedAt: new Date(),
            images: [],
          },
        },
      )
      .exec();

    const after = await http()
      .get(`/api/v1/orders/${id}`)
      .set(...bearer(alice))
      .expect(200);

    const afterList = await http()
      .get('/api/v1/orders')
      .query({ limit: 100 })
      .set(...bearer(alice))
      .expect(200);

    // Not "close enough" — byte-identical. The order does not read the product.
    expect(after.body.data).toEqual(before.body.data);
    expect(afterList.body.data).toEqual(beforeList.body.data);

    const item = (after.body.data.items as { name: string; unitPrice: { amount: number }; slug: string }[])[0];
    expect(item?.name).toBe(`Orders Test stock`);
    expect(item?.unitPrice.amount).toBe(32500);
    expect(item?.slug).toBe(`ord-test-stock-${RUN_ID}`);
  });

  it('still renders an order whose product has been HARD-DELETED', async () => {
    await products.deleteOne({ _id: doomed }).exec();
    expect(await products.countDocuments({ _id: doomed }).exec()).toBe(0);

    const detail = await http()
      .get(`/api/v1/orders/${doomedOrderId}`)
      .set(...bearer(alice))
      .expect(200);

    const item = (detail.body.data.items as { name: string; sku: string; unitPrice: { amount: number } }[])[0];
    expect(item?.name).toBe('Orders Test doomed');
    expect(item?.sku).toBe(`ORD-TEST-DOOMED-${RUN_ID}`.toUpperCase());
    expect(item?.unitPrice.amount).toBe(18000);

    // And the history card for it still renders too.
    const list = await http()
      .get('/api/v1/orders')
      .query({ limit: 100 })
      .set(...bearer(alice))
      .expect(200);

    const row = (list.body.data as { id: string; itemCount: number }[]).find(
      (entry) => entry.id === doomedOrderId,
    );
    expect(row?.itemCount).toBe(1);
  });
});

describe('index usage', () => {
  /** The EXACT shape `OrderRepository.findPageForUser` issues. */
  function historyPlan(filter: Record<string, unknown>): Promise<unknown> {
    return orders.collection
      .find(filter)
      .sort({ placedAt: -1, _id: -1 })
      .skip(0)
      .limit(24)
      .explain('executionStats');
  }

  it('serves the unfiltered order history from order_user_history, with no sort stage', async () => {
    const plan = (await historyPlan({ userId: alice.id })) as {
      queryPlanner: { winningPlan: unknown };
      executionStats: { totalDocsExamined: number; nReturned: number };
    };

    const winning = JSON.stringify(plan.queryPlanner.winningPlan);
    console.log(`  winningPlan  ${winning}`);

    expect(winning).toContain('IXSCAN');
    expect(winning).toContain('order_user_history');
    // A COLLSCAN or an in-memory SORT here is a REGRESSION, not a slow path:
    // both mean the index no longer matches the query the repository issues.
    expect(winning).not.toContain('COLLSCAN');
    expect(winning).not.toContain('"stage":"SORT"');
    expect(winning).not.toContain('"sortPattern"');

    // The index walks straight to this customer's orders; it does not read the
    // whole collection and discard other people's.
    expect(plan.executionStats.totalDocsExamined).toBeLessThanOrEqual(
      Math.max(plan.executionStats.nReturned, 1) * 2,
    );
  });

  it('serves the status-filtered history from the same index', async () => {
    const plan = (await historyPlan({ userId: alice.id, status: { $in: ['PLACED'] } })) as {
      queryPlanner: { winningPlan: unknown };
    };

    const winning = JSON.stringify(plan.queryPlanner.winningPlan);

    expect(winning).toContain('IXSCAN');
    expect(winning).toContain('order_user_history');
    expect(winning).not.toContain('COLLSCAN');
    expect(winning).not.toContain('"stage":"SORT"');
  });

  it('serves the count filter from an index too', async () => {
    // `countDocuments` has no explain of its own; it runs the same filter, so
    // explaining that filter is what proves the count is not a collection scan.
    const explained = (await orders.collection
      .find({ userId: alice.id })
      .explain('queryPlanner')) as { queryPlanner: { winningPlan: unknown } };

    const winning = JSON.stringify(explained.queryPlanner.winningPlan);

    expect(winning).toContain('IXSCAN');
    expect(winning).not.toContain('COLLSCAN');
  });
});
