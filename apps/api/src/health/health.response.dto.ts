import { ApiProperty } from '@nestjs/swagger';

/**
 * Liveness payload.
 *
 * Authority: docs/architecture/API-STANDARDS.md §10 — `GET /api/v1/health`
 * returns `{ status: "ok" }`. It reveals no version and no internal hostname.
 */
export class HealthResponseDto {
  @ApiProperty({ example: 'ok', enum: ['ok'], description: 'Liveness indicator.' })
  status!: 'ok';
}
