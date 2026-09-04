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
import { AuditAction, AuditEntityType } from '../../src/modules/audit/domain/audit-action';
import { RefreshToken } from '../../src/modules/auth/infrastructure/schemas/refresh-token.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { SlugRedirect } from '../../src/modules/catalog/infrastructure/schemas/slug-redirect.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * Reading the audit trail — the half that never existed.
 *
 * ## What this closes
 *
 * `AuditModule` has carried a note since it was written: *"There is also no
 * controller yet."* Writing has worked for several phases, and every catalogue,
 * inventory, order and role change since has been recorded — into a collection
 * nothing could read.
 *
 * Meanwhile the console's Audit Log screen read Supabase `admin_audit_logs`, a
 * table with **zero rows** that can no longer receive any: its `admin_id` has a
 * foreign key to Supabase `profiles`, and the acting admin is an API account.
 * So an empty audit log was displayed beside a real one filling up — which is
 * the legacy failure (§4: "read sixty-one times in that state") reproduced by a
 * different mechanism.
 *
 * ## What is asserted, and what deliberately is not
 *
 * The trail is APPEND-ONLY (§5 rule 4) and §8 says write, update and delete are
 * available to **nobody**. That is asserted here as the absence of a route, not
 * as a permission check — there is nothing to permit.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'audit sixteen candles brass';
const USER_AGENT = `AuditReadSuite/1.0 (${RUN_ID})`;

let app: INestApplication;
let users: Model<User>;
let products: Model<Product>;
let categories: Model<Category>;
let auditLogs: Model<AuditLog>;
let slugRedirects: Model<SlugRedirect>;
let refreshTokens: Model<RefreshToken>;

const createdUserIds: Types.ObjectId[] = [];
const createdProductIds: Types.ObjectId[] = [];
const createdCategoryIds: Types.ObjectId[] = [];

interface Account {
  readonly id: Types.ObjectId;
  readonly token: string;
  readonly fullName: string;
  readonly email: string;
}

let admin: Account;
let otherAdmin: Account;
let customer: Account;
let category: { _id: Types.ObjectId; slug: string };

function http(): request.Agent {
  return request(app.getHttpServer());
}

function bearer(account: Account): [string, string] {
  return ['Authorization', `Bearer ${account.token}`];
}

async function createAccount(label: string, role: Role = Role.CUSTOMER): Promise<Account> {
  const email = `audit-${label}.${RUN_ID}@example.test`;
  const fullName = `Audit ${label}`;

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

  return { id: created._id, token: login.body.data.accessToken as string, fullName, email };
}

/** Creates a product AS the given account, so the audit actor is that account. */
async function makeProduct(actor: Account): Promise<{ id: string; sku: string }> {
  const tag = randomUUID().slice(0, 6);
  const sku = `AUD-${RUN_ID}-${tag}`.toUpperCase();

  const response = await http()
    .post('/api/v1/admin/catalog/products')
    .set(...bearer(actor))
    .set('User-Agent', USER_AGENT)
    .send({
      sku,
      slug: `aud-${RUN_ID}-${tag}`,
      name: { en: 'Audited Product' },
      categoryId: category._id.toHexString(),
      basePrice: 15000,
    })
    .expect(201);

  const id = response.body.data.id as string;
  createdProductIds.push(new Types.ObjectId(id));

  return { id, sku };
}

function listLogs(query: Record<string, string> = {}): request.Test {
  return http()
    .get('/api/v1/admin/audit-logs')
    .query(query)
    .set(...bearer(admin));
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
  auditLogs = app.get<Model<AuditLog>>(getModelToken(AuditLog.name));
  slugRedirects = app.get<Model<SlugRedirect>>(getModelToken(SlugRedirect.name));
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));

  admin = await createAccount('admin', Role.ADMIN);
  otherAdmin = await createAccount('second', Role.ADMIN);
  customer = await createAccount('shopper');

  const created = await categories.create({
    slug: `audit-cat-${RUN_ID}`,
    name: { en: 'Audited Category', ar: null },
    parentId: null,
    path: [],
    depth: 0,
    sortOrder: 0,
    isActive: true,
    productCount: 0,
    deletedAt: null,
  });

  category = { _id: created._id, slug: created.slug };
  createdCategoryIds.push(created._id);
}, 180_000);

