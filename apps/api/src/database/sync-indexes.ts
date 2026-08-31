import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from '../app.module';

/**
 * The explicit, idempotent index synchronisation step.
 *
 * Authority: docs/architecture/CODEBASE-STRUCTURE.md §6.1 and OBSERVABILITY.md
 * §9 — indexes are declared on the schema but created by THIS step, never by
 * `autoIndex` on model registration. Implicit index creation runs on every boot
 * of every instance, races itself under horizontal scale, and silently rebuilds
 * a large collection at the worst possible moment.
 *
 * `syncIndexes()` creates what is missing and drops what the schema no longer
 * declares, so it converges rather than accumulating. Dropped indexes are
 * reported by name because a surprise drop should never be silent.
 *
 *   pnpm --filter api indexes:sync
 */

const logger = new Logger('IndexSync');

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const connection = app.get<Connection>(getConnectionToken());
    const models = Object.values(connection.models);

    if (models.length === 0) {
      logger.warn('no models registered — nothing to synchronise');
      return;
    }

    for (const model of models) {
      const dropped = await model.syncIndexes();
      const indexes = await model.listIndexes();

      logger.log(
        `${model.collection.name.padEnd(12)} ${String(indexes.length)} index(es)` +
          (dropped.length > 0 ? `  dropped: ${dropped.join(', ')}` : ''),
      );

      for (const index of indexes) {
        logger.log(`  ${String(index.name)}  ${JSON.stringify(index.key)}`);
      }
    }

    logger.log('index sync complete');
  } catch (error) {
    logger.error(`index sync failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
