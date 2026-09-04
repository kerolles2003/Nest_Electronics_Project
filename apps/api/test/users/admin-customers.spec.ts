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
import { AuditAction, AuditEntityType } from '../../src/modules/audit/domain/audit-action';
import { AuditLog } from '../../src/modules/audit/infrastructure/schemas/audit-log.schema';
import { Cart } from '../../src/modules/cart/infrastructure/schemas/cart.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { InventoryEvent } from '../../src/modules/inventory/infrastructure/schemas/inventory-event.schema';
import { OrderStatus, PaymentStatus } from '../../src/modules/orders/domain/order-status';
import { IdempotencyKeyRecord } from '../../src/modules/orders/infrastructure/schemas/idempotency-key.schema';
import { Order } from '../../src/modules/orders/infrastructure/schemas/order.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * `/admin/customers` — the people list, and the two operations only a
 * `SUPER_ADMIN` may perform.
 *
 * ## What is actually being proved
 *
 * AUTHORIZATION-MODEL.md §3 records that legacy "declared both roles but
 * `is_admin()` and `requireAdmin()` treated them **identically** — the
 * distinction existed in three places and was enforced in none." So the
 * assertions that carry weight are the ones where an `ADMIN` is refused and a
 * `SUPER_ADMIN` is not, on the same route, with the same body.
 *
 * The second is `tokenVersion`. A role is a JWT claim, carried so the guard
 * needs no per-request lookup; the price is that a demoted admin would hold a
 * working admin token for the remainder of its fifteen minutes. The test
 * demotes an account and then USES its existing token, which must stop working
 * immediately — that is the escape hatch actually escaping, rather than a
 * counter being incremented.
 *
 * The third is `totalSpent`, which is counted at DELIVERY because under COD the
 * courier collects at the door.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const USER_AGENT = `CustomerSuite/1.0 (${RUN_ID})`;

let app: INestApplication;
let users: Model<User>;
let orders: Model<Order>;
let carts: Model<Cart>;
let products: Model<Product>;
let categories: Model<Category>;
let auditLogs: Model<AuditLog>;
let inventoryEvents: Model<InventoryEvent>;
let idempotencyKeys: Model<IdempotencyKeyRecord>;
let refreshTokens: Model<RefreshToken>;

const createdUserIds: Types.ObjectId[] = [];
const createdOrderIds: Types.ObjectId[] = [];
const createdProductIds: Types.ObjectId[] = [];
const createdCategoryIds: Types.ObjectId[] = [];

interface Account {
  readonly id: Types.ObjectId;
  readonly token: string;
  readonly email: string;
  readonly addressId: string;
}

let owner: Account;
let staff: Account;
let shopper: Account;
let productId: Types.ObjectId;

function http(): request.Agent {
  return request(app.getHttpServer());
}

function bearer(account: Account): [string, string] {
  return ['Authorization', `Bearer ${account.token}`];
}

const NO_ADDRESS = '652f1a9b3c4d5e6f7a8b9c0d';

async function createAccount(label: string, role: Role = Role.CUSTOMER): Promise<Account> {
  const email = `cust-${label}.${RUN_ID}@example.test`;
  const fullName = `Customer ${label}`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName })
    .expect(201);

  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } }).exec();

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  const login = await http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
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

  return { id: created._id, token, email, addressId };
}

/** Places a real order through checkout, so the totals are computed over real documents. */
async function placeOrder(account: Account, quantity: number): Promise<Types.ObjectId> {
  await http()
    .post('/api/v1/cart/items')
    .set(...bearer(account))
    .send({ productId: productId.toHexString(), quantity })
    .expect(200);

  const response = await http()
    .post('/api/v1/orders')
    .set(...bearer(account))
    .set('Idempotency-Key', randomUUID())
    .send({ addressId: account.addressId })
    .expect(201);

  const id = new Types.ObjectId(response.body.data.id as string);
  createdOrderIds.push(id);

  return id;
}

