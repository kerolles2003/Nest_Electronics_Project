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
 * Soft delete, restore, and the denormalised counts nothing was maintaining.
 *
 * ## Two things are being proven, and the second one is a defect this part
 * introduced
 *
 * The first is §9's deletion model: soft, recoverable, slug still held, and a
 * restore that brings the product back as a DRAFT rather than silently putting
 * it in front of customers again.
 *
 * The second is `productCount`. `categories.productCount` and
 * `brands.productCount` are PUBLIC — they are on the category and brand
 * response DTOs and the storefront renders them — and until this unit the ONLY
 * thing that ever computed them was `seed.ts`. So every product created,
 * published, moved or deleted through the endpoints added earlier in this part
 * left both counts reporting the number they had at seed time. A stale count
 * looks exactly like a real one, which is why it needed a test rather than a
 * note.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const USER_AGENT = `CatalogueDeleteSuite/1.0 (${RUN_ID})`;

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
let root: CategoryLean;
let leaf: CategoryLean;
let brand: BrandLean;

function http(): request.Agent {
  return request(app.getHttpServer());
}

function bearer(account: Account): [string, string] {
  return ['Authorization', `Bearer ${account.token}`];
}

async function createAccount(label: string, role: Role = Role.CUSTOMER): Promise<Account> {
  const email = `cat-del-${label}.${RUN_ID}@example.test`;

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

async function makeProduct(
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; slug: string; sku: string }> {
  const tag = randomUUID().slice(0, 6);

  const response = await http()
    .post('/api/v1/admin/catalog/products')
    .set(...bearer(admin))
    .set('User-Agent', USER_AGENT)
    .send({
      sku: `DEL-${RUN_ID}-${tag}`.toUpperCase(),
      slug: `del-${RUN_ID}-${tag}`,
      name: { en: 'Oscilloscope Probe' },
      categoryId: leaf._id.toHexString(),
      basePrice: 22000,
      isActive: true,
      ...overrides,
    })
    .expect(201);

  const id = response.body.data.id as string;
  createdProductIds.push(new Types.ObjectId(id));

  return { id, slug: response.body.data.slug as string, sku: response.body.data.sku as string };
}

function del(id: string): request.Test {
  return http()
    .delete(`/api/v1/admin/catalog/products/${id}`)
    .set(...bearer(admin))
    .set('User-Agent', USER_AGENT);
}

function restore(id: string): request.Test {
  return http()
    .post(`/api/v1/admin/catalog/products/${id}/restore`)
    .set(...bearer(admin))
    .set('User-Agent', USER_AGENT);
}

async function auditFor(productId: string) {
  return auditLogs
    .find({ 'entity.type': AuditEntityType.PRODUCT, 'entity.id': new Types.ObjectId(productId) })
    .sort({ createdAt: 1 })
    .lean()
    .exec();
}

/** `-1` rather than `0` for a missing document, so an absent row cannot pass as an empty one. */
async function categoryCount(id: Types.ObjectId): Promise<number> {
  const row = await categories.findById(id).lean<{ productCount: number }>().exec();

  return row?.productCount ?? -1;
}

async function brandCount(id: Types.ObjectId): Promise<number> {
  const row = await brands.findById(id).lean<{ productCount: number }>().exec();

  return row?.productCount ?? -1;
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

  // A two-level tree, so the SUBTREE half of the count rule is exercised: a
  // parent counts its children's products, because a product's `category.path`
  // is the inclusive chain.
  const parent = await categories.create({
    slug: `del-root-${RUN_ID}`,
    name: { en: 'Measurement', ar: null },
    parentId: null,
    path: [],
    depth: 0,
  });
  createdCategoryIds.push(parent._id);
  root = parent.toObject<CategoryLean>();

  const child = await categories.create({
    slug: `del-leaf-${RUN_ID}`,
    name: { en: 'Probes', ar: null },
    parentId: parent._id,
    path: [parent._id],
    depth: 1,
  });
  createdCategoryIds.push(child._id);
  leaf = child.toObject<CategoryLean>();

  const madeBy = await brands.create({ slug: `del-brand-${RUN_ID}`, name: { en: 'Pico', ar: null } });
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

describe('DELETE /admin/catalog/products/:id — soft', () => {
  it('hides the product from customers and marks it deleted', async () => {
    const product = await makeProduct();

    await http().get(`/api/v1/products/${product.slug}`).expect(200);

    const deleted = await del(product.id).expect(200);

    expect(deleted.body.data.deletedAt).toEqual(expect.any(String));
    // Both flags, so a restore can tell "was it published" apart from "was it
    // deleted" without guessing.
    expect(deleted.body.data.isActive).toBe(false);

    await http().get(`/api/v1/products/${product.slug}`).expect(404);
  });

  it('keeps the document — this is not a destroy', async () => {
    const product = await makeProduct();

    await del(product.id).expect(200);

    const stored = await products.findById(new Types.ObjectId(product.id)).lean().exec();

    expect(stored).not.toBeNull();
    expect(stored?.sku).toBe(product.sku);
  });

  it('still holds the slug, so it cannot be silently reused', async () => {
    const product = await makeProduct();

    await del(product.id).expect(200);

    const collision = await http()
      .post('/api/v1/admin/catalog/products')
      .set(...bearer(admin))
      .send({
        sku: `DEL-OTHER-${RUN_ID}`,
        slug: product.slug,
        name: { en: 'Impostor' },
        categoryId: leaf._id.toHexString(),
        basePrice: 1000,
      })
      .expect(409);

    expect(collision.body.error.code).toBe('DUPLICATE_SLUG');
  });

  it('KEEPS the slug redirects, so a restore does not lose the old URLs', async () => {
    const product = await makeProduct();
    const renamed = `${product.slug}-renamed`;

    await http()
      .patch(`/api/v1/admin/catalog/products/${product.id}`)
      .set(...bearer(admin))
      .send({ slug: renamed })
      .expect(200);

    await del(product.id).expect(200);

    expect(
      await slugRedirects.countDocuments({ entityId: new Types.ObjectId(product.id) }).exec(),
    ).toBe(1);
  });

  it('refuses a second delete', async () => {
    const product = await makeProduct();

    await del(product.id).expect(200);

    const again = await del(product.id).expect(409);

    expect(again.body.error.code).toBe('PRODUCT_DELETED');
  });

  it('refuses a CUSTOMER, and deletes nothing', async () => {
    const product = await makeProduct();

    await http()
      .delete(`/api/v1/admin/catalog/products/${product.id}`)
      .set(...bearer(customer))
      .expect(403);

    const stored = await products.findById(new Types.ObjectId(product.id)).lean().exec();
    expect(stored?.deletedAt).toBeNull();
  });

  it('writes one PRODUCT_DELETED row naming the slug', async () => {
    const product = await makeProduct();

    await del(product.id).expect(200);

    const row = (await auditFor(product.id)).find(
      (entry) => entry.action === AuditAction.PRODUCT_DELETED,
    );

    expect(row).toBeDefined();
    expect(row?.entity.label).toBe(product.sku);
    // §4 wants a log that reads without joins, and this is the action after
    // which the entity stops appearing in the listings an investigator opens.
    expect(row?.metadata).toMatchObject({ slug: product.slug });
  });
});

describe('POST /admin/catalog/products/:id/restore', () => {
  it('brings the product back as a DRAFT, not straight to the storefront', async () => {
    const product = await makeProduct({ isActive: true });

    await del(product.id).expect(200);
    const restored = await restore(product.id).expect(200);

    expect(restored.body.data.deletedAt).toBeNull();
    /*
     * Deliberately still hidden. Putting a product back in front of customers
     * is a publication decision that §3 audits separately; a restore that also
     * republished would record "restored" while doing the thing the
     * PRODUCT_PUBLISHED index exists to be the record of.
     */
    expect(restored.body.data.isActive).toBe(false);
    await http().get(`/api/v1/products/${product.slug}`).expect(404);

    await http()
      .post(`/api/v1/admin/catalog/products/${product.id}/publish`)
      .set(...bearer(admin))
      .expect(200);

    await http().get(`/api/v1/products/${product.slug}`).expect(200);
  });

  it('refuses to restore something that is not deleted', async () => {
    const product = await makeProduct();

    const response = await restore(product.id).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('writes a PRODUCT_RESTORED row', async () => {
    const product = await makeProduct();

    await del(product.id).expect(200);
    await restore(product.id).expect(200);

    const actions = (await auditFor(product.id)).map((row) => row.action);

    expect(actions).toEqual([
      AuditAction.PRODUCT_CREATED,
      AuditAction.PRODUCT_DELETED,
      AuditAction.PRODUCT_RESTORED,
    ]);
  });

  it('the old URL still redirects after a delete and restore', async () => {
    const product = await makeProduct();
    const renamed = `${product.slug}-moved`;

    await http()
      .patch(`/api/v1/admin/catalog/products/${product.id}`)
      .set(...bearer(admin))
      .send({ slug: renamed })
      .expect(200);

    await del(product.id).expect(200);
    await restore(product.id).expect(200);
    await http()
      .post(`/api/v1/admin/catalog/products/${product.id}/publish`)
      .set(...bearer(admin))
      .expect(200);

    const moved = await http().get(`/api/v1/products/${product.slug}`).expect(301);

    expect(moved.headers.location).toBe(`/api/v1/products/${renamed}`);
  });
});

describe('productCount — the denormalised numbers the storefront renders', () => {
  it('starts at zero for a category nobody has stocked', async () => {
    /*
     * A category of its own, created here. The suite's shared `leaf` has been
     * stocked by the describes above, and asserting zero on it would be an
     * assertion about test ORDER rather than about the count — the kind that
     * passes until somebody adds a test earlier in the file.
     */
    const fresh = await categories.create({
      slug: `del-empty-${RUN_ID}`,
      name: { en: 'Unstocked', ar: null },
      parentId: null,
      path: [],
      depth: 0,
    });
    createdCategoryIds.push(fresh._id);

    expect(await categoryCount(fresh._id)).toBe(0);
  });

  it('counts a published product, in the leaf AND in its ancestors', async () => {
    const before = await categoryCount(leaf._id);
    const beforeRoot = await categoryCount(root._id);

    await makeProduct({ isActive: true });

    expect(await categoryCount(leaf._id)).toBe(before + 1);
    /*
     * The parent counts it too. A product's `category.path` is the INCLUSIVE
     * chain, so a category count is a subtree count — which is what makes a
     * parent-category page show its children's products, the legacy defect
     * ADR-CATALOG-004 exists to fix.
     */
    expect(await categoryCount(root._id)).toBe(beforeRoot + 1);
  });

  it('does NOT count a draft', async () => {
    const before = await categoryCount(leaf._id);

    await makeProduct({ isActive: false });

    expect(await categoryCount(leaf._id)).toBe(before);
  });

  it('follows publish and unpublish', async () => {
    const before = await categoryCount(leaf._id);
    const product = await makeProduct({ isActive: false });

    await http()
      .post(`/api/v1/admin/catalog/products/${product.id}/publish`)
      .set(...bearer(admin))
      .expect(200);
    expect(await categoryCount(leaf._id)).toBe(before + 1);

    await http()
      .post(`/api/v1/admin/catalog/products/${product.id}/unpublish`)
      .set(...bearer(admin))
      .expect(200);
    expect(await categoryCount(leaf._id)).toBe(before);
  });

  it('follows a delete and a restore', async () => {
    const before = await categoryCount(leaf._id);
    const product = await makeProduct({ isActive: true });

    expect(await categoryCount(leaf._id)).toBe(before + 1);

    await del(product.id).expect(200);
    expect(await categoryCount(leaf._id)).toBe(before);

    await restore(product.id).expect(200);
    // Restored as a draft, so it is still not counted — the count and the
    // storefront agree, which is the whole point of the field.
    expect(await categoryCount(leaf._id)).toBe(before);
  });

  it('corrects BOTH categories when a product moves between them', async () => {
    const tag = randomUUID().slice(0, 6);
    const other = await categories.create({
      slug: `del-other-${RUN_ID}-${tag}`,
      name: { en: 'Adapters', ar: null },
      parentId: null,
      path: [],
      depth: 0,
    });
    createdCategoryIds.push(other._id);

    const beforeLeaf = await categoryCount(leaf._id);
    const product = await makeProduct({ isActive: true });

    expect(await categoryCount(leaf._id)).toBe(beforeLeaf + 1);

    await http()
      .patch(`/api/v1/admin/catalog/products/${product.id}`)
      .set(...bearer(admin))
      .send({ categoryId: other._id.toHexString() })
      .expect(200);

    // The one it LEFT is corrected, not just the one it arrived at. An
    // increment-only scheme gets this wrong and the drift is permanent.
    expect(await categoryCount(leaf._id)).toBe(beforeLeaf);
    expect(await categoryCount(other._id)).toBe(1);
  });

  it('counts brands the same way, and corrects the brand a product leaves', async () => {
    const product = await makeProduct({ isActive: true, brandId: brand._id.toHexString() });

    expect(await brandCount(brand._id)).toBe(1);

    await http()
      .patch(`/api/v1/admin/catalog/products/${product.id}`)
      .set(...bearer(admin))
      .send({ brandId: null })
      .expect(200);

    expect(await brandCount(brand._id)).toBe(0);
  });

  it('is what the PUBLIC category endpoint reports', async () => {
    /*
     * The count is not an internal number: `CategoryResponseDto` carries it and
     * the storefront renders it. This asserts the value a customer would see,
     * through the public route, rather than the document behind it.
     */
    await makeProduct({ isActive: true });

    const response = await http().get(`/api/v1/categories/${leaf.slug}`).expect(200);

    expect(response.body.data.productCount).toBe(await categoryCount(leaf._id));
    expect(response.body.data.productCount).toBeGreaterThan(0);
  });
});
