import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { OBJECT_ID_PATTERN } from '../../../../common/dto/object-id';
import { MAX_QUANTITY_PER_LINE, MIN_QUANTITY } from '../../application/cart-line';

/**
 * The product path parameter shared by the per-item routes.
 *
 * The cart line is addressed by PRODUCT id, not by a line id. There is exactly
 * one line per product, so a separate line identifier would be a second way to
 * name the same thing — and one a client could hold after the line moved.
 */
export class CartItemParamDto {
  @ApiProperty({
    example: '652f1a9b3c4d5e6f7a8b9c0d',
    pattern: OBJECT_ID_PATTERN.source,
    description: 'The product id, as returned by the catalogue.',
  })
  @IsString()
  @Matches(OBJECT_ID_PATTERN, { message: 'productId must be a 24-character hex id' })
  productId!: string;
}

/**
 * Add to cart.
 *
 * There is NO price, NO currency and NO userId field, and there never will be.
 * With `forbidNonWhitelisted` globally enabled, sending one returns
 * `400 UNKNOWN_FIELD` — a client cannot influence what it pays because the
 * fields to do so do not exist on the wire.
 */
export class AddCartItemDto extends CartItemParamDto {
  @ApiProperty({
    minimum: MIN_QUANTITY,
    maximum: MAX_QUANTITY_PER_LINE,
    example: 2,
    description:
      'How many to ADD. Additive: sending 2 for a product already at 3 results in 5. ' +
      `The line is then capped at min(${String(MAX_QUANTITY_PER_LINE)}, available stock), and ` +
      'the response reports the resulting quantity.',
  })
  @Type(() => Number)
  @IsInt({ message: 'quantity must be an integer' })
  @Min(MIN_QUANTITY, { message: `quantity must be at least ${String(MIN_QUANTITY)}` })
  @Max(MAX_QUANTITY_PER_LINE, {
    message: `quantity must not exceed ${String(MAX_QUANTITY_PER_LINE)}`,
  })
  quantity!: number;
}

/** Set an existing line to an exact quantity. */
export class UpdateCartItemDto {
  @ApiProperty({
    minimum: MIN_QUANTITY,
    maximum: MAX_QUANTITY_PER_LINE,
    example: 3,
    description:
      'The new absolute quantity, NOT a delta. Clamped to available stock. ' +
      '0 is rejected — use DELETE to remove a line.',
  })
  @Type(() => Number)
  @IsInt({ message: 'quantity must be an integer' })
  @Min(MIN_QUANTITY, { message: `quantity must be at least ${String(MIN_QUANTITY)}` })
  @Max(MAX_QUANTITY_PER_LINE, {
    message: `quantity must not exceed ${String(MAX_QUANTITY_PER_LINE)}`,
  })
  quantity!: number;
}

/**
 * The maximum number of distinct products in one anonymous basket.
 *
 * The same cap the browser store applies, restated here because the browser is
 * not the authority on anything: this endpoint is public and unauthenticated,
 * so the bound on how much work one request can ask for has to live on the
 * server. Generous for a real basket and small enough that pricing one is a
 * single indexed query either way.
 */
export const MAX_GUEST_CART_LINES = 50;

/** One line of an anonymous basket. Product and quantity, exactly like a real one. */
export class GuestCartLineDto extends CartItemParamDto {
  @ApiProperty({
    minimum: MIN_QUANTITY,
    maximum: MAX_QUANTITY_PER_LINE,
    example: 2,
    description:
      'How many the visitor has in their basket. Clamped to live stock in the response, ' +
      'exactly as a stored cart line is.',
  })
  @Type(() => Number)
  @IsInt({ message: 'quantity must be an integer' })
  @Min(MIN_QUANTITY, { message: `quantity must be at least ${String(MIN_QUANTITY)}` })
  @Max(MAX_QUANTITY_PER_LINE, {
    message: `quantity must not exceed ${String(MAX_QUANTITY_PER_LINE)}`,
  })
  quantity!: number;
}

/**
 * Price an anonymous basket.
 *
 * There is no price, currency, name or userId field here either — the same rule
 * as `AddCartItemDto`, and it matters more rather than less because this route
 * is public. Everything the response contains is read from the catalogue.
 */
export class PreviewGuestCartDto {
  @ApiProperty({
    type: [GuestCartLineDto],
    maxItems: MAX_GUEST_CART_LINES,
    description:
      'The visitor\'s basket. Duplicate products are summed, which is what adding the same ' +
      'product twice to a real cart does. An empty array is accepted and returns an empty cart.',
  })
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(MAX_GUEST_CART_LINES, {
    message: `items must not exceed ${String(MAX_GUEST_CART_LINES)} products`,
  })
  @ValidateNested({ each: true })
  @Type(() => GuestCartLineDto)
  items!: GuestCartLineDto[];
}
