/**
 * What changed, field by field, with the values that must never be stored
 * replaced rather than dropped.
 *
 * Authority: docs/architecture/AUDIT-MODEL.md §4 — "`changes.before/after`:
 * **only the fields that actually changed** — not whole documents", and
 * "Never stored in `changes`: `passwordHash`, tokens, `costPrice` in a
 * customer-visible context, or full PII. A diff is computed field-by-field with
 * a redaction allow-list."
 *
 * ## Why only the changed fields
 *
 * Two reasons, and the second is the one that bites. Storing whole documents
 * makes an audit record grow without bound and makes the log unreadable — an
 * investigator has to diff two blobs by eye. But it also means every audit row
 * carries every secret the entity holds, forever, whether or not that secret
 * was involved in the action being recorded.
 *
 * ## Why redaction REPLACES rather than omits
 *
 * "The password hash changed" is exactly the kind of fact an investigator needs.
 * "Nothing changed" is a lie, and an omitted field says that. So the path stays
 * and the value becomes a marker: the audit records that the field moved
 * without recording what it moved to.
 *
 * ## `costPrice` is deliberately NOT redacted
 *
 * §4 says "`costPrice` in a customer-visible context". `auditLogs` is not one —
 * §8 restricts it to `ADMIN`. Redacting it here would hide the before and after
 * of a margin change from the only people entitled to see it, which is the
 * opposite of what auditing a money-affecting change is for. Stated rather than
 * assumed, because the phrase is easy to read as a blanket ban.
 */

/** The marker written in place of a value that must never be stored. */
export const REDACTED = '[redacted]';

/**
 * Field names whose VALUE is never written to an audit record.
 *
 * Matched on the last segment of the path, case-insensitively, so
 * `credentials.passwordHash` and `passwordHash` are both caught. A substring
 * match was rejected: it would redact `tokenCount` and `resetTokenSentAt`,
 * which are facts an investigator wants, while giving no additional protection.
 */
const NEVER_STORED: ReadonlySet<string> = new Set([
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'tokenhash',
  'secret',
  'otp',
  'resettoken',
  'verificationtoken',
]);

export interface AuditChanges {
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    Object.getPrototypeOf(value) !== null &&
    (Object.getPrototypeOf(value) as object).constructor === Object
  );
}

function shouldRedact(path: string): boolean {
  const leaf = path.split('.').pop() ?? path;

  return NEVER_STORED.has(leaf.toLowerCase());
}

/**
 * Compared by value, not by reference.
 *
 * `Date` is compared by instant: two `Date` objects for the same moment are not
 * `===`, and reporting an unchanged timestamp as a change would fill the log
 * with noise on every save.
 */
function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === b) return true;

  // Arrays and non-plain objects are compared structurally rather than walked.
  // An order's item list either changed or it did not; a per-index diff of it
  // would be less readable than the whole value, not more.
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return false;
}

/**
 * The changed fields, as flat dotted paths.
 *
 * Returns `null` when nothing changed, so a caller can decide not to write an
 * audit record at all — an audit row saying "somebody saved this and altered
 * nothing" is noise in a log whose whole value is signal.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditChanges | null {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};

  walk(before, after, '', changedBefore, changedAfter);

  return Object.keys(changedAfter).length === 0 && Object.keys(changedBefore).length === 0
    ? null
    : { before: changedBefore, after: changedAfter };
}

function walk(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  prefix: string,
  outBefore: Record<string, unknown>,
  outAfter: Record<string, unknown>,
): void {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    const left = before[key];
    const right = after[key];

    if (isPlainObject(left) && isPlainObject(right)) {
      walk(left, right, path, outBefore, outAfter);
      continue;
    }

    if (same(left, right)) continue;

    if (shouldRedact(path)) {
      /*
       * The PATH is recorded and the values are not. "The password hash
       * changed" is a fact an investigator needs; the hash itself is not, and
       * an audit log is a two-year store read by more people than the database.
       */
      outBefore[path] = REDACTED;
      outAfter[path] = REDACTED;
      continue;
    }

    outBefore[path] = left;
    outAfter[path] = right;
  }
}
