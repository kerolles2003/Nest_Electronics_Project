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
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import {
  InventoryEvent,
  InventoryEventType,
} from '../../src/modules/inventory/infrastructure/schemas/inventory-event.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * `/admin/inventory` — the operations that move stock outside an order.
 *
 * ## What is being replaced, and the two facts about it
 *
 * The console's inventory screen calls Supabase's `adjust_stock_v2`. Two things
 * are true of that function and both are in the frozen record: **`EXECUTE` was
 * granted to `anon`** (F-CRIT-1), and **zero `adjustment` events exist in
 * production**, so it never once completed successfully.
 *
 * Its semantics are preserved because they were well designed — a signed delta,
 * a required reason, a floor at zero. What is proved here is that the execution
 * path works and that the guarantees are real:
 *
 *  - stock and its ledger entry move in ONE transaction, so the invariant
 *    `Σ quantityDelta == stock.onHand` holds and is checkable;
 *  - the floor is enforced inside the update, so a refusal is not a race;
 *  - the actor comes from the token and cannot be named by the caller;
 *  - `stock` is unreachable through any other write in the system.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const USER_AGENT = `InventorySuite/1.0 (${RUN_ID})`;

let app: INestApplication;
let users: Model<User>;
let products: Model<Product>;
let categories: Model<Category>;
let events: Model<InventoryEvent>;
let auditLogs: Model<AuditLog>;
let refreshTokens: Model<RefreshToken>;

const createdUserIds: Types.ObjectId[] = [];
const createdProductIds: Types.ObjectId[] = [];
const createdCategoryIds: Types.ObjectId[] = [];

interface Account {
  readonly id: Types.ObjectId;
  readonly token: string;
}

let admin: Account;
let customer: Account;
let category: { _id: Types.ObjectId; slug: string };

function http(): request.Agent {
  return request(app.getHttpServer());
}

function bearer(account: Account): [string, string] {
  return ['Authorization', `Bearer ${account.token}`];
}

async function createAccount(label: string, role: Role = Role.CUSTOMER): Promise<Account> {
  const email = `inv-${label}.${RUN_ID}@example.test`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: `Inventory ${label}` })
    .expect(201);

  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } }).exec();

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  const login = await http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);

  return { id: created._id, token: login.body.data.accessToken as string };
}

/**
 * A product created through the API, so it starts at `onHand: 0` — which is the
 * real starting state for anything the catalogue endpoints create.
 */
async function makeProduct(
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; sku: string }> {
  const tag = randomUUID().slice(0, 6);

  const response = await http()
    .post('/api/v1/admin/catalog/products')
    .set(...bearer(admin))
    .send({
      sku: `INV-${RUN_ID}-${tag}`.toUpperCase(),
      slug: `inv-${RUN_ID}-${tag}`,
      name: { en: 'Stocked Item' },
      categoryId: category._id.toHexString(),
      basePrice: 5000,
      isActive: true,
      ...overrides,
    })
    .expect(201);

  const id = response.body.data.id as string;
  createdProductIds.push(new Types.ObjectId(id));

  return { id, sku: response.body.data.sku as string };
}

function adjust(productId: string, body: Record<string, unknown>, account = admin): request.Test {
  return http()
    .post(`/api/v1/admin/inventory/${productId}/adjust`)
    .set(...bearer(account))
    .set('User-Agent', USER_AGENT)
    .send(body);
}

async function onHandOf(productId: string): Promise<number> {
  const row = await products
    .findById(new Types.ObjectId(productId))
    .lean<{ stock: { onHand: number } }>()
    .exec();

  return row?.stock.onHand ?? -1;
}