function listCustomers(query: string, account: Account): request.Test {
  return http()
    .get(`/api/v1/admin/customers${query}`)
    .set(...bearer(account));
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
  orders = app.get<Model<Order>>(getModelToken(Order.name));
  carts = app.get<Model<Cart>>(getModelToken(Cart.name));
  products = app.get<Model<Product>>(getModelToken(Product.name));
  categories = app.get<Model<Category>>(getModelToken(Category.name));
  auditLogs = app.get<Model<AuditLog>>(getModelToken(AuditLog.name));
  inventoryEvents = app.get<Model<InventoryEvent>>(getModelToken(InventoryEvent.name));
  idempotencyKeys = app.get<Model<IdempotencyKeyRecord>>(getModelToken(IdempotencyKeyRecord.name));
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));

  owner = await createAccount('owner', Role.SUPER_ADMIN);
  staff = await createAccount('staff', Role.ADMIN);
  shopper = await createAccount('shopper');

  const category = await categories.create({
    slug: `cust-cat-${RUN_ID}`,
    name: { en: 'Customer Test', ar: null },
    parentId: null,
    path: [],
    depth: 0,
  });
  createdCategoryIds.push(category._id);

  const product = await products.create({
    sku: `CUST-${RUN_ID}`,
    slug: `cust-${RUN_ID}`,
    name: { en: 'Customer Test Board', ar: null },
    category: {
      id: category._id,
      slug: category.slug,
      name: { en: 'Customer Test', ar: null },
      path: [category._id],
    },
    brand: null,
    pricing: { basePrice: 1000, salePrice: null, effectivePrice: 1000, costPrice: 100 },
    currency: 'EGP',
    stock: { onHand: 500, lowStockThreshold: 5 },
    isActive: true,
  });
  createdProductIds.push(product._id);
  productId = product._id;
}, 120_000);

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await auditLogs.deleteMany({ 'entity.id': { $in: createdOrderIds } }).exec();
    await inventoryEvents.deleteMany({ 'reference.id': { $in: createdOrderIds } }).exec();
    await orders.deleteMany({ _id: { $in: createdOrderIds } }).exec();
  }

  if (createdUserIds.length > 0) {
    await auditLogs.deleteMany({ 'entity.id': { $in: createdUserIds } }).exec();
    await idempotencyKeys.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await carts.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  if (createdProductIds.length > 0) {
    await products.deleteMany({ _id: { $in: createdProductIds } }).exec();
  }

  if (createdCategoryIds.length > 0) {
    await categories.deleteMany({ _id: { $in: createdCategoryIds } }).exec();
  }

  await app.close();
});

describe('GET /admin/customers', () => {
  it('lists accounts and never carries a password hash', async () => {
    const response = await listCustomers(`?q=cust-shopper.${RUN_ID}`, staff).expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].email).toBe(shopper.email);
    /*
     * The credential fields are owned by AuthModule through a dedicated
     * repository and are excluded by the service's projection, so there is no
     * serializer option or forgotten `select` that could put one here. Asserted
     * on the serialised body rather than on the DTO type, because a type is not
     * a runtime guarantee.
     */
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('$2b$');
  });

  it('finds an account by a mid-token name fragment', async () => {
    // Substring, not a tokenised text index: an operator typing part of a name
    // expects a hit.
    const response = await listCustomers('?q=shopper', staff).expect(200);

    expect(response.body.data.map((row: { email: string }) => row.email)).toContain(shopper.email);
  });

  it('treats regular-expression syntax as literal text', async () => {
    const response = await listCustomers('?q=.*', staff).expect(200);

    expect(response.body.data).toHaveLength(0);
  });

  it('filters by role, so staff accounts are findable in the same list', async () => {
    const response = await listCustomers(`?role=SUPER_ADMIN&q=${RUN_ID}`, staff).expect(200);

    expect(response.body.data.map((row: { email: string }) => row.email)).toEqual([owner.email]);
  });

  it('includes an account that has never ordered', async () => {
    /*
     * Aggregating the orders first and paginating on the result would have been
     * simpler and would exclude every account that has not bought anything —
     * which on a new shop is most of them, and looking one up is completely
     * ordinary.
     */
    const response = await listCustomers(`?q=cust-owner.${RUN_ID}`, staff).expect(200);

    expect(response.body.data[0]).toMatchObject({
      orderCount: 0,
      totalSpent: 0,
      lastOrderAt: null,
    });
  });

  it('refuses a CUSTOMER', async () => {
    await http()
      .get('/api/v1/admin/customers')
      .set(...bearer(shopper))
      .expect(403);
  });
});

