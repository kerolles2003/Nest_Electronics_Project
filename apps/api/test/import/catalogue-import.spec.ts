import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { CoercionError, coerce, slugify } from '../../src/database/import/coerce';
import { countByOutcome, renderReport } from '../../src/database/import/import-report';
import { ImportRunner } from '../../src/database/import/import-runner';
import { ProfileError, validateProfile } from '../../src/database/import/mapping-profile';
import type { MappingProfile } from '../../src/database/import/mapping-profile';
import { Brand } from '../../src/modules/catalog/infrastructure/schemas/brand.schema';
import { Category } from '../../src/modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../src/modules/catalog/infrastructure/schemas/product.schema';

/**
 * The catalogue import tool.
 *
 * Authority: PLAN.md Phase 4 item 1 — "its tests assert the MAPPING MECHANISM
 * (a profile correctly rewires columns; a missing required column reports
 * rather than throws), not one fixed layout."
 *
 * That instruction shapes this file. The real catalogue does not exist, so
 * testing against an assumed layout would prove only that the tool can read the
 * layout the tool's author imagined. What is tested instead is that **two
 * deliberately different files produce the same catalogue**, differing only in
 * the profile — because that, and not any particular column name, is the
 * property the tool is for.
 */

/**
 * Only the fields these assertions read.
 *
 * Written out rather than `Record<string, any>`: an `any` here would let a
 * typo in a property name pass type-checking and then fail as `undefined ===
 * undefined`, which is the vacuous-assertion class this session already fixed
 * once.
 */
interface StoredProduct {
  sku: string;
  slug: string;
  name: { en: string; ar: string | null };
  shortDescription: { en: string } | null;
  category: { slug: string };
  brand: { slug: string } | null;
  pricing: {
    basePrice: number;
    salePrice: number | null;
    effectivePrice: number;
    costPrice: number | null;
  };
  stock: { onHand: number; lowStockThreshold: number };
  images: unknown[];
  salesCount: number;
  isFeatured: boolean;
  isActive: boolean;
  currency: string;
  weight: number | null;
  deletedAt: Date | null;
  updatedAt: Date;
}

const RUN_ID = randomUUID().slice(0, 6).toUpperCase();

const PROFILE_DIR = resolve(__dirname, '../../src/database/import/profiles');
const loadProfile = (name: string): MappingProfile =>
  validateProfile(JSON.parse(readFileSync(resolve(PROFILE_DIR, `${name}.json`), 'utf8')));

let app: TestingModule;
let products: Model<Product>;
let runner: ImportRunner;

const sku = (suffix: string): string => `IMP-${RUN_ID}-${suffix}`;

/** The same three products, written the way our own spreadsheet writes them. */
const NEST_CSV = [
  'sku,slug,name,short_description,description,category,brand,price,sale_price,cost_price,stock,low_stock_at,featured,weight_grams',
  `${sku('A')},,Import Test Alpha,A short line.,A longer line.,development-boards,espressif,325.00,280.00,210.00,149,10,yes,9`,
  `${sku('B')},,Import Test Beta,Another short line.,,environmental-sensors,,"1,299.00",,,42,,no,`,
  `${sku('C')},import-test-gamma,Import Test Gamma,Third.,,tools,,89.50,,,0,3,false,120`,
].join('\n');

/**
 * The SAME three products from a different supplier: semicolons, German
 * headings, comma decimal separators, stock as a plain number, no cost or
 * weight column, and the columns in a different order.
 */
const SUPPLIER_CSV = [
  'Artikelnummer;Bezeichnung;Warengruppe;Hersteller;Listenpreis;Aktionspreis;Lagerbestand;Kurztext;Empfehlung',
  `${sku('A')};Import Test Alpha;development-boards;espressif;325,00;280,00;149;A short line.;Ja`,
  `${sku('B')};Import Test Beta;environmental-sensors;;1.299,00;;42;Another short line.;Nein`,
  `${sku('C')};Import Test Gamma;tools;;89,50;;0;Third.;Nein`,
].join('\n');

beforeAll(async () => {
  // A CONTEXT, not an HTTP application: the import tool is a CLI, and giving it
  // a listening server in a test would be testing something it never has.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef;
  await app.init();

  products = app.get<Model<Product>>(getModelToken(Product.name));

  runner = new ImportRunner({
    products,
    categories: app.get<Model<Category>>(getModelToken(Category.name)),
    brands: app.get<Model<Brand>>(getModelToken(Brand.name)),
  });
}, 120_000);

