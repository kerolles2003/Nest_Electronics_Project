import { ApiProperty } from '@nestjs/swagger';
import type { UserProfile } from '../../../users/application/users.service';
import { Role } from '../../../users/infrastructure/schemas/user.schema';
import type { IssuedSession } from '../../application/token.service';

/**
 * THE canonical authenticated-user contract.
 *
 * Every client — Flutter, the storefront, the admin app — models the signed-in
 * user from this one shape, returned identically by `POST /auth/login` and
 * `GET /auth/me`.
 *
 * Absent BY CONSTRUCTION, not by runtime stripping: `passwordHash`,
 * `tokenVersion`, `emailVerification`, `deletedAt`. Those fields are not
 * properties of this class, so no code path can leak them
 * (DTO-STRATEGY.md §6, AUTHORIZATION-MODEL.md §10).
 */
export class AuthUserDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d', description: '24-character ObjectId hex.' })
  id!: string;

  @ApiProperty({ example: 'maker@example.com', format: 'email' })
  email!: string;

  @ApiProperty({ example: 'Nadia Hassan' })
  fullName!: string;

  @ApiProperty({ example: '01012345678', nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({
    enum: Role,
    example: Role.CUSTOMER,
    description: 'Authorization role. Set by the server; never accepted from a client.',
  })
  role!: Role;

  @ApiProperty({
    example: true,
    description: 'Whether the email address has been verified.',
  })
  emailVerified!: boolean;

  @ApiProperty({
    example: '2026-08-30T14:22:31.000Z',
    format: 'date-time',
    nullable: true,
    type: String,
    description:
      'Most recent successful sign-in. On the login response this is the CURRENT sign-in, ' +
      'because it is recorded before the response is built. Null only for an account that has ' +
      'never signed in.',
  })
  lastLoginAt!: string | null;

  @ApiProperty({ example: '2026-08-30T14:22:31.000Z', format: 'date-time' })
  createdAt!: string;

  static from(user: UserProfile): AuthUserDto {
    return {
      id: user._id.toHexString(),
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      // Exposed as a boolean rather than the raw timestamp: a client needs to
      // know WHETHER, and the moment of verification is not its business.
      emailVerified: user.emailVerifiedAt !== null,
      lastLoginAt: user.lastLoginAt === null ? null : user.lastLoginAt.toISOString(),
      createdAt: user.createdAt.toISOString(),
    };
  }
}

/**
 * A token pair with EXPLICIT expiry.
 *
 * Both absolute timestamps and relative seconds are returned, deliberately.
 * `expiresIn` lets a client schedule a proactive refresh without trusting its
 * own clock; `expiresAt` lets it decide after a suspend/resume, when a timer
 * has not been running. A Flutter HTTP interceptor needs one or the other and
 * should never have to infer either from an undocumented convention.
 */
export class SessionTokensDto {
  @ApiProperty({
    example: 'Bearer',
    enum: ['Bearer'],
    description: 'Send as `Authorization: Bearer <accessToken>`.',
  })
  tokenType!: string;

  @ApiProperty({ description: 'Short-lived JWT. NOT revocable — keep it in memory.' })
  accessToken!: string;

  @ApiProperty({ example: 900, description: 'Access-token lifetime in seconds.' })
  expiresIn!: number;

  @ApiProperty({ example: '2026-08-30T14:37:31.000Z', format: 'date-time' })
  accessTokenExpiresAt!: string;

  @ApiProperty({
    description:
      'Opaque, revocable, single-use. Store it in secure storage. Every refresh returns a NEW ' +
      'one and invalidates this one.',
  })
  refreshToken!: string;

  @ApiProperty({ example: '2026-09-29T14:22:31.000Z', format: 'date-time' })
  refreshTokenExpiresAt!: string;

  static from(session: IssuedSession): SessionTokensDto {
    return {
      tokenType: 'Bearer',
      accessToken: session.accessToken,
      expiresIn: session.accessTokenExpiresIn,
      accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
    };
  }
}

export class LoginPayloadDto extends SessionTokensDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

/** A response whose only content is a human-readable confirmation. */
export class MessagePayloadDto {
  @ApiProperty({ example: 'Registration complete.' })
  message!: string;
}

export class RegisterPayloadDto extends MessagePayloadDto {
  @ApiProperty({
    example: true,
    description:
      'Always true. Registration issues NO session — the account must be verified before it can ' +
      'sign in, so the client should show "check your email" rather than navigating to a ' +
      'guarded route.',
  })
  emailVerificationRequired!: boolean;
}

// --- Envelopes -------------------------------------------------------------
// Concrete classes rather than a generic, so the OpenAPI document carries named
// schemas and the generated Dart models are stable.

export class LoginResponseDto {
  @ApiProperty({ type: LoginPayloadDto })
  data!: LoginPayloadDto;
}

export class RefreshResponseDto {
  @ApiProperty({ type: SessionTokensDto })
  data!: SessionTokensDto;
}

export class RegisterResponseDto {
  @ApiProperty({ type: RegisterPayloadDto })
  data!: RegisterPayloadDto;
}

export class MessageResponseDto {
  @ApiProperty({ type: MessagePayloadDto })
  data!: MessagePayloadDto;
}

export class CurrentUserResponseDto {
  @ApiProperty({ type: AuthUserDto })
  data!: AuthUserDto;
}
