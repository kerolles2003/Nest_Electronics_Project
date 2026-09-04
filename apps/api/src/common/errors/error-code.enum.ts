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

  /**
   * A product with this SKU already exists.
   *
   * Additive to the frozen catalogue in API-STANDARDS.md §2, under the additive
   * rule at the top of that section, and reachable for the first time in this
   * phase because nothing could create a product until now.
   *
   * SEPARATE from `DUPLICATE_SLUG` deliberately. Both are 409s raised by the
   * same write, and a single code would force the form to guess which field to
   * mark — the operator would see "duplicate" against a product whose SKU and
   * slug are both plausible and have to try each in turn. `details[0].field`
   * names the one that collided.
   */
  DUPLICATE_SKU = 'DUPLICATE_SKU',

  /** A product, category or brand of the same type already holds this slug. */
  DUPLICATE_SLUG = 'DUPLICATE_SLUG',

  /** Insufficient stock. `details` names the SKU and the available quantity. */
  OUT_OF_STOCK = 'OUT_OF_STOCK',

  /** The product is inactive or soft-deleted and cannot be purchased. */
  PRODUCT_UNAVAILABLE = 'PRODUCT_UNAVAILABLE',

  /**
   * 409. A staff write was attempted against a SOFT-DELETED product.
   *
   * Distinct from `PRODUCT_UNAVAILABLE`, which answers a CUSTOMER trying to buy
   * something hidden. This one answers an operator, and it is actionable in a
   * way that code is not: restore it, then edit it. Editing or publishing a
   * deleted product is refused rather than allowed, because a change nobody can
   * see is the same class of problem as the deleted rows the admin listing
   * keeps out of the default view.
   */
  PRODUCT_DELETED = 'PRODUCT_DELETED',

  /**
   * 409. A staff write was attempted against a soft-deleted category or brand.
   *
   * Two codes rather than one shared "entity is deleted", matching the shape
   * the catalogue already uses for `PRODUCT_NOT_FOUND` / `CATEGORY_NOT_FOUND` /
   * `BRAND_NOT_FOUND`. A console showing three different forms wants to say
   * which of the three things it is looking at is gone.
   */
  CATEGORY_DELETED = 'CATEGORY_DELETED',
  BRAND_DELETED = 'BRAND_DELETED',

  /**
   * 409. A category was asked to be deleted while products or live child
   * categories still point at it.
   *
   * Refused rather than cascaded. A cascade would soft-delete a subtree in one
   * click and give the operator no way to know what it took with it; and every
   * product left pointing at a deleted category would be filed somewhere that
   * renders nowhere — the same state `POST /admin/catalog/products` already
   * refuses to create. `details` says how many of each are in the way, because
   * that turns the refusal into a work list.
   */
  CATEGORY_NOT_EMPTY = 'CATEGORY_NOT_EMPTY',

  /**
   * 409. A ninth image was offered to a product that already holds eight.
   *
   * CATALOG-MODEL.md §8 bounds `images[]` at 8, and the bound is what keeps the
   * array embeddable: it is loaded with the product on every read, so an
   * unbounded one turns the hottest document in the system into a page of
   * descriptors nobody looks at.
   */
  PRODUCT_IMAGE_LIMIT = 'PRODUCT_IMAGE_LIMIT',

  /**
   * 409. That asset is already attached to this product.
   *
   * Refused rather than treated as a no-op, and the reason is the ledger: a
   * second attach that quietly "succeeded" would either double-count the
   * reference — leaving an asset undeletable forever — or, if it skipped the
   * retain, leave the count one short of the truth and the asset deletable
   * while a live page shows it. Both are silent. A 409 is not.
   */
  PRODUCT_IMAGE_ALREADY_ATTACHED = 'PRODUCT_IMAGE_ALREADY_ATTACHED',

  /** 404. The product does not carry an image with that `publicId`. */
  PRODUCT_IMAGE_NOT_FOUND = 'PRODUCT_IMAGE_NOT_FOUND',

  /**
   * 409. A hard delete was attempted on a product an order refers to.
   *
   * CATALOG-MODEL.md §9 allows a hard delete only for a product "never
   * referenced by any order". Orders embed product SNAPSHOTS so the commercial
   * record survives regardless — but `productId` is retained on every line for
   * traceability and reorder, and destroying the document turns that into a
   * dangling id that analytics and the reorder button both follow to nothing.
   * Soft delete is the answer for these, and it always was.
   */
  PRODUCT_HAS_ORDERS = 'PRODUCT_HAS_ORDERS',

  /**
   * 409. A negative adjustment would have driven `stock.onHand` below zero.
   *
   * Distinct from `OUT_OF_STOCK`, which answers a CUSTOMER whose checkout could
   * not be satisfied. This answers an operator, and it means something
   * different: not "we cannot sell you this" but "the number you are trying to
   * remove is larger than the number we have". `details` carries both, because
   * the operator's next action is to post the difference they actually counted.
   *
   * INVENTORY-MODEL.md §5.3: "Resulting `onHand` must be >= 0, enforced by a
   * conditional update" — so this is raised by the update matching nothing, not
   * by a read-then-compare, and two operators cannot both pass it.
   */
  INSUFFICIENT_STOCK_FOR_ADJUSTMENT = 'INSUFFICIENT_STOCK_FOR_ADJUSTMENT',

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

  // ---- Media — 400 / 404 / 409 ----
  /**
   * 400. The uploaded file failed a rule: too large, empty, an unaccepted MIME
   * type, contents that are not the declared format, or dimensions below the
   * minimum. `details[0].message` says which — one code rather than six,
   * because every one of them is answered the same way (send a different file)
   * and a client that branched on the difference would gain nothing.
   */
  INVALID_UPLOAD = 'INVALID_UPLOAD',

  /** 404. No managed asset with that `publicId`. */
  MEDIA_ASSET_NOT_FOUND = 'MEDIA_ASSET_NOT_FOUND',

  /**
   * 409. The asset is still referenced by at least one document, and
   * destroying it would break every page that shows it — the legacy defect
   * reference counting exists to prevent. `details[0].message` gives the count.
   */
  MEDIA_ASSET_IN_USE = 'MEDIA_ASSET_IN_USE',

  /**
   * 500. No `shippingRates` row exists for a governorate an address carries.
   *
   * A SERVER fault, never the customer's: the governorate is closed to a
   * validated list on both sides, so this cannot be reached by bad input. It
   * means the rate table is incomplete, and D-8 is explicit that a miss raises
   * rather than inventing a fee. Carries no detail; the governorate is logged
   * against the requestId, because which governorate is unpriced is operational
   * information and not the customer's business.
   */
  SHIPPING_RATE_MISSING = 'SHIPPING_RATE_MISSING',

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
