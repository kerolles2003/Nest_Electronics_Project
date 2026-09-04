import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import { Model, Types } from 'mongoose';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { validationExceptionFactory } from '../../src/common/pipes/validation-exception.factory';
import { RefreshToken } from '../../src/modules/auth/infrastructure/schemas/refresh-token.schema';
import { AuditLog } from '../../src/modules/audit/infrastructure/schemas/audit-log.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { SlugRedirect } from '../../src/modules/catalog/infrastructure/schemas/slug-redirect.schema';
import { MediaStoragePort } from '../../src/modules/media/application/ports/media-storage.port';
import { MediaAsset } from '../../src/modules/media/infrastructure/schemas/media-asset.schema';
import { InMemoryMediaStorage } from '../../src/providers/media/memory/in-memory-media-storage';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * Reference counting, proved for the first time.
 *
 * ## The state of things before this suite
 *
 * `MediaService.retain()` and `release()` were built in Phase 4 alongside the
 * ledger, and **nothing had ever called either of them.** Every asset in the
 * system therefore carried `refCount: 0` — which is not merely an unused
 * feature, because `refCount === 0` is the exact condition under which
 * `DELETE /admin/media` destroys the stored object. The count was harmless only
 * for as long as no product had an image.
 *
 * So the assertion this file exists for is not "an image can be attached". It
 * is:
 *
 *   **an asset a live product page is showing cannot be deleted**
 *
 * and its companion, which is the half legacy got wrong (W4):
 *
 *   **an asset TWO products share is not destroyed when one of them lets go**
 *
 * ## Everything below the store is real
 *
 * The upload runs the whole pipeline — multer, the MIME allow-list, magic-byte
 * sniffing, sharp, the ledger. Only the STORE is the in-memory adapter, which
 * is asserted rather than assumed: if this resolved to the Cloudinary adapter
 * the suite would make authenticated calls against the owner's real account.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const USER_AGENT = `ProductImageSuite/1.0 (${RUN_ID})`;

let app: INestApplication;
let users: Model<User>;
let products: Model<Product>;
let categories: Model<Category>;
let assets: Model<MediaAsset>;
let auditLogs: Model<AuditLog>;
let slugRedirects: Model<SlugRedirect>;
let refreshTokens: Model<RefreshToken>;
let storage: InMemoryMediaStorage;

const createdUserIds: Types.ObjectId[] = [];
const createdProductIds: Types.ObjectId[] = [];
const createdCategoryIds: Types.ObjectId[] = [];

interface Account {
  readonly id: Types.ObjectId;
  readonly token: string;
}

let admin: Account;
let superAdmin: Account;
let customer: Account;
let category: { _id: Types.ObjectId; slug: string };

function http(): request.Agent {
  return request(app.getHttpServer());
}

function bearer(account: Account): [string, string] {
  return ['Authorization', `Bearer ${account.token}`];
}

async function createAccount(label: string, role: Role = Role.CUSTOMER): Promise<Account> {
  const email = `img-${label}.${RUN_ID}@example.test`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: `Image ${label}` })
    .expect(201);

  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } }).exec();

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  const login = await http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);

  return { id: created._id, token: login.body.data.accessToken as string };
}

/** A real image — never a hand-written byte array. */
function image(width = 800, height = 600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 40, g: 120, b: 200 } } })
    .toFormat('png')
    .toBuffer();
}

/** Uploads one image through the real pipeline and returns its ledger id. */
async function upload(entityId: string): Promise<string> {
  const response = await http()
    .post('/api/v1/admin/media')
    .set(...bearer(admin))
    .field('entity', 'products')
    .field('entityId', entityId)
    .attach('file', await image(), { filename: 'photo.png', contentType: 'image/png' })
    .expect(201);

  return response.body.data.publicId as string;
}

async function makeProduct(): Promise<string> {
  const tag = randomUUID().slice(0, 6);

  const response = await http()
    .post('/api/v1/admin/catalog/products')
    .set(...bearer(admin))
    .send({
      sku: `IMG-${RUN_ID}-${tag}`.toUpperCase(),
      slug: `img-${RUN_ID}-${tag}`,
      name: { en: 'Photographed Product' },
      categoryId: category._id.toHexString(),
      basePrice: 12000,
      isActive: true,
    })
    .expect(201);

  const id = response.body.data.id as string;
  createdProductIds.push(new Types.ObjectId(id));

  return id;
}

function attach(productId: string, publicId: string, alt?: string): request.Test {
  return http()
    .post(`/api/v1/admin/catalog/products/${productId}/images`)
    .set(...bearer(admin))
    .set('User-Agent', USER_AGENT)
    .send({ publicId, ...(alt === undefined ? {} : { alt }) });
}

