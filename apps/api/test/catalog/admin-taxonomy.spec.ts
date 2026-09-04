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
import { Brand } from '../../src/modules/catalog/infrastructure/schemas/brand.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { SlugRedirect } from '../../src/modules/catalog/infrastructure/schemas/slug-redirect.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * Category and brand CRUD.
 *
 * ## The assertions that carry weight
 *
 * The denormalised SNAPSHOT is the reason this file is long. §6 stores category
 * and brand on every product as reference-plus-copy, so that a product grid is
 * one collection read — and the price of that decision is that a rename has to
 * push the new value into every product. §6 names the mechanism
 * (`updateMany({'category.id': X}, …)`), and nothing else in the system ever
 * rewrites that field, so a rename that skipped it would leave every product
 * card showing the old name indefinitely.
 *
 * The second is the TREE. `path[]` is materialised because MongoDB has no
 * recursive CTE; a reparent therefore has to rewrite the subtree by hand, in
 * the categories AND in the products' snapshot paths. A missed descendant is a
 * subtree query answering from the tree's old shape — which is exactly the
 * legacy defect (F-MED-10) that `path[]` exists to fix.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const USER_AGENT = `TaxonomySuite/1.0 (${RUN_ID})`;

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

function http(): request.Agent {
  return request(app.getHttpServer());
}

function bearer(account: Account): [string, string] {
  return ['Authorization', `Bearer ${account.token}`];
}

async function createAccount(label: string, role: Role = Role.CUSTOMER): Promise<Account> {
  const email = `tax-${label}.${RUN_ID}@example.test`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: `Taxonomy ${label}` })
    .expect(201);

  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } }).exec();

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  const login = await http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);

  return { id: created._id, token: login.body.data.accessToken as string };
}

/** Creates a category through the API and tracks it for teardown. */
async function makeCategory(
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; slug: string }> {
  const tag = randomUUID().slice(0, 6);

  const response = await http()
    .post('/api/v1/admin/catalog/categories')
    .set(...bearer(admin))
    .set('User-Agent', USER_AGENT)
    .send({ slug: `tax-${RUN_ID}-${tag}`, name: { en: 'Connectors' }, ...overrides })
    .expect(201);

  const id = response.body.data.id as string;
  createdCategoryIds.push(new Types.ObjectId(id));

  return { id, slug: response.body.data.slug as string };
}

async function makeBrand(overrides: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const tag = randomUUID().slice(0, 6);

  const response = await http()
    .post('/api/v1/admin/catalog/brands')
    .set(...bearer(admin))
    .set('User-Agent', USER_AGENT)
    .send({ slug: `taxb-${RUN_ID}-${tag}`, name: { en: 'Molex' }, ...overrides })
    .expect(201);

  const id = response.body.data.id as string;
  createdBrandIds.push(new Types.ObjectId(id));

  return { id, slug: response.body.data.slug as string };
}

async function makeProduct(categoryId: string, brandId?: string): Promise<string> {
  const tag = randomUUID().slice(0, 6);

  const response = await http()
    .post('/api/v1/admin/catalog/products')
    .set(...bearer(admin))
    .send({
      sku: `TAX-${RUN_ID}-${tag}`.toUpperCase(),
      slug: `tax-p-${RUN_ID}-${tag}`,
      name: { en: 'JST Connector Kit' },
      categoryId,
      basePrice: 8000,
      isActive: true,
      ...(brandId === undefined ? {} : { brandId }),
    })
    .expect(201);

  const id = response.body.data.id as string;
  createdProductIds.push(new Types.ObjectId(id));

  return id;
}

function patchCategory(id: string, body: Record<string, unknown>): request.Test {
  return http()
    .patch(`/api/v1/admin/catalog/categories/${id}`)
    .set(...bearer(admin))
    .set('User-Agent', USER_AGENT)
    .send(body);
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
}, 120_000);

