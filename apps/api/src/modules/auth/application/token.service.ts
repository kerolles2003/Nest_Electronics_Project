import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { authConfig, type AuthConfig } from '../../../config/auth.config';
import { AppException } from '../../../common/errors/app.exception';
import { TransactionService } from '../../../database/transaction.service';
import type { Role } from '../../users/infrastructure/schemas/user.schema';
import type { AccessTokenClaims, AuthenticatedUser } from '../domain/authenticated-user';
import { CredentialRepository } from '../infrastructure/repositories/credential.repository';
import { RefreshTokenRepository } from '../infrastructure/repositories/refresh-token.repository';

/** 32 bytes of CSPRNG output, base64url. */
const REFRESH_TOKEN_BYTES = 32;

/** A hex ObjectId, for validating an untrusted `sub` claim before it is used in a query. */
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

export interface IssuedSession {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  /**
   * The CONFIGURED lifetime, carried explicitly rather than re-derived from
   * `accessTokenExpiresAt` at serialisation time — that subtraction loses a
   * second to elapsed wall-clock and would report 899 for a 900-second token.
   * A client scheduling a proactive refresh deserves the exact number.
   */
  readonly accessTokenExpiresIn: number;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

export interface SessionSubject {
  readonly id: Types.ObjectId;
  readonly role: Role;
  readonly tokenVersion: number;
}

/** Outcome of a rotation attempt. Errors are thrown by the CALLER, after commit. */
type RotationOutcome =
  | { readonly status: 'ROTATED'; readonly session: IssuedSession }
  | { readonly status: 'INVALID' }
  | { readonly status: 'REPLAY' };

/**
 * Issues, verifies, rotates and revokes tokens.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §2.7.
 *
 * The two token types are deliberately different technologies:
 *
 *   ACCESS  — a signed JWT. Stateless and NOT revocable, which is precisely why
 *             it lives 15 minutes. Verifying it costs one HMAC and no database
 *             round trip; legacy looked the role up on every single request.
 *   REFRESH — an opaque random string. Carries no claims, means nothing without
 *             the server's record, and is therefore fully revocable.
 *
 * A JWT refresh token would be a mistake: it would either be un-revocable, or
 * require the same database lookup while also leaking its claims to anyone who
 * captured it.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly credentials: CredentialRepository,
    private readonly transactions: TransactionService,
    @Inject(authConfig.KEY) private readonly config: AuthConfig,
  ) {}

  // --- Access tokens --------------------------------------------------------

  private issueAccessToken(subject: SessionSubject): {
    token: string;
    expiresAt: Date;
  } {
    const token = this.jwt.sign(
      { sub: subject.id.toHexString(), role: subject.role, tv: subject.tokenVersion },
      { expiresIn: this.config.accessTtlSeconds },
    );

    return {
      token,
      expiresAt: new Date(Date.now() + this.config.accessTtlSeconds * 1000),
    };
  }

  /**
   * Verifies an access token and returns the principal.
   *
   * Distinguishes expiry from invalidity because the client behaviour differs:
   * `TOKEN_EXPIRED` means refresh once and retry, `TOKEN_INVALID` means the
   * token is forged or corrupt and the client must re-authenticate. Collapsing
   * them would force every 401 into a refresh attempt.
   */
  verifyAccessToken(token: string): AuthenticatedUser {
    let claims: AccessTokenClaims;

    try {
      claims = this.jwt.verify<AccessTokenClaims>(token);
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw name === 'TokenExpiredError' ? AppException.tokenExpired() : AppException.tokenInvalid();
    }

    // A valid signature does not guarantee a well-formed payload — a token
    // signed by an earlier version of this service could carry anything. `sub`
    // reaches a database query, so its shape is checked before it is trusted.
    if (
      typeof claims.sub !== 'string' ||
      !OBJECT_ID_PATTERN.test(claims.sub) ||
      typeof claims.role !== 'string' ||
      typeof claims.tv !== 'number'
    ) {
      throw AppException.tokenInvalid();
    }

    return { id: claims.sub, role: claims.role, tokenVersion: claims.tv };
  }

  // --- Refresh tokens -------------------------------------------------------