function detach(productId: string, publicId: string): request.Test {
  return http()
    .delete(`/api/v1/admin/catalog/products/${productId}/images`)
    .query({ publicId })
    .set(...bearer(admin))
    .set('User-Agent', USER_AGENT);
}

function destroyAsset(publicId: string): request.Test {
  return http()
    .delete('/api/v1/admin/media')
    .query({ publicId })
    .set(...bearer(admin));
}

async function refCountOf(publicId: string): Promise<number> {
  const row = await assets.findOne({ publicId }).lean<{ refCount: number }>().exec();

  // -1 rather than 0 for a missing row: "not in the ledger" and "referenced by
  // nothing" are different facts and must not compare equal.
  return row?.refCount ?? -1;
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
  assets = app.get<Model<MediaAsset>>(getModelToken(MediaAsset.name));
  auditLogs = app.get<Model<AuditLog>>(getModelToken(AuditLog.name));
  slugRedirects = app.get<Model<SlugRedirect>>(getModelToken(SlugRedirect.name));
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));

  // If this ever resolved to the Cloudinary adapter the suite would start
  // making authenticated network calls against the owner's real account.
  const port = app.get(MediaStoragePort);
  expect(port).toBeInstanceOf(InMemoryMediaStorage);
  storage = port as InMemoryMediaStorage;

  admin = await createAccount('operator', Role.ADMIN);
  superAdmin = await createAccount('owner', Role.SUPER_ADMIN);
  customer = await createAccount('shopper');

  const created = await categories.create({
    slug: `img-cat-${RUN_ID}`,
    name: { en: 'Photographed', ar: null },
    parentId: null,
    path: [],
    depth: 0,
  });
  createdCategoryIds.push(created._id);
  category = { _id: created._id, slug: created.slug };
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

  // Every asset this suite uploaded, whatever its reference count ended at.
  await assets.deleteMany({ publicId: new RegExp(`^nest/products/`) }).exec();
  storage.clear();

  if (createdUserIds.length > 0) {
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  await app.close();
});

describe('attaching an image — the first caller retain() has ever had', () => {
  it('starts at zero references, which is what made the count dangerous', async () => {
    const productId = await makeProduct();
    const publicId = await upload(productId);

    // An uploaded, unattached asset. Legitimate — and the only state from which
    // destruction is allowed, which is why nothing incrementing it was a defect
    // rather than an omission.
    expect(await refCountOf(publicId)).toBe(0);
  });

  it('increments the count and puts the descriptor on the product', async () => {
    const productId = await makeProduct();
    const publicId = await upload(productId);

    const response = await attach(productId, publicId, 'Front view').expect(200);

    expect(await refCountOf(publicId)).toBe(1);
    expect(response.body.data.images).toHaveLength(1);
    expect(response.body.data.images[0]).toMatchObject({
      publicId,
      alt: 'Front view',
      sortOrder: 0,
      isPrimary: true,
    });
  });

  it('takes every dimension from the LEDGER, not from the caller', async () => {
    /*
     * MEDIA-MODEL.md §4: the browser is never the authority for media metadata.
     * The DTO has no width, height, format, bytes or version, so sending one is
     * a 400 — and the descriptor that lands carries the real numbers sharp
     * measured on the server.
     */
    const productId = await makeProduct();
    const publicId = await upload(productId);

    const rejected = await attach(productId, publicId)
      .send({ publicId, width: 4, height: 4, version: 999 })
      .expect(400);

    expect(rejected.body.error.code).toBe('UNKNOWN_FIELD');

    const accepted = await attach(productId, publicId).expect(200);
    const ledgerRow = await assets.findOne({ publicId }).lean().exec();

    expect(accepted.body.data.images[0]).toMatchObject({
      width: ledgerRow?.width,
      height: ledgerRow?.height,
      format: ledgerRow?.format,
      bytes: ledgerRow?.bytes,
      version: ledgerRow?.version,
    });
    expect(accepted.body.data.images[0].width).toBeGreaterThan(4);
  });

  it('refuses an asset that is not in the ledger', async () => {
    const productId = await makeProduct();

    const response = await attach(productId, 'nest/products/aaaaaaaaaaaaaaaaaaaaaaaa/notreal').expect(404);

    expect(response.body.error.code).toBe('MEDIA_ASSET_NOT_FOUND');
  });

  it('refuses the same asset twice, rather than silently double-counting', async () => {
    const productId = await makeProduct();
    const publicId = await upload(productId);

    await attach(productId, publicId).expect(200);
    const second = await attach(productId, publicId).expect(409);

    expect(second.body.error.code).toBe('PRODUCT_IMAGE_ALREADY_ATTACHED');
    // The count did not move. A silent second attach would either strand the
    // asset at 2 forever, or leave it at 1 short of the truth.
    expect(await refCountOf(publicId)).toBe(1);
  });

  it('refuses a ninth image', async () => {
    const productId = await makeProduct();

    for (let index = 0; index < 8; index += 1) {
      await attach(productId, await upload(productId)).expect(200);
    }

    const ninth = await attach(productId, await upload(productId)).expect(409);

    expect(ninth.body.error.code).toBe('PRODUCT_IMAGE_LIMIT');
  });

  it('refuses a CUSTOMER, and the count does not move', async () => {
    const productId = await makeProduct();
    const publicId = await upload(productId);

    await http()
      .post(`/api/v1/admin/catalog/products/${productId}/images`)
      .set(...bearer(customer))
      .send({ publicId })
      .expect(403);

    expect(await refCountOf(publicId)).toBe(0);
  });
});

