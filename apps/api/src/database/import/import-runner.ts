import { parse } from 'csv-parse/sync';
import { Logger } from '@nestjs/common';
import type { Model, Types } from 'mongoose';
import { Brand } from '../../modules/catalog/infrastructure/schemas/brand.schema';
import { Category } from '../../modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../modules/catalog/infrastructure/schemas/product.schema';
import { CoercionError, coerce, slugify } from './coerce';
import type { ImportReport, RowResult } from './import-report';
import type { ImportableField, MappingProfile } from './mapping-profile';

/**
 * Reads a supplier file through a mapping profile and upserts the catalogue.
 *
 * Authority: PLAN.md Phase 4 item 1.
 *
 * ## The three ways a row can fail to become a product, kept distinct
 *
 *   errored   the row is malformed — a price that is not a price, a required
 *             cell left blank. The supplier's file is wrong.
 *   skipped   the row is well-formed but names something that does not exist
 *             here — an unknown category, an unknown brand. Our catalogue is
 *             incomplete, or the supplier uses different names.
 *   unchanged the row is already imported and identical.
 *
 * Merging the first two would be the easy choice and the wrong one: they have
 * different owners and different fixes. "Row 412's price column contains 'call
 * for quote'" is for the supplier; "row 412 names category `sensors-modules`,
 * which does not exist" is for the operator, who may simply need to create it.
 *
 * ## Why a missing CATEGORY skips rather than creating one
 *
 * Creating categories from a supplier feed would let a typo add a category to
 * the navigation of a live shop. The taxonomy is a merchandising decision, and
 * an import tool has no business making it. Reporting is the honest response,
 * and it is cheap to act on: create the category, run the file again, and the
 * rows that already imported come back as `unchanged`.
 */
export class ImportRunner {
  private readonly logger = new Logger(ImportRunner.name);

  constructor(
    private readonly models: {
      products: Model<Product>;
      categories: Model<Category>;
      brands: Model<Brand>;
    },
  ) {}