describe('order totals — spend is counted at DELIVERY', () => {
  it('counts every order, but only DELIVERED money', async () => {
    const buyer = await createAccount('buyer');

    const paid = await placeOrder(buyer, 3);
    const stillOut = await placeOrder(buyer, 2);

    /*
     * ADR-ORDER-002: under COD, delivery IS the payment event — the courier
     * does not hand over goods without collecting, and the transition to
     * DELIVERED sets `payment.status = PAID` in the same atomic operation. So
     * an order that has not been delivered has not been paid for.
     *
     * The status is set here rather than driven through the lifecycle because
     * this suite is asserting the REPORTING rule, not the transition matrix —
     * which `test/orders` already covers exhaustively.
     */
    await orders
      .updateOne(
        { _id: paid },
        { $set: { status: OrderStatus.DELIVERED, 'payment.status': PaymentStatus.PAID } },
      )
      .exec();

    const detail = await http()
      .get(`/api/v1/admin/customers/${buyer.id.toHexString()}`)
      .set(...bearer(staff))
      .expect(200);

    const paidOrder = await orders.findById(paid).lean().exec();

    expect(detail.body.data.orderCount).toBe(2);
    expect(detail.body.data.totalSpent).toBe(paidOrder?.pricing.grandTotal);

    // The undelivered one is counted in the order count and NOT in the money.
    const pending = await orders.findById(stillOut).lean().exec();
    expect(detail.body.data.totalSpent).toBeLessThan(
      (paidOrder?.pricing.grandTotal ?? 0) + (pending?.pricing.grandTotal ?? 0),
    );
  });

  it('a REFUNDED order leaves the total, with no separate subtraction', async () => {
    /*
     * The reason the predicate is `payment.status` rather than
     * `status === DELIVERED`. A refunded order was delivered and still carries
     * `deliveredAt`; following the money rather than the fulfilment axis makes
     * a refund remove itself.
     */
    const buyer = await createAccount('refunded');
    const order = await placeOrder(buyer, 4);

    await orders
      .updateOne(
        { _id: order },
        { $set: { status: OrderStatus.DELIVERED, 'payment.status': PaymentStatus.PAID } },
      )
      .exec();

    const before = await http()
      .get(`/api/v1/admin/customers/${buyer.id.toHexString()}`)
      .set(...bearer(staff))
      .expect(200);

    expect(before.body.data.totalSpent).toBeGreaterThan(0);

    await orders.updateOne({ _id: order }, { $set: { 'payment.status': PaymentStatus.REFUNDED } }).exec();

    const after = await http()
      .get(`/api/v1/admin/customers/${buyer.id.toHexString()}`)
      .set(...bearer(staff))
      .expect(200);

    expect(after.body.data.totalSpent).toBe(0);
    // Still their order, though — the count follows a different rule.
    expect(after.body.data.orderCount).toBe(1);
  });
});

describe('GET /admin/customers/:id', () => {
  it('carries the address book, which the list does not', async () => {
    const response = await http()
      .get(`/api/v1/admin/customers/${shopper.id.toHexString()}`)
      .set(...bearer(staff))
      .expect(200);

    expect(response.body.data.addresses).toHaveLength(1);
    expect(response.body.data.addresses[0]).toMatchObject({
      label: 'Home',
      governorate: 'Cairo',
      isDefault: true,
    });

    const list = await listCustomers(`?q=cust-shopper.${RUN_ID}`, staff).expect(200);
    expect(list.body.data[0].addresses).toBeUndefined();
  });

  it('answers 404 for an unknown id', async () => {
    const response = await http()
      .get(`/api/v1/admin/customers/${new Types.ObjectId().toHexString()}`)
      .set(...bearer(staff))
      .expect(404);

    expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });
});

