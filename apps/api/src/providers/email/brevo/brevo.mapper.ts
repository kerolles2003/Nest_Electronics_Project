import {
  EmailConfigurationError,
  EmailDeliveryError,
  EmailRateLimitError,
  EmailRecipientError,
  EmailTransportError,
} from '../../../modules/notifications/application/ports/email-errors';
import type { OutboundEmail } from '../../../modules/notifications/application/ports/email-sender.port';

/**
 * Translation between application vocabulary and Brevo's.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §3, §5.4.
 *
 * ## Where this wire format came from
 *
 * Not from memory. Every field name, the base URL, the auth header and the
 * error-code list below were read out of `@getbrevo/brevo@6.0.3`'s own
 * generated type definitions (`SendTransacEmailRequest`,
 * `SendTransacEmailResponse`, `BadRequestErrorBody`, `environments.d.ts`) —
 * the vendor's published description of its own API. To re-verify after a
 * Brevo change, `npm pack @getbrevo/brevo` and read those four files again.
 *
 * ## Why the SDK is not a dependency
 *
 * That package is 5.6 MB and covers forty-odd resources — contacts,
 * campaigns, CRM, SMS, webhooks. This application uses exactly one endpoint,
 * `POST /v3/smtp/email`, and Node has `fetch` built in. Taking the dependency
 * would grow every deployed image by several megabytes to save the thirty
 * lines below, and it would save less than it appears: the error translation
 * to this module's four categories is hand-written either way.
 *
 * The trigger for reversing that decision is concrete — if the application
 * ever needs contacts, campaigns, webhook verification or SMS, take the SDK
 * rather than hand-rolling a second endpoint.
 */

/** Verified from `environments.d.ts`: `BrevoEnvironment.Default`. */
export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

/** Brevo caps display names at 70 characters. */
const MAX_NAME = 70;

/** A Brevo `{ email, name? }` party. */
interface BrevoParty {
  email: string;
  name?: string;
}

/** The subset of `SendTransacEmailRequest` this application sends. */
export interface BrevoSendPayload {
  sender: BrevoParty;
  to: BrevoParty[];
  subject: string;
  htmlContent: string;
  textContent: string;
  replyTo?: BrevoParty;
  tags?: string[];
  headers?: Record<string, string>;
}

function party(email: string, name?: string): BrevoParty {
  const trimmed = name?.trim() ?? '';

  // Truncated rather than sent long: Brevo rejects an over-length display
  // name, and losing the tail of somebody's name is strictly better than
  // losing their order confirmation.
  return trimmed.length === 0 ? { email } : { email, name: trimmed.slice(0, MAX_NAME) };
}

/**
 * Builds the vendor payload.
 *
 * `sender` comes from configuration via the adapter, never from
 * `OutboundEmail` — which has no `from` field, so no business caller can send
 * from the wrong address even deliberately (§5.2).
 *
 * Two shape differences from Resend worth noting, both absorbed here so that
 * nothing above the port changes:
 *
 *   tags     Brevo takes a flat `string[]`, not `{name, value}` pairs, so the
 *            application's key/value tags are flattened to `key:value`.
 *   headers  Brevo has no dedicated idempotency parameter. Its own type
 *            documentation gives `Idempotency-Key` as an example custom
 *            header, so the key is passed there — but that is BEST EFFORT and
 *            unverified, and this code does not depend on it. The real
 *            duplicate guard is upstream: both replay paths in `placeOrder`
 *            return before a send is ever attempted.
 */