afterAll(async () => {
  const entityIds = [...createdCategoryIds, ...createdBrandIds, ...createdProductIds];

  if (entityIds.length > 0) {
    await auditLogs.deleteMany({ 'entity.id': { $in: entityIds } }).exec();
    await slugRedirects.deleteMany({ entityId: { $in: entityIds } }).exec();
  }

  if (createdProductIds.length > 0) {
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

describe('categories — create', () => {
  it('creates a root with an empty path at depth 0', async () => {
    const created = await makeCategory();
    const stored = await categories.findById(new Types.ObjectId(created.id)).lean().exec();

    expect(stored?.parentId).toBeNull();
    expect(stored?.path).toEqual([]);
    expect(stored?.depth).toBe(0);
  });

  it('computes path and depth from the parent', async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });
    const grandchild = await makeCategory({ parentId: child.id });

    const stored = await categories.findById(new Types.ObjectId(grandchild.id)).lean().exec();

    // Ancestors root-first, EXCLUDING self — a breadcrumb wants ancestors.
    expect(stored?.path.map(String)).toEqual([root.id, child.id]);
    expect(stored?.depth).toBe(2);
  });

  it('refuses `path` and `depth` from the caller', async () => {
    /*
     * `path` is what every subtree query matches. A caller-supplied chain is one
     * that can disagree with `parentId`, and every such query would then be
     * answering from the disagreement.
     */
    const response = await http()
      .post('/api/v1/admin/catalog/categories')
      .set(...bearer(admin))
      .send({ slug: `tax-bad-${RUN_ID}`, name: { en: 'X' }, path: [], depth: 0 })
      .expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('enforces the depth limit', async () => {
    // MONGODB-DESIGN.md §5: max depth 3. depth 0,1,2,3 are legal; 4 is not.
    const d0 = await makeCategory();
    const d1 = await makeCategory({ parentId: d0.id });
    const d2 = await makeCategory({ parentId: d1.id });
    const d3 = await makeCategory({ parentId: d2.id });

    const tooDeep = await http()
      .post('/api/v1/admin/catalog/categories')
      .set(...bearer(admin))
      .send({ slug: `tax-deep-${RUN_ID}`, name: { en: 'Too deep' }, parentId: d3.id })
      .expect(400);

    expect(tooDeep.body.error.code).toBe('VALIDATION_ERROR');
    expect(tooDeep.body.error.details[0].field).toBe('parentId');
  });

  it('refuses an unknown or soft-deleted parent', async () => {
    const parent = await makeCategory();

    await http()
      .delete(`/api/v1/admin/catalog/categories/${parent.id}`)
      .set(...bearer(admin))
      .expect(200);

    const response = await http()
      .post('/api/v1/admin/catalog/categories')
      .set(...bearer(admin))
      .send({ slug: `tax-orph-${RUN_ID}`, name: { en: 'Orphan' }, parentId: parent.id })
      .expect(404);

    expect(response.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('refuses a duplicate slug and a CUSTOMER', async () => {
    const first = await makeCategory();

    const duplicate = await http()
      .post('/api/v1/admin/catalog/categories')
      .set(...bearer(admin))
      .send({ slug: first.slug, name: { en: 'Clash' } })
      .expect(409);

    expect(duplicate.body.error.code).toBe('DUPLICATE_SLUG');

    await http()
      .post('/api/v1/admin/catalog/categories')
      .set(...bearer(customer))
      .send({ slug: `tax-cust-${RUN_ID}`, name: { en: 'Nope' } })
      .expect(403);
  });

  it('writes a CATEGORY_CREATED audit row', async () => {
    const created = await makeCategory();
    const rows = await auditLogs
      .find({ 'entity.type': AuditEntityType.CATEGORY, 'entity.id': new Types.ObjectId(created.id) })
      .lean()
      .exec();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe(AuditAction.CATEGORY_CREATED);
    expect(rows[0]?.entity.label).toBe(created.slug);
  });
});

describe('categories — the snapshot on every product follows a rename', () => {
  it('rewrites name and slug on every product in the category', async () => {
    const category = await makeCategory({ name: { en: 'Before' } });
    const productId = await makeProduct(category.id);
    const renamedSlug = `${category.slug}-renamed`;

    await patchCategory(category.id, { name: { en: 'After' }, slug: renamedSlug }).expect(200);

    const product = await products.findById(new Types.ObjectId(productId)).lean().exec();

    /*
     * §6 states this mechanism directly. Nothing else in the system ever
     * rewrites `product.category.name`, so without it every product card would
     * show "Before" indefinitely — and the staleness would be invisible,
     * because a card showing a stale label looks exactly like a correct one.
     */
    expect(product?.category.name.en).toBe('After');
    expect(product?.category.slug).toBe(renamedSlug);
  });

  it('writes a slug redirect for the category too', async () => {
    const category = await makeCategory();
    const renamed = `${category.slug}-v2`;

    await patchCategory(category.id, { slug: renamed }).expect(200);

    const row = await slugRedirects
      .findOne({ entityType: 'category', oldSlug: category.slug })
      .lean()
      .exec();

    expect(row?.newSlug).toBe(renamed);
  });

  it('the public category endpoint shows the new name immediately, not in fifteen minutes', async () => {
    /*
     * The category list is cached in-process for 15 minutes (SEARCH-MODEL.md
     * §11). Reading BEFORE the rename warms that cache deliberately, so this
     * test fails if the write does not invalidate it — which is the state the
     * operator would otherwise experience as "my save did nothing".
     */
    const category = await makeCategory({ name: { en: 'Cached Name' } });

    const before = await http().get(`/api/v1/categories/${category.slug}`).expect(200);
    expect(before.body.data.name).toBe('Cached Name');

    await patchCategory(category.id, { name: { en: 'Fresh Name' } }).expect(200);

    const after = await http().get(`/api/v1/categories/${category.slug}`).expect(200);
    expect(after.body.data.name).toBe('Fresh Name');
  });
});

describe('categories — reparenting rewrites the subtree', () => {
  it('moves every descendant’s path and depth, not just the category that moved', async () => {
    const oldRoot = await makeCategory();
    const middle = await makeCategory({ parentId: oldRoot.id });
    const leaf = await makeCategory({ parentId: middle.id });
    const newRoot = await makeCategory();

    await patchCategory(middle.id, { parentId: newRoot.id }).expect(200);

    const movedMiddle = await categories.findById(new Types.ObjectId(middle.id)).lean().exec();
    const movedLeaf = await categories.findById(new Types.ObjectId(leaf.id)).lean().exec();

    expect(movedMiddle?.path.map(String)).toEqual([newRoot.id]);
    expect(movedMiddle?.depth).toBe(1);
    // The grandchild moved too. Missing this is a subtree query answering from
    // the tree's old shape — the defect `path[]` exists to prevent.
    expect(movedLeaf?.path.map(String)).toEqual([newRoot.id, middle.id]);
    expect(movedLeaf?.depth).toBe(2);
  });

  it('rewrites the snapshot path on products in the MOVED descendants', async () => {
    const oldRoot = await makeCategory();
    const middle = await makeCategory({ parentId: oldRoot.id });
    const leaf = await makeCategory({ parentId: middle.id });
    const newRoot = await makeCategory();

    const productId = await makeProduct(leaf.id);

    await patchCategory(middle.id, { parentId: newRoot.id }).expect(200);

    const product = await products.findById(new Types.ObjectId(productId)).lean().exec();

    // The product's snapshot path is the INCLUSIVE chain of its own category.
    expect(product?.category.path.map(String)).toEqual([newRoot.id, middle.id, leaf.id]);
  });

  it('the new parent’s subtree listing then finds the moved product', async () => {
    /*
     * The end-to-end version of the two assertions above, through the public
     * route a customer actually uses. This is F-MED-10: a parent-category page
     * that omits its children's products.
     */
    const oldRoot = await makeCategory();
    const child = await makeCategory({ parentId: oldRoot.id });
    const newRoot = await makeCategory();

    await makeProduct(child.id);

    const beforeMove = await http()
      .get(`/api/v1/products?category=${newRoot.slug}`)
      .expect(200);
    expect(beforeMove.body.data).toHaveLength(0);

    await patchCategory(child.id, { parentId: newRoot.id }).expect(200);

    const afterMove = await http().get(`/api/v1/products?category=${newRoot.slug}`).expect(200);
    expect(afterMove.body.data).toHaveLength(1);
  });

  it('refuses to make a category its own parent', async () => {
    const category = await makeCategory();

    const response = await patchCategory(category.id, { parentId: category.id }).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].field).toBe('parentId');
  });

  it('refuses to move a category underneath its own descendant', async () => {
    /*
     * Mandatory per §6, and not for tidiness: a cycle makes `path[]`
     * unwritable — there is no finite ancestor chain — so every tree read
     * afterwards either loops or silently drops the branch.
     */
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });
    const grandchild = await makeCategory({ parentId: child.id });

    const direct = await patchCategory(root.id, { parentId: child.id }).expect(400);
    const indirect = await patchCategory(root.id, { parentId: grandchild.id }).expect(400);

    expect(direct.body.error.details[0].code).toBe('CYCLE');
    expect(indirect.body.error.details[0].code).toBe('CYCLE');

    // And nothing moved.
    const unchanged = await categories.findById(new Types.ObjectId(root.id)).lean().exec();
    expect(unchanged?.parentId).toBeNull();
  });

  it('checks the depth limit against the DEEPEST descendant', async () => {
    // A two-level subtree cannot move under a depth-2 category: the bottom
    // would land at depth 4. The category being moved would fit; its leaf
    // would not, which is why the check is not on the moved category.
    const a = await makeCategory();
    const b = await makeCategory({ parentId: a.id });
    const c = await makeCategory({ parentId: b.id });

    const subRoot = await makeCategory();
    await makeCategory({ parentId: subRoot.id });

    const response = await patchCategory(subRoot.id, { parentId: c.id }).expect(400);

    expect(response.body.error.details[0].code).toBe('MAX_DEPTH');
  });

  it('promotes a category to a root with parentId: null', async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });

    await patchCategory(child.id, { parentId: null }).expect(200);

    const promoted = await categories.findById(new Types.ObjectId(child.id)).lean().exec();

    expect(promoted?.parentId).toBeNull();
    expect(promoted?.path).toEqual([]);
    expect(promoted?.depth).toBe(0);
  });
});

