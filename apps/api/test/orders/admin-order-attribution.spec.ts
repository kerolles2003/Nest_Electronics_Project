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
import { OrderStatus } from '../../src/modules/orders/domain/order-status';
import { IdempotencyKeyRecord } from '../../src/modules/orders/infrastructure/schemas/idempotency-key.schema';
import { Order } from '../../src/modules/orders/infrastructure/schemas/order.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * WHO moved this order, and WHAT this order says can be done to it — over HTTP,
 * against the real application and the real development database.
 *
 * ## What was found, and what it changes
 *
 * The attribution was already being RECORDED. `OrderLifecycleService` resolves
 * the actor from the token, snapshots `{id, role, name}` onto the history entry
 * and writes it in the SAME guarded update as the status change, so an order
 * whose status moved without a named actor is not representable. That half was
 * sound and is not what this file adds.
 *
 * What was missing is that **no DTO serialised any of it**. `statusHistory` was
 * absent from `OrderDto` and from `OrderSummaryDto`, so the trail existed only
 * in the database and no console, report or support conversation could reach
 * it. An unreadable audit trail is not an audit trail; these tests are what
 * make its exposure a guarantee rather than a field somebody added.
 *
 * The second half is `allowedTransitions`. The admin app is being taken off its
 * own local transition maps and driven from the server's, and the risk that
 * moves is drift between what the API ADVERTISES and what it ACCEPTS. Every
 * assertion below on that pair is deliberately made over the wire, from the
 * response body to the endpoint's own answer, so nothing in the test imports
 * the table it is checking.
 *
 * ISOLATION. Own products, own users, own orders; everything removed by tracked
 * id in `afterAll`. No `dropDatabase`, no `deleteMany({})`.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const CARRIER = 'Bosta';
const TRACKING = 'BST-ATTRIB-0001';

const ADDRESS = {
  fullName: 'Mina Kerolles',
  phone: '01012345678',
  street: '12 Sherif Street, Apartment 4',
  city: 'Downtown',
  governorate: 'Cairo',
};

/** A well-formed id belonging to nothing. Staff never save an address. */
const NO_ADDRESS = '652f1a9b3c4d5e6f7a8b9c0d';

/**
 * Every staff endpoint, with the status it targets and a body that VALIDATES.
 *
 * Written out here rather than imported from `admin-order-actions.ts`, on
 * purpose. The point of this suite is to check the server's advertised list
 * against the server's actual behaviour; importing the table that produces the
 * list would let a wrong table agree with itself and pass.
 *
 * The bodies must be valid because validation runs BEFORE the state machine —
 * a request refused at the DTO is a 400 and proves nothing about the
 * transition.
 */
const STAFF_ACTIONS: readonly {
  action: string;
  to: OrderStatus;
  body: Record<string, unknown>;
}[] = [
  { action: 'confirm', to: OrderStatus.CONFIRMED, body: {} },
  {
    action: 'ship',
    to: OrderStatus.SHIPPED,
    body: { carrier: CARRIER, trackingNumber: TRACKING },
  },
  { action: 'deliver', to: OrderStatus.DELIVERED, body: {} },
  {
    action: 'delivery-failed',
    to: OrderStatus.DELIVERY_FAILED,
    body: { reason: 'Customer unreachable on three call attempts.' },
  },
  { action: 'retry-shipment', to: OrderStatus.SHIPPED, body: {} },
  { action: 'return', to: OrderStatus.RETURNED, body: { reason: 'Parcel came back.' } },
];

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

interface Account {
  readonly id: Types.ObjectId;
  readonly token: string;
  readonly fullName: string;
  readonly addressId: string;
}

interface HistoryEntry {
  from: OrderStatus | null;
  to: OrderStatus;
  actor: { id: string | null; role: Role; name: string };
  note: string | null;
  at: string;
}

interface AdvertisedMove {
  to: OrderStatus;
  action: string | null;
  requires: string[];
}

function http(): request.Agent {
  return request(app.getHttpServer());
}

