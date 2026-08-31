import type { Request } from 'express';
import type { Role } from '../../users/infrastructure/schemas/user.schema';

/**
 * The access-token payload, exactly as signed.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §2.7.
 *
 * Four claims and nothing else. No email, no name, no phone: a JWT is base64,
 * not encryption, so every claim is readable by anyone holding the token —
 * including whatever logged it. A claim is here because a REQUEST needs it,
 * never because it was convenient to carry.
 */
export interface AccessTokenClaims {
  /** User id, hex. */
  readonly sub: string;
  readonly role: Role;
  /** Token version — see AuthenticatedUser.tokenVersion. */
  readonly tv: number;
  readonly iat: number;
  readonly exp: number;
}

/** The principal, as resolved by JwtAuthGuard and injected by `@CurrentUser()`. */
export interface AuthenticatedUser {
  readonly id: string;
  readonly role: Role;
  /**
   * The `tv` claim. Incrementing `user.tokenVersion` invalidates every
   * outstanding access token at once — the escape hatch for a password change,
   * a role change or a forced logout, where waiting out the 15-minute lifetime
   * is not acceptable.
   *
   * The common request path deliberately does NOT compare it against the
   * database. That is the whole point of carrying the role in the token: legacy
   * looked the role up on every single request, which made `profiles_pkey` the
   * hottest index in the entire database at 2,719 scans.
   */
  readonly tokenVersion: number;
}

/** An Express request carrying the resolved principal. */
export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };
