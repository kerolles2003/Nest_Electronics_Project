import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorCode } from '../errors/error-code.enum';

/**
 * One field-level validation problem.
 *
 * Authority: docs/architecture/API-STANDARDS.md §1.
 */
export class FieldErrorDto {
  @ApiProperty({ example: 'limit', description: 'The offending field or query parameter.' })
  field!: string;

  @ApiProperty({ example: 'limit must not exceed 100' })
  message!: string;

  @ApiProperty({
    example: 'MAX',
    nullable: true,
    type: String,
    description: 'Constraint identifier. Always present on a validation detail.',
  })
  code!: string | null;
}

export class ErrorBodyDto {
  @ApiProperty({
    enum: ErrorCode,
    example: ErrorCode.VALIDATION_ERROR,
    description: 'STABLE machine-readable code. Switch on this — never on `message`.',
  })
  code!: ErrorCode;

  @ApiProperty({
    example: 'Validation failed.',
    description: 'Human-readable and safe to display. May change between releases; never parse it.',
  })
  message!: string;

  @ApiPropertyOptional({
    type: [FieldErrorDto],
    description: 'Present on validation errors only.',
  })
  details?: FieldErrorDto[];

  @ApiProperty({
    example: '3f6c1e1e-6f3a-4a5f-9f0a-2b8f5c1d7e90',
    description: 'Correlates with server logs. Show it in support UI; also returned as X-Request-Id.',
  })
  requestId!: string;

  @ApiProperty({ example: '2026-08-30T14:22:31.000Z', format: 'date-time' })
  timestamp!: string;
}

/**
 * THE error envelope. Every error from every endpoint uses exactly this shape,
 * and it is symmetric with the `{ data, meta }` success envelope so a client
 * can branch on the presence of one key.
 */
export class ErrorResponseDto {
  @ApiProperty({ type: ErrorBodyDto })
  error!: ErrorBodyDto;
}
