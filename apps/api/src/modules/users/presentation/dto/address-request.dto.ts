import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  EGYPTIAN_GOVERNORATES,
  GOVERNORATE_VALUES,
} from '../../../../common/constants/governorates';
import { EGYPTIAN_PHONE } from '../../../../common/dto/egyptian-phone';
import { OBJECT_ID_PATTERN } from '../../../../common/dto/object-id';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Trims, and collapses a string that trims away to NOTHING into `null`.
 *
 * Only for `postalCode`, the one address field with no minimum length. The
 * schema declares it "Null, never an empty string" (`user.schema.ts`), and
 * without this a body of `{"postalCode": ""}` would satisfy every validator —
 * `@IsString`, `@MaxLength(20)` — and store `""`, giving the field two spellings
 * for "absent". One of them would then reach the IMMUTABLE order snapshot, where
 * it can never be corrected.
 *
 * Every OTHER string field has a `@MinLength`, so whitespace-only input already
 * fails validation there rather than being silently reinterpreted.
 */
const trimToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed;
};

/**
 * `:addressId` in the path.
 *
 * Validating the SHAPE here is what makes a malformed id a `400` instead of the
 * `500` that `new Types.ObjectId('nonsense')` would otherwise produce. It is
 * also the one address failure that is allowed to be distinguishable: it
 * depends only on the characters the caller sent, never on whose address it is,
 * so it discloses nothing.
 */
export class AddressIdParamDto {
  @ApiProperty({
    example: '652f1a9b3c4d5e6f7a8b9c0d',
    pattern: OBJECT_ID_PATTERN.source,
    description: '24-character hex id of one of YOUR saved addresses.',
  })
  @Matches(OBJECT_ID_PATTERN, { message: 'addressId must be a 24-character hex string' })
  addressId!: string;
}

/**
 * Save a new address.
 *
 * ## What is NOT here, and never will be
 *
 * `userId`, `id`, `_id`, `createdAt`, `updatedAt`. With `forbidNonWhitelisted`
 * on globally, sending any of them returns `400 UNKNOWN_FIELD`, which is logged
 * as a security signal. The owner is the JWT subject and cannot be expressed on
 * the wire at all — the structural half of the ownership guarantee.
 *
 * The field set is exactly the live business model (`docs/db/schema.sql:11`,
 * carried forward by MONGODB-DESIGN.md §3). `country` is absent because the shop
 * ships within Egypt only, and `area`, `buildingNumber`, `apartment` and
 * `landmark` are absent because the business has never captured them — `street`
 * is one line covering street, building and apartment. Inventing them would also
 * add permanently-null fields to the IMMUTABLE order snapshot, where a
 * speculative field can never be removed again.
 */
export class CreateAddressDto {
  @ApiProperty({
    example: 'Home',
    minLength: 1,
    maxLength: 40,
    description: 'Your own name for this address. Shown to you, never to a courier.',
  })
  @IsString()
  @Transform(trim)
  @MinLength(1, { message: 'label must not be empty' })
  @MaxLength(40, { message: 'label must not exceed 40 characters' })
  label!: string;

  @ApiProperty({
    example: 'Mina Kerolles',
    minLength: 2,
    maxLength: 120,
    description: 'Who receives the parcel. May differ from the account holder.',
  })
  @IsString()
  @Transform(trim)
  @MinLength(2, { message: 'fullName must be at least 2 characters' })
  @MaxLength(120, { message: 'fullName must not exceed 120 characters' })
  fullName!: string;

  @ApiProperty({
    example: '01012345678',
    pattern: EGYPTIAN_PHONE.source,
    description: 'Egyptian mobile number. The courier calls this number.',
  })
  @IsString()
  @Transform(trim)
  @Matches(EGYPTIAN_PHONE, { message: 'phone must be a valid Egyptian mobile number' })
  phone!: string;

  @ApiProperty({
    example: '12 Sherif Street, Apartment 4',
    minLength: 5,
    maxLength: 200,
    description: 'Street, building and apartment, as one line.',
  })
  @IsString()
  @Transform(trim)
  @MinLength(5, { message: 'street must be at least 5 characters' })
  @MaxLength(200, { message: 'street must not exceed 200 characters' })
  street!: string;

  @ApiProperty({ example: 'Downtown', minLength: 2, maxLength: 80 })
  @IsString()
  @Transform(trim)
  @MinLength(2, { message: 'city must be at least 2 characters' })
  @MaxLength(80, { message: 'city must not exceed 80 characters' })
  city!: string;

