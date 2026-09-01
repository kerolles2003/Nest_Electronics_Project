import type { FieldMapping } from './mapping-profile';

/**
 * One raw cell into one field value, according to the profile.
 *
 * Authority: PLAN.md Phase 4 item 1 — "per-field type coercion, required /
 * optional, and a default".
 *
 * ## Why this refuses so much
 *
 * Every function here fails rather than guesses, and each refusal is a specific
 * observed way spreadsheets lie:
 *
 *   "1,299.00"   thousands separators, which `Number()` turns into NaN
 *   "1 299,00"   European format, where the comma IS the decimal point
 *   "12.5"       a price in pounds where the schema wants piastres
 *   "yes"/"Y"    a boolean written the way a person writes one
 *   " ESP32 "    whitespace from a copy-paste
 *   "12.7"       a decimal where the schema demands an integer count
 *
 * The last one is the reason `integer` refuses rather than rounds. A stock
 * figure of 12.7 is not 13 items; it is a column that means something other
 * than what the profile claims, and rounding it hides that until somebody sells
 * an item that does not exist.
 */

export class CoercionError extends Error {}

/** Applies the mapping's type, its default and its required flag to one cell. */
export function coerce(
  field: string,
  raw: string | undefined,
  mapping: FieldMapping,
): string | number | boolean | string[] | null {
  const trimmed = (raw ?? '').trim();

  if (trimmed === '') {
    if (mapping.required === true) {
      throw new CoercionError(`${field} is required but the "${mapping.column}" cell is empty`);
    }
    return mapping.default ?? null;
  }

  switch (mapping.type) {
    case 'string':
      return trimmed;

    case 'integer':
      return toInteger(field, mapping.column, trimmed);

    case 'minorUnits':
      return toMinorUnits(field, mapping.column, trimmed);

    case 'boolean':
      return toBoolean(field, mapping, trimmed);

    case 'stringList':
      // Semicolon, not comma: these lists live in CSV cells, and a comma-
      // separated list inside a comma-separated file means every author has to
      // remember to quote it. Semicolons need no quoting and nothing else uses
      // them here.
      return trimmed
        .split(';')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
  }
}

/** Strips thousands separators; refuses anything that is not a whole number. */
function toInteger(field: string, column: string, value: string): number {
  const cleaned = value.replace(/[\s,_]/g, '');

  if (!/^-?\d+$/.test(cleaned)) {
    throw new CoercionError(
      `${field}: "${value}" in column "${column}" is not a whole number`,
    );
  }

  return Number(cleaned);
}

/**
 * A written price into integer minor units (piastres).
 *
 * MONEY-MODEL.md is absolute that money is integer minor units, and this is the
 * single place a supplier's decimal ever becomes one. Doing it anywhere else —
 * or leaving it to `Number(value) * 100` at a call site — is how a catalogue
 * ends up with `32499.999999999996`.
 *
 * ## Why it accepts both "1,299.50" and "1.299,50"
 *
 * Both are real. English exports use a comma for thousands and a dot for
 * decimals; most of continental Europe does the reverse. The rule that tells
 * them apart without asking is the LAST separator: if the final `.` or `,` has
 * ONE OR TWO digits after it, it is the decimal point, and every other
 * separator is a grouping mark.
 *
 * One digit counts, and that is not a detail. "89.5" in a price column means
 * 89.50 EGP; reading the dot as a grouping mark would make it 89,500 EGP — a
 * thousandfold error, in the direction of charging a customer far too much,
 * from a cell that looks perfectly ordinary. (Found by a test: the rule
 * originally required exactly two.)
 *
 * Three digits after the last separator is read as a grouping mark, so "1.234"
 * is 1,234 rather than 1.234. That case is genuinely ambiguous in isolation and
 * the convention is the safer reading — a supplier writing one-and-a-bit
 * currency units to three decimal places is not a thing, and a thousands
 * separator is.
 *
 * A value with no separator at all is whole currency units — "1299" is 1,299.00
 * EGP, not 12.99. That is what a supplier means, and reading it the other way
 * would understate every round price by two orders of magnitude.
 */
function toMinorUnits(field: string, column: string, value: string): number {
  const cleaned = value.replace(/[^\d.,-]/g, '');

  if (cleaned === '' || !/\d/.test(cleaned)) {
    throw new CoercionError(`${field}: "${value}" in column "${column}" is not a price`);
  }

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const separator = Math.max(lastDot, lastComma);

  const trailing = separator === -1 ? -1 : cleaned.length - separator - 1;
  const hasDecimals = trailing === 1 || trailing === 2;

  const whole = hasDecimals ? cleaned.slice(0, separator) : cleaned;
  // Padded, so "89.5" is 89.50 and not 89.05.
  const fraction = hasDecimals ? cleaned.slice(separator + 1).padEnd(2, '0') : '00';

  const digits = whole.replace(/[.,\s]/g, '');

  if (!/^-?\d+$/.test(digits) || !/^\d{2}$/.test(fraction)) {
    throw new CoercionError(`${field}: "${value}" in column "${column}" is not a price`);
  }

  // String concatenation, not arithmetic. `parseFloat(x) * 100` is exactly the
  // floating-point mistake MONEY-MODEL.md exists to prevent, and it is wrong
  // for values as ordinary as 8.29.
  return Number(`${digits}${fraction}`);
}

/**
 * The English forms of yes and no that actually turn up in supplier files.
 *
 * A profile may ADD to these with `trueValues` / `falseValues` — a German feed
 * writes `Ja`/`Nein`, and no built-in list will ever be right for a supplier
 * nobody has met. The built-ins stay because most feeds are in English and
 * making every profile restate them would be noise.
 */
const TRUE_VALUES = ['true', 'yes', 'y', '1', 'on'];
const FALSE_VALUES = ['false', 'no', 'n', '0', 'off', '-'];

function toBoolean(field: string, mapping: FieldMapping, value: string): boolean {
  const lowered = value.toLowerCase();
  const lower = (values: readonly string[]): string[] => values.map((v) => v.toLowerCase());

  if ([...TRUE_VALUES, ...lower(mapping.trueValues ?? [])].includes(lowered)) return true;
  if ([...FALSE_VALUES, ...lower(mapping.falseValues ?? [])].includes(lowered)) return false;

  // Refused rather than treated as false. "Featurd" as a typo would silently
  // unfeature a product, and a silent wrong answer is worse than a reported row.
  // The message names the accepted words, because the reader is editing a
  // profile and needs to know what to add.
  throw new CoercionError(
    `${field}: "${value}" in column "${mapping.column}" is not a yes/no value. ` +
      `Accepted: ${[...TRUE_VALUES, ...(mapping.trueValues ?? [])].join('/')} for yes, ` +
      `${[...FALSE_VALUES, ...(mapping.falseValues ?? [])].join('/')} for no. ` +
      'Add this supplier\'s own words to the profile with `trueValues` / `falseValues`.',
  );
}

/**
 * A URL-safe slug from a product name, for feeds that carry no slug column.
 *
 * Not reversible and not meant to be: it is a public identifier derived once at
 * import. Two products whose names differ only in punctuation collide here, and
 * the runner reports that collision rather than silently overwriting — which is
 * the whole reason slug is not the default upsert key.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
