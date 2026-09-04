import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-code.enum';

/** One field-level problem, for form binding on the client. */
export interface FieldError {
  readonly field: string;
  readonly message: string;
  /**
   * Always present, nullable rather than optional: API-CONTRACT.md §1 requires
   * a stable response shape so a generated Dart model never has to distinguish
   * "absent" from "null".
   */
  readonly code: string | null;
}

/**
 * The base domain exception. Carries a stable code, an HTTP status and a
 * message that is ALREADY SAFE to show a user.
 *
 * Authority: docs/architecture/API-STANDARDS.md §1, §3.
 *
 * Nothing derived from a driver error, a stack trace, a collection name or an
 * index name may be passed as `safeMessage`. AllExceptionsFilter trusts this
 * type precisely because construction is the moment safety is decided.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: HttpStatus,
    readonly safeMessage: string,
    readonly details?: readonly FieldError[],
  ) {
    super(safeMessage, status);
  }

  static validation(details: readonly FieldError[]): AppException {
    return new AppException(
      ErrorCode.VALIDATION_ERROR,
      HttpStatus.BAD_REQUEST,
      'Validation failed.',
      details,
    );
  }

  static unknownField(details: readonly FieldError[]): AppException {
    return new AppException(
      ErrorCode.UNKNOWN_FIELD,
      HttpStatus.BAD_REQUEST,
      'The request contained a field that is not accepted by this endpoint.',
      details,
    );
  }

  static unsupportedSort(allowed: readonly string[]): AppException {
    return new AppException(
      ErrorCode.UNSUPPORTED_SORT,
      HttpStatus.BAD_REQUEST,
      `Unsupported sort value. Allowed: ${allowed.join(', ')}.`,
      [{ field: 'sort', message: `Must be one of: ${allowed.join(', ')}`, code: 'ENUM' }],
    );
  }

  // --- Authentication -------------------------------------------------------

  /**
   * ONE response for an unknown email and for a wrong password.
   *
   * Splitting them would turn the login endpoint into an account-existence
   * oracle. The service also performs a bcrypt comparison against a dummy hash
   * when the email is unknown, so the two paths cost the same wall-clock time.
   */
  static invalidCredentials(): AppException {
    return new AppException(
      ErrorCode.INVALID_CREDENTIALS,
      HttpStatus.UNAUTHORIZED,
      'Invalid email or password.',
    );
  }

  static unauthenticated(): AppException {
    return new AppException(
      ErrorCode.UNAUTHENTICATED,
      HttpStatus.UNAUTHORIZED,
      'Authentication is required for this endpoint.',
    );
  }

  static tokenExpired(): AppException {
    return new AppException(
      ErrorCode.TOKEN_EXPIRED,
      HttpStatus.UNAUTHORIZED,
      'The access token has expired. Refresh it and retry.',
    );
  }

  static tokenInvalid(): AppException {
    return new AppException(
      ErrorCode.TOKEN_INVALID,
      HttpStatus.UNAUTHORIZED,
      'The access token is invalid.',
    );
  }

  static refreshTokenInvalid(): AppException {
    return new AppException(
      ErrorCode.REFRESH_TOKEN_INVALID,
      HttpStatus.UNAUTHORIZED,
      'The refresh token is invalid, expired or already used.',
    );
  }

  static refreshTokenReused(): AppException {
    return new AppException(
      ErrorCode.REFRESH_TOKEN_REUSED,
      HttpStatus.UNAUTHORIZED,
      'This session has been terminated. Sign in again.',
    );
  }

  static emailNotVerified(): AppException {
    return new AppException(
      ErrorCode.EMAIL_NOT_VERIFIED,
      HttpStatus.FORBIDDEN,
      'Verify your email address before signing in.',
    );
  }

  static accountDisabled(): AppException {
    return new AppException(
      ErrorCode.ACCOUNT_DISABLED,
      HttpStatus.FORBIDDEN,
      'This account has been deactivated.',
    );
  }

  static forbidden(): AppException {
    return new AppException(
      ErrorCode.FORBIDDEN,
      HttpStatus.FORBIDDEN,
      'You do not have permission to perform this action.',
    );
  }

  static duplicateEmail(): AppException {
    return new AppException(
      ErrorCode.DUPLICATE_EMAIL,
      HttpStatus.CONFLICT,
      'An account with this email address already exists.',
    );
  }

  static rateLimited(): AppException {
    return new AppException(
      ErrorCode.RATE_LIMIT_EXCEEDED,
      HttpStatus.TOO_MANY_REQUESTS,
      'Too many requests. Try again later.',
    );
  }

  // --- Cart -----------------------------------------------------------------

  static cartItemNotFound(): AppException {
    return new AppException(
      ErrorCode.CART_ITEM_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'That product is not in your cart.',
    );
  }

  /**
   * `details` carries the SKU and what is actually available, so a client can
   * say "only 3 left" without a second request. The SKU is public catalogue
   * data, not an internal identifier.
   */
  static outOfStock(sku: string, available: number): AppException {
    return new AppException(
      ErrorCode.OUT_OF_STOCK,
      HttpStatus.CONFLICT,
      'This product is out of stock.',
      [
        {
          field: 'quantity',
          message: `${sku} has ${String(available)} available`,
          code: 'OUT_OF_STOCK',
        },
      ],
    );
  }

  static productUnavailable(): AppException {
    return new AppException(
      ErrorCode.PRODUCT_UNAVAILABLE,
      HttpStatus.CONFLICT,
      'This product is no longer available.',
    );
  }

  // --- Checkout & orders ----------------------------------------------------

  /**
   * The header is required, so its absence is a 400 rather than a silent
   * best-effort placement. Naming the header in the message is safe: it is
   * published in the OpenAPI document.
   */
  static missingIdempotencyKey(): AppException {
    return new AppException(
      ErrorCode.MISSING_IDEMPOTENCY_KEY,
      HttpStatus.BAD_REQUEST,
      'The Idempotency-Key header is required when placing an order.',
      [
        {
          field: 'Idempotency-Key',
          message: 'Send a UUID that is unique to this checkout attempt and stable across retries',
          code: 'REQUIRED',
        },
      ],
    );
  }

  /**
   * ONE response for "this key was used for a different request" and for "this
   * key belongs to another account".
   *
   * Splitting them would turn the header into an existence oracle for other
   * users' keys. Neither variant reveals anything about the original request.
   */
  static idempotencyKeyReused(): AppException {
    return new AppException(
      ErrorCode.IDEMPOTENCY_KEY_REUSED,
      HttpStatus.CONFLICT,
      'This Idempotency-Key has already been used for a different request. Use a new key.',
      [
        {
          field: 'Idempotency-Key',
          message: 'A key may be replayed only with an identical request body',
          code: 'IDEMPOTENCY_KEY_REUSED',
        },
      ],
    );
  }

  /** Retrying is safe and is the intended client response. */
  static concurrentModification(): AppException {
    return new AppException(
      ErrorCode.CONCURRENT_MODIFICATION,
      HttpStatus.CONFLICT,
      'This request conflicted with another that was running at the same time. Try again.',
    );
  }

  static cartEmpty(): AppException {
    return new AppException(
      ErrorCode.CART_EMPTY,
      HttpStatus.UNPROCESSABLE_ENTITY,
      'Your cart is empty.',
    );
  }

  /**
   * A server-side invariant failed. Carries NO detail by design: the detail is
   * logged against the requestId, which is the only bridge a client needs.
   */
  static internal(): AppException {
    return new AppException(
      ErrorCode.INTERNAL_ERROR,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'An unexpected error occurred.',
    );
  }

  /**
   * The rate table has no row for a governorate in use.
   *
   * Deliberately indistinguishable from any other internal fault to the client:
   * a customer can do nothing about it, and naming the governorate would tell an
   * unauthenticated caller which parts of the table are incomplete.
   */
  static shippingRateMissing(): AppException {
    return new AppException(
      ErrorCode.SHIPPING_RATE_MISSING,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'An unexpected error occurred.',
    );
  }

  /**
   * The subject of an authenticated request no longer exists.
   *
   * 404 rather than 401: the token is genuine and correctly signed, so telling
   * the caller they are unauthenticated would send them to sign in again with
   * credentials that are also gone. Reachable with a perfectly valid token —
   * access tokens live 15 minutes and are not revocable, so an account
   * soft-deleted a minute ago still presents one.
   */
  static resourceNotFound(): AppException {
    return new AppException(
      ErrorCode.RESOURCE_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'The requested resource was not found.',
    );
  }

  static orderNotFound(): AppException {
    return new AppException(
      ErrorCode.ORDER_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'The requested order was not found.',
    );
  }

  /**
   * A staff lifecycle operation the matrix forbids from the current status.
   *
   * Both statuses are echoed in `details`: the caller is authorised to read the
   * whole order, so neither discloses anything, and it lets an admin UI
   * re-render without a second request.
   */
  static invalidStateTransition(from: string, to: string): AppException {
    return new AppException(
      ErrorCode.INVALID_STATE_TRANSITION,
      HttpStatus.CONFLICT,
      'This order cannot move to that status from its current one.',
      [
        {
          field: 'status',
          message: `The order is ${from}; it cannot become ${to}.`,
          code: 'INVALID_STATE_TRANSITION',
        },
      ],
    );
  }

  /**
   * The `-> CANCELLED` edge is not available from the order's current status.
   *
   * `currentStatus` is echoed in `details` so the client can correct its view
   * immediately — it is the caller's own order, which they had to be able to
   * read to attempt this, so nothing is disclosed. Repeating a cancellation
   * lands here too: `CANCELLED` is terminal and has no outgoing edges.
   */
  static orderNotCancellable(currentStatus: string): AppException {
    return new AppException(
      ErrorCode.ORDER_NOT_CANCELLABLE,
      HttpStatus.CONFLICT,
      'This order can no longer be cancelled.',
      [
        {
          field: 'status',
          message: `The order is ${currentStatus}. Cancellation is only possible before dispatch.`,
          code: 'ORDER_NOT_CANCELLABLE',
        },
      ],
    );
  }

  // --- Addresses ------------------------------------------------------------

  /**
   * ONE response for "no such address", for "that address is somebody else's"
   * and for an address id supplied to checkout that fails either test.
   *
   * The message names nothing — no id, no owner, no count. An attacker holding
   * a stolen address id learns exactly what a customer typing a random id
   * learns, which is nothing.
   */
  static addressNotFound(): AppException {
    return new AppException(
      ErrorCode.ADDRESS_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'The requested address was not found.',
    );
  }

  /**
   * The address book is full. `details` names the cap so a client can say
   * "delete one first" without hard-coding the number.
   */
  static addressLimitReached(maximum: number): AppException {
    return new AppException(
      ErrorCode.ADDRESS_LIMIT_REACHED,
      HttpStatus.UNPROCESSABLE_ENTITY,
      'You have reached the maximum number of saved addresses.',
      [
        {
          field: 'addresses',
          message: `At most ${String(maximum)} saved addresses are allowed. Delete one first.`,
          code: 'MAX',
        },
      ],
    );
  }

  // --- Catalogue ------------------------------------------------------------

  static productNotFound(): AppException {
    return new AppException(
      ErrorCode.PRODUCT_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'The requested product was not found.',
    );
  }

  static categoryNotFound(): AppException {
    return new AppException(
      ErrorCode.CATEGORY_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'The requested category was not found.',
    );
  }

  /**
   * Refusing a staff write against a soft-deleted product.
   *
   * The message names the remedy, because "restore it first" is the entire
   * content of the refusal and an operator who is not told it will assume the
   * product is broken.
   */
  static productDeleted(): AppException {
    return new AppException(
      ErrorCode.PRODUCT_DELETED,
      HttpStatus.CONFLICT,
      'That product is deleted. Restore it before editing or publishing it.',
    );
  }

  static brandNotFound(): AppException {
    return new AppException(
      ErrorCode.BRAND_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'The requested brand was not found.',
    );
  }

  /**
   * A SKU that another product already holds.
   *
   * 409 rather than 400: the field is perfectly well formed and it is the state
   * of the catalogue that refuses it. `details` binds to the `sku` field so the
   * form marks the right box — the whole reason this is not one shared
   * `DUPLICATE` code with `slug`.
   *
   * The colliding product is NOT named. An admin is authorised to see it, but
   * the message is generated from a caller-supplied value and naming the other
   * document here would put catalogue content into an error string for no gain:
   * the operator's next action is to change the SKU either way.
   */
  static duplicateSku(sku: string): AppException {
    return new AppException(ErrorCode.DUPLICATE_SKU, HttpStatus.CONFLICT, 'That SKU is already in use.', [
      { field: 'sku', message: `Another product already uses the SKU ${sku}.`, code: ErrorCode.DUPLICATE_SKU },
    ]);
  }

  /**
   * A slug another entity of the same type already holds.
   *
   * Reached in two ways, and both matter. A create or rename that races another
   * operator lands here from the unique index; a create whose slug was checked
   * a minute ago by `GET /admin/catalog/slug-availability` and taken since lands
   * here too. The availability check is advice, never a reservation — the index
   * is the authority, and this is what it says.
   *
   * A soft-deleted entity still holds its slug (CATALOG-MODEL.md §9), so this
   * also fires for a slug whose only holder is invisible. That is deliberate:
   * reusing it would silently repoint every existing link.
   */
  static duplicateSlug(slug: string): AppException {
    return new AppException(ErrorCode.DUPLICATE_SLUG, HttpStatus.CONFLICT, 'That slug is already in use.', [
      {
        field: 'slug',
        message:
          `The slug ${slug} is already taken — including by a deleted entity, which still holds ` +
          'its slug so existing links keep pointing at the right thing.',
        code: ErrorCode.DUPLICATE_SLUG,
      },
    ]);
  }

  static categoryDeleted(): AppException {
    return new AppException(
      ErrorCode.CATEGORY_DELETED,
      HttpStatus.CONFLICT,
      'That category is deleted. Restore it before editing it.',
    );
  }

  static brandDeleted(): AppException {
    return new AppException(
      ErrorCode.BRAND_DELETED,
      HttpStatus.CONFLICT,
      'That brand is deleted. Restore it before editing it.',
    );
  }

  /**
   * Refusing to delete a category something still points at.
   *
   * The counts are in the message because they turn a refusal into a work
   * list — "move 12 products and delete 2 subcategories" is actionable, "cannot
   * delete" is not. Both numbers are catalogue facts an admin is already
   * entitled to see.
   */
  static categoryNotEmpty(products: number, children: number): AppException {
    const parts: string[] = [];

    if (products > 0) parts.push(`${String(products)} product(s)`);
    if (children > 0) parts.push(`${String(children)} subcategor${children === 1 ? 'y' : 'ies'}`);

    return new AppException(
      ErrorCode.CATEGORY_NOT_EMPTY,
      HttpStatus.CONFLICT,
      'That category still has things in it and was not deleted.',
      [
        {
          field: 'id',
          message:
            `${parts.join(' and ')} still belong to this category. Move or delete them first — ` +
            'deleting it now would leave them filed somewhere that renders nowhere.',
          code: ErrorCode.CATEGORY_NOT_EMPTY,
        },
      ],
    );
  }

  static productImageLimit(maximum: number): AppException {
    return new AppException(
      ErrorCode.PRODUCT_IMAGE_LIMIT,
      HttpStatus.CONFLICT,
      'That product already has the maximum number of images.',
      [
        {
          field: 'publicId',
          message: `A product may carry at most ${String(maximum)} images. Remove one first.`,
          code: ErrorCode.PRODUCT_IMAGE_LIMIT,
        },
      ],
    );
  }

  static productImageAlreadyAttached(): AppException {
    return new AppException(
      ErrorCode.PRODUCT_IMAGE_ALREADY_ATTACHED,
      HttpStatus.CONFLICT,
      'That image is already on this product.',
      [
        {
          field: 'publicId',
          message:
            'The image is already attached. Attaching it twice would put the reference count ' +
            'out of step with reality, in one direction or the other.',
          code: ErrorCode.PRODUCT_IMAGE_ALREADY_ATTACHED,
        },
      ],
    );
  }

  static productImageNotFound(): AppException {
    return new AppException(
      ErrorCode.PRODUCT_IMAGE_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'That product does not have an image with that identifier.',
    );
  }

  /**
   * Refusing a hard delete of a product an order refers to.
   *
   * The count is included because it is the difference between "use soft
   * delete" and "this looks like a bug" — an operator who is told 3 orders
   * reference the product knows immediately why the answer is no.
   */
  static productHasOrders(orderCount: number): AppException {
    return new AppException(
      ErrorCode.PRODUCT_HAS_ORDERS,
      HttpStatus.CONFLICT,
      'That product has been ordered and cannot be permanently deleted.',
      [
        {
          field: 'id',
          message:
            `${String(orderCount)} order(s) reference this product. Permanently deleting it ` +
            'would leave those lines pointing at nothing, which analytics and the reorder ' +
            'button both follow. Use a soft delete instead — it is what soft delete is for.',
          code: ErrorCode.PRODUCT_HAS_ORDERS,
        },
      ],
    );
  }

  // --- Inventory ------------------------------------------------------------

  /**
   * Refusing a negative adjustment that would take the balance below zero.
   *
   * Both numbers are in the message because the operator's next action is to
   * post the difference they actually counted, and they cannot work it out from
   * a refusal that says only "not enough".
   */
  static insufficientStockForAdjustment(available: number, delta: number): AppException {
    return new AppException(
      ErrorCode.INSUFFICIENT_STOCK_FOR_ADJUSTMENT,
      HttpStatus.CONFLICT,
      'That adjustment would take stock below zero.',
      [
        {
          field: 'delta',
          message:
            `There are ${String(available)} in stock and the adjustment removes ` +
            `${String(Math.abs(delta))}. Stock cannot go negative.`,
          code: ErrorCode.INSUFFICIENT_STOCK_FOR_ADJUSTMENT,
        },
      ],
    );
  }

  // --- Media ----------------------------------------------------------------

  /**
   * The uploaded file failed a validation rule.
   *
   * `reason` is deliberately specific and deliberately safe to show an
   * operator: every one of these is a mistake a person can correct, and a
   * generic "invalid file" would send them guessing. Nothing in it is derived
   * from the file's own contents, so a crafted filename or EXIF field cannot
   * reach a response through here.
   */
  static invalidUpload(reason: string): AppException {
    return new AppException(
      ErrorCode.INVALID_UPLOAD,
      HttpStatus.BAD_REQUEST,
      'The uploaded file was rejected.',
      [{ field: 'file', message: reason, code: ErrorCode.INVALID_UPLOAD }],
    );
  }

  static mediaAssetNotFound(): AppException {
    return new AppException(
      ErrorCode.MEDIA_ASSET_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'No managed media asset with that identifier.',
    );
  }

  /**
   * Refusing to destroy an asset something still points at.
   *
   * The count is included because it turns a refusal into an instruction:
   * detach it from that many documents, then try again. Legacy destroyed the
   * object regardless and let the other product discover it later (MEDIA-MODEL
   * §9.1).
   */
  static mediaAssetInUse(refCount: number): AppException {
    return new AppException(
      ErrorCode.MEDIA_ASSET_IN_USE,
      HttpStatus.CONFLICT,
      'That image is still in use and was not deleted.',
      [
        {
          field: 'publicId',
          message:
            `${String(refCount)} document(s) still reference this image. Remove it from them ` +
            'first; deleting it now would break every page that shows it.',
          code: ErrorCode.MEDIA_ASSET_IN_USE,
        },
      ],
    );
  }
}
