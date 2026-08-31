/**
 * A 24-character MongoDB ObjectId in hex — the id format the whole API exposes.
 *
 * Authority: docs/architecture/API-CONTRACT.md §1 — "IDs are 24-character hex
 * strings, opaque to clients".
 *
 * Validating the SHAPE at the DTO boundary matters beyond tidiness: an
 * unvalidated string reaches `new Types.ObjectId(...)`, which throws a
 * BSONError that would surface as a 500 rather than the 400 it actually is.
 */
export const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
