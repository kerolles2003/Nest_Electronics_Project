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
import {
  InventoryEvent,
  InventoryEventType,
  InventoryReferenceType,
} from '../../src/modules/inventory/infrastructure/schemas/inventory-event.schema';
import { OrderStatus } from '../../src/modules/orders/domain/order-status';
import {
  checkTransition,
  CUSTOMER_CANCELLABLE_FROM,
  isLegalTransition,
  isTerminal,
  ORDER_TRANSITIONS,
  RESTORES_STOCK,
} from '../../src/modules/orders/domain/order-transitions';
import { IdempotencyKeyRecord } from '../../src/modules/orders/infrastructure/schemas/idempotency-key.schema';
import { Order } from '../../src/modules/orders/infrastructure/schemas/order.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * The order LIFECYCLE and customer cancellation, end to end, against the real
 * application and the real Atlas development database.
 *
 * Orders are placed through the REAL `POST /orders`, so the stock that gets
 * restored is stock the real placement path actually took.
 *
 * Statuses beyond `PLACED` are set directly on the document, because no admin
 * API exists yet to reach them. That is scaffolding for the FIXTURE only —
 * every assertion still goes through the HTTP endpoint and the real service.
 *
 * ISOLATION. Own products, own users, own orders; everything removed by tracked
 * id in `afterAll`. No `dropDatabase`, no `deleteMany({})`, and the seeded
 * catalogue count is asserted unchanged at the end.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const REASON = 'Ordered the wrong variant.';

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
  readonly fullName: string;
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
  const email = `lifecycle-${label}.${RUN_ID}@example.test`;
  const fullName = `Lifecycle ${label}`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName })
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
    fullName,
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
    sku: `LIFE-TEST-${label.toUpperCase()}-${RUN_ID}`,
    slug: `life-test-${label}-${RUN_ID}`,
    name: { en: `Lifecycle Test ${label}`, ar: null },
    shortDescription: { en: 'Created by the order-lifecycle test suite.', ar: null },
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
        publicId: `nest/products/life-${label}-${RUN_ID}`,
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

/** Places one REAL order: add to cart, then `POST /orders`. */
async function placeOrder(
  customer: Customer,
  lines: readonly { product: Types.ObjectId; quantity: number }[],
): Promise<string> {
  for (const line of lines) {
    await http()
      .post('/api/v1/cart/items')
      .set(...bearer(customer))
      .send({ productId: line.product.toHexString(), quantity: line.quantity })
      .expect(200);
  }

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

/** One order for `stockProduct`, at `quantity`. The common fixture. */
async function placeSimpleOrder(customer: Customer, quantity = 1): Promise<string> {
  return placeOrder(customer, [{ product: stockProduct, quantity }]);
}

function cancel(customer: Customer, orderId: string, reason: string = REASON) {
  return http()
    .post(`/api/v1/orders/${orderId}/cancel`)
    .set(...bearer(customer))
    .send({ reason });
}

/**
 * Forces an order into a status the API cannot yet produce.
 *
 * FIXTURE ONLY. It writes the document directly because the admin transitions
 * that would reach these states are a later phase; every assertion in this file
 * still exercises the real endpoint against the real service.
 */
async function forceStatus(orderId: string, status: OrderStatus): Promise<void> {
  await orders.updateOne({ _id: new Types.ObjectId(orderId) }, { $set: { status } }).exec();
}

async function onHandOf(productId: Types.ObjectId): Promise<number> {
  const product = await products
    .findById(productId)
    .lean<{ stock: { onHand: number } }>()
    .exec();

  return product?.stock.onHand ?? -1;
}

async function salesCountOf(productId: Types.ObjectId): Promise<number> {
  const product = await products.findById(productId).lean<{ salesCount: number }>().exec();

  return product?.salesCount ?? -1;
}

async function loadOrder(orderId: string) {
  return orders.findById(new Types.ObjectId(orderId)).lean().exec();
}

async function eventsFor(orderId: string, type: InventoryEventType) {
  return inventoryEvents
    .find({ 'reference.id': new Types.ObjectId(orderId), type })
    .lean()
    .exec();
}

let alice: Customer;
let bob: Customer;
let admin: Customer;
let stockProduct: Types.ObjectId;
let secondProduct: Types.ObjectId;
let seededProductCount = 0;
/** Planted by the atomicity test; removed in `afterAll` even if it fails. */
const plantedEventIds: Types.ObjectId[] = [];

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

  seededProductCount = await products.countDocuments({ sku: { $not: /^LIFE-TEST-/ } }).exec();

  stockProduct = await createProduct('stock', 500, 32500);
  secondProduct = await createProduct('second', 500, 18000);

  alice = await createCustomer('alice');
  bob = await createCustomer('bob');
  admin = await createCustomer('admin', Role.ADMIN);
}, 300_000);

