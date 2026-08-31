/**
 * Egyptian mobile number.
 *
 * Authority: docs/architecture/BUSINESS-RULES.md — the phone format is validated
 * SERVER-SIDE, on every path that accepts one. Phase 0 catalogued the phone
 * check as one of nine rules that existed only in the browser.
 *
 * Accepts `01xxxxxxxxx`, `+201xxxxxxxxx` and `201xxxxxxxxx`; the second digit is
 * the operator prefix (0 Vodafone, 1 Etisalat, 2 Orange, 5 WE).
 *
 * The `+` is OPTIONAL on the country code — `(\+?20|0)?`, not `(\+20|0)?`. The
 * earlier form required the plus, so the bare international `201…` that this
 * comment has always promised was in fact refused: the pattern contradicted its
 * own contract, and the contract is what is published to clients as
 * `pattern: EGYPTIAN_PHONE.source` in the OpenAPI document. Widening it to what
 * was documented cannot reject anything that was previously accepted, and it
 * cannot change a number already stored.
 *
 * Lives in `common/` because two unrelated domains need exactly this rule —
 * registration (`AuthModule`) and a delivery address (`UsersModule`, consumed by
 * checkout) — and a second copy is how a validation rule starts to drift. The
 * cart's four-way duplication of `MAX_QUANTITY_PER_LINE` is the local precedent
 * for not doing that.
 */
export const EGYPTIAN_PHONE = /^(\+?20|0)?1[0-25][0-9]{8}$/;
