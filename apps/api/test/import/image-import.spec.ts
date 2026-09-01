import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AppModule } from '../../src/app.module';
import { mediaConfig, type MediaConfig } from '../../src/config/media.config';
import { ImageImporter } from '../../src/database/import/image-importer';
import { ImportRunner } from '../../src/database/import/import-runner';
import { validateProfile, type MappingProfile } from '../../src/database/import/mapping-profile';
import { MediaService } from '../../src/modules/media/application/media.service';
import { MediaStoragePort } from '../../src/modules/media/application/ports/media-storage.port';
import {
  MediaAsset,
  type MediaAssetLean,
} from '../../src/modules/media/infrastructure/schemas/media-asset.schema';
import { Brand } from '../../src/modules/catalog/infrastructure/schemas/brand.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product, type ProductLean } from '../../src/modules/catalog/infrastructure/schemas/product.schema';
import { InMemoryMediaStorage } from '../../src/providers/media/memory/in-memory-media-storage';

/**
 * `catalogue:import --images`.
 *
 * ## Against the in-memory store, deliberately
 *
 * Everything this file asserts is provider-independent: which files are
 * uploaded, which are refused, what lands on the product, what the ledger
 * records, and whether a second run changes anything. Running it against the
 * real account would make the default suite slow, networked and billable
 * without proving anything more — `cloudinary-integration.spec.ts` covers the
 * half only a vendor can answer, and repeats the two-run idempotency case there
 * for real.
 *
 * ## The cases that matter most
 *
 * A supplier's folder is untrusted input that nobody looked at. So the weight
 * here is on what happens when it is wrong: a renamed file, a missing file, an
 * unsupported type — and on the property that makes the tool safe to re-run.
 */

/**
 * UPPERCASE, because the product schema uppercases `sku`.
 *
 * A lowercase prefix here would store as `IMGIMP-AB12…` and every cleanup regex
 * would match nothing, leaving this suite's products in the development
 * database — which is how a later run trips `product_slug_unique` on a slug it
 * thinks it has never used.
 */
const RUN_ID = randomUUID().slice(0, 8).toUpperCase();
const SKU_PREFIX = `IMGIMP-${RUN_ID}`;

let app: TestingModule;
let products: Model<Product>;
let assets: Model<MediaAsset>;
let media: MediaService;
let storage: InMemoryMediaStorage;
let config: MediaConfig;
let folder: string;

/** A real image, written to the fixture folder. */
async function writeImage(
  name: string,
  format: 'jpeg' | 'png' | 'webp',
  width = 1200,
  height = 800,
): Promise<void> {
  const bytes = await sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 90, b: 160 } },
  })
    .toFormat(format)
    .toBuffer();

  writeFileSync(join(folder, name), bytes);
}

