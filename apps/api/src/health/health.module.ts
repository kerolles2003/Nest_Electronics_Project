import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Runtime infrastructure. Depends on nothing, and must stay that way. */
@Module({ controllers: [HealthController] })
export class HealthModule {}