function bearer(account: Account): [string, string] {
  return ['Authorization', `Bearer ${account.token}`];
}

async function createAccount(label: string, role: Role = Role.CUSTOMER): Promise<Account> {
  const email = `attrib-${label}.${RUN_ID}@example.test`;
  const fullName = `Attrib ${label}`;

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

  let addressId = NO_ADDRESS;

  if (role === Role.CUSTOMER) {
    const saved = await http()
      .post('/api/v1/users/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Home', ...ADDRESS })
      .expect(201);

    addressId = saved.body.data.id as string;
  }

  return { id: created._id, token, fullName, addressId };
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
    sku: `ATTRIB-TEST-${RUN_ID}`,
    slug: `attrib-test-${RUN_ID}`,
    name: { en: 'Attribution Test Board', ar: null },
    shortDescription: { en: 'Created by the attribution test suite.', ar: null },
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
    stock: { onHand: 900, lowStockThreshold: 5 },
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

/** One REAL order, placed through the real checkout path. */
async function placeOrder(): Promise<string> {
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
  return id;
}

function act(actor: Account, orderId: string, action: string, body: Record<string, unknown> = {}) {
  return http()
    .post(`/api/v1/admin/orders/${orderId}/${action}`)
    .set(...bearer(actor))
    .send(body);
}

/** The staff view of one order. */
async function readAsStaff(orderId: string, actor: Account = admin) {
  const response = await http()
    .get(`/api/v1/admin/orders/${orderId}`)
    .set(...bearer(actor))
    .expect(200);

  return response.body.data as {
    status: OrderStatus;
    allowedTransitions: AdvertisedMove[];
    statusHistory: HistoryEntry[];
  };
}

let customer: Account;
let admin: Account;
let secondAdmin: Account;
let superAdmin: Account;
let product: Types.ObjectId;
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

  seededProductCount = await products.countDocuments({ sku: { $not: /^ATTRIB-TEST-/ } }).exec();

  product = await createProduct();
  customer = await createAccount('customer');
  admin = await createAccount('admin', Role.ADMIN);
  secondAdmin = await createAccount('second', Role.ADMIN);
  superAdmin = await createAccount('super', Role.SUPER_ADMIN);
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

  expect(await products.countDocuments({ sku: { $not: /^ATTRIB-TEST-/ } }).exec()).toBe(
    seededProductCount,
  );

  const connection = app.get<Connection>(getConnectionToken());
  await app.close();
  await connection.close();
}, 300_000);

// ---------------------------------------------------------------------------

