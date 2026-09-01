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
import { OrderStatus, PaymentStatus } from '../../src/modules/orders/domain/order-status';
import { IdempotencyKeyRecord } from '../../src/modules/orders/infrastructure/schemas/idempotency-key.schema';
import { Order } from '../../src/modules/orders/infrastructure/schemas/order.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * ADMIN order operations and the full operational lifecycle, end to end,
 * against the real application and the real development database.
 *
 * Every order is placed through the REAL `POST /orders` and every transition
 * goes through the REAL admin HTTP endpoints. No lifecycle state is hand-written
 * into the database: an order reaches `DELIVERED` here the same way it will in
 * production, by being confirmed, shipped and delivered.
 *
 * ISOLATION. Own products, own users, own orders; everything removed by tracked
 * id in `afterAll`. No `dropDatabase`, no `deleteMany({})`, and the seeded
 * catalogue count is asserted unchanged at the end.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const CARRIER = 'Bosta';
const TRACKING = 'BST-123456789';

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
const plantedEventIds: Types.ObjectId[] = [];

interface Account {
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

function bearer(account: Account): [string, string] {
  return ['Authorization', `Bearer ${account.token}`];
}

async function createAccount(label: string, role: Role = Role.CUSTOMER): Promise<Account> {
  const email = `adminops-${label}.${RUN_ID}@example.test`;
  const fullName = `AdminOps ${label}`;

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
    sku: `ADM-TEST-${label.toUpperCase()}-${RUN_ID}`,
    slug: `adm-test-${label}-${RUN_ID}`,
    name: { en: `Admin Test ${label}`, ar: null },
    shortDescription: { en: 'Created by the admin-orders test suite.', ar: null },
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
        publicId: `nest/products/adm-${label}-${RUN_ID}`,
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

/** Places one REAL order through the real checkout path. */
async function placeOrder(
  customer: Account,
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

async function placeSimpleOrder(quantity = 1, customer?: Account): Promise<string> {
  return placeOrder(customer ?? alice, [{ product: stockProduct, quantity }]);
}

/** One staff lifecycle action, through the real HTTP endpoint. */
function act(
  actor: Account,
  orderId: string,
  action: string,
  body: Record<string, unknown> = {},
) {
  return http()
    .post(`/api/v1/admin/orders/${orderId}/${action}`)
    .set(...bearer(actor))
    .send(body);
}

/** Drives an order forward through real endpoints only. */
async function confirm(orderId: string) {
  return act(admin, orderId, 'confirm').expect(200);
}

async function ship(orderId: string, carrier = CARRIER, trackingNumber = TRACKING) {
  return act(admin, orderId, 'ship', { carrier, trackingNumber }).expect(200);
}

async function deliver(orderId: string) {
  return act(admin, orderId, 'deliver').expect(200);
}

async function onHandOf(productId: Types.ObjectId): Promise<number> {
  const product = await products.findById(productId).lean<{ stock: { onHand: number } }>().exec();

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
  return inventoryEvents.find({ 'reference.id': new Types.ObjectId(orderId), type }).lean().exec();
}

let alice: Account;
let bob: Account;
let admin: Account;
let superAdmin: Account;
let stockProduct: Types.ObjectId;
let secondProduct: Types.ObjectId;
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

  seededProductCount = await products.countDocuments({ sku: { $not: /^ADM-TEST-/ } }).exec();

  stockProduct = await createProduct('stock', 800, 32500);
  secondProduct = await createProduct('second', 800, 18000);

  alice = await createAccount('alice');
  bob = await createAccount('bob');
  admin = await createAccount('admin', Role.ADMIN);
  superAdmin = await createAccount('super', Role.SUPER_ADMIN);
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

  expect(await products.countDocuments({ sku: { $not: /^ADM-TEST-/ } }).exec()).toBe(
    seededProductCount,
  );

  const connection = app.get<Connection>(getConnectionToken());
  await app.close();
  await connection.close();
}, 300_000);

const ACTIONS = ['confirm', 'ship', 'deliver', 'delivery-failed', 'retry-shipment', 'return'];

/**
 * A VALID body for each action.
 *
 * It matters that these validate. Body validation runs before the state
 * machine, so an unknown field is a `400` no matter what status the order is
 * in — sending a carrier to `confirm` would prove the DTO rejects it, not that
 * the transition was refused. To assert a lifecycle refusal, the request has to
 * be well-formed enough to reach the lifecycle.
 */
const ACTION_BODIES: Readonly<Record<string, Record<string, unknown>>> = {
  confirm: {},
  ship: { carrier: CARRIER, trackingNumber: TRACKING },
  deliver: {},
  'delivery-failed': { reason: 'Attempting an action on a terminal order.' },
  'retry-shipment': {},
  return: { reason: 'Attempting an action on a terminal order.' },
};

// ---------------------------------------------------------------------------

describe('authorization', () => {
  it.each(ACTIONS)('refuses an unauthenticated %s', async (action) => {
    const orderId = await placeSimpleOrder();
    const response = await http()
      .post(`/api/v1/admin/orders/${orderId}/${action}`)
      .send(ACTION_BODIES[action] ?? {});

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect((await loadOrder(orderId))?.status).toBe(OrderStatus.PLACED);
  });

  it.each(ACTIONS)('refuses a CUSTOMER attempting %s', async (action) => {
    const orderId = await placeSimpleOrder();
    const response = await act(alice, orderId, action, ACTION_BODIES[action] ?? {});

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    // The order did not move, and no history was appended.
    const stored = await loadOrder(orderId);
    expect(stored?.status).toBe(OrderStatus.PLACED);
    expect(stored?.statusHistory).toHaveLength(1);
  });

  it('refuses a CUSTOMER on the admin queue and the admin detail read', async () => {
    const orderId = await placeSimpleOrder();

    const list = await http().get('/api/v1/admin/orders').set(...bearer(alice));
    const detail = await http().get(`/api/v1/admin/orders/${orderId}`).set(...bearer(alice));

    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe('FORBIDDEN');
    expect(detail.status).toBe(403);
    expect(detail.body.error.code).toBe('FORBIDDEN');
  });

  it('allows SUPER_ADMIN exactly as it allows ADMIN', async () => {
    const orderId = await placeSimpleOrder();

    const response = await act(superAdmin, orderId, 'confirm').expect(200);

    expect(response.body.data.status).toBe(OrderStatus.CONFIRMED);
    expect((await loadOrder(orderId))?.statusHistory.at(-1)?.actor.role).toBe(Role.SUPER_ADMIN);
  });

  it('acts on ANY customer order — staff operations are never ownership-scoped', async () => {
    // Bob's order, driven by an admin who does not own it. If the customer
    // ownership filter leaked into the staff path, this would 404.
    const bobOrder = await placeSimpleOrder(1, bob);

    const response = await act(admin, bobOrder, 'confirm').expect(200);

    expect(response.body.data.status).toBe(OrderStatus.CONFIRMED);
    expect((await loadOrder(bobOrder))?.userId.toHexString()).toBe(bob.id.toHexString());
  });

  it('answers 404 for an order that does not exist', async () => {
    const response = await act(admin, new Types.ObjectId().toHexString(), 'confirm');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('rejects a malformed order id as 400', async () => {
    const response = await act(admin, 'not-an-object-id', 'confirm');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('the full operational lifecycle', () => {
  it('moves an order PLACED → CONFIRMED → SHIPPED → DELIVERED through real endpoints', async () => {
    const orderId = await placeSimpleOrder(2);
    const stockAfterPlacement = await onHandOf(stockProduct);

    const confirmed = await confirm(orderId);
    expect(confirmed.body.data.status).toBe(OrderStatus.CONFIRMED);
    expect(confirmed.body.data.shipment).toBeNull();

    const shipped = await ship(orderId);
    expect(shipped.body.data.status).toBe(OrderStatus.SHIPPED);
    expect(shipped.body.data.shipment).toEqual({
      carrier: CARRIER,
      trackingNumber: TRACKING,
      shippedAt: expect.any(String) as unknown as string,
      deliveredAt: null,
      deliveryAttempts: 0,
    });

    const delivered = await deliver(orderId);
    expect(delivered.body.data.status).toBe(OrderStatus.DELIVERED);

    // NONE of these transitions touched stock — it was committed at placement.
    expect(await onHandOf(stockProduct)).toBe(stockAfterPlacement);
    expect(await eventsFor(orderId, InventoryEventType.CANCELLATION)).toHaveLength(0);
    expect(await eventsFor(orderId, InventoryEventType.RETURN)).toHaveLength(0);
  });

  it('collects the cash atomically with delivery (DELIVERED implies PAID)', async () => {
    const orderId = await placeSimpleOrder();
    await confirm(orderId);
    await ship(orderId);

    const before = await loadOrder(orderId);
    expect(before?.payment.status).toBe(PaymentStatus.PENDING);
    expect(before?.payment.collectedAt).toBeNull();

    const delivered = await deliver(orderId);

    expect(delivered.body.data.payment.status).toBe(PaymentStatus.PAID);
    expect(delivered.body.data.payment.collectedAt).toEqual(expect.any(String));
    expect(delivered.body.data.shipment.deliveredAt).toEqual(expect.any(String));

    // "delivered but unpaid" is not representable — both landed in one write.
    const stored = await loadOrder(orderId);
    expect(stored?.status).toBe(OrderStatus.DELIVERED);
    expect(stored?.payment.status).toBe(PaymentStatus.PAID);
    expect(stored?.payment.collectedAt).not.toBeNull();
    expect(stored?.shipment?.deliveredAt).not.toBeNull();
  });

  it('appends exactly one history entry per transition, with the staff actor', async () => {
    const orderId = await placeSimpleOrder();
    await act(admin, orderId, 'confirm', { note: 'Confirmed by phone.' }).expect(200);
    await ship(orderId);
    await deliver(orderId);

    const history = (await loadOrder(orderId))?.statusHistory ?? [];

    expect(history).toHaveLength(4);
    expect(history.map((entry) => [entry.from, entry.to])).toEqual([
      [null, OrderStatus.PLACED],
      [OrderStatus.PLACED, OrderStatus.CONFIRMED],
      [OrderStatus.CONFIRMED, OrderStatus.SHIPPED],
      [OrderStatus.SHIPPED, OrderStatus.DELIVERED],
    ]);

    // The placement entry is the customer; every staff entry is the admin,
    // resolved from the token and never from a request body.
    expect(history[0]?.actor.role).toBe(Role.CUSTOMER);
    for (const entry of history.slice(1)) {
      expect(entry.actor.role).toBe(Role.ADMIN);
      expect(entry.actor.id?.toHexString()).toBe(admin.id.toHexString());
      expect(entry.actor.name).toBe(admin.fullName);
    }
    expect(history[1]?.note).toBe('Confirmed by phone.');
  });
});

describe('shipment', () => {
  it('refuses to dispatch without a carrier or a tracking number', async () => {
    const orderId = await placeSimpleOrder();
    await confirm(orderId);

    const noCarrier = await act(admin, orderId, 'ship', { trackingNumber: TRACKING });
    const noTracking = await act(admin, orderId, 'ship', { carrier: CARRIER });
    const neither = await act(admin, orderId, 'ship', {});

    for (const response of [noCarrier, noTracking, neither]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }

    // Still CONFIRMED, still no shipment — a tracking-less dispatch never happened.
    const stored = await loadOrder(orderId);
    expect(stored?.status).toBe(OrderStatus.CONFIRMED);
    expect(stored?.shipment).toBeNull();
  });

  it('rejects an unknown field in a lifecycle body', async () => {
    const orderId = await placeSimpleOrder();

    const response = await act(admin, orderId, 'confirm', {
      note: 'ok',
      status: OrderStatus.DELIVERED,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    expect((await loadOrder(orderId))?.status).toBe(OrderStatus.PLACED);
  });

  it('shows the customer their tracking on their own order', async () => {
    const orderId = await placeSimpleOrder();
    await confirm(orderId);
    await ship(orderId, 'Aramex', 'ARX-555');

    const customerView = await http()
      .get(`/api/v1/orders/${orderId}`)
      .set(...bearer(alice))
      .expect(200);

    expect(customerView.body.data.shipment.carrier).toBe('Aramex');
    expect(customerView.body.data.shipment.trackingNumber).toBe('ARX-555');
    expect(customerView.body.data.status).toBe(OrderStatus.SHIPPED);
  });
});

describe('delivery failure and re-dispatch', () => {
  it('counts attempts, re-dispatches with new tracking, and never resets the count', async () => {
    const orderId = await placeSimpleOrder();
    await confirm(orderId);
    await ship(orderId);

    const failed = await act(admin, orderId, 'delivery-failed', {
      reason: 'Customer unreachable on three call attempts.',
    }).expect(200);

    expect(failed.body.data.status).toBe(OrderStatus.DELIVERY_FAILED);
    expect(failed.body.data.shipment.deliveryAttempts).toBe(1);
    expect((await loadOrder(orderId))?.statusHistory.at(-1)?.note).toBe(
      'Customer unreachable on three call attempts.',
    );

    const retried = await act(admin, orderId, 'retry-shipment', {
      carrier: 'Mylerz',
      trackingNumber: 'MYL-777',
    }).expect(200);

    expect(retried.body.data.status).toBe(OrderStatus.SHIPPED);
    expect(retried.body.data.shipment.carrier).toBe('Mylerz');
    expect(retried.body.data.shipment.trackingNumber).toBe('MYL-777');
    expect(retried.body.data.shipment.deliveredAt).toBeNull();
    // NOT reset — it counts what the courier actually attempted.
    expect(retried.body.data.shipment.deliveryAttempts).toBe(1);

    const failedAgain = await act(admin, orderId, 'delivery-failed', {
      reason: 'Second attempt refused at the door.',
    }).expect(200);

    expect(failedAgain.body.data.shipment.deliveryAttempts).toBe(2);
  });

  it('re-dispatches with the existing carrier when none is supplied', async () => {
    const orderId = await placeSimpleOrder();
    await confirm(orderId);
    await ship(orderId);
    await act(admin, orderId, 'delivery-failed', { reason: 'Nobody at the address.' }).expect(200);

    const retried = await act(admin, orderId, 'retry-shipment', {}).expect(200);

    expect(retried.body.data.status).toBe(OrderStatus.SHIPPED);
    expect(retried.body.data.shipment.carrier).toBe(CARRIER);
    expect(retried.body.data.shipment.trackingNumber).toBe(TRACKING);
  });

  it('requires a reason for a failed delivery', async () => {
    const orderId = await placeSimpleOrder();
    await confirm(orderId);
    await ship(orderId);

    const response = await act(admin, orderId, 'delivery-failed', {});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect((await loadOrder(orderId))?.status).toBe(OrderStatus.SHIPPED);
  });
});

describe('illegal transitions', () => {
  it('refuses to skip a step (PLACED cannot ship or deliver)', async () => {
    const orderId = await placeSimpleOrder();

    const shipped = await act(admin, orderId, 'ship', {
      carrier: CARRIER,
      trackingNumber: TRACKING,
    });
    const delivered = await act(admin, orderId, 'deliver', {});

    for (const response of [shipped, delivered]) {
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(response.body.error.details[0].message).toContain(OrderStatus.PLACED);
    }

    const stored = await loadOrder(orderId);
    expect(stored?.status).toBe(OrderStatus.PLACED);
    expect(stored?.shipment).toBeNull();
  });

  it('refuses SHIPPED -> RETURNED — the goods have not come back yet', async () => {
    const orderId = await placeSimpleOrder();
    await confirm(orderId);
    await ship(orderId);
    const stockBefore = await onHandOf(stockProduct);

    const response = await act(admin, orderId, 'return', { reason: 'Trying to short-circuit.' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await loadOrder(orderId))?.status).toBe(OrderStatus.SHIPPED);
    // Critically: no stock moved on the refusal path.
    expect(await onHandOf(stockProduct)).toBe(stockBefore);
    expect(await eventsFor(orderId, InventoryEventType.RETURN)).toHaveLength(0);
  });

  it('refuses to repeat an operation that already succeeded', async () => {
    const orderId = await placeSimpleOrder();
    await confirm(orderId);

    const again = await act(admin, orderId, 'confirm', {});

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await loadOrder(orderId))?.statusHistory).toHaveLength(2);
  });

  it('treats CANCELLED and RETURNED as terminal for every staff action', async () => {
    const cancelled = await placeSimpleOrder();
    await http()
      .post(`/api/v1/orders/${cancelled}/cancel`)
      .set(...bearer(alice))
      .send({ reason: 'Changed my mind.' })
      .expect(200);

    const returned = await placeSimpleOrder();
    await confirm(returned);
    await ship(returned);
    await act(admin, returned, 'delivery-failed', { reason: 'Undeliverable.' }).expect(200);
    await act(admin, returned, 'return', { reason: 'Given up on.' }).expect(200);

    for (const orderId of [cancelled, returned]) {
      const before = await loadOrder(orderId);

      for (const action of ACTIONS) {
        const response = await act(admin, orderId, action, ACTION_BODIES[action] ?? {});

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('INVALID_STATE_TRANSITION');
      }

      // No resurrection: status and history unchanged after twelve attempts.
      const after = await loadOrder(orderId);
      expect(after?.status).toBe(before?.status);
      expect(after?.statusHistory).toHaveLength(before?.statusHistory.length ?? -1);
    }
  }, 180_000);

  it('refuses DELIVERED -> CANCELLED for the customer too', async () => {
    const orderId = await placeSimpleOrder();
    await confirm(orderId);
    await ship(orderId);
    await deliver(orderId);

    const response = await http()
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set(...bearer(alice))
      .send({ reason: 'Too late.' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ORDER_NOT_CANCELLABLE');
    expect((await loadOrder(orderId))?.status).toBe(OrderStatus.DELIVERED);
  });
});

describe('return restores inventory', () => {
  it('restores the exact quantity and reverses salesCount from DELIVERY_FAILED', async () => {
    const before = await onHandOf(stockProduct);
    const salesBefore = await salesCountOf(stockProduct);

    const orderId = await placeSimpleOrder(7);
    await confirm(orderId);
    await ship(orderId);
    await act(admin, orderId, 'delivery-failed', { reason: 'Undeliverable.' }).expect(200);

    expect(await onHandOf(stockProduct)).toBe(before - 7);
    expect(await salesCountOf(stockProduct)).toBe(salesBefore + 7);

    await act(admin, orderId, 'return', { reason: 'Given up on after two attempts.' }).expect(200);

    expect(await onHandOf(stockProduct)).toBe(before);
    expect(await salesCountOf(stockProduct)).toBe(salesBefore);
  });

  it('restores from DELIVERED and writes one self-verifying RETURN entry', async () => {
    const before = await onHandOf(stockProduct);
    const orderId = await placeSimpleOrder(5);
    await confirm(orderId);
    await ship(orderId);
    await deliver(orderId);

    const onHandBeforeReturn = await onHandOf(stockProduct);
    const returned = await act(admin, orderId, 'return', {
      reason: 'Customer returned it within the window.',
    }).expect(200);

    expect(returned.body.data.status).toBe(OrderStatus.RETURNED);
    expect(await onHandOf(stockProduct)).toBe(before);

    const events = await eventsFor(orderId, InventoryEventType.RETURN);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.quantityDelta).toBe(5);
    expect(event?.balanceBefore).toBe(onHandBeforeReturn);
    expect(event?.balanceAfter).toBe(onHandBeforeReturn + 5);
    expect(event?.reference?.type).toBe(InventoryReferenceType.ORDER);
    expect(event?.reference?.id.toHexString()).toBe(orderId);
    expect(event?.actor?.role).toBe(Role.ADMIN);

    // The SALE and the RETURN net to zero — the ledger invariant.
    const sale = (await eventsFor(orderId, InventoryEventType.SALE))[0];
    expect((sale?.quantityDelta ?? 0) + (event?.quantityDelta ?? 0)).toBe(0);

    // A delivered order that comes back keeps its PAID status — a refund is an
    // out-of-band transfer, not something this operation performs.
    expect((await loadOrder(orderId))?.payment.status).toBe(PaymentStatus.PAID);
  });

  it('restores every line of a multi-product order', async () => {
    const stockBefore = await onHandOf(stockProduct);
    const secondBefore = await onHandOf(secondProduct);

    const orderId = await placeOrder(alice, [
      { product: stockProduct, quantity: 3 },
      { product: secondProduct, quantity: 6 },
    ]);
    await confirm(orderId);
    await ship(orderId);
    await deliver(orderId);
    await act(admin, orderId, 'return', { reason: 'Whole order returned.' }).expect(200);

    expect(await onHandOf(stockProduct)).toBe(stockBefore);
    expect(await onHandOf(secondProduct)).toBe(secondBefore);

    const events = await eventsFor(orderId, InventoryEventType.RETURN);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.quantityDelta).sort((a, b) => a - b)).toEqual([3, 6]);
  });

  it('restores stock for a product DELISTED after the order was placed', async () => {
    const before = await onHandOf(stockProduct);
    const orderId = await placeSimpleOrder(2);
    await confirm(orderId);
    await ship(orderId);
    await deliver(orderId);

    // Delisting must not become a way to silently destroy returned stock.
    await products.updateOne({ _id: stockProduct }, { $set: { isActive: false } }).exec();

    await act(admin, orderId, 'return', { reason: 'Returned after delisting.' }).expect(200);

    expect(await onHandOf(stockProduct)).toBe(before);
    expect(await eventsFor(orderId, InventoryEventType.RETURN)).toHaveLength(1);

    await products.updateOne({ _id: stockProduct }, { $set: { isActive: true } }).exec();
  });

  it('does not fabricate inventory state for a HARD-deleted product', async () => {
    const doomed = await createProduct('doomed', 40, 9000);
    const stockBefore = await onHandOf(stockProduct);

    const orderId = await placeOrder(alice, [
      { product: stockProduct, quantity: 2 },
      { product: doomed, quantity: 3 },
    ]);
    await confirm(orderId);
    await ship(orderId);
    await deliver(orderId);

    await products.deleteOne({ _id: doomed }).exec();

    // The order must not become unreturnable because a catalogue row vanished.
    await act(admin, orderId, 'return', { reason: 'Returned after a product was removed.' }).expect(200);

    expect((await loadOrder(orderId))?.status).toBe(OrderStatus.RETURNED);
    expect(await onHandOf(stockProduct)).toBe(stockBefore);

    // One entry for the line that still has somewhere to go, and NO entry
    // inventing a balance for a document that does not exist.
    const events = await eventsFor(orderId, InventoryEventType.RETURN);
    expect(events).toHaveLength(1);
    expect(events[0]?.productId.toHexString()).toBe(stockProduct.toHexString());
  });

  it('refuses a SECOND return and does not restore stock twice', async () => {
    const orderId = await placeSimpleOrder(4);
    await confirm(orderId);
    await ship(orderId);
    await deliver(orderId);

    const beforeReturn = await onHandOf(stockProduct);
    await act(admin, orderId, 'return', { reason: 'First return.' }).expect(200);
    const afterFirst = await onHandOf(stockProduct);
    expect(afterFirst).toBe(beforeReturn + 4);

    const second = await act(admin, orderId, 'return', { reason: 'Trying again.' });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect(await onHandOf(stockProduct)).toBe(afterFirst);
    expect(await eventsFor(orderId, InventoryEventType.RETURN)).toHaveLength(1);
  });
});

describe('concurrency', () => {
  it('lets exactly ONE of six simultaneous confirmations take effect', async () => {
    const orderId = await placeSimpleOrder();

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => act(admin, orderId, 'confirm', {})),
    );

    const succeeded = responses.filter((response) => response.status === 200);
    const refused = responses.filter((response) => response.status !== 200);

    expect(succeeded).toHaveLength(1);
    for (const response of refused) {
      // Deterministic 409s — never a 500 from a normal race.
      expect(response.status).toBe(409);
      expect(['INVALID_STATE_TRANSITION', 'CONCURRENT_MODIFICATION']).toContain(
        response.body.error.code,
      );
    }

    const stored = await loadOrder(orderId);
    expect(stored?.status).toBe(OrderStatus.CONFIRMED);
    // No duplicate history: exactly one CONFIRMED entry.
    expect(stored?.statusHistory).toHaveLength(2);
    expect(
      stored?.statusHistory.filter((entry) => entry.to === OrderStatus.CONFIRMED),
    ).toHaveLength(1);
  }, 120_000);

  it('lets exactly ONE of two CONFLICTING transitions win from the same source', async () => {
    const orderId = await placeSimpleOrder();
    await confirm(orderId);
    await ship(orderId);

    // DELIVERED and DELIVERY_FAILED are both legal from SHIPPED, and they are
    // mutually exclusive outcomes of the same delivery attempt.
    const [delivered, failed] = await Promise.all([
      act(admin, orderId, 'deliver', {}),
      act(admin, orderId, 'delivery-failed', { reason: 'Courier reported a failure.' }),
    ]);

    const statuses = [delivered.status, failed.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = delivered.status === 200 ? failed : delivered;
    expect(['INVALID_STATE_TRANSITION', 'CONCURRENT_MODIFICATION']).toContain(
      loser.body.error.code,
    );

    const stored = await loadOrder(orderId);
    // Exactly one outcome was recorded, and the order is in it. Four entries:
    // placement, CONFIRMED, SHIPPED, and the single winning outcome — the loser
    // appended nothing.
    expect([OrderStatus.DELIVERED, OrderStatus.DELIVERY_FAILED]).toContain(stored?.status);
    expect(stored?.statusHistory).toHaveLength(4);
    expect(
      stored?.statusHistory.filter(
        (entry) => entry.to === OrderStatus.DELIVERED || entry.to === OrderStatus.DELIVERY_FAILED,
      ),
    ).toHaveLength(1);

    // The two outcomes are mutually exclusive in the DATA too: an order marked
    // delivered must be paid, and one marked failed must not be.
    if (stored?.status === OrderStatus.DELIVERED) {
      expect(stored.payment.status).toBe(PaymentStatus.PAID);
    } else {
      expect(stored?.payment.status).toBe(PaymentStatus.PENDING);
      expect(stored?.shipment?.deliveryAttempts).toBe(1);
    }
  }, 120_000);

  it('restores stock exactly once under six simultaneous returns', async () => {
    const orderId = await placeSimpleOrder(9);
    await confirm(orderId);
    await ship(orderId);
    await deliver(orderId);

    const beforeReturn = await onHandOf(stockProduct);
    const salesBefore = await salesCountOf(stockProduct);

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => act(admin, orderId, 'return', { reason: 'Returned.' })),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    for (const response of responses.filter((r) => r.status !== 200)) {
      expect(response.status).toBe(409);
    }

    // ONE restoration. Not six.
    expect(await onHandOf(stockProduct)).toBe(beforeReturn + 9);
    expect(await salesCountOf(stockProduct)).toBe(salesBefore - 9);
    expect(await eventsFor(orderId, InventoryEventType.RETURN)).toHaveLength(1);

    const stored = await loadOrder(orderId);
    expect(stored?.status).toBe(OrderStatus.RETURNED);
    expect(stored?.statusHistory.filter((entry) => entry.to === OrderStatus.RETURNED)).toHaveLength(1);
  }, 120_000);

  it('does not let transitions on DIFFERENT orders block each other', async () => {
    const first = await placeSimpleOrder(2);
    const second = await placeSimpleOrder(3, bob);

    const [one, two] = await Promise.all([
      act(admin, first, 'confirm', {}),
      act(admin, second, 'confirm', {}),
    ]);

    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
  }, 120_000);
});

describe('transaction atomicity', () => {
  it('leaves NO partial business state when the return ledger write fails', async () => {
    const orderId = await placeSimpleOrder(6);
    await confirm(orderId);
    await ship(orderId);
    await act(admin, orderId, 'delivery-failed', { reason: 'Undeliverable.' }).expect(200);

    const stockBefore = await onHandOf(stockProduct);
    const salesBefore = await salesCountOf(stockProduct);

    // Induce a failure INSIDE the transaction, after the status update and the
    // stock increment have already been applied: plant the exact ledger entry
    // the return is about to write, so its insert violates the unique index.
    const planted = await inventoryEvents.create({
      productId: stockProduct,
      sku: `ADM-TEST-STOCK-${RUN_ID}`.toUpperCase(),
      type: InventoryEventType.RETURN,
      quantityDelta: 1,
      balanceBefore: 0,
      balanceAfter: 1,
      reason: 'planted by the atomicity test',
      reference: { type: InventoryReferenceType.ORDER, id: new Types.ObjectId(orderId) },
      actor: null,
    });
    plantedEventIds.push(planted._id);

    const response = await act(admin, orderId, 'return', { reason: 'Should roll back.' });

    expect(response.status).toBeGreaterThanOrEqual(500);

    const stored = await loadOrder(orderId);
    // The status update rolled back...
    expect(stored?.status).toBe(OrderStatus.DELIVERY_FAILED);
    // ...so did the history append...
    expect(stored?.statusHistory.filter((entry) => entry.to === OrderStatus.RETURNED)).toHaveLength(0);
    // ...and so did the stock increment that had already been applied.
    expect(await onHandOf(stockProduct)).toBe(stockBefore);
    expect(await salesCountOf(stockProduct)).toBe(salesBefore);

    const events = await eventsFor(orderId, InventoryEventType.RETURN);
    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toBe('planted by the atomicity test');

    // Remove the plant and prove the order is still genuinely returnable.
    await inventoryEvents.deleteOne({ _id: planted._id }).exec();
    await act(admin, orderId, 'return', { reason: 'Now it works.' }).expect(200);
    expect(await onHandOf(stockProduct)).toBe(stockBefore + 6);
  }, 120_000);
});

describe('admin work queue', () => {
  it('lists orders across ALL customers, newest first, with true totals', async () => {
    const aliceOrder = await placeSimpleOrder(1);
    const bobOrder = await placeSimpleOrder(1, bob);

    const page = await http()
      .get('/api/v1/admin/orders?limit=100')
      .set(...bearer(admin))
      .expect(200);

    const ids = page.body.data.map((row: { id: string }) => row.id);
    // Both customers' orders are visible to staff.
    expect(ids).toContain(aliceOrder);
    expect(ids).toContain(bobOrder);
    expect(page.body.meta.total).toBeGreaterThanOrEqual(2);

    // Newest first, by the same stable ordering as the customer history.
    const placedAt = page.body.data.map((row: { placedAt: string }) => Date.parse(row.placedAt));
    expect([...placedAt].sort((a: number, b: number) => b - a)).toEqual(placedAt);
  });

  it('uses the same compact card model as the customer history', async () => {
    await placeSimpleOrder(1);

    const page = await http()
      .get('/api/v1/admin/orders?limit=1')
      .set(...bearer(admin))
      .expect(200);

    // Exactly the nine summary fields — no admin-only shape that could drift.
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
    expect(page.body.meta).toEqual({
      page: 1,
      limit: 1,
      total: expect.any(Number) as unknown as number,
      totalPages: expect.any(Number) as unknown as number,
      hasNext: expect.any(Boolean) as unknown as boolean,
      hasPrev: false,
    });
  });

  it('filters the queue by status', async () => {
    const orderId = await placeSimpleOrder(1);
    await confirm(orderId);

    const confirmedQueue = await http()
      .get('/api/v1/admin/orders?status=CONFIRMED&limit=100')
      .set(...bearer(admin))
      .expect(200);
    const placedQueue = await http()
      .get('/api/v1/admin/orders?status=PLACED&limit=100')
      .set(...bearer(admin))
      .expect(200);

    expect(confirmedQueue.body.data.map((row: { id: string }) => row.id)).toContain(orderId);
    expect(placedQueue.body.data.map((row: { id: string }) => row.id)).not.toContain(orderId);
    for (const row of confirmedQueue.body.data) {
      expect(row.status).toBe(OrderStatus.CONFIRMED);
    }
  });

  it('rejects an unknown query parameter and a bad status', async () => {
    const unknown = await http()
      .get('/api/v1/admin/orders?userId=abc')
      .set(...bearer(admin));
    const badStatus = await http()
      .get('/api/v1/admin/orders?status=NOT_A_STATUS')
      .set(...bearer(admin));

    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('UNKNOWN_FIELD');
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reads any customer order as the canonical OrderDto', async () => {
    const bobOrder = await placeSimpleOrder(2, bob);

    const staffView = await http()
      .get(`/api/v1/admin/orders/${bobOrder}`)
      .set(...bearer(admin))
      .expect(200);
    const customerView = await http()
      .get(`/api/v1/orders/${bobOrder}`)
      .set(...bearer(bob))
      .expect(200);

    // ONE order model. The admin screen and the customer screen share it.
    expect(staffView.body.data).toEqual(customerView.body.data);
    // The operator can read back the address to make the confirmation call.
    expect(staffView.body.data.shippingAddress.phone).toBe(ADDRESS.phone);
    // Internals stay internal even for staff in this phase.
    expect(staffView.body.data.statusHistory).toBeUndefined();
    expect(staffView.body.data.adminNote).toBeUndefined();
    expect(staffView.body.data.idempotencyKey).toBeUndefined();
  });

  it('answers 404 for an unknown order id', async () => {
    const response = await http()
      .get(`/api/v1/admin/orders/${new Types.ObjectId().toHexString()}`)
      .set(...bearer(admin));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
  });
});

describe('index usage', () => {
  /** The exact query the admin queue issues, explained against the real database. */
  async function explainQueue(filter: Record<string, unknown>) {
    return orders
      .find(filter)
      .sort({ placedAt: -1, _id: -1 })
      .limit(24)
      .explain('executionStats');
  }

  /**
   * The WINNING plan only.
   *
   * `JSON.stringify(explain)` includes `queryPlanner.rejectedPlans`, so
   * `toContain('order_admin_queue')` against the whole document passed when the
   * queue was served by a DIFFERENT index and `order_admin_queue` appeared only
   * among the plans the planner threw away — which is exactly the regression
   * these tests exist to catch. `orders-read.spec.ts` already scoped its
   * equivalent to `queryPlanner.winningPlan`; these did not.
   */
  function winningPlanOf(explain: unknown): string {
    return JSON.stringify((explain as { queryPlanner: { winningPlan: unknown } }).queryPlanner.winningPlan);
  }

  it('serves the UNFILTERED queue with an index scan and no blocking sort', async () => {
    await placeSimpleOrder(1);

    const plan = winningPlanOf(await explainQueue({}));

    expect(plan).toContain('order_admin_queue');
    expect(plan).toContain('IXSCAN');
    // The index is walked already ordered — a SORT stage here would mean every
    // page paid an in-memory sort of the whole collection.
    expect(plan).not.toContain('COLLSCAN');
    expect(plan).not.toContain('"stage":"SORT"');
    expect(plan).not.toContain('sortPattern');
  });

  it('serves the STATUS-FILTERED queue from the same index', async () => {
    const plan = winningPlanOf(
      await explainQueue({ status: { $in: [OrderStatus.PLACED, OrderStatus.CONFIRMED] } }),
    );

    // `status` rides along as a residual predicate rather than needing an index
    // of its own — which is why a second `{status, placedAt}` index was rejected.
    expect(plan).toContain('order_admin_queue');
    expect(plan).toContain('IXSCAN');
    expect(plan).not.toContain('COLLSCAN');
    expect(plan).not.toContain('"stage":"SORT"');
  });

  it('still serves the CUSTOMER history from its own index', async () => {
    const plan = winningPlanOf(
      await orders
        .find({ userId: alice.id })
        .sort({ placedAt: -1, _id: -1 })
        .limit(24)
        .explain('executionStats'),
    );

    // The admin index must not have displaced the customer one.
    expect(plan).toContain('order_user_history');
    expect(plan).not.toContain('COLLSCAN');
    expect(plan).not.toContain('"stage":"SORT"');
  });
});