afterAll(async () => {
  if (createdProductIds.length > 0) {
    await slugRedirects.deleteMany({ entityId: { $in: createdProductIds } }).exec();
    await products.deleteMany({ _id: { $in: createdProductIds } }).exec();
  }

  if (createdUserIds.length > 0) {
    // Audit rows are keyed by the actor snapshot, which is what makes this
    // cleanup possible without a marker field.
    await auditLogs.deleteMany({ 'actor.id': { $in: createdUserIds } }).exec();
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  if (createdCategoryIds.length > 0) {
    await auditLogs.deleteMany({ 'entity.id': { $in: createdCategoryIds } }).exec();
    await categories.deleteMany({ _id: { $in: createdCategoryIds } }).exec();
  }

  await app.close();
});

describe('GET /admin/audit-logs — authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    await http().get('/api/v1/admin/audit-logs').expect(401);
  });

  it('refuses a CUSTOMER — §8 restricts reads to staff', async () => {
    await http()
      .get('/api/v1/admin/audit-logs')
      .set(...bearer(customer))
      .expect(403);
  });

  it('permits an ADMIN', async () => {
    const response = await listLogs({ limit: '1' }).expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.meta).toMatchObject({ page: 1, limit: 1 });
  });
});

describe('the trail is readable, and says who did what to which thing', () => {
  it('records a real write and returns it with the actor SNAPSHOTTED', async () => {
    const product = await makeProduct(admin);

    const response = await listLogs({
      entityType: AuditEntityType.PRODUCT,
      entityId: product.id,
    }).expect(200);

    const row = response.body.data[0];

    expect(row.action).toBe(AuditAction.PRODUCT_CREATED);
    expect(row.entity).toMatchObject({ type: AuditEntityType.PRODUCT, id: product.id });
    /*
     * The label is snapshotted so the record stays readable after the entity is
     * gone — which is exactly when an investigator wants it.
     */
    expect(row.entity.label).toBe(product.sku);
    expect(row.actor).toMatchObject({
      id: admin.id.toHexString(),
      role: Role.ADMIN,
      name: admin.fullName,
      email: admin.email,
    });
    expect(row.requestId).toEqual(expect.any(String));
  });

  it('keeps the actor snapshot after the account is DELETED', async () => {
    /*
     * §4's reason for snapshotting rather than joining, asserted rather than
     * asserted-about: a join would make the trail of a removed administrator
     * unreadable at the moment it matters most.
     */
    const product = await makeProduct(otherAdmin);

    await users.deleteOne({ _id: otherAdmin.id }).exec();

    const response = await listLogs({
      entityType: AuditEntityType.PRODUCT,
      entityId: product.id,
    }).expect(200);

    expect(response.body.data[0].actor).toMatchObject({
      name: otherAdmin.fullName,
      email: otherAdmin.email,
    });
  });

  it('carries the forensic context, including the userAgent legacy silently dropped', async () => {
    const product = await makeProduct(admin);

    const response = await listLogs({
      entityType: AuditEntityType.PRODUCT,
      entityId: product.id,
    }).expect(200);

    expect(response.body.data[0].userAgent).toBe(USER_AGENT);
  });

  it('returns the FIELDS that changed, not whole documents', async () => {
    /*
     * And it records a price edit as PRODUCT_PRICE_CHANGED rather than as a
     * generic PRODUCT_UPDATED. That distinction is the reason the vocabulary
     * has thirty members instead of four: "every price change since August" is
     * a question somebody asks, and it is unanswerable if a price edit looks
     * like any other edit. This test asserted the generic action first and was
     * wrong; the code was right.
     */
    const product = await makeProduct(admin);

    await http()
      .patch(`/api/v1/admin/catalog/products/${product.id}`)
      .set(...bearer(admin))
      .send({ basePrice: 19900 })
      .expect(200);

    const response = await listLogs({
      entityType: AuditEntityType.PRODUCT,
      entityId: product.id,
      action: AuditAction.PRODUCT_PRICE_CHANGED,
    }).expect(200);

    const changes = response.body.data[0].changes;

    expect(changes).not.toBeNull();
    expect(JSON.stringify(changes)).toContain('19900');
    // The whole product is NOT in the record — only what moved.
    expect(JSON.stringify(changes)).not.toContain('Audited Product');
  });

  it('does not file a price edit under the generic update action', async () => {
    const product = await makeProduct(admin);

    await http()
      .patch(`/api/v1/admin/catalog/products/${product.id}`)
      .set(...bearer(admin))
      .send({ basePrice: 20900 })
      .expect(200);

    const generic = await listLogs({
      entityType: AuditEntityType.PRODUCT,
      entityId: product.id,
      action: AuditAction.PRODUCT_UPDATED,
    }).expect(200);

    expect(generic.body.data).toHaveLength(0);
  });

  it('is newest first', async () => {
    const product = await makeProduct(admin);

    await http()
      .post(`/api/v1/admin/catalog/products/${product.id}/publish`)
      .set(...bearer(admin))
      .expect(200);

    const response = await listLogs({
      entityType: AuditEntityType.PRODUCT,
      entityId: product.id,
    }).expect(200);

    expect(response.body.data[0].action).toBe(AuditAction.PRODUCT_PUBLISHED);
    expect(response.body.data[1].action).toBe(AuditAction.PRODUCT_CREATED);
  });
});