  @ApiProperty({
    example: 'Cairo',
    enum: EGYPTIAN_GOVERNORATES,
    description:
      'Egyptian governorate. A CLOSED list of the 27 governorates — send one of these exact ' +
      'strings, case-sensitive and untrimmed of internal spacing. ' +
      'This was previously free text because the governorate vocabulary belonged to an ' +
      'unresolved shipping rate table (OPEN-001). D-8 resolved it: the rate table is seeded ' +
      'one row per governorate with NO fallback row, so an unrecognised value would reach a ' +
      'rate lookup with nothing to find, at checkout. Rejecting it here is what makes that ' +
      'design safe.',
  })
  @IsString()
  @Transform(trim)
  @IsIn(GOVERNORATE_VALUES, {
    message: 'governorate must be one of the 27 Egyptian governorates',
  })
  governorate!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: null,
    maxLength: 20,
    description:
      'Rarely used in Egypt. Omit it, or send `null`. An empty or whitespace-only string is ' +
      'stored as `null` rather than as `""`, so the field has exactly one spelling for "absent".',
  })
  @IsOptional()
  @IsString()
  @Transform(trimToNull)
  @MaxLength(20, { message: 'postalCode must not exceed 20 characters' })
  postalCode?: string | null;

  @ApiPropertyOptional({
    type: Boolean,
    example: false,
    default: false,
    description:
      'Make this the default address, unsetting whichever address currently holds it. ' +
      'Omitted or `false` NEVER moves an existing default — but the FIRST address you save ' +
      'becomes the default either way, because a customer with addresses and no default has ' +
      'nothing for checkout to pre-select.',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * Edit a saved address. Every field is optional; an omitted field is unchanged.
 *
 * `isDefault` is deliberately ABSENT — sending it returns `400 UNKNOWN_FIELD`.
 * Making an address default is a write against every SIBLING, not against this
 * one, and it has its own endpoint (`POST .../default`) that performs it
 * atomically. Accepting it here would mean one route with two very different
 * atomicity stories.
 *
 * `postalCode` accepts an explicit `null` to CLEAR it, which is the one place
 * where "sent as null" and "not sent" must mean different things.
 */
export class UpdateAddressDto {
  @ApiPropertyOptional({ example: 'Home', minLength: 1, maxLength: 40 })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1, { message: 'label must not be empty' })
  @MaxLength(40, { message: 'label must not exceed 40 characters' })
  label?: string;

  @ApiPropertyOptional({ example: 'Mina Kerolles', minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(2, { message: 'fullName must be at least 2 characters' })
  @MaxLength(120, { message: 'fullName must not exceed 120 characters' })
  fullName?: string;

  @ApiPropertyOptional({ example: '01012345678', pattern: EGYPTIAN_PHONE.source })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(EGYPTIAN_PHONE, { message: 'phone must be a valid Egyptian mobile number' })
  phone?: string;

  @ApiPropertyOptional({ example: '12 Sherif Street, Apartment 4', minLength: 5, maxLength: 200 })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(5, { message: 'street must be at least 5 characters' })
  @MaxLength(200, { message: 'street must not exceed 200 characters' })
  street?: string;

  @ApiPropertyOptional({ example: 'Downtown', minLength: 2, maxLength: 80 })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(2, { message: 'city must be at least 2 characters' })
  @MaxLength(80, { message: 'city must not exceed 80 characters' })
  city?: string;

  @ApiPropertyOptional({ example: 'Cairo', enum: EGYPTIAN_GOVERNORATES })
  @IsOptional()
  @IsString()
  @Transform(trim)
  // Same closed list as creation. An update path that accepted free text would
  // reopen the hole the create path closes — an address could be edited into an
  // unquotable state after it was accepted.
  @IsIn(GOVERNORATE_VALUES, {
    message: 'governorate must be one of the 27 Egyptian governorates',
  })
  governorate?: string;

  /**
   * `@ValidateIf` rather than `@IsOptional`: an explicit `null` must reach the
   * service to clear the field, and `@IsOptional` would skip validation for
   * `null` while still passing it through. This says "validate it as a string
   * unless it is exactly null", which is the rule this field actually has.
   */
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: null,
    maxLength: 20,
    description:
      'Send `null` — or an empty string, which means the same thing — to clear it. Omit it to ' +
      'leave it unchanged.',
  })
  @ValidateIf((_object, value) => value !== null)
  @IsOptional()
  @IsString()
  @Transform(trimToNull)
  @MaxLength(20, { message: 'postalCode must not exceed 20 characters' })
  postalCode?: string | null;
}
