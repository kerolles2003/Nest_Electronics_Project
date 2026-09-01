import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { authConfig, type AuthConfig } from '../../../config/auth.config';
import { AppException } from '../../../common/errors/app.exception';
import { UsersService, type UserProfile } from '../../users/application/users.service';
import { normaliseEmail, validatePassword } from '../domain/password-policy';
import { CredentialRepository } from '../infrastructure/repositories/credential.repository';
import { EmailVerificationService } from './email-verification.service';
import { PasswordService } from './password.service';
import { TokenService, type IssuedSession } from './token.service';

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly fullName: string;
  readonly phone: string | null;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface AuthenticatedSession {
  readonly session: IssuedSession;
  readonly user: UserProfile;
}

/**
 * Registration, login and logout.
 *
 * Token mechanics live in `TokenService`, hashing in `PasswordService`, the
 * policy in `domain/password-policy.ts`. What is left here is the ORDER of
 * checks — which is where the security-relevant decisions actually are.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly credentials: CredentialRepository,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly verification: EmailVerificationService,
    @Inject(authConfig.KEY) private readonly config: AuthConfig,
  ) {}

  /**
   * Creates an account. Returns NO session.
   *
   * Authority: docs/architecture/AUTHORIZATION-MODEL.md §2.4 — "Return 201 with
   * no session." Verification comes first; issuing a session here would make
   * the verification requirement decorative.
   *
   * The frozen text says the document is created "in one transaction". It is a
   * single-document insert — the verification challenge is embedded in the same
   * user document — so a transaction would add a session round trip and buy
   * nothing. MongoDB single-document writes are already atomic.
   */
  async register(input: RegisterInput): Promise<void> {
    const email = normaliseEmail(input.email);

    // Policy is checked in the SERVICE, not only in the DTO: the DTO answers
    // "is this well-formed?", and rules that depend on other fields — a password
    // containing the email — are a service concern (DTO-STRATEGY.md §5).
    const rejection = validatePassword(input.password, email);
    if (rejection !== null) {
      throw AppException.validation([
        { field: 'password', message: rejection.message, code: rejection.reason },
      ]);
    }

    const passwordHash = await this.passwords.hash(input.password);
    const challenge = this.verification.createChallenge();

    // Duplicate detection is the database's unique index, translated to
    // DUPLICATE_EMAIL by the repository. No read-then-write race exists.
    const user = await this.credentials.create({
      email,
      passwordHash,
      fullName: input.fullName.trim(),
      phone: input.phone,
      verification: { tokenHash: challenge.tokenHash, expiresAt: challenge.expiresAt },
    });

    // POST-INSERT, deliberately. The account is already durably committed, so
    // a mail-provider outage costs the customer one click on "resend" rather
    // than the account itself — and a retry after a failed send would hit
    // DUPLICATE_EMAIL, which is a strictly worse outcome than an unverified
    // account that exists.
    await this.verification.deliver({
      userId: user._id,
      email,
      fullName: input.fullName.trim(),
      rawToken: challenge.rawToken,
    });
  }

  /**
   * Authenticates and starts a session.
   *
   * The order of the four checks below is the whole security design:
   *
   *   1. Look the account up. A miss does NOT return early.
   *   2. Compare a password either way — against the stored hash, or against a
   *      dummy hash of identical cost. Both paths take the same time, so the
   *      endpoint cannot be timed to discover whether an address is registered.
   *   3. Only AFTER a correct password may a more specific reason be revealed.
   *      `ACCOUNT_DISABLED` and `EMAIL_NOT_VERIFIED` are reachable only by
   *      somebody who already proved they hold the credentials, so they inform
   *      the legitimate user without informing an enumerator.
   *   4. Everything else is one generic `INVALID_CREDENTIALS`.
   */
  async login(input: LoginInput): Promise<AuthenticatedSession> {
    const email = normaliseEmail(input.email);
    const credentials = await this.credentials.findCredentialsByEmail(email);

    if (credentials === null) {
      await this.passwords.verifyAgainstDummy(input.password);
      throw AppException.invalidCredentials();
    }

    const correct = await this.passwords.verify(input.password, credentials.passwordHash);
    if (!correct) {
      throw AppException.invalidCredentials();
    }

    if (credentials.deletedAt !== null) {
      throw AppException.accountDisabled();
    }

    if (this.config.requireEmailVerification && credentials.emailVerifiedAt === null) {
      throw AppException.emailNotVerified();
    }

    const session = await this.tokens.startSession({
      id: credentials._id,
      role: credentials.role,
      tokenVersion: credentials.tokenVersion,
    });

    await this.credentials.recordLogin(credentials._id);

    const user = await this.users.findById(credentials._id);
    if (user === null) {
      // Unreachable: the credentials were just read from the same document.
      throw AppException.invalidCredentials();
    }

    return { session, user };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokens.revokeSession(rawRefreshToken);
  }

  async logoutAll(userId: Types.ObjectId): Promise<number> {
    return this.tokens.revokeAllSessions(userId);
  }
}
