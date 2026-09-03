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
import { Cart } from '../../src/modules/cart/infrastructure/schemas/cart.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { InventoryEvent } from '../../src/modules/inventory/infrastructure/schemas/inventory-event.schema';
import {
  MAX_SEARCH_LENGTH,
  escapeForRegex,
  parseOrderSearch,
} from '../../src/modules/orders/domain/order-search';
import { OrderStatus } from '../../src/modules/orders/domain/order-status';
import { IdempotencyKeyRecord } from '../../src/modules/orders/infrastructure/schemas/idempotency-key.schema';
import { Order } from '../../src/modules/orders/infrastructure/schemas/order.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * The order work queue: searching it, narrowing it by date, ordering it, and
 * counting it — against the real application and a real database.
 *
 * ## Why this is a separate suite from `admin-orders.spec.ts`
 *
 * That one is about the LIFECYCLE: an order is confirmed, shipped and delivered
 * through the real endpoints and the money and stock consequences are checked.
 * This one is about FINDING an order, which needs a different fixture — several
 * customers with deliberately distinguishable names, emails and phones, and
 * orders with deliberately different totals and placement times. Merging them
 * would make one setup serve two unrelated purposes badly.
 *
 * ## Isolation
 *
 * Own accounts, own product, own orders, all removed by tracked id in
 * `afterAll`. No `dropDatabase` and no broad `deleteMany({})`.
 *
 * Counting endpoints are the exception to "assert an exact number": the stats
 * endpoint counts EVERY order in the database, including the seeded sandbox one
 * and anything another suite is mid-way through. So the assertions here are the
 * ones that stay true regardless — that the parts sum to the whole, that every
 * status is present, and that two endpoints asked the same question agree —
 * rather than a hard-coded total that would fail for reasons unrelated to the
 * queue.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';

let app: INestApplication;
let users: Model<User>;
let carts: Model<Cart>;
let products: Model<Product>;
let orders: Model<Order>;
let idempotencyKeys: Model<IdempotencyKeyRecord>;
let refreshTokens: Model<RefreshToken>;
let inventoryEvents: Model<InventoryEvent>;

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

/** Well-formed, so `RolesGuard` refuses before the validation pipe is reached. */
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
      street: '12 Sherif Street, Apartment 4',
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
  const email = `queue-${label}.${RUN_ID}@example.test`;
  const fullName = options.fullName ?? `Queue ${label}`;
  const phone = options.phone ?? '01012345678';

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

