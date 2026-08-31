import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Why the customer is cancelling.
 *
 * Authority: docs/architecture/API-CONTRACT.md §5.4 - the cancel body is
 * `{reason}`; ORDER-LIFECYCLE.md §5 T2/T4 lists `reason` as required input.
 *
 * FREE TEXT, deliberately. No enum, no reason taxonomy, no `otherReason`
 * escape hatch: a cancellation-reason vocabulary is a business analytics
 * decision nobody has made, and inventing one now would freeze a guess into a
 * generated Dart enum that cannot be changed without a breaking release. It is
 * stored verbatim and never parsed, so introducing a structured reason later is
 * additive.
 *
 * There is no `status` field here, and there is no generic `PATCH /orders/:id`.
 * The target status is implied by the ENDPOINT, so a client cannot ask for an
 * arbitrary status and rely on the server to refuse it.
 */
export class CancelOrderDto {
  @ApiProperty({
    example: 'Ordered the wrong variant.',
    minLength: 3,
    maxLength: 500,
    description:
      'Why the order is being cancelled. Free text, shown back on the order and stored on the ' +
      'permanent record. Required.',
  })
  @IsString()
  @Transform(trim)
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must not exceed 500 characters' })
  reason!: string;
}
