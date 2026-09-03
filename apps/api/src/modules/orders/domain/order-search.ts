/**
 * Turning what an operator typed into something safe to put in a query.
 *
 * ## Why this is a domain module and not three lines in the repository
 *
 * Because the dangerous part is pure, and pure code can be tested exhaustively
 * without a database. Every property that matters here — that `.` is a full
 * stop rather than "any character", that `(a+)+$` is a literal string rather
 * than a backtracking bomb, that an empty search is not a search — is decidable
 * from the input alone.
 *
 * ## The rule this exists to enforce
 *
 * **No client string ever becomes part of a query expression.** The legacy
 * system interpolated user input into PostgREST filter strings in six places,
 * which let a caller restructure the filter tree. `status` avoids that by being
 * narrowed to an enum before it reaches a query operator; a free-text search
 * cannot be narrowed to an enum, so it is escaped instead — every character
 * that means something to a regular-expression engine is turned into itself.
 *
 * Escaping also disposes of the ReDoS question. Catastrophic backtracking needs
 * nested quantifiers, and a pattern built only from literals has no quantifiers
 * at all: `(a+)+$` escaped is nine ordinary characters that match nine ordinary
 * characters.
 */

/**
 * The longest term accepted, in characters.
 *
 * A bound rather than a limit somebody will hit: no order number, email address
 * or name a person types to find one order approaches this. It exists because
 * an unbounded string reaches a regular-expression engine, and "the input is
 * escaped" is an argument about correctness rather than about cost.
 */
export const MAX_SEARCH_LENGTH = 64;

/**
 * Every character with a meaning in a JavaScript regular expression.
 *
 * Written out rather than taken from a library so that what is escaped is
 * visible and reviewable. `-` is included because it is significant inside a
 * character class, and a future change that wraps this in one should not have
 * to remember.
 */
const REGEX_SYNTAX = /[.*+?^${}()|[\]\\/-]/g;

export function escapeForRegex(literal: string): string {
  return literal.replace(REGEX_SYNTAX, '\\$&');
}

export interface OrderSearchTerm {
  /** The trimmed term, as typed. Useful for echoing back, never for querying. */
  readonly text: string;
  /** Escaped, case-insensitive, anchored at the start. For ids and addresses. */
  readonly prefix: RegExp;
  /** Escaped, case-insensitive, unanchored. For names. */
  readonly contains: RegExp;
  /**
   * The digits of the term, or `null` when it has none.
   *
   * Phone search is done on digits alone because nobody agrees how to write a
   * phone number: `010 1234 5678`, `010-1234-5678` and `01012345678` are the
   * same number, and an operator reading one off a delivery note will type
   * whichever they see.
   */
  readonly digits: RegExp | null;
}

/**
 * Parses a search term, or `null` when there is nothing to search for.
 *
 * Whitespace-only input returns `null` rather than an empty pattern. An empty
 * pattern matches EVERYTHING, so treating `?q=%20` as a filter would silently
 * return the unfiltered queue while the caller believed it was narrowed — the
 * kind of wrong answer that looks like a right one.
 */
export function parseOrderSearch(raw: string): OrderSearchTerm | null {
  const text = raw.trim();

  if (text.length === 0) return null;

  const escaped = escapeForRegex(text.slice(0, MAX_SEARCH_LENGTH));
  const digits = text.replace(/\D/g, '');

  return {
    text,
    prefix: new RegExp(`^${escaped}`, 'i'),
    contains: new RegExp(escaped, 'i'),
    // Four digits is the shortest suffix anybody searches by; below that the
    // match is noise rather than a search.
    digits: digits.length >= 4 ? new RegExp(escapeForRegex(digits)) : null,
  };
}
