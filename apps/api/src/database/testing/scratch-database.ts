import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import {
  describeDrift,
  observeScratchDatabase,
  readBaseline,
  seedFingerprint,
  writeBaseline,
} from './scratch-baseline';
import {
  SCRATCH_DATABASES,
  assertIsAScratchDatabase,
  type ScratchSuite,
} from './scratch-databases';

/**
 * Preparing a suite's own database, and refusing to finish a run that dirtied
 * it.
 *
 * Two operations, used at the two ends of every run:
 *
 *   ensureCleanScratchDatabase   before  — hand the suite a known database
 *   assertScratchDatabaseIsClean after   — fail the run if it left anything
 *
 * ## Rebuilt when dirty, reused when clean
 *
 * The instruction this implements says the next run should drop the database
 * wholesale rather than reason about what the last one left behind. It does —
 * but only when there is something to drop. A run that ended clean leaves a
 * database that matches its recorded baseline exactly, and rebuilding that is
 * ~20 seconds of seeding to arrive at the state already present.
 *
 * The distinction that matters is preserved: nothing here ever works out WHAT
 * to remove. The judgement is binary — the database either matches the
 * baseline or it does not — and the remedy for "does not" is always the same
 * total drop. There is no surgical cleanup path to get subtly wrong, which was
 * the whole failure mode.
 *
 * ## Two fences before any drop
 *
 * `assertConnectedTo` proves `MONGODB_DB_NAME` actually took effect, so a
 * silently ignored environment variable cannot leave the connection pointed at
 * a development database. `assertIsAScratchDatabase` then checks the name the
 * SERVER reports, not the name that was asked for. Both have to pass.
 *
 * They earned it on the first run. `AppModule` and the seeds were imported at
 * the top of this file, and `ConfigModule.forRoot()` executes INSIDE the
 * `@Module` decorator argument — so the environment was read, validated and
 * frozen the moment this module was imported, which is before any function
 * here could set `MONGODB_DB_NAME`. The connection landed on
 * `nest_electronics_dev` and the next statement would have dropped it. Every
 * import that reaches `AppModule` is therefore deferred to the point of use,
 * below, and the fence stays as the thing that catches the next version of
 * this mistake.
 */

const logger = new Logger('ScratchDatabase');

/** Residue. Raised at the end of a run that did not clean up after itself. */
export class ScratchResidueError extends Error {
  constructor(
    readonly suite: ScratchSuite,
    readonly database: string,
    readonly drift: readonly string[],
  ) {
    super(
      [
        `The ${suite} suite left ${String(drift.length)} thing(s) behind in ${database}:`,
        '',
        ...drift.map((line) => `  · ${line}`),
        '',
        'The suite teardown is meant to leave this database exactly as preparation',
        'found it. Something it creates is not being removed, or stock it consumed is',
        'not being given back.',
        '',
        'This is reported as a FAILURE rather than a log line because residue is',
        'invisible until it breaks a different suite — which is how a drained',
        'catalogue was first noticed in the storefront tests rather than in the admin',
        'ones that caused it.',
        '',
        'The next run of this suite will rebuild the database, so the damage stops',
        'here. The teardown is still the thing to fix.',
      ].join('\n'),
    );
    this.name = 'ScratchResidueError';
  }
}

/**
 * Points this process at a suite's database.
 *
 * Exported because the callers that do not want the whole preparation — jest's
 * per-file setup, for instance — still need the environment variable set
 * before anything reads the configuration.
 */
export function useScratchDatabase(suite: ScratchSuite): string {
  const database = SCRATCH_DATABASES[suite];

  assertIsAScratchDatabase(database);
  process.env['MONGODB_DB_NAME'] = database;

  return database;
}

export interface ScratchPreparation {
  readonly database: string;
  readonly rebuilt: boolean;
  /** Why it was rebuilt. Empty when it was already clean. */
  readonly reasons: readonly string[];
}

