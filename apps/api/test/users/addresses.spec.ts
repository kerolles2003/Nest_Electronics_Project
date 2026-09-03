import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AuditLog } from '../../src/modules/audit/infrastructure/schemas/audit-log.schema';
import { SEED_SHIPPING_RATES } from '../../src/database/seed/shipping.seed-data';
import { EGYPTIAN_GOVERNORATES } from '../../src/common/constants/governorates';
import { validationExceptionFactory } from '../../src/common/pipes/validation-exception.factory';
import { RefreshToken } from '../../src/modules/auth/infrastructure/schemas/refresh-token.schema';
import { Cart } from '../../src/modules/cart/infrastructure/schemas/cart.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { InventoryEvent } from '../../src/modules/inventory/infrastructure/schemas/inventory-event.schema';
import { IdempotencyKeyRecord } from '../../src/modules/orders/infrastructure/schemas/idempotency-key.schema';
import { Order, type OrderLean } from '../../src/modules/orders/infrastructure/schemas/order.schema';
import {
  MAX_ADDRESSES_PER_USER,
  Role,
  User,
  type UserLean,
} from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * The customer address book, its default invariant, and its consumption by
 * checkout — end to end, against the real application and the real
 * development replica set.
 *
 * ISOLATION. The suite creates its OWN users, one product and its own orders,
 * and removes them by tracked id in `afterAll`. There is no `dropDatabase`, no
 * broad `deleteMany({})` and no mutation of the seeded catalogue; the seeded
 * product count is asserted unchanged at the end.
 *
 * WHAT COUNTS AS PROOF. For the invariant, OBSERVED DATABASE STATE read after
 * the requests returned — an HTTP 200 is not evidence that only one address is
 * default. Every invariant assertion below counts `isDefault` in MongoDB itself,
 * not in a response body.
 *
 * The throttler's COUNTER is replaced, not its guard, so the real guard still
 * runs while the suite exceeds limits meant for humans.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const ADDRESSES = '/api/v1/users/me/addresses';

/** How many racers contend in each concurrency case. */
const RACERS = 8;

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

let seededProductCount = 0;
let productId: Types.ObjectId;

function http(): request.Agent {
  return request(app.getHttpServer());
}

interface Customer {
  readonly id: Types.ObjectId;
  readonly token: string;
}

function bearer(customer: Customer): [string, string] {
  return ['Authorization', `Bearer ${customer.token}`];
}

async function createCustomer(label: string, role: Role = Role.CUSTOMER): Promise<Customer> {
  const email = `address-${label}.${RUN_ID}@example.test`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: `Address ${label}` })
    .expect(201);

  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } }).exec();

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  const login = await http()
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  return { id: created._id, token: login.body.data.accessToken as string };
}

interface AddressBody {
  readonly label?: string;
  readonly fullName?: string;
  readonly phone?: string;
  readonly street?: string;
  readonly city?: string;
  readonly governorate?: string;
  readonly postalCode?: string | null;
  readonly isDefault?: boolean;
}

function addressBody(overrides: AddressBody = {}): Record<string, unknown> {
  return {
    label: 'Home',
    fullName: 'Mina Kerolles',
    phone: '01012345678',
    street: '12 Sherif Street, Apartment 4',
    city: 'Downtown',
    governorate: 'Cairo',
    ...overrides,
  };
}

function create(customer: Customer, overrides: AddressBody = {}): request.Test {
  return http().post(ADDRESSES).set(...bearer(customer)).send(addressBody(overrides));
}

/**
 * What the ratified table says Cairo costs — every address fixture here uses
 * Cairo. Read from the seed rather than repeated as a literal, so this suite
 * fails if checkout and the ratified table ever disagree.
 */
const CAIRO_FEE = SEED_SHIPPING_RATES.find((rate) => rate.governorate === 'Cairo')?.fee ?? -1;

/** Creates an address through the real API and returns its id. */
async function createAddress(customer: Customer, overrides: AddressBody = {}): Promise<string> {
  const response = await create(customer, overrides).expect(201);

  return response.body.data.id as string;
}

function list(customer: Customer): request.Test {
  return http().get(ADDRESSES).set(...bearer(customer));
}

/**
 * The address array AS STORED, straight from MongoDB.
 *
 * Every invariant assertion reads this rather than a response body: the question
 * is what the database holds, not what one handler chose to say.
 */
async function storedAddresses(
  customer: Customer,
): Promise<{ _id: Types.ObjectId; label: string; isDefault: boolean; createdAt: Date }[]> {
  const row = await users
    .findById(customer.id)
    .select({ addresses: 1 })
    .lean<{ addresses?: { _id: Types.ObjectId; label: string; isDefault: boolean; createdAt: Date }[] }>()
    .exec();

  return row?.addresses ?? [];
}

/** THE invariant, measured in the database. */
async function defaultCount(customer: Customer): Promise<number> {
  return (await storedAddresses(customer)).filter((address) => address.isDefault).length;
}

async function defaultId(customer: Customer): Promise<string | null> {
  const found = (await storedAddresses(customer)).find((address) => address.isDefault);

  return found?._id.toHexString() ?? null;
}

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
    sku: `ADR-TEST-${RUN_ID}`,
    slug: `adr-test-${RUN_ID}`,
    name: { en: 'Address Suite Board', ar: null },
    shortDescription: { en: 'Created by the address test suite.', ar: null },
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
    stock: { onHand: 500, lowStockThreshold: 5 },
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

/** Places a real order for `addressId`, returning the order response body. */
async function placeOrder(
  customer: Customer,
  addressId: string,
): Promise<Record<string, unknown>> {
  await http()
    .post('/api/v1/cart/items')
    .set(...bearer(customer))
    .send({ productId: productId.toHexString(), quantity: 1 })
    .expect(200);

  const response = await http()
    .post('/api/v1/orders')
    .set(...bearer(customer))
    .set('Idempotency-Key', randomUUID())
    .send({ addressId })
    .expect(201);

  createdOrderIds.push(new Types.ObjectId(response.body.data.id as string));

  return response.body.data as Record<string, unknown>;
}

