import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Max, Min } from 'class-validator';
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
