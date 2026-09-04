import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { validationExceptionFactory } from '../../src/common/pipes/validation-exception.factory';
import { AuditLog } from '../../src/modules/audit/infrastructure/schemas/audit-log.schema';
import { RefreshToken } from '../../src/modules/auth/infrastructure/schemas/refresh-token.schema';
import { Cart } from '../../src/modules/cart/infrastructure/schemas/cart.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { InventoryEvent } from '../../src/modules/inventory/infrastructure/schemas/inventory-event.schema';
import { ORDER_STATUSES, OrderStatus } from '../../src/modules/orders/domain/order-status';
import { IdempotencyKeyRecord } from '../../src/modules/orders/infrastructure/schemas/idempotency-key.schema';
import { Order, type OrderLean } from '../../src/modules/orders/infrastructure/schemas/order.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'dashboard copper beryllium alloy';

let app: INestApplication;
let users: Model<User>;
let carts: Model<Cart>;
let products: Model<Product>;
let orders: Model<Order>;
let idempotencyKeys: Model<IdempotencyKeyRecord>;
let refreshTokens: Model<RefreshToken>;
let inventoryEvents: Model<InventoryEvent>;
let auditLogs: Model<AuditLog>;

const createdUserIds: Types.ObjectId[] = [];
const createdProductIds: Types.ObjectId[] = [];
const createdOrderIds: Types.ObjectId[] = [];

interface Account {
  readonly id: Types.ObjectId;
  readonly token: string;
  readonly fullName: string;
  readonly email: string;
  readonly addressId: string;
}

const NO_ADDRESS = '652f1a9b3c4d5e6f7a8b9c0d';

function http(): request.Agent {
  return request(app.getHttpServer());
}

function bearer(account: Account): [string, string] {
  return ['Authorization', `Bearer ${account.token}`];
}

async function saveAddress(token: string, phone: string, fullName: string): Promise<string> {
  const response = await http()
    .post('/api/v1/users/me/addresses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      label: 'Home',
      fullName,
      phone,
      street: '15 Tahrir Square',
      city: 'Downtown',
      governorate: 'Cairo',
    })
    .expect(201);

  return response.body.data.id as string;
}

async function createAccount(
  label: string,
  options: { role?: Role; fullName?: string; phone?: string } = {},
): Promise<Account> {
  const role = options.role ?? Role.CUSTOMER;
  const email = `dash-${label}.${RUN_ID}@example.test`;
  const fullName = options.fullName ?? `Dash ${label}`;
  const phone = options.phone ?? '01011112222';

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
    email,
    addressId: role === Role.CUSTOMER ? await saveAddress(token, phone, fullName) : NO_ADDRESS,
  };
}

async function createProduct(
  unitPrice: number,
  stockOpts: { onHand: number; lowStockThreshold: number; isActive?: boolean } = {
    onHand: 100,
    lowStockThreshold: 5,
  },
): Promise<Types.ObjectId> {
  const category = await app
    .get<Model<Category>>(getModelToken(Category.name))
    .findOne({ slug: 'development-boards' })
    .lean<{ _id: Types.ObjectId; slug: string; name: { en: string }; path: Types.ObjectId[] }>()
    .exec();

  if (category === null) {
    throw new Error('seed category development-boards is missing — run `pnpm --filter api seed`');
  }

  const suffix = randomUUID().slice(0, 6);
  const created = await products.create({
    sku: `DASH-${RUN_ID}-${suffix}`,
    slug: `dash-product-${RUN_ID}-${suffix}`,
    name: { en: `Dash Product ${suffix}`, ar: null },
    shortDescription: { en: 'Created by the dashboard aggregates test suite.', ar: null },
    description: null,
    category: {
      id: category._id,
      slug: category.slug,
      name: { en: category.name.en, ar: null },
      path: [...category.path, category._id],
    },
    brand: null,
    pricing: { basePrice: unitPrice, salePrice: null, effectivePrice: unitPrice, costPrice: 50 },
    currency: 'EGP',
    stock: {
      onHand: stockOpts.onHand,
      lowStockThreshold: stockOpts.lowStockThreshold,
    },
    images: [],
    specs: [],
    salesCount: 0,
    isActive: stockOpts.isActive ?? true,
    isFeatured: false,
    deletedAt: null,
    weight: null,
  });

  createdProductIds.push(created._id);
  return created._id;
}