let alice: Customer;
let bob: Customer;
let admin: Customer;
let superAdmin: Customer;

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

  seededProductCount = await products.countDocuments({ sku: { $not: /^ADR-TEST-/ } }).exec();
  productId = await createProduct();

  alice = await createCustomer('alice');
  bob = await createCustomer('bob');
  admin = await createCustomer('admin', Role.ADMIN);
  superAdmin = await createCustomer('super', Role.SUPER_ADMIN);
}, 300_000);

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await orders.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await idempotencyKeys.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await carts.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }
  if (createdOrderIds.length > 0) {
    await inventoryEvents.deleteMany({ 'reference.id': { $in: createdOrderIds } }).exec();
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
  if (createdProductIds.length > 0) {
    await inventoryEvents.deleteMany({ productId: { $in: createdProductIds } }).exec();
    await products.deleteMany({ _id: { $in: createdProductIds } }).exec();
  }

  // The seeded catalogue must be exactly as it was found.
  expect(await products.countDocuments({ sku: { $not: /^ADR-TEST-/ } }).exec()).toBe(
    seededProductCount,
  );

  const connection = app.get<Connection>(getConnectionToken());
  await app.close();
  await connection.close();
}, 300_000);

// ---------------------------------------------------------------------------

describe('authentication and authorization', () => {
  const ID = '652f1a9b3c4d5e6f7a8b9c0d';

  it.each([
    ['get', ADDRESSES],
    ['post', ADDRESSES],
    ['get', `${ADDRESSES}/${ID}`],
    ['patch', `${ADDRESSES}/${ID}`],
    ['delete', `${ADDRESSES}/${ID}`],
    ['post', `${ADDRESSES}/${ID}/default`],
  ] as const)('%s %s requires a token', async (method, path) => {
    const response = await http()[method](path).send({});

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('serves a CUSTOMER', async () => {
    const response = await list(alice).expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);
  });

  /**
   * The frozen role policy: an address book is a CUSTOMER resource, exactly as
   * a cart and an order history are (AUTHORIZATION-MODEL.md §3). Staff have no
   * `/users/me` address book — customer address management by an admin is a
   * different surface with a different authorization story, and it does not
   * exist.
   */
  it.each([
    ['ADMIN', () => admin],
    ['SUPER_ADMIN', () => superAdmin],
  ])('refuses %s, matching the cart and orders policy', async (_role, principal) => {
    const response = await list(principal()).expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a client-supplied userId rather than honouring it', async () => {
    const response = await http()
      .post(ADDRESSES)
      .set(...bearer(alice))
      .send({ ...addressBody(), userId: bob.id.toHexString() })
      .expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    expect(response.body.error.details[0].field).toBe('userId');
  });

  it('rejects an attempt to write another account by id, on every field spelling', async () => {
    for (const field of ['userId', 'user', 'user_id', 'id', '_id', 'owner']) {
      const response = await http()
        .post(ADDRESSES)
        .set(...bearer(alice))
        .send({ ...addressBody(), [field]: bob.id.toHexString() })
        .expect(400);

      expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    }
  });
});

// ---------------------------------------------------------------------------

describe('CRUD', () => {
  let customer: Customer;

  beforeAll(async () => {
    customer = await createCustomer('crud');
  });

  it('starts empty rather than 404', async () => {
    const response = await list(customer).expect(200);

    expect(response.body.data).toEqual([]);
  });

  it('creates an address and returns exactly the documented keys', async () => {
    const response = await create(customer, { label: 'First', postalCode: '11511' }).expect(201);
    const address = response.body.data;

    expect(Object.keys(address).sort()).toEqual(
      [
        'city',
        'createdAt',
        'fullName',
        'governorate',
        'id',
        'isDefault',
        'label',
        'phone',
        'postalCode',
        'street',
        'updatedAt',
      ].sort(),
    );
    expect(address).toMatchObject({
      label: 'First',
      fullName: 'Mina Kerolles',
      phone: '01012345678',
      street: '12 Sherif Street, Apartment 4',
      city: 'Downtown',
      governorate: 'Cairo',
      postalCode: '11511',
      isDefault: true,
    });
    expect(address.id).toMatch(/^[0-9a-f]{24}$/);
  });

  it('never returns a userId', async () => {
    const response = await list(customer).expect(200);

    expect(JSON.stringify(response.body)).not.toContain(customer.id.toHexString());
  });

  it('reads one address back', async () => {
    const id = await createAddress(customer, { label: 'Readable' });
    const response = await http().get(`${ADDRESSES}/${id}`).set(...bearer(customer)).expect(200);

    expect(response.body.data.id).toBe(id);
    expect(response.body.data.label).toBe('Readable');
  });

  it('patches only the fields sent, and leaves the rest alone', async () => {
    const id = await createAddress(customer, { label: 'Patchable', postalCode: '11511' });

    const response = await http()
      .patch(`${ADDRESSES}/${id}`)
      .set(...bearer(customer))
      .send({ city: 'Heliopolis' })
      .expect(200);

    expect(response.body.data).toMatchObject({
      city: 'Heliopolis',
      label: 'Patchable',
      postalCode: '11511',
      street: '12 Sherif Street, Apartment 4',
    });
  });

  it('clears postalCode with an explicit null, which is different from omitting it', async () => {
    const id = await createAddress(customer, { label: 'Nullable', postalCode: '11511' });

    const untouched = await http()
      .patch(`${ADDRESSES}/${id}`)
      .set(...bearer(customer))
      .send({ label: 'Renamed' })
      .expect(200);
    expect(untouched.body.data.postalCode).toBe('11511');

    const cleared = await http()
      .patch(`${ADDRESSES}/${id}`)
      .set(...bearer(customer))
      .send({ postalCode: null })
      .expect(200);
    expect(cleared.body.data.postalCode).toBeNull();
  });

  it('deletes, and the second delete answers exactly as a stranger id would', async () => {
    const id = await createAddress(customer, { label: 'Doomed' });

    await http().delete(`${ADDRESSES}/${id}`).set(...bearer(customer)).expect(200);

    const again = await http().delete(`${ADDRESSES}/${id}`).set(...bearer(customer)).expect(404);
    expect(again.body.error.code).toBe('ADDRESS_NOT_FOUND');
  });

  it('lists default first, then oldest first', async () => {
    const ordered = await createCustomer('ordered');
    const first = await createAddress(ordered, { label: 'A' });
    await createAddress(ordered, { label: 'B' });
    const third = await createAddress(ordered, { label: 'C' });

    await http().post(`${ADDRESSES}/${third}/default`).set(...bearer(ordered)).expect(200);

    const response = await list(ordered).expect(200);
    const labels = (response.body.data as { label: string }[]).map((a) => a.label);

    expect(labels).toEqual(['C', 'A', 'B']);
    expect(response.body.data[0].id).toBe(third);
    expect(response.body.data[1].id).toBe(first);
  });

  it(`refuses the ${String(MAX_ADDRESSES_PER_USER + 1)}th address`, async () => {
    const hoarder = await createCustomer('hoarder');

    for (let index = 0; index < MAX_ADDRESSES_PER_USER; index += 1) {
      await create(hoarder, { label: `L${String(index)}` }).expect(201);
    }

    const overflow = await create(hoarder, { label: 'overflow' }).expect(422);

    expect(overflow.body.error.code).toBe('ADDRESS_LIMIT_REACHED');
    expect((await storedAddresses(hoarder)).length).toBe(MAX_ADDRESSES_PER_USER);
  });
});

// ---------------------------------------------------------------------------

describe('ownership', () => {
  let aliceAddress: string;

  beforeAll(async () => {
    aliceAddress = await createAddress(alice, { label: 'Alice private' });
  });

  it.each([
    ['read', (id: string) => http().get(`${ADDRESSES}/${id}`).set(...bearer(bob))],
    [
      'update',
      (id: string) =>
        http().patch(`${ADDRESSES}/${id}`).set(...bearer(bob)).send({ label: 'stolen' }),
    ],
    ['delete', (id: string) => http().delete(`${ADDRESSES}/${id}`).set(...bearer(bob))],
    ['make default', (id: string) => http().post(`${ADDRESSES}/${id}/default`).set(...bearer(bob))],
  ])("customer_b cannot %s customer_a's address", async (_action, act) => {
    const response = await act(aliceAddress);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ADDRESS_NOT_FOUND');
  });

  /**
   * THE no-oracle assertion. A foreign address and one that exists nowhere must
   * be indistinguishable in every observable part of the response — status,
   * code, message, and the presence of `details`. If they ever diverge, an
   * address id becomes an existence probe into somebody else's address book.
   */
  it('answers a foreign address and a nonexistent one identically', async () => {
    const foreign = await http().get(`${ADDRESSES}/${aliceAddress}`).set(...bearer(bob));
    const missing = await http()
      .get(`${ADDRESSES}/000000000000000000000000`)
      .set(...bearer(bob));

    expect(foreign.status).toBe(missing.status);
    expect(foreign.body.error.code).toBe(missing.body.error.code);
    expect(foreign.body.error.message).toBe(missing.body.error.message);
    expect(foreign.body.error.details).toEqual(missing.body.error.details);
  });

  it('leaves the foreign address completely untouched after every attempt', async () => {
    const stored = (await storedAddresses(alice)).find((a) => a._id.toHexString() === aliceAddress);

    expect(stored?.label).toBe('Alice private');
  });

  it('never leaks the owner in an error body', async () => {
    const response = await http().get(`${ADDRESSES}/${aliceAddress}`).set(...bearer(bob));
    const body = JSON.stringify(response.body);

    expect(body).not.toContain(alice.id.toHexString());
    expect(body).not.toContain(aliceAddress);
  });
});

// ---------------------------------------------------------------------------

describe('the default-address invariant', () => {
  it('makes the FIRST address default automatically', async () => {
    const customer = await createCustomer('first-default');
    const id = await createAddress(customer, { label: 'Only' });

    expect(await defaultCount(customer)).toBe(1);
    expect(await defaultId(customer)).toBe(id);
  });

  it('does not let a later address silently steal the default', async () => {
    const customer = await createCustomer('no-steal');
    const first = await createAddress(customer, { label: 'First' });
    const second = await createAddress(customer, { label: 'Second' });

    expect(await defaultId(customer)).toBe(first);
    expect(await defaultCount(customer)).toBe(1);

    const stored = await storedAddresses(customer);
    expect(stored.find((a) => a._id.toHexString() === second)?.isDefault).toBe(false);
  });

  it('lets a later address take the default when it explicitly asks', async () => {
    const customer = await createCustomer('explicit-default');
    await createAddress(customer, { label: 'First' });
    const second = await createAddress(customer, { label: 'Second', isDefault: true });

    expect(await defaultId(customer)).toBe(second);
    expect(await defaultCount(customer)).toBe(1);
  });

  it('switches the default atomically, leaving exactly one', async () => {
    const customer = await createCustomer('switch');
    const first = await createAddress(customer, { label: 'First' });
    const second = await createAddress(customer, { label: 'Second' });

    const response = await http()
      .post(`${ADDRESSES}/${second}/default`)
      .set(...bearer(customer))
      .expect(200);

    expect(await defaultId(customer)).toBe(second);
    expect(await defaultCount(customer)).toBe(1);

    // The response carries the WHOLE book, because a sibling changed.
    const flags = (response.body.data as { id: string; isDefault: boolean }[]).map((a) => [
      a.id,
      a.isDefault,
    ]);
    expect(flags).toEqual(
      expect.arrayContaining([
        [second, true],
        [first, false],
      ]),
    );
  });

  it('is a no-op when the address is already default', async () => {
    const customer = await createCustomer('already-default');
    const only = await createAddress(customer, { label: 'Only' });

    await http().post(`${ADDRESSES}/${only}/default`).set(...bearer(customer)).expect(200);

    expect(await defaultCount(customer)).toBe(1);
    expect(await defaultId(customer)).toBe(only);
  });

  it('deleting a NON-default moves nothing', async () => {
    const customer = await createCustomer('delete-other');
    const keep = await createAddress(customer, { label: 'Keep' });
    const drop = await createAddress(customer, { label: 'Drop' });

    await http().delete(`${ADDRESSES}/${drop}`).set(...bearer(customer)).expect(200);

    expect(await defaultId(customer)).toBe(keep);
    expect(await defaultCount(customer)).toBe(1);
  });

  /**
   * The documented deterministic rule: oldest surviving `createdAt`, `_id`
   * ascending as the tie-break. NOT Mongo natural order — which, for an
   * embedded array, would have promoted the element that happens to sit first
   * in the document.
   */
  it('deleting the default promotes the OLDEST survivor, deterministically', async () => {
    const customer = await createCustomer('delete-default');
    const oldest = await createAddress(customer, { label: 'Oldest' });
    const middle = await createAddress(customer, { label: 'Middle' });
    const newest = await createAddress(customer, { label: 'Newest' });

    // Make the NEWEST the default, so the promotion cannot accidentally be
    // "the one that was already there".
    await http().post(`${ADDRESSES}/${newest}/default`).set(...bearer(customer)).expect(200);
    expect(await defaultId(customer)).toBe(newest);

    const response = await http()
      .delete(`${ADDRESSES}/${newest}`)
      .set(...bearer(customer))
      .expect(200);

    expect(await defaultId(customer)).toBe(oldest);
    expect(await defaultCount(customer)).toBe(1);

    // The response carries the remaining book, so the client learns the default
    // moved without a second request.
    const returned = response.body.data as { id: string; isDefault: boolean }[];
    expect(returned.map((a) => a.id).sort()).toEqual([oldest, middle].sort());
    expect(returned.find((a) => a.id === oldest)?.isDefault).toBe(true);
  });

  it('leaves no default when the last address is deleted', async () => {
    const customer = await createCustomer('delete-last');
    const only = await createAddress(customer, { label: 'Only' });

    const response = await http()
      .delete(`${ADDRESSES}/${only}`)
      .set(...bearer(customer))
      .expect(200);

    expect(response.body.data).toEqual([]);
    expect(await storedAddresses(customer)).toEqual([]);
    expect(await defaultCount(customer)).toBe(0);
  });

  /**
   * SELF-HEALING. Every write recomputes the flag across the whole array, so a
   * document that somehow holds two defaults — a legacy import, a hand edit, a
   * bug in code that does not exist yet — converges to one on the next write
   * rather than staying broken. This corrupts the array directly, bypassing the
   * API, to prove it.
   */
  it('repairs an array that already holds two defaults', async () => {
    const customer = await createCustomer('corrupted');
    const first = await createAddress(customer, { label: 'First' });
    const second = await createAddress(customer, { label: 'Second' });

    await users
      .updateOne({ _id: customer.id }, { $set: { 'addresses.$[].isDefault': true } })
      .exec();
    expect(await defaultCount(customer)).toBe(2);

    await http()
      .patch(`${ADDRESSES}/${second}`)
      .set(...bearer(customer))
      .send({ label: 'Touched' })
      .expect(200);

    expect(await defaultCount(customer)).toBe(1);
    expect(await defaultId(customer)).toBe(first);
  });
});

// ---------------------------------------------------------------------------

describe('the governorate is a closed list (D-8 precondition)', () => {
  /*
   * Why this is a security-shaped rule and not a tidy-input rule.
   *
   * D-8 seeds `shippingRates` with one row per governorate and NO fallback
   * row, so a lookup miss must raise rather than invent a fee. That is only
   * safe if a miss cannot happen, and a miss cannot happen only if every
   * stored governorate is one the table knows. A value accepted here is a
   * value that reaches a rate lookup later, at checkout, with an order
   * half-placed.
   *
   * The storefront dropdown is a suggestion. This is the guarantee.
   */
  /*
   * ONE account for the whole block.
   *
   * `createCustomer` derives the email from its label, so calling it per case
   * would collide on 409, and creating seven accounts would also walk into the
   * 3-per-hour registration limit these suites deliberately leave in place.
   */
  let govCustomer: Customer;

  beforeAll(async () => {
    govCustomer = await createCustomer('gov');
  });

  /*
   * Walked by UPDATE rather than by creating 27 addresses.
   *
   * `MAX_ADDRESSES_PER_USER` is 10, so creating one per governorate hits a
   * real business rule (422) that has nothing to do with what is under test.
   * Patching one address through all 27 values exercises the same `@IsIn` on
   * the same closed list while only ever holding a single address.
   */
  it('accepts every one of the 27 governorates', async () => {
    const id = await createAddress(govCustomer, {
      label: 'all-governorates',
      governorate: 'Cairo',
    });

    for (const governorate of EGYPTIAN_GOVERNORATES) {
      const response = await http()
        .patch(`${ADDRESSES}/${id}`)
        .set(...bearer(govCustomer))
        .send({ governorate })
        .expect(200);

      expect(response.body.data.governorate).toBe(governorate);
    }
  });

  it.each([
    ['unknown governorate', 'Atlantis'],
    ['wrong case', 'cairo'],
    ['trailing space inside the value', 'Cai ro'],
    ['transliteration variant', 'Kairo'],
    ['empty', ''],
    ['a $-prefixed field path', '$role'],
    ['a mongo operator', '$ne'],
  ])('refuses %s', async (_label, governorate) => {
    const response = await create(govCustomer, { governorate }).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(
      response.body.error.details.some(
        (d: { field: string }) => d.field === 'governorate',
      ),
    ).toBe(true);
  });

  it('refuses an unknown governorate on UPDATE too, not just on create', async () => {
    // An update path that accepted free text would reopen the hole the create
    // path closes: an address could be edited into an unquotable state after
    // it had already been accepted.
    const created = await create(govCustomer, {
      label: 'patch-target',
      governorate: 'Cairo',
    }).expect(201);

    await http()
      .patch(`${ADDRESSES}/${created.body.data.id}`)
      .set(...bearer(govCustomer))
      .send({ governorate: 'Atlantis' })
      .expect(400);
  });

  it('still trims surrounding whitespace before matching', async () => {
    // `@Transform(trim)` runs before `@IsIn`, so a value a user pasted with a
    // stray space is accepted rather than being an unexplained rejection.
    const response = await create(govCustomer, {
      label: 'trim-target',
      governorate: '  Giza  ',
    }).expect(201);

    expect(response.body.data.governorate).toBe('Giza');
  });
});

describe('validation', () => {
  it('rejects a malformed addressId with 400, not 404 and not 500', async () => {
    const response = await http()
      .get(`${ADDRESSES}/not-an-object-id`)
      .set(...bearer(alice))
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].field).toBe('addressId');
  });

  it.each(['label', 'fullName', 'phone', 'street', 'city', 'governorate'])(
    'rejects a body missing %s',
    async (field) => {
      const body = addressBody() as Record<string, unknown>;
      delete body[field];

      const response = await http().post(ADDRESSES).set(...bearer(alice)).send(body).expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(
        (response.body.error.details as { field: string }[]).some((d) => d.field === field),
      ).toBe(true);
    },
  );

  it.each([
    ['label too long', { label: 'x'.repeat(41) }],
    ['fullName too short', { fullName: 'x' }],
    ['fullName too long', { fullName: 'x'.repeat(121) }],
    ['street too short', { street: 'abc' }],
    ['street too long', { street: 'x'.repeat(201) }],
    ['city too short', { city: 'x' }],
    ['governorate too long', { governorate: 'x'.repeat(81) }],
    ['postalCode too long', { postalCode: 'x'.repeat(21) }],
  ])('rejects %s', async (_case, overrides) => {
    const response = await create(alice, overrides).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each(['0101234567', '01312345678', '+1234567890', 'not a phone', '011234567890'])(
    'rejects the non-Egyptian phone %s',
    async (phone) => {
      const response = await create(alice, { phone }).expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  /**
   * The label must be derived from the WHOLE number, not its last four digits:
   * `01012345678`, `+201012345678`, `201112345678` and `01512345678` all end in
   * `5678`, so a four-digit label gives four of these cases the same email and
   * every one after the first is refused `409 DUPLICATE_EMAIL` — a harness
   * collision that would look exactly like a rejected phone format.
   */
  it.each(['01012345678', '+201012345678', '201112345678', '01298765432', '01512345678'])(
    'accepts the Egyptian phone %s',
    async (phone) => {
      const customer = await createCustomer(`phone-${phone.replace(/\D/g, '')}`);

      await create(customer, { phone }).expect(201);
    },
  );

  it('rejects an unknown field rather than ignoring it', async () => {
    const response = await http()
      .post(ADDRESSES)
      .set(...bearer(alice))
      .send({ ...addressBody(), country: 'Egypt' })
      .expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('refuses isDefault on PATCH, which has a dedicated endpoint', async () => {
    const id = await createAddress(alice, { label: 'No default here' });

    const response = await http()
      .patch(`${ADDRESSES}/${id}`)
      .set(...bearer(alice))
      .send({ isDefault: true })
      .expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    expect(response.body.error.details[0].field).toBe('isDefault');
  });

  it('trims surrounding whitespace rather than storing it', async () => {
    const customer = await createCustomer('trim');
    const response = await create(customer, {
      label: '  Home  ',
      city: '  Downtown  ',
    }).expect(201);

    expect(response.body.data.label).toBe('Home');
    expect(response.body.data.city).toBe('Downtown');
  });

  it('returns postalCode as null rather than omitting the key', async () => {
    const customer = await createCustomer('null-postal');
    const response = await create(customer).expect(201);

    expect(response.body.data).toHaveProperty('postalCode');
    expect(response.body.data.postalCode).toBeNull();
  });

  /**
   * "Null, never an empty string" is declared on the SCHEMA, so it has to hold
   * in the database and not merely in the response. `postalCode` is the one
   * address field with no minimum length, so it is the one field where a
   * whitespace-only body would otherwise satisfy every validator and store a
   * second spelling of "absent" — which would then be copied into an order
   * snapshot that can never be corrected.
   */
  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('stores %s postalCode as null, in the database', async (_case, postalCode) => {
    const customer = await createCustomer(`postal-empty-${String(postalCode.length)}`);
    const response = await create(customer, { postalCode }).expect(201);

    expect(response.body.data.postalCode).toBeNull();

    const stored = await users
      .findOne({
        _id: customer.id,
        'addresses._id': new Types.ObjectId(response.body.data.id as string),
      })
      .select({ 'addresses.$': 1 })
      .lean<{ addresses: { postalCode: string | null }[] }>()
      .exec();
    const saved = (stored?.addresses ?? [])[0];

    expect(saved).toBeDefined();
    expect(saved?.postalCode).toBeNull();
  });

  it('clears postalCode when PATCHed with an empty string, exactly as null does', async () => {
    const customer = await createCustomer('postal-clear');
    const id = await createAddress(customer, { postalCode: '11511' });

    const cleared = await http()
      .patch(`${ADDRESSES}/${id}`)
      .set(...bearer(customer))
      .send({ postalCode: '  ' })
      .expect(200);

    expect(cleared.body.data.postalCode).toBeNull();

    const stored = await users
      .findOne({ _id: customer.id, 'addresses._id': new Types.ObjectId(id) })
      .select({ 'addresses.$': 1 })
      .lean<{ addresses: { postalCode: string | null }[] }>()
      .exec();
    const saved = (stored?.addresses ?? [])[0];

    expect(saved).toBeDefined();
    expect(saved?.postalCode).toBeNull();
  });

  /**
   * EXPRESSION INJECTION. Every address write is an aggregation-pipeline update,
   * where a string beginning with `$` is a FIELD PATH. Without `$literal`, a
   * street of `"$passwordHash"` would be stored as the VALUE of that field —
   * writing a bcrypt hash into a document the owner can read back.
   */
  it('stores a $-prefixed value literally instead of resolving it as a field path', async () => {
    const customer = await createCustomer('injection');

    /*
     * `governorate` no longer carries a `$` value here, because it is now a
     * CLOSED list and `$role` is refused before it can reach Mongo at all.
     *
     * That is a stronger guarantee than this test was making for that field,
     * not a weaker one — the coverage moves to `refuses a $-prefixed
     * governorate outright` below. The four genuinely free-text fields still
     * carry the injection payloads, which is what this test is for.
     */
    const response = await create(customer, {
      label: '$passwordHash',
      fullName: '$$ROOT',
      street: '$passwordHash and $email',
      city: '$$CURRENT.email',
      governorate: 'Cairo',
    }).expect(201);

    expect(response.body.data.label).toBe('$passwordHash');
    expect(response.body.data.fullName).toBe('$$ROOT');
    expect(response.body.data.street).toBe('$passwordHash and $email');
    expect(response.body.data.city).toBe('$$CURRENT.email');

    // And nothing from the credential fields reached the document.
    const raw = JSON.stringify(await storedAddresses(customer));
    expect(raw).not.toContain('$2b$');
    expect(raw).not.toContain('@example.test');
  });

  it('stores a $-prefixed value literally on PATCH too', async () => {
    const customer = await createCustomer('injection-patch');
    const id = await createAddress(customer);

    const response = await http()
      .patch(`${ADDRESSES}/${id}`)
      .set(...bearer(customer))
      .send({ street: '$passwordHash', city: '$tokenVersion' })
      .expect(200);

    expect(response.body.data.street).toBe('$passwordHash');
    expect(response.body.data.city).toBe('$tokenVersion');
    expect(JSON.stringify(await storedAddresses(customer))).not.toContain('$2b$');
  });
});

// ---------------------------------------------------------------------------

describe('concurrency', () => {
  /**
   * Concurrent FIRST-address creation. Each request would, read in isolation,
   * see an empty book and conclude "I am the first, so I am the default". They
   * cannot both be right, and no application-level check could stop them — the
   * guarantee is that each write is one atomic pipeline against one document,
   * so the second is evaluated against the array the first already wrote.
   */
  it('never produces two defaults under concurrent first-address creation', async () => {
    const customer = await createCustomer('race-create');

    const responses = await Promise.all(
      Array.from({ length: RACERS }, (_value, index) =>
        create(customer, { label: `Racer ${String(index)}` }),
      ),
    );

    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect((await storedAddresses(customer)).length).toBe(RACERS);
    expect(await defaultCount(customer)).toBe(1);
  });

  it('never exceeds the cap under concurrent creation', async () => {
    const customer = await createCustomer('race-cap');

    // Fill to one below the cap, then race for the last two slots.
    for (let index = 0; index < MAX_ADDRESSES_PER_USER - 1; index += 1) {
      await create(customer, { label: `Filler ${String(index)}` }).expect(201);
    }

    const responses = await Promise.all(
      Array.from({ length: RACERS }, (_value, index) =>
        create(customer, { label: `Contender ${String(index)}` }),
      ),
    );

    const created = responses.filter((response) => response.status === 201).length;
    const refused = responses.filter((response) => response.status === 422).length;

    expect(created).toBe(1);
    expect(refused).toBe(RACERS - 1);
    expect((await storedAddresses(customer)).length).toBe(MAX_ADDRESSES_PER_USER);
    expect(await defaultCount(customer)).toBe(1);
  });

  /**
   * Concurrent default changes, each naming a DIFFERENT address. Whichever
   * lands last wins; what must never happen is two winners, or none.
   */
  it('never produces two defaults under concurrent default changes', async () => {
    const customer = await createCustomer('race-default');
    const ids: string[] = [];

    for (let index = 0; index < RACERS; index += 1) {
      ids.push(await createAddress(customer, { label: `Candidate ${String(index)}` }));
    }

    const responses = await Promise.all(
      ids.map((id) => http().post(`${ADDRESSES}/${id}/default`).set(...bearer(customer))),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(await defaultCount(customer)).toBe(1);
    expect(ids).toContain(await defaultId(customer));
  });

  it('survives repeated rounds of concurrent default changes', async () => {
    const customer = await createCustomer('race-default-rounds');
    const ids: string[] = [];

    for (let index = 0; index < 4; index += 1) {
      ids.push(await createAddress(customer, { label: `Round ${String(index)}` }));
    }

    for (let round = 0; round < 5; round += 1) {
      await Promise.all(
        ids.map((id) => http().post(`${ADDRESSES}/${id}/default`).set(...bearer(customer))),
      );

      expect(await defaultCount(customer)).toBe(1);
    }
  });

  /**
   * Delete racing set-default. Four outcomes are legitimate depending on which
   * landed first — including the deleted address answering 404 — and exactly one
   * outcome is not: an array left with two defaults, or with none while
   * addresses remain.
   */
  it('preserves the invariant when a delete races a default change', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const customer = await createCustomer(`race-delete-${String(attempt)}`);
      const current = await createAddress(customer, { label: 'Current default' });
      const challenger = await createAddress(customer, { label: 'Challenger' });
      const spare = await createAddress(customer, { label: 'Spare' });

      const [deleted, promoted] = await Promise.all([
        http().delete(`${ADDRESSES}/${current}`).set(...bearer(customer)),
        http().post(`${ADDRESSES}/${challenger}/default`).set(...bearer(customer)),
      ]);

      expect(deleted.status).toBe(200);
      expect([200, 404]).toContain(promoted.status);

      const stored = await storedAddresses(customer);
      expect(stored.map((a) => a._id.toHexString()).sort()).toEqual([challenger, spare].sort());
      expect(await defaultCount(customer)).toBe(1);
    }
  });

  it('preserves the invariant when the default is deleted while another is created', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const customer = await createCustomer(`race-delete-create-${String(attempt)}`);
      const current = await createAddress(customer, { label: 'Current default' });
      await createAddress(customer, { label: 'Spare' });

      const [deleted, created] = await Promise.all([
        http().delete(`${ADDRESSES}/${current}`).set(...bearer(customer)),
        create(customer, { label: 'Newcomer' }),
      ]);

      expect(deleted.status).toBe(200);
      expect(created.status).toBe(201);
      expect((await storedAddresses(customer)).length).toBe(2);
      expect(await defaultCount(customer)).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------

describe('index usage', () => {
  /**
   * ZERO indexes were added for this domain, and that is the finding rather
   * than an omission. Every address query narrows to ONE user document by `_id`
   * first; the embedded array is then scanned inside a document already in
   * memory, where no index could help. MONGODB-DESIGN.md §13 lists
   * `addresses(user_id)` among the indexes deliberately NOT reproduced,
   * precisely because embedding removes the need for it.
   */
  it('adds no index to the users collection', async () => {
    const indexes = await users.listIndexes();
    const names = indexes.map((index) => index.name as string).sort();

    expect(names).toEqual(['_id_', 'user_email_unique']);
  });

  /** Walks an explain plan and collects every stage and index it touches. */
  function planStages(plan: unknown, stages: string[] = [], indexes: string[] = []): {
    stages: string[];
    indexes: string[];
  } {
    if (plan !== null && typeof plan === 'object') {
      const node = plan as Record<string, unknown>;

      if (typeof node.stage === 'string') {
        stages.push(node.stage);
      }
      if (typeof node.indexName === 'string') {
        indexes.push(node.indexName);
      }
      for (const value of Object.values(node)) {
        planStages(value, stages, indexes);
      }
    }

    return { stages, indexes };
  }

  it('serves the address-book read from the _id index, never a collection scan', async () => {
    const explained = (await users
      .findOne({ _id: alice.id, deletedAt: null })
      .select({ addresses: 1 })
      .explain('executionStats')) as unknown;

    const { stages, indexes } = planStages(explained);

    expect(stages).not.toContain('COLLSCAN');
    expect(
      indexes.includes('_id_') || stages.some((stage) => stage.startsWith('EXPRESS_')),
    ).toBe(true);
  });

  it('serves the single-address read from the _id index, never a collection scan', async () => {
    const id = await createAddress(alice, { label: 'Explained' });

    const explained = (await users
      .findOne({ _id: alice.id, deletedAt: null, 'addresses._id': new Types.ObjectId(id) })
      .select({ 'addresses.$': 1 })
      .explain('executionStats')) as unknown;

    const { stages, indexes } = planStages(explained);

    expect(stages).not.toContain('COLLSCAN');
    expect(
      indexes.includes('_id_') || stages.some((stage) => stage.startsWith('EXPRESS_')),
    ).toBe(true);

    // One document examined: the owner's. Ownership is not a filter applied
    // after a broad read — it IS the access path.
    const stats = (explained as { executionStats?: { totalDocsExamined?: number } }).executionStats;
    expect(stats?.totalDocsExamined).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------

describe('checkout integration', () => {
  it('places an order against an owned address and snapshots it', async () => {
    const customer = await createCustomer('checkout-owner');
    const id = await createAddress(customer, {
      label: 'Delivery',
      fullName: 'Nadia Kerolles',
      street: '3 Nile Corniche',
      city: 'Zamalek',
      governorate: 'Giza',
      postalCode: '11511',
    });

    const order = await placeOrder(customer, id);

    expect(order.shippingAddress).toEqual({
      fullName: 'Nadia Kerolles',
      phone: '01012345678',
      street: '3 Nile Corniche',
      city: 'Zamalek',
      governorate: 'Giza',
      postalCode: '11511',
    });
  });

  it('never stores an addressId on the order — the snapshot is the whole record', async () => {
    const customer = await createCustomer('checkout-no-ref');
    const id = await createAddress(customer);
    const order = await placeOrder(customer, id);

    expect(order).not.toHaveProperty('addressId');
    expect(order.shippingAddress).not.toHaveProperty('id');
    expect(order.shippingAddress).not.toHaveProperty('label');

    const stored = await orders
      .findById(new Types.ObjectId(order.id as string))
      .lean<OrderLean>()
      .exec();

    expect(JSON.stringify(stored)).not.toContain(id);
  });

  it("refuses another customer's addressId, with the same answer as an unknown one", async () => {
    const owner = await createCustomer('checkout-victim');
    const attacker = await createCustomer('checkout-attacker');
    const victimAddress = await createAddress(owner, { label: 'Victim' });
    await createAddress(attacker, { label: 'Attacker own' });

    await http()
      .post('/api/v1/cart/items')
      .set(...bearer(attacker))
      .send({ productId: productId.toHexString(), quantity: 1 })
      .expect(200);

    const foreign = await http()
      .post('/api/v1/orders')
      .set(...bearer(attacker))
      .set('Idempotency-Key', randomUUID())
      .send({ addressId: victimAddress });

    const missing = await http()
      .post('/api/v1/orders')
      .set(...bearer(attacker))
      .set('Idempotency-Key', randomUUID())
      .send({ addressId: '000000000000000000000000' });

    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('ADDRESS_NOT_FOUND');
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body.error.code).toBe(missing.body.error.code);
    expect(foreign.body.error.message).toBe(missing.body.error.message);

    // No order, and the cart is untouched — the transaction rolled back whole.
    expect(await orders.countDocuments({ userId: attacker.id }).exec()).toBe(0);
    const cart = await carts.findOne({ userId: attacker.id }).lean<{ items: unknown[] }>().exec();
    expect(cart?.items.length).toBe(1);
  });

  it('requires addressId', async () => {
    const customer = await createCustomer('checkout-no-address');

    const response = await http()
      .post('/api/v1/orders')
      .set(...bearer(customer))
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(
      (response.body.error.details as { field: string }[]).some((d) => d.field === 'addressId'),
    ).toBe(true);
  });

  /**
   * The whole point of the phase, on the wire: a client can no longer describe
   * a delivery address at all. The fields to do so do not exist, so checkout
   * cannot be made to ship to an address nobody owns.
   */
  it('refuses an inline shipping address, with or without an addressId', async () => {
    const customer = await createCustomer('checkout-inline');
    const id = await createAddress(customer);

    const withBoth = await http()
      .post('/api/v1/orders')
      .set(...bearer(customer))
      .set('Idempotency-Key', randomUUID())
      .send({
        addressId: id,
        shippingAddress: {
          fullName: 'Someone Else',
          phone: '01012345678',
          street: 'Anywhere',
          city: 'Anywhere',
          governorate: 'Anywhere',
        },
      })
      .expect(400);

    expect(withBoth.body.error.code).toBe('UNKNOWN_FIELD');
    expect(withBoth.body.error.details[0].field).toBe('shippingAddress');

    const alone = await http()
      .post('/api/v1/orders')
      .set(...bearer(customer))
      .set('Idempotency-Key', randomUUID())
      .send({ shippingAddress: { fullName: 'Someone Else' } })
      .expect(400);

    expect(alone.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('refuses a client-supplied shippingFee, total or currency', async () => {
    const customer = await createCustomer('checkout-money');
    const id = await createAddress(customer);

    for (const injected of [
      { shippingFee: 0 },
      { pricing: { shippingFee: 0 } },
      { grandTotal: 1 },
      { currency: 'USD' },
      { userId: bob.id.toHexString() },
    ]) {
      const response = await http()
        .post('/api/v1/orders')
        .set(...bearer(customer))
        .set('Idempotency-Key', randomUUID())
        .send({ addressId: id, ...injected })
        .expect(400);

      expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    }
  });

  it('quotes shipping against an owned address, and refuses a foreign one', async () => {
    const customer = await createCustomer('quote-address');
    const id = await createAddress(customer);
    const foreign = await createAddress(alice, { label: 'Alice quote' });

    const quoted = await http()
      .post('/api/v1/checkout/quote')
      .set(...bearer(customer))
      .send({ addressId: id })
      .expect(200);

    /*
     * A REAL fee, because the address names a governorate the rate table
     * prices. This asserted `0` while OPEN-001 recorded the rates as
     * unsupplied business input; D-8 supplied them.
     *
     * The figure is derived from the seed rather than written as `5000`. Two
     * literals can be wrong in the same direction and agree with each other;
     * deriving it means this fails if what checkout charges ever stops matching
     * the ratified table.
     */
    expect(quoted.body.data.pricing.shippingFee.amount).toBe(CAIRO_FEE);
    expect(quoted.body.data.pricing.shippingPriced).toBe(true);
    expect(quoted.body.data.pricing.grandTotal.amount).toBe(
      quoted.body.data.pricing.itemsSubtotal.amount -
        quoted.body.data.pricing.discountTotal.amount +
        quoted.body.data.pricing.shippingFee.amount,
    );

    const refused = await http()
      .post('/api/v1/checkout/quote')
      .set(...bearer(customer))
      .send({ addressId: foreign })
      .expect(404);

    expect(refused.body.error.code).toBe('ADDRESS_NOT_FOUND');
  });

  it('still quotes without an address, and says the fee is not priced', async () => {
    /*
     * The distinction the whole `{ fee, priced }` shape exists for, at the HTTP
     * boundary and against real rates.
     *
     * No address means no governorate means nothing to look up. That is
     * unpriced — NOT free, and not a missing rate. A missing rate raises; this
     * is an ordinary step of checkout, and answering 500 here would break the
     * page a customer sees before they pick an address.
     */
    const customer = await createCustomer('quote-no-address');

    const quoted = await http()
      .post('/api/v1/checkout/quote')
      .set(...bearer(customer))
      .send({})
      .expect(200);

    expect(quoted.body.data.pricing.shippingFee.amount).toBe(0);
    expect(quoted.body.data.pricing.shippingPriced).toBe(false);
  });

  it('refuses a raw governorate on the quote', async () => {
    const response = await http()
      .post('/api/v1/checkout/quote')
      .set(...bearer(alice))
      .send({ governorate: 'Cairo' })
      .expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('asserts the order pricing identity server-side', async () => {
    const customer = await createCustomer('checkout-pricing');
    const id = await createAddress(customer);
    const order = await placeOrder(customer, id);
    const pricing = order.pricing as {
      itemsSubtotal: { amount: number };
      discountTotal: { amount: number };
      shippingFee: { amount: number };
      grandTotal: { amount: number };
    };

    expect(pricing.grandTotal.amount).toBe(
      pricing.itemsSubtotal.amount - pricing.discountTotal.amount + pricing.shippingFee.amount,
    );

    // A non-zero shipping fee makes the identity above worth asserting. While
    // the fee was always 0 the equation held whether or not the code added it.
    expect(pricing.shippingFee.amount).toBe(CAIRO_FEE);
    expect(CAIRO_FEE).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('snapshot durability', () => {
  /**
   * THE strongest assertion in the phase. The order's address must be BYTE
   * IDENTICAL after the source address is substantially rewritten and then
   * deleted outright — not merely "still present", not "mostly the same".
   *
   * If this ever fails, an invoice can be rewritten years after the fact by a
   * customer editing their address book, which is the exact failure mode the
   * snapshot exists to make impossible.
   */
  it('is untouched by an edit, a default change and a deletion of its source', async () => {
    const customer = await createCustomer('durability');
    const id = await createAddress(customer, {
      label: 'Original',
      fullName: 'Original Recipient',
      phone: '01012345678',
      street: '1 Original Street',
      city: 'Original City',
      governorate: 'Cairo',
      postalCode: '11511',
    });
    const other = await createAddress(customer, { label: 'Other' });

    const placed = await placeOrder(customer, id);
    const orderId = placed.id as string;
    const detail = `/api/v1/orders/${orderId}`;

    const before = await http().get(detail).set(...bearer(customer)).expect(200);
    const snapshot = before.body.data.shippingAddress;

    expect(snapshot).toEqual({
      fullName: 'Original Recipient',
      phone: '01012345678',
      street: '1 Original Street',
      city: 'Original City',
      governorate: 'Cairo',
      postalCode: '11511',
    });

    // 1. Rewrite EVERY field of the source address.
    await http()
      .patch(`${ADDRESSES}/${id}`)
      .set(...bearer(customer))
      .send({
        label: 'Rewritten',
        fullName: 'Completely Different Person',
        phone: '01298765432',
        street: '999 Somewhere Else Entirely',
        city: 'Alexandria',
        governorate: 'Alexandria',
        postalCode: '21500',
      })
      .expect(200);

    const afterEdit = await http().get(detail).set(...bearer(customer)).expect(200);
    expect(afterEdit.body.data.shippingAddress).toEqual(snapshot);

    // 2. Move the default elsewhere.
    await http().post(`${ADDRESSES}/${other}/default`).set(...bearer(customer)).expect(200);

    const afterDefault = await http().get(detail).set(...bearer(customer)).expect(200);
    expect(afterDefault.body.data.shippingAddress).toEqual(snapshot);

    // 3. Delete the source address outright.
    await http().delete(`${ADDRESSES}/${id}`).set(...bearer(customer)).expect(200);
    await http().get(`${ADDRESSES}/${id}`).set(...bearer(customer)).expect(404);

    const afterDelete = await http().get(detail).set(...bearer(customer)).expect(200);

    // Byte-identical, and the ORDER as a whole is still fully renderable.
    expect(afterDelete.body.data.shippingAddress).toEqual(snapshot);
    expect(JSON.stringify(afterDelete.body.data)).toBe(JSON.stringify(before.body.data));
    expect(afterDelete.body.data.items.length).toBeGreaterThan(0);
    expect(afterDelete.body.data.pricing.grandTotal.amount).toBeGreaterThan(0);
  });

  it('survives in the history list as well as the detail', async () => {
    const customer = await createCustomer('durability-list');
    const id = await createAddress(customer);
    const placed = await placeOrder(customer, id);

    await http().delete(`${ADDRESSES}/${id}`).set(...bearer(customer)).expect(200);

    const history = await http().get('/api/v1/orders').set(...bearer(customer)).expect(200);
    const row = (history.body.data as { id: string }[]).find((o) => o.id === placed.id);

    expect(row).toBeDefined();
  });

  it('leaves the order document itself unmodified in the database', async () => {
    const customer = await createCustomer('durability-db');
    const id = await createAddress(customer);
    const placed = await placeOrder(customer, id);
    const orderId = new Types.ObjectId(placed.id as string);

    const before = await orders.findById(orderId).lean<OrderLean>().exec();

    await http()
      .patch(`${ADDRESSES}/${id}`)
      .set(...bearer(customer))
      .send({ street: 'Rewritten entirely' })
      .expect(200);
    await http().delete(`${ADDRESSES}/${id}`).set(...bearer(customer)).expect(200);

    const after = await orders.findById(orderId).lean<OrderLean>().exec();

    expect(after?.shippingAddress).toEqual(before?.shippingAddress);
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
  });

  it('does not touch inventory or the order count when an address is deleted', async () => {
    const customer = await createCustomer('durability-inventory');
    const id = await createAddress(customer);
    await placeOrder(customer, id);

    const stockBefore = await products
      .findById(productId)
      .select({ 'stock.onHand': 1 })
      .lean<{ stock: { onHand: number } }>()
      .exec();
    const ordersBefore = await orders.countDocuments({ userId: customer.id }).exec();
    const eventsBefore = await inventoryEvents.countDocuments({ productId }).exec();

    await http().delete(`${ADDRESSES}/${id}`).set(...bearer(customer)).expect(200);

    expect(
      (
        await products
          .findById(productId)
          .select({ 'stock.onHand': 1 })
          .lean<{ stock: { onHand: number } }>()
          .exec()
      )?.stock.onHand,
    ).toBe(stockBefore?.stock.onHand);
    expect(await orders.countDocuments({ userId: customer.id }).exec()).toBe(ordersBefore);
    expect(await inventoryEvents.countDocuments({ productId }).exec()).toBe(eventsBefore);
  });
});
