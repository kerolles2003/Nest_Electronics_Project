import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import { Connection, Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { validationExceptionFactory } from '../../src/common/pipes/validation-exception.factory';
import { RefreshToken } from '../../src/modules/auth/infrastructure/schemas/refresh-token.schema';
import { CartRepository } from '../../src/modules/cart/infrastructure/repositories/cart.repository';
import { Cart, type CartLean } from '../../src/modules/cart/infrastructure/schemas/cart.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * Cart end-to-end, against the real application and the real Atlas development
 * database.
 *
 * ISOLATION. This suite creates its OWN products rather than using the seeded
 * catalogue, because half the cases require a product with zero stock, a
 * delisted product, or a price that changes mid-test — and mutating the seed to
 * get them would leave the development catalogue wrong for everyone else. Every
 * created id is tracked and deleted by id in `afterAll`. There is no
 * `deleteMany({})`, no `drop`, and the 26 seeded products are asserted intact at
 * the end.
 *
 * The throttler's COUNTER is replaced, not its guard, so the real guard still
 * runs while the suite exceeds limits that exist for humans.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';

let app: INestApplication;
let users: Model<User>;
let carts: Model<Cart>;
let products: Model<Product>;
let refreshTokens: Model<RefreshToken>;

const createdUserIds: Types.ObjectId[] = [];
const createdProductIds: Types.ObjectId[] = [];

/**
 * Product ids by the role each one plays in the tests. Explicit keys rather
 * than a Record, so `noUncheckedIndexedAccess` cannot be satisfied by a `?`
 * that would hide a genuinely missing fixture.
 */
interface Fixtures {
  plentiful: Types.ObjectId;
  onSale: Types.ObjectId;
  scarce: Types.ObjectId;
  empty: Types.ObjectId;
  inactive: Types.ObjectId;
  removed: Types.ObjectId;
}
let productId: Fixtures;

function http(): request.Agent {
  return request(app.getHttpServer());
}

interface Customer {
  readonly id: Types.ObjectId;
  readonly token: string;
}

async function createCustomer(label: string, role: Role = Role.CUSTOMER): Promise<Customer> {
  const email = `cart-${label}.${RUN_ID}@example.test`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: `Cart ${label}` })
    .expect(201);

  // Verified and role-adjusted directly: this suite is about the cart, and
  // going through the verification endpoint would only re-test AuthModule.
  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } }).exec();

  const created = await users.findOne({ email }).lean<UserLean>().exec();
  createdUserIds.push((created as UserLean)._id);

  const login = await http()
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  return { id: (created as UserLean)._id, token: login.body.data.accessToken as string };
}

interface TestProductOptions {
  readonly onHand: number;
  readonly basePrice: number;
  readonly salePrice?: number | null;
  readonly isActive?: boolean;
  readonly deleted?: boolean;
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
    sku: `CART-TEST-${label.toUpperCase()}-${RUN_ID}`,
    slug: `cart-test-${label}-${RUN_ID}`,
    name: { en: `Cart Test ${label}`, ar: null },
    shortDescription: { en: 'Created by the cart test suite.', ar: null },
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
    deletedAt: options.deleted === true ? new Date() : null,
    weight: null,
  });

  createdProductIds.push(created._id);
  return created._id;
}

function bearer(customer: Customer): [string, string] {
  return ['Authorization', `Bearer ${customer.token}`];
}

let alice: Customer;
let bob: Customer;
let admin: Customer;

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
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));

  productId = {
    plentiful: await createProduct('plentiful', { onHand: 50, basePrice: 32500 }),
    onSale: await createProduct('onsale', { onHand: 40, basePrice: 40000, salePrice: 30000 }),
    scarce: await createProduct('scarce', { onHand: 2, basePrice: 15000 }),
    empty: await createProduct('empty', { onHand: 0, basePrice: 9000 }),
    inactive: await createProduct('inactive', { onHand: 10, basePrice: 9000, isActive: false }),
    removed: await createProduct('removed', { onHand: 10, basePrice: 9000, deleted: true }),
  };

  alice = await createCustomer('alice');
  bob = await createCustomer('bob');
  admin = await createCustomer('admin', Role.ADMIN);
}, 120_000);

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await carts.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }
  if (createdProductIds.length > 0) {
    await products.deleteMany({ _id: { $in: createdProductIds } }).exec();
  }

  const connection = app.get<Connection>(getConnectionToken());
  await app.close();
  await connection.close();
}, 120_000);

