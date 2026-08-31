import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const NOTE = {
  example: 'Customer confirmed by phone.',
  maxLength: 500,
  description:
    'Free-text note recorded on the status history entry for this transition. Internal.',
};

/**
 * The staff lifecycle request bodies.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §5 - the "required input"
 * column of the transition matrix. Each DTO carries exactly what its edge
 * needs, and nothing else.
 *
 * NONE of them has a `status` field, and there is no shared "update status"
 * body. The target status is implied by the ENDPOINT, so an operator cannot ask
 * for an arbitrary status and rely on the server to refuse it, and no request
 * can reach the state machine carrying a status of its own. Every one of these
 * is `forbidNonWhitelisted`, so an unknown field is a `400 UNKNOWN_FIELD`.
 */

/** T1 `PLACED -> CONFIRMED`. Optional note. */
export class ConfirmOrderDto {
  @ApiPropertyOptional(NOTE)
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500, { message: 'note must not exceed 500 characters' })
  note?: string;
}

/**
 * T3 `CONFIRMED -> SHIPPED`.
 *
 * `carrier` and `trackingNumber` are REQUIRED, not optional. §8 makes them a
 * precondition of the state: an order in `SHIPPED` with no way to track it is
 * exactly the legacy failure this design closes, where the tracking column did
 * not exist and shipping with a tracking number was impossible (F-CRIT-4).
 */
export class ShipOrderDto {
  @ApiProperty({
    example: 'Bosta',
    minLength: 2,
    maxLength: 80,
    description:
      'The courier company. Free text - the carrier list is a business input, not a frozen enum.',
  })
  @IsString()
  @Transform(trim)
  @MinLength(2, { message: 'carrier must be at least 2 characters' })
  @MaxLength(80, { message: 'carrier must not exceed 80 characters' })
  carrier!: string;

  @ApiProperty({
    example: 'BST-123456789',
    minLength: 3,
    maxLength: 120,
    description: 'The carrier consignment reference. Shown to the customer.',
  })
  @IsString()
  @Transform(trim)
  @MinLength(3, { message: 'trackingNumber must be at least 3 characters' })
  @MaxLength(120, { message: 'trackingNumber must not exceed 120 characters' })
  trackingNumber!: string;

  @ApiPropertyOptional(NOTE)
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500, { message: 'note must not exceed 500 characters' })
  note?: string;
}

/** T5 `SHIPPED -> DELIVERED`. Optional note. Also collects the COD cash. */
export class DeliverOrderDto {
  @ApiPropertyOptional(NOTE)
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500, { message: 'note must not exceed 500 characters' })
  note?: string;
}

/** T6 `SHIPPED -> DELIVERY_FAILED`. The failure reason is required. */
export class DeliveryFailedDto {
  @ApiProperty({
    example: 'Customer unreachable on three call attempts.',
    minLength: 3,
    maxLength: 500,
    description:
      'Why the delivery attempt failed. Required, recorded on the status history entry.',
  })
  @IsString()
  @Transform(trim)
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must not exceed 500 characters' })
  reason!: string;
}

/**
 * T7 `DELIVERY_FAILED -> SHIPPED`. Re-dispatch.
 *
 * Carrier and tracking are OPTIONAL here and only optional here: the order
 * already has a shipment, so omitting them re-dispatches with the existing
 * carrier. Supplying either replaces it - the common case of handing a failed
 * parcel to a different courier. `deliveryAttempts` is never reset.
 */
export class RetryShipmentDto {
  @ApiPropertyOptional({
    example: 'Aramex',
    minLength: 2,
    maxLength: 80,
    description: 'A NEW carrier, if the parcel is changing hands. Omit to keep the current one.',
  })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(2, { message: 'carrier must be at least 2 characters' })
  @MaxLength(80, { message: 'carrier must not exceed 80 characters' })
  carrier?: string;

  @ApiPropertyOptional({
    example: 'ARX-987654321',
    minLength: 3,
    maxLength: 120,
    description: 'A NEW tracking number. Omit to keep the current one.',
  })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(3, { message: 'trackingNumber must be at least 3 characters' })
  @MaxLength(120, { message: 'trackingNumber must not exceed 120 characters' })
  trackingNumber?: string;

  @ApiPropertyOptional(NOTE)
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500, { message: 'note must not exceed 500 characters' })
  note?: string;
}

/** T8 / T9 `-> RETURNED`. Reason required; restores stock. */
export class ReturnOrderDto {
  @ApiProperty({
    example: 'Customer refused delivery; parcel returned to the warehouse.',
    minLength: 3,
    maxLength: 500,
    description: 'Why the goods came back. Required, recorded on the status history entry.',
  })
  @IsString()
  @Transform(trim)
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must not exceed 500 characters' })
  reason!: string;
}