describe('a referenced asset cannot be deleted — the guarantee this all exists for', () => {
  it('refuses DELETE /admin/media while a product shows it, naming the count', async () => {
    const productId = await makeProduct();
    const publicId = await upload(productId);

    // Deletable while nothing points at it.
    const beforeAttach = await refCountOf(publicId);
    expect(beforeAttach).toBe(0);

    await attach(productId, publicId).expect(200);

    const refused = await destroyAsset(publicId).expect(409);

    expect(refused.body.error.code).toBe('MEDIA_ASSET_IN_USE');
    expect(refused.body.error.details[0].message).toContain('1 document');

    // And it is still there — both in the store and in the ledger.
    expect(await storage.list('nest')).toContain(publicId);
    expect(await refCountOf(publicId)).toBe(1);
  });

  it('the product page still renders it, which is the point', async () => {
    const productId = await makeProduct();
    const publicId = await upload(productId);

    await attach(productId, publicId).expect(200);
    await destroyAsset(publicId).expect(409);

    const product = await products.findById(new Types.ObjectId(productId)).lean().exec();
    const detail = await http().get(`/api/v1/products/${product?.slug ?? ''}`).expect(200);

    expect(detail.body.data.images[0].publicId).toBe(publicId);
  });

  it('becomes deletable again once the last product lets go', async () => {
    const productId = await makeProduct();
    const publicId = await upload(productId);

    await attach(productId, publicId).expect(200);
    await destroyAsset(publicId).expect(409);

    await detach(productId, publicId).expect(200);
    expect(await refCountOf(publicId)).toBe(0);

    await destroyAsset(publicId).expect(204);
    expect(await storage.list('nest')).not.toContain(publicId);
  });

  it('TWO products sharing one asset — releasing one does not destroy it (W4)', async () => {
    /*
     * The legacy defect in its original form. Product duplication copied the URL
     * string, so two products ended up sharing one storage object; deleting the
     * image from either destroyed it for both, and the surviving product
     * rendered a broken image with no indication of why.
     */
    const first = await makeProduct();
    const second = await makeProduct();
    const publicId = await upload(first);

    await attach(first, publicId).expect(200);
    await attach(second, publicId).expect(200);
    expect(await refCountOf(publicId)).toBe(2);

    await detach(first, publicId).expect(200);

    // One is gone, one remains — so it is still undeletable, and still there.
    expect(await refCountOf(publicId)).toBe(1);
    await destroyAsset(publicId).expect(409);
    expect(await storage.list('nest')).toContain(publicId);

    const survivor = await products.findById(new Types.ObjectId(second)).lean().exec();
    expect(survivor?.images[0]?.publicId).toBe(publicId);
  });

  it('detaching NEVER destroys the asset itself', async () => {
    /*
     * §9: reconciliation REPORTS rather than deletes, because an automated
     * deleter that misreads state destroys production assets irreversibly. An
     * asset at zero references is a candidate, not a casualty.
     */
    const productId = await makeProduct();
    const publicId = await upload(productId);

    await attach(productId, publicId).expect(200);
    await detach(productId, publicId).expect(200);

    expect(await refCountOf(publicId)).toBe(0);
    expect(await storage.list('nest')).toContain(publicId);

    const report = await http()
      .get('/api/v1/admin/media/reconciliation')
      .set(...bearer(admin))
      .expect(200);

    expect(report.body.data.unreferenced.map((row: { publicId: string }) => row.publicId)).toContain(
      publicId,
    );
  });
});