/** Empties a customer's cart between cases without touching anyone else's. */
async function reset(customer: Customer): Promise<void> {
  await http().delete('/api/v1/cart').set(...bearer(customer)).expect(200);
}

// ---------------------------------------------------------------------------

describe('authentication and authorization', () => {
  it.each([
    ['GET', '/api/v1/cart'],
    ['POST', '/api/v1/cart/items'],
    ['PATCH', `/api/v1/cart/items/${new Types.ObjectId().toHexString()}`],
    ['DELETE', `/api/v1/cart/items/${new Types.ObjectId().toHexString()}`],
    ['DELETE', '/api/v1/cart'],
  ])('%s %s rejects an unauthenticated caller', async (method, path) => {
    const agent = http();
    const verb = method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete';
    const response = await agent[verb](path).expect(401);

    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed token before any cart work happens', async () => {
    const response = await http()
      .get('/api/v1/cart')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);

    expect(response.body.error.code).toBe('TOKEN_INVALID');
  });

  it('refuses a non-CUSTOMER role with 403', async () => {
    // A cart belongs to a customer (AUTHORIZATION-MODEL.md §3). This is also
    // the first route in the system to exercise RolesGuard end to end.
    const response = await http().get('/api/v1/cart').set(...bearer(admin)).expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------

describe('GET /cart', () => {
  it('returns an empty cart without creating a document', async () => {
    const fresh = await createCustomer('empty-cart');

    const response = await http().get('/api/v1/cart').set(...bearer(fresh)).expect(200);

    expect(response.body.data).toEqual({
      items: [],
      itemCount: 0,
      totalQuantity: 0,
      itemsSubtotal: { amount: 0, currency: 'EGP', formatted: '0.00 EGP' },
      currency: 'EGP',
      hasBlockingIssues: false,
      updatedAt: null,
      expiresAt: null,
    });

    // Lazily created: a registered customer who never adds anything costs no
    // storage at all.
    expect(await carts.findOne({ userId: fresh.id }).exec()).toBeNull();
  });

  it('is not cacheable', async () => {
    const response = await http().get('/api/v1/cart').set(...bearer(alice)).expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
  });
});

// ---------------------------------------------------------------------------

describe('POST /cart/items', () => {
  it('adds a line priced from the DATABASE, not from the request', async () => {
    await reset(alice);

    const response = await http()
      .post('/api/v1/cart/items')
      .set(...bearer(alice))
      .send({ productId: productId.onSale.toHexString(), quantity: 2 })
      .expect(200);

    const [line] = response.body.data.items;

    // The product has basePrice 40000 and salePrice 30000; the effective price
    // is what must be charged.
    expect(line.unitPrice).toEqual({ amount: 30000, currency: 'EGP', formatted: '300.00 EGP' });
    expect(line.lineTotal).toEqual({ amount: 60000, currency: 'EGP', formatted: '600.00 EGP' });
    expect(line.status).toBe('OK');
    expect(line.quantity).toBe(2);
    expect(response.body.data.itemsSubtotal.amount).toBe(60000);
    expect(response.body.data.totalQuantity).toBe(2);
    expect(response.body.data.itemCount).toBe(1);
  });

  it('IGNORES a client-supplied price by rejecting the request outright', async () => {
    await reset(alice);

    // The decisive test for "the client must not control price". There is no
    // field to carry one, so the attempt cannot even be expressed.
    for (const injected of [
      { unitPrice: 1 },
      { price: 1 },
      { currency: 'USD' },
      { lineTotal: 1 },
      { userId: bob.id.toHexString() },
    ]) {
      const response = await http()
        .post('/api/v1/cart/items')
        .set(...bearer(alice))
        .send({ productId: productId.plentiful.toHexString(), quantity: 1, ...injected })
        .expect(400);

      expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    }

    // And nothing was written while trying.
    const cart = await http().get('/api/v1/cart').set(...bearer(alice)).expect(200);
    expect(cart.body.data.items).toHaveLength(0);
  });

  it('is ADDITIVE and produces exactly one line per product', async () => {
    await reset(alice);
    const id = productId.plentiful.toHexString();

    await http().post('/api/v1/cart/items').set(...bearer(alice)).send({ productId: id, quantity: 2 }).expect(200);
    const second = await http()
      .post('/api/v1/cart/items')
      .set(...bearer(alice))
      .send({ productId: id, quantity: 3 })
      .expect(200);

    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].quantity).toBe(5);
    expect(second.body.data.itemCount).toBe(1);

    // Verified at the storage layer too, not merely in the projection.
    const stored = await carts.findOne({ userId: alice.id }).lean<CartLean>().exec();
    expect(stored?.items).toHaveLength(1);
  });

  it('clamps to available stock and flags the line rather than failing silently', async () => {
    await reset(alice);

    const response = await http()
      .post('/api/v1/cart/items')
      .set(...bearer(alice))
      .send({ productId: productId.scarce.toHexString(), quantity: 10 })
      .expect(200);

    const [line] = response.body.data.items;

    // Stock is 2. The cap is applied, and the response says so — a client can
    // tell the customer "only 2 left" without another request.
    expect(line.quantity).toBe(2);
    expect(line.availableQuantity).toBe(2);
    expect(line.effectiveQuantity).toBe(2);
    expect(line.status).toBe('OK');
  });

  it('clamps a repeated add at the stock ceiling instead of overshooting', async () => {
    await reset(alice);
    const id = productId.scarce.toHexString();

    await http().post('/api/v1/cart/items').set(...bearer(alice)).send({ productId: id, quantity: 2 }).expect(200);
    const second = await http()
      .post('/api/v1/cart/items')
      .set(...bearer(alice))
      .send({ productId: id, quantity: 2 })
      .expect(200);

    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].quantity).toBe(2);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['above the per-line maximum', 100],
    ['fractional', 1.5],
  ])('rejects a %s quantity', async (_label, quantity) => {
    const response = await http()
      .post('/api/v1/cart/items')
      .set(...bearer(alice))
      .send({ productId: productId.plentiful.toHexString(), quantity })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toContainEqual(
      expect.objectContaining({ field: 'quantity' }),
    );
  });

  it('rejects a malformed product id with 400, not a 500', async () => {
    const response = await http()
      .post('/api/v1/cart/items')
      .set(...bearer(alice))
      .send({ productId: 'not-an-object-id', quantity: 1 })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns PRODUCT_NOT_FOUND for an id that does not exist', async () => {
    const response = await http()
      .post('/api/v1/cart/items')
      .set(...bearer(alice))
      .send({ productId: new Types.ObjectId().toHexString(), quantity: 1 })
      .expect(404);

    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it.each<[string, keyof Fixtures]>([
    ['inactive', 'inactive'],
    ['soft-deleted', 'removed'],
  ])('refuses to add a %s product', async (_label, key) => {
    const response = await http()
      .post('/api/v1/cart/items')
      .set(...bearer(alice))
      .send({ productId: productId[key].toHexString(), quantity: 1 })
      .expect(409);

    expect(response.body.error.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('refuses a product with no stock, naming the SKU and what is available', async () => {
    const response = await http()
      .post('/api/v1/cart/items')
      .set(...bearer(alice))
      .send({ productId: productId.empty.toHexString(), quantity: 1 })
      .expect(409);

    expect(response.body.error.code).toBe('OUT_OF_STOCK');
    expect(response.body.error.details[0].message).toContain('CART-TEST-EMPTY');
    expect(response.body.error.details[0].message).toContain('0 available');
  });
});

// ---------------------------------------------------------------------------

describe('concurrency', () => {
  it('never produces two lines for one product under concurrent adds', async () => {
    // The invariant the whole repository is built to protect. A read-then-write
    // implementation fails this: every request reads "not present" before any
    // of them writes.
    const racer = await createCustomer('racer');
    const id = productId.plentiful.toHexString();

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        http()
          .post('/api/v1/cart/items')
          .set(...bearer(racer))
          .send({ productId: id, quantity: 1 }),
      ),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);

    const stored = await carts.findOne({ userId: racer.id }).lean<CartLean>().exec();

    // Exactly ONE cart, exactly ONE line, and every add counted.
    expect(await carts.countDocuments({ userId: racer.id }).exec()).toBe(1);
    expect(stored?.items).toHaveLength(1);
    expect(stored?.items[0]?.quantity).toBe(8);
  }, 60_000);

  it('does not clamp a line that appeared between the cap check and the clamp', async () => {
    // REGRESSION. Eight concurrent adds of one unit intermittently produced a
    // line of 50 — the product's whole stock — instead of 8.
    //
    // The cause was step B of `addItem`. Step A misses for TWO different
    // reasons: the line is already at the cap, or the line is not there at all.
    // B filtered only on "a line for this product exists" and inferred the
    // first, so a line created by a CONCURRENT request in the window between A
    // and B was clamped straight to `effectiveMax`.
    //
    // The concurrent test above reproduces this roughly one run in twelve,
    // which is not a regression test. This one forces the exact interleaving:
    // the line is inserted after step A has evaluated and before step B runs,
    // so the bug is deterministic and so is its absence.
    const racer = await createCustomer('racer-interleave');
    const repository = app.get(CartRepository);
    const snapshot = {
      name: { en: 'Cart Test plentiful', ar: null },
      sku: `CART-TEST-PLENTIFUL-${RUN_ID}`.toUpperCase(),
      slug: `cart-test-plentiful-${RUN_ID}`,
      unitPrice: 32500,
      imagePublicId: null,
    };

    const originalUpdateOne = carts.updateOne.bind(carts);
    const spy = jest.spyOn(carts, 'updateOne');

    // ONCE — only the first call, which is step A of the first attempt.
    spy.mockImplementationOnce(((filter: unknown, update: unknown) => {
      const query = originalUpdateOne(filter as never, update as never);

      return {
        exec: async () => {
          const result = await query.exec();

          // Step A has now evaluated against a cart that does not exist. THIS
          // is the concurrent request landing, at the one instant that used to
          // break the invariant.
          await carts.create({
            userId: racer.id,
            items: [
              {
                productId: productId.plentiful,
                quantity: 1,
                addedAt: new Date(),
                snapshot,
              },
            ],
            expiresAt: new Date(Date.now() + 60_000),
          });

          return result;
        },
      } as never;
    }) as never);

    try {
      // `effectiveMax` is 50 — `plentiful` has 50 on hand. Before the fix this
      // returned a line of 50.
      await repository.addItem(
        racer.id,
        { productId: productId.plentiful, quantity: 1, snapshot },
        50,
      );
    } finally {
      spy.mockRestore();
    }

    const stored = await carts.findOne({ userId: racer.id }).lean<CartLean>().exec();

    expect(stored?.items).toHaveLength(1);
    // 1 from the line that appeared + 1 from this add. Arithmetic, not the cap.
    expect(stored?.items[0]?.quantity).toBe(2);
  }, 60_000);

  it('creates exactly one cart when a brand-new customer adds concurrently', async () => {
    // Two different products, so the race is on creating the cart DOCUMENT
    // rather than on the line. The unique index on userId is what decides it.
    const racer = await createCustomer('racer-two');

    const responses = await Promise.all([
      http()
        .post('/api/v1/cart/items')
        .set(...bearer(racer))
        .send({ productId: productId.plentiful.toHexString(), quantity: 1 }),
      http()
        .post('/api/v1/cart/items')
        .set(...bearer(racer))
        .send({ productId: productId.onSale.toHexString(), quantity: 1 }),
    ]);

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(await carts.countDocuments({ userId: racer.id }).exec()).toBe(1);

    const stored = await carts.findOne({ userId: racer.id }).lean<CartLean>().exec();
    expect(stored?.items).toHaveLength(2);
  }, 60_000);
});

// ---------------------------------------------------------------------------

describe('PATCH /cart/items/:productId', () => {
  it('sets an absolute quantity', async () => {
    await reset(alice);
    const id = productId.plentiful.toHexString();

    await http().post('/api/v1/cart/items').set(...bearer(alice)).send({ productId: id, quantity: 5 }).expect(200);

    const response = await http()
      .patch(`/api/v1/cart/items/${id}`)
      .set(...bearer(alice))
      .send({ quantity: 2 })
      .expect(200);

    // Absolute, not additive — 2, never 7.
    expect(response.body.data.items[0].quantity).toBe(2);
    expect(response.body.data.totalQuantity).toBe(2);
  });

  it('clamps an update to available stock', async () => {
    await reset(alice);
    const id = productId.scarce.toHexString();

    await http().post('/api/v1/cart/items').set(...bearer(alice)).send({ productId: id, quantity: 1 }).expect(200);

    const response = await http()
      .patch(`/api/v1/cart/items/${id}`)
      .set(...bearer(alice))
      .send({ quantity: 99 })
      .expect(200);

    expect(response.body.data.items[0].quantity).toBe(2);
  });

  it('rejects quantity 0 — removal is DELETE', async () => {
    await reset(alice);
    const id = productId.plentiful.toHexString();
    await http().post('/api/v1/cart/items').set(...bearer(alice)).send({ productId: id, quantity: 1 }).expect(200);

    const response = await http()
      .patch(`/api/v1/cart/items/${id}`)
      .set(...bearer(alice))
      .send({ quantity: 0 })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns CART_ITEM_NOT_FOUND for a product that is not in the cart', async () => {
    await reset(alice);

    const response = await http()
      .patch(`/api/v1/cart/items/${productId.plentiful.toHexString()}`)
      .set(...bearer(alice))
      .send({ quantity: 1 })
      .expect(404);

    expect(response.body.error.code).toBe('CART_ITEM_NOT_FOUND');
  });

  it('rejects a price injected alongside the quantity', async () => {
    await reset(alice);
    const id = productId.plentiful.toHexString();
    await http().post('/api/v1/cart/items').set(...bearer(alice)).send({ productId: id, quantity: 1 }).expect(200);

    const response = await http()
      .patch(`/api/v1/cart/items/${id}`)
      .set(...bearer(alice))
      .send({ quantity: 2, unitPrice: 1 })
      .expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });
});

// ---------------------------------------------------------------------------

describe('DELETE /cart/items/:productId and DELETE /cart', () => {
  it('removes a line and returns the recomputed cart', async () => {
    await reset(alice);
    const keep = productId.plentiful.toHexString();
    const drop = productId.onSale.toHexString();

    await http().post('/api/v1/cart/items').set(...bearer(alice)).send({ productId: keep, quantity: 1 }).expect(200);
    await http().post('/api/v1/cart/items').set(...bearer(alice)).send({ productId: drop, quantity: 1 }).expect(200);

    const response = await http()
      .delete(`/api/v1/cart/items/${drop}`)
      .set(...bearer(alice))
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].productId).toBe(keep);
    expect(response.body.data.itemsSubtotal.amount).toBe(32500);
  });

  it('is idempotent for a line that is not there', async () => {
    await reset(alice);

    const first = await http()
      .delete(`/api/v1/cart/items/${productId.plentiful.toHexString()}`)
      .set(...bearer(alice))
      .expect(200);
    const second = await http()
      .delete(`/api/v1/cart/items/${productId.plentiful.toHexString()}`)
      .set(...bearer(alice))
      .expect(200);

    expect(first.body.data.items).toHaveLength(0);
    // Byte-identical, INCLUDING updatedAt and expiresAt: a no-op remove must
    // not write, or a client polling DELETE would keep renewing the 30-day TTL
    // on a cart nobody is using.
    expect(second.body.data).toEqual(first.body.data);
  });

  it('clears a populated cart', async () => {
    await reset(alice);
    await http()
      .post('/api/v1/cart/items')
      .set(...bearer(alice))
      .send({ productId: productId.plentiful.toHexString(), quantity: 3 })
      .expect(200);

    const response = await http().delete('/api/v1/cart').set(...bearer(alice)).expect(200);

    expect(response.body.data.items).toHaveLength(0);
    expect(response.body.data.itemsSubtotal.amount).toBe(0);
    expect(response.body.data.totalQuantity).toBe(0);
  });

  it('clears an already-empty cart, and a cart that never existed', async () => {
    const fresh = await createCustomer('never-carted');

    await http().delete('/api/v1/cart').set(...bearer(fresh)).expect(200);
    await http().delete('/api/v1/cart').set(...bearer(fresh)).expect(200);
  });
});

