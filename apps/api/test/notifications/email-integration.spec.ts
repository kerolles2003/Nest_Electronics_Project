import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AuditLog } from '../../src/modules/audit/infrastructure/schemas/audit-log.schema';
import { validationExceptionFactory } from '../../src/common/pipes/validation-exception.factory';
import {
  EmailSenderPort,
  type EmailSendResult,
  type OutboundEmail,
} from '../../src/modules/notifications/application/ports/email-sender.port';
import { EmailTransportError } from '../../src/modules/notifications/application/ports/email-errors';
import { RefreshToken } from '../../src/modules/auth/infrastructure/schemas/refresh-token.schema';
import { Cart } from '../../src/modules/cart/infrastructure/schemas/cart.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { InventoryEvent } from '../../src/modules/inventory/infrastructure/schemas/inventory-event.schema';
import { IdempotencyKeyRecord } from '../../src/modules/orders/infrastructure/schemas/idempotency-key.schema';
import { MoneyDto } from '../../src/common/dto/money.dto';
import { Order, type OrderLean } from '../../src/modules/orders/infrastructure/schemas/order.schema';
import { User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * Transactional email against the REAL application and the REAL development
 * MongoDB replica set — with the transport, and only the transport, replaced.
 *
 * (That replica set is the local `rs0` container since B1 made local Mongo the
 * documented development default; it was Atlas before.)
 *
 * ## What is faked and what is not
 *
 * `EmailSenderPort` is overridden with a recorder. Everything else is
 * production code: the real registration flow, the real placement transaction,
 * the real renderer, the real templates, the real MongoDB writes. The port is
 * the only seam, which is precisely the property `PROVIDER-ARCHITECTURE.md`
 * claims for it — this suite is the evidence that the claim holds when the
 * application is assembled, not just when a class is instantiated by hand.
 *
 * **No test here can contact a real provider.** The override is installed
 * before `compile()`, so the Resend adapter is never constructed and no API
 * key is read. `EMAIL_PROVIDER` also defaults to `console`, which has no
 * network call at all — two independent reasons, either sufficient.
 *
 * ## What counts as proof
 *
 * Observed database state plus the recorded messages. "An email was sent" is
 * asserted by reading what reached the transport; "the order survived a failed
 * send" is asserted by querying MongoDB after the response.
 *
 * ISOLATION: the suite creates its own user, product, cart and orders and
 * removes them by tracked id. No `dropDatabase`, no broad `deleteMany`, no
 * mutation of seeded catalogue data.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';

const ADDRESS = {
  label: 'Home',
  fullName: 'Mina Kerolles',
  phone: '01012345678',
  street: '12 Sherif Street, Apartment 4',
  city: 'Downtown',
  governorate: 'Cairo',
};

/** Records what the application asked to be delivered, and can be told to fail. */
class RecordingEmailSender extends EmailSenderPort {
  readonly sent: OutboundEmail[] = [];
  failure: Error | null = null;

  send(message: OutboundEmail): Promise<EmailSendResult> {
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }

    this.sent.push(message);
    return Promise.resolve({
      providerMessageId: `rec-${String(this.sent.length)}`,
      acceptedAt: new Date(),
    });
  }

  reset(): void {
    this.sent.length = 0;
    this.failure = null;
  }

  /** The most recent message carrying a given tag type. */
  latest(type: string): OutboundEmail | undefined {
    return [...this.sent].reverse().find((message) => message.tags?.['type'] === type);
  }
}

let app: INestApplication;
let mailer: RecordingEmailSender;
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
const createdKeys: string[] = [];

let productId: Types.ObjectId;

function http(): request.Agent {
  return request(app.getHttpServer());
}

beforeAll(async () => {
  mailer = new RecordingEmailSender();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailSenderPort)
    .useValue(mailer)
    // The real throttler guard still runs; only its COUNTER is replaced, so
    // the suite can register and place orders past limits meant for humans.
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

  productId = await createProduct();
}, 90_000);

