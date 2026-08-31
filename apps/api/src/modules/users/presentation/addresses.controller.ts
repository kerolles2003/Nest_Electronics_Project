import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user';
import { AddressesService } from '../application/addresses.service';
import type { AddressPatch } from '../infrastructure/repositories/user.repository';
import { MAX_ADDRESSES_PER_USER, Role } from '../infrastructure/schemas/user.schema';
import {
  AddressIdParamDto,
  CreateAddressDto,
  UpdateAddressDto,
} from './dto/address-request.dto';
import {
  AddressDto,
  AddressListResponseDto,
  AddressResponseDto,
} from './dto/address-response.dto';

/** An address book is per-customer and contains PII. Nothing may cache it. */
const NO_STORE = 'no-store';

/**
 * The signed-in customer's address book.
 *
 * Authority: docs/architecture/API-CONTRACT.md §5.5 (these exact routes);
 *            AUTHORIZATION-MODEL.md §4 (`addresses_own ALL` →
 *            `/users/me/addresses/*`); DOMAIN-MODEL.md §D2.
 *
 * ## Four properties hold across every route here
 *
 *  1. **`userId` comes from the JWT.** No DTO has such a field and no route
 *     takes a user id, so there is nothing for a caller to forge. `/me` is not a
 *     convenience alias for `/users/:id` — the second form does not exist.
 *  2. **Ownership is a query condition, not a check.** A foreign address is
 *     never selected rather than selected and then rejected, so it answers
 *     `404 ADDRESS_NOT_FOUND`, identically to an address that does not exist. A
 *     `403` would confirm the id and turn it into an oracle.
 *  3. **At most one address is ever the default.** Every write recomputes the
 *     flag across the whole array in ONE atomic update, so no sequence of
 *     concurrent requests can produce two.
 *  4. **A response returns the WHOLE book exactly when the operation can move
 *     the default to an address the caller did not name** — setting a default,
 *     and deleting one. Creating and editing return the single address, because
 *     in those cases the caller already knows everything that changed.
 *
 * Editing or deleting an address here NEVER changes an order that has already
 * been placed. An order carries its own address snapshot.
 */