describe('every transition is attributable to the person who made it', () => {
  it('names the acting admin on each entry, and a DIFFERENT admin on the next', async () => {
    const orderId = await placeOrder();

    /*
     * Two different operators on one order, which is the realistic case — a
     * night shift confirms and a morning shift ships. A trail that recorded
     * "an admin" rather than WHICH admin would satisfy a single-actor test and
     * fail this one, which is why the second account exists.
     */
    await act(admin, orderId, 'confirm', { note: 'Called the customer.' }).expect(200);
    await act(secondAdmin, orderId, 'ship', {
      carrier: CARRIER,
      trackingNumber: TRACKING,
    }).expect(200);

    const order = await readAsStaff(orderId);
    const byTarget = new Map(order.statusHistory.map((entry) => [entry.to, entry]));

    const confirmed = byTarget.get(OrderStatus.CONFIRMED);
    expect(confirmed?.actor).toEqual({
      id: admin.id.toHexString(),
      role: Role.ADMIN,
      name: admin.fullName,
    });
    expect(confirmed?.from).toBe(OrderStatus.PLACED);
    expect(confirmed?.note).toBe('Called the customer.');

    const shipped = byTarget.get(OrderStatus.SHIPPED);
    expect(shipped?.actor).toEqual({
      id: secondAdmin.id.toHexString(),
      role: Role.ADMIN,
      name: secondAdmin.fullName,
    });

    // The two really are different people, so the assertions above are not
    // both satisfied by one account.
    expect(confirmed?.actor.id).not.toBe(shipped?.actor.id);
  });

  it('attributes placement to the CUSTOMER, not to staff', async () => {
    const orderId = await placeOrder();
    const order = await readAsStaff(orderId);

    const placement = order.statusHistory[0];

    expect(placement?.from).toBeNull();
    expect(placement?.to).toBe(OrderStatus.PLACED);
    expect(placement?.actor).toEqual({
      id: customer.id.toHexString(),
      role: Role.CUSTOMER,
      name: customer.fullName,
    });
  });

  it('records a SUPER_ADMIN by their own role, not flattened to ADMIN', async () => {
    const orderId = await placeOrder();

    await act(superAdmin, orderId, 'confirm').expect(200);

    const order = await readAsStaff(orderId);
    const entry = order.statusHistory.find((e) => e.to === OrderStatus.CONFIRMED);

    expect(entry?.actor.role).toBe(Role.SUPER_ADMIN);
    expect(entry?.actor.id).toBe(superAdmin.id.toHexString());
  });

  it('appends one entry per transition and never rewrites an earlier one', async () => {
    const orderId = await placeOrder();

    const before = (await readAsStaff(orderId)).statusHistory;
    expect(before).toHaveLength(1);

    await act(admin, orderId, 'confirm').expect(200);
    await act(admin, orderId, 'ship', { carrier: CARRIER, trackingNumber: TRACKING }).expect(200);
    await act(admin, orderId, 'deliver').expect(200);

    const after = (await readAsStaff(orderId)).statusHistory;

    expect(after).toHaveLength(4);
    expect(after.map((entry) => entry.to)).toEqual([
      OrderStatus.PLACED,
      OrderStatus.CONFIRMED,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ]);
    // The placement entry is byte-for-byte what it was three transitions ago.
    expect(after[0]).toEqual(before[0]);
  });

  it('cannot be told who the actor was — the body has no field for it', async () => {
    const orderId = await placeOrder();

    /*
     * The legacy defect this closes (F-MED-5): `changed_by` arrived in the
     * request and was never verified, so anybody could write anybody's name
     * into the trail. There is no such field now, and `forbidNonWhitelisted`
     * makes inventing one a 400 rather than a silently ignored key.
     */
    for (const forged of [
      { actorId: customer.id.toHexString() },
      { actor: { id: customer.id.toHexString(), role: Role.SUPER_ADMIN, name: 'Somebody Else' } },
      { adminId: customer.id.toHexString() },
    ]) {
      const refused = await act(admin, orderId, 'confirm', forged).expect(400);
      expect(refused.body.error.code).toBe('UNKNOWN_FIELD');
    }

    // And the order did not move, so none of the three half-succeeded.
    expect((await readAsStaff(orderId)).status).toBe(OrderStatus.PLACED);
  });

  it('keeps the name the actor had, after they are renamed', async () => {
    const orderId = await placeOrder();

    await act(secondAdmin, orderId, 'confirm').expect(200);

    await users
      .updateOne({ _id: secondAdmin.id }, { $set: { fullName: 'Renamed After The Fact' } })
      .exec();

    try {
      const entry = (await readAsStaff(orderId)).statusHistory.find(
        (e) => e.to === OrderStatus.CONFIRMED,
      );

      // A joined name would now read "Renamed After The Fact". A snapshot does
      // not, which is the property an invoice or a dispute depends on.
      expect(entry?.actor.name).toBe(secondAdmin.fullName);
    } finally {
      await users.updateOne({ _id: secondAdmin.id }, { $set: { fullName: secondAdmin.fullName } }).exec();
    }
  });
});

