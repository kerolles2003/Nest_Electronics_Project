import { Inject, Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { emailConfig, type EmailConfig } from '../../../config/email.config';
import {
  EmailSenderPort,
  type EmailSendResult,
  type OutboundEmail,
} from '../../../modules/notifications/application/ports/email-sender.port';
import { resendConfig, type ResendConfig } from './resend.config';
import { toDeliveryError, toResendPayload, toTransportError } from './resend.mapper';

/**
 * The Resend transport.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §3, §5.
 *
 * ## The only file in the application that imports the Resend SDK
 *
 * Together with `resend.mapper.ts` and `resend.config.ts`, this directory is
 * the entire footprint of the vendor. Grepping for `from 'resend'` outside it
 * must return nothing — that property, not a registry or a factory, is what
 * makes the provider replaceable.
 *
 * ## Two things this adapter must get right
 *
 * **Resend returns errors; it does not throw them.** `emails.send` resolves
 * with `{ data, error }`, so the naive `try { … } catch` adapter reports every
 * API rejection as a success with an `undefined` message id. Both branches are
 * therefore checked explicitly below.
 *
 * **The vendor's error shape stops here.** Every failure leaves as one of the
 * module's four `EmailDeliveryError` subclasses, so `NotificationsService` can
 * decide whether a failure is weather or a defect without knowing which vendor
 * is installed.
 */
@Injectable()
export class ResendEmailSender extends EmailSenderPort {
  private readonly logger = new Logger('EmailSender:resend');
  private readonly client: Resend;

  constructor(
    @Inject(resendConfig.KEY) private readonly vendor: ResendConfig,
    @Inject(emailConfig.KEY) private readonly email: EmailConfig,
  ) {
    super();

    if (this.vendor.apiKey.length === 0) {
      // Unreachable through ProvidersModule — the env schema makes the key
      // mandatory whenever this adapter is selected. Constructing without one
      // means something bypassed the composition root, and failing here beats
      // sending unauthenticated requests for the lifetime of the process.
      throw new Error('ResendEmailSender constructed without RESEND_API_KEY');
    }

    this.client = new Resend(this.vendor.apiKey);
    this.logger.log(`resend transport ready  from=${this.email.fromAddress}`);
  }

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    const payload = toResendPayload(message, {
      fromAddress: this.email.fromAddress,
      fromName: this.email.fromName,
      replyTo: this.email.replyTo,
    });

    let response: Awaited<ReturnType<Resend['emails']['send']>>;

    try {
      response = await this.client.emails.send(
        payload,
        // Resend forwards this as an `Idempotency-Key` header and collapses a
        // repeat into the original send. Belt and braces: placement is already
        // idempotent, so this only matters if a retry ever reached this layer
        // by another route.
        message.idempotencyKey === undefined ? {} : { idempotencyKey: message.idempotencyKey },
      );
    } catch (cause) {
      // A socket, DNS or abort failure — the request never reached a verdict.
      throw toTransportError(cause);
    }

    if (response.error !== null) {
      throw toDeliveryError(response.error);
    }

    if (response.data === null) {
      // Neither an error nor data. Not documented as reachable; treated as
      // transport rather than silently returning an empty message id that
      // would later look like a successful send in the logs.
      throw toTransportError(new Error('provider returned neither data nor error'));
    }

    return {
      providerMessageId: response.data.id,
      // The provider's own acceptance instant is not returned by this
      // endpoint, so this is when WE observed acceptance. Named `acceptedAt`
      // rather than `sentAt` precisely because delivery happens later and is
      // reported, if at all, by webhook.
      acceptedAt: new Date(),
    };
  }
}
