import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import { Model, Types } from 'mongoose';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ImageImporter } from '../../src/database/import/image-importer';
import { ImportRunner } from '../../src/database/import/import-runner';
import type { RowResult } from '../../src/database/import/import-report';
import { validateProfile, type MappingProfile } from '../../src/database/import/mapping-profile';
import { Brand } from '../../src/modules/catalog/infrastructure/schemas/brand.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { MediaService } from '../../src/modules/media/application/media.service';
import { validationExceptionFactory } from '../../src/common/pipes/validation-exception.factory';
import { mediaConfig, type MediaConfig } from '../../src/config/media.config';
import { MediaStoragePort } from '../../src/modules/media/application/ports/media-storage.port';
import {
  MediaAsset,
  type MediaAssetLean,
} from '../../src/modules/media/infrastructure/schemas/media-asset.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';
import { CloudinaryMediaStorage } from '../../src/providers/media/cloudinary/cloudinary-media-storage';

/**
 * The media pipeline against the REAL Cloudinary account.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §2 (ADR-MEDIA-001), §4–§9.
 *
 * ## Opt-in, and why
 *
 *     pnpm --filter api test:cloudinary
 *
 * These are real, authenticated, billable calls. Running them from `pnpm test`
 * would upload from every developer's machine on every run and fail wherever
 * there is no network — the media form of the 225 live email sends F-07 found.
 * Without `CLOUDINARY_INTEGRATION=1` the whole file skips, loudly.
 *
 * ## What this proves that the default media suite cannot
 *
 * `media-upload.spec.ts` runs the same pipeline against the in-memory adapter,
 * which proves everything the server does to the bytes. What it cannot prove is
 * the half that only a vendor can answer: whether Cloudinary accepts the
 * request this code builds, and whether the response carries the fields the
 * mapping reads. That was the one item recorded as unproven at the end of Phase
 * 4, and it is what this file closes.
 *
 * ## Isolation and cleanup
 *
 * Every upload lands under `dev-test/<runId>/…` — `folderRoot` is a config
 * value, so the whole suite is redirected by overriding one namespace, and no
 * test can reach the `nest/` prefix real content will use.
 *
 * `afterAll` lists that prefix from Cloudinary and destroys whatever is left,
 * so a run that fails half way still cleans up after itself. It asserts the
 * prefix is empty afterwards: a cleanup nobody checks is how a test account
 * fills up.
 */

const INTEGRATION = process.env['CLOUDINARY_INTEGRATION'] === '1';

const RUN_ID = randomUUID().slice(0, 8);
const TEST_ROOT = `dev-test/${RUN_ID}`;
const PASSWORD = 'brass thermionic valve';
const ENTITY_ID = '68b000000000000000000001';

let app: INestApplication;
let users: Model<User>;
let assets: Model<MediaAsset>;
let storage: CloudinaryMediaStorage;
let config: MediaConfig;
let admin: { id: Types.ObjectId; token: string };

const createdUserIds: Types.ObjectId[] = [];

function http(): request.Agent {
  return request(app.getHttpServer());
}

/** A real image of the requested size and format — never a hand-written array. */
function image(format: 'jpeg' | 'png' | 'webp', width = 1200, height = 800): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 210, g: 60, b: 40 } } })
    .toFormat(format)
    .toBuffer();
}

function upload(
  file: Buffer,
  options: { filename?: string; contentType?: string } = {},
): request.Test {
  return http()
    .post('/api/v1/admin/media')
    .set('Authorization', `Bearer ${admin.token}`)
    .field('entity', 'products')
    .field('entityId', ENTITY_ID)
    .attach('file', file, {
      filename: options.filename ?? 'photo.jpg',
      contentType: options.contentType ?? 'image/jpeg',
    });
}

/**
 * The credentials, read once and never logged.
 *
 * Absence is a hard failure rather than a skip: the suite was invoked
 * deliberately, so silently passing with nothing exercised would be the worst
 * possible answer.
 *
 * ## The rule this file follows, and why it is written here
 *
 * **A credential value never enters an assertion, an error message, a snapshot
 * or a log line.** Presence is checked; the value is passed to the adapter and
 * nowhere else, and the message below names the VARIABLES rather than what they
 * contain.
 *
 * This is the only place in the test suite that touches a credential at all,
 * which is why the rule is recorded here. It was learned the expensive way: a
 * test once asserted `expect(process.env['CLOUDINARY_API_KEY']).toBeUndefined()`
 * — an assertion that looks harmless, and printed the key into the failure
 * output the day the account arrived. `test/infrastructure/secret-hygiene.spec.ts`
 * now fails if any credential value reaches a tracked file.
 */
