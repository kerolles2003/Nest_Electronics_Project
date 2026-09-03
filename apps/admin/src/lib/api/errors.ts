/**
 * The API's error envelope, as a typed error this console can act on.
 *
 * Authority: `docs/architecture/API-STANDARDS.md` §1.
 *
 * The point of a `kind` is that the console branches on a CLASSIFICATION rather
 * than on a status number or a message string. An operator who sees "Invalid
 * state transition" needs a different next step from one whose session expired,
 * and neither should be decided by matching English.
 */

export type ApiErrorKind =
  /** No credential, or one the API rejected. Sign in again. */
  | 'unauthenticated'
  /** Authenticated, but not permitted. The role is wrong. */
  | 'forbidden'
  /** The thing is not there. */
  | 'not-found'
  /** The request was malformed or failed validation. */
  | 'validation'
  /** The order is not in a state this operation can move it from. NOT retryable. */
  | 'conflict'
  /** Too many requests. */
  | 'throttled'
  /** The API answered, but with a failure of its own. */
  | 'server'
  /** No response at all — the API is down, DNS failed, connection refused. */
  | 'network';

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: readonly FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface WireError {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

function kindFor(status: number, code: string): ApiErrorKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'throttled';
  if (status === 400 || status === 422) return 'validation';
  if (status >= 500) return 'server';

  // A status this console has no rule for. Treated as a server failure rather
  // than as success, because the alternative is rendering a page from a body
  // that is an error envelope.
  return code === '' ? 'server' : 'server';
}

function fieldErrors(details: unknown): FieldError[] {
  if (!Array.isArray(details)) return [];

  return details.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];

    const { field, message } = entry as { field?: unknown; message?: unknown };

    return typeof field === 'string' && typeof message === 'string'
      ? [{ field, message }]
      : [];
  });
}

export function toApiError(status: number, body: unknown): ApiError {
  const envelope = (body ?? {}) as WireError;
  const code = envelope.error?.code ?? 'UNKNOWN';
  const message = envelope.error?.message ?? 'The request failed.';

  return new ApiError(kindFor(status, code), status, code, message, fieldErrors(envelope.error?.details));
}

/**
 * A failure with no response at all.
 *
 * Kept distinct from a 5xx on purpose: "the API said it broke" and "the API
 * said nothing" need different words in front of an operator, and only the
 * second is worth retrying immediately.
 */
export function toNetworkError(cause: unknown): ApiError {
  return new ApiError(
    'network',
    0,
    'NETWORK_ERROR',
    cause instanceof Error ? cause.message : 'The API could not be reached.',
  );
}

/**
 * What to put in front of an OPERATOR.
 *
 * Deliberately different from the storefront's customer-facing wording. An
 * operator is a colleague with context: they can be told that a transition was
 * refused because the order moved, and they can be told to reload. Softening
 * that into "something went wrong" would remove the only information that makes
 * the message actionable.
 */
export function operatorMessage(error: ApiError): string {
  switch (error.kind) {
    case 'unauthenticated':
      return 'Your session has expired. Sign in again.';
    case 'forbidden':
      return 'Your account does not have permission to do that.';
    case 'not-found':
      return 'That order no longer exists.';
    case 'conflict':
      // The API's own message names the current status and the requested one,
      // which is exactly what the operator needs to decide what to do next.
      return `${error.message} Reload the order to see its current state.`;
    case 'throttled':
      return 'Too many requests. Wait a moment and try again.';
    case 'validation':
      return error.message;
    case 'network':
      return 'The API could not be reached. Nothing was changed.';
    case 'server':
      return 'The API failed to process that. Nothing was changed.';
  }
}
