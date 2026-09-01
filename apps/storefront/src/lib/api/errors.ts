/**
 * The ONE place an API failure becomes something the UI can branch on.
 *
 * The NestJS API answers every failure with the same envelope
 * (`API-STANDARDS.md` §1):
 *
 *   { "error": { code, message, details?, requestId, timestamp } }
 *
 * `code` is a stable enum and is the thing to switch on. `message` is
 * human-facing and may change between releases — never parse it, and never
 * branch on it.
 *
 * Everything here is derived from the served OpenAPI document, not guessed:
 * `ErrorBodyDto.code` enumerates exactly these values.
 */

/** Every `error.code` the API can return, straight from the served contract. */
export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'REFRESH_TOKEN_INVALID'
  | 'REFRESH_TOKEN_REUSED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_DISABLED'
  | 'VALIDATION_ERROR'
  | 'MALFORMED_REQUEST'
  | 'UNKNOWN_FIELD'
  | 'UNSUPPORTED_SORT'
  | 'MISSING_IDEMPOTENCY_KEY'
  | 'RESOURCE_NOT_FOUND'
  | 'PRODUCT_NOT_FOUND'
  | 'CATEGORY_NOT_FOUND'
  | 'BRAND_NOT_FOUND'
  | 'CART_ITEM_NOT_FOUND'
  | 'ORDER_NOT_FOUND'
  | 'ADDRESS_NOT_FOUND'
  | 'DUPLICATE_EMAIL'
  | 'OUT_OF_STOCK'
  | 'PRODUCT_UNAVAILABLE'
  | 'CONCURRENT_MODIFICATION'
  | 'ORDER_NOT_CANCELLABLE'
  | 'INVALID_STATE_TRANSITION'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'CART_EMPTY'
  | 'ADDRESS_LIMIT_REACHED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'TRANSACTION_FAILED';

/** One field-level problem, for binding a message to a form input. */
export interface ApiFieldError {
  readonly field: string;
  readonly message: string;
  readonly code: string | null;
}

/**
 * The coarse categories a SCREEN cares about.
 *
 * A page should branch on this, not on 34 codes: "did the form fail", "am I
 * signed out", "is it gone", "did the world change under me", "is it us", "is
 * it the network". The precise `code` stays available for the cases that
 * genuinely need it — `OUT_OF_STOCK` reads differently from
 * `IDEMPOTENCY_KEY_REUSED` even though both are conflicts.
 */
export type ApiErrorKind =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'server'
  | 'network';

/**
 * A failed API call, as one throwable value.
 *
 * Carries the stable code, the coarse kind, the field errors and the
 * `requestId` — quote that in a bug report and the server-side cause is
 * findable directly, which is the whole reason the API echoes it.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly code: ApiErrorCode | 'NETWORK_ERROR';
  readonly status: number;
  readonly details: readonly ApiFieldError[];
  readonly requestId: string | null;

  constructor(init: {
    kind: ApiErrorKind;
    code: ApiErrorCode | 'NETWORK_ERROR';
    status: number;
    message: string;
    details?: readonly ApiFieldError[];
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.code = init.code;
    this.status = init.status;
    this.details = init.details ?? [];
    this.requestId = init.requestId ?? null;
  }

  /** The message for a specific form field, if the server named one. */
  fieldError(field: string): string | null {
    return this.details.find((d) => d.field === field)?.message ?? null;
  }

  /** True when re-sending the SAME request could plausibly succeed. */
  get isRetryable(): boolean {
    return (
      this.kind === 'network' ||
      this.code === 'CONCURRENT_MODIFICATION' ||
      this.code === 'SERVICE_UNAVAILABLE' ||
      this.code === 'TRANSACTION_FAILED'
    );
  }
}

/** Status -> coarse kind. The code refines it where the status is ambiguous. */
function kindFor(status: number, code: ApiErrorCode): ApiErrorKind {
  if (code === 'RATE_LIMIT_EXCEEDED') return 'rate_limited';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'conflict';
  if (status === 400) return 'validation';
  if (status >= 500) return 'server';
  return 'server';
}

/** Builds an ApiError from a non-2xx response body. */
export function toApiError(status: number, body: unknown): ApiError {
  const envelope = (body ?? {}) as {
    error?: {
      code?: ApiErrorCode;
      message?: string;
      details?: ApiFieldError[];
      requestId?: string;
    };
  };
  const err = envelope.error;

  // A non-2xx that is NOT the documented envelope means something upstream of
  // the application answered — a proxy, a gateway, an HTML error page. Treat it
  // as a server failure rather than pretending to know a code.
  if (!err?.code) {
    return new ApiError({
      kind: status >= 500 ? 'server' : 'network',
      code: 'INTERNAL_ERROR',
      status,
      message: 'The server returned an unexpected response.',
    });
  }

  return new ApiError({
    kind: kindFor(status, err.code),
    code: err.code,
    status,
    message: err.message ?? 'The request failed.',
    details: err.details ?? [],
    requestId: err.requestId ?? null,
  });
}

/** A transport failure: the request never produced an HTTP response at all. */
export function toNetworkError(cause: unknown): ApiError {
  return new ApiError({
    kind: 'network',
    code: 'NETWORK_ERROR',
    status: 0,
    message:
      cause instanceof Error && cause.message
        ? `Could not reach the server (${cause.message}).`
        : 'Could not reach the server.',
  });
}

/**
 * A message safe to show a customer, per category.
 *
 * The server's own `message` is already customer-safe (`AppException` decides
 * that at construction), so it is preferred; this is the fallback for the
 * cases where a category deserves standard wording.
 */
export function customerMessage(error: ApiError): string {
  switch (error.kind) {
    case 'network':
      return 'We could not reach the server. Check your connection and try again.';
    case 'unauthenticated':
      return 'Please sign in to continue.';
    case 'server':
      return 'Something went wrong on our side. Please try again in a moment.';
    /**
     * F-11 — for a validation failure the useful sentence is in `details`, not
     * in `message`.
     *
     * A validation envelope's top-level `message` is the CATEGORY ("Validation
     * failed."); the specific, actionable reason is the field error the server
     * took the trouble to name. A replayed or expired verification link is the
     * case that made this visible: the API answers
     * `details: [{ field: 'token', message: 'verification token is invalid or
     * has expired' }]`, and the customer was shown "Validation failed." — a
     * sentence that tells them nothing and hides the one fact that would have
     * told them to click "resend".
     *
     * The FIRST detail is used deliberately. A screen that needs every field
     * error already has `fieldError(field)` and renders them beside their
     * inputs; this function's job is the single summary line, and for the
     * single-detail failures it is used on (token, and one-field forms) the
     * first detail is the whole story. Falls back to `message` when the server
     * sent no details, so nothing can render an empty error.
     */
    case 'validation':
      return error.details[0]?.message ?? error.message;
    default:
      return error.message;
  }
}
