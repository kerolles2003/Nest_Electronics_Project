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

/** The state of one dependency. `down` is the only value that fails readiness. */
export class DependencyCheckDto {
  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  status!: 'up' | 'down';

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description:
      'A short, non-sensitive reason when `status` is `down`. Never contains a connection ' +
      'string, a credential or a host name.',
  })
  detail!: string | null;
}

export class ReadinessChecksDto {
  @ApiProperty({ type: DependencyCheckDto })
  mongo!: DependencyCheckDto;
}

/**
 * Readiness payload.
 *
 * Authority: docs/architecture/API-STANDARDS.md §10 —
 * `200 { status, checks: { … } }`, `503` when a dependency is down.
 *
 * The frozen shape names `cloudinary` alongside `mongo`. It is deliberately
 * ABSENT here: `MediaModule` does not exist, there is no Cloudinary client to
 * ask, and a hard-coded `"up"` would be a lie that a load balancer would
 * believe. It appears when the dependency does.
 */
export class ReadinessResponseDto {
  @ApiProperty({
    example: 'ok',
    enum: ['ok', 'degraded'],
    description: '`degraded` accompanies HTTP 503 and means at least one dependency is down.',
  })
  status!: 'ok' | 'degraded';

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;
}
