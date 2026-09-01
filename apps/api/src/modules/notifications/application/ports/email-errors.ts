/**
 * Module-owned email failures.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §5.4.
 *
 * Every adapter translates its vendor's failures into exactly these four. No
 * Resend exception type ever escapes `providers/email/resend/` — which is what
 * lets `NotificationsService` make a retry decision without knowing which
 * vendor is installed, and what makes the shared conformance suite meaningful.
 *
 * The taxonomy is deliberately four-wide, because those are the four
 * OPERATIONALLY DISTINCT cases:
 *
 *   transport      the provider is having a bad minute      → retry later
 *   rate limit     we are sending too fast                   → retry, backed off
 *   recipient      the address is wrong                      → never retry; the
 *                                                              customer must fix it
 *   configuration  our credentials or sender are wrong       → never retry; a
 *                                                              human must fix it,
 *                                                              and it affects EVERY
 *                                                              send, not this one
 */
export abstract class EmailDeliveryError extends Error {
  /**
   * Whether sending the same message again could plausibly succeed.
   *
   * Read by the caller to decide between "log and move on" and "log loudly" —
   * a non-retryable failure is a defect, not weather.
   */
  abstract readonly retryable: boolean;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Network failure, timeout, or a provider 5xx. Weather; try again later. */
export class EmailTransportError extends EmailDeliveryError {
  readonly retryable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** The provider throttled us. Retryable, but only with backoff. */
export class EmailRateLimitError extends EmailDeliveryError {
  readonly retryable = true;

  constructor(
    message: string,
    /** Seconds the provider asked us to wait, when it said. */
    readonly retryAfterSeconds: number | null = null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * The address was rejected as invalid or undeliverable.
 *
 * NOT retryable: the same address will be rejected identically forever. Retry
 * here would burn quota to reproduce a known answer.
 */
export class EmailRecipientError extends EmailDeliveryError {
  readonly retryable = false;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * Our own configuration is wrong — a bad API key, or a from-address the
 * provider will not authorise for this account.
 *
 * NOT retryable, and categorically more serious than the others: it fails
 * EVERY send, not this one, and no customer action can fix it. Callers log it
 * at `error` with an explicit operator-facing message.
 */
export class EmailConfigurationError extends EmailDeliveryError {
  readonly retryable = false;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
