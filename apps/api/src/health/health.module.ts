import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Runtime infrastructure.
 *
 * The controller now injects the Mongoose connection, for `GET /health/ready`
 * only. It resolves through `MongooseCoreModule`, which is `@Global`, so no
 * import is needed here and this module still declares no dependency of its
 * own.
 *
 * The important invariant is narrower than "depends on nothing" and is
 * enforced in the controller: **liveness touches no dependency**. Only
 * readiness may, because only readiness is allowed to fail when a dependency
 * does.
 */
@Module({ controllers: [HealthController] })
export class HealthModule {}
