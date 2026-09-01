import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AppException } from '../../../common/errors/app.exception';
import { TransactionService } from '../../../database/transaction.service';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { CredentialRepository } from '../infrastructure/repositories/credential.repository';
import { RefreshTokenRepository } from '../infrastructure/repositories/refresh-token.repository';
import { normaliseEmail, validatePassword } from '../domain/password-policy';
import { PasswordService } from './password.service';

const RESET_TOKEN_BYTES = 32;

/**
 * One hour, from AUTHORIZATION-MODEL.md §2.8.
 *
 * A twenty-fourth of the verification TTL, and the difference is the point: a
 * verification link is a convenience the owner may open tomorrow, while a reset
 * link is a live credential that replaces a password and has no legitimate
 * reason to be opened a day later.
 */
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Password reset.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §2.8 — always 200 with a
 * generic message, single-use token hashed at rest, 1-hour TTL; on confirmation
 * validate, hash, set, increment `tokenVersion`, revoke ALL refresh tokens.
 *
 * ## The same token discipline as verification, because it is worth more here
 *
 * `EmailVerificationService` established the pattern and this follows it
 * deliberately rather than inventing a second one: 32 random bytes, only the
 * SHA-256 digest persisted, expiry compared inside the query, and the challenge
 * cleared on use.
 *
 * The stakes are higher, though. A verification token activates an account; a
 * reset token replaces its password. That is why the two live in SEPARATE
 * fields on the user document and are looked up by separate methods — a token
 * minted for one purpose must not be presentable to the other endpoint, and
 * nothing in the type system would notice, because both are a hash and a date.
 *
 * ## Why the request endpoint reveals nothing
 *
 * It answers identically for an address that exists, one that does not, one
 * that is unverified and one that is soft-deleted. Anything else turns an
 * unauthenticated endpoint into an account-existence oracle: an attacker with a
 * list of email addresses learns which ones have accounts here, and that is
 * enough to target a credential-stuffing run or simply to embarrass someone.
 *
 * The cost is real and accepted: someone who mistypes their address gets a
 * cheerful "if that address has an account, we have sent a link" and no email.
 * The alternative tells every stranger the same thing.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly credentials: CredentialRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly passwords: PasswordService,
    private readonly notifications: NotificationsService,
    private readonly transactions: TransactionService,
  ) {}

  private static digest(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Mints and emails a challenge — or does nothing, and says the same either
   * way.
   *
   * Returns `void`, not a boolean. A method that reported whether it found an
   * account would put the oracle one careless `if` away from the response body,
   * and there is no caller that legitimately needs to know.
   */
  async request(email: string): Promise<void> {
    const user = await this.credentials.findCredentialsByEmail(normaliseEmail(email));

    /*
     * Three different reasons to do nothing, one silence.
     *
     * A soft-deleted account must not be resurrectable through a reset link.
     *
     * An UNVERIFIED account is the interesting one, and it is deliberately
     * allowed through: refusing would mean somebody who registered, never
     * received the verification mail and forgot their password has no way back
     * in at all. Resetting the password does NOT verify the address — the
     * account still cannot log in until verification completes — so this hands
     * out no privilege the reset itself did not already imply.
     */
    if (user === null || user.deletedAt !== null) {
      return;
    }

    const rawToken = randomBytes(RESET_TOKEN_BYTES).toString('base64url');

    await this.credentials.setPasswordResetChallenge(
      user._id,
      PasswordResetService.digest(rawToken),
      new Date(Date.now() + RESET_TTL_MS),
    );

    const outcome = await this.notifications.sendPasswordReset({
      recipientEmail: user.email,
      recipientName: user.fullName,
      rawToken,
    });

    const userId = user._id.toHexString();

    if (outcome.accepted) {
      this.logger.log(
        `password reset challenge accepted for user ${userId}  ` +
          `messageId=${outcome.providerMessageId}`,
      );
      return;
    }

    /*
     * `warn`, not `error`, and the reasoning is the same as verification's: the
     * challenge is stored and the customer can ask again. What is NOT the same
     * is the recovery path — there is no "resend" button on a reset, so the
     * customer simply repeats the request, which mints a fresh token and
     * invalidates this one.
     */
    this.logger.warn(
      `password reset challenge NOT sent for user ${userId} — ` +
        'the challenge is stored; recovery is to request another',
    );
  }

  /**
   * Consumes a challenge and replaces the password.
   *
   * ## Everything or nothing
   *
   * The credential change and the session revocation run in ONE transaction.
   * Splitting them leaves a state that defeats the entire feature: the password
   * changed, but an attacker's refresh token survived and can still mint access
   * tokens — under the new password — for thirty days. A reset that does not
   * end the intruder's session has not reset anything.
   *
   * `tokenVersion` is incremented inside the same update as the hash, which
   * kills every outstanding ACCESS token; the revocation handles refresh
   * tokens, which the update cannot reach.
   */
  async confirm(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = PasswordResetService.digest(rawToken);
    const user = await this.credentials.findByPasswordResetTokenHash(tokenHash);

    if (user === null) {
      /*
       * Unknown, expired and already-used are ONE answer.
       *
       * Distinguishing them would let an attacker holding a stolen token learn
       * whether it was ever valid, and would tell anyone probing whether a
       * given account has a reset in flight.
       */
      throw AppException.validation([
        { field: 'token', message: 'reset token is invalid or has expired', code: 'INVALID' },
      ]);
    }

    /*
     * The policy runs AFTER the token is resolved, because it needs the account's
     * email address: `validatePassword` refuses a password containing it. That
     * ordering means an invalid token and a weak password cannot be told apart
     * by anyone who does not already hold a valid token — the weak-password
     * error is only reachable once the token has been proven good.
     */
    const rejection = validatePassword(newPassword, user.email);

    if (rejection !== null) {
      throw AppException.validation([
        { field: 'newPassword', message: rejection.message, code: rejection.reason },
      ]);
    }

    const passwordHash = await this.passwords.hash(newPassword);

    await this.transactions.run(async (session) => {
      const applied = await this.credentials.completePasswordReset(
        user._id,
        tokenHash,
        passwordHash,
        session,
      );

      if (!applied) {
        /*
         * Two confirmations raced on one token and this is the loser: the
         * filter no longer matched because the winner cleared the challenge.
         * Reported as the same invalid-token error, because from the caller's
         * side that is exactly what it is — the token has been used.
         */
        throw AppException.validation([
          { field: 'token', message: 'reset token is invalid or has expired', code: 'INVALID' },
        ]);
      }

      await this.refreshTokens.revokeAllForUser(user._id, 'PASSWORD_RESET', session);
    });

    // No token, no address, no password — the user id and the outcome. This
    // line is the one an operator reads after an account takeover.
    this.logger.log(
      `password reset completed for user ${user._id.toHexString()}; all sessions revoked`,
    );
  }
}
