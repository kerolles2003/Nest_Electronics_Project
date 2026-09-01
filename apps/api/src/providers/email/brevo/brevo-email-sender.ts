import { Inject, Injectable, Logger } from '@nestjs/common';
import { emailConfig, type EmailConfig } from '../../../config/email.config';
import {
  EmailSenderPort,
  type EmailSendResult,
  type OutboundEmail,
} from '../../../modules/notifications/application/ports/email-sender.port';
import { brevoConfig, type BrevoConfig } from './brevo.config';
import { BREVO_SEND_URL, toBrevoPayload, toDeliveryError, toTransportError } from './brevo.mapper';

/**
 * Request timeout.
 *
 * Deliberately BELOW `NotificationsService`'s 10s cap, so a slow provider
 * surfaces as this adapter's specific transport error rather than the
 * service's generic "exceeded 10000ms" — and so the socket is released by the
 * layer that opened it instead of being abandoned.
 */
const REQUEST_TIMEOUT_MS = 8_000;

/** Shape of a Brevo success body — `messageId` is optional in the vendor's own types. */
interface BrevoSendResponse {
  messageId?: string;
  messageIds?: string[];
}

/**
 * The Brevo transport.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §3, §5, §5.7.
 *
 * ## What adding this file proved
 *
 * §5.7 claims a new provider costs one adapter, one config namespace, one enum
 * member and one branch — with **zero files changed under `modules/`**. This
 * directory plus three lines elsewhere is the whole change. No business
 * service, no template, no test of the notification boundary was touched.
 *
 * ## No SDK
 *
 * `@getbrevo/brevo` is 5.6 MB for forty-odd resources; this uses one endpoint.
 * The wire contract was read from that package's generated types rather than
 * from memory — see the header of `brevo.mapper.ts` for the provenance and for
 * how to re-verify it.
 *
 * ## Two things this adapter must get right
 *
 * **Brevo signals failure by HTTP status, not by a result object.** Unlike
 * Resend, which resolves `{ data, error }`, a failure here is a non-2xx
 * response whose body may or may not carry a `code`. So the status is checked
 * explicitly and consulted first.
 *
 * **The vendor's error shape stops here.** Every failure leaves as one of the
 * module's four `EmailDeliveryError` subclasses, so `NotificationsService`
 * grades it without knowing which vendor is installed.
 */
@Injectable()
export class BrevoEmailSender extends EmailSenderPort {
  private readonly logger = new Logger('EmailSender:brevo');

  constructor(
    @Inject(brevoConfig.KEY) private readonly vendor: BrevoConfig,
    @Inject(emailConfig.KEY) private readonly email: EmailConfig,
  ) {
    super();

    if (this.vendor.apiKey.length === 0) {
      // Unreachable through ProvidersModule — the env schema makes the key
      // mandatory whenever this adapter is selected. Constructing without one
      // means something bypassed the composition root, and failing here beats
      // sending unauthenticated requests for the lifetime of the process.
      throw new Error('BrevoEmailSender constructed without BREVO_API_KEY');
    }

    this.logger.log(`brevo transport ready  from=${this.email.fromAddress}`);
  }

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    const payload = toBrevoPayload(message, {
      fromAddress: this.email.fromAddress,
      fromName: this.email.fromName,
      replyTo: this.email.replyTo,
    });

    let response: Response;

    try {
      response = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          // Verified from the SDK's `HeaderAuthProvider`: the header is
          // `api-key`, not `Authorization: Bearer`.
          'api-key': this.vendor.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        // Releases the socket rather than inheriting Node's default of waiting
        // effectively forever.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      // Socket, DNS, or the abort above — the request reached no verdict.
      throw toTransportError(cause);
    }

    const body = await BrevoEmailSender.readJson(response);

    if (!response.ok) {
      throw toDeliveryError(response.status, body as { code?: string; message?: string });
    }

    const success = body as BrevoSendResponse;
    // `messageId` is optional in the vendor's types and `messageIds` is
    // returned for batch sends. Falling back keeps the id useful for support
    // correlation; the empty string is a last resort that is honest about
    // having nothing rather than inventing an id.
    const providerMessageId = success.messageId ?? success.messageIds?.[0] ?? '';

    return {
      providerMessageId,
      // When WE observed acceptance. Named `acceptedAt` rather than `sentAt`
      // because delivery happens later and is reported, if at all, by webhook.
      acceptedAt: new Date(),
    };
  }

  /**
   * Parses a JSON body without letting a malformed one mask the real failure.
   *
   * An error response with an HTML body — a gateway page, say — would
   * otherwise throw inside `.json()` and be reported as a parse failure rather
   * than as the 502 it actually is.
   */
  private static async readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      return {};
    }
  }
}
