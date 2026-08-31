import { ApiProperty } from '@nestjs/swagger';
import type { AddressLean } from '../../infrastructure/schemas/user.schema';

/**
 * ONE saved address, as the API returns it.
 *
 * Every key is REQUIRED and nullable where a value may be absent — never
 * optional. API-CONTRACT.md §1: "optional fields are `null`, never omitted, so
 * Dart models stay stable". A generated Dart model therefore never has to
 * distinguish "absent" from "null".
 *
 * `userId` is deliberately absent. The caller is the owner — the route is
 * `/users/me/addresses` — so echoing an internal user id would disclose an
 * identifier the client has no use for and that must never appear in a log,
 * a screenshot or a bug report.
 */
export class AddressDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' })
  id!: string;

  @ApiProperty({ example: 'Home', description: 'Your own name for this address.' })
  label!: string;

  @ApiProperty({ example: 'Mina Kerolles', description: 'Who receives the parcel.' })
  fullName!: string;

  @ApiProperty({ example: '01012345678' })
  phone!: string;

  @ApiProperty({ example: '12 Sherif Street, Apartment 4' })
  street!: string;

  @ApiProperty({ example: 'Downtown' })
  city!: string;

  @ApiProperty({ example: 'Cairo' })
  governorate!: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  postalCode!: string | null;

  @ApiProperty({
    example: true,
    description:
      'At most ONE address per customer has this set. Checkout pre-selects it; it is never ' +
      'applied automatically, because placing an order always names the address explicitly.',
  })
  isDefault!: boolean;

  @ApiProperty({ example: '2026-08-30T14:22:31.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    example: '2026-08-30T14:22:31.000Z',
    format: 'date-time',
    description: 'Moves when the address is edited, and when its default flag changes.',
  })
  updatedAt!: string;

  static from(address: AddressLean): AddressDto {
    return {
      id: address._id.toHexString(),
      label: address.label,
      fullName: address.fullName,
      phone: address.phone,
      street: address.street,
      city: address.city,
      governorate: address.governorate,
      postalCode: address.postalCode,
      isDefault: address.isDefault,
      createdAt: address.createdAt.toISOString(),
      updatedAt: address.updatedAt.toISOString(),
    };
  }

  static fromList(addresses: readonly AddressLean[]): AddressDto[] {
    return addresses.map((address) => AddressDto.from(address));
  }
}

/**
 * The whole address book.
 *
 * NOT paginated, and that is a decision rather than an omission: the array is
 * capped at ten by `MAX_ADDRESSES_PER_USER`, so a page cursor would describe a
 * boundary that cannot be crossed. Ordered default-first, then oldest-first,
 * with the id as a final tie-break — a total order, so the list is stable
 * between requests.
 */
export class AddressListResponseDto {
  @ApiProperty({ type: [AddressDto] })
  data!: AddressDto[];
}

export class AddressResponseDto {
  @ApiProperty({ type: AddressDto })
  data!: AddressDto;
}
