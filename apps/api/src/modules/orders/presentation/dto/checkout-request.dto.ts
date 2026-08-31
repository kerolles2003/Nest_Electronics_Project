import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { OBJECT_ID_PATTERN } from '../../../../common/dto/object-id';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Place an order.
 *
 * ## Why `addressId` and NOT an inline address
 *
 * The frozen contract (API-CONTRACT.md §5.4) shapes the body as
 * `{addressId | shippingAddress, …}`. Until this phase only the second half was
 * implementable — there was no address book to point at — so the request carried
 * the address inline and the server validated and stored it.
 *
 * The address book now exists, and the inline form is **removed**. That is a
 * deliberate, breaking narrowing of the frozen alternation, recorded as a
 * conflict rather than hidden, and it is a SECURITY decision: while a client can
 * send address fields, checkout has to trust a body that no ownership rule
 * constrains. With `addressId` the delivery address is a resource the customer
 * already owns, resolved through an ownership-filtered query inside the
 * placement transaction. Sending `shippingAddress` now returns
 * `400 UNKNOWN_FIELD`.
 *
 * Guest checkout is not affected, because there is none: GUEST-CHECKOUT.md
 * decides that ordering requires an account, so there is no caller for whom an
 * inline address is the only option.
 *
 * ## What is NOT here, and never will be
 *
 * `items`, `productId`, `quantity`, `unitPrice`, `price`, `subtotal`, `total`,
 * `grandTotal`, `discount`, `shippingFee`, `currency`, `status`, `orderNumber`,
 * `userId`, `shippingAddress`. With `forbidNonWhitelisted` enabled globally,
 * sending any of them returns `400 UNKNOWN_FIELD` — and that code is logged as a
 * security signal.
 *
 * The absence is the control. A client cannot influence what it pays because the
 * fields to do so do not exist on the wire: the item list comes from the server
 * cart, prices from the catalogue, shipping from `FulfilmentService`, identity
 * from the JWT, the delivery address from the customer's own address book, and
 * the status from the server.
 *
 * `couponCode` is absent for a different reason — no `coupons` collection
 * exists, so a code could not be validated and honouring one would be
 * fabricating a discount. It is additive when PricingModule arrives.
 */
export class PlaceOrderDto {
  @ApiProperty({
    example: '652f1a9b3c4d5e6f7a8b9c0d',
    pattern: OBJECT_ID_PATTERN.source,
    description:
      'The `id` of one of YOUR saved addresses, from `GET /users/me/addresses`. It is resolved ' +
      'inside the placement transaction and COPIED onto the order, so editing or deleting the ' +
      'address afterwards never changes where this order was sent. An address belonging to ' +
      'another customer returns `404 ADDRESS_NOT_FOUND` — the same answer an id that exists ' +
      'nowhere gets.',
  })
  @IsString()
  @Transform(trim)
  @Matches(OBJECT_ID_PATTERN, { message: 'addressId must be a 24-character hex string' })
  addressId!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Please call before delivery.',
    maxLength: 500,
    description: 'Free text for the courier or the shop. Stored verbatim, never interpreted.',
  })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500, { message: 'customerNote must not exceed 500 characters' })
  customerNote?: string;
}

/**
 * The quote request body.
 *
 * `addressId` becomes real in this phase and is OPTIONAL, because a customer
 * opens the checkout screen before choosing an address. Supplying it makes the
 * quote's `shippingFee` the fee the ORDER will actually carry, since both go
 * through `FulfilmentService.quote(governorate, subtotal)` with the same
 * governorate. Omitting it quotes shipping without one — identical today,
 * because the configured rate is flat, and honestly different the moment
 * per-governorate rates exist.
 *
 * Still absent, and still for the original reason: `governorate` as raw text
 * (the address is the authority for it, and accepting a free-text governorate
 * would let a client shop for a cheaper fee) and `couponCode` (no coupon domain,
 * so a code could not be validated). Sending either returns `400 UNKNOWN_FIELD`
 * rather than being silently ignored.
 */
export class CheckoutQuoteDto {
  @ApiPropertyOptional({
    type: String,
    example: '652f1a9b3c4d5e6f7a8b9c0d',
    pattern: OBJECT_ID_PATTERN.source,
    description:
      'One of YOUR saved address ids, to quote shipping against. Omit it before the customer ' +
      'has chosen. A foreign or unknown id returns `404 ADDRESS_NOT_FOUND`.',
  })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(OBJECT_ID_PATTERN, { message: 'addressId must be a 24-character hex string' })
  addressId?: string;
}