export async function ensureCleanScratchDatabase(
  suite: ScratchSuite,
): Promise<ScratchPreparation> {
  const database = useScratchDatabase(suite);

  const reasons = await withConnection(async (connection) => {
    assertConnectedTo(connection, database);

    const drift = describeDrift(
      await readBaseline(connection),
      await observeScratchDatabase(connection),
    );

    if (drift.length === 0) return drift;

    // The second fence: the name the server reports for this connection, not
    // the name we asked for. Nothing is dropped until both agree.
    assertIsAScratchDatabase(databaseNameOf(connection));
    await connection.dropDatabase();

    return drift;
  });

  if (reasons.length === 0) {
    /*
     * Indexes are synchronised even on the fast path, and that is not belt and
     * braces — it closes a real gap.
     *
     * The baseline fingerprints the seed DATA. It says nothing about the
     * indexes the schemas declare, so adding one to a schema does not make a
     * clean database look dirty: the next run reuses it, the index is absent,
     * and `autoIndex` is off so nothing creates it. Every test of that index
     * then fails for a reason that has nothing to do with the code under test.
     *
     * `syncIndexes()` converges — it creates what is missing and drops what is
     * no longer declared — so running it always costs one context boot and
     * removes the whole class.
     *
     * Index names are deliberately NOT part of the baseline instead. That would
     * detect a hand-dropped index, but `test/infrastructure/index-health.spec.ts`
     * drops `brand_visibility` on purpose and puts it back, so a baseline that
     * tracked indexes would report that suite's own fixture as residue.
     */
    const { syncDeclaredIndexes } = await import('../sync-indexes');

    await syncDeclaredIndexes();

    logger.log(`${database} is clean; reusing it`);

    return { database, rebuilt: false, reasons };
  }

  logger.log(`rebuilding ${database}: ${reasons.join('; ')}`);

  /*
   * Indexes FIRST, because `autoIndex` is off: a freshly dropped database has
   * no unique constraints at all, and the seed's own upserts are the first
   * thing that would rely on them.
   */
  // Deferred imports, for the reason in the file note: each of these modules
  // reaches `AppModule`, and importing one before the database name is set
  // freezes the configuration on the wrong database.
  const { syncDeclaredIndexes } = await import('../sync-indexes');
  const { seedDevelopmentCatalogue } = await import('../seed/seed');
  const { seedShippingRates } = await import('../seed/shipping-seed');
  const { seedDevelopmentAdmin } = await import('../seed/dev-admin.seed');

  await syncDeclaredIndexes();
  await seedDevelopmentCatalogue();
  await seedShippingRates();
  /*
   * The development admin is seeded into EVERY scratch database, not just the
   * admin suite's. It is what makes the three databases equivalent to a
   * developer's own, so no suite behaves differently for having landed in one
   * rather than the other — and `staff-provisioning.spec.ts` already runs
   * against a database that has one.
   */
  await seedDevelopmentAdmin();

  await withConnection(async (connection) => {
    assertConnectedTo(connection, database);

    await writeBaseline(connection, {
      suite,
      seedFingerprint: seedFingerprint(),
      preparedAt: new Date().toISOString(),
      ...(await observeScratchDatabase(connection)),
    });
  });

  logger.log(`${database} rebuilt`);

  return { database, rebuilt: true, reasons };
}

/** Throws `ScratchResidueError` naming everything the run left behind. */
export async function assertScratchDatabaseIsClean(suite: ScratchSuite): Promise<void> {
  const database = useScratchDatabase(suite);

  const drift = await withConnection(async (connection) => {
    assertConnectedTo(connection, database);

    return describeDrift(
      await readBaseline(connection),
      await observeScratchDatabase(connection),
    );
  });

  if (drift.length > 0) throw new ScratchResidueError(suite, database, drift);

  logger.log(`${database} is exactly as this run found it`);
}

async function withConnection<T>(run: (connection: Connection) => Promise<T>): Promise<T> {
  /*
   * Imported here, and not at the top of the file. See the note above: this
   * import is what reads and freezes the environment, so it must not happen
   * until `useScratchDatabase` has set the database name.
   */
  const { AppModule } = await import('../../app.module');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  const connection = app.get<Connection>(getConnectionToken());

  try {
    return await run(connection);
  } finally {
    await app.close();
    // `app.close()` should release it; closing again is a no-op if it did, and
    // the difference between the two is a process that will not exit.
    await connection.close();
  }
}

function databaseNameOf(connection: Connection): string {
  const name = connection.db?.databaseName;

  if (name === undefined) {
    throw new Error('the connection reports no database name; refusing to touch anything');
  }

  return name;
}

/**
 * Proves the database override reached the driver.
 *
 * Without this the failure is silent and catastrophic: `MONGODB_DB_NAME` is
 * ignored for any reason, the connection lands on whatever `MONGODB_URI` names
 * — a development database — and the next line would drop it.
 */
function assertConnectedTo(connection: Connection, expected: string): void {
  const actual = databaseNameOf(connection);

  if (actual === expected) return;

  throw new Error(
    [
      `Expected to be connected to "${expected}" but the driver reports "${actual}".`,
      '',
      'MONGODB_DB_NAME did not take effect. Nothing has been dropped or written.',
      'Check that DatabaseModule still passes `dbName` through to Mongoose.',
    ].join('\n'),
  );
}
