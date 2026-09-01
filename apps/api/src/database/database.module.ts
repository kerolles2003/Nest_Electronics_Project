import { Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { databaseConfig, type DatabaseConfig } from '../config/database.config';
import { IndexHealthService } from './index-health.service';
import { TransactionService } from './transaction.service';

/**
 * MongoDB connection lifecycle.
 *
 * This directory exists because connection and transaction plumbing are
 * cross-module infrastructure owned by no domain: putting them in `common/`
 * would blur it into "infrastructure plus utilities", and putting them in a
 * module would give that module an unwarranted dependency inversion.
 *
 * Authority: docs/architecture/CODEBASE-STRUCTURE.md §2.2 (Refinement 1), §6.1.
 *
 * MUST NOT contain any collection schema (those are module-local) or any
 * query. There is deliberately no `DatabasePort`: Phase 1 chose MongoDB with a
 * document model designed specifically for it, so a portability abstraction
 * would be dishonest — adding ceremony while delivering none of the promised
 * replaceability.
 *
 * Also here, both for the same reason — index work spans every collection and
 * so belongs to no module: the `indexes:sync` script, and `IndexHealthService`,
 * which is the readiness probe's half of the same concern.
 */

const logger = new Logger('Database');

/** Replaces any connection string in text with a marker. */
function redactUris(text: string): string {
  return text.replace(/mongodb(\+srv)?:\/\/\S+/gi, 'mongodb://<redacted>');
}

/**
 * Attaches lifecycle listeners. Nothing here logs the URI in any form —
 * `MONGODB_URI` is on the mandatory redaction list because it may carry a
 * username, password and host.
 *
 * Authority: docs/architecture/OBSERVABILITY.md §4 (mandatory redaction);
 *            docs/architecture/CONFIGURATION-ARCHITECTURE.md §6.
 */
function registerConnectionLogging(connection: Connection): Connection {
  // Mongoose may already have connected by the time this factory runs, in
  // which case the 'connected' event has fired and a listener would never see
  // it. readyState 1 means connected.
  if (connection.readyState === 1) {
    logger.log('database connection established');
  }

  connection.on('connected', () => {
    logger.log('database connection established');
  });

  // 'disconnecting' fires synchronously when close() is called, so its log
  // line is written before the process can exit; 'disconnected' fires after
  // the socket is released and may race with exit.
  connection.on('disconnecting', () => {
    logger.log('database disconnecting');
  });

  connection.on('disconnected', () => {
    logger.log('database disconnected');
  });

  connection.on('error', (error: Error) => {
    // Name plus a URI-scrubbed message: enough to diagnose, safe to ship.
    logger.error(`database connection failed: ${error.name} — ${redactUris(error.message)}`);
  });

  return connection;
}

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (config: DatabaseConfig) => {
        logger.log('database connection starting');

        return {
          uri: config.uri,

          /**
           * The ONLY non-default option, and it is a frozen requirement:
           * indexes are created by an explicit, idempotent sync step, never
           * implicitly on model registration.
           * Authority: CODEBASE-STRUCTURE.md §6.1; OBSERVABILITY.md §9.
           *
           * Every other driver and Mongoose setting is left at its default.
           * No retryWrites, serverSelectionTimeoutMS, socketTimeoutMS or
           * legacy parser flags: none has evidence behind it here, and
           * premature tuning is how defaults become undocumented folklore.
           */
          autoIndex: false,

          /**
           * Second non-default option, added on MEASURED evidence.
           *
           * @nestjs/mongoose retries a failed initial connection 3 times by
           * default. Combined with the driver's 30s server-selection window
           * that made an unreachable database take a measured 296 SECONDS to
           * fail — during which the process looks hung rather than broken, and
           * an orchestrator would likely kill it first with a less useful
           * signal.
           *
           * The application has no degraded mode: without its database it
           * cannot serve, so retrying in-process only delays an inevitable
           * crash. Restart-with-backoff belongs to the orchestrator, which
           * already does it properly. One attempt, fail fast, let the platform
           * restart us.
           *
           * The driver's own serverSelectionTimeoutMS is deliberately left at
           * its 30s default: that window absorbs transient DNS and network
           * setup, and shortening it would be tuning without evidence.
           */
          retryAttempts: 0,

          connectionFactory: registerConnectionLogging,
        };
      },
    }),
  ],
  /**
   * `TransactionService` is provided and exported here because a transaction
   * is connection lifecycle, not a module capability: it is consumed by
   * `OrdersModule` and `InventoryModule` and belongs to neither.
   * Authority: docs/architecture/CODEBASE-STRUCTURE.md §2.2 (Refinement 1).
   *
   * Nothing consumes it yet. It exists because the transaction gate must
   * prove the REAL infrastructure the domain modules will use, not a
   * test-local imitation of it.
   */
  providers: [TransactionService, IndexHealthService],
  exports: [TransactionService, IndexHealthService],
})
export class DatabaseModule implements OnApplicationShutdown {
  /**
   * The connection itself is closed by the Mongoose integration's own
   * shutdown hook — verified server-side: MongoDB's connection count returns
   * to its pre-start value after SIGINT. No custom signal handler is added,
   * because the framework already guarantees the cleanup.
   *
   * This hook exists purely so the shutdown is OBSERVABLE: Nest awaits module
   * shutdown hooks, so this line is reliably written, whereas the driver's own
   * 'disconnected' event can race with process exit.
   */
  onApplicationShutdown(signal?: string): void {
    logger.log(`database shutting down${signal === undefined ? '' : ` (${signal})`}`);
  }
}