afterAll(async () => {
  if (plantedEventIds.length > 0) {
    await inventoryEvents.deleteMany({ _id: { $in: plantedEventIds } }).exec();
  }
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

  expect(await products.countDocuments({ sku: { $not: /^LIFE-TEST-/ } }).exec()).toBe(
    seededProductCount,
  );

  const connection = app.get<Connection>(getConnectionToken());
  await app.close();
  await connection.close();
}, 300_000);

// ---------------------------------------------------------------------------

describe('transition policy', () => {
  it('declares an outgoing edge set for every status, with no self-edges', () => {
    for (const status of Object.values(OrderStatus)) {
      expect(ORDER_TRANSITIONS[status]).toBeDefined();
      expect(ORDER_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it('treats CANCELLED and RETURNED as terminal and nothing else', () => {
    const terminal = Object.values(OrderStatus).filter((status) => isTerminal(status));

    expect(terminal.sort()).toEqual([OrderStatus.CANCELLED, OrderStatus.RETURNED].sort());
  });

  it('refuses the transitions the frozen matrix forbids (T10, T11, T13)', () => {
    // Goods are with the courier; the path is DELIVERY_FAILED -> RETURNED.
    expect(isLegalTransition(OrderStatus.SHIPPED, OrderStatus.CANCELLED)).toBe(false);
    // A delivered order that comes back is RETURNED, not CANCELLED.
    expect(isLegalTransition(OrderStatus.DELIVERED, OrderStatus.CANCELLED)).toBe(false);
    // Terminal. No resurrection.
    expect(isLegalTransition(OrderStatus.CANCELLED, OrderStatus.PLACED)).toBe(false);
    expect(isLegalTransition(OrderStatus.RETURNED, OrderStatus.SHIPPED)).toBe(false);
    // Backwards moves — the exact class legacy permitted.
    expect(isLegalTransition(OrderStatus.DELIVERED, OrderStatus.PLACED)).toBe(false);
  });

  it('lets a customer drive only the two pre-dispatch cancellations', () => {
    expect([...CUSTOMER_CANCELLABLE_FROM].sort()).toEqual(
      [OrderStatus.PLACED, OrderStatus.CONFIRMED].sort(),
    );

    // Legal in the matrix, but admin-only: a customer cannot confirm or ship.
    expect(checkTransition(OrderStatus.PLACED, OrderStatus.CONFIRMED, Role.CUSTOMER)).toBe(
      'FORBIDDEN_ACTOR',
    );
    expect(checkTransition(OrderStatus.CONFIRMED, OrderStatus.SHIPPED, Role.CUSTOMER)).toBe(
      'FORBIDDEN_ACTOR',
    );
    expect(checkTransition(OrderStatus.PLACED, OrderStatus.CONFIRMED, Role.ADMIN)).toBeNull();
  });

  it('restores stock on exactly the two statuses the inventory model names', () => {
    expect([...RESTORES_STOCK].sort()).toEqual(
      [OrderStatus.CANCELLED, OrderStatus.RETURNED].sort(),
    );
  });
});

describe('authorization', () => {
  it('refuses an unauthenticated cancellation', async () => {
    const orderId = await placeSimpleOrder(alice);
    const response = await http()
      .post(`/api/v1/orders/${orderId}/cancel`)
      .send({ reason: REASON });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect((await loadOrder(orderId))?.status).toBe(OrderStatus.PLACED);
  });

  it('refuses a non-CUSTOMER principal', async () => {
    const orderId = await placeSimpleOrder(alice);
    const response = await cancel(admin, orderId);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect((await loadOrder(orderId))?.status).toBe(OrderStatus.PLACED);
  });

  it('makes a foreign order INDISTINGUISHABLE from one that does not exist', async () => {
    const aliceOrder = await placeSimpleOrder(alice);
    const missing = new Types.ObjectId().toHexString();

    const foreign = await cancel(bob, aliceOrder);
    const nonexistent = await cancel(bob, missing);

    expect(foreign.status).toBe(404);
    expect(nonexistent.status).toBe(404);

    // Byte-identical once the per-request fields are removed. Anything that
    // differed here would be an ownership oracle.
    const strip = (body: Record<string, unknown>): unknown =>
      Object.fromEntries(
        Object.entries(body.error as Record<string, unknown>).filter(
          ([key]) => key !== 'requestId' && key !== 'timestamp',
        ),
      );

    expect(strip(foreign.body)).toEqual(strip(nonexistent.body));
    expect(JSON.stringify(foreign.body)).not.toContain(aliceOrder);
    expect(JSON.stringify(foreign.body)).not.toContain(alice.id.toHexString());

    // And the foreign attempt changed nothing.
    expect((await loadOrder(aliceOrder))?.status).toBe(OrderStatus.PLACED);
  });

  it('rejects a malformed order id as 400, not 404', async () => {
    const response = await cancel(alice, 'not-an-object-id');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('request validation', () => {
  it('requires a reason', async () => {
    const orderId = await placeSimpleOrder(alice);
    const response = await http()
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set(...bearer(alice))
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect((await loadOrder(orderId))?.status).toBe(OrderStatus.PLACED);
  });

  it('rejects a reason that is too short or too long', async () => {
    const orderId = await placeSimpleOrder(alice);

    expect((await cancel(alice, orderId, 'no')).status).toBe(400);
    expect((await cancel(alice, orderId, 'x'.repeat(501))).status).toBe(400);
    expect((await loadOrder(orderId))?.status).toBe(OrderStatus.PLACED);
  });

  it('rejects an attempt to set a status through the body', async () => {
    const orderId = await placeSimpleOrder(alice);
    const response = await http()
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set(...bearer(alice))
      .send({ reason: REASON, status: OrderStatus.DELIVERED });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    expect((await loadOrder(orderId))?.status).toBe(OrderStatus.PLACED);
  });
});

describe('cancellation from every legal state', () => {
  it('cancels a PLACED order and returns the canonical Order DTO', async () => {
    const orderId = await placeSimpleOrder(alice, 2);
    const before = await http()
      .get(`/api/v1/orders/${orderId}`)
      .set(...bearer(alice))
      .expect(200);

    const response = await cancel(alice, orderId).expect(200);

    expect(response.body.data.id).toBe(orderId);
    expect(response.body.data.status).toBe(OrderStatus.CANCELLED);
    expect(response.body.data.cancellation).toEqual({
      reason: REASON,
      by: Role.CUSTOMER,
      at: expect.any(String) as unknown as string,
    });

    // Same model as POST /orders and GET /orders/:id — only the two fields the
    // transition is allowed to change actually changed.
    expect(Object.keys(response.body.data).sort()).toEqual(Object.keys(before.body.data).sort());
    expect({ ...response.body.data, status: null, cancellation: null }).toEqual({
      ...before.body.data,
      status: null,
      cancellation: null,
    });
  });

  it('cancels a CONFIRMED order', async () => {
    const orderId = await placeSimpleOrder(alice);
    await forceStatus(orderId, OrderStatus.CONFIRMED);

    const response = await cancel(alice, orderId).expect(200);

    expect(response.body.data.status).toBe(OrderStatus.CANCELLED);

    const stored = await loadOrder(orderId);
    expect(stored?.status).toBe(OrderStatus.CANCELLED);
    // The history entry records where it actually came from.
    expect(stored?.statusHistory.at(-1)?.from).toBe(OrderStatus.CONFIRMED);
  });

  it('stores the reason verbatim, trimmed', async () => {
    const orderId = await placeSimpleOrder(alice);
    await cancel(alice, orderId, '   Changed my mind about the colour.   ').expect(200);

    expect((await loadOrder(orderId))?.cancellation?.reason).toBe(
      'Changed my mind about the colour.',
    );
  });
});

describe('cancellation from every illegal state', () => {
  it.each([
    [OrderStatus.SHIPPED],
    [OrderStatus.DELIVERED],
    [OrderStatus.DELIVERY_FAILED],
    [OrderStatus.RETURNED],
    [OrderStatus.CANCELLED],
  ])('refuses to cancel a %s order and moves no stock', async (status) => {
    const orderId = await placeSimpleOrder(alice, 3);
    const stockAfterPlacement = await onHandOf(stockProduct);
    await forceStatus(orderId, status);

    const response = await cancel(alice, orderId);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ORDER_NOT_CANCELLABLE');
    // `details` names the current status so the client can re-render.
    expect(response.body.error.details[0].message).toContain(status);

    const stored = await loadOrder(orderId);
    expect(stored?.status).toBe(status);
    expect(stored?.cancellation).toBeNull();
    expect(await onHandOf(stockProduct)).toBe(stockAfterPlacement);
    expect(await eventsFor(orderId, InventoryEventType.CANCELLATION)).toHaveLength(0);
  });

  it('refuses a SECOND cancellation and does not restore stock twice', async () => {
    const orderId = await placeSimpleOrder(alice, 4);
    const beforeCancel = await onHandOf(stockProduct);

    await cancel(alice, orderId).expect(200);
    const afterFirst = await onHandOf(stockProduct);
    expect(afterFirst).toBe(beforeCancel + 4);

    const second = await cancel(alice, orderId, 'Trying again.');

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ORDER_NOT_CANCELLABLE');
    expect(second.body.error.details[0].message).toContain(OrderStatus.CANCELLED);

    // Stock did not move a second time, and the original reason survived.
    expect(await onHandOf(stockProduct)).toBe(afterFirst);
    expect(await eventsFor(orderId, InventoryEventType.CANCELLATION)).toHaveLength(1);

    const stored = await loadOrder(orderId);
    expect(stored?.cancellation?.reason).toBe(REASON);
    expect(stored?.statusHistory.filter((entry) => entry.to === OrderStatus.CANCELLED)).toHaveLength(1);
  });
});

describe('status history', () => {
  it('appends exactly one immutable entry, with the actor from the token', async () => {
    const orderId = await placeSimpleOrder(alice);
    const placedAtHistory = (await loadOrder(orderId))?.statusHistory ?? [];
    expect(placedAtHistory).toHaveLength(1);

    const before = Date.now();
    await cancel(alice, orderId).expect(200);
    const after = Date.now();

    const history = (await loadOrder(orderId))?.statusHistory ?? [];
    expect(history).toHaveLength(2);

    // The placement entry is untouched.
    expect(history[0]).toEqual(placedAtHistory[0]);

    const entry = history[1];
    expect(entry?.from).toBe(OrderStatus.PLACED);
    expect(entry?.to).toBe(OrderStatus.CANCELLED);
    expect(entry?.note).toBeNull();
    expect(entry?.actor.id?.toHexString()).toBe(alice.id.toHexString());
    expect(entry?.actor.role).toBe(Role.CUSTOMER);
    expect(entry?.actor.name).toBe(alice.fullName);
    expect(entry?.at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(entry?.at.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  it('never exposes statusHistory, adminNote or idempotencyKey to the customer', async () => {
    const orderId = await placeSimpleOrder(alice);
    const response = await cancel(alice, orderId).expect(200);
    const detail = await http()
      .get(`/api/v1/orders/${orderId}`)
      .set(...bearer(alice))
      .expect(200);

    for (const body of [response.body, detail.body]) {
      expect(body.data.statusHistory).toBeUndefined();
      expect(body.data.adminNote).toBeUndefined();
      expect(body.data.idempotencyKey).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('statusHistory');
    }
  });
});

describe('inventory restoration', () => {
  it('restores the EXACT ordered quantity and reverses salesCount', async () => {
    const before = await onHandOf(stockProduct);
    const salesBefore = await salesCountOf(stockProduct);

    const orderId = await placeSimpleOrder(alice, 7);

    expect(await onHandOf(stockProduct)).toBe(before - 7);
    expect(await salesCountOf(stockProduct)).toBe(salesBefore + 7);

    await cancel(alice, orderId).expect(200);

    expect(await onHandOf(stockProduct)).toBe(before);
    expect(await salesCountOf(stockProduct)).toBe(salesBefore);
  });

  it('writes one self-verifying CANCELLATION ledger entry per line', async () => {
    const orderId = await placeSimpleOrder(alice, 5);
    const onHandBeforeCancel = await onHandOf(stockProduct);

    await cancel(alice, orderId).expect(200);

    const events = await eventsFor(orderId, InventoryEventType.CANCELLATION);
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event?.productId.toHexString()).toBe(stockProduct.toHexString());
    // POSITIVE — the mirror of the negative SALE entry.
    expect(event?.quantityDelta).toBe(5);
    expect(event?.balanceBefore).toBe(onHandBeforeCancel);
    expect(event?.balanceAfter).toBe(onHandBeforeCancel + 5);
    expect(event?.sku).toBe(`LIFE-TEST-STOCK-${RUN_ID}`.toUpperCase());
    expect(event?.reference?.type).toBe(InventoryReferenceType.ORDER);
    expect(event?.reference?.id.toHexString()).toBe(orderId);
    expect(event?.actor?.id.toHexString()).toBe(alice.id.toHexString());
    expect(event?.actor?.role).toBe(Role.CUSTOMER);

    // The SALE and the CANCELLATION net to zero — the ledger invariant.
    const sale = (await eventsFor(orderId, InventoryEventType.SALE))[0];
    expect((sale?.quantityDelta ?? 0) + (event?.quantityDelta ?? 0)).toBe(0);
  });

  it('restores every line of a multi-product order', async () => {
    const stockBefore = await onHandOf(stockProduct);
    const secondBefore = await onHandOf(secondProduct);

    const orderId = await placeOrder(alice, [
      { product: stockProduct, quantity: 3 },
      { product: secondProduct, quantity: 6 },
    ]);

    expect(await onHandOf(stockProduct)).toBe(stockBefore - 3);
    expect(await onHandOf(secondProduct)).toBe(secondBefore - 6);

    await cancel(alice, orderId).expect(200);

    expect(await onHandOf(stockProduct)).toBe(stockBefore);
    expect(await onHandOf(secondProduct)).toBe(secondBefore);

    const events = await eventsFor(orderId, InventoryEventType.CANCELLATION);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.quantityDelta).sort((a, b) => a - b)).toEqual([3, 6]);
  });

  it('restores stock for a product that was DELISTED after the order was placed', async () => {
    const before = await onHandOf(stockProduct);
    const orderId = await placeSimpleOrder(alice, 2);

    // Delisting must not become a way to silently destroy returned stock.
    await products.updateOne({ _id: stockProduct }, { $set: { isActive: false } }).exec();

    await cancel(alice, orderId).expect(200);

    expect(await onHandOf(stockProduct)).toBe(before);
    expect(await eventsFor(orderId, InventoryEventType.CANCELLATION)).toHaveLength(1);

    await products.updateOne({ _id: stockProduct }, { $set: { isActive: true } }).exec();
  });

  it('still cancels when a line product was HARD-deleted, restoring the rest', async () => {
    const doomed = await createProduct('doomed', 40, 9000);
    const stockBefore = await onHandOf(stockProduct);

    const orderId = await placeOrder(alice, [
      { product: stockProduct, quantity: 2 },
      { product: doomed, quantity: 3 },
    ]);

    await products.deleteOne({ _id: doomed }).exec();

    // The customer must not be trapped in an order they cannot cancel because
    // somebody deleted a catalogue row.
    await cancel(alice, orderId).expect(200);

    expect((await loadOrder(orderId))?.status).toBe(OrderStatus.CANCELLED);
    expect(await onHandOf(stockProduct)).toBe(stockBefore);

    // One entry for the line that still has somewhere to go, none for the one
    // with no document to write a verifiable balance against.
    const events = await eventsFor(orderId, InventoryEventType.CANCELLATION);
    expect(events).toHaveLength(1);
    expect(events[0]?.productId.toHexString()).toBe(stockProduct.toHexString());
  });
});

describe('concurrency', () => {
  it('lets exactly ONE of six simultaneous cancellations take effect', async () => {
    const orderId = await placeSimpleOrder(alice, 9);
    const beforeCancel = await onHandOf(stockProduct);
    const salesBefore = await salesCountOf(stockProduct);

    // Six real HTTP requests, in flight at once, against one order.
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => cancel(alice, orderId)),
    );

    const succeeded = responses.filter((response) => response.status === 200);
    const refused = responses.filter((response) => response.status !== 200);

    expect(succeeded).toHaveLength(1);
    expect(succeeded[0]?.body.data.status).toBe(OrderStatus.CANCELLED);

    // Every loser is a deterministic 409, never a 500 and never a silent 200.
    for (const response of refused) {
      expect(response.status).toBe(409);
      expect(['ORDER_NOT_CANCELLABLE', 'CONCURRENT_MODIFICATION']).toContain(
        response.body.error.code,
      );
    }

    // ONE restoration. Not six, not two.
    expect(await onHandOf(stockProduct)).toBe(beforeCancel + 9);
    expect(await salesCountOf(stockProduct)).toBe(salesBefore - 9);

    // ONE ledger entry, ONE history entry, ONE cancellation record.
    expect(await eventsFor(orderId, InventoryEventType.CANCELLATION)).toHaveLength(1);

    const stored = await loadOrder(orderId);
    expect(stored?.status).toBe(OrderStatus.CANCELLED);
    expect(stored?.statusHistory).toHaveLength(2);
    expect(
      stored?.statusHistory.filter((entry) => entry.to === OrderStatus.CANCELLED),
    ).toHaveLength(1);
  }, 120_000);

  it('keeps concurrent cancellations of DIFFERENT orders independent', async () => {
    const before = await onHandOf(stockProduct);
    const first = await placeSimpleOrder(alice, 2);
    const second = await placeSimpleOrder(bob, 3);

    const [one, two] = await Promise.all([cancel(alice, first), cancel(bob, second)]);

    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    // Both restorations happened; neither blocked the other.
    expect(await onHandOf(stockProduct)).toBe(before);
    expect(await eventsFor(first, InventoryEventType.CANCELLATION)).toHaveLength(1);
    expect(await eventsFor(second, InventoryEventType.CANCELLATION)).toHaveLength(1);
  }, 120_000);
});

describe('transaction atomicity', () => {
  it('leaves NO partial business state when the ledger write fails', async () => {
    const orderId = await placeSimpleOrder(alice, 6);
    const stockAfterPlacement = await onHandOf(stockProduct);
    const salesAfterPlacement = await salesCountOf(stockProduct);

    // Induce a failure INSIDE the transaction, after the status update and the
    // stock increment have already been applied: plant the exact ledger entry
    // the cancellation is about to write, so its insert violates the unique
    // index on {reference.id, productId, type}.
    const planted = await inventoryEvents.create({
      productId: stockProduct,
      sku: `LIFE-TEST-STOCK-${RUN_ID}`.toUpperCase(),
      type: InventoryEventType.CANCELLATION,
      quantityDelta: 1,
      balanceBefore: 0,
      balanceAfter: 1,
      reason: 'planted by the atomicity test',
      reference: { type: InventoryReferenceType.ORDER, id: new Types.ObjectId(orderId) },
      actor: null,
    });
    plantedEventIds.push(planted._id);

    const response = await cancel(alice, orderId);

    // The request failed — the important part is what did NOT survive it.
    expect(response.status).toBeGreaterThanOrEqual(500);

    const stored = await loadOrder(orderId);
    // The status update rolled back...
    expect(stored?.status).toBe(OrderStatus.PLACED);
    // ...so did the cancellation record and the history append...
    expect(stored?.cancellation).toBeNull();
    expect(stored?.statusHistory).toHaveLength(1);
    // ...and so did the stock increment that had already been applied.
    expect(await onHandOf(stockProduct)).toBe(stockAfterPlacement);
    expect(await salesCountOf(stockProduct)).toBe(salesAfterPlacement);
    // Only the planted entry exists; nothing was half-written.
    const events = await eventsFor(orderId, InventoryEventType.CANCELLATION);
    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toBe('planted by the atomicity test');

    // Remove the plant and prove the order is still genuinely cancellable —
    // the failure left no poison behind.
    await inventoryEvents.deleteOne({ _id: planted._id }).exec();
    await cancel(alice, orderId).expect(200);
    expect(await onHandOf(stockProduct)).toBe(stockAfterPlacement + 6);
  }, 120_000);
});

describe('order read compatibility', () => {
  it('shows the cancellation on GET /orders/:id, identically to the cancel response', async () => {
    const orderId = await placeSimpleOrder(alice, 2);
    const cancelled = await cancel(alice, orderId).expect(200);

    const detail = await http()
      .get(`/api/v1/orders/${orderId}`)
      .set(...bearer(alice))
      .expect(200);

    // One model, one screen. The cancel response needs no follow-up fetch.
    expect(detail.body.data).toEqual(cancelled.body.data);
    expect(detail.body.data.status).toBe(OrderStatus.CANCELLED);
    expect(detail.body.data.cancellation.by).toBe(Role.CUSTOMER);
  });

  it('filters the cancelled order in and out of the history by status', async () => {
    const orderId = await placeSimpleOrder(alice, 1);
    await cancel(alice, orderId).expect(200);

    const cancelledPage = await http()
      .get('/api/v1/orders?status=CANCELLED&limit=100')
      .set(...bearer(alice))
      .expect(200);
    const placedPage = await http()
      .get('/api/v1/orders?status=PLACED&limit=100')
      .set(...bearer(alice))
      .expect(200);

    const cancelledIds = cancelledPage.body.data.map((row: { id: string }) => row.id);
    const placedIds = placedPage.body.data.map((row: { id: string }) => row.id);

    expect(cancelledIds).toContain(orderId);
    expect(placedIds).not.toContain(orderId);

    for (const row of cancelledPage.body.data) {
      expect(row.status).toBe(OrderStatus.CANCELLED);
    }
  });

  it('does NOT expand the history list payload', async () => {
    const orderId = await placeSimpleOrder(alice, 1);
    await cancel(alice, orderId).expect(200);

    const page = await http()
      .get('/api/v1/orders?status=CANCELLED&limit=1')
      .set(...bearer(alice))
      .expect(200);

    // The summary card is unchanged by this phase: still exactly nine fields,
    // with no cancellation block and no status history.
    expect(Object.keys(page.body.data[0]).sort()).toEqual([
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
  });

  it('keeps the order snapshot byte-identical through cancellation', async () => {
    const orderId = await placeSimpleOrder(alice, 3);
    const before = await http()
      .get(`/api/v1/orders/${orderId}`)
      .set(...bearer(alice))
      .expect(200);

    await cancel(alice, orderId).expect(200);

    const after = await http()
      .get(`/api/v1/orders/${orderId}`)
      .set(...bearer(alice))
      .expect(200);

    // Cancelling changes the STATUS of an order, never what was sold or what it
    // cost. Every immutable field is unchanged.
    expect(after.body.data.items).toEqual(before.body.data.items);
    expect(after.body.data.pricing).toEqual(before.body.data.pricing);
    expect(after.body.data.customer).toEqual(before.body.data.customer);
    expect(after.body.data.shippingAddress).toEqual(before.body.data.shippingAddress);
    expect(after.body.data.orderNumber).toBe(before.body.data.orderNumber);
    expect(after.body.data.placedAt).toBe(before.body.data.placedAt);
    expect(after.body.data.payment).toEqual(before.body.data.payment);
  });

  it('reads a cancelled order without touching the catalogue', async () => {
    const orderId = await placeSimpleOrder(alice, 2);
    await cancel(alice, orderId).expect(200);

    const before = await http()
      .get(`/api/v1/orders/${orderId}`)
      .set(...bearer(alice))
      .expect(200);

    await products
      .updateOne(
        { _id: stockProduct },
        { $set: { 'name.en': 'Renamed After Cancellation', 'pricing.effectivePrice': 1 } },
      )
      .exec();

    const after = await http()
      .get(`/api/v1/orders/${orderId}`)
      .set(...bearer(alice))
      .expect(200);

    expect(after.body.data).toEqual(before.body.data);

    await products
      .updateOne(
        { _id: stockProduct },
        { $set: { 'name.en': `Lifecycle Test stock`, 'pricing.effectivePrice': 32500 } },
      )
      .exec();
  });
});
