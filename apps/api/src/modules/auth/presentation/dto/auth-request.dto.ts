import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { EGYPTIAN_PHONE } from '../../../../common/dto/egyptian-phone';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '../../domain/password-policy';

/** Trim, then lowercase. Applied at the transport edge so nothing downstream can forget. */
const normaliseEmailInput = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Registration input.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §2.4.
 *
 * There is NO `role` field, and there never will be. With
 * `forbidNonWhitelisted: true` globally enabled, sending one returns
 * `400 UNKNOWN_FIELD` — the privilege-escalation attempt has no surface to land
 * on. That is a structural guarantee, not a check somebody has to remember.
 */
export class RegisterDto {
  @ApiProperty({
    example: 'maker@example.com',
    format: 'email',
    maxLength: 254,
    description: 'Normalised to lowercase. Must not already be registered.',
  })
  @Transform(normaliseEmailInput)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254, { message: 'email must not exceed 254 characters' })
  email!: string;

  @ApiProperty({
    minLength: MIN_PASSWORD_LENGTH,
    maxLength: MAX_PASSWORD_BYTES,
    example: 'correct-horse-battery',
    description:
      `At least ${String(MIN_PASSWORD_LENGTH)} characters and at most ${String(MAX_PASSWORD_BYTES)} bytes. ` +
      'No composition rules — length beats forced symbol classes. Rejected if it is a ' +
      'well-known password or contains your email address.',
  })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`,
  })
  @MaxLength(MAX_PASSWORD_BYTES, {
    message: `password must not exceed ${String(MAX_PASSWORD_BYTES)} characters`,
  })
  password!: string;

  @ApiProperty({
    example: 'Nadia Hassan',
    minLength: 2,
    maxLength: 120,
    description:
      'Display name. REQUIRED — legacy fell back to the email address, which is a data-quality bug.',
  })
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'fullName must be at least 2 characters' })
  @MaxLength(120, { message: 'fullName must not exceed 120 characters' })
  fullName!: string;

  @ApiPropertyOptional({
    type: String,
    example: '01012345678',
    nullable: true,
    pattern: EGYPTIAN_PHONE.source,
    description: 'Egyptian mobile number. Optional — omit it rather than sending null.',
  })
  @IsOptional()
  @IsString()
  @Matches(EGYPTIAN_PHONE, { message: 'phone must be a valid Egyptian mobile number' })
  phone?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'maker@example.com', format: 'email' })
  @Transform(normaliseEmailInput)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'correct-horse-battery',
    description: 'Never logged, never echoed in an error, never returned.',
  })
  @IsString()
  @MinLength(1, { message: 'password must not be empty' })
  @MaxLength(256)
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    example: 'k7Qq1m3Yb2v9c0d1e2f3g4h5i6j7k8l9m0n1o2p3q4r',
    description: 'The opaque refresh token returned by login or a previous refresh.',
  })
  @IsString()
  @MinLength(20, { message: 'refreshToken is not a valid token' })
  @MaxLength(512)
  refreshToken!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'The single-use token from the verification email.' })
  @IsString()
  @MinLength(20, { message: 'token is not a valid token' })
  @MaxLength(512)
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'maker@example.com', format: 'email' })
  @Transform(normaliseEmailInput)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;
}

/**
 * `POST /auth/password-reset/request`.
 *
 * One field, and deliberately no others. A "redirect back to" or "client id"
 * parameter here would be an open-redirect handed to an unauthenticated caller,
 * with the resulting link mailed to a real customer by us.
 */
export class PasswordResetRequestDto {
  @ApiProperty({ example: 'maker@example.com', format: 'email' })
  @Transform(normaliseEmailInput)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;
}

/**
 * `POST /auth/password-reset/confirm`.
 *
 * The password is checked against the full server-side policy in the SERVICE,
 * not here, because the policy also refuses a password containing the account's
 * email address and this DTO cannot know it. What the decorators do is bound
 * the input before it reaches bcrypt.
 */
export class PasswordResetConfirmDto {
  @ApiProperty({ description: 'The single-use token from the password-reset email.' })
  @IsString()
  @MinLength(20, { message: 'token is not a valid token' })
  @MaxLength(512)
  token!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH, format: 'password' })
  @IsString()
  /*
   * The bcrypt ceiling, enforced before hashing rather than after.
   *
   * bcrypt silently truncates at 72 BYTES, so without this a 200-character
   * password and its first 72 bytes are the same credential — and the customer
   * believes they chose the longer one.
   */
  @MaxLength(MAX_PASSWORD_BYTES)
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`,
  })
  newPassword!: string;
}