async function eventsFor(productId: string) {
  return events
    .find({ productId: new Types.ObjectId(productId) })
    .sort({ createdAt: 1 })
    .lean()
    .exec();
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
  products = app.get<Model<Product>>(getModelToken(Product.name));
  categories = app.get<Model<Category>>(getModelToken(Category.name));
  events = app.get<Model<InventoryEvent>>(getModelToken(InventoryEvent.name));
  auditLogs = app.get<Model<AuditLog>>(getModelToken(AuditLog.name));
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));

  admin = await createAccount('operator', Role.ADMIN);
  customer = await createAccount('shopper');

  const created = await categories.create({
    slug: `inv-cat-${RUN_ID}`,
    name: { en: 'Stocked', ar: null },
    parentId: null,
    path: [],
    depth: 0,
  });
  createdCategoryIds.push(created._id);
  category = { _id: created._id, slug: created.slug };
}, 120_000);

afterAll(async () => {
  if (createdProductIds.length > 0) {
    await events.deleteMany({ productId: { $in: createdProductIds } }).exec();
    await auditLogs.deleteMany({ 'entity.id': { $in: createdProductIds } }).exec();
    await products.deleteMany({ _id: { $in: createdProductIds } }).exec();
  }

  if (createdCategoryIds.length > 0) {
    await categories.deleteMany({ _id: { $in: createdCategoryIds } }).exec();
  }

  if (createdUserIds.length > 0) {
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  await app.close();
});

describe('POST /admin/inventory/:productId/adjust — authorization', () => {
  it('refuses an anonymous caller and a CUSTOMER', async () => {
    const product = await makeProduct();

    await http()
      .post(`/api/v1/admin/inventory/${product.id}/adjust`)
      .send({ delta: 100, reason: 'Free stock', type: 'RESTOCK' })
      .expect(401);

    await adjust(product.id, { delta: 100, reason: 'Free stock', type: 'RESTOCK' }, customer).expect(403);

    /*
     * Legacy granted EXECUTE on `adjust_stock_v2` to `anon` (F-CRIT-1) —
     * anybody who could reach the database could move stock. Both refusals move
     * nothing, which is the half that proves the guard is not decorative.
     */
    expect(await onHandOf(product.id)).toBe(0);
    expect(await eventsFor(product.id)).toHaveLength(0);
  });

  it('refuses an attempt to name the actor', async () => {
    // The legacy `p_admin_id` forgery vector: the caller said who had done it.
    const product = await makeProduct();

    const response = await adjust(product.id, {
      delta: 5,
      reason: 'Restocked',
      type: 'RESTOCK',
      actorId: customer.id.toHexString(),
    }).expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });
});

describe('adjusting stock', () => {
  it('adds stock and writes one ledger event in the same breath', async () => {
    const product = await makeProduct();

    const response = await adjust(product.id, {
      delta: 40,
      reason: 'Delivery from supplier, 40 units',
      type: 'RESTOCK',
    }).expect(200);

    expect(response.body.data).toMatchObject({
      sku: product.sku,
      balanceBefore: 0,
      balanceAfter: 40,
      state: 'IN_STOCK',
    });
    expect(await onHandOf(product.id)).toBe(40);

    const ledger = await eventsFor(product.id);

    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      type: InventoryEventType.RESTOCK,
      quantityDelta: 40,
      balanceBefore: 0,
      balanceAfter: 40,
      reason: 'Delivery from supplier, 40 units',
      // No reference: an adjustment points at no order. The unique index on
      // {reference.id, productId, type} is partial precisely so many of these
      // can coexist.
      reference: null,
    });
    expect(ledger[0]?.sku).toBe(product.sku);
  });

  it('removes stock with a negative delta', async () => {
    const product = await makeProduct();

    await adjust(product.id, { delta: 10, reason: 'Opening count', type: 'RESTOCK' }).expect(200);
    const response = await adjust(product.id, {
      delta: -3,
      reason: 'Damaged in storage',
      type: 'DAMAGE',
    }).expect(200);

    expect(response.body.data).toMatchObject({ balanceBefore: 10, balanceAfter: 7 });
    expect(await onHandOf(product.id)).toBe(7);
  });

  it('treats delta as a MOVEMENT, never as a target', async () => {
    /*
     * Preserved from `adjust_stock_v2`. An absolute value would silently
     * overwrite whatever landed between the operator reading the screen and
     * pressing save; a delta composes with it.
     */
    const product = await makeProduct();

    await adjust(product.id, { delta: 5, reason: 'First delivery', type: 'RESTOCK' }).expect(200);
    await adjust(product.id, { delta: 5, reason: 'Second delivery', type: 'RESTOCK' }).expect(200);

    expect(await onHandOf(product.id)).toBe(10);
  });

  it('records WHO, from the token and from the database profile', async () => {
    const product = await makeProduct();

    await adjust(product.id, { delta: 7, reason: 'Counted the shelf', type: 'ADJUSTMENT' }).expect(200);

    const [event] = await eventsFor(product.id);

    // Legacy left `created_by` NULL on every sale event (F-MED-2), so no
    // movement could be attributed to anybody.
    expect(event?.actor?.id.toHexString()).toBe(admin.id.toHexString());
    expect(event?.actor?.role).toBe(Role.ADMIN);
    expect(event?.actor?.name).toContain('Inventory');
  });

  it('keeps the three types distinct, because reporting has to tell them apart', async () => {
    const product = await makeProduct();

    await adjust(product.id, { delta: 20, reason: 'Goods received', type: 'RESTOCK' }).expect(200);
    await adjust(product.id, { delta: -2, reason: 'Broken on the shelf', type: 'DAMAGE' }).expect(200);
    await adjust(product.id, { delta: -1, reason: 'Miscount corrected', type: 'ADJUSTMENT' }).expect(200);

    expect((await eventsFor(product.id)).map((event) => event.type)).toEqual([
      InventoryEventType.RESTOCK,
      InventoryEventType.DAMAGE,
      InventoryEventType.ADJUSTMENT,
    ]);
  });

  it('refuses SALE, CANCELLATION and RETURN — those belong to an order', async () => {
    /*
     * An operator able to hand-write a SALE could move stock with no order
     * behind it, and the ledger would stop reconciling against `orders`.
     */
    const product = await makeProduct();

    for (const type of ['SALE', 'CANCELLATION', 'RETURN', 'OPENING_BALANCE']) {
      const response = await adjust(product.id, { delta: 5, reason: 'Not allowed', type }).expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('what an adjustment refuses', () => {
  it('refuses a zero delta', async () => {
    // Legacy F-MED-9 permitted a ledger row recording nothing happening; the
    // ledger's value is that every row is a movement.
    const product = await makeProduct();

    const response = await adjust(product.id, { delta: 0, reason: 'Nothing', type: 'ADJUSTMENT' }).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].field).toBe('delta');
    expect(await eventsFor(product.id)).toHaveLength(0);
  });

  it('refuses a reason under three characters', async () => {
    // Preserved from the legacy Zod rule, which the database never enforced.
    const product = await makeProduct();

    const response = await adjust(product.id, { delta: 5, reason: 'x', type: 'RESTOCK' }).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a missing reason outright', async () => {
    const product = await makeProduct();

    await adjust(product.id, { delta: 5, type: 'RESTOCK' }).expect(400);
  });

  it('refuses a fractional delta', async () => {
    const product = await makeProduct();

    await adjust(product.id, { delta: 1.5, reason: 'Half a unit', type: 'RESTOCK' }).expect(400);
  });

  it('REFUSES to take stock below zero, and says what is actually there', async () => {
    const product = await makeProduct();

    await adjust(product.id, { delta: 4, reason: 'Four arrived', type: 'RESTOCK' }).expect(200);

    const response = await adjust(product.id, {
      delta: -5,
      reason: 'Trying to remove five',
      type: 'DAMAGE',
    }).expect(409);

    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK_FOR_ADJUSTMENT');
    expect(response.body.error.details[0].message).toContain('4 in stock');

    // Nothing moved, and no ledger row was written — the transaction aborted as
    // a unit rather than leaving the two halves disagreeing.
    expect(await onHandOf(product.id)).toBe(4);
    expect(await eventsFor(product.id)).toHaveLength(1);
  });

  it('allows removing exactly the whole balance', async () => {
    const product = await makeProduct();

    await adjust(product.id, { delta: 4, reason: 'Four arrived', type: 'RESTOCK' }).expect(200);
    await adjust(product.id, { delta: -4, reason: 'All four written off', type: 'DAMAGE' }).expect(200);

    // The floor is at zero, not below it. An off-by-one here would make the
    // last unit of every product permanently unremovable.
    expect(await onHandOf(product.id)).toBe(0);
  });

  it('answers 404 for a product that does not exist', async () => {
    const response = await adjust(new Types.ObjectId().toHexString(), {
      delta: 5,
      reason: 'Nobody',
      type: 'RESTOCK',
    }).expect(404);

    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('adjusts a DELISTED product — delisting must not be a way to lose stock', async () => {
    /*
     * Deliberately unlike a sale, which filters on `isActive`. Goods physically
     * exist whether or not the product is listed, and an operator counting a
     * shelf is describing reality rather than asking to sell anything. The same
     * reasoning as `incrementForRestore`, which closed F-HIGH-2.
     */
    const product = await makeProduct({ isActive: false });

    await adjust(product.id, { delta: 12, reason: 'Counted, still delisted', type: 'RESTOCK' }).expect(200);

    expect(await onHandOf(product.id)).toBe(12);
  });
});

describe('stock is unreachable through any other write', () => {
  it('the product create endpoint rejects it', async () => {
    const response = await http()
      .post('/api/v1/admin/catalog/products')
      .set(...bearer(admin))
      .send({
        sku: `INV-BLOCK-${RUN_ID}`,
        slug: `inv-block-${RUN_ID}`,
        name: { en: 'Blocked' },
        categoryId: category._id.toHexString(),
        basePrice: 1000,
        stock: { onHand: 999 },
      })
      .expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('the product update endpoint rejects it too', async () => {
    /*
     * Legacy defect M7: an admin could change stock through a generic product
     * update with no ledger entry behind it. Both doors are closed, which is
     * what makes every movement in the system ledgered.
     */
    const product = await makeProduct();

    const response = await http()
      .patch(`/api/v1/admin/catalog/products/${product.id}`)
      .set(...bearer(admin))
      .send({ stock: { onHand: 999 } })
      .expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    expect(await onHandOf(product.id)).toBe(0);
  });
});

describe('the audit trail', () => {
  it('writes an INVENTORY_ADJUSTED row IN ADDITION to the ledger', async () => {
    /*
     * AUDIT-MODEL.md §3 puts it plainly: the ledger records WHAT moved, the
     * audit records WHO, and why they were allowed to. Two records of one event
     * with different audiences and different retention.
     */
    const product = await makeProduct();

    await adjust(product.id, { delta: -0 + 6, reason: 'Six arrived', type: 'RESTOCK' }).expect(200);

    const rows = await auditLogs
      .find({
        'entity.type': AuditEntityType.PRODUCT,
        'entity.id': new Types.ObjectId(product.id),
        action: AuditAction.INVENTORY_ADJUSTED,
      })
      .lean()
      .exec();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor.id.toHexString()).toBe(admin.id.toHexString());
    expect(rows[0]?.userAgent).toBe(USER_AGENT);
    expect(rows[0]?.metadata).toMatchObject({ type: 'RESTOCK', delta: 6, reason: 'Six arrived' });
    expect(rows[0]?.changes?.after).toMatchObject({ 'stock.onHand': 6 });

    // And the ledger row is still there beside it.
    expect(await eventsFor(product.id)).toHaveLength(1);
  });

  it('writes no audit row when the adjustment is refused', async () => {
    const product = await makeProduct();
    const before = await auditLogs.countDocuments({ action: AuditAction.INVENTORY_ADJUSTED }).exec();

    await adjust(product.id, { delta: -5, reason: 'Too many', type: 'DAMAGE' }).expect(409);

    expect(await auditLogs.countDocuments({ action: AuditAction.INVENTORY_ADJUSTED }).exec()).toBe(before);
  });
});

describe('GET /admin/inventory — the work list', () => {
  it('lists stock levels with a derived state', async () => {
    const product = await makeProduct();
    await adjust(product.id, { delta: 50, reason: 'Stocked', type: 'RESTOCK' }).expect(200);

    const response = await http()
      .get(`/api/v1/admin/inventory?q=${product.sku}`)
      .set(...bearer(admin))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      sku: product.sku,
      onHand: 50,
      lowStockThreshold: 5,
      state: 'IN_STOCK',
    });
  });

  it('reports LOW_STOCK against the product’s OWN threshold', async () => {
    const product = await makeProduct();

    await adjust(product.id, { delta: 5, reason: 'Five left', type: 'RESTOCK' }).expect(200);

    const response = await http()
      .get(`/api/v1/admin/inventory?q=${product.sku}`)
      .set(...bearer(admin))
      .expect(200);

    // Threshold is 5 and onHand is 5: at the threshold counts as low, which is
    // the point of a threshold.
    expect(response.body.data[0].state).toBe('LOW_STOCK');
  });

  it('?lowStock=true filters in the DATABASE, not in JavaScript', async () => {
    const scarce = await makeProduct();
    const plentiful = await makeProduct();

    await adjust(scarce.id, { delta: 3, reason: 'Nearly out', type: 'RESTOCK' }).expect(200);
    await adjust(plentiful.id, { delta: 500, reason: 'Plenty', type: 'RESTOCK' }).expect(200);

    const response = await http()
      .get(`/api/v1/admin/inventory?lowStock=true&q=INV-${RUN_ID}`)
      .set(...bearer(admin))
      .expect(200);

    const skus = response.body.data.map((row: { sku: string }) => row.sku);

    expect(skus).toContain(scarce.sku);
    expect(skus).not.toContain(plentiful.sku);
  });

  it('?outOfStock=true finds exactly the empty ones', async () => {
    const empty = await makeProduct();
    const stocked = await makeProduct();

    await adjust(stocked.id, { delta: 9, reason: 'Nine', type: 'RESTOCK' }).expect(200);

    const response = await http()
      .get(`/api/v1/admin/inventory?outOfStock=true&q=INV-${RUN_ID}`)
      .set(...bearer(admin))
      .expect(200);

    const skus = response.body.data.map((row: { sku: string }) => row.sku);

    expect(skus).toContain(empty.sku);
    expect(skus).not.toContain(stocked.sku);
  });

  it('orders scarcest first, because the list exists to be acted on', async () => {
    const a = await makeProduct();
    const b = await makeProduct();

    await adjust(a.id, { delta: 90, reason: 'Many', type: 'RESTOCK' }).expect(200);
    await adjust(b.id, { delta: 2, reason: 'Few', type: 'RESTOCK' }).expect(200);

    const response = await http()
      .get(`/api/v1/admin/inventory?q=INV-${RUN_ID}`)
      .set(...bearer(admin))
      .expect(200);

    const onHands = response.body.data.map((row: { onHand: number }) => row.onHand);

    expect(onHands).toEqual([...onHands].sort((x: number, y: number) => x - y));
  });

  it('excludes drafts unless asked, and refuses a CUSTOMER', async () => {
    const draft = await makeProduct({ isActive: false });

    const plain = await http()
      .get(`/api/v1/admin/inventory?q=${draft.sku}`)
      .set(...bearer(admin))
      .expect(200);
    const included = await http()
      .get(`/api/v1/admin/inventory?q=${draft.sku}&includeInactive=true`)
      .set(...bearer(admin))
      .expect(200);

    expect(plain.body.data).toHaveLength(0);
    expect(included.body.data).toHaveLength(1);

    await http()
      .get('/api/v1/admin/inventory')
      .set(...bearer(customer))
      .expect(403);
  });
});

describe('GET /admin/inventory/:productId/events — movement history', () => {
  it('returns events newest first, each self-verifying', async () => {
    const product = await makeProduct();

    await adjust(product.id, { delta: 30, reason: 'Received thirty', type: 'RESTOCK' }).expect(200);
    await adjust(product.id, { delta: -4, reason: 'Four broken', type: 'DAMAGE' }).expect(200);

    const response = await http()
      .get(`/api/v1/admin/inventory/${product.id}/events`)
      .set(...bearer(admin))
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0]).toMatchObject({
      type: 'DAMAGE',
      quantityDelta: -4,
      balanceBefore: 30,
      balanceAfter: 26,
    });

    /*
     * The self-verifying property: the newer event's `balanceBefore` equals the
     * older one's `balanceAfter`. A gap between them proves an out-of-band
     * mutation without replaying anything.
     */
    expect(response.body.data[0].balanceBefore).toBe(response.body.data[1].balanceAfter);
  });

  it('names the actor on every row', async () => {
    const product = await makeProduct();

    await adjust(product.id, { delta: 1, reason: 'One unit', type: 'RESTOCK' }).expect(200);

    const response = await http()
      .get(`/api/v1/admin/inventory/${product.id}/events`)
      .set(...bearer(admin))
      .expect(200);

    expect(response.body.data[0].actorName).toContain('Inventory');
    expect(response.body.data[0].referenceId).toBeNull();
  });

  it('distinguishes a product with no movements from one that never existed', async () => {
    const product = await makeProduct();

    const empty = await http()
      .get(`/api/v1/admin/inventory/${product.id}/events`)
      .set(...bearer(admin))
      .expect(200);

    expect(empty.body.data).toHaveLength(0);
    expect(empty.body.meta.total).toBe(0);

    const missing = await http()
      .get(`/api/v1/admin/inventory/${new Types.ObjectId().toHexString()}/events`)
      .set(...bearer(admin))
      .expect(404);

    expect(missing.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });
});

describe('GET /admin/inventory/reconciliation', () => {
  it('finds nothing wrong when every movement went through the ledger', async () => {
    const product = await makeProduct();

    await adjust(product.id, { delta: 25, reason: 'Received', type: 'RESTOCK' }).expect(200);
    await adjust(product.id, { delta: -5, reason: 'Damaged', type: 'DAMAGE' }).expect(200);

    const response = await http()
      .get('/api/v1/admin/inventory/reconciliation')
      .set(...bearer(admin))
      .expect(200);

    const mine = response.body.data.discrepancies.filter(
      (row: { sku: string }) => row.sku === product.sku,
    );

    expect(mine).toHaveLength(0);
  });

  it('CATCHES a stock change that bypassed the ledger', async () => {
    /*
     * The whole reason the report exists — INVENTORY-MODEL.md §7 calls it
     * "New. Impossible in legacy." Nothing in the application can do this, so
     * the test reaches past the application to the collection, which is exactly
     * the out-of-band mutation the report is designed to notice.
     */
    const product = await makeProduct();

    await adjust(product.id, { delta: 10, reason: 'Ten received', type: 'RESTOCK' }).expect(200);

    await products
      .updateOne({ _id: new Types.ObjectId(product.id) }, { $inc: { 'stock.onHand': 7 } })
      .exec();

    const response = await http()
      .get('/api/v1/admin/inventory/reconciliation')
      .set(...bearer(admin))
      .expect(200);

    const mine = response.body.data.discrepancies.find(
      (row: { sku: string }) => row.sku === product.sku,
    );

    expect(mine).toMatchObject({ onHand: 17, ledgerSum: 10, difference: 7 });
  });

  it('reports rather than corrects', async () => {
    const product = await makeProduct();

    await adjust(product.id, { delta: 10, reason: 'Ten received', type: 'RESTOCK' }).expect(200);
    await products
      .updateOne({ _id: new Types.ObjectId(product.id) }, { $inc: { 'stock.onHand': 7 } })
      .exec();

    await http()
      .get('/api/v1/admin/inventory/reconciliation')
      .set(...bearer(admin))
      .expect(200);

    // Untouched. An automated corrector that misreads state writes a wrong
    // number into the only record anybody could have used to find the right one.
    expect(await onHandOf(product.id)).toBe(17);
  });

  it('refuses a CUSTOMER', async () => {
    await http()
      .get('/api/v1/admin/inventory/reconciliation')
      .set(...bearer(customer))
      .expect(403);
  });
});
