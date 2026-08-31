import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Connection, mongo } from 'mongoose';

/**
 * The single place a MongoDB transaction is opened.
 *
 * Authority: docs/architecture/CODEBASE-STRUCTURE.md §2.1 (the `database/`
 *            directory MUST contain `TransactionService`), §6.4;
 *            docs/architecture/CONSISTENCY-MODEL.md §7;
 *            docs/architecture/PORTS-AND-CONTRACTS.md §4.
 *
 * It is deliberately MongoDB-shaped. There is no `TransactionPort`, no
 * `UnitOfWork`, no `DatabasePort`: the frozen architecture rejected database
 * portability as a dishonest abstraction, and `PORTS-AND-CONTRACTS.md` §4
 * lists `TransactionService` explicitly under "where contracts do NOT exist" —
 * "a thin wrapper over the Mongo session API". Anything richer would be an API
 * designed for callers that do not exist yet.
 *
 * It contains NO domain knowledge: no collection name, no business rule, no
 * schema, no query. The caller supplies the work; this class supplies the
 * session and the frozen concerns.
 *
 * Usage — the session MUST be threaded into every write inside the callback,
 * because a write without it silently commits outside the transaction:
 *
 *   await this.transactions.run(async (session) => {
 *     await this.orders.insert(order, session);
 *     await this.inventory.decrement(lines, session);
 *   });
 */

/**
 * The frozen transaction concerns, in one place so no caller may vary them.
 * Authority: docs/architecture/CONSISTENCY-MODEL.md §7.
 *
 *   snapshot read concern   — a consistent view across the whole transaction
 *   majority + journal      — durability for commercial data
 *   primary read preference — single region; avoids replica-lag surprises
 *   maxCommitTimeMS 15s     — §7's "transaction timeout 15 s" applied to the
 *                             commit budget: fail fast rather than hang. A
 *                             full end-to-end CSOT budget is NOT set here;
 *                             that needs a measured operation to size it, and
 *                             guessing one now would be tuning without
 *                             evidence.
 */
const TRANSACTION_OPTIONS = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority', j: true },
  readPreference: 'primary',
  maxCommitTimeMS: 15_000,
} as const satisfies mongo.TransactionOptions;

@Injectable()
export class TransactionService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * Runs `work` inside a multi-document transaction and returns its result.
   *
   * Commit and abort are the driver's: `withTransaction` commits when the
   * callback resolves and aborts when it rejects, retrying only errors the
   * server labelled `TransientTransactionError` or
   * `UnknownTransactionCommitResult` (CONSISTENCY-MODEL.md §8). A business
   * rejection carries neither label, so it aborts once and propagates
   * unchanged — the caller sees its own error, not a driver error.
   *
   * The session is ended in `finally`, so it is released whether the
   * transaction committed, aborted, or the callback threw.
   *
   * NO external call (HTTP, email, media upload) may appear inside `work`.
   * Authority: CONSISTENCY-MODEL.md §7; CODEBASE-STRUCTURE.md §6.4.
   */
  async run<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();

    try {
      return await session.withTransaction(work, TRANSACTION_OPTIONS);
    } finally {
      await session.endSession();
    }
  }
}
