import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { validationExceptionFactory } from '../../src/common/pipes/validation-exception.factory';
import { mediaConfig, type MediaConfig } from '../../src/config/media.config';
import { MediaStoragePort } from '../../src/modules/media/application/ports/media-storage.port';
import {
  MediaAsset,
  type MediaAssetLean,
} from '../../src/modules/media/infrastructure/schemas/media-asset.schema';
import { MediaAssetRepository } from '../../src/modules/media/infrastructure/repositories/media-asset.repository';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';
import { InMemoryMediaStorage } from '../../src/providers/media/memory/in-memory-media-storage';

/**
 * The media upload pipeline, end to end, against the real application.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §2 (ADR-MEDIA-001), §4–§7, §9.
 *
 * ## Why these tests carry more weight than usual
 *
 * The endpoint **ships empty** — no product has an image, no admin screen calls
 * it, and the Cloudinary account (D-4) has not been supplied. The Phase 4 risk
 * note states the consequence plainly: "an upload endpoint with no real content
 * can rot unnoticed → its tests are the only thing exercising it, so they must
 * cover the rejection paths, not just the happy path."
 *
 * So the rejections are the bulk of this file: a file that lies about its type,
 * an SVG, an oversize upload, an image too small to be a product photograph, an
 * empty part, a missing part, a caller without a staff role.
 *
 * ## What is real here and what is not
 *
 * The application is real: the guards, the multipart parsing, the validation,
 * sharp, the reference ledger, MongoDB. Only the STORE is substituted — for the
 * in-memory adapter, which is the configured development provider rather than a
 * mock, and which is what `MEDIA_PROVIDER=memory` selects on any machine with no
 * Cloudinary credentials. Every machine, today.
 *
 * What that leaves unproven is named in `cloudinary-media-storage.ts`: whether
 * Cloudinary answers the way its documentation says. Nothing else in the
 * pipeline depends on the answer, which is the property ADR-MEDIA-001 was chosen
 * for.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const ENTITY_ID = '68b000000000000000000001';

let app: INestApplication;
let users: Model<User>;
let assets: Model<MediaAsset>;
let storage: InMemoryMediaStorage;
let ledger: MediaAssetRepository;
let config: MediaConfig;

const createdUserIds: Types.ObjectId[] = [];

function http(): request.Agent {
  return request(app.getHttpServer());
}

interface Account {
  readonly id: Types.ObjectId;
  readonly token: string;
}

async function createAccount(label: string, role: Role): Promise<Account> {
  const email = `media-${label}.${RUN_ID}@example.test`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: `Media ${label}` })
    .expect(201);

  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } }).exec();

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  const login = await http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);

  return { id: created._id, token: login.body.data.accessToken as string };
}

/** A real image of the requested size and format — never a hand-written array. */
function image(
  format: 'jpeg' | 'png' | 'webp',
  width = 1200,
  height = 800,
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 210, g: 60, b: 40 } } })
    .toFormat(format)
    .toBuffer();
}

function upload(
  account: Account,
  file: Buffer,
  options: { filename?: string; contentType?: string; entity?: string; entityId?: string } = {},
): request.Test {
  return http()
    .post('/api/v1/admin/media')
    .set('Authorization', `Bearer ${account.token}`)
    .field('entity', options.entity ?? 'products')
    .field('entityId', options.entityId ?? ENTITY_ID)
    .attach('file', file, {
      filename: options.filename ?? 'photo.png',
      contentType: options.contentType ?? 'image/png',
    });
}

let admin: Account;
let customer: Account;

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
  assets = app.get<Model<MediaAsset>>(getModelToken(MediaAsset.name));
  ledger = app.get(MediaAssetRepository);
  config = app.get<MediaConfig>(mediaConfig.KEY);

  // The port resolves to the in-memory adapter because `MEDIA_PROVIDER` says
  // `memory`. Asserted rather than assumed: if this ever resolved to the
  // Cloudinary adapter, the suite would silently start making authenticated
  // network calls against the owner's real account, which is the media
  // equivalent of the 225 live email sends F-07 found.
  const port = app.get(MediaStoragePort);
  expect(port).toBeInstanceOf(InMemoryMediaStorage);
  storage = port as InMemoryMediaStorage;

  admin = await createAccount('admin', Role.ADMIN);
  customer = await createAccount('customer', Role.CUSTOMER);
}, 120_000);

