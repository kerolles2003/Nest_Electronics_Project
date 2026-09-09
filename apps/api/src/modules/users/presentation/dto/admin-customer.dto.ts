import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { MoneyDto } from '../../../../common/dto/money.dto';
import { OBJECT_ID_PATTERN } from '../../../../common/dto/object-id';
import { PaginationMetaDto } from '../../../../common/dto/pagination-meta.dto';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import type { CustomerSummary } from '../../application/customers-admin.service';
import { Role } from '../../infrastructure/schemas/user.schema';

function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === '1' || value === true) return true;
  if (value === 'false' || value === '0' || value === false) return false;
  return value;
}

export class CustomerIdParamDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d', pattern: OBJECT_ID_PATTERN.source })
  @Matches(OBJECT_ID_PATTERN, { message: 'id must be a 24-character hex id' })
  id!: string;
}

export class CustomerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'sobhy',
    maxLength: 100,
    description:
      'Matches email, full name, and phone by digits. Substring, not a text index — an ' +
      'operator typing part of a name expects a mid-token match, which tokenised search cannot ' +
      'give them. Escaped before it reaches the database.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @ApiPropertyOptional({
    enum: Role,
    description:
      'Filter by role. The list is named for customers because that is almost all of it, but ' +
      'staff accounts are in it too and this is how they are found.',
  })
  @IsOptional()
  @IsEnum(Role, { message: `role must be one of: ${Object.values(Role).join(', ')}` })
  role?: Role;

  @ApiPropertyOptional({ example: false, default: false, description: 'Include deleted accounts.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeDeleted?: boolean;
}

export class ChangeRoleDto {
  @ApiProperty({
    enum: Role,
    description:
      'The role to set. Changing your own is refused, and so is demoting the last SUPER_ADMIN.',
  })
  @IsEnum(Role, { message: `role must be one of: ${Object.values(Role).join(', ')}` })
  role!: Role;
}

export class CustomerAddressDto {
  @ApiProperty({ example: 'Home' }) label!: string;
  @ApiProperty({ example: 'Mina Sobhy' }) fullName!: string;
  @ApiProperty({ example: '01012345678' }) phone!: string;
  @ApiProperty({ example: '12 Sherif Street, Apartment 4' }) street!: string;
  @ApiProperty({ example: 'Downtown' }) city!: string;
  @ApiProperty({ example: 'Cairo' }) governorate!: string;
  @ApiProperty({ example: true }) isDefault!: boolean;
}

/**
 * One account, as staff see it.
 *
 * **`passwordHash` is not on this class, and cannot be.** The credential fields
 * are owned by AuthModule through a dedicated repository
 * (AUTHORIZATION-MODEL.md §10) and are excluded by the service's projection, so
 * there is no serializer option, no `toJSON` override and no forgotten `select`
 * that could put one here.
 */
export class AdminCustomerDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' }) id!: string;
  @ApiProperty({ example: 'maker@example.com' }) email!: string;
  @ApiProperty({ example: 'Mina Sobhy' }) fullName!: string;

  @ApiProperty({
    example: '01012345678',
    nullable: true,
    type: String,
    description: 'The ACCOUNT phone. Frequently null — registration does not ask for one.',
  })
  phone!: string | null;

  @ApiProperty({ enum: Role }) role!: Role;

  @ApiProperty({ example: true, description: 'Whether the address has been confirmed.' })
  emailVerified!: boolean;

  @ApiProperty({ example: '2026-09-03T09:14:00.000Z', nullable: true, type: String })
  lastLoginAt!: string | null;

  @ApiProperty({ example: null, nullable: true, type: String }) deletedAt!: string | null;

  @ApiProperty({
    example: 4,
    description:
      'EVERY order this account placed, whatever became of it — "has this person ordered ' +
      'before" means exactly that, and a count that hid cancellations would disagree with the ' +
      'order list on the same screen.',
  })
  orderCount!: number;

  @ApiProperty({
    example: 187500,
    description:
      'Lifetime spend in minor units, counted at DELIVERY. Under COD the courier collects at ' +
      'the door, so an order that has not been delivered has not been paid for — see ' +
      '`orders/domain/revenue.ts`, which is the one definition this and the dashboard share.',
  })
  totalSpent!: number;

  @ApiProperty({
    example: '1,875.00 EGP',
    description:
      'The SAME amount, formatted by the server. Added because `totalSpent` alone was not ' +
      'enough: the admin console divided it nowhere and printed it as `EGP {totalSpent}`, so ' +
      'every row showed a hundred times the real figure — fifty pounds as "EGP 5,000". ' +
      'Formatting money at the boundary rather than shipping a bare minor-unit number is the ' +
      'rule MONEY-MODEL.md sets for exactly this reason, and every other monetary field in ' +
      'this API already follows it through `MoneyDto`. ' +
      '`totalSpent` remains authoritative; this is presentation and must never be parsed back.',
  })
  formattedTotalSpent!: string;

  @ApiProperty({ example: '2026-09-01T11:00:00.000Z', nullable: true, type: String })
  lastOrderAt!: string | null;

  @ApiProperty({ example: '2026-08-01T09:00:00.000Z' }) createdAt!: string;

  static from(summary: CustomerSummary): AdminCustomerDto {
    const { user } = summary;

    return {
      id: user._id.toHexString(),
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      emailVerified: user.emailVerifiedAt !== null,
      lastLoginAt: user.lastLoginAt === null ? null : user.lastLoginAt.toISOString(),
      deletedAt: user.deletedAt === null ? null : user.deletedAt.toISOString(),
      orderCount: summary.orderCount,
      totalSpent: summary.totalSpent,
      formattedTotalSpent: MoneyDto.of(summary.totalSpent).formatted,
      lastOrderAt: summary.lastOrderAt === null ? null : summary.lastOrderAt.toISOString(),
      createdAt: user.createdAt.toISOString(),
    };
  }
}

/** The detail view adds the address book; the list deliberately does not carry it. */
export class AdminCustomerDetailDto extends AdminCustomerDto {
  @ApiProperty({ type: [CustomerAddressDto] })
  addresses!: CustomerAddressDto[];

  static fromDetail(summary: CustomerSummary): AdminCustomerDetailDto {
    return {
      ...AdminCustomerDto.from(summary),
      addresses: summary.user.addresses.map((address) => ({
        label: address.label,
        fullName: address.fullName,
        phone: address.phone,
        street: address.street,
        city: address.city,
        governorate: address.governorate,
        isDefault: address.isDefault,
      })),
    };
  }
}

export class AdminCustomerListResponseDto {
  @ApiProperty({ type: [AdminCustomerDto] }) data!: AdminCustomerDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
}

export class AdminCustomerResponseDto {
  @ApiProperty({ type: AdminCustomerDetailDto }) data!: AdminCustomerDetailDto;
}