  async run(options: {
    readonly content: string;
    readonly format: 'csv' | 'json';
    readonly profile: MappingProfile;
    readonly file: string;
    readonly dryRun: boolean;
  }): Promise<ImportReport> {
    const startedAt = new Date();
    const rows = parseRows(options.content, options.format, options.profile);

    // Resolved ONCE, not per row. A 4,000-row file would otherwise issue 8,000
    // lookups for a taxonomy of a few dozen entries, and the tool would be slow
    // for a reason that has nothing to do with the work it is doing.
    const [categories, brands] = await Promise.all([
      this.categoryIndex(),
      this.brandIndex(),
    ]);

    const results: RowResult[] = [];
    const seenKeys = new Map<string, number>();
    const upsertKey = options.profile.upsertKey ?? 'sku';

    // Which fields this profile has an opinion about. Everything else is left
    // exactly as it is on an update — see `upsert`.
    const mappedFields = new Set(Object.keys(options.profile.fields) as ImportableField[]);

    for (const [index, raw] of rows.entries()) {
      // +2: the header is row 1, so the first data row is row 2 — which is what
      // the operator's spreadsheet shows beside it.
      const line = index + 2;

      let mapped: MappedRow;
      try {
        mapped = mapRow(raw, options.profile);
      } catch (error) {
        results.push({
          line,
          key: raw[options.profile.fields[upsertKey]?.column ?? ''] ?? '',
          outcome: 'errored',
          reason: error instanceof CoercionError ? error.message : String(error),
        });
        continue;
      }

      const key = String(mapped[upsertKey] ?? '');

      // A duplicate key WITHIN one file is reported, not resolved. Whichever
      // row won would be arbitrary, and importing both would mean the second
      // silently overwrote the first — the operator would see "2 created" and
      // one product.
      const firstSeenAt = seenKeys.get(key);
      if (firstSeenAt !== undefined) {
        results.push({
          line,
          key,
          outcome: 'errored',
          reason: `${upsertKey} "${key}" already appears on row ${String(firstSeenAt)} of this file`,
        });
        continue;
      }
      seenKeys.set(key, line);

      const categorySlug = String(mapped.categorySlug ?? '');
      const category = categories.get(categorySlug);

      if (category === undefined) {
        results.push({
          line,
          key,
          outcome: 'skipped',
          reason:
            `category "${categorySlug}" does not exist. Create it first, or correct the ` +
            'spreadsheet — the import will not invent a category.',
        });
        continue;
      }

      const brandSlug = mapped.brandSlug === null ? null : String(mapped.brandSlug);
      const brand = brandSlug === null ? null : (brands.get(brandSlug) ?? undefined);

      if (brand === undefined) {
        results.push({
          line,
          key,
          outcome: 'skipped',
          reason: `brand "${String(brandSlug)}" does not exist. Create it first, or clear the cell.`,
        });
        continue;
      }

      try {
        results.push(
          await this.upsert({
            line,
            key,
            upsertKey,
            mapped,
            mappedFields,
            category,
            brand,
            dryRun: options.dryRun,
          }),
        );
      } catch (error) {
        results.push({
          line,
          key,
          outcome: 'errored',
          // Schema validation lands here: `strict: 'throw'` and the model's own
          // validators are the last check, and the one that cannot be bypassed
          // by a profile that maps a field to the wrong type.
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      profile: options.profile.name,
      file: options.file,
      dryRun: options.dryRun,
      rows: results,
      startedAt,
      finishedAt: new Date(),
    };
  }

  /**
   * Writes one product, and reports whether it actually changed anything.
   *
   * ## Only the fields the profile MAPS are written
   *
   * A profile is a statement about which columns a supplier's file has. A field
   * it does not mention is a field that feed has no opinion about — not a field
   * the feed says is empty. Writing the whole document would mean importing a
   * price list nulled every product's weight, and importing from a second
   * supplier undid the first.
   *
   * This is the same rule that keeps `images` safe, generalised. It is written
   * as dotted `$set` paths rather than a whole-object replacement, because
   * `$set: { pricing: {...} }` replaces the entire nested object and would drop
   * a `costPrice` the profile never mentioned.
   *
   * ## Why the comparison is what makes idempotency observable
   *
   * `findOneAndUpdate` with an upsert would report every row as written whether
   * or not the document differed, and a second run of the same file would look
   * identical to a tool that rewrites everything. Comparing first is what lets
   * the report say `unchanged`.
   */
  private async upsert(input: {
    line: number;
    key: string;
    upsertKey: 'sku' | 'slug';
    mapped: MappedRow;
    mappedFields: ReadonlySet<ImportableField>;
    category: CategoryRef;
    brand: BrandRef | null;
    dryRun: boolean;
  }): Promise<RowResult> {
    const { mapped, mappedFields } = input;
    const has = (field: ImportableField): boolean => mappedFields.has(field);

    const name = String(mapped.name ?? '');
    const slug = has('slug') && mapped.slug !== null ? String(mapped.slug) : slugify(name);

    const filter = input.upsertKey === 'sku' ? { sku: String(mapped.sku) } : { slug };
    const existing = await this.models.products.findOne(filter).lean<Record<string, unknown>>().exec();

    const basePrice = Number(mapped.basePrice);

    // The sale price a row implies: what this file says if it says anything,
    // otherwise whatever the product already carries. Reading the existing
    // value is what stops a price-only feed silently clearing a promotion.
    const salePrice = has('salePrice')
      ? numberOrNull(mapped.salePrice)
      : (dotted(existing, 'pricing.salePrice') as number | null | undefined) ?? null;

    if (salePrice !== null && (salePrice <= 0 || salePrice >= basePrice)) {
      // CATALOG-MODEL.md §5. Checked here rather than left to the schema so the
      // message names the two numbers, which is what makes it fixable.
      return {
        line: input.line,
        key: input.key,
        outcome: 'errored',
        reason:
          `sale price ${String(salePrice)} must be greater than 0 and less than the base ` +
          `price ${String(basePrice)}`,
      };
    }

    const changes: Record<string, unknown> = {
      sku: String(mapped.sku),
      slug,
      'name.en': name,
      category: {
        id: input.category.id,
        slug: input.category.slug,
        name: { en: input.category.name, ar: null },
        path: input.category.path,
      },
      'pricing.basePrice': basePrice,
      // Always rewritten, because it is DERIVED. Leaving it stale after a base
      // price change would make the catalogue quote a price nothing agrees with.
      'pricing.effectivePrice': salePrice ?? basePrice,
      'stock.onHand': Number(mapped.onHand),
    };

    if (has('salePrice')) changes['pricing.salePrice'] = salePrice;
    if (has('costPrice')) changes['pricing.costPrice'] = numberOrNull(mapped.costPrice);
    if (has('lowStockThreshold')) changes['stock.lowStockThreshold'] = Number(mapped.lowStockThreshold);
    if (has('shortDescription')) changes.shortDescription = localised(mapped.shortDescription);
    if (has('description')) changes.description = localised(mapped.description);
    if (has('brandSlug')) {
      changes.brand =
        input.brand === null
          ? null
          : { id: input.brand.id, slug: input.brand.slug, name: { en: input.brand.name, ar: null } };
    }
    if (has('isFeatured')) changes.isFeatured = mapped.isFeatured === true;
    if (has('weight')) changes.weight = numberOrNull(mapped.weight);

    if (existing === null) {
      if (!input.dryRun) {
        // `images` and `salesCount` are set on INSERT only. An import must never
        // wipe images an operator added in admin — the spreadsheet has no
        // opinion about them, and "no opinion" is not the same as "none".
        await this.models.products.create({
          ...expand(changes),
          currency: 'EGP',
          specs: [],
          isActive: true,
          deletedAt: null,
          images: [],
          salesCount: 0,
        });
      }
      return { line: input.line, key: input.key, outcome: 'created' };
    }

    if (!differs(existing, changes)) {
      return { line: input.line, key: input.key, outcome: 'unchanged' };
    }

    if (!input.dryRun) {
      await this.models.products.updateOne(filter, { $set: changes }).exec();
    }

    return { line: input.line, key: input.key, outcome: 'updated' };
  }

  private async categoryIndex(): Promise<Map<string, CategoryRef>> {
    const rows = await this.models.categories
      .find({ deletedAt: null })
      .lean<{ _id: Types.ObjectId; slug: string; name: { en: string }; path: Types.ObjectId[] }[]>()
      .exec();

    return new Map(
      rows.map((row) => [
        row.slug,
        // The INCLUSIVE chain, matching the seed: a subtree filter is then a
        // single indexed match rather than a recursive lookup.
        { id: row._id, slug: row.slug, name: row.name.en, path: [...row.path, row._id] },
      ]),
    );
  }

  private async brandIndex(): Promise<Map<string, BrandRef>> {
    const rows = await this.models.brands
      .find({ deletedAt: null })
      .lean<{ _id: Types.ObjectId; slug: string; name: { en: string } }[]>()
      .exec();

    return new Map(rows.map((row) => [row.slug, { id: row._id, slug: row.slug, name: row.name.en }]));
  }
}

interface CategoryRef {
  id: Types.ObjectId;
  slug: string;
  name: string;
  path: Types.ObjectId[];
}
interface BrandRef {
  id: Types.ObjectId;
  slug: string;
  name: string;
}

type MappedRow = Partial<Record<ImportableField, string | number | boolean | string[] | null>>;

/**
 * Compares only the paths this run would write.
 *
 * A whole-document comparison would report a change on every run, because the
 * stored document carries `_id`, `createdAt`, `updatedAt`, `salesCount`,
 * `rating` and `images` that the spreadsheet knows nothing about. Comparing
 * what WOULD BE WRITTEN is the only comparison that answers "did this import
 * change anything?".
 */
function differs(existing: Record<string, unknown>, changes: Record<string, unknown>): boolean {
  for (const [path, value] of Object.entries(changes)) {
    if (
      JSON.stringify(normaliseForCompare(dotted(existing, path))) !==
      JSON.stringify(normaliseForCompare(value))
    ) {
      return true;
    }
  }
  return false;
}

/** Reads `a.b.c` out of a plain object, returning undefined at any gap. */
function dotted(source: Record<string, unknown> | null, path: string): unknown {
  if (source === null) return undefined;

  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Dotted `$set` paths back into a nested object, for the INSERT path.
 *
 * `Model.create` does not interpret dotted keys — it would store a literal
 * field called `pricing.basePrice` — so the same change set has to be expanded
 * before it can create a document. Sharing one change set between insert and
 * update is what keeps the two paths from drifting.
 */
function expand(changes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [path, value] of Object.entries(changes)) {
    const segments = path.split('.');
    let cursor = out;

    for (const segment of segments.slice(0, -1)) {
      cursor[segment] ??= {};
      cursor = cursor[segment] as Record<string, unknown>;
    }

    cursor[segments[segments.length - 1] as string] = value;
  }

  return out;
}

/**
 * A number, or null for a cell the feed left empty.
 *
 * `Number(undefined)` is `NaN`, and Mongoose casts `NaN` to a hard error at the
 * far end of the run — which is how an unmapped optional column used to fail
 * every row of an otherwise valid file with a message about casting.
 */
function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * A localised text field, or null when the feed has nothing to say.
 *
 * The distinction matters: `null` means "this product has no short
 * description", which is a legitimate state the schema models. `{ en: '' }`
 * means "this product has a short description, and it is blank", which the
 * schema refuses — correctly, because it is not a thing anybody means.
 */
function localised(value: unknown): { en: string; ar: null } | null {
  const text = value === null || value === undefined ? '' : String(value).trim();

  return text === '' ? null : { en: text, ar: null };
}

/** ObjectIds and Dates stringify differently depending on where they came from. */
function normaliseForCompare(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(normaliseForCompare);
  if (typeof value === 'object') {
    if ('toHexString' in value && typeof value.toHexString === 'function') {
      return (value as { toHexString: () => string }).toHexString();
    }
    if (value instanceof Date) return value.toISOString();

    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = normaliseForCompare(nested);
    }
    return out;
  }
  return value;
}

/** CSV or JSON into an array of column-keyed rows. */
function parseRows(
  content: string,
  format: 'csv' | 'json',
  profile: MappingProfile,
): Record<string, string>[] {
  if (format === 'json') {
    const parsed: unknown = JSON.parse(content);

    if (!Array.isArray(parsed)) {
      throw new Error('a JSON catalogue must be an array of objects, one per product');
    }

    // Everything downstream reads strings, so a JSON file that already carries
    // real numbers is normalised to the same shape a CSV produces. One code
    // path, one set of coercion rules, one set of error messages.
    return parsed.map((row) => {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        out[key] = value === null || value === undefined ? '' : String(value);
      }
      return out;
    });
  }

  return parse(content, {
    columns: true,
    delimiter: profile.delimiter ?? ',',
    skip_empty_lines: true,
    // Supplier exports are full of trailing spaces after a comma, and a header
    // read as "  Item Code" matches no profile anybody would write.
    trim: true,
    // Excel writes a UTF-8 BOM, which otherwise becomes part of the FIRST
    // column's name and makes exactly one mapping mysteriously fail.
    bom: true,
    // A short row is a data problem the report should name, not a parse error
    // that stops the whole file at row 300.
    relax_column_count: true,
  }) as Record<string, string>[];
}

/** Applies the profile to one raw row. */
function mapRow(raw: Record<string, string>, profile: MappingProfile): MappedRow {
  const mapped: MappedRow = {};

  for (const [field, mapping] of Object.entries(profile.fields)) {
    mapped[field as ImportableField] = coerce(field, raw[mapping.column], mapping);
  }

  return mapped;
}
