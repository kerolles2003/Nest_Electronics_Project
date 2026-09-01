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

/**
 * The index check, which carries more than up/down because its failure is
 * ACTIONABLE and its remedy is a single command.
 *
 * The failure mode this exists to end cost real time precisely because it was
 * silent: a database with no indexes connects, answers every query correctly,
 * and serves traffic. Whoever reads this response should not then have to work
 * out which collection, which index, or what to run.
 */
export class IndexCheckDto extends DependencyCheckDto {
  @ApiProperty({
    type: [String],
    example: ['users.user_email_unique', 'orders.order_idempotency_key_unique'],
    description:
      'Declared indexes that are absent, or present with the wrong options, as ' +
      '`collection.indexName`. Empty when the check passes.',
  })
  missing!: string[];

  @ApiProperty({
    type: [String],
    example: [],
    description:
      'Indexes present in the database that the schemas no longer declare. Reported for ' +
      'information; these do NOT fail readiness, because an extra index costs write ' +
      'throughput but breaks no invariant.',
  })
  unexpected!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'pnpm --filter api indexes:sync',
    description: 'The command that fixes `missing`. `null` when there is nothing to fix.',
  })
  remedy!: string | null;
}

export class ReadinessChecksDto {
  @ApiProperty({ type: DependencyCheckDto })
  mongo!: DependencyCheckDto;

  @ApiProperty({ type: IndexCheckDto })
  indexes!: IndexCheckDto;
}

/**
 * Readiness payload.
 *
 * Authority: docs/architecture/API-STANDARDS.md §10 —
 * `200 { status, checks: { … } }`, `503` when a dependency is down.
 *
 * ## Why `cloudinary` is still absent, now that MediaModule exists
 *
 * The frozen shape names `cloudinary` alongside `mongo`. It was omitted while
 * there was no Cloudinary client to ask. There is one now, and it is still
 * omitted — for a better reason, which is worth writing down so it is not
 * "added for completeness" later.
 *
 * Readiness failing means STOP SENDING TRAFFIC. If a Cloudinary outage failed
 * readiness, every instance would drain at once and the whole storefront would
 * go dark — because a third party that only ADMIN IMAGE UPLOAD depends on was
 * unavailable. That is the same outage-amplification trap that keeps MongoDB
 * out of the liveness probe, one level up. A dependency belongs in readiness
 * only if the instance genuinely cannot serve without it.
 *
 * ## Why `indexes` is here, when it is not in the frozen shape
 *
 * It meets that bar exactly. Missing indexes do not slow this instance down;
 * they remove enforcement of invariants that repositories delegate entirely to
 * the database — duplicate accounts, double-charged orders, stock decremented
 * twice. An instance in that state must not take traffic.
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