describe('the trail stays internal to staff', () => {
  it('does not leak the acting admin to the customer who owns the order', async () => {
    const orderId = await placeOrder();

    await act(admin, orderId, 'confirm').expect(200);

    const own = await http()
      .get(`/api/v1/orders/${orderId}`)
      .set(...bearer(customer))
      .expect(200);

    /*
     * §10: a customer may see that the shop acted, never which member of staff
     * did. `OrderCancellationDto.by` carries the ROLE for exactly that reason.
     * These two fields are the staff view and must not appear here.
     */
    expect(own.body.data.statusHistory).toBeUndefined();
    expect(own.body.data.allowedTransitions).toBeUndefined();

    // Nor anywhere else in the body — an admin's name must not travel by any
    // route, including one added later without thinking about this.
    expect(JSON.stringify(own.body)).not.toContain(admin.fullName);
    expect(JSON.stringify(own.body)).not.toContain(admin.id.toHexString());
  });

  it('does not leak it through the customer’s order history either', async () => {
    const history = await http()
      .get('/api/v1/orders')
      .set(...bearer(customer))
      .expect(200);

    expect(JSON.stringify(history.body)).not.toContain(admin.fullName);
  });
});

// ---------------------------------------------------------------------------

describe('what the API advertises is what the API accepts', () => {
  it('accepts every advertised move and refuses every unadvertised one, from PLACED', async () => {
    const advertised = (await readAsStaff(await placeOrder())).allowedTransitions;
    const advertisedActions = new Set(
      advertised.map((move) => move.action).filter((action): action is string => action !== null),
    );

    /*
     * The anti-drift check, made entirely over the wire: the list in the
     * response body against the endpoints' own answers. Each attempt gets a
     * FRESH order, because a successful transition would change the state the
     * next attempt is testing.
     */
    for (const candidate of STAFF_ACTIONS) {
      const orderId = await placeOrder();
      const response = await act(admin, orderId, candidate.action, candidate.body);

      if (advertisedActions.has(candidate.action)) {
        expect([candidate.action, response.status]).toEqual([candidate.action, 200]);
        expect(response.body.data.status).toBe(candidate.to);
      } else {
        expect([candidate.action, response.status]).toEqual([candidate.action, 409]);
        expect(response.body.error.code).toBe('INVALID_STATE_TRANSITION');
      }
    }

    // Not a vacuous pass: PLACED really does advertise something, and really
    // does not advertise everything.
    expect(advertisedActions.size).toBeGreaterThan(0);
    expect(advertisedActions.size).toBeLessThan(STAFF_ACTIONS.length);
  });

  it('never advertises an action this API does not route', async () => {
    /*
     * The loop above compares the ADVERTISED actions against the endpoints, so
     * it cannot see a move advertised with an action name that exists nowhere —
     * a button that 404s. This closes that direction: every action string the
     * API offers must be one of the six routes the controller declares.
     */
    const routes = new Set(STAFF_ACTIONS.map((candidate) => candidate.action));
    const orderId = await placeOrder();

    await act(admin, orderId, 'confirm').expect(200);
    await act(admin, orderId, 'ship', { carrier: CARRIER, trackingNumber: TRACKING }).expect(200);

    for (const status of [OrderStatus.PLACED, OrderStatus.CONFIRMED, OrderStatus.SHIPPED]) {
      const sample =
        status === OrderStatus.SHIPPED ? orderId : status === OrderStatus.PLACED ? await placeOrder() : null;

      if (sample === null) continue;

      for (const move of (await readAsStaff(sample)).allowedTransitions) {
        if (move.action !== null) expect(routes.has(move.action)).toBe(true);
      }
    }
  });

  it('offers a routeless move ONLY for cancellation', async () => {
    /*
     * `action: null` is a deliberate, documented state — the matrix permits a
     * staff actor to cancel and this API exposes no staff route for it (§13).
     * It is also the shape any accidental over-advertisement takes, because an
     * edge with no table entry reports `null` too. Pinning it to the ONE target
     * it is allowed for is what stops that being invisible: a mutation adding
     * `DELIVERED` to a PLACED order's moves passed every other check here, and
     * fails this one.
     */
    const orderId = await placeOrder();
    await act(admin, orderId, 'confirm').expect(200);
    await act(admin, orderId, 'ship', { carrier: CARRIER, trackingNumber: TRACKING }).expect(200);
    await act(admin, orderId, 'delivery-failed', { reason: 'Nobody home.' }).expect(200);

    for (const sample of [await placeOrder(), orderId]) {
      const routeless = (await readAsStaff(sample)).allowedTransitions.filter(
        (move) => move.action === null,
      );

      expect(routeless.every((move) => move.to === OrderStatus.CANCELLED)).toBe(true);
    }
  });

  it('advertises the CANCELLED edge with no action, because staff have no route to it', async () => {
    const order = await readAsStaff(await placeOrder());
    const cancel = order.allowedTransitions.find((move) => move.to === OrderStatus.CANCELLED);

    expect(cancel).toEqual({ to: OrderStatus.CANCELLED, action: null, requires: [] });
  });

  it('names the fields an edge needs, and refuses the request without them', async () => {
    const orderId = await placeOrder();
    await act(admin, orderId, 'confirm').expect(200);

    const move = (await readAsStaff(orderId)).allowedTransitions.find(
      (candidate) => candidate.action === 'ship',
    );

    expect(move?.requires).toEqual(['carrier', 'trackingNumber']);

    // The advertisement is load-bearing: sending the request without the
    // fields it names is refused, so a console that ignored `requires` would
    // produce a 400 rather than a shipped order with no tracking (F-CRIT-4).
    for (const incomplete of [{}, { carrier: CARRIER }, { trackingNumber: TRACKING }]) {
      const refused = await act(admin, orderId, 'ship', incomplete).expect(400);
      expect(refused.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('advertises NOTHING once the order is terminal', async () => {
    const orderId = await placeOrder();

    await act(admin, orderId, 'confirm').expect(200);
    await act(admin, orderId, 'ship', { carrier: CARRIER, trackingNumber: TRACKING }).expect(200);
    await act(admin, orderId, 'deliver').expect(200);
    await act(admin, orderId, 'return', { reason: 'Customer returned it.' }).expect(200);

    const order = await readAsStaff(orderId);

    expect(order.status).toBe(OrderStatus.RETURNED);
    expect(order.allowedTransitions).toEqual([]);

    // And the empty list is the truth, not an omission: every action is refused.
    for (const candidate of STAFF_ACTIONS) {
      await act(admin, orderId, candidate.action, candidate.body).expect(409);
    }
  });

  it('gives SUPER_ADMIN the same moves as ADMIN', async () => {
    const orderId = await placeOrder();

    expect((await readAsStaff(orderId, superAdmin)).allowedTransitions).toEqual(
      (await readAsStaff(orderId, admin)).allowedTransitions,
    );
  });

  it('re-advertises after every transition, tracking the order forward', async () => {
    const orderId = await placeOrder();

    const targetsNow = async (): Promise<OrderStatus[]> =>
      (await readAsStaff(orderId)).allowedTransitions.map((move) => move.to).sort();

    expect(await targetsNow()).toEqual([OrderStatus.CANCELLED, OrderStatus.CONFIRMED].sort());

    await act(admin, orderId, 'confirm').expect(200);
    expect(await targetsNow()).toEqual([OrderStatus.CANCELLED, OrderStatus.SHIPPED].sort());

    await act(admin, orderId, 'ship', { carrier: CARRIER, trackingNumber: TRACKING }).expect(200);
    expect(await targetsNow()).toEqual([OrderStatus.DELIVERED, OrderStatus.DELIVERY_FAILED].sort());

    await act(admin, orderId, 'delivery-failed', { reason: 'Nobody home.' }).expect(200);
    expect(await targetsNow()).toEqual([OrderStatus.RETURNED, OrderStatus.SHIPPED].sort());
  });

  it('returns the same staff model from a lifecycle action as from a read', async () => {
    /*
     * A console applies the response of an action directly to its state. If the
     * action returned the bare customer model, the buttons would vanish after
     * every successful transition and the operator would have to reload.
     */
    const orderId = await placeOrder();
    const acted = await act(admin, orderId, 'confirm').expect(200);
    const read = await readAsStaff(orderId);

    expect(acted.body.data.allowedTransitions).toEqual(read.allowedTransitions);
    expect(acted.body.data.statusHistory).toEqual(read.statusHistory);
  });
});
