import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  EmailSenderPort,
  type EmailSendResult,
  type OutboundEmail,
} from '../../../modules/notifications/application/ports/email-sender.port';

/**
 * The development sink: prints instead of sending.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §3;
 *            docs/architecture/TEMPLATE-ARCHITECTURE.md §9.
 *
 * ## Why this exists rather than "leave email off in development"
 *
 * A disabled path is an untested path. With this adapter selected the WHOLE
 * pipeline runs on every developer machine and in every CI run — template
 * compilation, strict-mode variable resolution, the data mapping, the port
 * call — and only the final network hop is replaced. A missing template
 * variable therefore fails on a laptop, not in production.
 *
 * ## Why it cannot accidentally reach a real inbox
 *
 * It has no credentials, no SDK and no network call. Selecting it is not a
 * "safe mode" that could be misconfigured into sending — sending is not
 * something this class is able to do. The env schema refuses to boot with
 * `EMAIL_PROVIDER=console` in production, so the mistake in the other
 * direction is also impossible.
 *
 * ## What it prints
 *
 * Recipients, subject and the PLAIN-TEXT body rather than the HTML: a wall of
 * inlined table markup in a terminal hides the very thing a developer is
 * checking. Verification links are consequently clickable straight out of the
 * log, which is the entire local sign-up workflow.
 */
@Injectable()
export class ConsoleEmailSender extends EmailSenderPort {
  private readonly logger = new Logger('EmailSender:console');

  send(message: OutboundEmail): Promise<EmailSendResult> {
    const recipients = message.to.map((recipient) => recipient.email).join(', ');

    this.logger.log(
      [
        '',
        '──────── EMAIL (not sent — console provider) ────────',
        `to:      ${recipients}`,
        `subject: ${message.subject}`,
        `tags:    ${JSON.stringify(message.tags ?? {})}`,
        '',
        message.text.trim(),
        '─────────────────────────────────────────────────────',
      ].join('\n'),
    );

    return Promise.resolve({
      // Prefixed so a support conversation can never mistake a development id
      // for a real provider's message id.
      providerMessageId: `console-${randomUUID()}`,
      acceptedAt: new Date(),
    });
  }
}
