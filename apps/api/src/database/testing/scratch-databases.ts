/**
 * One database per test suite, and the fence around dropping one.
 *
 * ## The damage this exists to prevent
 *
 * Every suite in this repository used to run against the SAME development
 * database, and each cleaned up after itself by tracked identity in a teardown.
 * That works exactly as long as the teardown runs.
 *
 * It did not. The admin browser suite shipped without one, placed a real order
 * per spec, and left the shared catalogue holding 62 accounts, 35 orders and
 * four products drained to zero stock. The failure surfaced in the STOREFRONT
 * suite — `/products › filters by brand and by stock` and the purchase journey
 * — which had nothing to do with the admin and was simply reading a catalogue
 * another suite had emptied. The guilty suite stayed green.
 *
 * Adding the missing teardown fixed that instance and nothing about the class.
 * A teardown only runs on the happy path, and this session alone has had a
 * database container die mid-run, a dev server run out of memory, and an editor
 * crash kill a run outright. Isolation that depends on a clean exit is not
 * isolation.
 *
 * So each suite gets its own database. A crashed run can now only pollute its
 * own, and the next run of that suite drops it wholesale rather than reasoning
 * about what it left behind. `PLAN.md` §20 item 7 recorded this as isolation
 * debt; it stopped being debt when it cost real debugging time.
 *
 * ## Why a fixed list rather than a derived name
 *
 * Because the operation guarded here is `dropDatabase`, and the guard has to be
 * something an accident cannot satisfy. A rule like "any name ending in _test"
 * is satisfied by a typo; a fixed set of three is satisfied only by one of the
 * three. `MONGODB_DB_NAME` is a general option the API accepts from anybody —
 * this module is what stops that option from pointing a DROP at a database
 * somebody cares about.
 */

/**
 * The suites that own a database. Adding one here is the whole registration:
 * `scratch-databases.spec.ts` then requires it to be reachable and named
 * consistently everywhere it is used.
 */
export const SCRATCH_SUITES = ['api-jest', 'storefront-e2e', 'admin-e2e'] as const;

export type ScratchSuite = (typeof SCRATCH_SUITES)[number];

/**
 * The database each suite runs against.
 *
 * The `scratch_` infix is not decoration: it is the substring a human scanning
 * `show dbs` needs in order to know which of these are safe to drop. The
 * development database is `nest_electronics_dev` and is deliberately not
 * spelled anything like these.
 *
 * These names are repeated as literals in `apps/storefront/e2e/origin.ts` and
 * `apps/admin/e2e/origin.ts`, because those files are in other workspaces and
 * importing across a workspace boundary would drag this application's
 * dependencies into their type-check. The repetition is SAFE rather than
 * merely tolerated: `assertIsAScratchDatabase` refuses anything not in this
 * object, so a drifted literal fails the very next run with a message naming
 * the value, and `scratch-databases.spec.ts` reads both files and asserts they
 * still agree.
 */
export const SCRATCH_DATABASES: Readonly<Record<ScratchSuite, string>> = {
  'api-jest': 'nest_electronics_scratch_api',
  'storefront-e2e': 'nest_electronics_scratch_storefront',
  'admin-e2e': 'nest_electronics_scratch_admin',
};

/** Raised instead of dropping something that is not a scratch database. */
export class NotAScratchDatabaseError extends Error {
  constructor(readonly database: string) {
    super(
      [
        `Refusing to touch the database "${database}": it is not a scratch database.`,
        '',
        'Only these three may be dropped and rebuilt by the test harness:',
        ...Object.entries(SCRATCH_DATABASES).map(
          ([suite, name]) => `  ${name.padEnd(34)} ${suite}`,
        ),
        '',
        'The database name comes from MONGODB_DB_NAME, falling back to whatever is',
        'in MONGODB_URI. Seeing this almost always means MONGODB_DB_NAME was not set',
        'and the command was about to rebuild a development database.',
      ].join('\n'),
    );
    this.name = 'NotAScratchDatabaseError';
  }
}

export function isAScratchDatabase(database: string): boolean {
  return Object.values(SCRATCH_DATABASES).includes(database);
}

/** The suite that owns a database, or `null` if no suite does. */
export function scratchSuiteOf(database: string): ScratchSuite | null {
  return (
    SCRATCH_SUITES.find((suite) => SCRATCH_DATABASES[suite] === database) ?? null
  );
}

export function assertIsAScratchDatabase(database: string): void {
  if (!isAScratchDatabase(database)) throw new NotAScratchDatabaseError(database);
}

/** Parses a `--suite` argument, listing the valid values when it is wrong. */
export function parseScratchSuite(value: string | undefined): ScratchSuite {
  const suite = SCRATCH_SUITES.find((candidate) => candidate === value);

  if (suite === undefined) {
    throw new Error(
      `--suite must be one of ${SCRATCH_SUITES.join(', ')}` +
        (value === undefined ? ' (it was not given)' : `, not "${value}"`),
    );
  }

  return suite;
}
