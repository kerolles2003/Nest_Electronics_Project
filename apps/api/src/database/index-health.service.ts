import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, type Model } from 'mongoose';

/**
 * Verifies that every index the schemas declare actually exists.
 *
 * Authority: docs/architecture/CODEBASE-STRUCTURE.md §6.1 and OBSERVABILITY.md
 * §9 — indexes are declared on the schema but created by an explicit step,
 * never by `autoIndex`.
 *
 * ## Why this exists
 *
 * `autoIndex: false` is correct and stays. Its cost is that a database with no
 * indexes is a SILENT state: the driver connects, every query still returns the
 * right answer (slowly), and the application serves traffic looking perfectly
 * healthy. A session opened with 19 red tests on a clean tree for exactly this
 * reason, and the tests were the only thing that noticed.
 *
 * On a *fresh* deployment the consequence is worse than slow queries, because
 * several unique indexes are not optimisations at all — they are the mechanism
 * by which an invariant is enforced:
 *
 *   `user_email_unique`                 two accounts on one address
 *   `order_idempotency_key_unique`      a retried checkout becomes two orders
 *   `inventory_event_reference_unique`  one order line decrements stock twice
 *   `cart_user_unique`                  a customer holding two carts
 *
 * `CredentialRepository` and `CartRepository` both CATCH MongoDB error 11000
 * and translate it into a domain error. That is their entire concurrency
 * control. Without the index the error never arrives, the `catch` never runs,
 * and the race silently succeeds. A guarantee that can be absent without
 * anything saying so is not a guarantee, so readiness asserts it.
 *
 * ## Why `diffIndexes()` rather than comparing names
 *
 * `diffIndexes()` is the primitive `syncIndexes()` itself uses, so the probe
 * cannot disagree with the command it tells you to run.
 *
 * It also catches the case a name comparison misses. An index created without
 * `unique` under the declared NAME looks present to any check that asks "is
 * there an index called `user_email_unique`?" — and enforces nothing. Measured:
 * such an index reports in `toDrop` *and* `toCreate`, while the collection
 * happily stored two duplicate documents. Fail on `toCreate` and that case is
 * covered; compare names and it is not.
 *
 * ## Why an extra index does not fail readiness
 *
 * `toDrop` on its own means the database has an index the schemas no longer
 * declare. That wastes write throughput but breaks no invariant, and refusing
 * traffic over it would turn a tidy-up into an outage. It is reported so the
 * information is not lost, and `indexes:sync` removes it.
 */

/** The command that fixes every condition this service reports. */
export const INDEX_SYNC_REMEDY = 'pnpm --filter api indexes:sync';

export interface MissingIndex {
  /** The Mongo collection, e.g. `users`. */
  collection: string;
  /** The declared index name, e.g. `user_email_unique`. */
  name: string;
}

export interface IndexHealthReport {
  /** Declared but absent, or present with the wrong options. Fails readiness. */
  missing: MissingIndex[];
  /** Present but no longer declared. Reported only; does not fail readiness. */
  unexpected: MissingIndex[];
  /** Total number of declared indexes checked, `_id_` excluded. */
  declared: number;
}

/**
 * Mongoose's own default name for an index key, used only when a declared
 * index has no explicit `name`. Every index in this codebase names itself, so
 * this is a fallback that should never be reached — but a report that said
 * `<unnamed>` would send someone hunting through schema files by hand.
 */
function defaultIndexName(key: Record<string, unknown>): string {
  return Object.entries(key)
    .map(([field, direction]) => `${field}_${String(direction)}`)
    .join('_');
}

@Injectable()
export class IndexHealthService {
  private readonly logger = new Logger(IndexHealthService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * One `listIndexes` per model, issued in parallel.
   *
   * Deliberately NOT cached. The obvious optimisation — remember a healthy
   * verdict for a while — buys a few milliseconds and costs two things worth
   * more: readiness would keep reporting green for the cache lifetime after an
   * index was dropped, and it would keep reporting red for the cache lifetime
   * after `indexes:sync` fixed it, so the operator following the remedy would
   * see no response and reach for a restart. Measured at 13 collections the
   * whole check is a single round trip's latency; that is not worth staleness.
   */
  async verify(): Promise<IndexHealthReport> {
    const models = Object.values(this.connection.models);
    const reports = await Promise.all(models.map((model) => this.verifyModel(model)));

    return reports.reduce<IndexHealthReport>(
      (total, one) => ({
        missing: [...total.missing, ...one.missing],
        unexpected: [...total.unexpected, ...one.unexpected],
        declared: total.declared + one.declared,
      }),
      { missing: [], unexpected: [], declared: 0 },
    );
  }

  private async verifyModel(model: Model<unknown>): Promise<IndexHealthReport> {
    const collection = model.collection.name;
    const declared = model.schema.indexes();

    if (declared.length === 0) {
      return { missing: [], unexpected: [], declared: 0 };
    }

    try {
      const { toCreate, toDrop } = await model.diffIndexes();

      return {
        missing: toCreate.map((key) => ({
          collection,
          name: this.nameOf(model, key),
        })),
        unexpected: toDrop.map((name) => ({ collection, name })),
        declared: declared.length,
      };
    } catch (error) {
      /*
       * An unreadable catalogue is not the same as a missing index, and the two
       * must not be reported as one. Readiness already fails on the Mongo ping
       * when the database is unreachable; reporting every index of this
       * collection as "missing" here would send an operator to run
       * `indexes:sync` against a database that is not answering.
       */
      this.logger.warn(
        `could not read indexes for ${collection}: ` +
          (error instanceof Error ? error.message.slice(0, 120) : 'unknown'),
      );

      return { missing: [], unexpected: [], declared: declared.length };
    }
  }

  /**
   * Resolves an index key back to the name its schema declares.
   *
   * `diffIndexes()` reports keys, not names, and a key is what a schema file
   * is searched by while a name is what `listIndexes` shows — the report needs
   * the name to be actionable.
   */
  private nameOf(model: Model<unknown>, key: Record<string, unknown>): string {
    const wanted = JSON.stringify(key);

    for (const [declaredKey, options] of model.schema.indexes()) {
      if (JSON.stringify(declaredKey) !== wanted) {
        continue;
      }

      const name: unknown = options?.['name'];

      return typeof name === 'string' ? name : defaultIndexName(key);
    }

    return defaultIndexName(key);
  }
}
