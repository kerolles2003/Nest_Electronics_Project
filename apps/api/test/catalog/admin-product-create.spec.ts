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
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * `POST /admin/catalog/products` — the first catalogue WRITE the API has ever
 * had, and the write half of closing F-09.
 *
 * ## What is actually being proven here
 *
 * Not "a product can be created". That much would pass with a route that
 * accepted whatever it was sent. The assertions that matter are the refusals:
 *
 *  - `stock` cannot be set through a product write (legacy defect M7 — an admin
 *    moving stock with no ledger entry behind it).
 *  - `effectivePrice` cannot be supplied, and IS maintained. A caller that
 *    could set it independently would make the indexed, sortable price disagree
 *    with the price charged at checkout.
 *  - The category and brand snapshots come from the referenced documents, so a
 *    product cannot be labelled with a category name no category has.
 *  - A product is created UNPUBLISHED, so naming one does not put a bare row in
 *    front of customers.
 *  - Creating one writes exactly one audit row, and it names the operator as
 *    the database has them — not as their token claims.
 *
 * ## Isolation
 *
 * Own accounts, own category and brand, own products, all removed by tracked
 * id. The audit rows this suite causes are removed by entity id: `auditLogs` is
 * append-only in the APPLICATION, and a test tearing down its own fixture is
 * not the application editing its trail.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const USER_AGENT = `CatalogueCreateSuite/1.0 (${RUN_ID})`;

let app: INestApplication;
let users: Model<User>;
let products: Model<Product>;
let categories: Model<Category>;
let brands: Model<Brand>;
let auditLogs: Model<AuditLog>;
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
let deletedCategory: CategoryLean;
let brand: BrandLean;

function http(): request.Agent {
  return request(app.getHttpServer());
}

function bearer(account: Account): [string, string] {
  return ['Authorization', `Bearer ${account.token}`];
}

async function createAccount(label: string, role: Role = Role.CUSTOMER): Promise<Account> {
  const email = `cat-create-${label}.${RUN_ID}@example.test`;

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

/** A distinct SKU and slug per call, so no test depends on another's leftovers. */
function uniqueProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const tag = randomUUID().slice(0, 6);

  return {
    sku: `CRT-${RUN_ID}-${tag}`.toUpperCase(),
    slug: `crt-${RUN_ID}-${tag}`,
    name: { en: 'Bench Power Supply' },
    categoryId: category._id.toHexString(),
    basePrice: 15000,
    ...overrides,
  };
}

async function create(
  body: Record<string, unknown>,
  expectedStatus: number,
): Promise<request.Response> {
  const response = await http()
    .post('/api/v1/admin/catalog/products')
    .set(...bearer(admin))
    .set('User-Agent', USER_AGENT)
    .send(body)
    .expect(expectedStatus);

  const id = response.body?.data?.id as string | undefined;

  if (typeof id === 'string') {
    createdProductIds.push(new Types.ObjectId(id));
  }

  return response;
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
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));

  admin = await createAccount('operator', Role.ADMIN);
  customer = await createAccount('shopper');

  /*
   * A parent of the suite's own, with a real ancestor, so the snapshot's `path`
   * can be asserted to be `[...ancestors, self]` rather than just `[self]` —
   * which is the difference a subtree query depends on and which a root-only
   * fixture could not tell apart.
   */
  const root = await categories.create({
    slug: `crt-root-${RUN_ID}`,
    name: { en: 'Test Instruments', ar: null },
    parentId: null,
    path: [],
    depth: 0,
  });
  createdCategoryIds.push(root._id);

  const child = await categories.create({
    slug: `crt-child-${RUN_ID}`,
    name: { en: 'Power Supplies', ar: null },
    parentId: root._id,
    path: [root._id],
    depth: 1,
  });
  createdCategoryIds.push(child._id);
  category = child.toObject<CategoryLean>();

  const gone = await categories.create({
    slug: `crt-gone-${RUN_ID}`,
    name: { en: 'Discontinued', ar: null },
    parentId: null,
    path: [],
    depth: 0,
    deletedAt: new Date(),
  });
  createdCategoryIds.push(gone._id);
  deletedCategory = gone.toObject<CategoryLean>();

  const madeBy = await brands.create({
    slug: `crt-brand-${RUN_ID}`,
    name: { en: 'Rigol', ar: null },
  });
  createdBrandIds.push(madeBy._id);
  brand = madeBy.toObject<BrandLean>();
}, 120_000);

