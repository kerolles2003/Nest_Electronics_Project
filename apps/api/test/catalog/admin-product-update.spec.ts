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
import { Brand, type BrandLean } from '../../src/modules/catalog/infrastructure/schemas/brand.schema';
import {
  Category,
  type CategoryLean,
} from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { SlugRedirect } from '../../src/modules/catalog/infrastructure/schemas/slug-redirect.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * `PATCH /admin/catalog/products/:id`, the publish pair, and the half of
 * legacy defect K4 that was never built.
 *
 * ## K4, stated once so the assertions below read as what they are
 *
 * Legacy wrote a `slugRedirects` row on every product rename. Nothing ever
 * read one. So each rename produced a **permanent 404** at the old URL while a
 * database row sat there recording exactly where the page had gone — every
 * bookmark, every indexed search result and every link somebody had sent a
 * customer, broken, with the fix already stored and unused.
 *
 * `BEHAVIOR-DECISIONS.md` K4 and `BUSINESS-RULES.md` RULE-CAT-002 both say the
 * redirect must be READ. The tests that matter here are the ones that request
 * an old slug and expect a 301.
 *
 * ## Isolation
 *
 * Own accounts, own category and brand, own products. Audit rows and slug
 * redirects are removed by the ids this suite created.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const USER_AGENT = `CatalogueUpdateSuite/1.0 (${RUN_ID})`;

let app: INestApplication;
let users: Model<User>;
let products: Model<Product>;
let categories: Model<Category>;
let brands: Model<Brand>;
let auditLogs: Model<AuditLog>;
let slugRedirects: Model<SlugRedirect>;
let refreshTokens: Model<RefreshToken>;

const createdUserIds: Types.ObjectId[] = [];
const createdProductIds: Types.ObjectId[] = [];
const createdCategoryIds: Types.ObjectId[] = [];
const createdBrandIds: Types.ObjectId[] = [];

interface Account {
  readonly id: Types.ObjectId;
  readonly token: string;
}

let admin: Account;
let customer: Account;
let category: CategoryLean;
let otherCategory: CategoryLean;
let brand: BrandLean;

function http(): request.Agent {
  return request(app.getHttpServer());
}

function bearer(account: Account): [string, string] {
  return ['Authorization', `Bearer ${account.token}`];
}

async function createAccount(label: string, role: Role = Role.CUSTOMER): Promise<Account> {
  const email = `cat-upd-${label}.${RUN_ID}@example.test`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: `Catalogue ${label}` })
    .expect(201);

  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } }).exec();

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  const login = await http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);

  return { id: created._id, token: login.body.data.accessToken as string };
}

/** A fresh product per test. Returns its id and slug. */
async function makeProduct(
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; slug: string; sku: string }> {
  const tag = randomUUID().slice(0, 6);
  const body = {
    sku: `UPD-${RUN_ID}-${tag}`.toUpperCase(),
    slug: `upd-${RUN_ID}-${tag}`,
    name: { en: 'Signal Generator' },
    categoryId: category._id.toHexString(),
    basePrice: 40000,
    isActive: true,
    ...overrides,
  };

  const response = await http()
    .post('/api/v1/admin/catalog/products')
    .set(...bearer(admin))
    .set('User-Agent', USER_AGENT)
    .send(body)
    .expect(201);

  const id = response.body.data.id as string;
  createdProductIds.push(new Types.ObjectId(id));

  return { id, slug: response.body.data.slug as string, sku: response.body.data.sku as string };
}

function patch(id: string, body: Record<string, unknown>): request.Test {
  return http()
    .patch(`/api/v1/admin/catalog/products/${id}`)
    .set(...bearer(admin))
    .set('User-Agent', USER_AGENT)
    .send(body);
}