// ---------------------------------------------------------------------------

describe('ownership', () => {
  it('keeps two customers’ carts completely separate', async () => {
    await reset(alice);
    await reset(bob);

    await http()
      .post('/api/v1/cart/items')
      .set(...bearer(alice))
      .send({ productId: productId.plentiful.toHexString(), quantity: 4 })
      .expect(200);

    const bobsCart = await http().get('/api/v1/cart').set(...bearer(bob)).expect(200);
    expect(bobsCart.body.data.items).toHaveLength(0);

    const alicesCart = await http().get('/api/v1/cart').set(...bearer(alice)).expect(200);
    expect(alicesCart.body.data.items[0].quantity).toBe(4);
  });

  it('cannot be crossed by naming a product that is in someone else’s cart', async () => {
    await reset(alice);
    await reset(bob);
    const id = productId.plentiful.toHexString();

    await http().post('/api/v1/cart/items').set(...bearer(alice)).send({ productId: id, quantity: 4 }).expect(200);

    // Bob knows the product id — it is public catalogue data. Ownership is a
    // QUERY FILTER, so his update simply matches nothing in his own cart.
    const patched = await http()
      .patch(`/api/v1/cart/items/${id}`)
      .set(...bearer(bob))
      .send({ quantity: 99 })
      .expect(404);
    expect(patched.body.error.code).toBe('CART_ITEM_NOT_FOUND');

    await http().delete(`/api/v1/cart/items/${id}`).set(...bearer(bob)).expect(200);
    await http().delete('/api/v1/cart').set(...bearer(bob)).expect(200);

    // Alice's cart is untouched by every one of those.
    const alicesCart = await http().get('/api/v1/cart').set(...bearer(alice)).expect(200);
    expect(alicesCart.body.data.items).toHaveLength(1);
    expect(alicesCart.body.data.items[0].quantity).toBe(4);
  });
});