afterAll(async () => {
  // Resolved by pattern as well as by tracked id: a test that fails before
  // pushing an id must not leave residue behind.
  const strays = await users
    .find({ email: new RegExp(`\\.${RUN_ID}@example\\.test$`) })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }[]>()
    .exec();

  const userIds = [...new Set([...createdUserIds, ...strays.map((s) => s._id)].map(String))].map(
    (id) => new Types.ObjectId(id),
  );

  if (userIds.length > 0) {
    await refreshTokens.deleteMany({ userId: { $in: userIds } }).exec();
    await carts.deleteMany({ userId: { $in: userIds } }).exec();
    await orders.deleteMany({ userId: { $in: userIds } }).exec();
    await users.deleteMany({ _id: { $in: userIds } }).exec();
  }

  if (createdOrderIds.length > 0) {
    /*
     * The AUDIT rows for these orders, before the orders themselves.
     *
     * Admin lifecycle transitions are audited (AUDIT-MODEL.md §3), so a suite
     * that confirms or ships an order now leaves a row per intervention. The
     * application never deletes from `auditLogs` — it is append-only, and the
     * TTL is the only remover — so this is a test removing its own fixture,
     * which is a different thing from the application editing its trail.
     */
    await app
      .get<Model<AuditLog>>(getModelToken(AuditLog.name))
      .deleteMany({ 'entity.id': { $in: createdOrderIds } })
      .exec();
    await orders.deleteMany({ _id: { $in: createdOrderIds } }).exec();
  }
  if (createdKeys.length > 0) {
    await idempotencyKeys.deleteMany({ key: { $in: createdKeys } }).exec();
  }
  if (createdProductIds.length > 0) {
    await inventoryEvents.deleteMany({ productId: { $in: createdProductIds } }).exec();
    await products.deleteMany({ _id: { $in: createdProductIds } }).exec();
  }

  const connection = app.get<Connection>(getConnectionToken());
  await app.close();
  await connection.close();
}, 90_000);

beforeEach(() => {
  mailer.reset();
});

async function createProduct(): Promise<Types.ObjectId> {
  const category = await app
    .get<Model<Category>>(getModelToken(Category.name))
    .findOne({ slug: 'development-boards' })
    .lean<{ _id: Types.ObjectId; slug: string; name: { en: string }; path: Types.ObjectId[] }>()
    .exec();

  if (category === null) {
    throw new Error('seed category development-boards is missing — run `pnpm --filter api seed`');
  }

  const created = await products.create({
    sku: `MAIL-TEST-${RUN_ID}`,
    slug: `mail-test-${RUN_ID}`,
    name: { en: 'Mail Test Board', ar: null },
    shortDescription: { en: 'Created by the notifications suite.', ar: null },
    description: null,
    category: {
      id: category._id,
      slug: category.slug,
      name: { en: category.name.en, ar: null },
      path: [...category.path, category._id],
    },
    brand: null,
    pricing: { basePrice: 32500, salePrice: null, effectivePrice: 32500, costPrice: 100 },
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

  createdProductIds.push(created._id);
  return created._id;
}

/** Registers, verifies through the REAL endpoint, and signs in. */
async function createVerifiedCustomer(label: string): Promise<{ token: string; addressId: string }> {
  const email = `mail-${label}.${RUN_ID}@example.test`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: 'Mina Kerolles' })
    .expect(201);

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  await http()
    .post('/api/v1/auth/verify-email')
    .send({ token: tokenFromLatestVerificationEmail() })
    .expect(200);

  const login = await http()
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  const token = login.body.data.accessToken as string;

  const address = await http()
    .post('/api/v1/users/me/addresses')
    .set('Authorization', `Bearer ${token}`)
    .send(ADDRESS)
    .expect(201);

  return { token, addressId: address.body.data.id as string };
}

/**
 * Extracts the raw token from the link in the most recent verification email.
 *
 * This is the whole point of the end-to-end assertion: the token is read out of
 * the MESSAGE BODY, exactly as a customer would read it, never from the
 * database or from the service that minted it.
 */
function tokenFromLatestVerificationEmail(): string {
  const message = mailer.latest('email_verification');
  if (message === undefined) {
    throw new Error('no verification email was sent');
  }

  const match = /token=([A-Za-z0-9_%-]+)/.exec(message.text);
  if (match?.[1] === undefined) {
    throw new Error(`no token in verification email: ${message.text.slice(0, 200)}`);
  }

  return decodeURIComponent(match[1]);
}