async function auditFor(productId: string) {
  return auditLogs
    .find({ 'entity.type': AuditEntityType.PRODUCT, 'entity.id': new Types.ObjectId(productId) })
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
  brands = app.get<Model<Brand>>(getModelToken(Brand.name));
  auditLogs = app.get<Model<AuditLog>>(getModelToken(AuditLog.name));
  slugRedirects = app.get<Model<SlugRedirect>>(getModelToken(SlugRedirect.name));
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));

  admin = await createAccount('operator', Role.ADMIN);
  customer = await createAccount('shopper');

  const first = await categories.create({
    slug: `upd-cat-a-${RUN_ID}`,
    name: { en: 'Instruments', ar: null },
    parentId: null,
    path: [],
    depth: 0,
  });
  createdCategoryIds.push(first._id);
  category = first.toObject<CategoryLean>();

  const second = await categories.create({
    slug: `upd-cat-b-${RUN_ID}`,
    name: { en: 'Bench Tools', ar: null },
    parentId: first._id,
    path: [first._id],
    depth: 1,
  });
  createdCategoryIds.push(second._id);
  otherCategory = second.toObject<CategoryLean>();

  const madeBy = await brands.create({ slug: `upd-brand-${RUN_ID}`, name: { en: 'Siglent', ar: null } });
  createdBrandIds.push(madeBy._id);
  brand = madeBy.toObject<BrandLean>();
}, 120_000);