async function placeOrder(
  customer: Account,
  productId: Types.ObjectId,
  quantity: number,
): Promise<{ id: string; grandTotal: number }> {
  await http()
    .post('/api/v1/cart/items')
    .set(...bearer(customer))
    .send({ productId: productId.toHexString(), quantity })
    .expect(200);

  const response = await http()
    .post('/api/v1/orders')
    .set(...bearer(customer))
    .set('Idempotency-Key', randomUUID())
    .send({ addressId: customer.addressId })
    .expect(201);

  const id = response.body.data.id as string;
  const grandTotal = response.body.data.pricing.grandTotal.amount as number;
  createdOrderIds.push(new Types.ObjectId(id));

  return { id, grandTotal };
}

let staff: Account;
let customer: Account;
let testProduct: Types.ObjectId;

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
  idempotencyKeys = app.get<Model<IdempotencyKeyRecord>>(getModelToken(IdempotencyKeyRecord.name));
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));
  inventoryEvents = app.get<Model<InventoryEvent>>(getModelToken(InventoryEvent.name));
  auditLogs = app.get<Model<AuditLog>>(getModelToken(AuditLog.name));

  staff = await createAccount('staff', { role: Role.ADMIN });
  customer = await createAccount('customer');
  testProduct = await createProduct(5_000);
}, 120_000);

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await inventoryEvents.deleteMany({ 'reference.id': { $in: createdOrderIds } }).exec();
    await orders.deleteMany({ _id: { $in: createdOrderIds } }).exec();
  }

  if (createdUserIds.length > 0) {
    await idempotencyKeys.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await carts.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await auditLogs.deleteMany({ 'actor.id': { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  if (createdProductIds.length > 0) {
    await products.deleteMany({ _id: { $in: createdProductIds } }).exec();
  }

  await app.close();
});

describe('GET /admin/dashboard/stats authorization', () => {
  it('refuses unauthenticated caller with 401', async () => {
    await http().get('/api/v1/admin/dashboard/stats').expect(401);
  });

  it('refuses customer caller with 403', async () => {
    await http()
      .get('/api/v1/admin/dashboard/stats')
      .set(...bearer(customer))
      .expect(403);
  });

  it('permits staff caller with 200', async () => {
    const response = await http()
      .get('/api/v1/admin/dashboard/stats')
      .set(...bearer(staff))
      .expect(200);

    expect(response.body.data).toHaveProperty('revenue');
    expect(response.body.data).toHaveProperty('orders');
    expect(response.body.data).toHaveProperty('products');
    expect(response.body.data).toHaveProperty('customers');
  });
});

describe('GET /admin/dashboard/stats structural contracts', () => {
  it('includes all 7 order statuses in byStatus with non-negative counts and valid sum', async () => {
    const response = await http()
      .get('/api/v1/admin/dashboard/stats')
      .set(...bearer(staff))
      .expect(200);

    const { orders: orderData } = response.body.data;
    expect(orderData.byStatus).toHaveLength(7);

    const returnedStatuses = orderData.byStatus.map((b: { status: string }) => b.status);
    for (const status of ORDER_STATUSES) {
      expect(returnedStatuses).toContain(status);
    }

    let calculatedSum = 0;
    for (const item of orderData.byStatus) {
      expect(item.count).toBeGreaterThanOrEqual(0);
      calculatedSum += item.count;
    }
    expect(orderData.total).toBe(calculatedSum);
  });

  it('formats money values as proper MoneyDto structures with EGP currency', async () => {
    const response = await http()
      .get('/api/v1/admin/dashboard/stats')
      .set(...bearer(staff))
      .expect(200);

    const { revenue } = response.body.data;
    expect(revenue.delivered.currency).toBe('EGP');
    expect(typeof revenue.delivered.amount).toBe('number');
    expect(typeof revenue.delivered.formatted).toBe('string');
    expect(revenue.delivered.formatted).toMatch(/^\d{1,3}(,\d{3})*\.\d{2} EGP$/);

    expect(revenue.pipeline.currency).toBe('EGP');
    expect(typeof revenue.pipeline.amount).toBe('number');
    expect(typeof revenue.pipeline.formatted).toBe('string');
    expect(revenue.pipeline.formatted).toMatch(/^\d{1,3}(,\d{3})*\.\d{2} EGP$/);
  });
});

describe('the trailing window', () => {
  /*
   * Why the default is 30 days and not all-time.
   *
   * The product reason first: "delivered revenue, last 30 days" is a question
   * an operator has, and "since the shop opened" is a number that only goes up
   * and cannot be compared to anything. The cost reason second: the revenue
   * facet has no `status` index to seek on — `orders` deliberately carries
   * {placedAt, _id} rather than {status, placedAt}, so the unfiltered work
   * queue needs no in-memory sort — which means an unbounded facet reads every
   * order in the collection on every dashboard load.
   *
   * The bound is on `placedAt`, which is the field the index leads on and the
   * only order date indexed at all. Revenue is recognised at DELIVERY, so the
   * two differ for an order placed outside the window and delivered inside it.
   * That is why the label the server hands the console says "orders placed".
   */

  function statsFor(window?: string): request.Test {
    const call = http()
      .get('/api/v1/admin/dashboard/stats')
      .set(...bearer(staff));

    return window === undefined ? call : call.query({ window });
  }

  it('defaults to 30 days and says so, rather than leaving the console to guess', async () => {
    const response = await statsFor().expect(200);

    expect(response.body.data.window).toMatchObject({ key: '30d', days: 30 });
    expect(response.body.data.window.label).toBe('Orders placed in the last 30 days');

    // A real bound, roughly 30 days back — the console prints the label, but
    // the caption and the filter have to be the same fact.
    const since = new Date(response.body.data.window.since as string).getTime();
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(since - expected)).toBeLessThan(60_000);
  });

  it('reports all-time as unbounded rather than as a very large number of days', async () => {
    const response = await statsFor('all').expect(200);

    expect(response.body.data.window).toMatchObject({
      key: 'all',
      days: null,
      since: null,
      label: 'All time',
    });
  });

  it('refuses a window it does not offer, instead of quietly using the default', async () => {
    /*
     * A silently-corrected parameter is a number with the wrong caption, which
     * is the failure this whole change exists to avoid.
     */
    await statsFor('7d').expect(400);
    await statsFor('30').expect(400);
  });

  it('EXCLUDES an order older than the window and includes it in all-time', async () => {
    /*
     * The behaviour, not the label. An order delivered and paid, then backdated
     * past the bound: gone from the 30-day figures, still in all-time.
     *
     * Backdating in the database rather than waiting 31 days is the only way to
     * test a trailing window, and `placedAt` is exactly the field the aggregation
     * filters on.
     */
    const { id: orderId, grandTotal } = await placeOrder(customer, testProduct, 1);

    await http()
      .post(`/api/v1/admin/orders/${orderId}/confirm`)
      .set(...bearer(staff))
      .expect(200);
    await http()
      .post(`/api/v1/admin/orders/${orderId}/ship`)
      .set(...bearer(staff))
      .send({ carrier: 'Bosta', trackingNumber: `BOS-${RUN_ID}` })
      .expect(200);
    await http()
      .post(`/api/v1/admin/orders/${orderId}/deliver`)
      .set(...bearer(staff))
      .expect(200);

    const insideWindow = (await statsFor().expect(200)).body.data;
    const allTimeBefore = (await statsFor('all').expect(200)).body.data;

    await orders
      .updateOne(
        { _id: new Types.ObjectId(orderId) },
        { $set: { placedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) } },
      )
      .exec();

    const afterBackdating = (await statsFor().expect(200)).body.data;
    const allTimeAfter = (await statsFor('all').expect(200)).body.data;

    // Out of the 30-day figures entirely: the money, the count, and the row in
    // the status breakdown.
    expect(afterBackdating.revenue.delivered.amount).toBe(
      insideWindow.revenue.delivered.amount - grandTotal,
    );
    expect(afterBackdating.revenue.deliveredCount).toBe(insideWindow.revenue.deliveredCount - 1);
    expect(afterBackdating.orders.total).toBe(insideWindow.orders.total - 1);

    // All-time did not move, because nothing about the order changed except a
    // date the all-time query does not look at.
    expect(allTimeAfter.revenue.delivered.amount).toBe(allTimeBefore.revenue.delivered.amount);
    expect(allTimeAfter.orders.total).toBe(allTimeBefore.orders.total);

    // And all-time still holds it, which is what makes the default safe to be a
    // window: nothing is hidden, it is one click away.
    expect(allTimeAfter.revenue.delivered.amount).toBeGreaterThanOrEqual(
      afterBackdating.revenue.delivered.amount + grandTotal,
    );
  });

  it('leaves product and customer TOTALS alone — they are not time-bounded questions', async () => {
    const thirty = (await statsFor().expect(200)).body.data;
    const all = (await statsFor('all').expect(200)).body.data;

    // "How many active products are there" has no trailing-30-day version, and
    // neither does "how many registered customers". `withOrdersCount` is the
    // one customer figure that DOES move, which is why it is not asserted here.
    expect(thirty.products.total).toBe(all.products.total);
    expect(thirty.products.lowStockCount).toBe(all.products.lowStockCount);
    expect(thirty.products.outOfStockCount).toBe(all.products.outOfStockCount);
    expect(thirty.customers.total).toBe(all.customers.total);
    expect(thirty.customers.newThisWeek).toBe(all.customers.newThisWeek);
  });

  it('still returns all 7 statuses inside a window, including the ones with nothing in them', async () => {
    /*
     * A window narrows the population, not the shape. A breakdown that dropped
     * empty statuses would make a quiet month look like a broken endpoint.
     */
    const response = await statsFor('90d').expect(200);

    expect(response.body.data.window).toMatchObject({ key: '90d', days: 90 });
    expect(response.body.data.orders.byStatus).toHaveLength(7);

    const returned = response.body.data.orders.byStatus.map((row: { status: string }) => row.status);
    for (const status of ORDER_STATUSES) expect(returned).toContain(status);
  });
});