  /**
   * SHA-256, not bcrypt.
   *
   * The input is 32 bytes of CSPRNG output, so there is no low-entropy guess to
   * slow down — the whole reason bcrypt is slow does not apply. A deterministic
   * digest is also what makes the unique index a usable lookup key; a salted
   * hash would force a collection scan on every refresh.
   */
  private static digest(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /** Starts a new rotation family. Called on login only. */
  async startSession(subject: SessionSubject): Promise<IssuedSession> {
    return this.issueSession(subject, new Types.ObjectId());
  }

  private async issueSession(
    subject: SessionSubject,
    familyId: Types.ObjectId,
    session?: Parameters<typeof this.refreshTokens.issue>[1],
  ): Promise<IssuedSession> {
    const access = this.issueAccessToken(subject);
    const rawRefreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const refreshTokenExpiresAt = new Date(Date.now() + this.config.refreshTtlSeconds * 1000);

    await this.refreshTokens.issue(
      {
        tokenHash: TokenService.digest(rawRefreshToken),
        userId: subject.id,
        familyId,
        expiresAt: refreshTokenExpiresAt,
      },
      session,
    );

    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      accessTokenExpiresIn: this.config.accessTtlSeconds,
      refreshToken: rawRefreshToken,
      refreshTokenExpiresAt,
    };
  }

  /**
   * Rotation: the presented token is revoked and a new pair is issued in the
   * same family.
   *
   * This is a genuine multi-document operation — one update and one insert —
   * and it is one of the few places a transaction is warranted rather than
   * ceremonial. Without it a crash between the two writes either strands the
   * user with no session or, worse, leaves the old token live alongside the new
   * one.
   *
   * Errors are RETURNED rather than thrown from inside the transaction, because
   * throwing would abort it — and the replay path must COMMIT its family
   * revocation. Detect inside, react outside.
   */
  async rotate(rawRefreshToken: string): Promise<IssuedSession> {
    const tokenHash = TokenService.digest(rawRefreshToken);

    const outcome = await this.transactions.run<RotationOutcome>(async (session) => {
      const stored = await this.refreshTokens.findByHash(tokenHash, session);

      if (stored === null || stored.expiresAt.getTime() <= Date.now()) {
        return { status: 'INVALID' };
      }

      // A token that was already rotated is being presented a second time. The
      // legitimate holder has moved on, so whoever sent this captured it.
      if (stored.revokedAt !== null) {
        await this.refreshTokens.revokeFamily(stored.familyId, 'REPLAY_DETECTED', session);
        return { status: 'REPLAY' };
      }

      // The account must still be allowed to hold a session: a deactivated user
      // must not be able to refresh their way past the check login performs.
      const user = await this.credentials.findCredentialsById(stored.userId, session);
      if (user === null || user.deletedAt !== null) {
        await this.refreshTokens.revokeFamily(stored.familyId, 'REPLAY_DETECTED', session);
        return { status: 'INVALID' };
      }

      // Conditional on the token still being live — this is what makes two
      // simultaneous refreshes of the same token resolve to exactly one winner.
      const won = await this.refreshTokens.revokeIfLive(stored._id, 'ROTATED', session);
      if (!won) {
        return { status: 'INVALID' };
      }

      return {
        status: 'ROTATED',
        session: await this.issueSession(
          { id: user._id, role: user.role, tokenVersion: user.tokenVersion },
          stored.familyId,
          session,
        ),
      };
    });

    if (outcome.status === 'REPLAY') {
      // Logged as a security event. The token itself is never logged.
      this.logger.warn('refresh token replay detected — rotation family revoked');
      throw AppException.refreshTokenReused();
    }

    if (outcome.status === 'INVALID') {
      throw AppException.refreshTokenInvalid();
    }

    return outcome.session;
  }

  /**
   * Logout. Idempotent by design: an unknown or already-revoked token is not an
   * error, because the caller's intent — "this session should not work" — is
   * already satisfied. Returning 401 here would only teach clients to ignore
   * logout failures.
   */
  async revokeSession(rawRefreshToken: string): Promise<void> {
    const stored = await this.refreshTokens.findByHash(TokenService.digest(rawRefreshToken));

    if (stored !== null) {
      await this.refreshTokens.revokeIfLive(stored._id, 'LOGOUT');
    }
  }

  /** Logout everywhere. */
  async revokeAllSessions(userId: Types.ObjectId): Promise<number> {
    return this.refreshTokens.revokeAllForUser(userId, 'LOGOUT_ALL');
  }
}