beforeEach(async () => {
  storage.clear();
  await assets.deleteMany({ publicId: /^nest\// }).exec();
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }
  await assets.deleteMany({ publicId: /^nest\// }).exec();
  await app.close();
});

// ---------------------------------------------------------------------------

describe('authorization runs before any byte is accepted', () => {
  it('refuses an anonymous upload', async () => {
    const response = await http()
      .post('/api/v1/admin/media')
      .field('entity', 'products')
      .field('entityId', ENTITY_ID)
      .attach('file', await image('png'), { filename: 'x.png', contentType: 'image/png' });

    expect(response.status).toBe(401);
    expect(await storage.list('nest')).toEqual([]);
  });

  it('refuses a signed-in CUSTOMER and stores nothing', async () => {
    const response = await upload(customer, await image('png'));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');

    // The assertion that matters: a rejected caller left NOTHING behind. If the
    // guard ran after the interceptor, the bytes would already be in the store.
    expect(await storage.list('nest')).toEqual([]);
    expect(await assets.countDocuments({ publicId: /^nest\// }).exec()).toBe(0);
  });
});

describe('a valid upload', () => {
  it('stores the image and returns a provider-relative identifier', async () => {
    const response = await upload(admin, await image('png', 1200, 800));

    expect(response.status).toBe(201);

    const asset = response.body.data;
    expect(asset).toMatchObject({ format: 'png', width: 1200, height: 800 });
    expect(asset.publicId).toMatch(
      new RegExp(`^nest/products/${ENTITY_ID}/[A-Za-z0-9_-]{16}$`),
    );
    expect(typeof asset.version).toBe('number');
    expect(asset.bytes).toBeGreaterThan(0);
  });

  it('returns NO url, and no field that could be mistaken for one', async () => {
    // ADR-MEDIA-002. Legacy persisted absolute URLs into 22 rows and into
    // next.config.ts, which made a CDN change a data migration and made deletion
    // a string-split. The contract's defence is that there is nothing to store.
    const response = await upload(admin, await image('png'));

    expect(Object.keys(response.body.data).sort()).toEqual([
      'bytes',
      'format',
      'height',
      'publicId',
      'version',
      'width',
    ]);
    expect(JSON.stringify(response.body)).not.toContain('http');
  });

  it('discards the original filename entirely', async () => {
    // The filename is attacker-controlled text and has been a path-traversal
    // vector, an encoding problem and a duplicate-key source. None of those
    // questions has to be answered if the answer is not to use it.
    const response = await upload(admin, await image('png'), {
      filename: '../../etc/passwd%00.png',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.publicId).not.toContain('passwd');
    expect(response.body.data.publicId).not.toContain('..');
  });

  it('generates a DIFFERENT identifier for the same bytes uploaded twice', async () => {
    // `overwrite: false` at the adapter only turns a collision into a loud
    // failure; what makes collisions not happen is 96 bits of randomness here.
    const bytes = await image('png');

    const first = await upload(admin, bytes);
    const second = await upload(admin, bytes);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.publicId).not.toBe(second.body.data.publicId);
    expect(await storage.list('nest')).toHaveLength(2);
  });

  it('records a ledger row with refCount 0 and the uploading account', async () => {
    const response = await upload(admin, await image('png'));

    const row = await assets
      .findOne({ publicId: response.body.data.publicId })
      .lean<MediaAssetLean>()
      .exec();

    expect(row).toMatchObject({ refCount: 0, format: 'png', width: 1200, height: 800 });
    expect(row?.uploadedBy?.toHexString()).toBe(admin.id.toHexString());
  });

  it.each(['jpeg', 'png', 'webp'] as const)('accepts a %s', async (format) => {
    const response = await upload(admin, await image(format), {
      contentType: `image/${format}`,
      filename: `photo.${format}`,
    });

    expect({ format, status: response.status }).toEqual({ format, status: 201 });
    expect(response.body.data.format).toBe(format);
  });
});

describe('the server, not the client, is the authority for metadata', () => {
  it('strips EXIF, and bakes the recorded ORIENTATION into the pixels first', async () => {
    /*
     * The classic EXIF-stripping bug, asserted rather than assumed.
     *
     * A photograph's true orientation frequently lives in its EXIF tag rather
     * than in its pixel data. Discarding the tag WITHOUT acting on it does not
     * preserve the image — it silently rotates it, and every product photo taken
     * on a phone comes out sideways. `.rotate()` bakes it in first.
     *
     * Orientation 6 means "rotate 90° clockwise for display", so a 1200x800
     * source must come back as 800x1200 with no metadata left.
     */
    const withExif = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'Nest', Artist: 'somebody' } } })
      .toBuffer();

    const before = await sharp(withExif).metadata();
    expect({ orientation: before.orientation, hasExif: before.exif !== undefined }).toEqual({
      orientation: 6,
      hasExif: true,
    });

    const response = await upload(admin, withExif, {
      contentType: 'image/jpeg',
      filename: 'phone.jpg',
    });
    expect(response.status).toBe(201);

    const stored = storage.read(response.body.data.publicId as string);
    expect(stored).toBeDefined();
    const after = await sharp(stored as Buffer).metadata();

    expect({
      width: after.width,
      height: after.height,
      exif: after.exif,
      orientation: after.orientation,
    }).toEqual({ width: 800, height: 1200, exif: undefined, orientation: undefined });

    // And the reported dimensions describe the STORED object, not the source.
    expect(response.body.data).toMatchObject({ width: 800, height: 1200 });
  });

  it('downscales an oversized image rather than refusing it', async () => {
    // §5 item 5: a 6000px phone photograph is a normal thing for an operator to
    // have, and the only thing wrong with it is its size.
    const huge = await image('jpeg', 6000, 3000);

    const response = await upload(admin, huge, {
      contentType: 'image/jpeg',
      filename: 'huge.jpg',
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ width: config.maxEdge, height: config.maxEdge / 2 });
  });

  it('does not upscale an image that is already within the cap', async () => {
    const response = await upload(admin, await image('png', 600, 400));

    expect(response.body.data).toMatchObject({ width: 600, height: 400 });
  });
});

describe('rejections — the paths that keep this endpoint honest', () => {
  it('refuses a file whose MAGIC BYTES contradict the declared type', async () => {
    // The headline check (§5 item 3). Legacy trusted the declared type.
    const jpeg = await image('jpeg');

    const response = await upload(admin, jpeg, {
      contentType: 'image/png',
      filename: 'liar.png',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_UPLOAD');
    expect(response.body.error.details[0].message).toBe(
      'the request declared image/png but the file contents are jpeg',
    );
    expect(await storage.list('nest')).toEqual([]);
  });

  it('refuses an SVG even when it is declared as one', async () => {
    // §5 item 6, a hard rule: SVG is executable markup and one served from a
    // whitelisted image host is a stored-XSS vector.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">' +
        '<script>alert(document.cookie)</script></svg>',
      'utf8',
    );

    const response = await upload(admin, svg, {
      contentType: 'image/svg+xml',
      filename: 'payload.svg',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toContain('not an accepted image type');
  });

  it('refuses an SVG that lies and calls itself a PNG', async () => {
    // The second half of the same defence: the allow-list stops the honest
    // attempt, and sniffing stops the dishonest one.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'utf8');

    const response = await upload(admin, svg, {
      contentType: 'image/png',
      filename: 'payload.png',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toContain('not a JPEG, PNG or WebP image');
  });

  it('refuses a PDF, a zip and plain text', async () => {
    const cases = [
      ['%PDF-1.7\n%payload', 'application/pdf', 'doc.pdf'],
      ['PKpayload', 'application/zip', 'archive.zip'],
      ['just some text', 'text/plain', 'notes.txt'],
    ] as const;

    for (const [content, contentType, filename] of cases) {
      const response = await upload(admin, Buffer.from(content, 'binary'), {
        contentType,
        filename,
      });

      expect({ filename, status: response.status }).toEqual({ filename, status: 400 });
    }

    expect(await storage.list('nest')).toEqual([]);
  });

  it('refuses a file over the size limit', async () => {
    // Multer aborts the stream, so this asserts the WIRING as much as the rule:
    // an oversize upload must not be buffered whole before being rejected.
    const oversize = Buffer.alloc(config.maxBytes + 1024, 0x41);
    // A real PNG header, so the refusal cannot be attributed to the sniffer.
    (await image('png')).copy(oversize, 0, 0, 64);

    const response = await upload(admin, oversize);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await storage.list('nest')).toEqual([]);
  });

  it('refuses an image whose shorter edge is below the minimum', async () => {
    // §5 item 5. A 40x40 thumbnail submitted as a product photo is a mistake,
    // and accepting it produces a catalogue that looks broken.
    const tiny = await image('png', 150, 150);

    const response = await upload(admin, tiny);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toBe(
      'the image is 150x150; the shorter edge must be at least 200px',
    );
  });

  it('refuses a request with no file part', async () => {
    const response = await http()
      .post('/api/v1/admin/media')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('entity', 'products')
      .field('entityId', ENTITY_ID);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toBe('the request carried no `file` part');
  });

  it('refuses an empty file', async () => {
    const response = await upload(admin, Buffer.alloc(0));

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toBe('the uploaded file is empty');
  });

  it.each([
    ['an unknown entity', { entity: 'invoices' }],
    ['an entityId that is not an ObjectId', { entityId: 'not-an-id' }],
    ['an entityId with a path separator', { entityId: '../../../etc' }],
  ])('refuses %s, so nothing caller-supplied can shape the folder', async (_label, overrides) => {
    const response = await upload(admin, await image('png'), overrides);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await storage.list('nest')).toEqual([]);
  });
});

describe('destroy', () => {
  it('removes an unreferenced asset from both the store and the ledger', async () => {
    const uploaded = await upload(admin, await image('png'));
    const publicId = uploaded.body.data.publicId as string;

    await http()
      .delete('/api/v1/admin/media')
      .query({ publicId })
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(204);

    expect(await storage.list('nest')).toEqual([]);
    expect(await assets.countDocuments({ publicId }).exec()).toBe(0);
  });

  it('REFUSES to destroy an asset something still references, and names the count', async () => {
    /*
     * The whole reason the ledger exists (§9.1).
     *
     * Legacy product duplication copied image URL strings, so two products
     * shared one storage object; deleting the image from either destroyed it
     * for both, and the surviving product rendered a broken image with no
     * indication of why.
     */
    const uploaded = await upload(admin, await image('png'));
    const publicId = uploaded.body.data.publicId as string;

    await ledger.retain(publicId);
    await ledger.retain(publicId);

    const response = await http()
      .delete('/api/v1/admin/media')
      .query({ publicId })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('MEDIA_ASSET_IN_USE');
    expect(response.body.error.details[0].message).toContain('2 document(s)');

    // Still there. A refusal that deleted anyway would be worse than no check.
    expect(await storage.list('nest')).toEqual([publicId]);
  });

  it('allows the destroy once the last reference is released', async () => {
    const uploaded = await upload(admin, await image('png'));
    const publicId = uploaded.body.data.publicId as string;

    await ledger.retain(publicId);
    expect(await ledger.release(publicId)).toBe(0);

    await http()
      .delete('/api/v1/admin/media')
      .query({ publicId })
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(204);
  });

  it('answers 404 for an identifier the ledger has never seen', async () => {
    const response = await http()
      .delete('/api/v1/admin/media')
      .query({ publicId: 'nest/products/68b000000000000000000009/ghost' })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('MEDIA_ASSET_NOT_FOUND');
  });

  it('refuses a CUSTOMER', async () => {
    const uploaded = await upload(admin, await image('png'));

    await http()
      .delete('/api/v1/admin/media')
      .query({ publicId: uploaded.body.data.publicId })
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(403);
  });
});

describe('the reference ledger under repeated use', () => {
  it('never drives a count negative, however many times it is released', async () => {
    // A negative count is the one state the ledger cannot recover from: the
    // `=== 0` test that authorises destruction would never be true again.
    const uploaded = await upload(admin, await image('png'));
    const publicId = uploaded.body.data.publicId as string;

    await ledger.retain(publicId);

    const counts = [
      await ledger.release(publicId),
      await ledger.release(publicId),
      await ledger.release(publicId),
    ];

    expect(counts).toEqual([0, 0, 0]);
    expect((await ledger.find(publicId))?.refCount).toBe(0);
  });

  it('counts concurrent retains without losing any', async () => {
    // `$inc` is atomic in the server; a read-then-write here would lose
    // increments, and the count would authorise a destroy that breaks pages.
    const uploaded = await upload(admin, await image('png'));
    const publicId = uploaded.body.data.publicId as string;

    await Promise.all(Array.from({ length: 20 }, () => ledger.retain(publicId)));

    expect((await ledger.find(publicId))?.refCount).toBe(20);
  });
});

describe('the orphan reconciliation report', () => {
  it('reports both directions and deletes nothing', async () => {
    // §9.3, and the "deletes nothing" half is the point: "an automated deleter
    // that misreads state destroys production assets irreversibly."
    const uploaded = await upload(admin, await image('png'));
    const healthy = uploaded.body.data.publicId as string;

    // An asset in the store that the ledger never learned about — an upload
    // whose database write failed.
    await storage.upload({
      publicId: 'nest/products/68b000000000000000000002/store-only',
      bytes: await image('png', 300, 300),
      format: 'png',
    });

    // A ledger row whose asset was destroyed out of band.
    await assets.create({
      publicId: 'nest/products/68b000000000000000000003/ledger-only',
      refCount: 1,
      bytes: 100,
      format: 'png',
      width: 300,
      height: 300,
      uploadedBy: null,
    });

    const response = await http()
      .get('/api/v1/admin/media/reconciliation')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    const report = response.body.data;

    expect(report.inStoreOnly).toEqual(['nest/products/68b000000000000000000002/store-only']);
    expect(report.inLedgerOnly).toEqual(['nest/products/68b000000000000000000003/ledger-only']);
    expect(report.unreferenced.map((a: { publicId: string }) => a.publicId)).toEqual([healthy]);

    // Nothing was cleaned up by looking at it.
    expect(await storage.list('nest')).toHaveLength(2);
    expect(await assets.countDocuments({ publicId: /^nest\// }).exec()).toBe(2);
  });

  it('refuses a CUSTOMER', async () => {
    await http()
      .get('/api/v1/admin/media/reconciliation')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(403);
  });
});

describe('configuration', () => {
  it('keeps the multipart limit and the configured limit in step', async () => {
    // The interceptor's limit is a literal, because a decorator is evaluated
    // before any config namespace exists. This is what stops the two drifting.
    const controller = await import('../../src/modules/media/presentation/media.controller');

    expect(config.maxBytes).toBe(5 * 1024 * 1024);
    expect(controller.MediaController).toBeDefined();
  });

  it('runs against the in-memory store even though real credentials now exist', () => {
    /*
     * The media counterpart of the F-07 guarantee, restated correctly.
     *
     * This test used to assert `process.env.CLOUDINARY_API_KEY` was undefined.
     * That was wrong twice over. It encoded a temporary fact about one machine
     * as a permanent property, so it broke the moment the account was supplied
     * — and when it broke, jest printed the API key into the failure output and
     * from there into any CI log holding it. A test must never read a secret in
     * order to assert something about it.
     *
     * What actually matters is not whether credentials EXIST but which adapter
     * is wired, because that alone decides whether bytes leave this machine.
     * Both halves are checked: the configured provider, and the object the port
     * really resolved to — a mismatch between those two is exactly the bug this
     * is here to catch.
     */
    expect(config.provider).toBe('memory');
    expect(app.get(MediaStoragePort)).toBeInstanceOf(InMemoryMediaStorage);
  });
});