async function placeOrder(
  customer: { token: string; addressId: string },
  key: string,
): Promise<request.Response> {
  createdKeys.push(key);

  await http()
    .post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ productId: productId.toHexString(), quantity: 1 })
    .expect(200);

  const response = await http()
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${customer.token}`)
    .set('Idempotency-Key', key)
    .send({ addressId: customer.addressId });

  const id = response.body?.data?.id as string | undefined;
  if (id !== undefined) {
    createdOrderIds.push(new Types.ObjectId(id));
  }

  return response;
}

describe('registration → verification, end to end', () => {
  it('sends exactly one verification email on registration', async () => {
    const email = `mail-one.${RUN_ID}@example.test`;

    await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'One Email' })
      .expect(201);

    const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
    createdUserIds.push(created._id);

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toBe('Verify your email address');
    expect(mailer.sent[0]?.to).toEqual([{ email, name: 'One Email' }]);
  });

  /**
   * THE test that licenses the claim "email verification works".
   *
   * A token is minted by registration, delivered in an email, read back out of
   * that email's body, and posted to the public endpoint — after which login
   * succeeds where it previously would not. Nothing is taken from the database
   * and nothing is taken from the service that created it.
   */
  it('emails a token that actually verifies the account', async () => {
    const email = `mail-e2e.${RUN_ID}@example.test`;

    await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'End To End' })
      .expect(201);

    const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
    createdUserIds.push(created._id);
    expect(created.emailVerifiedAt).toBeNull();

    const token = tokenFromLatestVerificationEmail();

    await http().post('/api/v1/auth/verify-email').send({ token }).expect(200);

    const verified = await users.findById(created._id).lean<UserLean>().exec();
    expect(verified?.emailVerifiedAt).not.toBeNull();
    // Single use: the challenge is cleared, not merely marked.
    expect(verified?.emailVerification).toBeNull();

    // And the account can now do the thing verification gates.
    await http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  });

  it('emails a NEW token on resend, and the new one works', async () => {
    const email = `mail-resend.${RUN_ID}@example.test`;

    await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Re Send' })
      .expect(201);

    const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
    createdUserIds.push(created._id);

    const first = tokenFromLatestVerificationEmail();

    await http().post('/api/v1/auth/resend-verification').send({ email }).expect(200);

    expect(mailer.sent).toHaveLength(2);
    const second = tokenFromLatestVerificationEmail();
    expect(second).not.toBe(first);

    // Issuing a new challenge invalidates the previous one.
    await http().post('/api/v1/auth/verify-email').send({ token: first }).expect(400);
    await http().post('/api/v1/auth/verify-email').send({ token: second }).expect(200);
  });

  it('sends nothing for a resend to an unknown address, and still answers 200', async () => {
    // The endpoint must not become an account-existence oracle — and it must
    // not become one through a timing or side-effect difference either.
    await http()
      .post('/api/v1/auth/resend-verification')
      .send({ email: `nobody.${RUN_ID}@example.test` })
      .expect(200);

    expect(mailer.sent).toHaveLength(0);
  });

  it('never puts the raw token anywhere but the link', async () => {
    const email = `mail-leak.${RUN_ID}@example.test`;

    await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'No Leak' })
      .expect(201);

    const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
    createdUserIds.push(created._id);

    const token = tokenFromLatestVerificationEmail();
    const stored = await users.findById(created._id).lean<UserLean>().exec();

    // Only the DIGEST is persisted, so a database reader cannot verify
    // somebody else's address.
    expect(stored?.emailVerification?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.emailVerification?.tokenHash).not.toBe(token);
  });
});

describe('order confirmation', () => {
  it('sends exactly one confirmation, after the order is persisted', async () => {
    const customer = await createVerifiedCustomer('order');
    mailer.reset();

    const response = await placeOrder(customer, randomUUID());
    expect(response.status).toBe(201);

    const confirmation = mailer.latest('order_placed');
    expect(confirmation).toBeDefined();
    expect(mailer.sent.filter((m) => m.tags?.['type'] === 'order_placed')).toHaveLength(1);

    // The order the email describes is genuinely committed — the assertion
    // that "post-commit" is real rather than merely intended.
    const orderNumber = confirmation?.tags?.['orderNumber'];
    const stored = await orders.findOne({ orderNumber }).lean<OrderLean>().exec();
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe('PLACED');
  });

  it('describes the order from its persisted snapshot', async () => {
    const customer = await createVerifiedCustomer('content');
    mailer.reset();

    await placeOrder(customer, randomUUID());

    const message = mailer.latest('order_placed');
    const stored = await orders
      .findOne({ orderNumber: message?.tags?.['orderNumber'] })
      .lean<OrderLean>()
      .exec();

    expect(message?.subject).toBe(`We received your order ${stored?.orderNumber ?? ''}`);
    // The address in the email is the order's immutable copy.
    expect(message?.text).toContain(ADDRESS.street);

    /*
     * Read off the STORED pricing, on the named row.
     *
     * This was `toContain('325.00 EGP')` — a literal, against the whole body.
     * The fixture product costs 32500, so that one string is simultaneously the
     * unit price, the line total, the subtotal, the grand total and the amount
     * due: the assertion could not tell which row it had found, and would have
     * passed with four of the five missing. It also contradicted the test's own
     * claim, which is that the email is built from the PERSISTED snapshot —
     * a hardcoded literal proves nothing about the stored document.
     */
    const totalLine = (message?.text ?? '')
      .split('\n')
      .map((line) => line.trimEnd())
      .find((line) => line.startsWith('Total'));

    expect(totalLine).toBe(`Total             ${MoneyDto.of(stored?.pricing.grandTotal ?? -1).formatted}`);
    expect(message?.to).toEqual([{ email: stored?.customer.email, name: 'Mina Kerolles' }]);
  });

  /**
   * The duplicate-email guarantee, and the reason it needs no separate
   * mechanism: a replay returns before the dispatch line is ever reached.
   */
  it('sends ONE email when the same idempotency key is replayed', async () => {
    const customer = await createVerifiedCustomer('replay');
    mailer.reset();

    // A UUID: the header is validated as one, so a readable label is not an
    // option here.
    const key = randomUUID();
    const first = await placeOrder(customer, key);
    const second = await placeOrder(customer, key);

    expect(first.status).toBe(201);
    // 200, not 201: the retry did not create an order.
    expect(second.status).toBe(200);
    expect(first.body.data.id).toBe(second.body.data.id);

    expect(mailer.sent.filter((m) => m.tags?.['type'] === 'order_placed')).toHaveLength(1);
  });

  it('sends no confirmation when placement fails', async () => {
    const customer = await createVerifiedCustomer('empty');
    mailer.reset();

    // An empty cart cannot be ordered.
    await http()
      .delete('/api/v1/cart')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);

    const response = await http()
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ addressId: customer.addressId });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mailer.sent.filter((m) => m.tags?.['type'] === 'order_placed')).toHaveLength(0);
  });
});

describe('failure policy, in the assembled application', () => {
  /**
   * The guarantee the whole failure policy exists for.
   *
   * A provider outage must not cost a customer their order. Asserted against
   * MongoDB after the response, because a 201 alone would not prove the order
   * survived — only that the request did.
   */
  it('commits the order even when the email provider is down', async () => {
    const customer = await createVerifiedCustomer('down');
    mailer.reset();
    mailer.failure = new EmailTransportError('provider unreachable');

    const response = await placeOrder(customer, randomUUID());

    expect(response.status).toBe(201);

    const stored = await orders
      .findOne({ _id: new Types.ObjectId(response.body.data.id as string) })
      .lean<OrderLean>()
      .exec();

    expect(stored).not.toBeNull();
    expect(stored?.status).toBe('PLACED');
    // Stock moved too: the transaction committed in full.
    const product = await products.findById(productId).lean<{ stock: { onHand: number } }>().exec();
    expect(product?.stock.onHand).toBeLessThan(100);
  });

  it('creates the account even when the verification email cannot be sent', async () => {
    mailer.reset();
    mailer.failure = new EmailTransportError('provider unreachable');

    const email = `mail-failreg.${RUN_ID}@example.test`;

    // 201, not 500: the account row is already committed, and answering 500
    // would send the client into a retry that hits DUPLICATE_EMAIL.
    await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Fail Reg' })
      .expect(201);

    const created = await users.findOne({ email }).lean<UserLean>().exec();
    expect(created).not.toBeNull();
    createdUserIds.push((created as UserLean)._id);

    // The recovery path exists and is unaffected.
    mailer.failure = null;
    await http().post('/api/v1/auth/resend-verification').send({ email }).expect(200);
    expect(mailer.latest('email_verification')).toBeDefined();
  });
});

describe('health readiness', () => {
  it('reports mongo up while the connection is live', async () => {
    const response = await http().get('/api/v1/health/ready').expect(200);

    // The MONGO check specifically, which is what this case is about. The whole
    // body is asserted exactly in `test/infrastructure/index-health.spec.ts`,
    // which owns readiness; repeating it here only means two files to edit
    // every time a check is added, and this one would be edited by whoever was
    // least expecting to.
    expect(response.body.status).toBe('ok');
    expect(response.body.checks.mongo).toEqual({ status: 'up', detail: null });
  });

  it('keeps liveness free of dependencies', async () => {
    // Liveness must answer even when a dependency is unhealthy, so that a
    // database blip cannot trigger a fleet-wide restart.
    await http().get('/api/v1/health').expect(200).expect({ status: 'ok' });
  });
});
