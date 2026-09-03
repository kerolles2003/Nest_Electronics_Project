/**
 * Slug generation and collision resolution.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §2 "Slug behaviour (fixes
 * legacy K4)":
 *
 *   1. Generated from `name.en`, lowercased, non-alphanumerics to `-`,
 *      collapsed, trimmed.
 *   2. Collision produces a numeric suffix (`esp32-devkit-2`), assigned under a
 *      uniqueness check.
 *
 * Rules 3 to 6 — the `slugRedirects` collection and the 301 on rename — belong
 * with the product update path and are NOT implemented here. That is stated so
 * the omission is visible: a rename today changes the slug and leaves the old
 * URL a 404, which is exactly the legacy defect §2 records. See the handoff.
 *
 * ## Why this is a domain module
 *
 * Because it is pure, and because the interesting failures are all decidable
 * from the input: that a name of only punctuation does not produce an empty
 * slug, that Arabic text does not silently vanish, that a suffix is appended
 * rather than replacing the base.
 */

/**
 * The longest slug generated, in characters.
 *
 * Bounded because it goes in a URL and in a unique index. Truncation happens
 * before the collision suffix is added, so a suffixed slug can exceed this by
 * the width of the suffix — which is correct: truncating after would produce
 * two different products with the same truncated slug and defeat the suffix.
 */
export const MAX_SLUG_LENGTH = 80;

/** What a name reduces to when it contains nothing sluggable. */
const EMPTY_SLUG_FALLBACK = 'item';

/**
 * Turns a display name into a slug.
 *
 * Non-alphanumerics become `-`, runs collapse, and leading and trailing
 * separators are trimmed. ASCII alphanumerics only: Arabic and other non-Latin
 * text reduces to nothing, which is why the fallback exists rather than
 * allowing an empty slug into a URL.
 *
 * §3 of the same document says user-facing text is `{ en, ar? }` and that
 * localisation does NOT apply to slugs — there are no per-locale slugs in MVP —
 * so generating from `name.en` is the frozen behaviour rather than a
 * simplification.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    // A trailing separator can reappear after truncation.
    .replace(/-+$/g, '');

  return slug === '' ? EMPTY_SLUG_FALLBACK : slug;
}

/**
 * Whether a string is already a well-formed slug.
 *
 * Used to validate an admin's manual edit — §2 rule 6 makes the slug editable,
 * and an edit that is not a valid slug must be refused rather than silently
 * rewritten. Silently rewriting is worse: the operator sees one value in the
 * form and another in the URL, and neither is wrong enough to notice.
 */
export function isWellFormedSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= MAX_SLUG_LENGTH;
}

/**
 * The first free slug, given the base and the ones already taken.
 *
 * `esp32-devkit`, then `esp32-devkit-2`, `esp32-devkit-3`. Starting at 2 rather
 * than 1 because the unsuffixed slug IS the first one — `esp32-devkit-1` beside
 * `esp32-devkit` reads as though there were a zeroth.
 *
 * PURE: the caller supplies what is taken. The uniqueness check that produces
 * that set is a database question, and keeping it out of here is what makes
 * every collision case testable without one.
 */
export function nextAvailableSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${String(suffix)}`;

    if (!taken.has(candidate)) return candidate;
  }
}
