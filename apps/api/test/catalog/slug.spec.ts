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
import {
  MAX_SLUG_LENGTH,
  isWellFormedSlug,
  nextAvailableSlug,
  slugify,
} from '../../src/modules/catalog/domain/slug';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * Slug generation, collision suffixes, and the availability check.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §2.
 *
 * ## The defect being replaced
 *
 * The admin's `check-slug` route returned `{ exists: false }` — "the slug is
 * free" — on every failure path. A database error, a missing service, any
 * exception. The form is built to trust that answer, so a check that could not
 * reach the database told the operator to proceed, and the write then failed on
 * the unique index after the rest of the product had been filled in.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const BASE_SLUG = `slugtest-${RUN_ID}`;

let app: INestApplication;
let users: Model<User>;
let products: Model<Product>;
let refreshTokens: Model<RefreshToken>;

const createdUserIds: Types.ObjectId[] = [];
const createdProductIds: Types.ObjectId[] = [];

let adminToken = '';
let customerToken = '';
let firstProductId = new Types.ObjectId();

function http(): request.Agent {
  return request(app.getHttpServer());
}

function ask(query: string) {
  return http()
    .get(`/api/v1/admin/catalog/slug-availability${query}`)
    .set('Authorization', `Bearer ${adminToken}`);
}

async function createAccount(label: string, role: Role): Promise<string> {
  const email = `slug-${label}.${RUN_ID}@example.test`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: `Slug ${label}` })
    .expect(201);
  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } }).exec();

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  const login = await http()
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  return login.body.data.accessToken as string;
}

async function createProduct(slug: string, options: { deleted?: boolean } = {}): Promise<Types.ObjectId> {
  const category = await app
    .get<Model<Category>>(getModelToken(Category.name))
    .findOne({ slug: 'development-boards' })
    .lean<{ _id: Types.ObjectId; slug: string; name: { en: string }; path: Types.ObjectId[] }>()
    .exec();

  if (category === null) {
    throw new Error('seed category development-boards is missing — run `pnpm --filter api seed`');
  }

  const created = await products.create({
    sku: `SLUG-${slug.toUpperCase()}`,
    slug,
    name: { en: 'Slug Test Board', ar: null },
    shortDescription: { en: 'Created by the slug test suite.', ar: null },
    description: null,
    category: {
      id: category._id,
      slug: category.slug,
      name: { en: category.name.en, ar: null },
      path: [...category.path, category._id],
    },
    brand: null,
    pricing: { basePrice: 1000, salePrice: null, effectivePrice: 1000, costPrice: 100 },
    currency: 'EGP',
    stock: { onHand: 10, lowStockThreshold: 5 },
    images: [],
    specs: [],
    salesCount: 0,
    isActive: true,
    isFeatured: false,
    deletedAt: options.deleted === true ? new Date() : null,
    weight: null,
  });

  createdProductIds.push(created._id);

  return created._id;
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
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));

  adminToken = await createAccount('operator', Role.ADMIN);
  customerToken = await createAccount('shopper', Role.CUSTOMER);

  firstProductId = await createProduct(BASE_SLUG);
}, 120_000);