afterAll(async () => {
  if (createdProductIds.length > 0) {
    await auditLogs.deleteMany({ 'entity.id': { $in: createdProductIds } }).exec();
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

describe('POST /admin/catalog/products — authorization', () => {
  it('refuses an anonymous caller', async () => {
    await http().post('/api/v1/admin/catalog/products').send(uniqueProduct()).expect(401);
  });

  it('refuses a CUSTOMER', async () => {
    await http()
      .post('/api/v1/admin/catalog/products')
      .set(...bearer(customer))
      .send(uniqueProduct())
      .expect(403);
  });

  it('writes nothing when it refuses', async () => {
    const body = uniqueProduct();

    await http()
      .post('/api/v1/admin/catalog/products')
      .set(...bearer(customer))
      .send(body)
      .expect(403);

    expect(await products.findOne({ sku: body.sku }).lean().exec()).toBeNull();
  });
});

describe('POST /admin/catalog/products — what it stores', () => {
  it('creates the product and returns the admin view of it', async () => {
    const body = uniqueProduct({
      name: { en: 'Bench Power Supply', ar: 'مزود طاقة' },
      shortDescription: { en: '30 V, 5 A, single channel.' },
      brandId: brand._id.toHexString(),
      basePrice: 189000,
      salePrice: 169000,
      costPrice: 120000,
      weight: 3400,
      dimensions: { length: 250, width: 130, height: 160 },
      seo: { title: 'Bench PSU' },
      isFeatured: true,
    });

    const response = await create(body, 201);
    const data = response.body.data;

    expect(data.sku).toBe(body.sku);
    expect(data.name).toEqual({ en: 'Bench Power Supply', ar: 'مزود طاقة' });
    expect(data.shortDescription).toEqual({ en: '30 V, 5 A, single channel.', ar: null });
    expect(data.currency).toBe('EGP');
    expect(data.weight).toBe(3400);
    expect(data.dimensions).toEqual({ length: 250, width: 130, height: 160 });
    expect(data.seoTitle).toBe('Bench PSU');
    expect(data.isFeatured).toBe(true);
  });

  it('MAINTAINS effectivePrice as salePrice ?? basePrice', async () => {
    const onSale = await create(uniqueProduct({ basePrice: 20000, salePrice: 15500 }), 201);
    const notOnSale = await create(uniqueProduct({ basePrice: 20000 }), 201);

    expect(onSale.body.data.pricing.effectivePrice).toBe(15500);
    expect(notOnSale.body.data.pricing.effectivePrice).toBe(20000);
  });

  it('stores costPrice, and it is absent from the PUBLIC product detail', async () => {
    /*
     * CATALOG-MODEL.md §5: costPrice "must never appear in a public DTO —
     * enforced by separate ProductPublicDto / ProductAdminDto types". This
     * asserts both halves against the SAME product: the admin sees the margin,
     * and the customer-facing route does not carry the field at all.
     */
    const body = uniqueProduct({ costPrice: 9900, isActive: true });
    const created = await create(body, 201);

    expect(created.body.data.pricing.costPrice).toBe(9900);

    const asCustomer = await http().get(`/api/v1/products/${body.slug as string}`).expect(200);

    expect(JSON.stringify(asCustomer.body)).not.toContain('9900');
    expect(asCustomer.body.data.pricing).not.toHaveProperty('costPrice');
  });

  it('builds the category snapshot from the category, path ending in the category itself', async () => {
    const created = await create(uniqueProduct(), 201);
    const stored = await products
      .findById(new Types.ObjectId(created.body.data.id as string))
      .lean()
      .exec();

    expect(created.body.data.category).toEqual({
      id: category._id.toHexString(),
      slug: category.slug,
      name: { en: 'Power Supplies', ar: null },
    });

    /*
     * The load-bearing difference: `categories.path` is ancestors-only, and the
     * PRODUCT's snapshot path is `[...ancestors, self]`. Without the trailing
     * self, a subtree query for a leaf category matches none of its own
     * products — the exact legacy defect where a parent-category page omitted
     * every child category's products.
     */
    expect(stored?.category.path.map(String)).toEqual([
      category.path[0]?.toHexString(),
      category._id.toHexString(),
    ]);
  });

  it('builds the brand snapshot from the brand, and leaves it null when absent', async () => {
    const withBrand = await create(uniqueProduct({ brandId: brand._id.toHexString() }), 201);
    const without = await create(uniqueProduct(), 201);

    expect(withBrand.body.data.brand).toEqual({
      id: brand._id.toHexString(),
      slug: brand.slug,
      name: { en: 'Rigol', ar: null },
    });
    // 53 of 85 live products have no brand. This is the normal case, not an edge.
    expect(without.body.data.brand).toBeNull();
  });

  it('stores specs with their defaults applied', async () => {
    const created = await create(
      uniqueProduct({
        specs: [
          { key: 'output-voltage', label: 'Output voltage', value: '0-30', unit: 'V', filterable: true },
          { key: 'channels', label: 'Channels', value: '1' },
        ],
      }),
      201,
    );

    expect(created.body.data.specs).toEqual([
      {
        key: 'output-voltage',
        label: 'Output voltage',
        value: '0-30',
        unit: 'V',
        filterable: true,
        sortOrder: 0,
      },
      { key: 'channels', label: 'Channels', value: '1', unit: null, filterable: false, sortOrder: 0 },
    ]);
  });

  it('creates the product UNPUBLISHED unless asked otherwise', async () => {
    const byDefault = await create(uniqueProduct(), 201);
    const explicit = await create(uniqueProduct({ isActive: true }), 201);

    // The schema default is `true`; this endpoint's is `false`, deliberately.
    // A product created here has no images and no stock.
    expect(byDefault.body.data.isActive).toBe(false);
    expect(explicit.body.data.isActive).toBe(true);
  });

  it('starts stock at zero, so a new product cannot be oversold before it is stocked', async () => {
    const created = await create(uniqueProduct(), 201);

    expect(created.body.data.stock).toEqual({ onHand: 0, lowStockThreshold: 5 });
  });

  it('does not show an unpublished product to a customer', async () => {
    const body = uniqueProduct();
    await create(body, 201);

    await http().get(`/api/v1/products/${body.slug as string}`).expect(404);
  });
});

describe('POST /admin/catalog/products — what it refuses', () => {
  it('refuses `stock`, closing legacy defect M7', async () => {
    /*
     * The single most important refusal in this file. §4 makes InventoryModule
     * the sole writer of stock BECAUSE every movement must produce a ledger
     * event; legacy let an admin change stock through a generic product update
     * and no ledger entry was written. `forbidNonWhitelisted` makes sending it
     * a 400 rather than a silently ignored key — which is the difference
     * between an operator learning their edit did nothing and believing it worked.
     */
    const response = await create(uniqueProduct({ stock: { onHand: 500 } }), 400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('refuses `effectivePrice`, `salesCount` and `rating`', async () => {
    for (const field of [
      { effectivePrice: 1 },
      { salesCount: 900 },
      { rating: { average: 500, count: 40 } },
    ]) {
      const response = await create(uniqueProduct(field), 400);

      expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    }
  });

  it('refuses an image descriptor — attaching an asset is reference-counted', async () => {
    const response = await create(
      uniqueProduct({
        images: [{ publicId: 'nest/products/x/y', version: 1, format: 'webp', width: 8, height: 8, bytes: 9 }],
      }),
      400,
    );

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('refuses a salePrice at or above basePrice', async () => {
    const equal = await create(uniqueProduct({ basePrice: 10000, salePrice: 10000 }), 400);
    const above = await create(uniqueProduct({ basePrice: 10000, salePrice: 12000 }), 400);

    expect(equal.body.error.code).toBe('VALIDATION_ERROR');
    expect(equal.body.error.details[0].field).toBe('salePrice');
    expect(above.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a malformed slug rather than silently rewriting it', async () => {
    // §2 rule 6 makes the slug admin-editable. A silent rewrite leaves the
    // operator looking at one value in the form and another in the URL.
    const response = await create(uniqueProduct({ slug: 'Bench Power Supply' }), 400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.some((d: { field: string }) => d.field === 'slug')).toBe(true);
  });

  it('refuses a non-integer price — money is never a float', async () => {
    const response = await create(uniqueProduct({ basePrice: 150.5 }), 400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 404 for an unknown category, and for a SOFT-DELETED one', async () => {
    const unknown = await create(
      uniqueProduct({ categoryId: new Types.ObjectId().toHexString() }),
      404,
    );
    const deleted = await create(
      uniqueProduct({ categoryId: deletedCategory._id.toHexString() }),
      404,
    );

    expect(unknown.body.error.code).toBe('CATEGORY_NOT_FOUND');
    /*
     * A soft-deleted parent is refused too. Nothing in the schema forbids the
     * reference, and the result would be a product filed under a category that
     * renders nowhere — present in the database, invisible in navigation, and
     * indistinguishable from a bug when somebody eventually looks for it.
     */
    expect(deleted.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('answers 404 for an unknown brand', async () => {
    const response = await create(
      uniqueProduct({ brandId: new Types.ObjectId().toHexString() }),
      404,
    );

    expect(response.body.error.code).toBe('BRAND_NOT_FOUND');
  });

  it('answers 409 DUPLICATE_SKU, naming the sku field', async () => {
    const first = uniqueProduct();
    await create(first, 201);

    const response = await create(uniqueProduct({ sku: first.sku }), 409);

    expect(response.body.error.code).toBe('DUPLICATE_SKU');
    expect(response.body.error.details[0].field).toBe('sku');
  });

  it('answers 409 DUPLICATE_SLUG, naming the slug field', async () => {
    const first = uniqueProduct();
    await create(first, 201);

    const response = await create(uniqueProduct({ slug: first.slug }), 409);

    expect(response.body.error.code).toBe('DUPLICATE_SLUG');
    expect(response.body.error.details[0].field).toBe('slug');
  });

  it('answers 409 for a slug held by a SOFT-DELETED product', async () => {
    /*
     * §9: "SKUs and slugs must not be silently reusable". Reusing one repoints
     * every existing link — every bookmark, every search result, every message
     * somebody sent a customer — at a different product, silently.
     */
    const first = uniqueProduct();
    const created = await create(first, 201);

    await products
      .updateOne({ _id: new Types.ObjectId(created.body.data.id as string) }, { $set: { deletedAt: new Date() } })
      .exec();

    const response = await create(uniqueProduct({ slug: first.slug }), 409);

    expect(response.body.error.code).toBe('DUPLICATE_SLUG');
  });
});

describe('POST /admin/catalog/products — the audit trail', () => {
  async function auditFor(productId: string) {
    return auditLogs
      .find({ 'entity.type': AuditEntityType.PRODUCT, 'entity.id': new Types.ObjectId(productId) })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  it('writes exactly one PRODUCT_CREATED row', async () => {
    const created = await create(uniqueProduct(), 201);
    const rows = await auditFor(created.body.data.id as string);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe(AuditAction.PRODUCT_CREATED);
    expect(rows[0]?.entity.label).toBe(created.body.data.sku);
  });

  it('records the operator, the request and no `changes`', async () => {
    const created = await create(uniqueProduct({ basePrice: 44000 }), 201);
    const [row] = await auditFor(created.body.data.id as string);

    expect(row?.actor.id.toHexString()).toBe(admin.id.toHexString());
    expect(row?.actor.role).toBe(Role.ADMIN);
    expect(row?.actor.email).toContain(RUN_ID);
    expect(row?.userAgent).toBe(USER_AGENT);
    expect(row?.requestId).toEqual(expect.any(String));

    /*
     * §4 says `changes` is a diff of the fields that changed, "not whole
     * documents". A creation has no before state, so a `changes` here could
     * only be the entire document — the thing §4 forbids. The reconstructable
     * facts go in `metadata` instead.
     */
    expect(row?.changes).toBeNull();
    expect(row?.metadata).toMatchObject({ basePrice: 44000, isActive: false });
  });

  it('writes NO audit row when the create is refused', async () => {
    /*
     * The half that proves the guarantee can fail. Without it, an
     * implementation that audited before the write — or one whose refusals
     * happened to land after it — would be indistinguishable from a correct one.
     */
    const before = await auditLogs.countDocuments({ 'entity.type': AuditEntityType.PRODUCT }).exec();

    await create(uniqueProduct({ basePrice: 10000, salePrice: 10000 }), 400);
    await create(uniqueProduct({ categoryId: new Types.ObjectId().toHexString() }), 404);

    expect(await auditLogs.countDocuments({ 'entity.type': AuditEntityType.PRODUCT }).exec()).toBe(before);
  });
});

describe('GET /admin/catalog/products — the operator view', () => {
  it('includes drafts, which the public listing does not', async () => {
    const draft = uniqueProduct();
    await create(draft, 201);

    const admins = await http()
      .get(`/api/v1/admin/catalog/products?q=${draft.slug as string}`)
      .set(...bearer(admin))
      .expect(200);

    expect(admins.body.data).toHaveLength(1);
    expect(admins.body.data[0].isActive).toBe(false);
    expect(admins.body.meta.total).toBe(1);
  });

  it('excludes soft-deleted products by default and finds them with ?state=deleted', async () => {
    const body = uniqueProduct();
    const created = await create(body, 201);
    const id = new Types.ObjectId(created.body.data.id as string);

    await products.updateOne({ _id: id }, { $set: { deletedAt: new Date() } }).exec();

    const byDefault = await http()
      .get(`/api/v1/admin/catalog/products?q=${body.slug as string}`)
      .set(...bearer(admin))
      .expect(200);
    const asked = await http()
      .get(`/api/v1/admin/catalog/products?q=${body.slug as string}&state=deleted`)
      .set(...bearer(admin))
      .expect(200);

    expect(byDefault.body.data).toHaveLength(0);
    expect(asked.body.data).toHaveLength(1);
  });

  it('matches a search term mid-token, which a text index would not', async () => {
    const tag = randomUUID().slice(0, 6);
    await create(uniqueProduct({ sku: `MID-${RUN_ID}-${tag}`.toUpperCase(), slug: `mid-${RUN_ID}-${tag}` }), 201);

    const response = await http()
      .get(`/api/v1/admin/catalog/products?q=${RUN_ID}-${tag}`)
      .set(...bearer(admin))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
  });

  it('treats a regular-expression metacharacter as a literal', async () => {
    // The term reaches a `$regex`. Unescaped, `.*` would return the whole
    // catalogue and `(` would be a 500.
    const response = await http()
      .get('/api/v1/admin/catalog/products?q=.*')
      .set(...bearer(admin))
      .expect(200);

    expect(response.body.data).toHaveLength(0);

    await http()
      .get('/api/v1/admin/catalog/products?q=%28unclosed')
      .set(...bearer(admin))
      .expect(200);
  });

  it('refuses a CUSTOMER', async () => {
    await http()
      .get('/api/v1/admin/catalog/products')
      .set(...bearer(customer))
      .expect(403);
  });
});

describe('GET /admin/catalog/products/:id', () => {
  it('resolves a soft-deleted product, so restore is reachable', async () => {
    const created = await create(uniqueProduct(), 201);
    const id = created.body.data.id as string;

    await products.updateOne({ _id: new Types.ObjectId(id) }, { $set: { deletedAt: new Date() } }).exec();

    const response = await http()
      .get(`/api/v1/admin/catalog/products/${id}`)
      .set(...bearer(admin))
      .expect(200);

    expect(response.body.data.deletedAt).toEqual(expect.any(String));
  });

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    const missing = await http()
      .get(`/api/v1/admin/catalog/products/${new Types.ObjectId().toHexString()}`)
      .set(...bearer(admin))
      .expect(404);

    expect(missing.body.error.code).toBe('PRODUCT_NOT_FOUND');

    await http()
      .get('/api/v1/admin/catalog/products/not-an-id')
      .set(...bearer(admin))
      .expect(400);
  });
});