// ---------------------------------------------------------------------------

describe('live re-pricing and line status', () => {
  it('reports PRICE_CHANGED at the NEW price when the catalogue moves', async () => {
    const shopper = await createCustomer('price-watch');
    const id = await createProduct('pricewatch', { onHand: 20, basePrice: 10000 });
    const hex = id.toHexString();

    await http().post('/api/v1/cart/items').set(...bearer(shopper)).send({ productId: hex, quantity: 2 }).expect(200);

    // The catalogue repriced after the customer added the line.
    await products
      .updateOne({ _id: id }, { $set: { 'pricing.basePrice': 12000, 'pricing.effectivePrice': 12000 } })
      .exec();

    const response = await http().get('/api/v1/cart').set(...bearer(shopper)).expect(200);
    const [line] = response.body.data.items;

    expect(line.status).toBe('PRICE_CHANGED');
    // The NEW price applies, and the old one is returned so the client can show
    // the change rather than charge a price the customer never saw.
    expect(line.unitPrice.amount).toBe(12000);
    expect(line.previousUnitPrice.amount).toBe(10000);
    expect(line.lineTotal.amount).toBe(24000);
    expect(response.body.data.itemsSubtotal.amount).toBe(24000);
  });

  it('reports REDUCED_STOCK and counts the clamped quantity, without rewriting intent', async () => {
    const shopper = await createCustomer('stock-drop');
    const id = await createProduct('stockdrop', { onHand: 20, basePrice: 10000 });
    const hex = id.toHexString();

    await http().post('/api/v1/cart/items').set(...bearer(shopper)).send({ productId: hex, quantity: 5 }).expect(200);
    await products.updateOne({ _id: id }, { $set: { 'stock.onHand': 3 } }).exec();

    const response = await http().get('/api/v1/cart').set(...bearer(shopper)).expect(200);
    const [line] = response.body.data.items;

    expect(line.status).toBe('REDUCED_STOCK');
    expect(line.quantity).toBe(5); // intent preserved
    expect(line.effectiveQuantity).toBe(3); // what will be charged
    expect(line.lineTotal.amount).toBe(30000);
    expect(response.body.data.hasBlockingIssues).toBe(false);

    // A GET is SAFE: it must not have rewritten the stored quantity.
    const stored = await carts.findOne({ userId: shopper.id }).lean<CartLean>().exec();
    expect(stored?.items[0]?.quantity).toBe(5);

    // And when stock returns, the line recovers on its own.
    await products.updateOne({ _id: id }, { $set: { 'stock.onHand': 20 } }).exec();
    const recovered = await http().get('/api/v1/cart').set(...bearer(shopper)).expect(200);
    expect(recovered.body.data.items[0].status).toBe('OK');
    expect(recovered.body.data.items[0].effectiveQuantity).toBe(5);
  });

  it('keeps an OUT_OF_STOCK line visible but out of the subtotal, and blocks checkout', async () => {
    const shopper = await createCustomer('stock-gone');
    const id = await createProduct('stockgone', { onHand: 5, basePrice: 10000 });

    await http()
      .post('/api/v1/cart/items')
      .set(...bearer(shopper))
      .send({ productId: id.toHexString(), quantity: 2 })
      .expect(200);
    await http()
      .post('/api/v1/cart/items')
      .set(...bearer(shopper))
      .send({ productId: productId.plentiful.toHexString(), quantity: 1 })
      .expect(200);

    await products.updateOne({ _id: id }, { $set: { 'stock.onHand': 0 } }).exec();

    const response = await http().get('/api/v1/cart').set(...bearer(shopper)).expect(200);
    const line = response.body.data.items.find((item: { productId: string }) => item.productId === id.toHexString());

    // Retained, not silently deleted — the customer must see WHY the total moved.
    expect(line.status).toBe('OUT_OF_STOCK');
    expect(line.lineTotal.amount).toBe(0);
    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.itemsSubtotal.amount).toBe(32500);
    expect(response.body.data.hasBlockingIssues).toBe(true);
  });

  it('keeps a delisted line visible as UNAVAILABLE', async () => {
    const shopper = await createCustomer('delisted');
    const id = await createProduct('delisted', { onHand: 5, basePrice: 10000 });

    await http()
      .post('/api/v1/cart/items')
      .set(...bearer(shopper))
      .send({ productId: id.toHexString(), quantity: 2 })
      .expect(200);

    await products.updateOne({ _id: id }, { $set: { isActive: false } }).exec();

    const response = await http().get('/api/v1/cart').set(...bearer(shopper)).expect(200);
    const [line] = response.body.data.items;

    expect(line.status).toBe('UNAVAILABLE');
    expect(line.lineTotal.amount).toBe(0);
    expect(response.body.data.itemsSubtotal.amount).toBe(0);
    expect(response.body.data.hasBlockingIssues).toBe(true);
    // Still renderable: the display snapshot is what makes that possible.
    expect(line.name).toContain('Cart Test');
  });

  it('survives a product being hard-deleted underneath the cart', async () => {
    const shopper = await createCustomer('hard-deleted');
    const id = await createProduct('harddelete', { onHand: 5, basePrice: 10000 });

    await http()
      .post('/api/v1/cart/items')
      .set(...bearer(shopper))
      .send({ productId: id.toHexString(), quantity: 1 })
      .expect(200);

    await products.deleteOne({ _id: id }).exec();

    const response = await http().get('/api/v1/cart').set(...bearer(shopper)).expect(200);
    const [line] = response.body.data.items;

    expect(line.status).toBe('UNAVAILABLE');
    expect(line.lineTotal.amount).toBe(0);
    // Rendered from the snapshot rather than as a blank row.
    expect(line.sku).toContain('CART-TEST-HARDDELETE');
  });
});