@ApiTags('addresses')
@ApiBearerAuth()
@Controller('users/me/addresses')
@Roles(Role.CUSTOMER)
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'List my saved addresses',
    description: [
      'Every address saved by the signed-in customer, **default first**, then oldest first, with',
      'the id as a final tie-break. That order is total, so the list is stable between requests.',
      '',
      'A customer who has never saved one gets an empty array, not a `404`.',
      '',
      `Not paginated: the book is capped at **${String(MAX_ADDRESSES_PER_USER)} addresses**, so a`,
      'page cursor would describe a boundary that cannot be crossed.',
      '',
      'At most one entry has `isDefault: true`. Zero is also valid — a customer who deleted their',
      'last address has no default until they save another.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AddressListResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'UNAUTHENTICATED, TOKEN_EXPIRED or TOKEN_INVALID',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'FORBIDDEN — an address book belongs to a CUSTOMER account.',
  })
  async list(@CurrentUser() principal: AuthenticatedUser): Promise<AddressListResponseDto> {
    const addresses = await this.addresses.list(new Types.ObjectId(principal.id));

    return { data: AddressDto.fromList(addresses) };
  }

  @Get(':addressId')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Get one of my addresses',
    description: [
      'One saved address, by id.',
      '',
      'An address belonging to another customer returns **404**, exactly as an id that does not',
      'exist anywhere does. The two are indistinguishable on purpose: a `403` would confirm that',
      'the id is real and turn this endpoint into an oracle for somebody else’s address book.',
      '',
      'A malformed id is a `400` instead, which discloses nothing — it depends only on the',
      'characters you sent.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AddressResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR — `addressId` is not a 24-character hex string.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'FORBIDDEN' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'ADDRESS_NOT_FOUND — no such address, or it is not yours. The same answer for both.',
  })
  async findOne(
    @Param() params: AddressIdParamDto,
    @CurrentUser() principal: AuthenticatedUser,
  ): Promise<AddressResponseDto> {
    const address = await this.addresses.findOne(
      new Types.ObjectId(principal.id),
      new Types.ObjectId(params.addressId),
    );

    return { data: AddressDto.from(address) };
  }

  @Post()
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Save a new address',
    description: [
      'Adds one address to the book and returns it, including the `id` you will send to',
      '`POST /orders`.',
      '',
      '### The default',
      '',
      '- The **first** address you save becomes the default automatically — a customer with',
      '  addresses and no default has nothing for a checkout screen to pre-select.',
      '- A later address does **not** disturb the existing default unless you send',
      '  `isDefault: true`, which unsets the current one in the same atomic write.',
      '',
      'When you send `isDefault: true` the response tells you the whole story: this address is',
      'now the default, so every other one is not. No refetch is needed.',
      '',
      '### Limits',
      '',
      `At most **${String(MAX_ADDRESSES_PER_USER)}** saved addresses. The ${String(MAX_ADDRESSES_PER_USER + 1)}th`,
      'returns `422 ADDRESS_LIMIT_REACHED` — delete one first.',
      '',
      'The address is stored exactly as typed. Nothing here verifies that the street exists or',
      'that a courier can reach it: no geocoder and no address-verification vendor is integrated,',
      'and pretending otherwise would be claiming something the server cannot know.',
    ].join('\n'),
  })
  @ApiCreatedResponse({ type: AddressResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_ERROR — a field is missing, too long, or the phone is not an Egyptian mobile ' +
      'number. UNKNOWN_FIELD — the body carried a field this endpoint does not accept, such as ' +
      '`userId` or `id`.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'FORBIDDEN — addresses belong to CUSTOMER accounts. ACCOUNT_DISABLED.',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'ADDRESS_LIMIT_REACHED — the address book is full.',
  })
  async create(
    @Body() dto: CreateAddressDto,
    @CurrentUser() principal: AuthenticatedUser,
  ): Promise<AddressResponseDto> {
    const address = await this.addresses.create(
      new Types.ObjectId(principal.id),
      {
        label: dto.label,
        fullName: dto.fullName,
        phone: dto.phone,
        street: dto.street,
        city: dto.city,
        governorate: dto.governorate,
        postalCode: dto.postalCode ?? null,
      },
      dto.isDefault ?? false,
    );

    return { data: AddressDto.from(address) };
  }

  @Patch(':addressId')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Edit one of my addresses',
    description: [
      'A partial update: send only the fields you are changing. An omitted field is left exactly',
      'as it was. Send `postalCode: null` to clear it.',
      '',
      '### This cannot change a past order',
      '',
      'An order stores its own **immutable copy** of the address it was placed against. Editing',
      'the saved address here changes where your NEXT order goes and nothing about where an',
      'earlier one went — an invoice must still say what it said on the day.',
      '',
      '### `isDefault` is not accepted here',
      '',
      'Sending it returns `400 UNKNOWN_FIELD`. Making an address default is a write against every',
      'OTHER address, not against this one, so it has its own endpoint that performs it in a',
      'single atomic update: `POST /users/me/addresses/{addressId}/default`.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AddressResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_ERROR — a supplied field is invalid, or `addressId` is malformed. ' +
      'UNKNOWN_FIELD — the body carried `isDefault`, `userId` or another field this endpoint ' +
      'does not accept.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'FORBIDDEN. ACCOUNT_DISABLED.' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'ADDRESS_NOT_FOUND — no such address, or it is not yours.',
  })
  async update(
    @Param() params: AddressIdParamDto,
    @Body() dto: UpdateAddressDto,
    @CurrentUser() principal: AuthenticatedUser,
  ): Promise<AddressResponseDto> {
    const address = await this.addresses.update(
      new Types.ObjectId(principal.id),
      new Types.ObjectId(params.addressId),
      AddressesController.toPatch(dto),
    );

    return { data: AddressDto.from(address) };
  }

  @Post(':addressId/default')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Make one of my addresses the default',
    description: [
      'Sets this address as the default and, **in the same atomic update**, unsets whichever',
      'address currently holds it. There is no window in which two are default and none in which',
      'zero are: the whole array is rewritten once, and MongoDB applies that rewrite atomically.',
      'Concurrent requests naming different addresses therefore leave exactly one default —',
      'whichever landed last — never two.',
      '',
      'Repeating it on the address that is already default is a no-op and still returns `200`.',
      '',
      'Returns the **whole book**, because this operation changes addresses you did not name.',
      'Replace your local list with it rather than merging.',
      '',
      'The default is a pre-selection for a checkout screen. It is never applied automatically:',
      '`POST /orders` always names the address it is shipping to.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AddressListResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR — `addressId` is not a 24-character hex string.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'FORBIDDEN. ACCOUNT_DISABLED.' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'ADDRESS_NOT_FOUND — no such address, or it is not yours.',
  })
  async setDefault(
    @Param() params: AddressIdParamDto,
    @CurrentUser() principal: AuthenticatedUser,
  ): Promise<AddressListResponseDto> {
    const addresses = await this.addresses.setDefault(
      new Types.ObjectId(principal.id),
      new Types.ObjectId(params.addressId),
    );

    return { data: AddressDto.fromList(addresses) };
  }

  @Delete(':addressId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Delete one of my addresses',
    description: [
      'Removes the address from the book. It affects **future use only**.',
      '',
      '### What deleting does NOT do',
      '',
      'It does not delete, alter or hide any order. It does not touch an order’s address',
      'snapshot, its items, its totals, its inventory movements or its shipment record. Every',
      'past order remains fully renderable, because none of them reads this document.',
      '',
      'For the same reason there is no "this address is used by an order" refusal: nothing',
      'depends on it, so blocking the delete would protect nothing.',
      '',
      '### If you delete the default',
      '',
      'A replacement is promoted **deterministically** — the oldest surviving address, with the',
      'id as a tie-break — so the outcome is a documented rule rather than an accident of',
      'storage order. Delete your last address and you simply have no default.',
      '',
      'Returns the **whole remaining book**, because the default may have moved to an address you',
      'did not name. Replace your local list with it.',
      '',
      'Not idempotent: deleting the same id twice returns `404` the second time, which is the same',
      'answer somebody else’s id would get.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AddressListResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR — `addressId` is not a 24-character hex string.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'FORBIDDEN. ACCOUNT_DISABLED.' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'ADDRESS_NOT_FOUND — no such address, or it is not yours.',
  })
  async remove(
    @Param() params: AddressIdParamDto,
    @CurrentUser() principal: AuthenticatedUser,
  ): Promise<AddressListResponseDto> {
    const userId = new Types.ObjectId(principal.id);

    await this.addresses.remove(userId, new Types.ObjectId(params.addressId));

    return { data: AddressDto.fromList(await this.addresses.list(userId)) };
  }

  /**
   * Narrows a PATCH DTO to the keys the caller actually sent.
   *
   * `undefined` means "not sent" and is dropped; `null` on `postalCode` means
   * "clear it" and is kept. class-transformer materialises unset properties as
   * `undefined`, so the distinction has to be made on the VALUE — reading
   * `hasOwnProperty` would treat every absent field as a change to undefined.
   */
  private static toPatch(dto: UpdateAddressDto): AddressPatch {
    const patch: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        patch[key] = value;
      }
    }

    return patch as AddressPatch;
  }
}