describe('categories — delete', () => {
  it('refuses while products still belong to it, and says how many', async () => {
    const category = await makeCategory();
    await makeProduct(category.id);

    const response = await http()
      .delete(`/api/v1/admin/catalog/categories/${category.id}`)
      .set(...bearer(admin))
      .expect(409);

    expect(response.body.error.code).toBe('CATEGORY_NOT_EMPTY');
    expect(response.body.error.details[0].message).toContain('1 product');
  });

  it('refuses while live subcategories still belong to it', async () => {
    const parent = await makeCategory();
    await makeCategory({ parentId: parent.id });

    const response = await http()
      .delete(`/api/v1/admin/catalog/categories/${parent.id}`)
      .set(...bearer(admin))
      .expect(409);

    expect(response.body.error.code).toBe('CATEGORY_NOT_EMPTY');
    expect(response.body.error.details[0].message).toContain('subcategor');
  });

  it('deletes an empty one, hides it, and audits it', async () => {
    const category = await makeCategory();

    const deleted = await http()
      .delete(`/api/v1/admin/catalog/categories/${category.id}`)
      .set(...bearer(admin))
      .set('User-Agent', USER_AGENT)
      .expect(200);

    expect(deleted.body.data.deletedAt).toEqual(expect.any(String));
    expect(deleted.body.data.isActive).toBe(false);

    await http().get(`/api/v1/categories/${category.slug}`).expect(404);

    const rows = await auditLogs
      .find({ 'entity.type': AuditEntityType.CATEGORY, 'entity.id': new Types.ObjectId(category.id) })
      .lean()
      .exec();

    expect(rows.map((row) => row.action)).toContain(AuditAction.CATEGORY_DELETED);
  });

  it('refuses to edit or re-delete a deleted category', async () => {
    const category = await makeCategory();

    await http()
      .delete(`/api/v1/admin/catalog/categories/${category.id}`)
      .set(...bearer(admin))
      .expect(200);

    const edit = await patchCategory(category.id, { name: { en: 'Nope' } }).expect(409);
    const again = await http()
      .delete(`/api/v1/admin/catalog/categories/${category.id}`)
      .set(...bearer(admin))
      .expect(409);

    expect(edit.body.error.code).toBe('CATEGORY_DELETED');
    expect(again.body.error.code).toBe('CATEGORY_DELETED');
  });

  it('is excluded from the admin listing unless asked for', async () => {
    const category = await makeCategory();

    await http()
      .delete(`/api/v1/admin/catalog/categories/${category.id}`)
      .set(...bearer(admin))
      .expect(200);

    const plain = await http()
      .get('/api/v1/admin/catalog/categories')
      .set(...bearer(admin))
      .expect(200);
    const withDeleted = await http()
      .get('/api/v1/admin/catalog/categories?includeDeleted=true')
      .set(...bearer(admin))
      .expect(200);

    const ids = (rows: { id: string }[]): string[] => rows.map((row) => row.id);

    expect(ids(plain.body.data)).not.toContain(category.id);
    expect(ids(withDeleted.body.data)).toContain(category.id);
  });
});