describe('Revenue counted at DELIVERY (ADR-ORDER-002)', () => {
  it('recognises revenue only after transition to DELIVERED, tracking in-flight orders as pipeline', async () => {
    // 1. Capture baseline metrics
    const baseline = (
      await http()
        .get('/api/v1/admin/dashboard/stats')
        .set(...bearer(staff))
        .expect(200)
    ).body.data;

    // 2. Place a new order
    const { id: orderId, grandTotal } = await placeOrder(customer, testProduct, 2);

    const afterPlacement = (
      await http()
        .get('/api/v1/admin/dashboard/stats')
        .set(...bearer(staff))
        .expect(200)
    ).body.data;

    // Invariant: Revenue is NOT counted at placement (COD cash is not in)
    expect(afterPlacement.revenue.delivered.amount).toBe(baseline.revenue.delivered.amount);
    expect(afterPlacement.revenue.deliveredCount).toBe(baseline.revenue.deliveredCount);

    // Invariant: Order is in pipeline
    expect(afterPlacement.revenue.pipeline.amount).toBe(baseline.revenue.pipeline.amount + grandTotal);
    expect(afterPlacement.revenue.pipelineCount).toBe(baseline.revenue.pipelineCount + 1);
    expect(afterPlacement.orders.total).toBe(baseline.orders.total + 1);

    // 3. Confirm order
    await http()
      .post(`/api/v1/admin/orders/${orderId}/confirm`)
      .set(...bearer(staff))
      .expect(200);

    const afterConfirm = (
      await http()
        .get('/api/v1/admin/dashboard/stats')
        .set(...bearer(staff))
        .expect(200)
    ).body.data;

    expect(afterConfirm.revenue.delivered.amount).toBe(baseline.revenue.delivered.amount);
    expect(afterConfirm.revenue.pipeline.amount).toBe(baseline.revenue.pipeline.amount + grandTotal);

    // 4. Ship order
    await http()
      .post(`/api/v1/admin/orders/${orderId}/ship`)
      .set(...bearer(staff))
      .send({ carrier: 'Bosta', trackingNumber: 'BOS-123456' })
      .expect(200);

    const afterShip = (
      await http()
        .get('/api/v1/admin/dashboard/stats')
        .set(...bearer(staff))
        .expect(200)
    ).body.data;

    expect(afterShip.revenue.delivered.amount).toBe(baseline.revenue.delivered.amount);
    expect(afterShip.revenue.pipeline.amount).toBe(baseline.revenue.pipeline.amount + grandTotal);

    // 5. Fail delivery (e.g. customer not home)
    await http()
      .post(`/api/v1/admin/orders/${orderId}/delivery-failed`)
      .set(...bearer(staff))
      .send({ reason: 'Customer unavailable' })
      .expect(200);

    const afterFail = (
      await http()
        .get('/api/v1/admin/dashboard/stats')
        .set(...bearer(staff))
        .expect(200)
    ).body.data;

    // Delivery failed is still in pipeline (courier will re-attempt)
    expect(afterFail.revenue.delivered.amount).toBe(baseline.revenue.delivered.amount);
    expect(afterFail.revenue.pipeline.amount).toBe(baseline.revenue.pipeline.amount + grandTotal);

    // 6. Retry shipment
    await http()
      .post(`/api/v1/admin/orders/${orderId}/retry-shipment`)
      .set(...bearer(staff))
      .expect(200);

    // 7. Deliver order (COD cash collected!)
    await http()
      .post(`/api/v1/admin/orders/${orderId}/deliver`)
      .set(...bearer(staff))
      .expect(200);

    // Confirm that the document now has payment.status = PAID
    const deliveredDoc = (await orders.findById(orderId).lean<OrderLean>().exec())!;
    expect(deliveredDoc.status).toBe(OrderStatus.DELIVERED);
    expect(deliveredDoc.payment.status).toBe('PAID');

    const afterDelivery = (
      await http()
        .get('/api/v1/admin/dashboard/stats')
        .set(...bearer(staff))
        .expect(200)
    ).body.data;

    // Invariant: Revenue is now recognised!
    expect(afterDelivery.revenue.delivered.amount).toBe(baseline.revenue.delivered.amount + grandTotal);
    expect(afterDelivery.revenue.deliveredCount).toBe(baseline.revenue.deliveredCount + 1);

    // Invariant: Order leaves pipeline
    expect(afterDelivery.revenue.pipeline.amount).toBe(baseline.revenue.pipeline.amount);
    expect(afterDelivery.revenue.pipelineCount).toBe(baseline.revenue.pipelineCount);
  });

  it('removes cancelled orders from pipeline without adding to delivered revenue', async () => {
    const baseline = (
      await http()
        .get('/api/v1/admin/dashboard/stats')
        .set(...bearer(staff))
        .expect(200)
    ).body.data;

    const { id: orderId, grandTotal } = await placeOrder(customer, testProduct, 1);

    const afterPlacement = (
      await http()
        .get('/api/v1/admin/dashboard/stats')
        .set(...bearer(staff))
        .expect(200)
    ).body.data;

    expect(afterPlacement.revenue.pipeline.amount).toBe(baseline.revenue.pipeline.amount + grandTotal);

    // Customer cancels order
    await http()
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set(...bearer(customer))
      .send({ reason: 'Changed mind' })
      .expect(200);

    const afterCancel = (
      await http()
        .get('/api/v1/admin/dashboard/stats')
        .set(...bearer(staff))
        .expect(200)
    ).body.data;

    expect(afterCancel.revenue.delivered.amount).toBe(baseline.revenue.delivered.amount);
    expect(afterCancel.revenue.pipeline.amount).toBe(baseline.revenue.pipeline.amount);
    expect(afterCancel.revenue.pipelineCount).toBe(baseline.revenue.pipelineCount);
  });
});