describe('detaching', () => {
  it('promotes the next image when the primary is removed', async () => {
    const productId = await makeProduct();
    const first = await upload(productId);
    const second = await upload(productId);

    await attach(productId, first).expect(200);
    await attach(productId, second).expect(200);

    const after = await detach(productId, first).expect(200);

    // Never zero primaries while there are images — K10's symptom, reached by
    // a different route.
    expect(after.body.data.images).toHaveLength(1);
    expect(after.body.data.images[0]).toMatchObject({ publicId: second, isPrimary: true });
  });

  it('renumbers sortOrder so there is no gap', async () => {
    const productId = await makeProduct();
    const ids = [await upload(productId), await upload(productId), await upload(productId)];

    for (const id of ids) await attach(productId, id).expect(200);

    const after = await detach(productId, ids[1] as string).expect(200);

    expect(after.body.data.images.map((row: { sortOrder: number }) => row.sortOrder)).toEqual([0, 1]);
  });

  it('answers 404 for an image the product does not have', async () => {
    const productId = await makeProduct();
    const other = await makeProduct();
    const publicId = await upload(other);

    await attach(other, publicId).expect(200);

    const response = await detach(productId, publicId).expect(404);

    expect(response.body.error.code).toBe('PRODUCT_IMAGE_NOT_FOUND');
    // The other product's reference is untouched.
    expect(await refCountOf(publicId)).toBe(1);
  });
});

describe('arranging — K9 and K10, both closed by writing the array whole', () => {
  function arrange(productId: string, images: unknown[]): request.Test {
    return http()
      .put(`/api/v1/admin/catalog/products/${productId}/images`)
      .set(...bearer(admin))
      .set('User-Agent', USER_AGENT)
      .send({ images });
  }

  async function productWithThree(): Promise<{ productId: string; ids: string[] }> {
    const productId = await makeProduct();
    const ids = [await upload(productId), await upload(productId), await upload(productId)];

    for (const id of ids) await attach(productId, id).expect(200);

    return { productId, ids };
  }

  it('reorders by POSITION, in one write (K9)', async () => {
    const { productId, ids } = await productWithThree();

    const reversed = [...ids].reverse();
    const after = await arrange(
      productId,
      reversed.map((publicId) => ({ publicId })),
    ).expect(200);

    expect(after.body.data.images.map((row: { publicId: string }) => row.publicId)).toEqual(reversed);
    expect(after.body.data.images.map((row: { sortOrder: number }) => row.sortOrder)).toEqual([0, 1, 2]);
  });

  it('moves the primary flag with exactly one winner (K10)', async () => {
    const { productId, ids } = await productWithThree();

    const after = await arrange(
      productId,
      ids.map((publicId, index) => ({ publicId, isPrimary: index === 2 })),
    ).expect(200);

    const primaries = after.body.data.images.filter((row: { isPrimary: boolean }) => row.isPrimary);

    expect(primaries).toHaveLength(1);
    expect(primaries[0].publicId).toBe(ids[2]);
  });

  it('never leaves a product with no primary, even if the client names none', async () => {
    const { productId, ids } = await productWithThree();

    const after = await arrange(
      productId,
      ids.map((publicId) => ({ publicId })),
    ).expect(200);

    expect(after.body.data.images.filter((row: { isPrimary: boolean }) => row.isPrimary)).toHaveLength(1);
    expect(after.body.data.images[0].isPrimary).toBe(true);
  });

  it('refuses more than one primary', async () => {
    const { productId, ids } = await productWithThree();

    const response = await arrange(
      productId,
      ids.map((publicId) => ({ publicId, isPrimary: true })),
    ).expect(400);

    expect(response.body.error.details[0].code).toBe('PRIMARY');
  });

  it('cannot add or remove an image, so it cannot move a reference count', async () => {
    const { productId, ids } = await productWithThree();
    const extra = await upload(productId);

    const tooMany = await arrange(
      productId,
      [...ids, extra].map((publicId) => ({ publicId })),
    ).expect(400);
    const tooFew = await arrange(productId, [{ publicId: ids[0] }]).expect(400);

    expect(tooMany.body.error.details[0].code).toBe('SET_MISMATCH');
    expect(tooFew.body.error.details[0].code).toBe('SET_MISMATCH');

    // Nothing moved: three references held, the extra still at zero.
    for (const id of ids) expect(await refCountOf(id)).toBe(1);
    expect(await refCountOf(extra)).toBe(0);
  });

  it('refuses a repeated publicId', async () => {
    const { productId, ids } = await productWithThree();

    const response = await arrange(productId, [
      { publicId: ids[0] },
      { publicId: ids[0] },
      { publicId: ids[1] },
    ]).expect(400);

    expect(response.body.error.details[0].code).toBe('DUPLICATE');
  });

  it('updates captions without touching the ledger', async () => {
    const { productId, ids } = await productWithThree();

    const after = await arrange(
      productId,
      ids.map((publicId, index) => ({ publicId, alt: `View ${String(index)}` })),
    ).expect(200);

    expect(after.body.data.images.map((row: { alt: string }) => row.alt)).toEqual([
      'View 0',
      'View 1',
      'View 2',
    ]);
    for (const id of ids) expect(await refCountOf(id)).toBe(1);
  });
});