beforeEach(async () => {
  // By SKU prefix, never `deleteMany({})`. This suite shares a database with
  // the 34-product development seed, and a tool that can empty a catalogue is a
  // production incident waiting for somebody to run it in the wrong place.
  await products.deleteMany({ sku: new RegExp(`^IMP-${RUN_ID}-`) }).exec();
});

afterAll(async () => {
  await products.deleteMany({ sku: new RegExp(`^IMP-${RUN_ID}-`) }).exec();
  await app.close();
});

const run = (content: string, profile: MappingProfile, dryRun = false) =>
  runner.run({ content, format: 'csv', profile, file: 'test.csv', dryRun });

// ---------------------------------------------------------------------------

describe('profile validation, before a single row is read', () => {
  it('accepts both shipped profiles', () => {
    expect(loadProfile('nest-standard').name).toBe('nest-standard');
    expect(loadProfile('supplier-example').name).toBe('supplier-example');
  });

  it('refuses a profile that maps a field which does not exist', () => {
    const profile = { name: 'x', fields: { colour: { column: 'Colour', type: 'string' } } };

    expect(() => validateProfile(profile)).toThrow(ProfileError);
    expect(() => validateProfile(profile)).toThrow('`colour` is not an importable field');
  });

  it('refuses a profile missing a field no product can do without', () => {
    // Reported here rather than as 4,000 identical row errors later.
    const profile = { name: 'x', fields: { sku: { column: 'SKU', type: 'string' } } };

    expect(() => validateProfile(profile)).toThrow(
      'does not map: name, categorySlug, basePrice, onHand',
    );
  });

  it('refuses two fields reading one column', () => {
    // Almost always a copy-paste mistake in a hand-edited profile, and it
    // produces a plausible import in which two things are silently equal.
    const profile = {
      name: 'x',
      fields: {
        sku: { column: 'Code', type: 'string' },
        name: { column: 'Code', type: 'string' },
        categorySlug: { column: 'Cat', type: 'string' },
        basePrice: { column: 'P', type: 'minorUnits' },
        onHand: { column: 'S', type: 'integer' },
      },
    };

    expect(() => validateProfile(profile)).toThrow('mapped to both');
  });

  it('refuses an unknown type rather than defaulting to string', () => {
    const profile = {
      name: 'x',
      fields: {
        sku: { column: 'Code', type: 'currency' },
        name: { column: 'N', type: 'string' },
        categorySlug: { column: 'C', type: 'string' },
        basePrice: { column: 'P', type: 'minorUnits' },
        onHand: { column: 'S', type: 'integer' },
      },
    };

    expect(() => validateProfile(profile)).toThrow('`fields.sku.type` must be one of');
  });

  it('refuses upsertKey "slug" when no column feeds slug', () => {
    const profile = {
      name: 'x',
      upsertKey: 'slug',
      fields: {
        sku: { column: 'Code', type: 'string' },
        name: { column: 'N', type: 'string' },
        categorySlug: { column: 'C', type: 'string' },
        basePrice: { column: 'P', type: 'minorUnits' },
        onHand: { column: 'S', type: 'integer' },
      },
    };

    expect(() => validateProfile(profile)).toThrow('no column is mapped to `slug`');
  });
});