describe('Product inventory metrics', () => {
  it('reports active product counts and identifies low-stock items correctly', async () => {
    const lowStockProdId = await createProduct(1_000, { onHand: 2, lowStockThreshold: 5 });
    const outOfStockProdId = await createProduct(1_000, { onHand: 0, lowStockThreshold: 5 });
    const inactiveProdId = await createProduct(1_000, { onHand: 1, lowStockThreshold: 5, isActive: false });

    const stats = (
      await http()
        .get('/api/v1/admin/dashboard/stats')
        .set(...bearer(staff))
        .expect(200)
    ).body.data;

    // Inactive product should NOT be in active products
    expect(stats.products.total).toBeGreaterThanOrEqual(2);

    // Both onHand: 2 and onHand: 0 are low stock (<= threshold 5)
    expect(stats.products.lowStockCount).toBeGreaterThanOrEqual(2);
    expect(stats.products.outOfStockCount).toBeGreaterThanOrEqual(1);

    const lowStockIds = stats.products.lowStock.map((item: { id: string }) => item.id);
    expect(lowStockIds).toContain(outOfStockProdId.toHexString());
    expect(lowStockIds).toContain(lowStockProdId.toHexString());
    expect(lowStockIds).not.toContain(inactiveProdId.toHexString());

    const outOfStockItem = stats.products.lowStock.find(
      (item: { id: string }) => item.id === outOfStockProdId.toHexString(),
    );
    expect(outOfStockItem).toMatchObject({
      onHand: 0,
      lowStockThreshold: 5,
    });
  });
});

describe('Customer metrics', () => {
  it('counts registered customers and counts with-orders customers', async () => {
    const stats = (
      await http()
        .get('/api/v1/admin/dashboard/stats')
        .set(...bearer(staff))
        .expect(200)
    ).body.data;

    expect(stats.customers.total).toBeGreaterThanOrEqual(1);
    expect(stats.customers.newThisWeek).toBeGreaterThanOrEqual(1);
    expect(stats.customers.withOrdersCount).toBeGreaterThanOrEqual(1);
  });
});
