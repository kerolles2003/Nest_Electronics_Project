import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { HealthController } from './health.controller';

/**
 * Runtime infrastructure.
 *
 * The controller now injects the Mongoose connection, for `GET /health/ready`
 * only. It resolves through `MongooseCoreModule`, which is `@Global`, so no
 * import is needed here and this module still declares no dependency of its
 * own.
 *
 * `DatabaseModule` is imported for `IndexHealthService`, which readiness uses
 * to assert that the indexes the schemas declare actually exist. Index work
 * spans every collection and belongs to no module, which is why it lives there
 * alongside the `indexes:sync` script rather than here.
 *
 * The important invariant is narrower than "depends on nothing" and is
 * enforced in the controller: **liveness touches no dependency**. Only
 * readiness may, because only readiness is allowed to fail when a dependency
 * does.
 */
@Module({ imports: [DatabaseModule], controllers: [HealthController] })
export class HealthModule {}
