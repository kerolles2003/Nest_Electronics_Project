import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { EGYPTIAN_PHONE } from '../../../../common/dto/egyptian-phone';

/**
 * `PATCH /users/me`.
 *
 * ## What is deliberately not here
 *
 * **`email`.** Changing the login identifier is not a profile edit: the new
 * address has to be proven before it can be used to sign in, or the endpoint
 * becomes a way to move an account to an inbox you control. That is a
 * verification flow of its own, and quietly allowing it here would let one
 * `PATCH` take over an account.
 *
 * **`role`.** With `forbidNonWhitelisted: true` globally enabled, sending it
 * returns `400 UNKNOWN_FIELD` — the privilege-escalation attempt has nowhere to
 * land. Structural, not a check somebody has to remember.
 *
 * **`password`.** It needs the CURRENT password to authorise the change, which
 * makes it a different operation with a different shape.
 *
 * **`emailVerified`, `_id`, `createdAt`, `stats`.** Server-owned facts. A
 * client that could write them could claim a verified address it does not own.
 *
 * ## PATCH, and what an absent field means
 *
 * Every field is optional and absence means "leave it alone" — that is what
 * makes this a PATCH rather than a PUT. `phone` is the field where that
 * matters: it is nullable, so `null` is a real value meaning "remove my phone
 * number", and it is distinct from omitting the key.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Nadia Hassan',
    minLength: 2,
    maxLength: 120,
    description: 'Display name. Trimmed. Cannot be cleared — every account has one.',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'fullName must be at least 2 characters' })
  @MaxLength(120, { message: 'fullName must not exceed 120 characters' })
  fullName?: string;

  @ApiPropertyOptional({
    example: '01012345678',
    nullable: true,
    type: String,
    description:
      'Egyptian mobile number, or `null` to remove it. Omit the key to leave it unchanged — ' +
      '`null` and absent are different instructions.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  /*
   * `@IsOptional()` ignores every other validator when the value is `null` OR
   * `undefined`. That is precisely what makes "send null to clear it"
   * expressible — `@Matches` would otherwise reject `null` as a malformed
   * number — while any string still has to be a real Egyptian mobile.
   *
   * The cost is that a caller who sends `null` when they meant a number gets
   * silence rather than a validation error. That is the right trade here: the
   * field is genuinely nullable in the schema, so `null` is a legal value and
   * not a mistake the server can identify.
   */
  @Matches(EGYPTIAN_PHONE, {
    message: 'phone must be a valid Egyptian mobile number',
  })
  phone?: string | null;
}
