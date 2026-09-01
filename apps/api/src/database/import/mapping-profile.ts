/**
 * A declarative description of somebody else's spreadsheet.
 *
 * Authority: PLAN.md Phase 4 item 1 — "Column mapping is CONFIGURATION, not
 * code `[O]`. The real catalogue will arrive later from a supplier feed or
 * another external source whose columns are **unknown at design time**, so the
 * tool must not hardcode a schema."
 *
 * ## Why a profile rather than a parser per supplier
 *
 * The catalogue does not exist yet (§25 risk 1). Nobody knows whether the file
 * will say `sku`, `Item Code` or `ARTIKELNUMMER`, whether prices arrive in
 * pounds or piastres, or whether stock is a number or the word "yes". Writing a
 * parser against a guess would mean rewriting it when the guess turned out
 * wrong, and rewriting a parser is a code review, a release and a risk.
 *
 * A profile makes a new supplier format a **new JSON file**. That does not
 * remove the work of understanding the supplier's data — nothing can — but it
 * moves it from engineering time to the moment the file arrives, which is the
 * only lead time this project can actually shorten.
 *
 * ## What a profile can and cannot say
 *
 * It can say which column feeds which field, what type that field is, whether
 * it is required, what to use when it is missing, and how to turn one written
 * form into another (a decimal price into minor units, "Yes" into `true`, a
 * comma-separated list into an array).
 *
 * It deliberately CANNOT contain expressions, formulas or code. A profile that
 * could compute would be a program in a JSON file — unreviewable, untestable,
 * and a place for arbitrary logic to accumulate where nobody looks for it. When
 * a supplier needs something this cannot express, the honest answer is a new
 * `transform` here, named and tested, rather than an escape hatch.
 */