export function toBrevoPayload(
  message: OutboundEmail,
  identity: { fromAddress: string; fromName: string; replyTo: string | null },
): BrevoSendPayload {
  const replyTo = message.replyTo ?? identity.replyTo;

  const payload: BrevoSendPayload = {
    sender: party(identity.fromAddress, identity.fromName),
    to: message.to.map((recipient) => party(recipient.email, recipient.name)),
    subject: message.subject,
    htmlContent: message.html,
    textContent: message.text,
  };

  if (replyTo !== null) {
    payload.replyTo = party(replyTo);
  }

  if (message.tags !== undefined) {
    payload.tags = Object.entries(message.tags).map(
      ([name, value]) => `${sanitiseTag(name)}:${sanitiseTag(value)}`,
    );
  }

  if (message.idempotencyKey !== undefined) {
    payload.headers = { 'Idempotency-Key': message.idempotencyKey };
  }

  return payload;
}

/** Brevo tolerates more than Resend, but a tag is diagnostic metadata and must never be why an email fails. */
function sanitiseTag(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128);
}

/**
 * Brevo's error codes → the module's four operational categories.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §5.4. Codes verified
 * against `BadRequestErrorBody.Code` in the published SDK types.
 *
 * Grouped by the operational question — "should anyone try again, and whose
 * problem is it?" — not by Brevo's own taxonomy, so the answers stay
 * comparable with the Resend adapter's.
 */
const CONFIGURATION_CODES: ReadonlySet<string> = new Set([
  'unauthorized',
  'permission_denied',
  'reseller_permission_denied',
  'account_under_validation',
  'method_not_allowed',
  'not_acceptable',
  'bad_request',
  'api-key not found',
  'Authentication failed',
  // Sender-identity problems. These fail EVERY send until DNS is fixed, which
  // is exactly why they are configuration rather than recipient errors — and
  // why they are the most likely first failure on a new deployment.
  'Domain does not exist',
  'DMARC policy requires domain authentication',
  'DNS records not properly configured',
]);

const RECIPIENT_CODES: ReadonlySet<string> = new Set([
  'invalid_parameter',
  'missing_parameter',
  'out_of_range',
  'unprocessable_entity',
  'Invalid parameters passed',
]);

const RATE_LIMIT_CODES: ReadonlySet<string> = new Set([
  'not_enough_credits',
  'Insufficient credits',
]);

/**
 * Converts a Brevo error body into a module-owned error.
 *
 * The HTTP status is consulted FIRST for the two cases where it is more
 * reliable than the code: 429 is always a rate limit, and any 5xx is always
 * transport. Brevo returns a `code` only on some failures — `ErrorModel.code`
 * is optional in its own types — so a status-led decision is what keeps an
 * unlabelled failure from being misread.
 */
export function toDeliveryError(
  status: number,
  body: { code?: string; message?: string },
): EmailDeliveryError {
  const code = body.code ?? '(no code)';
  const detail = `${code}: ${body.message ?? 'no message'} (HTTP ${String(status)})`;

  if (status === 429) {
    return new EmailRateLimitError(detail);
  }

  if (status >= 500) {
    return new EmailTransportError(detail);
  }

  if (status === 401 || status === 403) {
    return new EmailConfigurationError(detail);
  }

  if (body.code !== undefined) {
    if (CONFIGURATION_CODES.has(body.code)) {
      return new EmailConfigurationError(detail);
    }
    if (RECIPIENT_CODES.has(body.code)) {
      return new EmailRecipientError(detail);
    }
    if (RATE_LIMIT_CODES.has(body.code)) {
      return new EmailRateLimitError(detail);
    }
  }

  // Anything unrecognised — including `duplicate_request`, whose semantics
  // depend on an idempotency contract this code deliberately does not rely on
  // — is transport. Assuming "unknown means never retry" silently discards
  // mail the first time the vendor adds a code, and with no retry
  // infrastructure the only practical consequence of this choice is the log
  // level, which for something benign and rare should be `warn`.
  return new EmailTransportError(detail);
}

/** A thrown socket, DNS, abort or timeout failure. Always transport: no verdict was reached. */
export function toTransportError(cause: unknown): EmailTransportError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new EmailTransportError(`request to email provider failed: ${reason}`, { cause });
}