function credentials(): { cloudName: string; apiKey: string; apiSecret: string } {
  const cloudName = process.env['CLOUDINARY_CLOUD_NAME'];
  const apiKey = process.env['CLOUDINARY_API_KEY'];
  const apiSecret = process.env['CLOUDINARY_API_SECRET'];

  if (cloudName === undefined || apiKey === undefined || apiSecret === undefined) {
    throw new Error(
      'CLOUDINARY_INTEGRATION=1 but no credentials in the environment. ' +
        'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.',
    );
  }

  return { cloudName, apiKey, apiSecret };
}

const suite = INTEGRATION ? describe : describe.skip;

if (!INTEGRATION) {
  // Visible in the default run, so this file cannot be quietly forgotten.
  console.log(
    'cloudinary-integration: SKIPPED. Run `pnpm --filter api test:cloudinary` ' +
      'to exercise the real account.',
  );
}

suite('the media pipeline, against the real Cloudinary account', () => {
  beforeAll(async () => {
    storage = new CloudinaryMediaStorage(credentials());

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      /*
       * The REAL adapter, injected in place of whatever `MEDIA_PROVIDER`
       * selects. That keeps `MEDIA_PROVIDER=memory` everywhere else — so the
       * default suite's guarantee that nothing reaches a real account is
       * untouched — while this file drives the whole application stack through
       * Cloudinary.
       */
      .overrideProvider(MediaStoragePort)
      .useValue(storage)
      /*
       * Uploads land under `dev-test/<runId>/`, never `nest/`. One override,
       * because `folderRoot` is the only thing that decides where a public id
       * is rooted.
       */
      .overrideProvider(mediaConfig.KEY)
      .useFactory({
        inject: [],
        /*
         * `mediaConfig()` is called INSIDE the factory, not at module load.
         * The namespace reads validated environment, which does not exist until
         * `ConfigModule` has run — calling it any earlier throws
         * "Configuration accessed before validateEnv() ran".
         *
         * Spreading the real namespace means exactly one field differs from
         * production. Retyping the five limits here would let a test silently
         * exercise a different size cap than the application enforces.
         */
        factory: () => ({ ...mediaConfig(), folderRoot: TEST_ROOT }),
      })
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
    assets = app.get<Model<MediaAsset>>(getModelToken(MediaAsset.name));
    config = app.get<MediaConfig>(mediaConfig.KEY);

    expect(config.folderRoot).toBe(TEST_ROOT);
    expect(app.get(MediaStoragePort)).toBeInstanceOf(CloudinaryMediaStorage);

    const email = `cloudinary-admin.${RUN_ID}@example.test`;
    await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Cloudinary Admin' })
      .expect(201);
    await users
      .updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role: Role.ADMIN } })
      .exec();

    const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
    createdUserIds.push(created._id);

    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);

    admin = { id: created._id, token: login.body.data.accessToken as string };
  }, 180_000);

  afterAll(async () => {
    /*
     * Remote first, then local. Destroying by what Cloudinary ACTUALLY holds
     * rather than by what the ledger recorded is the only cleanup that also
     * removes assets from a case that failed between the upload and the ledger
     * write — which is exactly the state the orphan report exists to describe.
     */
    if (storage !== undefined) {
      for (const publicId of await storage.list(TEST_ROOT)) {
        await storage.destroy(publicId);
      }

      // Asserted, not assumed. A cleanup nobody checks is how a test account
      // silently fills with a decade of orphans.
      expect(await storage.list(TEST_ROOT)).toEqual([]);
    }

    if (app !== undefined) {
      await assets.deleteMany({ publicId: new RegExp(`^${TEST_ROOT}/`) }).exec();

      if (createdUserIds.length > 0) {
        await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
      }

      await app.close();
    }
  }, 180_000);

  describe('upload', () => {
    it('stores the bytes and answers with the fields the ledger records', async () => {
      const response = await upload(await image('jpeg', 1200, 800)).expect(201);
      const asset = response.body.data;

      expect(asset.publicId).toMatch(new RegExp(`^${TEST_ROOT}/products/${ENTITY_ID}/`));
      expect(asset.width).toBe(1200);
      expect(asset.height).toBe(800);
      expect(typeof asset.version).toBe('number');
      expect(asset.bytes).toBeGreaterThan(0);

      /*
       * `jpeg`, not `jpg`.
       *
       * Cloudinary answers `format: "jpg"` — measured. Everything else in this
       * system says `jpeg`, so the adapter normalises the spelling; without
       * that, the same image would be recorded differently depending on which
       * adapter stored it, and a port whose output depends on the vendor behind
       * it is not a port.
       */
      expect(asset.format).toBe('jpeg');
    });

    it('returns NO absolute URL, anywhere in the response', async () => {
      /*
       * ADR-MEDIA-002, and the legacy defect it exists to prevent: baked-in
       * absolute URLs made a CDN change a data migration.
       *
       * Cloudinary's own response carries `url` and `secure_url`. This asserts
       * the mapping drops both — the strongest form, over the whole serialised
       * body rather than a field list, so a future field carrying a URL fails
       * this too.
       */
      const response = await upload(await image('png', 800, 600), {
        filename: 'photo.png',
        contentType: 'image/png',
      }).expect(201);

      expect(JSON.stringify(response.body)).not.toMatch(/https?:\/\//);
      expect(JSON.stringify(response.body)).not.toContain('res.cloudinary.com');
    });

    it('stores a provider-relative identifier in the ledger, not a URL', async () => {
      const response = await upload(await image('webp', 900, 900), {
        filename: 'photo.webp',
        contentType: 'image/webp',
      }).expect(201);
      const publicId = response.body.data.publicId as string;

      const row = (await assets.findOne({ publicId }).lean<MediaAssetLean>().exec()) as MediaAssetLean;

      expect(row).not.toBeNull();
      expect(row.publicId).toBe(publicId);
      expect(JSON.stringify(row)).not.toMatch(/https?:\/\//);
    });

    it('is RETRIEVABLE from Cloudinary under exactly that identifier', async () => {
      /*
       * The end of the chain. Everything above proves what was said; this
       * proves the asset is really there, by asking Cloudinary rather than by
       * trusting the upload response.
       */
      const response = await upload(await image('jpeg')).expect(201);
      const publicId = response.body.data.publicId as string;

      expect(await storage.list(TEST_ROOT)).toContain(publicId);
    });

    it('strips EXIF, and bakes the orientation in first', async () => {
      /*
       * A 1200x800 JPEG tagged "rotate 90°". A viewer honouring the tag shows
       * it as 800x1200.
       *
       * Two things must both be true, and getting the ORDER wrong breaks the
       * second: the metadata must be gone, and the pixels must already be
       * rotated. Strip before rotating and every phone photograph is stored
       * sideways forever.
       */
      const rotated = await sharp({
        create: { width: 1200, height: 800, channels: 3, background: { r: 10, g: 120, b: 90 } },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer();

      const response = await upload(rotated).expect(201);

      // Rotated on the way in, so the stored object is portrait.
      expect(response.body.data.width).toBe(800);
      expect(response.body.data.height).toBe(1200);
    });

    it('downscales an image above the maximum edge', async () => {
      const response = await upload(await image('jpeg', 6000, 3000)).expect(201);

      expect(response.body.data.width).toBe(config.maxEdge);
      expect(response.body.data.height).toBe(config.maxEdge / 2);
    });
  });

  describe('what it refuses — against the real account', () => {
    /**
     * Nothing reached Cloudinary. Asserted by listing the prefix, which is the
     * only check that would notice a refusal happening AFTER the upload rather
     * than before it — the difference between a validated pipeline and one that
     * uploads first and apologises later.
     */
    async function expectNothingStored(before: readonly string[]): Promise<void> {
      expect(await storage.list(TEST_ROOT)).toEqual([...before]);
    }

    it('refuses a JPEG that claims to be a PNG, and stores nothing', async () => {
      const before = await storage.list(TEST_ROOT);

      const response = await upload(await image('jpeg'), {
        filename: 'lying.png',
        contentType: 'image/png',
      }).expect(400);

      expect(response.body.error.code).toBe('INVALID_UPLOAD');
      await expectNothingStored(before);
    });

    it('refuses an SVG, and stores nothing', async () => {
      // Executable markup on a whitelisted image host is a stored-XSS vector
      // (MEDIA-MODEL.md §5). It is refused by the SNIFFER, not by the filename.
      const before = await storage.list(TEST_ROOT);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

      await upload(svg, { filename: 'x.svg', contentType: 'image/svg+xml' }).expect(400);
      await upload(svg, { filename: 'x.png', contentType: 'image/png' }).expect(400);

      await expectNothingStored(before);
    });

    it('refuses an oversized file, and stores nothing', async () => {
      /*
       * Refused by the multipart limit before the body is fully read, so the
       * bytes never reach sharp and certainly never reach Cloudinary. That
       * ordering is the point: an upload cap enforced after the upload is not a
       * cap.
       */
      const before = await storage.list(TEST_ROOT);
      const huge = Buffer.alloc(config.maxBytes + 1024, 0x41);
      // A real PNG header, so a refusal cannot be attributed to the sniffer.
      (await image('png')).copy(huge, 0, 0, 64);

      const response = await upload(huge, { filename: 'huge.jpg' });

      // 400 or 413 — multer aborts the stream and the exact code is its choice.
      // What matters is that it is a refusal and that nothing was stored.
      expect(response.status).toBeGreaterThanOrEqual(400);
      await expectNothingStored(before);
    });

    it('refuses an image below the minimum edge, and stores nothing', async () => {
      const before = await storage.list(TEST_ROOT);

      await upload(await image('jpeg', 100, 100)).expect(400);
      await expectNothingStored(before);
    });

    it('refuses a signed-in CUSTOMER, and stores nothing', async () => {
      const before = await storage.list(TEST_ROOT);
      const email = `cloudinary-customer.${RUN_ID}@example.test`;

      await http()
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD, fullName: 'Customer' })
        .expect(201);
      await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date() } }).exec();

      const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
      createdUserIds.push(created._id);

      const login = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      await http()
        .post('/api/v1/admin/media')
        .set('Authorization', `Bearer ${login.body.data.accessToken as string}`)
        .field('entity', 'products')
        .field('entityId', ENTITY_ID)
        .attach('file', await image('jpeg'), { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(403);

      await expectNothingStored(before);
    });
  });

  describe('delete', () => {
    it('removes the asset from Cloudinary, not only from the ledger', async () => {
      /*
       * The assertion that distinguishes a delete from a forget. A ledger row
       * removed while the object survives is precisely the orphan the
       * reconciliation report exists to find — and paying for.
       */
      const response = await upload(await image('jpeg')).expect(201);
      const publicId = response.body.data.publicId as string;

      expect(await storage.list(TEST_ROOT)).toContain(publicId);

      // 204, not 200: a successful delete has nothing to say.
      await http()
        .delete('/api/v1/admin/media')
        .query({ publicId })
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204);

      expect(await storage.list(TEST_ROOT)).not.toContain(publicId);
      expect(await assets.countDocuments({ publicId }).exec()).toBe(0);
    });

    it('treats an already-destroyed asset as success, so a retry is safe', async () => {
      // Cloudinary answers `{ result: 'not found' }` rather than raising.
      // Verified against the real account, because the whole retry story of a
      // partially-failed delete rests on it.
      const response = await upload(await image('jpeg')).expect(201);
      const publicId = response.body.data.publicId as string;

      await storage.destroy(publicId);
      await expect(storage.destroy(publicId)).resolves.toBeUndefined();

      await assets.deleteOne({ publicId }).exec();
    });
  });

  describe('the catalogue import, with real images', () => {
    /*
     * The claim `--images` makes is that running the same file twice changes
     * nothing the second time. Proving that against the in-memory store proves
     * the LOGIC; proving it here proves the thing that actually costs money —
     * that a second run does not upload a second copy of every photograph and
     * leave the first as an orphan.
     */
    const SKU = `IMPINT-${RUN_ID.toUpperCase()}`;
    let folder: string;
    let products: Model<Product>;

    const csv = () =>
      'SKU,Name,Category,Price,Stock,Images\n' +
      `${SKU},Cloudinary Import ${RUN_ID},tools,199.00,10,a.jpg;b.png\n`;

    function profile(): MappingProfile {
      return validateProfile({
        name: 'cloudinary-import',
        format: 'csv',
        delimiter: ',',
        upsertKey: 'sku',
        fields: {
          sku: { column: 'SKU', type: 'string' },
          name: { column: 'Name', type: 'string' },
          categorySlug: { column: 'Category', type: 'string' },
          basePrice: { column: 'Price', type: 'minorUnits' },
          onHand: { column: 'Stock', type: 'integer' },
          imagePaths: { column: 'Images', type: 'stringList' },
        },
      });
    }

    async function runImport(): Promise<RowResult> {
      const runner = new ImportRunner(
        {
          products,
          categories: app.get<Model<Category>>(getModelToken(Category.name)),
          brands: app.get<Model<Brand>>(getModelToken(Brand.name)),
        },
        new ImageImporter(app.get(MediaService), config, join(folder, 'catalogue.csv')),
      );

      const report = await runner.run({
        content: csv(),
        format: 'csv',
        profile: profile(),
        file: join(folder, 'catalogue.csv'),
        dryRun: false,
      });

      return report.rows[0] as RowResult;
    }

    beforeAll(async () => {
      products = app.get<Model<Product>>(getModelToken(Product.name));
      folder = mkdtempSync(join(tmpdir(), 'nest-cloudinary-import-'));

      writeFileSync(join(folder, 'a.jpg'), await image('jpeg', 1400, 1000));
      writeFileSync(join(folder, 'b.png'), await image('png', 1000, 1000));
    });

    afterAll(async () => {
      await products.deleteMany({ sku: new RegExp(`^${SKU}`) }).exec();
      rmSync(folder, { recursive: true, force: true });
    });

    it('uploads once, and a second run uploads nothing and orphans nothing', async () => {
      const before = (await storage.list(TEST_ROOT)).length;

      const first = await runImport();
      expect(first.outcome).toBe('created');
      expect(first.images?.uploaded).toBe(2);

      const afterFirst = await storage.list(TEST_ROOT);
      expect(afterFirst).toHaveLength(before + 2);

      const second = await runImport();
      expect(second.outcome).toBe('unchanged');
      expect(second.images?.uploaded).toBe(0);
      expect(second.images?.skipped).toBe(2);

      // The decisive assertion: the SAME assets, not merely the same count. A
      // count would also pass if the second run had uploaded two new ones and
      // the first two had been destroyed.
      expect(await storage.list(TEST_ROOT)).toEqual(afterFirst);

      const product = (await products
        .findOne({ sku: SKU })
        .lean<{ images: { publicId: string }[] }>()
        .exec()) as { images: { publicId: string }[] };

      expect(product.images).toHaveLength(2);
      expect(product.images.every((row) => afterFirst.includes(row.publicId))).toBe(true);
    }, 180_000);
  });

  describe('the reconciliation report', () => {
    it('names an asset that exists in Cloudinary with no ledger row', async () => {
      /*
       * A real orphan, made the way real orphans are made: the object is stored
       * and the ledger row is then removed, which is the state a crash between
       * the two leaves behind.
       *
       * The report must NAME it and must not delete it — MEDIA-MODEL.md §9 is
       * explicit that reconciliation reports and never auto-deletes, because a
       * report that is wrong in the direction of "delete these" costs somebody
       * their photographs.
       */
      const response = await upload(await image('jpeg')).expect(201);
      const publicId = response.body.data.publicId as string;

      await assets.deleteOne({ publicId }).exec();

      /*
       * No `?prefix=`. The endpoint scans the CONFIGURED `folderRoot`, which
       * this suite has already redirected to `dev-test/<runId>` — and
       * `forbidNonWhitelisted` would reject an invented query parameter with a
       * 400 anyway.
       */
      const report = await http()
        .get('/api/v1/admin/media/reconciliation')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(report.body.data.inStoreOnly).toContain(publicId);

      // Reported, not removed.
      expect(await storage.list(TEST_ROOT)).toContain(publicId);
    });
  });
});
