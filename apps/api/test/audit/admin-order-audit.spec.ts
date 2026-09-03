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
import { RefreshToken } from '../../src/modules/auth/infrastructure/schemas/refresh-token.schema';
import {
  AuditAction,
  AuditEntityType,
} from '../../src/modules/audit/domain/audit-action';
import { AuditLog } from '../../src/modules/audit/infrastructure/schemas/audit-log.schema';
import { Cart } from '../../src/modules/cart/infrastructure/schemas/cart.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { InventoryEvent } from '../../src/modules/inventory/infrastructure/schemas/inventory-event.schema';
import { OrderStatus } from '../../src/modules/orders/domain/order-status';
import { IdempotencyKeyRecord } from '../../src/modules/orders/infrastructure/schemas/idempotency-key.schema';
import { Order } from '../../src/modules/orders/infrastructure/schemas/order.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * An admin status transition is written to the SECURITY audit trail.
 *
 * ## The gap this closes
 *
 * `AUDIT-MODEL.md` §1 separates business history from security audit and says
 * they must not share a mechanism. §6.1 makes `statusHistory` the business
 * record — customer-visible, embedded, answering *what happened to this order*.
 * §3 lists **"order interventions — admin status transition"** under audited,
 * which is the other question: *who did this, and were they allowed to*.
 *
 * Phase 6 recorded the first and concluded the second was covered by it. It was
 * not. Between Phase 6 and this suite, every admin intervention was unaudited
 * in the security sense — the same shape as the legacy failure §2 documents,
 * where `admin_audit_logs` held zero rows while eight status transitions had
 * happened and the screen read as "no admin activity yet".
 *
 * ## Isolation
 *
 * Own accounts, own product, own orders, all removed by tracked id. The audit
 * rows this suite writes are removed by entity id — `auditLogs` is append-only
 * in the application, and this is a test tearing down its own fixture rather
 * than the application editing its trail.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const USER_AGENT = `AuditSuite/1.0 (${RUN_ID})`;

let app: INestApplication;
let users: Model<User>;
let carts: Model<Cart>;
let products: Model<Product>;
let orders: Model<Order>;
let auditLogs: Model<AuditLog>;
let inventoryEvents: Model<InventoryEvent>;
let idempotencyKeys: Model<IdempotencyKeyRecord>;
let refreshTokens: Model<RefreshToken>;

const createdUserIds: Types.ObjectId[] = [];
const createdProductIds: Types.ObjectId[] = [];
const createdOrderIds: Types.ObjectId[] = [];

interface Account {
  readonly id: Types.ObjectId;
  readonly token: string;
  readonly email: string;
  readonly fullName: string;
  readonly addressId: string;
}

const NO_ADDRESS = '652f1a9b3c4d5e6f7a8b9c0d';

function http(): request.Agent {
  return request(app.getHttpServer());
}

function bearer(account: Account): [string, string] {
  return ['Authorization', `Bearer ${account.token}`];
}

async function createAccount(label: string, role: Role = Role.CUSTOMER): Promise<Account> {
  const email = `audit-${label}.${RUN_ID}@example.test`;
  const fullName = `Audit ${label}`;

  await http().post('/api/v1/auth/register').send({ email, password: PASSWORD, fullName }).expect(201);
  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } }).exec();

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  const login = await http()
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  const token = login.body.data.accessToken as string;

  let addressId = NO_ADDRESS;

  if (role === Role.CUSTOMER) {
    const address = await http()
      .post('/api/v1/users/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Home',
        fullName,
        phone: '01012345678',
        street: '12 Sherif Street, Apartment 4',
        city: 'Downtown',
        governorate: 'Cairo',
      })
      .expect(201);

    addressId = address.body.data.id as string;
  }

  return { id: created._id, token, email, fullName, addressId };
}

async function placeOrder(): Promise<{ id: string; orderNumber: string }> {
  await http()
    .post('/api/v1/cart/items')
    .set(...bearer(customer))
    .send({ productId: product.toHexString(), quantity: 1 })
    .expect(200);

  const response = await http()
    .post('/api/v1/orders')
    .set(...bearer(customer))
    .set('Idempotency-Key', randomUUID())
    .send({ addressId: customer.addressId })
    .expect(201);

  const id = response.body.data.id as string;
  createdOrderIds.push(new Types.ObjectId(id));

  return { id, orderNumber: response.body.data.orderNumber as string };
}