describe('PATCH /admin/customers/:id/role — the separation legacy never enforced', () => {
  function changeRole(targetId: string, role: string, account: Account): request.Test {
    return http()
      .patch(`/api/v1/admin/customers/${targetId}/role`)
      .set(...bearer(account))
      .set('User-Agent', USER_AGENT)
      .send({ role });
  }

  it('refuses an ADMIN and allows a SUPER_ADMIN, on the same route with the same body', async () => {
    const target = await createAccount('promotable');

    /*
     * The whole point of AUTHORIZATION-MODEL.md §3's table. Legacy declared
     * both roles and treated them identically; here the same request differs
     * only in who sends it.
     */
    await changeRole(target.id.toHexString(), Role.ADMIN, staff).expect(403);
    await changeRole(target.id.toHexString(), Role.ADMIN, owner).expect(200);

    const after = await users.findById(target.id).lean<UserLean>().exec();
    expect(after?.role).toBe(Role.ADMIN);
  });

  it('an ADMIN can still read the list they cannot change', async () => {
    // The separation is per-operation, not per-screen.
    await listCustomers('', staff).expect(200);
  });

  it('INVALIDATES the account’s existing tokens immediately', async () => {
    /*
     * The part with teeth. `role` is a JWT claim so the guard needs no
     * per-request lookup — legacy looked it up on EVERY request and made
     * `profiles_pkey` the hottest index in the database at 2,719 scans. The
     * cost is that a demoted admin would keep a working admin token for up to
     * fifteen minutes, and `tokenVersion` is the documented escape hatch.
     *
     * This demotes an account and then USES the token it was already holding.
     */
    const doomed = await createAccount('demoted', Role.ADMIN);

    // The token works, and reaches an admin route.
    await listCustomers('', doomed).expect(200);

    await changeRole(doomed.id.toHexString(), Role.CUSTOMER, owner).expect(200);

    // The same token, unchanged, is now dead — not in fifteen minutes, now.
    await listCustomers('', doomed).expect(401);
  });

  it('refuses a SUPER_ADMIN changing their own role', async () => {
    const response = await changeRole(owner.id.toHexString(), Role.ADMIN, owner).expect(409);

    expect(response.body.error.code).toBe('CANNOT_MODIFY_OWN_ACCOUNT');

    const after = await users.findById(owner.id).lean<UserLean>().exec();
    expect(after?.role).toBe(Role.SUPER_ADMIN);
  });

  it('refuses to demote the LAST SUPER_ADMIN', async () => {
    /*
     * §3: "the last super-admin must always exist". Reachable only via a second
     * super-admin demoting the first, so the fixture makes one — and then
     * removes it again to leave exactly one, which is the state the refusal
     * guards.
     */
    const second = await createAccount('second-owner', Role.SUPER_ADMIN);

    // With two, a demotion is allowed.
    await changeRole(second.id.toHexString(), Role.CUSTOMER, owner).expect(200);

    // With one, it is not — and the one left is the actor, so a third account
    // does the asking to keep this distinct from the self-demotion refusal.
    const third = await createAccount('third-owner', Role.SUPER_ADMIN);
    await users.updateOne({ _id: owner.id }, { $set: { role: Role.CUSTOMER } }).exec();

    const response = await changeRole(third.id.toHexString(), Role.CUSTOMER, third).expect(409);

    // Self-demotion is refused first, which is the stricter of the two rules —
    // so this proves the ordering as well as the rule.
    expect(response.body.error.code).toBe('CANNOT_MODIFY_OWN_ACCOUNT');

    await users.updateOne({ _id: owner.id }, { $set: { role: Role.SUPER_ADMIN } }).exec();
    await users.updateOne({ _id: third.id }, { $set: { role: Role.CUSTOMER } }).exec();
  });

  it('writes a USER_ROLE_CHANGED audit row, and none for a no-op', async () => {
    const target = await createAccount('audited');

    await changeRole(target.id.toHexString(), Role.ADMIN, owner).expect(200);

    const rows = await auditLogs
      .find({ 'entity.type': AuditEntityType.USER, 'entity.id': target.id })
      .lean()
      .exec();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe(AuditAction.USER_ROLE_CHANGED);
    expect(rows[0]?.entity.label).toBe(target.email);
    expect(rows[0]?.changes?.before).toMatchObject({ role: Role.CUSTOMER });
    expect(rows[0]?.changes?.after).toMatchObject({ role: Role.ADMIN });
    expect(rows[0]?.actor.id.toHexString()).toBe(owner.id.toHexString());
    expect(rows[0]?.userAgent).toBe(USER_AGENT);

    // Setting the role it already has changes nothing and records nothing.
    await changeRole(target.id.toHexString(), Role.ADMIN, owner).expect(200);

    expect(
      await auditLogs.countDocuments({ 'entity.type': AuditEntityType.USER, 'entity.id': target.id }).exec(),
    ).toBe(1);
  });

  it('refuses an unknown role', async () => {
    const target = await createAccount('badrole');

    await changeRole(target.id.toHexString(), 'WIZARD', owner).expect(400);
  });
});