/** How a raw cell becomes a field value. */
export const FIELD_TYPES = ['string', 'integer', 'minorUnits', 'boolean', 'stringList'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Every product field a profile may populate. */
export const IMPORTABLE_FIELDS = [
  'sku',
  'slug',
  'name',
  'shortDescription',
  'description',
  'categorySlug',
  'brandSlug',
  'basePrice',
  'salePrice',
  'costPrice',
  'onHand',
  'lowStockThreshold',
  'isFeatured',
  'weight',
  'imagePaths',
] as const;
export type ImportableField = (typeof IMPORTABLE_FIELDS)[number];

export interface FieldMapping {
  /** The column heading in the supplier's file, verbatim. */
  readonly column: string;
  readonly type: FieldType;
  /**
   * When true, a row with this cell blank is REPORTED and skipped rather than
   * imported with a hole in it. Half a product is worse than no product: it
   * appears in the catalogue and is wrong.
   */
  readonly required?: boolean;
  /** Used when the cell is absent or blank and the field is not required. */
  readonly default?: string | number | boolean | null;

  /**
   * How THIS supplier writes yes and no, when they do not write it in English.
   *
   * `boolean` fields understand the ordinary English forms out of the box
   * (`yes`/`no`, `true`/`false`, `1`/`0`, `y`/`n`, `on`/`off`, `-`). A German
   * feed writes `Ja`/`Nein`, an Arabic one writes something else again, and no
   * built-in list is going to be right for a supplier nobody has met yet.
   *
   * Declaring them here rather than growing the built-in list is the same
   * decision as the column mapping itself: the vocabulary of one supplier's
   * file is configuration, and putting it in code would mean a release every
   * time a new one arrives. Matching is case-insensitive; anything matching
   * neither list is REPORTED, never assumed false.
   */
  readonly trueValues?: readonly string[];
  readonly falseValues?: readonly string[];
}

export interface MappingProfile {
  /** Shown in the report, so a run can be traced to the profile that produced it. */
  readonly name: string;
  readonly description?: string;

  /**
   * The CSV delimiter. Continental European exports are semicolon-separated far
   * more often than an English-speaking reader expects, and a comma parser on a
   * semicolon file produces one enormous column rather than an error.
   */
  readonly delimiter?: string;

  /**
   * Which field identifies a row as "the same product" across runs.
   *
   * SKU by default, because it is the supplier's own identity for the item and
   * survives a rename. Slug is offered for feeds that have no SKU, with the
   * caveat that a renamed product then imports as a new one.
   */
  readonly upsertKey?: 'sku' | 'slug';

  readonly fields: Readonly<Partial<Record<ImportableField, FieldMapping>>>;
}

/** Raised when the profile itself is wrong; the caller reports it and stops. */
export class ProfileError extends Error {}

/**
 * The fields no product can do without.
 *
 * `slug` is absent on purpose — it is derived from the name when a feed does not
 * carry one, which is the common case, and demanding it would reject files that
 * are otherwise complete.
 */
const MANDATORY_FIELDS: readonly ImportableField[] = [
  'sku',
  'name',
  'categorySlug',
  'basePrice',
  'onHand',
];

/**
 * Validates a profile before a single row is read.
 *
 * Failing here is the difference between "your profile names a field that does
 * not exist" and a run that imports 4,000 products with a silently empty price.
 * Every message names the offending key, because the person reading it is
 * editing a JSON file by hand.
 */
export function validateProfile(candidate: unknown): MappingProfile {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new ProfileError('the profile must be a JSON object');
  }

  const profile = candidate as Record<string, unknown>;

  if (typeof profile['name'] !== 'string' || profile['name'].length === 0) {
    throw new ProfileError('the profile needs a non-empty `name`');
  }

  const fields = profile['fields'];
  if (typeof fields !== 'object' || fields === null) {
    throw new ProfileError('the profile needs a `fields` object');
  }

  const entries = Object.entries(fields as Record<string, unknown>);

  if (entries.length === 0) {
    throw new ProfileError('`fields` is empty — a profile that maps nothing imports nothing');
  }

  const columns = new Map<string, string>();

  for (const [field, raw] of entries) {
    if (!(IMPORTABLE_FIELDS as readonly string[]).includes(field)) {
      throw new ProfileError(
        `\`${field}\` is not an importable field. Choose from: ${IMPORTABLE_FIELDS.join(', ')}`,
      );
    }

    if (typeof raw !== 'object' || raw === null) {
      throw new ProfileError(`\`fields.${field}\` must be an object with \`column\` and \`type\``);
    }

    const mapping = raw as Record<string, unknown>;

    if (typeof mapping['column'] !== 'string' || mapping['column'].length === 0) {
      throw new ProfileError(`\`fields.${field}.column\` must name a column in the file`);
    }

    if (!(FIELD_TYPES as readonly string[]).includes(mapping['type'] as string)) {
      throw new ProfileError(
        `\`fields.${field}.type\` must be one of: ${FIELD_TYPES.join(', ')}`,
      );
    }

    // Two fields reading one column is almost always a copy-paste mistake in a
    // hand-edited profile, and it produces a plausible-looking import in which
    // two things are silently the same value.
    const claimedBy = columns.get(mapping['column']);
    if (claimedBy !== undefined) {
      throw new ProfileError(
        `\`${mapping['column']}\` is mapped to both \`${claimedBy}\` and \`${field}\``,
      );
    }
    columns.set(mapping['column'], field);
  }

  const mapped = new Set(entries.map(([field]) => field));
  const missing = MANDATORY_FIELDS.filter((field) => !mapped.has(field));

  if (missing.length > 0) {
    throw new ProfileError(
      `the profile does not map: ${missing.join(', ')}. A product cannot be created without them.`,
    );
  }

  const upsertKey = profile['upsertKey'];
  if (upsertKey !== undefined && upsertKey !== 'sku' && upsertKey !== 'slug') {
    throw new ProfileError('`upsertKey` must be "sku" or "slug"');
  }

  if (upsertKey === 'slug' && !mapped.has('slug')) {
    throw new ProfileError('`upsertKey` is "slug", but no column is mapped to `slug`');
  }

  return profile as unknown as MappingProfile;
}