/** Audit rows written about one order. */
async function auditFor(orderId: string) {
  return auditLogs
    .find({ 'entity.type': AuditEntityType.ORDER, 'entity.id': new Types.ObjectId(orderId) })
    .sort({ createdAt: 1 })
    .lean()
    .exec();
}

let admin: Account;
let customer: Account;
let product: Types.ObjectId;

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
  auditLogs = app.get<Model<AuditLog>>(getModelToken(AuditLog.name));
  inventoryEvents = app.get<Model<InventoryEvent>>(getModelToken(InventoryEvent.name));
  idempotencyKeys = app.get<Model<IdempotencyKeyRecord>>(getModelToken(IdempotencyKeyRecord.name));
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));

  admin = await createAccount('operator', Role.ADMIN);
  customer = await createAccount('buyer');

  const category = await app
    .get<Model<Category>>(getModelToken(Category.name))
    .findOne({ slug: 'development-boards' })
    .lean<{ _id: Types.ObjectId; slug: string; name: { en: string }; path: Types.ObjectId[] }>()
    .exec();

  if (category === null) {
    throw new Error('seed category development-boards is missing — run `pnpm --filter api seed`');
  }

  const created = await products.create({
    sku: `AUDIT-${RUN_ID}`,
    slug: `audit-test-${RUN_ID}`,
    name: { en: 'Audit Test Board', ar: null },
    shortDescription: { en: 'Created by the audit test suite.', ar: null },
    description: null,
    category: {
      id: category._id,
      slug: category.slug,
      name: { en: category.name.en, ar: null },
      path: [...category.path, category._id],
    },
    brand: null,
    pricing: { basePrice: 1000, salePrice: null, effectivePrice: 1000, costPrice: 100 },
    currency: 'EGP',
    stock: { onHand: 200, lowStockThreshold: 5 },
    images: [],
    specs: [],
    salesCount: 0,
    isActive: true,
    isFeatured: false,
    deletedAt: null,
    weight: null,
  });

  createdProductIds.push(created._id);
  product = created._id;
}, 120_000);

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await auditLogs.deleteMany({ 'entity.id': { $in: createdOrderIds } }).exec();
    await inventoryEvents.deleteMany({ 'reference.id': { $in: createdOrderIds } }).exec();
    await orders.deleteMany({ _id: { $in: createdOrderIds } }).exec();
  }

  if (createdUserIds.length > 0) {
    await idempotencyKeys.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await carts.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  if (createdProductIds.length > 0) {
    await products.deleteMany({ _id: { $in: createdProductIds } }).exec();
  }

  await app.close();
});