function profile(): MappingProfile {
  return validateProfile({
    name: 'image-import',
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

/** A runner WITH the image importer, rooted at the fixture folder. */
function runnerWithImages(): ImportRunner {
  return new ImportRunner(
    {
      products,
      categories: app.get<Model<Category>>(getModelToken(Category.name)),
      brands: app.get<Model<Brand>>(getModelToken(Brand.name)),
    },
    new ImageImporter(media, config, join(folder, 'catalogue.csv')),
  );
}

/** A runner WITHOUT it — the default path. */
function runnerWithoutImages(): ImportRunner {
  return new ImportRunner({
    products,
    categories: app.get<Model<Category>>(getModelToken(Category.name)),
    brands: app.get<Model<Brand>>(getModelToken(Brand.name)),
  });
}

function csv(rows: string): string {
  return `SKU,Name,Category,Price,Stock,Images\n${rows}`;
}

async function run(
  content: string,
  options: { images?: boolean; dryRun?: boolean } = {},
): Promise<Awaited<ReturnType<ImportRunner['run']>>> {
  const runner = options.images === false ? runnerWithoutImages() : runnerWithImages();

  return runner.run({
    content,
    format: 'csv',
    profile: profile(),
    file: join(folder, 'catalogue.csv'),
    dryRun: options.dryRun ?? false,
  });
}

async function productBySku(sku: string): Promise<ProductLean> {
  return (await products.findOne({ sku }).lean<ProductLean>().exec()) as ProductLean;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef;
  await app.init();

  products = app.get<Model<Product>>(getModelToken(Product.name));
  assets = app.get<Model<MediaAsset>>(getModelToken(MediaAsset.name));
  media = app.get(MediaService);
  config = app.get<MediaConfig>(mediaConfig.KEY);

  const port = app.get(MediaStoragePort);
  // The same F-07-shaped guarantee as the other media suites: if this ever
  // resolved to the Cloudinary adapter, the default test run would start
  // uploading to the owner's account.
  expect(port).toBeInstanceOf(InMemoryMediaStorage);
  storage = port as InMemoryMediaStorage;

  folder = mkdtempSync(join(tmpdir(), 'nest-image-import-'));

  await writeImage('one.jpg', 'jpeg', 1400, 1000);
  await writeImage('two.png', 'png', 1000, 1000);
  await writeImage('three.webp', 'webp', 900, 700);

  // A PNG named `.jpg` — the shape of a supplier shipping renamed files.
  const png = await sharp({
    create: { width: 800, height: 800, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  writeFileSync(join(folder, 'lying.jpg'), png);

  writeFileSync(join(folder, 'notes.txt'), 'this is not an image');
}, 120_000);

beforeEach(async () => {
  // By SKU prefix, never `deleteMany({})` — this suite shares a database with
  // the development seed.
  await products.deleteMany({ sku: new RegExp(`^${SKU_PREFIX}`) }).exec();
  await assets.deleteMany({ publicId: new RegExp(`^${config.folderRoot}/`) }).exec();
  storage.clear();
});

afterAll(async () => {
  await products.deleteMany({ sku: new RegExp(`^${SKU_PREFIX}`) }).exec();
  await assets.deleteMany({ publicId: new RegExp(`^${config.folderRoot}/`) }).exec();
  rmSync(folder, { recursive: true, force: true });
  await app.close();
});

describe('what it uploads', () => {
  it('attaches every image in the row, in order, with exactly one primary', async () => {
    await run(csv(`${SKU_PREFIX}-A,Widget A ${RUN_ID},tools,199.00,10,one.jpg;two.png\n`));

    const product = await productBySku(`${SKU_PREFIX}-A`);

    expect(product.images).toHaveLength(2);
    expect(product.images.map((image) => image.format)).toEqual(['jpeg', 'png']);
    expect(product.images.map((image) => image.sortOrder)).toEqual([0, 1]);

    // The invariant, asserted as a count rather than by position: "exactly one"
    // is the rule, and checking `images[0].isPrimary` would also pass with two.
    expect(product.images.filter((image) => image.isPrimary)).toHaveLength(1);
    expect(product.images[0]?.isPrimary).toBe(true);
  });

  it('captures the real dimensions rather than trusting the file name', async () => {
    await run(csv(`${SKU_PREFIX}-B,Widget B ${RUN_ID},tools,199.00,10,one.jpg\n`));

    const [image] = (await productBySku(`${SKU_PREFIX}-B`)).images;

    expect(image?.width).toBe(1400);
    expect(image?.height).toBe(1000);
  });

  it('stores a provider-relative identifier, never a URL', async () => {
    await run(csv(`${SKU_PREFIX}-C,Widget C ${RUN_ID},tools,199.00,10,one.jpg\n`));

    const product = await productBySku(`${SKU_PREFIX}-C`);

    expect(product.images[0]?.publicId).toMatch(new RegExp(`^${config.folderRoot}/products/`));
    expect(JSON.stringify(product.images)).not.toMatch(/https?:\/\//);
  });

  it('RETAINS each asset, so a delete cannot destroy a live image', async () => {
    /*
     * The catalogue import is the first thing in this system that ever attached
     * an image to a product, and therefore the first that ever needed to
     * increment a reference count. Before this, every ledger row sat at zero —
     * harmless while no product had an image, and a live defect the moment one
     * did: `DELETE /admin/media` refuses an asset with references, and refuses
     * nothing at all when the count is wrong.
     */
    await run(csv(`${SKU_PREFIX}-D,Widget D ${RUN_ID},tools,199.00,10,one.jpg;two.png\n`));

    const product = await productBySku(`${SKU_PREFIX}-D`);
    const rows = await assets
      .find({ publicId: { $in: product.images.map((image) => image.publicId) } })
      .lean<MediaAssetLean[]>()
      .exec();

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.refCount === 1)).toBe(true);
  });
});

describe('what it refuses, without losing the rest', () => {
  it('refuses a file whose bytes disagree with its extension', async () => {
    const report = await run(csv(`${SKU_PREFIX}-E,Widget E ${RUN_ID},tools,199.00,10,lying.jpg\n`));

    const [row] = report.rows;
    expect(row?.outcome).toBe('created');
    expect(row?.images?.uploaded).toBe(0);
    expect(row?.images?.failures).toHaveLength(1);

    // The SPECIFIC reason, not the HTTP-safe one. "The uploaded file was
    // rejected" tells the person holding the file nothing they can act on.
    expect(row?.images?.failures[0]).toContain('lying.jpg');
    expect(row?.images?.failures[0]).toMatch(/jpeg|png|declared/i);

    expect((await productBySku(`${SKU_PREFIX}-E`)).images).toHaveLength(0);
  });

  it('refuses a type that is not an image at all', async () => {
    const report = await run(csv(`${SKU_PREFIX}-F,Widget F ${RUN_ID},tools,199.00,10,notes.txt\n`));

    expect(report.rows[0]?.images?.failures[0]).toContain('.txt');
    expect(report.rows[0]?.images?.uploaded).toBe(0);
  });

  it('reports a missing file and still imports the product', async () => {
    const report = await run(csv(`${SKU_PREFIX}-G,Widget G ${RUN_ID},tools,199.00,10,absent.jpg\n`));

    expect(report.rows[0]?.outcome).toBe('created');
    expect(report.rows[0]?.images?.failures).toHaveLength(1);
    expect(await productBySku(`${SKU_PREFIX}-G`)).not.toBeNull();
  });

  it('keeps the files that DID upload when one of them fails', async () => {
    /*
     * The alternative — all or nothing — would leave a product with no
     * photographs because its fourth file was corrupt. The report names the
     * failure, so the operator can fix that file, clear the product's images
     * and run again.
     */
    const report = await run(
      csv(`${SKU_PREFIX}-H,Widget H ${RUN_ID},tools,199.00,10,one.jpg;lying.jpg;three.webp\n`),
    );

    expect(report.rows[0]?.images?.uploaded).toBe(2);
    expect(report.rows[0]?.images?.failures).toHaveLength(1);

    const product = await productBySku(`${SKU_PREFIX}-H`);
    expect(product.images.map((image) => image.format)).toEqual(['jpeg', 'webp']);
    expect(product.images.filter((image) => image.isPrimary)).toHaveLength(1);
  });
});

describe('idempotency', () => {
  it('uploads nothing on a second run, and the product is unchanged', async () => {
    /*
     * THE property, and the reason a product with images is skipped rather than
     * refreshed. `publicId` carries 96 random bits, so re-uploading the same
     * file produces a DIFFERENT asset: the product would accumulate duplicates
     * and the first upload would become an orphan nobody is paying attention
     * to, on every run.
     */
    const file = csv(`${SKU_PREFIX}-I,Widget I ${RUN_ID},tools,199.00,10,one.jpg;two.png\n`);

    const first = await run(file);
    expect(first.rows[0]?.outcome).toBe('created');
    expect(first.rows[0]?.images?.uploaded).toBe(2);

    const before = await productBySku(`${SKU_PREFIX}-I`);

    const second = await run(file);
    expect(second.rows[0]?.outcome).toBe('unchanged');
    expect(second.rows[0]?.images?.uploaded).toBe(0);
    expect(second.rows[0]?.images?.skipped).toBe(2);

    const after = await productBySku(`${SKU_PREFIX}-I`);

    // Byte-identical, not merely "still two". A refresh that re-uploaded and
    // replaced would also leave a length of 2.
    expect(after.images).toEqual(before.images);

    // And nothing was orphaned: the store holds exactly what the product uses.
    expect(await storage.list(config.folderRoot)).toHaveLength(2);
  });

  it('imports images for a product that was imported earlier WITHOUT them', async () => {
    /*
     * The ordinary sequence: the catalogue lands first, the photographs arrive
     * later. The row is `unchanged` as far as the mapped columns go, and the
     * images still have to be imported — which is why the image step does not
     * hang off the row outcome.
     */
    const file = csv(`${SKU_PREFIX}-J,Widget J ${RUN_ID},tools,199.00,10,one.jpg\n`);

    await run(file, { images: false });
    expect((await productBySku(`${SKU_PREFIX}-J`)).images).toHaveLength(0);

    const second = await run(file);

    expect(second.rows[0]?.outcome).toBe('unchanged');
    expect(second.rows[0]?.images?.uploaded).toBe(1);
    expect((await productBySku(`${SKU_PREFIX}-J`)).images).toHaveLength(1);
  });
});

describe('the flags and the profile', () => {
  it('uploads NOTHING on a dry run', async () => {
    /*
     * An upload is a real, billable write to a third party. A flag that says
     * "nothing will be written" and then wrote to Cloudinary would be the worst
     * kind of surprise, so the count is reported and no call is made.
     */
    const report = await run(csv(`${SKU_PREFIX}-K,Widget K ${RUN_ID},tools,199.00,10,one.jpg\n`), {
      dryRun: true,
    });

    expect(report.rows[0]?.images?.uploaded).toBe(0);
    expect(report.rows[0]?.images?.skipped).toBe(1);
    expect(await storage.list(config.folderRoot)).toHaveLength(0);
    expect(await products.countDocuments({ sku: `${SKU_PREFIX}-K` }).exec()).toBe(0);
  });

  it('does nothing at all when the importer is absent', async () => {
    // The default path. Without `--images` the tool behaves exactly as it did
    // before images existed — an `imagePaths` column is simply not acted on —
    // and the report carries no image section to explain.
    const report = await run(csv(`${SKU_PREFIX}-L,Widget L ${RUN_ID},tools,199.00,10,one.jpg\n`), {
      images: false,
    });

    expect(report.rows[0]?.images).toBeUndefined();
    expect((await productBySku(`${SKU_PREFIX}-L`)).images).toHaveLength(0);
    expect(await storage.list(config.folderRoot)).toHaveLength(0);
  });

  it('imports the product with no images when the cell is empty', async () => {
    const report = await run(csv(`${SKU_PREFIX}-M,Widget M ${RUN_ID},tools,199.00,10,\n`));

    expect(report.rows[0]?.outcome).toBe('created');
    expect(report.rows[0]?.images?.uploaded).toBe(0);
    expect(report.rows[0]?.images?.failures).toHaveLength(0);
  });
});

describe('a profile that does not map a brand column', () => {
  it('imports every row instead of skipping them all', async () => {
    /*
     * A regression test for a bug this suite's own fixture found.
     *
     * `brandSlug` is optional, so a feed with no brand column is legitimate.
     * Unmapped, `mapped.brandSlug` was `undefined`, `String(undefined)` is the
     * literal `"undefined"`, and EVERY row skipped with `brand "undefined" does
     * not exist`. Both shipped profiles map a brand column, which is exactly why
     * nothing caught it — the bug needs a profile that legitimately omits one,
     * and this whole file uses one.
     */
    const report = await run(csv(`${SKU_PREFIX}-N,Widget N ${RUN_ID},tools,199.00,10,one.jpg\n`));

    expect(report.rows[0]?.outcome).toBe('created');
    expect(report.rows[0]?.reason).toBeUndefined();
    expect((await productBySku(`${SKU_PREFIX}-N`)).brand).toBeNull();
  });
});
