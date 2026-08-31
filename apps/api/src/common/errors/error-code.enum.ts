/**
 * Stable, machine-readable error codes. Clients switch on these values.
 *
 * Authority: docs/architecture/API-STANDARDS.md §2.
 *
 * Only the codes the current runtime can actually emit are declared. The
 * catalogue is ADDITIVE — later phases add their codes as the conditions that
 * produce them become reachable. Removing or repurposing a code is a breaking
 * change for the Flutter client, which switches on it.
 */
export enum ErrorCode {
  // ---- Authentication — 401 ----
  /** No credentials supplied on a protected route. */
  UNAUTHENTICATED = 'UNAUTHENTICATED',

  /** Access token expired. The client should refresh ONCE and retry. */
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',

  /** Malformed, tampered, or wrong signature. Do not retry — re-authenticate. */
  TOKEN_INVALID = 'TOKEN_INVALID',

  /** Refresh token unknown, expired, or already rotated. */
  REFRESH_TOKEN_INVALID = 'REFRESH_TOKEN_INVALID',

  /**
   * A revoked refresh token was replayed. Treated as theft: the entire rotation
   * family is revoked, so every session in that chain is now dead.
   */
  REFRESH_TOKEN_REUSED = 'REFRESH_TOKEN_REUSED',

  /** Wrong email or password — deliberately identical for both. */
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',

  // ---- Authorization — 403 ----
  /** Authenticated, but the role is insufficient. */
  FORBIDDEN = 'FORBIDDEN',

  /** Verification required before this action. */
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',

  /** Account deactivated. */
  ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',

  // ---- Validation — 400 ----
  /** One or more fields invalid. ALWAYS carries `details`. */
  VALIDATION_ERROR = 'VALIDATION_ERROR',

  /** Unparseable request body. */
  MALFORMED_REQUEST = 'MALFORMED_REQUEST',

  /**
   * A field not present in the DTO was supplied.
   *
   * A first-class code because it is a SECURITY SIGNAL: it fires when a client
   * attempts to inject `role`, `stock`, `userId` or `price` into a DTO that
   * does not accept them.
   */
  UNKNOWN_FIELD = 'UNKNOWN_FIELD',

  /** `sort` value outside the endpoint's allow-list. */
  UNSUPPORTED_SORT = 'UNSUPPORTED_SORT',

  /**
   * `POST /orders` arrived without an `Idempotency-Key` header.
   *
   * The header is MANDATORY, not advisory: a mobile client that retries after a
   * timeout has no way to know whether the original request committed, and
   * without a key the server has no way to tell it.
   */
  MISSING_IDEMPOTENCY_KEY = 'MISSING_IDEMPOTENCY_KEY',

  // ---- Not found — 404 ----
  /** Generic 404. A resource owned by another user also returns this, never 403. */
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND',
  CATEGORY_NOT_FOUND = 'CATEGORY_NOT_FOUND',
  BRAND_NOT_FOUND = 'BRAND_NOT_FOUND',

  /** A product is in the cart, but the requested cart line is not. */
  CART_ITEM_NOT_FOUND = 'CART_ITEM_NOT_FOUND',

  /** No such order, or it belongs to somebody else — deliberately the same answer. */
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',

  /**
   * No such saved address, or it belongs to somebody else — deliberately the
   * same answer, and the same answer again when it is supplied to checkout.
   *
   * Reserved in API-STANDARDS.md §2 from the beginning; it becomes emittable in
   * this phase, when the address book starts to exist. Splitting "not yours"
   * from "not there" would turn any address id into an existence oracle for
   * another customer's address book, which is exactly the rule the same section
   * states: "a resource owned by another user returns 404, never 403".
   */
  ADDRESS_NOT_FOUND = 'ADDRESS_NOT_FOUND',

  // ---- Conflict — 409 ----
  /** An account already exists for this email address. */
  DUPLICATE_EMAIL = 'DUPLICATE_EMAIL',

  /** Insufficient stock. `details` names the SKU and the available quantity. */
  OUT_OF_STOCK = 'OUT_OF_STOCK',

  /** The product is inactive or soft-deleted and cannot be purchased. */
  PRODUCT_UNAVAILABLE = 'PRODUCT_UNAVAILABLE',

  /** The resource changed between the read and the write. Retrying is safe. */
  CONCURRENT_MODIFICATION = 'CONCURRENT_MODIFICATION',

  /**
   * The order cannot be cancelled from the status it is currently in.
   *
   * Frozen in API-STANDARDS.md §2 as "already dispatched", which is the common
   * case, but it covers every refusal of the `-> CANCELLED` edge: an order that
   * has shipped, one already delivered, and one that is ALREADY cancelled.
   *
   * `details` names the current status, so a client can re-render the order
   * without a second request. It is the customer's own order, so its status is
   * not information they did not already have.
   *
   * Deliberately NOT `CONCURRENT_MODIFICATION`: that code tells a client to
   * retry, and retrying this never succeeds. A cancelled order is terminal.
   */
  ORDER_NOT_CANCELLABLE = 'ORDER_NOT_CANCELLABLE',

  /**
   * The order state machine does not permit this move from the order's current
   * status.
   *
   * Frozen in API-STANDARDS.md §2. The STAFF counterpart of
   * `ORDER_NOT_CANCELLABLE`: that code answers the one edge a customer can
   * drive, this one answers every other edge. `details` names the current
   * status and the requested one, which an operator authorised to see the whole
   * order already had.
   *
   * Not retryable. A repeated operation against an order that has already moved
   * lands here rather than returning a misleading success.
   */
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',

  /**
   * An `Idempotency-Key` was replayed for a MATERIALLY DIFFERENT request, or by
   * a different account.
   *
   * Additive to the frozen catalogue in API-STANDARDS.md §2, which enumerates
   * `MISSING_IDEMPOTENCY_KEY` but has no code for a key that is present and
   * conflicting. `CONCURRENT_MODIFICATION` was rejected for it: that code tells
   * a client to retry, and retrying this never succeeds.
   *
   * The response deliberately says nothing about the original request — in the
   * cross-account case, confirming that a key exists is the only thing an
   * attacker holding a stolen key could learn, and they learn nothing more.
   */
  IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED',

  // ---- Business rule — 422 ----
  /** Checkout was attempted with nothing in the cart. */
  CART_EMPTY = 'CART_EMPTY',

  /**
   * The address book is full.
   *
   * Additive to the frozen catalogue in API-STANDARDS.md §2, under the additive
   * rule at the top of that section. The cap itself is frozen —
   * MONGODB-DESIGN.md §3 states "`addresses` is bounded by UX (a 'max 10
   * addresses' rule is applied)" — and it is the growth argument that justifies
   * embedding the array in the user document, so it is enforced rather than
   * assumed.
   *
   * 422 rather than 400: the request is perfectly well formed, and it is the
   * account's STATE that refuses it. `VALIDATION_ERROR` was rejected for that
   * reason — no field is invalid, so there would be nothing to put in `details`
   * that a form could bind to.
   */
  ADDRESS_LIMIT_REACHED = 'ADDRESS_LIMIT_REACHED',

  // ---- Rate limiting — 429 ----
  /** Too many requests. Accompanied by a `Retry-After` header in seconds. */
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // ---- Server — 5xx ----
  /** 500. Never carries detail — the detail is logged against the requestId. */
  INTERNAL_ERROR = 'INTERNAL_ERROR',

  /** 503. A dependency is unavailable. */
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',

  /** 503. A transaction aborted after the driver exhausted its retries. */
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
}