describe('an admin status transition is audited', () => {
  it('writes no audit row until an operator intervenes', async () => {
    /*
     * The half that proves the guarantee can fail. Without it, an
     * implementation that wrote an audit row on every order — or on none, with
     * the assertions below passing against rows some other test wrote — would
     * be indistinguishable from a working one.
     *
     * Customer order placement is explicitly NOT audited (§3, ❌ table:
     * "captured by the order itself + statusHistory"), so a freshly placed
     * order must have nothing.
     */
    const order = await placeOrder();

    expect(await auditFor(order.id)).toEqual([]);
  });

  it('writes one when the operator confirms it', async () => {
    const order = await placeOrder();

    await http()
      .post(`/api/v1/admin/orders/${order.id}/confirm`)
      .set(...bearer(admin))
      .set('User-Agent', USER_AGENT)
      .send({ note: 'Phone confirmed' })
      .expect(200);

    const rows = await auditFor(order.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe(AuditAction.ORDER_STATUS_CHANGED);
  });

  it('records WHO, as a snapshot that survives their deletion', async () => {
    const order = await placeOrder();

    await http()
      .post(`/api/v1/admin/orders/${order.id}/confirm`)
      .set(...bearer(admin))
      .send({})
      .expect(200);

    const [row] = await auditFor(order.id);

    // Snapshotted, not joined: §4 requires the record to stay readable after
    // the actor is deleted or renamed, which is exactly when it is most wanted.
    expect(row?.actor.id.toHexString()).toBe(admin.id.toHexString());
    expect(row?.actor.email).toBe(admin.email);
    expect(row?.actor.name).toBe(admin.fullName);
    expect(row?.actor.role).toBe(Role.ADMIN);
  });

  it('names the order by its NUMBER, so the log reads without joins', async () => {
    const order = await placeOrder();

    await http()
      .post(`/api/v1/admin/orders/${order.id}/confirm`)
      .set(...bearer(admin))
      .send({})
      .expect(200);

    const [row] = await auditFor(order.id);

    expect(row?.entity.type).toBe(AuditEntityType.ORDER);
    expect(row?.entity.label).toBe(order.orderNumber);
  });

  it('records the transition as a before and an after', async () => {
    const order = await placeOrder();

    await http()
      .post(`/api/v1/admin/orders/${order.id}/confirm`)
      .set(...bearer(admin))
      .send({})
      .expect(200);

    const [row] = await auditFor(order.id);

    expect(row?.changes?.before).toEqual({ status: OrderStatus.PLACED });
    expect(row?.changes?.after).toEqual({ status: OrderStatus.CONFIRMED });
  });

  it('captures the user agent — the field whose absence broke legacy audit', async () => {
    /*
     * §4 calls it out by name: `userAgent` is "the exact field whose absence
     * silently broke legacy audit". Legacy wrote a column that did not exist,
     * PostgREST returned the error rather than throwing, and the surrounding
     * try/catch never fired.
     */
    const order = await placeOrder();

    await http()
      .post(`/api/v1/admin/orders/${order.id}/confirm`)
      .set(...bearer(admin))
      .set('User-Agent', USER_AGENT)
      .send({})
      .expect(200);

    const [row] = await auditFor(order.id);

    expect(row?.userAgent).toBe(USER_AGENT);
    expect(row?.requestId).toEqual(expect.any(String));
    expect(row?.requestId).not.toBe('');
  });

  it('correlates with the request through the id the client supplied', async () => {
    const order = await placeOrder();
    const requestId = `audit-${randomUUID()}`;

    await http()
      .post(`/api/v1/admin/orders/${order.id}/confirm`)
      .set(...bearer(admin))
      .set('x-request-id', requestId)
      .send({})
      .expect(200);

    const [row] = await auditFor(order.id);

    // The bridge between an audit entry, the request log line and the error
    // response a client saw.
    expect(row?.requestId).toBe(requestId);
  });

  it('writes one row per intervention, in order', async () => {
    const order = await placeOrder();

    await http().post(`/api/v1/admin/orders/${order.id}/confirm`).set(...bearer(admin)).send({}).expect(200);
    await http()
      .post(`/api/v1/admin/orders/${order.id}/ship`)
      .set(...bearer(admin))
      .send({ carrier: 'Bosta', trackingNumber: 'BST-1' })
      .expect(200);

    const rows = await auditFor(order.id);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.changes?.after)).toEqual([
      { status: OrderStatus.CONFIRMED },
      { status: OrderStatus.SHIPPED },
    ]);
  });

  it('carries the operator’s note as metadata, not as a change', async () => {
    // The note is context for why the action was allowed, which is what §4's
    // `metadata` is for. It is not a field of the order that changed.
    const order = await placeOrder();

    await http()
      .post(`/api/v1/admin/orders/${order.id}/confirm`)
      .set(...bearer(admin))
      .send({ note: 'Customer confirmed by phone' })
      .expect(200);

    const [row] = await auditFor(order.id);

    expect(row?.metadata).toEqual({ note: 'Customer confirmed by phone' });
  });

  it('does not audit a CUSTOMER cancelling their own order', async () => {
    /*
     * §3's ❌ table excludes customer actions on their own data. Auditing every
     * write drowns the signal, and the test the document gives is whether an
     * investigator would ask "who did this" — for a customer cancelling their
     * own order, the order itself already says.
     *
     * The `statusHistory` entry is still written; that is business history and
     * a different question.
     */
    const order = await placeOrder();

    await http()
      .post(`/api/v1/orders/${order.id}/cancel`)
      .set(...bearer(customer))
      .send({ reason: 'Changed my mind' })
      .expect(200);

    expect(await auditFor(order.id)).toEqual([]);
  });
});

describe('the audit trail cannot be written by the principal it audits', () => {
  it('exposes no endpoint that accepts an audit record', async () => {
    /*
     * §5 rule 1: audit is written by the system, never by the acting principal.
     * The legacy defect was that rows were written with the caller's own
     * credentials, so an audited principal could in principle suppress their
     * own trail.
     *
     * There is no route, so this is a 404 rather than a 401 or a 403 — the
     * surface does not exist rather than being guarded.
     */
    await http()
      .post('/api/v1/admin/audit-logs')
      .set(...bearer(admin))
      .send({ action: 'ORDER_STATUS_CHANGED' })
      .expect(404);
  });
});
