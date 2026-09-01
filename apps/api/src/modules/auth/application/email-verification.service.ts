import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { CredentialRepository } from '../infrastructure/repositories/credential.repository';
import { normaliseEmail } from '../domain/password-policy';

const VERIFICATION_TOKEN_BYTES = 32;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface VerificationChallenge {
  /** Emailed to the user. Never stored, never logged. */
  readonly rawToken: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

/**
 * Email-verification token lifecycle.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §2.5 — 32-byte random,
 * hashed at rest, 24-hour TTL, required before login.
 *
 * DELIVERY IS DELEGATED, not performed here. `NotificationsModule` owns the
 * template, the recipient and the transport; this service owns the token
 * lifecycle and nothing else. The split is why swapping mail providers cannot
 * touch token security, and why changing the token TTL cannot touch an email
 * template.
 *
 * The raw token leaves this class exactly once, to `NotificationsService`, and
 * reaches exactly one destination: the URL in the body of the mail. It is
 * never logged — a verification token is a bearer credential for an account,
 * and OBSERVABILITY.md §4 puts tokens on the mandatory redaction list.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly credentials: CredentialRepository,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Mints a challenge. The raw token is returned to the caller for delivery and
   * only its digest is ever persisted, so a database reader cannot verify
   * somebody else's address.
   */
  createChallenge(): VerificationChallenge {
    const rawToken = randomBytes(VERIFICATION_TOKEN_BYTES).toString('base64url');

    return {
      rawToken,
      tokenHash: EmailVerificationService.digest(rawToken),
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    };
  }

  private static digest(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Hands the challenge to the notification boundary.
   *
   * NEVER THROWS, because `NotificationsService` never throws: a mail provider
   * outage must not fail a registration whose account row is already
   * committed. If it did, the caller would see a 500, retry, and be told the
   * email is already taken — a strictly worse outcome than an account that
   * exists and needs one click on "resend".
   *
   * The log line records the OUTCOME, not the attempt (F-10), and deliberately
   * carries the user id rather than the token or the address.
   *
   * It previously logged "dispatched" unconditionally — including straight
   * after a `401 Key not found` from the provider — because
   * `NotificationsService` swallows delivery failures and returned nothing to
   * distinguish them. A log line that states the opposite of what happened is
   * worse than no log line: it is what an operator consults when a customer
   * says the email never arrived, and it sent them looking anywhere but at the
   * mail provider. `sendEmailVerification` now reports what it did, and this
   * method says that.
   *
   * The failure branch is `warn`, not `error`: the account exists, the
   * challenge is persisted, and "resend" recovers it — degraded, not broken.
   * The transport-level cause is logged separately by `NotificationsService`
   * with the template and error kind; this line adds the user id, which that
   * one deliberately does not carry.
   */
  async deliver(recipient: {
    userId: Types.ObjectId;
    email: string;
    fullName: string;
    rawToken: string;
  }): Promise<void> {
    const outcome = await this.notifications.sendEmailVerification({
      recipientEmail: recipient.email,
      recipientName: recipient.fullName,
      rawToken: recipient.rawToken,
    });

    const userId = recipient.userId.toHexString();

    if (outcome.accepted) {
      // "accepted" is the transport's word, and it is the honest one: the
      // provider took the message. Whether an inbox ever shows it is a later,
      // separate fact this process never learns.
      this.logger.log(
        `email verification challenge accepted for user ${userId}  ` +
          `messageId=${outcome.providerMessageId}`,
      );
      return;
    }

    this.logger.warn(
      `email verification challenge NOT sent for user ${userId} — ` +
        'the account exists and the challenge is stored; recovery is "resend"',
    );
  }

  /** Consumes a challenge. Unknown or expired tokens are indistinguishable. */
  async verify(rawToken: string): Promise<void> {
    const user = await this.credentials.findByVerificationTokenHash(
      EmailVerificationService.digest(rawToken),
    );

    if (user === null) {
      throw AppException.validation([
        { field: 'token', message: 'verification token is invalid or has expired', code: 'INVALID' },
      ]);
    }

    // Clears the challenge as well as setting the timestamp, so the token is
    // strictly single-use.
    await this.credentials.markEmailVerified(user._id);
  }

  /**
   * Issues a fresh challenge, replacing any outstanding one.
   *
   * ALWAYS reports success to the caller, whether or not the address exists or
   * is already verified. Anything else turns this endpoint into an
   * account-existence oracle that needs no password at all.
   */
  async resend(email: string): Promise<void> {
    const user = await this.credentials.findCredentialsByEmail(normaliseEmail(email));

    if (user === null || user.emailVerifiedAt !== null || user.deletedAt !== null) {
      return;
    }

    const challenge = this.createChallenge();
    await this.credentials.setVerificationChallenge(
      user._id,
      challenge.tokenHash,
      challenge.expiresAt,
    );

    await this.deliver({
      userId: user._id,
      email: user.email,
      fullName: user.fullName,
      rawToken: challenge.rawToken,
    });
  }
}