async function createProduct(unitPrice: number): Promise<Types.ObjectId> {
  const category = await app
    .get<Model<Category>>(getModelToken(Category.name))
    .findOne({ slug: 'development-boards' })
    .lean<{ _id: Types.ObjectId; slug: string; name: { en: string }; path: Types.ObjectId[] }>()
    .exec();

  if (category === null) {
    throw new Error('seed category development-boards is missing — run `pnpm --filter api seed`');
  }

  const created = await products.create({
    sku: `QUEUE-${RUN_ID}`,
    slug: `queue-test-${RUN_ID}`,
    name: { en: 'Queue Test Board', ar: null },
    shortDescription: { en: 'Created by the admin-order-queue test suite.', ar: null },
    description: null,
    category: {
      id: category._id,
      slug: category.slug,
      name: { en: category.name.en, ar: null },
      path: [...category.path, category._id],
    },
    brand: null,
    pricing: { basePrice: unitPrice, salePrice: null, effectivePrice: unitPrice, costPrice: 100 },
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

/** Places one order of `quantity` units, through the real endpoints. */
async function placeOrder(customer: Account, quantity: number): Promise<string> {
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

/** The queue, as staff, with whatever query string is under test. */
function queue(query: string) {
  return http()
    .get(`/api/v1/admin/orders${query}`)
    .set(...bearer(admin));
}

/** Just the order numbers of a queue response, in the order returned. */
function numbersOf(body: unknown): string[] {
  return (body as { data: { orderNumber: string }[] }).data.map((row) => row.orderNumber);
}

let admin: Account;
let customer: Account;
let hunt: Account;
let product: Types.ObjectId;

/** The three orders this suite searches for, by order number. */
let cheapOrder = '';
let middleOrder = '';
let dearOrder = '';

/** The instants they are given, so date filtering has something to bite on. */
const OLD_PLACED_AT = new Date('2026-01-05T09:00:00.000Z');
const BOUNDARY_PLACED_AT = new Date('2026-02-10T23:30:00.000Z');
const RECENT_PLACED_AT = new Date('2026-03-20T12:00:00.000Z');

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

  admin = await createAccount('operator', { role: Role.ADMIN });

  /*
   * Two customers whose details are deliberately unlike each other, so a search
   * that matched the wrong field would return the wrong order rather than the
   * right one by luck. `Zerlinda Quinteros` shares no substring with
   * `Queue buyer`, and the phone numbers differ in every digit that matters.
   */
  customer = await createAccount('buyer', { fullName: 'Queue Buyer', phone: '01011112222' });
  hunt = await createAccount('hunted', {
    fullName: 'Zerlinda Quinteros',
    phone: '01099998888',
  });

  product = await createProduct(1_000);

  cheapOrder = await placeOrder(customer, 1);
  middleOrder = await placeOrder(hunt, 3);
  dearOrder = await placeOrder(customer, 7);

  /*
   * Placement times are set directly, and only these three.
   *
   * `placedAt` is not lifecycle state — nothing in the state machine reads it,
   * and no invariant depends on it — so writing it is not the "hand-written
   * lifecycle" this repository refuses. The alternative is waiting real days
   * between placements, which is not a test.
   */
  await orders.updateOne({ _id: new Types.ObjectId(cheapOrder) }, { $set: { placedAt: OLD_PLACED_AT } }).exec();
  await orders
    .updateOne({ _id: new Types.ObjectId(middleOrder) }, { $set: { placedAt: BOUNDARY_PLACED_AT } })
    .exec();
  await orders.updateOne({ _id: new Types.ObjectId(dearOrder) }, { $set: { placedAt: RECENT_PLACED_AT } }).exec();
}, 120_000);

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    /*
     * The events BEFORE the orders they refer to.
     *
     * Placing an order writes an inventory event, and deleting the order does
     * not remove it — so this suite left three orphaned ledger rows per run
     * until the residue check named them. Stock needs no restoring here: the
     * only product involved is this suite's own, and it is deleted below.
     */
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

// ---------------------------------------------------------------------------

describe('the search term, before it reaches a database', () => {
  /*
   * These need no database, and that is the point: every property that matters
   * about escaping is decidable from the input alone, so it can be checked
   * exhaustively and instantly.
   */

  it('turns regular-expression syntax into itself', () => {
    expect(escapeForRegex('a.b')).toBe('a\\.b');
    expect(escapeForRegex('(a+)+$')).toBe('\\(a\\+\\)\\+\\$');
  });

  it('a full stop matches a full stop and NOT any character', () => {
    /*
     * The half that proves the guarantee can fail. An unescaped `a.b` matches
     * `axb`; the escaped one must not. Without this assertion the escaping
     * could be a no-op and every other search test would still pass.
     */
    expect(new RegExp('a.b').test('axb')).toBe(true);

    const term = parseOrderSearch('a.b');

    expect(term).not.toBeNull();
    expect((term as NonNullable<typeof term>).contains.test('axb')).toBe(false);
    expect((term as NonNullable<typeof term>).contains.test('a.b')).toBe(true);
  });

  it('a backtracking bomb is nine ordinary characters', () => {
    // Catastrophic backtracking needs nested quantifiers. A pattern built only
    // from literals has none, so this is a match attempt rather than a hang.
    const term = parseOrderSearch('(a+)+$');

    expect(term).not.toBeNull();
    expect((term as NonNullable<typeof term>).contains.test('aaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect((term as NonNullable<typeof term>).contains.test('x(a+)+$y')).toBe(true);
  });

  it('anchors the prefix pattern and does not anchor the contains pattern', () => {
    const term = parseOrderSearch('NE-2026');

    expect(term).not.toBeNull();
    expect((term as NonNullable<typeof term>).prefix.test('NE-20260903-0001')).toBe(true);
    expect((term as NonNullable<typeof term>).prefix.test('X-NE-20260903-0001')).toBe(false);
  });

  it('is not a search when there is nothing to search for', () => {
    // An empty pattern matches everything, so a blank term must be absent
    // rather than empty — otherwise `?q=%20` silently returns the whole queue.
    expect(parseOrderSearch('')).toBeNull();
    expect(parseOrderSearch('   ')).toBeNull();
    expect(parseOrderSearch('\t\n')).toBeNull();
  });

  it('reads a phone number through whatever separators were typed', () => {
    const spaced = parseOrderSearch('010 9999 8888');
    const dashed = parseOrderSearch('010-9999-8888');

    expect(spaced?.digits?.source).toBe('01099998888');
    expect(dashed?.digits?.source).toBe('01099998888');
  });

  it('ignores a digit fragment too short to be a search', () => {
    // Three digits match a quarter of the phone numbers in any database. That
    // is noise wearing the shape of a result.
    expect(parseOrderSearch('123')?.digits).toBeNull();
    expect(parseOrderSearch('1234')?.digits).not.toBeNull();
  });

  it('bounds the term before compiling it', () => {
    const term = parseOrderSearch('x'.repeat(MAX_SEARCH_LENGTH * 2));

    expect(term).not.toBeNull();
    expect((term as NonNullable<typeof term>).contains.source).toHaveLength(MAX_SEARCH_LENGTH);
  });
});

describe('searching the queue', () => {
  it('finds an order by the start of its order number', async () => {
    const order = await orders.findById(new Types.ObjectId(middleOrder)).lean().exec();
    const number = (order as { orderNumber: string }).orderNumber;

    const response = await queue(`?q=${encodeURIComponent(number)}`).expect(200);

    expect(numbersOf(response.body)).toContain(number);
  });

  it('finds an order by the customer’s email address', async () => {
    const response = await queue(`?q=${encodeURIComponent(hunt.email)}`).expect(200);
    const numbers = numbersOf(response.body);
    const hunted = await orders.findById(new Types.ObjectId(middleOrder)).lean().exec();

    expect(numbers).toEqual([(hunted as { orderNumber: string }).orderNumber]);
  });

  it('finds an order by part of the customer’s name, whatever the case', async () => {
    // The order carries a SNAPSHOT of the customer, so this keeps working after
    // that customer changes their name — which is the point of the snapshot.
    const response = await queue('?q=quinteros').expect(200);
    const hunted = await orders.findById(new Types.ObjectId(middleOrder)).lean().exec();

    expect(numbersOf(response.body)).toEqual([(hunted as { orderNumber: string }).orderNumber]);
  });

  it('finds an order by phone number typed with separators', async () => {
    const response = await queue(`?q=${encodeURIComponent('010-9999-8888')}`).expect(200);
    const hunted = await orders.findById(new Types.ObjectId(middleOrder)).lean().exec();

    expect(numbersOf(response.body)).toEqual([(hunted as { orderNumber: string }).orderNumber]);
  });

  it('treats regular-expression syntax as text, so a wildcard finds nothing', async () => {
    /*
     * `Q....` would match "Queue" and "Quinteros" if `.` were a wildcard. It is
     * not, and there is no customer literally called that — so an empty result
     * here is the escaping working, and a non-empty one is a query built from a
     * client string.
     */
    const response = await queue(`?q=${encodeURIComponent('Q....')}`).expect(200);

    expect(response.body.data).toEqual([]);
  });

  it('a blank search is not a filter', async () => {
    const blank = await queue(`?q=${encodeURIComponent('   ')}`).expect(200);
    const unfiltered = await queue('').expect(200);

    expect(blank.body.meta.total).toBe(unfiltered.body.meta.total);
  });

  it('narrows within a status rather than replacing it', async () => {
    const response = await queue(`?q=quinteros&status=${OrderStatus.DELIVERED}`).expect(200);

    // The hunted order is PLACED, so a DELIVERED filter must exclude it even
    // though the search matches. An `$or` that escaped the `$and` would not.
    expect(response.body.data).toEqual([]);
  });
});

describe('narrowing the queue by date', () => {
  async function numbersBetween(query: string): Promise<string[]> {
    const response = await queue(`${query}&limit=100`).expect(200);

    return numbersOf(response.body);
  }

  it('excludes orders placed before the lower bound', async () => {
    const numbers = await numbersBetween('?placedFrom=2026-02-01');
    const old = await orders.findById(new Types.ObjectId(cheapOrder)).lean().exec();

    expect(numbers).not.toContain((old as { orderNumber: string }).orderNumber);
  });

  it('includes everything placed ON the upper-bound day', async () => {
    /*
     * The one that is wrong by default. `?placedTo=2026-02-10` parsed as a
     * plain instant is midnight at the START of the tenth, so an order placed
     * at 23:30 that day is silently excluded — the filter returns fewer orders
     * than it should and looks like it worked.
     */
    const numbers = await numbersBetween('?placedFrom=2026-02-01&placedTo=2026-02-10');
    const boundary = await orders.findById(new Types.ObjectId(middleOrder)).lean().exec();

    expect(numbers).toContain((boundary as { orderNumber: string }).orderNumber);
  });

  it('a timestamp bound is taken literally, not widened to the day', async () => {
    // The other half: end-of-day is what a DATE means, not what an instant
    // means. Widening a timestamp would make a precise query imprecise.
    const numbers = await numbersBetween(
      '?placedFrom=2026-02-01&placedTo=2026-02-10T12:00:00.000Z',
    );
    const boundary = await orders.findById(new Types.ObjectId(middleOrder)).lean().exec();

    expect(numbers).not.toContain((boundary as { orderNumber: string }).orderNumber);
  });

  it('combines both bounds into one window', async () => {
    const numbers = await numbersBetween('?placedFrom=2026-02-01&placedTo=2026-02-28');
    const [old, boundary, recent] = await Promise.all(
      [cheapOrder, middleOrder, dearOrder].map(async (id) =>
        orders.findById(new Types.ObjectId(id)).lean().exec(),
      ),
    );

    expect(numbers).toContain((boundary as { orderNumber: string }).orderNumber);
    expect(numbers).not.toContain((old as { orderNumber: string }).orderNumber);
    expect(numbers).not.toContain((recent as { orderNumber: string }).orderNumber);
  });
});

describe('ordering the queue', () => {
  /** This suite's three orders only, in the order the API returned them. */
  async function mineInOrder(sort: string): Promise<number[]> {
    const response = await queue(`?sort=${sort}&limit=100`).expect(200);
    const rows = (response.body as {
      data: { id: string; pricing: { grandTotal: { amount: number } } }[];
    }).data;
    const mine = new Set(createdOrderIds.map((id) => id.toHexString()));

    return rows.filter((row) => mine.has(row.id)).map((row) => row.pricing.grandTotal.amount);
  }

  it('defaults to newest first', async () => {
    const response = await queue('?limit=100').expect(200);
    const rows = (response.body as { data: { placedAt: string }[] }).data;
    const times = rows.map((row) => Date.parse(row.placedAt));

    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('reverses to oldest first', async () => {
    const response = await queue('?sort=oldest&limit=100').expect(200);
    const times = (response.body as { data: { placedAt: string }[] }).data.map((row) =>
      Date.parse(row.placedAt),
    );

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('orders by grand total, highest first', async () => {
    const mine = await mineInOrder('total_high');

    // Scoped to this suite's own orders and to the grandTotal FIELD — a
    // page-wide check would be satisfied by any other suite's data.
    expect(mine).toEqual([...mine].sort((a, b) => b - a));
    expect(mine[0]).toBeGreaterThan(mine[mine.length - 1] as number);
  });

  it('orders by grand total, lowest first', async () => {
    const mine = await mineInOrder('total_low');

    expect(mine).toEqual([...mine].sort((a, b) => a - b));
  });

  it('pages a money-ordered queue without skipping or repeating a row', async () => {
    /*
     * The reason every sort ends in `_id`. Two orders can share a grand total
     * exactly; without a unique tail the order between them is undefined, and
     * offset pagination then drops one row and shows another twice. The bug
     * looks like missing orders and reproduces on nobody's machine.
     */
    const first = await queue('?sort=total_high&limit=2&page=1').expect(200);
    const second = await queue('?sort=total_high&limit=2&page=2').expect(200);

    const firstIds = (first.body as { data: { id: string }[] }).data.map((row) => row.id);
    const secondIds = (second.body as { data: { id: string }[] }).data.map((row) => row.id);

    expect(firstIds).toHaveLength(2);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
  });

  it('a total-ordered page still reports the true match count', async () => {
    const byDate = await queue('?limit=1').expect(200);
    const byTotal = await queue('?sort=total_high&limit=1').expect(200);

    // Ordering changes which rows come back, never how many match.
    expect(byTotal.body.meta.total).toBe(byDate.body.meta.total);
  });
});

describe('counting the queue in one request', () => {
  function stats() {
    return http()
      .get('/api/v1/admin/orders/stats')
      .set(...bearer(admin));
  }

  it('reports every lifecycle status, including the ones nothing is in', async () => {
    const response = await stats().expect(200);
    const returned = (response.body as { data: { byStatus: { status: string }[] } }).data.byStatus;

    expect(returned.map((row) => row.status).sort()).toEqual(Object.values(OrderStatus).sort());
  });

  it('the parts sum to the whole', async () => {
    const response = await stats().expect(200);
    const data = (response.body as {
      data: { byStatus: { count: number }[]; total: number };
    }).data;

    // Both numbers come from one aggregation at one instant, so this holds by
    // construction — which is exactly what seven separate requests could not
    // promise, and why the tiles used not to add up to the total beside them.
    expect(data.byStatus.reduce((sum, row) => sum + row.count, 0)).toBe(data.total);
  });

  it('agrees with the number the list endpoint reports for the same status', async () => {
    const response = await stats().expect(200);
    const byStatus = (response.body as {
      data: { byStatus: { status: string; count: number }[] };
    }).data.byStatus;
    const placed = byStatus.find((row) => row.status === OrderStatus.PLACED);

    const list = await queue(`?status=${OrderStatus.PLACED}&limit=1`).expect(200);

    expect(placed?.count).toBe(list.body.meta.total);
  });

  it('is not reachable by the path parameter it sits beside', async () => {
    /*
     * `stats` is declared before `:id`. With the declarations the other way
     * round this path binds `id = 'stats'`, fails the 24-hex check, and answers
     * a documented endpoint with a validation error about an order id.
     */
    const response = await stats().expect(200);

    expect(response.body.data).toHaveProperty('total');
  });
});

describe('the queue is not an enumeration surface', () => {
  it('refuses an unauthenticated search', async () => {
    await http().get('/api/v1/admin/orders?q=quinteros').expect(401);
  });

  it('refuses an unauthenticated count', async () => {
    await http().get('/api/v1/admin/orders/stats').expect(401);
  });

  it('refuses a CUSTOMER’s search, even for their own details', async () => {
    /*
     * The important one. Search reads the customer snapshot on every order in
     * the system, so a customer who could call it could enumerate other
     * people's names, emails and phone numbers by trying prefixes.
     */
    await http()
      .get('/api/v1/admin/orders?q=quinteros')
      .set(...bearer(customer))
      .expect(403);
  });

  it('refuses a CUSTOMER’s count', async () => {
    await http()
      .get('/api/v1/admin/orders/stats')
      .set(...bearer(customer))
      .expect(403);
  });
});

describe('what the queue refuses to accept', () => {
  it('rejects an undocumented query parameter rather than ignoring it', async () => {
    // `?userId=` is the one a caller is most likely to try. Ignoring it would
    // answer the unfiltered queue while looking like it had been scoped.
    await queue('?userId=652f1a9b3c4d5e6f7a8b9c0d').expect(400);
  });

  it('rejects a sort it does not serve', async () => {
    const response = await queue('?sort=createdAt').expect(400);

    expect(JSON.stringify(response.body)).toContain('sort must be one of');
  });

  it('rejects an unparseable date rather than dropping the filter', async () => {
    // Dropping it would answer a malformed request with the unfiltered queue.
    await queue('?placedFrom=last-tuesday').expect(400);
  });

  it('rejects a search term longer than the bound', async () => {
    await queue(`?q=${'x'.repeat(MAX_SEARCH_LENGTH + 1)}`).expect(400);
  });
});

describe('index usage', () => {
  function winningPlanOf(explain: unknown): string {
    return JSON.stringify(
      (explain as { queryPlanner: { winningPlan: unknown } }).queryPlanner.winningPlan,
    );
  }

  it('serves a money-ordered queue from order_admin_total, with no blocking sort', async () => {
    const plan = winningPlanOf(
      await orders
        .find({})
        .sort({ 'pricing.grandTotal': -1, _id: -1 })
        .limit(24)
        .explain('executionStats'),
    );

    expect(plan).toContain('order_admin_total');
    expect(plan).toContain('IXSCAN');
    expect(plan).not.toContain('COLLSCAN');
    expect(plan).not.toContain('"stage":"SORT"');
  });

  it('walks the same index backwards for lowest-first', async () => {
    // One index serves both directions. A second ascending index would cost
    // writes and buy nothing.
    const plan = winningPlanOf(
      await orders
        .find({})
        .sort({ 'pricing.grandTotal': 1, _id: 1 })
        .limit(24)
        .explain('executionStats'),
    );

    expect(plan).toContain('order_admin_total');
    expect(plan).not.toContain('"stage":"SORT"');
  });

  it('serves a date-narrowed queue from order_admin_queue', async () => {
    const plan = winningPlanOf(
      await orders
        .find({ placedAt: { $gte: OLD_PLACED_AT, $lte: RECENT_PLACED_AT } })
        .sort({ placedAt: -1, _id: -1 })
        .limit(24)
        .explain('executionStats'),
    );

    expect(plan).toContain('order_admin_queue');
    expect(plan).toContain('IXSCAN');
    expect(plan).not.toContain('"stage":"SORT"');
  });

  it('declares both new indexes to the readiness probe', async () => {
    /*
     * `IndexHealthService` derives what it expects from `model.schema.indexes()`,
     * so declaring an index on the schema is what puts it in the readiness
     * probe's list. This asserts that rather than assuming it: eight invariants
     * in this repository depend on indexes, and an index the probe does not
     * know about is one `indexes:sync` away from silently absent.
     */
    const declared = orders.schema.indexes().map(([, options]) => options?.name);

    expect(declared).toContain('order_admin_total');
    expect(declared).toContain('order_customer_email');
  });
});