describe('categories — restore, the "first" the refusal has been referring to', () => {
  /*
   * `PATCH` answers a deleted category with `CATEGORY_DELETED — restore it
   * first`, and until now there was no "first": the only way out of a soft
   * delete was a database edit. That mattered because a delete KEEPS the slug
   * reserved — deliberately, since reusing it would repoint existing links — so
   * a mis-click cost the name permanently.
   */

  function restoreCategory(id: string): request.Test {
    return http()
      .post(`/api/v1/admin/catalog/categories/${id}/restore`)
      .set(...bearer(admin))
      .set('User-Agent', USER_AGENT);
  }

  async function deleteCategory(id: string): Promise<void> {
    await http()
      .delete(`/api/v1/admin/catalog/categories/${id}`)
      .set(...bearer(admin))
      .expect(200);
  }

  it('brings a deleted category back, INACTIVE, and audits it', async () => {
    const category = await makeCategory();
    await deleteCategory(category.id);

    const restored = await restoreCategory(category.id).expect(200);

    expect(restored.body.data.deletedAt).toBeNull();
    /*
     * Not republished. `DELETE` set `isActive: false` and restore clears only
     * `deletedAt` — the category comes back to the EDITOR, not to the
     * storefront, which is the same rule the product restore follows.
     */
    expect(restored.body.data.isActive).toBe(false);

    const rows = await auditLogs
      .find({ 'entity.type': AuditEntityType.CATEGORY, 'entity.id': new Types.ObjectId(category.id) })
      .lean()
      .exec();

    expect(rows.map((row) => row.action)).toContain(AuditAction.CATEGORY_RESTORED);
  });

  it('makes the slug usable again — by the SAME category, not by a new one', async () => {
    const category = await makeCategory();
    await deleteCategory(category.id);

    // Still reserved while deleted: this is what makes restore necessary rather
    // than merely convenient.
    await http()
      .post('/api/v1/admin/catalog/categories')
      .set(...bearer(admin))
      .send({ slug: category.slug, name: { en: 'Impostor' } })
      .expect(409);

    await restoreCategory(category.id).expect(200);

    const listed = await http()
      .get('/api/v1/admin/catalog/categories')
      .set(...bearer(admin))
      .expect(200);

    expect((listed.body.data as { id: string }[]).map((row) => row.id)).toContain(category.id);
  });

  it('is editable again, which the deleted one was not', async () => {
    const category = await makeCategory();
    await deleteCategory(category.id);

    await patchCategory(category.id, { name: { en: 'Nope' } }).expect(409);

    await restoreCategory(category.id).expect(200);

    const edited = await patchCategory(category.id, { name: { en: 'Back In Use' } }).expect(200);
    expect(edited.body.data.name.en).toBe('Back In Use');
  });

  it('refuses a category that is not deleted', async () => {
    const category = await makeCategory();

    const refused = await restoreCategory(category.id).expect(400);
    expect(refused.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses while the PARENT is still deleted, and says to restore that first', async () => {
    /*
     * `path[]` is the materialised ancestor chain, and a chain through a deleted
     * node names a category that renders nowhere — the tree read would drop the
     * branch or show a child with no visible parent. So the order is forced.
     */
    const parent = await makeCategory();
    const child = await makeCategory({ parentId: parent.id });

    await deleteCategory(child.id);
    await deleteCategory(parent.id);

    const refused = await restoreCategory(child.id).expect(400);
    expect(refused.body.error.details[0].field).toBe('parentId');

    await restoreCategory(parent.id).expect(200);
    await restoreCategory(child.id).expect(200);
  });

  it('refuses a CUSTOMER', async () => {
    const category = await makeCategory();
    await deleteCategory(category.id);

    await http()
      .post(`/api/v1/admin/catalog/categories/${category.id}/restore`)
      .set(...bearer(customer))
      .expect(403);
  });
});

describe('brands — restore', () => {
  function restoreBrand(id: string): request.Test {
    return http()
      .post(`/api/v1/admin/catalog/brands/${id}/restore`)
      .set(...bearer(admin))
      .set('User-Agent', USER_AGENT);
  }

  it('brings a deleted brand back, INACTIVE, and audits it', async () => {
    const brand = await makeBrand();

    await http()
      .delete(`/api/v1/admin/catalog/brands/${brand.id}`)
      .set(...bearer(admin))
      .expect(200);

    const restored = await restoreBrand(brand.id).expect(200);

    expect(restored.body.data.deletedAt).toBeNull();
    expect(restored.body.data.isActive).toBe(false);

    const rows = await auditLogs
      .find({ 'entity.type': AuditEntityType.BRAND, 'entity.id': new Types.ObjectId(brand.id) })
      .lean()
      .exec();

    expect(rows.map((row) => row.action)).toContain(AuditAction.BRAND_RESTORED);
  });

  it('does NOT re-brand the products the deletion un-branded', async () => {
    /*
     * Deleting a brand un-brands its products rather than refusing — that is
     * the existing, deliberate behaviour. Restore is not its inverse and does
     * not pretend to be: the products stayed edited, and re-attaching them
     * would need a record of which ones were attached, which nothing keeps.
     */
    const brand = await makeBrand();
    const category = await makeCategory();
    const productId = await makeProduct(category.id, brand.id);

    await http()
      .delete(`/api/v1/admin/catalog/brands/${brand.id}`)
      .set(...bearer(admin))
      .expect(200);

    await restoreBrand(brand.id).expect(200);

    const product = await http()
      .get(`/api/v1/admin/catalog/products/${productId}`)
      .set(...bearer(admin))
      .expect(200);

    expect(product.body.data.brand).toBeNull();
  });

  it('refuses a brand that is not deleted', async () => {
    const brand = await makeBrand();

    await restoreBrand(brand.id).expect(400);
  });
});

describe('brands', () => {
  it('creates, and rewrites the snapshot on every product on rename', async () => {
    const brand = await makeBrand({ name: { en: 'Old Brand' } });
    const category = await makeCategory();
    const productId = await makeProduct(category.id, brand.id);

    await http()
      .patch(`/api/v1/admin/catalog/brands/${brand.id}`)
      .set(...bearer(admin))
      .send({ name: { en: 'New Brand' }, slug: `${brand.slug}-v2` })
      .expect(200);

    const product = await products.findById(new Types.ObjectId(productId)).lean().exec();

    expect(product?.brand?.name.en).toBe('New Brand');
    expect(product?.brand?.slug).toBe(`${brand.slug}-v2`);
  });

  it('validates the website as an absolute http(s) URL', async () => {
    const response = await http()
      .post('/api/v1/admin/catalog/brands')
      .set(...bearer(admin))
      .send({ slug: `taxb-bad-${RUN_ID}`, name: { en: 'Bad URL' }, website: 'espressif.com' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('deleting a brand UN-BRANDS its products rather than refusing', async () => {
    /*
     * The asymmetry with categories, and it is the design. `product.brand` is
     * nullable — 53 of 85 live products have no brand and every listing already
     * renders without one — so clearing it lands the product in a state the
     * system handles. Leaving the snapshot would put a filter in the brand
     * facet that returns products whose brand page 404s.
     */
    const brand = await makeBrand();
    const category = await makeCategory();
    const productId = await makeProduct(category.id, brand.id);

    await http()
      .delete(`/api/v1/admin/catalog/brands/${brand.id}`)
      .set(...bearer(admin))
      .set('User-Agent', USER_AGENT)
      .expect(200);

    const product = await products.findById(new Types.ObjectId(productId)).lean().exec();
    expect(product?.brand).toBeNull();

    // The product is still there and still sellable — only the brand went.
    expect(product?.isActive).toBe(true);
  });

  it('records how many products a brand deletion un-branded', async () => {
    const brand = await makeBrand();
    const category = await makeCategory();

    await makeProduct(category.id, brand.id);
    await makeProduct(category.id, brand.id);

    await http()
      .delete(`/api/v1/admin/catalog/brands/${brand.id}`)
      .set(...bearer(admin))
      .expect(200);

    const row = await auditLogs
      .findOne({ 'entity.type': AuditEntityType.BRAND, 'entity.id': new Types.ObjectId(brand.id), action: AuditAction.BRAND_DELETED })
      .lean()
      .exec();

    // The consequence the operator did not explicitly ask for.
    expect(row?.metadata).toMatchObject({ productsUnbranded: 2 });
  });

  it('refuses a CUSTOMER on every write', async () => {
    const brand = await makeBrand();

    await http()
      .post('/api/v1/admin/catalog/brands')
      .set(...bearer(customer))
      .send({ slug: `taxb-c-${RUN_ID}`, name: { en: 'Nope' } })
      .expect(403);
    await http()
      .patch(`/api/v1/admin/catalog/brands/${brand.id}`)
      .set(...bearer(customer))
      .send({ name: { en: 'Nope' } })
      .expect(403);
    await http()
      .delete(`/api/v1/admin/catalog/brands/${brand.id}`)
      .set(...bearer(customer))
      .expect(403);
  });
});
