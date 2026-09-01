import type { CreateEmailOptions } from 'resend';
import {
  EmailConfigurationError,
  EmailDeliveryError,
  EmailRateLimitError,
  EmailRecipientError,
  EmailTransportError,
} from '../../../modules/notifications/application/ports/email-errors';
import type { OutboundEmail } from '../../../modules/notifications/application/ports/email-sender.port';

/**
 * Translation between application vocabulary and Resend's.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §3, §5.4.
 *
 * Pure functions, no I/O, no Nest decorators — which is what makes the mapping
 * table testable without a network, an API key, or a running application. The
 * adapter beside this file does the talking; this file does the translating.
 */

/** `Name <address@example.com>` when a display name exists, else the bare address. */
function formatRecipient(recipient: { email: string; name?: string }): string {
  return recipient.name === undefined || recipient.name.trim().length === 0
    ? recipient.email
    : `${recipient.name} <${recipient.email}>`;
}

/**
 * Builds the vendor payload.
 *
 * `from` and the default `replyTo` are supplied by the ADAPTER from
 * configuration and are not part of `OutboundEmail` (§5.2), so no business
 * caller is able to send from the wrong address — the field does not exist for
 * it to set.
 *
 * `tags` are mapped to Resend's `{ name, value }` pairs. Resend restricts tag
 * characters to ASCII letters, digits, underscores and dashes, so values are
 * sanitised here rather than trusted: a tag is diagnostic metadata, and a
 * rejected tag must never be the reason an order confirmation fails to send.
 */
export function toResendPayload(
  message: OutboundEmail,
  identity: { fromAddress: string; fromName: string; replyTo: string | null },
): CreateEmailOptions {
  const replyTo = message.replyTo ?? identity.replyTo;

  return {
    from: `${identity.fromName} <${identity.fromAddress}>`,
    to: message.to.map(formatRecipient),
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(replyTo === null ? {} : { replyTo }),
    ...(message.tags === undefined
      ? {}
      : {
          tags: Object.entries(message.tags).map(([name, value]) => ({
            name: sanitiseTag(name),
            value: sanitiseTag(value),
          })),
        }),
  };
}

function sanitiseTag(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
}

/**
 * Resend's error codes → the module's four operational categories.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §5.4.
 *
 * The categories answer one question — "should anyone try this again, and
 * whose problem is it?" — so codes are grouped by that answer rather than by
 * the vendor's own taxonomy:
 *
 *   configuration  our credentials or our sender identity are wrong. Fails
 *                  EVERY send, needs a human, and no retry will help.
 *   recipient      this address is bad. Permanent for this message only.
 *   rate limit     we are going too fast, or the plan's quota is spent.
 *   transport      everything else, including anything unrecognised — a code
 *                  this table has not seen is treated as weather rather than
 *                  as a permanent verdict, because assuming "unknown means
 *                  never retry" silently discards mail.
 */
const CONFIGURATION_CODES: ReadonlySet<string> = new Set([
  'missing_api_key',
  'invalid_api_key',
  'restricted_api_key',
  'invalid_access',
  'validation_error',
  'invalid_from_address',
  'invalid_region',
  'security_error',
  'method_not_allowed',
  'not_found',
]);

const RECIPIENT_CODES: ReadonlySet<string> = new Set([
  'invalid_parameter',
  'missing_required_field',
  'invalid_attachment',
]);

const RATE_LIMIT_CODES: ReadonlySet<string> = new Set([
  'rate_limit_exceeded',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
  'concurrent_idempotent_requests',
]);

/**
 * Converts a returned `ErrorResponse` into a module-owned error.
 *
 * Note that Resend RETURNS errors rather than throwing them — `send` resolves
 * with `{ data: null, error }`. An adapter that only wrapped the call in
 * try/catch would treat every API rejection as a success and report a
 * `providerMessageId` of `undefined`. This is exactly the vendor-specific
 * behaviour that must not leak past this directory.
 */
export function toDeliveryError(error: {
  name: string;
  message: string;
  statusCode: number | null;
}): EmailDeliveryError {
  const detail = `${error.name}: ${error.message}`;

  if (CONFIGURATION_CODES.has(error.name)) {
    return new EmailConfigurationError(detail);
  }

  if (RECIPIENT_CODES.has(error.name)) {
    return new EmailRecipientError(detail);
  }

  if (RATE_LIMIT_CODES.has(error.name)) {
    return new EmailRateLimitError(detail);
  }

  // A 4xx that is not in any table above is far more likely to be a request
  // defect than a transient fault, but it is still not safe to classify
  // blindly — so it is transport, and the status code travels in the message
  // for whoever reads the log.
  return new EmailTransportError(
    error.statusCode === null ? detail : `${detail} (HTTP ${String(error.statusCode)})`,
  );
}

/**
 * Converts a THROWN exception — a socket failure, a DNS failure, an abort.
 *
 * Always transport: the request never reached a verdict, so nothing about the
 * message itself has been judged.
 */
export function toTransportError(cause: unknown): EmailTransportError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new EmailTransportError(`request to email provider failed: ${reason}`, { cause });
}