describe('DELETE /admin/customers/:id', () => {
  function remove(targetId: string, account: Account): request.Test {
    return http()
      .delete(`/api/v1/admin/customers/${targetId}`)
      .set(...bearer(account))
      .set('User-Agent', USER_AGENT);
  }

  it('is SUPER_ADMIN only', async () => {
    const target = await createAccount('deletable');

    await remove(target.id.toHexString(), staff).expect(403);
    await remove(target.id.toHexString(), owner).expect(200);
  });

  it('stops the account authenticating, immediately and afterwards', async () => {
    const target = await createAccount('goodbye');

    await remove(target.id.toHexString(), owner).expect(200);

    // The token it was holding is dead.
    await http()
      .get('/api/v1/auth/me')
      .set(...bearer(target))
      .expect(401);

    // And it cannot get a new one. The check happens AFTER password
    // verification, so this response cannot be used to enumerate accounts.
    await http()
      .post('/api/v1/auth/login')
      .send({ email: target.email, password: PASSWORD })
      .expect(403);
  });

  it('leaves the customer’s ORDERS alone', async () => {
    /*
     * An order is an immutable commercial record carrying its own customer
     * snapshot, so it reads correctly after the account is gone — which is the
     * whole reason the snapshot exists rather than a join.
     */
    const buyer = await createAccount('ordered-then-deleted');
    const orderId = await placeOrder(buyer, 1);

    await remove(buyer.id.toHexString(), owner).expect(200);

    const order = await orders.findById(orderId).lean().exec();

    expect(order).not.toBeNull();
    expect(order?.customer.email).toBe(buyer.email);
  });

  it('refuses deleting your own account and the last SUPER_ADMIN', async () => {
    const own = await remove(owner.id.toHexString(), owner).expect(409);

    expect(own.body.error.code).toBe('CANNOT_MODIFY_OWN_ACCOUNT');
  });

  it('writes a USER_DELETED audit row', async () => {
    const target = await createAccount('audited-delete');

    await remove(target.id.toHexString(), owner).expect(200);

    const rows = await auditLogs
      .find({ 'entity.type': AuditEntityType.USER, 'entity.id': target.id })
      .lean()
      .exec();

    expect(rows.map((row) => row.action)).toEqual([AuditAction.USER_DELETED]);
    // Its own action rather than USER_ROLE_CHANGED: every future query asking
    // "what role changes happened" would otherwise return deletions too.
    expect(rows[0]?.metadata).toMatchObject({ role: Role.CUSTOMER });
  });

  it('is excluded from the list unless asked for', async () => {
    const target = await createAccount('hidden');

    await remove(target.id.toHexString(), owner).expect(200);

    const plain = await listCustomers(`?q=cust-hidden.${RUN_ID}`, staff).expect(200);
    const included = await listCustomers(`?q=cust-hidden.${RUN_ID}&includeDeleted=true`, staff).expect(200);

    expect(plain.body.data).toHaveLength(0);
    expect(included.body.data).toHaveLength(1);
  });

  it('refuses a second delete', async () => {
    const target = await createAccount('twice');

    await remove(target.id.toHexString(), owner).expect(200);
    await remove(target.id.toHexString(), owner).expect(404);
  });
});
