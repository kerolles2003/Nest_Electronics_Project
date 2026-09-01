import { ApiProperty } from '@nestjs/swagger';
import type { UserProfile } from '../../application/users.service';
import { Role } from '../../infrastructure/schemas/user.schema';

/**
 * The signed-in customer's own profile.
 *
 * ## Why this is not `AuthUserDto`
 *
 * The two carry the same fields, and that duplication is deliberate rather than
 * an oversight. `AuthUserDto` lives in `AuthModule`; importing it here would
 * make `UsersModule` depend on `AuthModule`, which already depends on
 * `UsersModule` — a cycle, and the frozen module map (§1 rule 4) keeps the graph
 * acyclic by construction.
 *
 * Moving `AuthUserDto` here instead would be the tidier arrangement and is not
 * free: the schema name is part of the published contract, so removing it is a
 * breaking change the drift gate would report as one. Two names for one shape is
 * the cheaper of the two mistakes, and the constructor below reads from the same
 * `UserProfile` type, so they cannot drift in content.
 */
export class UserProfileDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d', description: '24-character ObjectId hex.' })
  id!: string;

  @ApiProperty({
    example: 'maker@example.com',
    format: 'email',
    description: 'The login identifier. **Read-only here** — changing it needs re-verification.',
  })
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

  @ApiProperty({ example: true, description: 'Whether the email address has been verified.' })
  emailVerified!: boolean;

  @ApiProperty({
    example: '2026-08-30T14:22:31.000Z',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  lastLoginAt!: string | null;

  @ApiProperty({ example: '2026-08-30T14:22:31.000Z', format: 'date-time' })
  createdAt!: string;

  static from(user: UserProfile): UserProfileDto {
    return {
      id: user._id.toHexString(),
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      // A boolean, not the raw timestamp: a client needs to know WHETHER, and
      // the moment of verification is not its business.
      emailVerified: user.emailVerifiedAt !== null,
      lastLoginAt: user.lastLoginAt === null ? null : user.lastLoginAt.toISOString(),
      createdAt: user.createdAt.toISOString(),
    };
  }
}

export class UserProfileResponseDto {
  @ApiProperty({ type: UserProfileDto })
  data!: UserProfileDto;
}
