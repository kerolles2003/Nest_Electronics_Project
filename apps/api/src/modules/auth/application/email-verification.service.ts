import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AppException } from '../../../common/errors/app.exception';
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
 * DELIVERY IS NOT IMPLEMENTED HERE. `NotificationsModule` owns email and does
 * not exist yet, so the token is issued and stored but not sent. That is why
 * `AUTH_REQUIRE_EMAIL_VERIFICATION` exists — and why the configuration schema
 * refuses to let it be false in production. When the notifications module
 * lands, one call replaces one log line and the flag flips; nothing else here
 * changes.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(private readonly credentials: CredentialRepository) {}

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
   * Records that a challenge was issued.
   *
   * The token is deliberately absent from this line. A verification token is a
   * bearer credential for an account, and a log file is not a safe place for
   * one — OBSERVABILITY.md §4 puts tokens on the mandatory redaction list.
   */
  noteDeliveryPending(userId: string): void {
    this.logger.log(`email verification token issued for user ${userId} (delivery pending)`);
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
    this.noteDeliveryPending(user._id.toHexString());
  }
}