afterAll(async () => {
  if (createdProductIds.length > 0) {
    await auditLogs.deleteMany({ 'entity.id': { $in: createdProductIds } }).exec();
    await slugRedirects.deleteMany({ entityId: { $in: createdProductIds } }).exec();
    await products.deleteMany({ _id: { $in: createdProductIds } }).exec();
  }

  if (createdCategoryIds.length > 0) {
    await categories.deleteMany({ _id: { $in: createdCategoryIds } }).exec();
  }

  if (createdBrandIds.length > 0) {
    await brands.deleteMany({ _id: { $in: createdBrandIds } }).exec();
  }

  if (createdUserIds.length > 0) {
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  await app.close();
});

describe('PATCH /admin/catalog/products/:id — partial semantics', () => {
  it('leaves an absent field alone and changes only what was sent', async () => {
    const product = await makeProduct({ name: { en: 'Original' }, basePrice: 40000 });

    const response = await patch(product.id, { name: { en: 'Renamed' } }).expect(200);

    expect(response.body.data.name.en).toBe('Renamed');
    expect(response.body.data.pricing.basePrice).toBe(40000);
    expect(response.body.data.slug).toBe(product.slug);
  });

  it('treats an explicit null as "clear it" — ending a sale', async () => {
    const product = await makeProduct({ basePrice: 40000, salePrice: 32000 });

    const cleared = await patch(product.id, { salePrice: null }).expect(200);

    expect(cleared.body.data.pricing.salePrice).toBeNull();
    // The maintained field follows. A sale that ends must stop being the
    // sortable price, or the catalogue orders itself by a number nobody pays.
    expect(cleared.body.data.pricing.effectivePrice).toBe(40000);
  });

  it('recomputes effectivePrice when a sale starts', async () => {
    const product = await makeProduct({ basePrice: 40000 });

    const onSale = await patch(product.id, { salePrice: 29900 }).expect(200);

    expect(onSale.body.data.pricing.effectivePrice).toBe(29900);
  });

  it('validates the RESULTING price pair, not the fields that were sent', async () => {
    /*
     * The trap: `salePrice` is untouched at 32000 and the request lowers
     * `basePrice` to 30000. Both fields are individually valid, the request
     * mentions only one of them, and the product would end up "on sale" above
     * list — which the storefront renders as a struck-through "was" price
     * beside a higher number.
     */
    const product = await makeProduct({ basePrice: 40000, salePrice: 32000 });

    const response = await patch(product.id, { basePrice: 30000 }).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].field).toBe('salePrice');
  });

  it('re-snapshots the category when it moves', async () => {
    const product = await makeProduct();

    const moved = await patch(product.id, { categoryId: otherCategory._id.toHexString() }).expect(200);
    const stored = await products.findById(new Types.ObjectId(product.id)).lean().exec();

    expect(moved.body.data.category.slug).toBe(otherCategory.slug);
    // Ancestors plus self, so the parent category's page still finds it.
    expect(stored?.category.path.map(String)).toEqual([
      category._id.toHexString(),
      otherCategory._id.toHexString(),
    ]);
  });

  it('clears the brand with an explicit null', async () => {
    const product = await makeProduct({ brandId: brand._id.toHexString() });

    const cleared = await patch(product.id, { brandId: null }).expect(200);

    expect(cleared.body.data.brand).toBeNull();
  });

  it('refuses `sku` — immutable after creation', async () => {
    const product = await makeProduct();

    const response = await patch(product.id, { sku: 'SOMETHING-ELSE' }).expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('refuses `isActive` — publishing is its own audited action', async () => {
    const product = await makeProduct();

    const response = await patch(product.id, { isActive: false }).expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('refuses `stock` here too', async () => {
    const product = await makeProduct();

    const response = await patch(product.id, { stock: { onHand: 5 } }).expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('refuses an edit to a soft-deleted product', async () => {
    const product = await makeProduct();

    await products
      .updateOne({ _id: new Types.ObjectId(product.id) }, { $set: { deletedAt: new Date() } })
      .exec();

    const response = await patch(product.id, { name: { en: 'Nope' } }).expect(409);

    expect(response.body.error.code).toBe('PRODUCT_DELETED');
  });

  it('refuses a CUSTOMER', async () => {
    const product = await makeProduct();

    await http()
      .patch(`/api/v1/admin/catalog/products/${product.id}`)
      .set(...bearer(customer))
      .send({ name: { en: 'Hijacked' } })
      .expect(403);

    const after = await products.findById(new Types.ObjectId(product.id)).lean().exec();
    expect(after?.name.en).toBe('Signal Generator');
  });
});

describe('renaming a slug — the half of K4 that was never built', () => {
  it('writes a redirect row and answers 301 at the old URL', async () => {
    const product = await makeProduct();
    const renamed = `${product.slug}-mk2`;

    await patch(product.id, { slug: renamed }).expect(200);

    const moved = await http().get(`/api/v1/products/${product.slug}`).expect(301);

    expect(moved.headers.location).toBe(`/api/v1/products/${renamed}`);
    expect(moved.body.data.movedTo).toBe(renamed);
  });

  it('the new URL resolves normally', async () => {
    const product = await makeProduct();
    const renamed = `${product.slug}-v2`;

    await patch(product.id, { slug: renamed }).expect(200);

    const detail = await http().get(`/api/v1/products/${renamed}`).expect(200);

    expect(detail.body.data.slug).toBe(renamed);
  });

  it('COLLAPSES a chain, so A resolves to C in one hop', async () => {
    /*
     * §2 rule 5. Following chains at read time would need a cycle guard on a
     * public endpoint — renaming a product back and forth builds a loop — so
     * the collapse happens on the write, where it is one extra updateMany.
     */
    const product = await makeProduct();
    const a = product.slug;
    const b = `${a}-b`;
    const c = `${a}-c`;

    await patch(product.id, { slug: b }).expect(200);
    await patch(product.id, { slug: c }).expect(200);

    const fromA = await http().get(`/api/v1/products/${a}`).expect(301);
    const fromB = await http().get(`/api/v1/products/${b}`).expect(301);

    expect(fromA.headers.location).toBe(`/api/v1/products/${c}`);
    expect(fromB.headers.location).toBe(`/api/v1/products/${c}`);

    // Collapsed, not chained: A points straight at C in the stored row.
    const rowA = await slugRedirects.findOne({ entityType: 'product', oldSlug: a }).lean().exec();
    expect(rowA?.newSlug).toBe(c);
  });

  it('a LIVE slug always wins over a redirect that names it', async () => {
    /*
     * Rename away, then create a different product on the freed slug. The old
     * slug is now both a live product's slug and a redirect source. Resolution
     * must find the live product: the redirect is a fallback, consulted only
     * when nothing resolves, or the new product would be permanently
     * unreachable at its own URL.
     */
    const first = await makeProduct();
    const freed = first.slug;

    await patch(first.id, { slug: `${freed}-moved` }).expect(200);

    const second = await makeProduct({ slug: freed });

    const detail = await http().get(`/api/v1/products/${freed}`).expect(200);

    expect(detail.body.data.id).toBe(second.id);
  });

  it('writes no redirect when the slug is submitted unchanged', async () => {
    const product = await makeProduct();

    await patch(product.id, { slug: product.slug, name: { en: 'Same slug' } }).expect(200);

    expect(
      await slugRedirects.countDocuments({ entityId: new Types.ObjectId(product.id) }).exec(),
    ).toBe(0);
  });

  it('writes no redirect when the rename is REFUSED by the unique index', async () => {
    /*
     * The redirect is written after the product has actually been renamed.
     * Written first, a refused rename would leave a redirect pointing at a slug
     * nothing holds — and a collision is the single most likely way a rename
     * fails.
     */
    const taken = await makeProduct();
    const product = await makeProduct();

    const response = await patch(product.id, { slug: taken.slug }).expect(409);

    expect(response.body.error.code).toBe('DUPLICATE_SLUG');
    expect(
      await slugRedirects.countDocuments({ entityId: new Types.ObjectId(product.id) }).exec(),
    ).toBe(0);
    // And the product still holds its own slug.
    const after = await products.findById(new Types.ObjectId(product.id)).lean().exec();
    expect(after?.slug).toBe(product.slug);
  });

  it('an unknown slug that was never anything is still a plain 404', async () => {
    const response = await http().get(`/api/v1/products/never-existed-${RUN_ID}`).expect(404);

    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });
});

describe('publish and unpublish', () => {
  function act(id: string, action: 'publish' | 'unpublish'): request.Test {
    return http()
      .post(`/api/v1/admin/catalog/products/${id}/${action}`)
      .set(...bearer(admin))
      .set('User-Agent', USER_AGENT);
  }

  it('publishing makes the product publicly readable', async () => {
    const product = await makeProduct({ isActive: false });

    await http().get(`/api/v1/products/${product.slug}`).expect(404);

    const published = await act(product.id, 'publish').expect(200);

    expect(published.body.data.isActive).toBe(true);
    await http().get(`/api/v1/products/${product.slug}`).expect(200);
  });

  it('unpublishing hides it again', async () => {
    const product = await makeProduct({ isActive: true });

    await act(product.id, 'unpublish').expect(200);

    await http().get(`/api/v1/products/${product.slug}`).expect(404);
  });

  it('audits each with its own action code', async () => {
    const product = await makeProduct({ isActive: false });

    await act(product.id, 'publish').expect(200);
    await act(product.id, 'unpublish').expect(200);

    const rows = await auditFor(product.id);
    const actions = rows.map((row) => row.action);

    // The create row, then the two publication rows in order.
    expect(actions).toEqual([
      AuditAction.PRODUCT_CREATED,
      AuditAction.PRODUCT_PUBLISHED,
      AuditAction.PRODUCT_UNPUBLISHED,
    ]);
  });

  it('is silent when it changes nothing', async () => {
    const product = await makeProduct({ isActive: true });
    const before = (await auditFor(product.id)).length;

    await act(product.id, 'publish').expect(200);

    // A row saying somebody published something already published is noise in
    // a log kept for two years.
    expect((await auditFor(product.id)).length).toBe(before);
  });

  it('refuses to publish a soft-deleted product', async () => {
    const product = await makeProduct();

    await products
      .updateOne({ _id: new Types.ObjectId(product.id) }, { $set: { deletedAt: new Date() } })
      .exec();

    const response = await act(product.id, 'publish').expect(409);

    expect(response.body.error.code).toBe('PRODUCT_DELETED');
  });

  it('refuses a CUSTOMER', async () => {
    const product = await makeProduct();

    await http()
      .post(`/api/v1/admin/catalog/products/${product.id}/publish`)
      .set(...bearer(customer))
      .expect(403);
  });
});

describe('what an edit writes to the audit trail', () => {
  it('records a price change as PRODUCT_PRICE_CHANGED, with before and after', async () => {
    const product = await makeProduct({ basePrice: 40000 });

    await patch(product.id, { basePrice: 35000 }).expect(200);

    const rows = await auditFor(product.id);
    const priceRow = rows.find((row) => row.action === AuditAction.PRODUCT_PRICE_CHANGED);

    expect(priceRow).toBeDefined();
    expect(priceRow?.changes?.before).toMatchObject({ 'pricing.basePrice': 40000 });
    expect(priceRow?.changes?.after).toMatchObject({ 'pricing.basePrice': 35000 });
    // The maintained field moved with it, and the trail says so.
    expect(priceRow?.changes?.after).toMatchObject({ 'pricing.effectivePrice': 35000 });
  });

  it('records a non-price edit as PRODUCT_UPDATED', async () => {
    const product = await makeProduct();

    await patch(product.id, { name: { en: 'Function Generator' } }).expect(200);

    const rows = await auditFor(product.id);

    expect(rows.map((row) => row.action)).toEqual([
      AuditAction.PRODUCT_CREATED,
      AuditAction.PRODUCT_UPDATED,
    ]);
    expect(rows[1]?.changes?.after).toMatchObject({ 'name.en': 'Function Generator' });
  });

  it('records ONE row when a request changes both a price and a name', async () => {
    /*
     * The action names the most consequential change; `changes` still carries
     * both. Two rows for one operator action would double-count the
     * `{action, createdAt}` index that exists so "every price change" is one
     * query.
     */
    const product = await makeProduct({ basePrice: 40000 });

    await patch(product.id, { basePrice: 31000, name: { en: 'Both At Once' } }).expect(200);

    const rows = (await auditFor(product.id)).filter(
      (row) => row.action !== AuditAction.PRODUCT_CREATED,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe(AuditAction.PRODUCT_PRICE_CHANGED);
    expect(rows[0]?.changes?.after).toMatchObject({
      'pricing.basePrice': 31000,
      'name.en': 'Both At Once',
    });
  });

  it('records costPrice unredacted — the trail is ADMIN-only and a margin change is the point', async () => {
    const product = await makeProduct({ costPrice: 20000 });

    await patch(product.id, { costPrice: 24000 }).expect(200);

    const row = (await auditFor(product.id)).find(
      (entry) => entry.action === AuditAction.PRODUCT_PRICE_CHANGED,
    );

    expect(row?.changes?.before).toMatchObject({ 'pricing.costPrice': 20000 });
    expect(row?.changes?.after).toMatchObject({ 'pricing.costPrice': 24000 });
  });

  it('writes NOTHING when a save changes nothing', async () => {
    const product = await makeProduct({ name: { en: 'Unchanged' } });
    const before = (await auditFor(product.id)).length;

    await patch(product.id, { name: { en: 'Unchanged' } }).expect(200);

    expect((await auditFor(product.id)).length).toBe(before);
  });

  it('records the rename in the same row as the rest of the edit', async () => {
    const product = await makeProduct();
    const renamed = `${product.slug}-audited`;

    await patch(product.id, { slug: renamed }).expect(200);

    const row = (await auditFor(product.id)).find(
      (entry) => entry.action === AuditAction.PRODUCT_UPDATED,
    );

    expect(row?.changes?.before).toMatchObject({ slug: product.slug });
    expect(row?.changes?.after).toMatchObject({ slug: renamed });
  });
});