afterAll(async () => {
  if (createdProductIds.length > 0) {
    await products.deleteMany({ _id: { $in: createdProductIds } }).exec();
  }

  if (createdUserIds.length > 0) {
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  await app.close();
});

describe('turning a name into a slug', () => {
  it('lowercases, replaces non-alphanumerics and collapses runs', () => {
    expect(slugify('ESP32 DevKit V1')).toBe('esp32-devkit-v1');
    expect(slugify('Arduino  Uno —  R3')).toBe('arduino-uno-r3');
  });

  it('trims leading and trailing separators', () => {
    expect(slugify('  --Raspberry Pi--  ')).toBe('raspberry-pi');
  });

  it('never produces an empty slug', () => {
    /*
     * An empty slug goes into a URL and a unique index. Arabic text reduces to
     * nothing under an ASCII rule, and so does a name of pure punctuation —
     * `!!!` is a plausible typo, not an adversarial input.
     */
    expect(slugify('!!!')).toBe('item');
    expect(slugify('   ')).toBe('item');
    expect(slugify('لوحة تطوير')).toBe('item');
  });

  it('bounds the length', () => {
    expect(slugify('x'.repeat(MAX_SLUG_LENGTH * 2))).toHaveLength(MAX_SLUG_LENGTH);
  });

  it('does not leave a trailing hyphen after truncation', () => {
    // Truncation can land mid-separator, which would produce `...-` — a slug
    // that is not well-formed by its own rule.
    const slug = slugify(`${'a'.repeat(MAX_SLUG_LENGTH - 1)} b`);

    expect(slug.endsWith('-')).toBe(false);
    expect(isWellFormedSlug(slug)).toBe(true);
  });
});

describe('resolving a collision', () => {
  it('returns the base when it is free', () => {
    expect(nextAvailableSlug('esp32', new Set())).toBe('esp32');
  });

  it('starts suffixes at 2, because the unsuffixed slug is the first', () => {
    // `esp32-1` beside `esp32` reads as though there were a zeroth.
    expect(nextAvailableSlug('esp32', new Set(['esp32']))).toBe('esp32-2');
  });

  it('skips suffixes already taken', () => {
    expect(nextAvailableSlug('esp32', new Set(['esp32', 'esp32-2', 'esp32-3']))).toBe('esp32-4');
  });

  it('appends rather than replacing, so the base is still readable', () => {
    expect(nextAvailableSlug('esp32-devkit-v1', new Set(['esp32-devkit-v1']))).toBe(
      'esp32-devkit-v1-2',
    );
  });
});

describe('what counts as a well-formed slug', () => {
  it('accepts the shape it generates', () => {
    expect(isWellFormedSlug('esp32-devkit-v1')).toBe(true);
    expect(isWellFormedSlug('esp32')).toBe(true);
  });

  it('refuses the shapes an operator is most likely to type', () => {
    expect(isWellFormedSlug('ESP32')).toBe(false);
    expect(isWellFormedSlug('esp32 devkit')).toBe(false);
    expect(isWellFormedSlug('-esp32')).toBe(false);
    expect(isWellFormedSlug('esp32-')).toBe(false);
    expect(isWellFormedSlug('esp32--devkit')).toBe(false);
    expect(isWellFormedSlug('')).toBe(false);
  });
});

describe('asking whether a slug is free', () => {
  it('says free for one nothing holds', async () => {
    const response = await ask(`?type=product&slug=${BASE_SLUG}-unused`).expect(200);

    expect(response.body.data).toEqual({
      slug: `${BASE_SLUG}-unused`,
      available: true,
      suggestion: null,
    });
  });

  it('says taken for one a product holds, and offers the next', async () => {
    const response = await ask(`?type=product&slug=${BASE_SLUG}`).expect(200);

    expect(response.body.data.available).toBe(false);
    expect(response.body.data.suggestion).toBe(`${BASE_SLUG}-2`);
  });

  it('skips a suffix that is itself taken', async () => {
    await createProduct(`${BASE_SLUG}-2`);

    const response = await ask(`?type=product&slug=${BASE_SLUG}`).expect(200);

    expect(response.body.data.suggestion).toBe(`${BASE_SLUG}-3`);
  });

  it('does not report an entity’s own slug as taken when editing it', async () => {
    /*
     * Without `excludeId`, opening a product and saving it unchanged reports
     * its own slug as taken and the save is refused — which makes every edit
     * to any other field impossible.
     */
    const response = await ask(
      `?type=product&slug=${BASE_SLUG}&excludeId=${firstProductId.toHexString()}`,
    ).expect(200);

    expect(response.body.data.available).toBe(true);
  });

  it('still counts a SOFT-DELETED product as holding its slug', async () => {
    /*
     * CATALOG-MODEL.md: "SKUs and slugs must not be silently reusable". Reusing
     * the slug of a deleted product repoints every existing link — every
     * bookmark, every search result, every message someone sent a customer — to
     * a different product, silently.
     */
    const slug = `${BASE_SLUG}-deleted`;

    await createProduct(slug, { deleted: true });

    const response = await ask(`?type=product&slug=${slug}`).expect(200);

    expect(response.body.data.available).toBe(false);
  });

  it('scopes the answer to the TYPE asked about', async () => {
    // A brand and a product may share a slug: they are different collections
    // with different URL spaces. Answering across all three would refuse a
    // perfectly valid brand slug because some product happens to use it.
    const response = await ask(`?type=brand&slug=${BASE_SLUG}`).expect(200);

    expect(response.body.data.available).toBe(true);
  });
});

describe('the availability check refuses what it cannot answer', () => {
  it('refuses an unauthenticated caller', async () => {
    await http()
      .get(`/api/v1/admin/catalog/slug-availability?type=product&slug=${BASE_SLUG}`)
      .expect(401);
  });

  it('refuses a CUSTOMER', async () => {
    await http()
      .get(`/api/v1/admin/catalog/slug-availability?type=product&slug=${BASE_SLUG}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });

  it('rejects a malformed slug rather than normalising it', async () => {
    /*
     * §2 rule 6 makes the slug admin-editable. Silently rewriting a malformed
     * edit leaves the operator looking at one value in the form and another in
     * the URL, and neither is wrong enough to notice.
     */
    await ask('?type=product&slug=ESP32%20DevKit').expect(400);
    await ask('?type=product&slug=-leading').expect(400);
  });

  it('rejects an unknown type rather than guessing one', async () => {
    await ask('?type=coupon&slug=anything').expect(400);
  });

  it('rejects an undocumented parameter', async () => {
    await ask(`?type=product&slug=${BASE_SLUG}&includeDeleted=false`).expect(400);
  });

  it('rejects a malformed excludeId', async () => {
    await ask(`?type=product&slug=${BASE_SLUG}&excludeId=not-an-id`).expect(400);
  });
});