describe('hard delete', () => {
  function hardDelete(productId: string, account: Account): request.Test {
    return http()
      .delete(`/api/v1/admin/catalog/products/${productId}/permanent`)
      .set(...bearer(account))
      .set('User-Agent', USER_AGENT);
  }

  it('is SUPER_ADMIN only — an ADMIN gets 403 here and 200 on the soft delete', async () => {
    const productId = await makeProduct();

    await hardDelete(productId, admin).expect(403);

    await http()
      .delete(`/api/v1/admin/catalog/products/${productId}`)
      .set(...bearer(admin))
      .expect(200);
  });

  it('destroys the document and the images nothing else is showing', async () => {
    const productId = await makeProduct();
    const publicId = await upload(productId);

    await attach(productId, publicId).expect(200);

    const response = await hardDelete(productId, superAdmin).expect(200);

    expect(response.body.data.imagesDestroyed).toEqual([publicId]);
    expect(response.body.data.imagesKept).toEqual([]);
    expect(await products.findById(new Types.ObjectId(productId)).lean().exec()).toBeNull();
    expect(await storage.list('nest')).not.toContain(publicId);
    expect(await refCountOf(publicId)).toBe(-1);
  });

  it('LEAVES an image another product is showing', async () => {
    const doomed = await makeProduct();
    const survivor = await makeProduct();
    const publicId = await upload(doomed);

    await attach(doomed, publicId).expect(200);
    await attach(survivor, publicId).expect(200);

    const response = await hardDelete(doomed, superAdmin).expect(200);

    expect(response.body.data.imagesDestroyed).toEqual([]);
    expect(response.body.data.imagesKept).toEqual([publicId]);
    // Still stored, still counted, still on the surviving product's page.
    expect(await storage.list('nest')).toContain(publicId);
    expect(await refCountOf(publicId)).toBe(1);
  });

  it('refuses a product an order refers to, and says how many', async () => {
    /*
     * §9 allows a hard delete only for a product "never referenced by any
     * order". Orders embed snapshots so the record survives — but every line
     * keeps `productId` for traceability and reorder, and destroying the
     * document turns that into a dangling id.
     */
    const productId = await makeProduct();
    const orders = app.get<Model<{ items: unknown[] }>>(getModelToken('Order'));

    const count = await orders.countDocuments({ 'items.productId': new Types.ObjectId(productId) }).exec();
    expect(count).toBe(0);

    // Placing a real order here would drag in the whole checkout fixture; the
    // guard is a countDocuments on `items.productId`, so a direct line is the
    // same input by the same path.
    await orders.collection.insertOne({
      _id: new Types.ObjectId(),
      items: [{ productId: new Types.ObjectId(productId) }],
      __suiteFixture: RUN_ID,
    } as never);

    const refused = await hardDelete(productId, superAdmin).expect(409);

    expect(refused.body.error.code).toBe('PRODUCT_HAS_ORDERS');
    expect(refused.body.error.details[0].message).toContain('1 order');
    expect(await products.findById(new Types.ObjectId(productId)).lean().exec()).not.toBeNull();

    await orders.collection.deleteMany({ __suiteFixture: RUN_ID } as never);
  });

  it('forgets the slug redirects, which a soft delete keeps', async () => {
    const productId = await makeProduct();
    const product = await products.findById(new Types.ObjectId(productId)).lean().exec();
    const renamed = `${product?.slug ?? ''}-moved`;

    await http()
      .patch(`/api/v1/admin/catalog/products/${productId}`)
      .set(...bearer(admin))
      .send({ slug: renamed })
      .expect(200);

    expect(
      await slugRedirects.countDocuments({ entityId: new Types.ObjectId(productId) }).exec(),
    ).toBe(1);

    await hardDelete(productId, superAdmin).expect(200);

    // A redirect to a 404 is worse than a 404 — it costs the client a round
    // trip to reach the same answer.
    expect(
      await slugRedirects.countDocuments({ entityId: new Types.ObjectId(productId) }).exec(),
    ).toBe(0);
  });
});