// ---------------------------------------------------------------------------

describe('response contract', () => {
  it('returns the identical cart shape from every endpoint', async () => {
    await reset(alice);
    const id = productId.plentiful.toHexString();

    const shapes = [
      (await http().post('/api/v1/cart/items').set(...bearer(alice)).send({ productId: id, quantity: 1 })).body.data,
      (await http().get('/api/v1/cart').set(...bearer(alice))).body.data,
      (await http().patch(`/api/v1/cart/items/${id}`).set(...bearer(alice)).send({ quantity: 2 })).body.data,
      (await http().delete(`/api/v1/cart/items/${id}`).set(...bearer(alice))).body.data,
      (await http().delete('/api/v1/cart').set(...bearer(alice))).body.data,
    ];

    // One Dart model for all five endpoints.
    for (const shape of shapes) {
      expect(Object.keys(shape).sort()).toEqual([
        'currency',
        'expiresAt',
        'hasBlockingIssues',
        'itemCount',
        'itemsSubtotal',
        'totalQuantity',
        'items',
        'updatedAt',
      ].sort());
    }
  });

  it('never leaks costPrice or internal product state into a cart line', async () => {
    await reset(alice);
    const response = await http()
      .post('/api/v1/cart/items')
      .set(...bearer(alice))
      .send({ productId: productId.plentiful.toHexString(), quantity: 1 })
      .expect(200);

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('costPrice');
    expect(body).not.toContain('isActive');
    expect(body).not.toContain('deletedAt');
    expect(body).not.toContain('snapshot');
  });
});

// ---------------------------------------------------------------------------

describe('the rest of the API is unaffected', () => {
  it.each([
    '/api/v1/health',
    '/api/v1/products?limit=1',
    '/api/v1/categories',
    '/api/v1/brands',
  ])('%s is still public', async (path) => {
    await http().get(path).expect(200);
  });

  it('leaves the seeded catalogue intact', async () => {
    // The suite created and destroyed its own products; the development seed
    // must be exactly as it was.
    const seeded = await products.countDocuments({ slug: { $not: /^cart-test-/ } }).exec();
    expect(seeded).toBe(26);
  });
});