describe('coercion — the ways a spreadsheet lies about a number', () => {
  const price = { column: 'Price', type: 'minorUnits' } as const;

  it.each([
    ['325.00', 32500],
    ['1,299.00', 129900],
    ['1.299,00', 129900],
    ['1 299,00', 129900],
    // ONE decimal digit is still a decimal. Reading this dot as a thousands
    // separator would make it 89,500 EGP — a thousandfold overcharge from a
    // cell that looks entirely ordinary. The rule originally required two.
    ['89.5', 8950],
    ['89,5', 8950],
    ['1299', 129900],
    // THREE digits after the last separator is a grouping mark. Genuinely
    // ambiguous in isolation; this is the convention and the safer reading.
    ['1.234', 123400],
    ['EGP 45.00', 4500],
    ['8.29', 829],
  ])('reads %s as %i minor units', (written, expected) => {
    expect(coerce('basePrice', written, price)).toBe(expected);
  });

  it('never reaches a float on the way there', () => {
    // `parseFloat('8.29') * 100` is 828.9999999999999. String concatenation is
    // the only way this is exactly right, and 8.29 is the value that proves it.
    expect(coerce('basePrice', '8.29', price)).toBe(829);
    expect(Number.isInteger(coerce('basePrice', '8.29', price))).toBe(true);
  });

  it.each([['call for quote'], ['—'], ['n/a'], ['']])(
    'refuses "%s" as a required price rather than importing a zero',
    (written) => {
      expect(() => coerce('basePrice', written, { ...price, required: true })).toThrow(
        CoercionError,
      );
    },
  );

  it.each([
    ['yes', true],
    ['Y', true],
    ['TRUE', true],
    ['1', true],
    ['no', false],
    ['-', false],
    ['0', false],
  ])('reads the boolean "%s" as %s', (written, expected) => {
    expect(coerce('isFeatured', written, { column: 'Featured', type: 'boolean' })).toBe(expected);
  });

  it('refuses an unrecognised boolean instead of assuming false', () => {
    // "Featurd" as a typo would silently unfeature a product, and a silent
    // wrong answer is worse than a reported row.
    expect(() => coerce('isFeatured', 'maybe', { column: 'Featured', type: 'boolean' })).toThrow(
      'is not a yes/no value',
    );
  });

  it('refuses a fractional stock count rather than rounding it', () => {
    // 12.7 items is not 13 items; it is a column that means something else.
    expect(() => coerce('onHand', '12.7', { column: 'Stock', type: 'integer' })).toThrow(
      'is not a whole number',
    );
  });

  it('uses the default when an optional cell is blank', () => {
    expect(
      coerce('lowStockThreshold', '', { column: 'Low', type: 'integer', default: 5 }),
    ).toBe(5);
  });

  it('splits a list on semicolons, not commas', () => {
    // A comma-separated list inside a comma-separated file means every author
    // has to remember to quote it.
    expect(
      coerce('imagePaths', ' a.jpg ; b.jpg ;; c.jpg ', { column: 'Images', type: 'stringList' }),
    ).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('derives a usable slug from a name with punctuation and accents', () => {
    expect(slugify('Résistance 10 kΩ — 1/4 W (each)')).toBe('resistance-10-k-1-4-w-each');
  });
});

describe('a first import', () => {
  it('creates every valid row and says so', async () => {
    const report = await run(NEST_CSV, loadProfile('nest-standard'));

    expect(countByOutcome(report)).toEqual({
      created: 3,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errored: 0,
    });
  });

  it('writes the values the profile said, coerced to the schema', async () => {
    await run(NEST_CSV, loadProfile('nest-standard'));

    const alpha = await products.findOne({ sku: sku('A') }).lean<StoredProduct>().exec();

    expect(alpha).toMatchObject({
      slug: 'import-test-alpha',
      isFeatured: true,
      currency: 'EGP',
      isActive: true,
      deletedAt: null,
      weight: 9,
    });
    expect(alpha?.name.en).toBe('Import Test Alpha');
    expect(alpha?.pricing).toMatchObject({
      basePrice: 32500,
      salePrice: 28000,
      effectivePrice: 28000,
      costPrice: 21000,
    });
    expect(alpha?.stock).toMatchObject({ onHand: 149, lowStockThreshold: 10 });
    expect(alpha?.category.slug).toBe('development-boards');
    expect(alpha?.brand?.slug).toBe('espressif');
  });

  it('derives the slug when the column is blank and keeps it when it is not', async () => {
    await run(NEST_CSV, loadProfile('nest-standard'));

    const slugs = await products
      .find({ sku: new RegExp(`^IMP-${RUN_ID}-`) })
      .sort({ sku: 1 })
      .lean<{ slug: string }[]>()
      .exec();

    expect(slugs.map((p) => p.slug)).toEqual([
      'import-test-alpha', // derived
      'import-test-beta', // derived
      'import-test-gamma', // supplied verbatim
    ]);
  });

  it('applies the profile default where the cell is empty', async () => {
    await run(NEST_CSV, loadProfile('nest-standard'));

    const beta = await products.findOne({ sku: sku('B') }).lean<StoredProduct>().exec();

    // `low_stock_at` is blank for row B; the profile's default is 5.
    expect(beta?.stock.lowStockThreshold).toBe(5);
    expect(beta?.pricing.salePrice).toBeNull();
    expect(beta?.brand).toBeNull();
  });

  it('starts a new product with no images and no sales', async () => {
    await run(NEST_CSV, loadProfile('nest-standard'));

    const alpha = await products.findOne({ sku: sku('A') }).lean<StoredProduct>().exec();

    expect({ images: alpha?.images, salesCount: alpha?.salesCount }).toEqual({
      images: [],
      salesCount: 0,
    });
  });
});

describe('idempotency — the property the tool is judged on', () => {
  it('reports every row UNCHANGED on a second run of the same file', async () => {
    await run(NEST_CSV, loadProfile('nest-standard'));
    const second = await run(NEST_CSV, loadProfile('nest-standard'));

    expect(countByOutcome(second)).toEqual({
      created: 0,
      updated: 0,
      unchanged: 3,
      skipped: 0,
      errored: 0,
    });
  });

  it('does not touch the documents on a second run', async () => {
    // The stronger claim, and the one an operator actually cares about:
    // "unchanged" must mean no write happened, not that the write produced the
    // same values. `updatedAt` moving would prove otherwise.
    await run(NEST_CSV, loadProfile('nest-standard'));

    const before = await products
      .find({ sku: new RegExp(`^IMP-${RUN_ID}-`) })
      .sort({ sku: 1 })
      .lean<{ updatedAt: Date; __v: number }[]>()
      .exec();

    await run(NEST_CSV, loadProfile('nest-standard'));

    const after = await products
      .find({ sku: new RegExp(`^IMP-${RUN_ID}-`) })
      .sort({ sku: 1 })
      .lean<{ updatedAt: Date; __v: number }[]>()
      .exec();

    expect(after.map((p) => p.updatedAt.toISOString())).toEqual(
      before.map((p) => p.updatedAt.toISOString()),
    );
  });

  it('creates no duplicate rows however many times it runs', async () => {
    await run(NEST_CSV, loadProfile('nest-standard'));
    await run(NEST_CSV, loadProfile('nest-standard'));
    await run(NEST_CSV, loadProfile('nest-standard'));

    expect(await products.countDocuments({ sku: new RegExp(`^IMP-${RUN_ID}-`) }).exec()).toBe(3);
  });

  it('reports UPDATED — and only for the row that actually changed', async () => {
    await run(NEST_CSV, loadProfile('nest-standard'));

    const repriced = NEST_CSV.replace('325.00,280.00', '349.00,280.00');
    const report = await run(repriced, loadProfile('nest-standard'));

    expect(countByOutcome(report)).toEqual({
      created: 0,
      updated: 1,
      unchanged: 2,
      skipped: 0,
      errored: 0,
    });

    const alpha = await products.findOne({ sku: sku('A') }).lean<StoredProduct>().exec();
    expect(alpha?.pricing.basePrice).toBe(34900);
  });

  it('leaves images alone when it updates a product', async () => {
    // The spreadsheet has no opinion about images, and "no opinion" is not the
    // same as "none". An import that wiped them would destroy an operator's
    // work every time a price changed.
    await run(NEST_CSV, loadProfile('nest-standard'));

    await products
      .updateOne(
        { sku: sku('A') },
        {
          $set: {
            images: [
              {
                publicId: 'nest/products/x/y',
                version: 1,
                format: 'webp',
                width: 800,
                height: 800,
                bytes: 100,
                alt: null,
                sortOrder: 0,
                isPrimary: true,
              },
            ],
          },
        },
      )
      .exec();

    await run(NEST_CSV.replace('325.00,280.00', '359.00,280.00'), loadProfile('nest-standard'));

    const alpha = await products.findOne({ sku: sku('A') }).lean<StoredProduct>().exec();
    expect(alpha?.images).toHaveLength(1);
    expect(alpha?.pricing.basePrice).toBe(35900);
  });
});

describe('a second, deliberately different layout, using only a new profile', () => {
  it('produces the SAME products from a semicolon file with German headings', async () => {
    // The acceptance criterion, stated in PLAN.md as "round-trips a second,
    // deliberately different column layout using only a new mapping profile".
    // No code differs between this run and the one above — only the JSON.
    const first = await run(NEST_CSV, loadProfile('nest-standard'));
    expect(countByOutcome(first).created).toBe(3);

    const second = await run(SUPPLIER_CSV, loadProfile('supplier-example'));

    // Every row already exists and matches, EXCEPT for the fields the supplier
    // file does not carry — which is the honest outcome and worth asserting
    // rather than glossing.
    // Rows and reasons in the assertion, so a failure explains itself.
    expect(second.rows.map((row) => [row.outcome, row.reason ?? ''])).toEqual([
      [expect.stringMatching(/^(updated|unchanged)$/) as unknown as string, ''],
      [expect.stringMatching(/^(updated|unchanged)$/) as unknown as string, ''],
      [expect.stringMatching(/^(updated|unchanged)$/) as unknown as string, ''],
    ]);
  });

  it('reads a comma decimal separator and a dot thousands separator correctly', async () => {
    await run(SUPPLIER_CSV, loadProfile('supplier-example'));

    const rows = await products
      .find({ sku: new RegExp(`^IMP-${RUN_ID}-`) })
      .sort({ sku: 1 })
      .lean<StoredProduct[]>()
      .exec();

    // 325,00 / 1.299,00 / 89,50 — the same three prices as the English file.
    expect(rows.map((p) => p.pricing.basePrice)).toEqual([32500, 129900, 8950]);
  });

  it('leaves fields the supplier file does not carry ALONE, rather than nulling them', async () => {
    /*
     * A profile is a statement about which columns a file HAS. A field it does
     * not mention is one that feed has no opinion about — not one it says is
     * empty.
     *
     * This started as the opposite assertion, on the assumption that an
     * unmapped column meant "no value". Writing it that way made importing a
     * price list null every product's weight, and made importing from a second
     * supplier undo the first. The supplier-example profile carries no cost or
     * weight column, so this is the case that proves it.
     */
    await run(NEST_CSV, loadProfile('nest-standard'));
    await run(SUPPLIER_CSV, loadProfile('supplier-example'));

    const alpha = await products.findOne({ sku: sku('A') }).lean<StoredProduct>().exec();

    expect({ costPrice: alpha?.pricing.costPrice, weight: alpha?.weight }).toEqual({
      costPrice: 21000,
      weight: 9,
    });
  });

  it('creates with nulls for the fields it does not carry, when nothing exists yet', async () => {
    // The other half: on a CREATE there is nothing to preserve, so an unmapped
    // optional field is genuinely absent — and absent must be `null`, not NaN.
    await run(SUPPLIER_CSV, loadProfile('supplier-example'));

    const alpha = await products.findOne({ sku: sku('A') }).lean<StoredProduct>().exec();

    expect({ costPrice: alpha?.pricing.costPrice, weight: alpha?.weight }).toEqual({
      costPrice: null,
      weight: null,
    });
  });
});

describe('rows that cannot become products', () => {
  it('SKIPS a row naming a category that does not exist, and says why', async () => {
    const csv = NEST_CSV.replace('development-boards', 'sensors-modules');
    const report = await run(csv, loadProfile('nest-standard'));

    const skipped = report.rows.find((row) => row.outcome === 'skipped');

    expect(skipped?.line).toBe(2);
    expect(skipped?.reason).toContain('category "sensors-modules" does not exist');
    expect(skipped?.reason).toContain('will not invent a category');
  });

  it('SKIPS a row naming an unknown brand rather than dropping the brand', async () => {
    const csv = NEST_CSV.replace(',espressif,', ',adafruit,');
    const report = await run(csv, loadProfile('nest-standard'));

    expect(report.rows[0]).toMatchObject({ outcome: 'skipped', line: 2 });
    expect(report.rows[0]?.reason).toContain('brand "adafruit" does not exist');
  });

  it('ERRORS a row whose price is not a price, and imports the others', async () => {
    const csv = NEST_CSV.replace('325.00,280.00', 'call for quote,');
    const report = await run(csv, loadProfile('nest-standard'));

    expect(countByOutcome(report)).toMatchObject({ created: 2, errored: 1 });
    expect(report.rows[0]?.reason).toContain('is not a price');

    // The valid rows still landed. A file with one bad row is not a file that
    // cannot be imported.
    expect(await products.countDocuments({ sku: new RegExp(`^IMP-${RUN_ID}-`) }).exec()).toBe(2);
  });

  it('ERRORS a duplicate key WITHIN one file instead of letting one overwrite the other', async () => {
    const duplicated = `${NEST_CSV}\n${sku('A')},,Import Test Alpha Again,x,,tools,,10.00,,,5,,no,`;
    const report = await run(duplicated, loadProfile('nest-standard'));

    const error = report.rows.find((row) => row.outcome === 'errored');
    expect(error?.reason).toContain('already appears on row 2');

    // And the FIRST row's values survived — the later row did not win silently.
    const alpha = await products.findOne({ sku: sku('A') }).lean<StoredProduct>().exec();
    expect(alpha?.name.en).toBe('Import Test Alpha');
  });

  it('ERRORS a sale price that is not below the base price', async () => {
    const csv = NEST_CSV.replace('325.00,280.00', '325.00,400.00');
    const report = await run(csv, loadProfile('nest-standard'));

    expect(report.rows[0]?.reason).toContain('must be greater than 0 and less than the base price');
  });

  it('ERRORS a row with a required cell left blank', async () => {
    const csv = NEST_CSV.replace(`${sku('B')},,Import Test Beta`, `${sku('B')},,`);
    const report = await run(csv, loadProfile('nest-standard'));

    const error = report.rows.find((row) => row.outcome === 'errored');
    expect(error?.reason).toContain('name is required');
  });
});

describe('--dry-run', () => {
  it('reports exactly what a real run would do, and writes nothing', async () => {
    const dry = await run(NEST_CSV, loadProfile('nest-standard'), true);

    expect(countByOutcome(dry)).toMatchObject({ created: 3, errored: 0 });
    expect(await products.countDocuments({ sku: new RegExp(`^IMP-${RUN_ID}-`) }).exec()).toBe(0);

    // And a real run afterwards agrees with what the dry run promised.
    const wet = await run(NEST_CSV, loadProfile('nest-standard'));
    expect(countByOutcome(wet)).toEqual(countByOutcome(dry));
  });
});

describe('the report, as an operator reads it', () => {
  it('leads with the problems and gives spreadsheet row numbers', async () => {
    const csv = NEST_CSV.replace('development-boards', 'sensors-modules');
    const rendered = renderReport(await run(csv, loadProfile('nest-standard')));

    expect(rendered).toContain('1 row(s) need attention');
    expect(rendered).toContain('row     2  SKIPPED');
    expect(rendered).toContain('counting the header as row 1');
    // The instruction that makes a partly-failed import safe to retry.
    expect(rendered).toContain('will not be written a second time');
  });

  it('says plainly when a dry run wrote nothing', async () => {
    const rendered = renderReport(await run(NEST_CSV, loadProfile('nest-standard'), true));

    expect(rendered).toContain('DRY RUN, nothing was written');
  });

  it('separates unchanged from updated in the counts a person sees', async () => {
    // Merged, a second run reporting "3 updated" would be indistinguishable
    // from a tool that rewrites every document every time.
    await run(NEST_CSV, loadProfile('nest-standard'));
    const rendered = renderReport(await run(NEST_CSV, loadProfile('nest-standard')));

    expect(rendered).toContain('unchanged       3   (already correct — nothing written)');
    expect(rendered).toContain('updated         0');
  });
});

describe('JSON input', () => {
  it('reads the same products from a JSON array using the same profile', async () => {
    // One code path and one set of coercion rules for both formats: a JSON file
    // that already carries real numbers is normalised to the shape a CSV
    // produces, so the error messages an operator sees do not depend on which
    // format their supplier chose.
    const json = JSON.stringify([
      {
        sku: sku('A'),
        name: 'Import Test Alpha',
        category: 'development-boards',
        brand: 'espressif',
        price: 325.0,
        stock: 149,
        featured: true,
      },
    ]);

    const report = await runner.run({
      content: json,
      format: 'json',
      profile: loadProfile('nest-standard'),
      file: 'test.json',
      dryRun: false,
    });

    // Asserted with the row attached, so a failure says WHY rather than only
    // that a count was wrong.
    // The REASON is in the assertion, so a failure says why rather than only
    // that a count was wrong.
    expect(report.rows.map((row) => [row.outcome, row.reason])).toEqual([['created', undefined]]);

    const alpha = await products.findOne({ sku: sku('A') }).lean<StoredProduct>().exec();
    expect(alpha?.pricing.basePrice).toBe(32500);
    expect(alpha?.isFeatured).toBe(true);
  });
});

describe('what it will NOT do', () => {
  it('never deletes a product missing from the file', async () => {
    /*
     * An import that could delete would mean a truncated export silently
     * emptying a shop — and a supplier sending 40 rows instead of 4,000 because
     * their own export failed is not a hypothetical.
     */
    await run(NEST_CSV, loadProfile('nest-standard'));

    const partial = NEST_CSV.split('\n').slice(0, 2).join('\n');
    await run(partial, loadProfile('nest-standard'));

    expect(await products.countDocuments({ sku: new RegExp(`^IMP-${RUN_ID}-`) }).exec()).toBe(3);
  });

  it('never touches the development seed', async () => {
    const before = await products.countDocuments({ sku: { $not: /^IMP-/ } }).exec();

    await run(NEST_CSV, loadProfile('nest-standard'));

    expect(await products.countDocuments({ sku: { $not: /^IMP-/ } }).exec()).toBe(before);
  });
});