describe('the filters §8 names, and the one it deliberately omits', () => {
  it('filters by action', async () => {
    await makeProduct(admin);

    const response = await listLogs({ action: AuditAction.PRODUCT_CREATED, limit: '50' }).expect(200);

    expect(response.body.data.length).toBeGreaterThan(0);
    for (const row of response.body.data as { action: string }[]) {
      expect(row.action).toBe(AuditAction.PRODUCT_CREATED);
    }
  });

  it('filters by actor — "what has this person done"', async () => {
    const response = await listLogs({ actorId: admin.id.toHexString(), limit: '50' }).expect(200);

    expect(response.body.data.length).toBeGreaterThan(0);
    for (const row of response.body.data as { actor: { id: string } }[]) {
      expect(row.actor.id).toBe(admin.id.toHexString());
    }
  });

  it('filters by a date window', async () => {
    const product = await makeProduct(admin);

    const inWindow = await listLogs({
      entityType: AuditEntityType.PRODUCT,
      entityId: product.id,
      from: new Date(Date.now() - 60_000).toISOString(),
    }).expect(200);

    const beforeItHappened = await listLogs({
      entityType: AuditEntityType.PRODUCT,
      entityId: product.id,
      to: new Date(Date.now() - 60_000).toISOString(),
    }).expect(200);

    expect(inWindow.body.data.length).toBeGreaterThan(0);
    expect(beforeItHappened.body.data).toHaveLength(0);
  });

  it('refuses an action outside the recorded vocabulary rather than returning nothing', async () => {
    /*
     * An empty page and "that is not a thing this system records" are different
     * answers, and a filter that silently matches nothing is how an operator
     * concludes a subsystem is idle.
     */
    const refused = await listLogs({ action: 'DEFENESTRATED' }).expect(400);

    expect(refused.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses an undocumented query parameter instead of ignoring it', async () => {
    await listLogs({ q: 'price' }).expect(400);
  });

  it('lists only the actions actually PRESENT, not the whole vocabulary', async () => {
    await makeProduct(admin);

    const response = await http()
      .get('/api/v1/admin/audit-logs/actions')
      .set(...bearer(admin))
      .expect(200);

    expect(response.body.data).toContain(AuditAction.PRODUCT_CREATED);
    expect(response.body.data.length).toBeLessThan(Object.values(AuditAction).length);
  });
});

describe('the trail cannot be written or changed through the API', () => {
  /*
   * §8: write any audit record via API — nobody. Delete or modify — nobody.
   * Asserted as the ABSENCE OF A ROUTE rather than as a permission check: there
   * is nothing to permit, so a 403 here would be the wrong answer and would
   * imply a route exists for somebody.
   */
  it('has no POST', async () => {
    await http()
      .post('/api/v1/admin/audit-logs')
      .set(...bearer(admin))
      .send({ action: AuditAction.PRODUCT_DELETED })
      .expect(404);
  });

  it('has no PATCH and no DELETE', async () => {
    const rows = await auditLogs.find({ 'actor.id': admin.id }).limit(1).lean().exec();
    const id = (rows[0]?._id as Types.ObjectId | undefined)?.toHexString() ?? '652f1a9b3c4d5e6f7a8b9c0d';

    await http()
      .patch(`/api/v1/admin/audit-logs/${id}`)
      .set(...bearer(admin))
      .send({ action: AuditAction.PRODUCT_CREATED })
      .expect(404);

    await http()
      .delete(`/api/v1/admin/audit-logs/${id}`)
      .set(...bearer(admin))
      .expect(404);
  });
});
