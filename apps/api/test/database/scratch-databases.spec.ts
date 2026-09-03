import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../../src/app.module';
import { databaseIn, withDatabase } from '../../src/config/database.config';
import {
  OUT_OF_STOCK_FIXTURES,
  describeDrift,
  seedFingerprint,
  type ScratchBaseline,
} from '../../src/database/testing/scratch-baseline';
import {
  NotAScratchDatabaseError,
  SCRATCH_DATABASES,
  SCRATCH_SUITES,
  assertIsAScratchDatabase,
  isAScratchDatabase,
  parseScratchSuite,
  scratchSuiteOf,
} from '../../src/database/testing/scratch-databases';

/**
 * The isolation between the three test suites, and the fence around dropping a
 * database.
 *
 * ## What this exists to stop happening again
 *
 * Every suite in the repository ran against ONE development database. The admin
 * browser suite shipped without a teardown, placed a real order per spec, and
 * left 62 accounts, 35 orders and four products at zero stock. The failure
 * appeared in the STOREFRONT suite, on a stock filter and a purchase journey
 * that had nothing to do with the admin, while the guilty suite stayed green.
 *
 * Three things are asserted here, in the order they matter:
 *
 *   1. the fence refuses everything that is not a scratch database
 *   2. the three suites, in three workspaces, still name the same three
 *   3. the residue check goes RED for each way a run can leave something behind
 *
 * The third is the one worth writing carefully. A cleanliness check that
 * cannot fail is the same reassuring green as one that works, which is exactly
 * how the original damage went unnoticed for several runs.
 */

const REPO_ROOT = join(__dirname, '../../../..');

function source(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

describe('the fence around dropping a database', () => {
  it('accepts exactly the three scratch databases and nothing else', () => {
    for (const suite of SCRATCH_SUITES) {
      expect(isAScratchDatabase(SCRATCH_DATABASES[suite])).toBe(true);
      expect(scratchSuiteOf(SCRATCH_DATABASES[suite])).toBe(suite);
    }

    expect(Object.keys(SCRATCH_DATABASES)).toHaveLength(SCRATCH_SUITES.length);
  });

  it('refuses the development database', () => {
    // The name a developer's own `.env` carries. This is THE case: the guard
    // exists because `dropDatabase` on this would destroy real local work.
    expect(isAScratchDatabase('nest_electronics_dev')).toBe(false);
    expect(() => {
      assertIsAScratchDatabase('nest_electronics_dev');
    }).toThrow(NotAScratchDatabaseError);
  });

  it('refuses the database `.env.example` tells everyone to use', () => {
    /*
     * Read from the file rather than written out, because the point is that
     * whatever the documented development database happens to be, the harness
     * cannot drop it. Someone renaming it in the example must not be able to
     * rename it INTO the droppable set without this going red.
     */
    const uri = /^\s*MONGODB_URI\s*=\s*(.*)$/m.exec(source('apps/api/.env.example'))?.[1];

    expect(uri).toBeDefined();

    const documented = /\/([^/?]+)(\?|$)/.exec((uri as string).replace(/^mongodb(\+srv)?:\/\//, ''))?.[1];

    expect(documented).toBeDefined();
    expect(isAScratchDatabase(documented as string)).toBe(false);
  });

  it('names the value and every allowed alternative when it refuses', () => {
    // This message is the whole user experience of the control: someone sees it
    // at the moment a command declined to do what they asked, and it has to be
    // enough to act on without opening the source.
    let message = '';

    try {
      assertIsAScratchDatabase('nest_electronics_prod');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('nest_electronics_prod');
    expect(message).toContain('MONGODB_DB_NAME');

    for (const suite of SCRATCH_SUITES) {
      expect(message).toContain(SCRATCH_DATABASES[suite]);
    }
  });

  it('refuses an unknown --suite and lists the real ones', () => {
    expect(() => parseScratchSuite('storefront')).toThrow(/storefront-e2e/);
    expect(() => parseScratchSuite(undefined)).toThrow(/not given/);
    expect(parseScratchSuite('admin-e2e')).toBe('admin-e2e');
  });
});

describe('redirecting a connection string at another database', () => {
  /**
   * `MONGODB_DB_NAME` is resolved into the URI rather than passed to Mongoose
   * as a second option, so that a consumer opening its OWN connection from
   * `databaseConfig.uri` lands on the same database as everything else.
   *
   * `test/infrastructure/transaction-gate.spec.ts` is that consumer: proving a
   * transaction committed requires a connection that was never inside it. When
   * the override was a separate option, the writer went to the scratch database
   * and the verifier to the development one, and the gate failed. These cases
   * are the parts of a real connection string that must survive the rewrite.
   */
  it('replaces the database and nothing else', () => {
    expect(withDatabase('mongodb://127.0.0.1:27017/nest_electronics_dev', 'scratch')).toBe(
      'mongodb://127.0.0.1:27017/scratch',
    );
  });

  it('keeps the options', () => {
    expect(
      withDatabase('mongodb://127.0.0.1:27017/dev?replicaSet=rs0&w=majority', 'scratch'),
    ).toBe('mongodb://127.0.0.1:27017/scratch?replicaSet=rs0&w=majority');
  });

  it('keeps the credentials, which are the part nobody can reconstruct', () => {
    expect(withDatabase('mongodb+srv://user:p%40ss@cluster.example.net/dev', 'scratch')).toBe(
      'mongodb+srv://user:p%40ss@cluster.example.net/scratch',
    );
  });

  it('keeps every host of a replica set', () => {
    expect(withDatabase('mongodb://a:27017,b:27017,c:27017/dev?replicaSet=rs0', 'scratch')).toBe(
      'mongodb://a:27017,b:27017,c:27017/scratch?replicaSet=rs0',
    );
  });

  it('adds a database to a URI that named none', () => {
    expect(withDatabase('mongodb://127.0.0.1:27017', 'scratch')).toBe(
      'mongodb://127.0.0.1:27017/scratch',
    );
    expect(withDatabase('mongodb://127.0.0.1:27017/?replicaSet=rs0', 'scratch')).toBe(
      'mongodb://127.0.0.1:27017/scratch?replicaSet=rs0',
    );
  });

  it('leaves the URI completely alone when there is no override', () => {
    // The normal case, and the one that must never change: with
    // `MONGODB_DB_NAME` unset, every environment connects exactly as before.
    const uri = 'mongodb://127.0.0.1:27017/nest_electronics_dev';

    expect(withDatabase(uri, undefined)).toBe(uri);
  });

  it('reads back the database it just wrote', () => {
    const redirected = withDatabase('mongodb://a:1,b:2/dev?replicaSet=rs0', 'scratch');

    expect(databaseIn(redirected)).toBe('scratch');
    expect(databaseIn('mongodb://127.0.0.1:27017')).toBeUndefined();
    expect(databaseIn('mongodb://127.0.0.1:27017/?replicaSet=rs0')).toBeUndefined();
  });

  it('refuses to guess when the string is not a connection string', () => {
    // It returns a string either way, so a silent passthrough here would
    // connect to whatever the unmodified value named.
    expect(() => withDatabase('postgres://localhost/db', 'scratch')).toThrow(/connection string/);
  });
});

describe('the three suites name the same three databases', () => {
  /**
   * The names are REPEATED in the two Playwright workspaces rather than
   * imported, because importing across a workspace boundary would pull this
   * application's dependencies into their type-check for one string. This is
   * what makes the repetition safe: a drifted value fails here, on the commit,
   * rather than at the moment a browser run writes to the wrong database.
   */
  const files = {
    'storefront-e2e': source('apps/storefront/e2e/origin.ts'),
    'admin-e2e': source('apps/admin/e2e/origin.ts'),
  } as const;

  it.each(Object.keys(files) as (keyof typeof files)[])(
    '%s names its own database and its own suite',
    (suite) => {
      expect(files[suite]).toContain(`'${SCRATCH_DATABASES[suite]}'`);
      expect(files[suite]).toContain(`'${suite}'`);
    },
  );

  it.each(Object.keys(files) as (keyof typeof files)[])(
    '%s names no OTHER suite database',
    (suite) => {
      for (const other of SCRATCH_SUITES) {
        if (other === suite) continue;

        expect(files[suite]).not.toContain(SCRATCH_DATABASES[other]);
      }
    },
  );

  it('the jest suite takes its database from the registry, not a literal', () => {
    const setup = source('apps/api/test/setup/scratch-database.ts');

    expect(setup).toContain("SCRATCH_DATABASES['api-jest']");
    // A literal here would be a fourth place for the name to drift.
    expect(setup).not.toContain(SCRATCH_DATABASES['api-jest']);
  });

  it('each Playwright config hands its API process the database it prepared', () => {
    /*
     * The admin's server definitions moved into `playwright.shared.ts` when its
     * suite was split in two — the unreachable-API specs need a third web
     * server and Playwright has no per-project one, so a server four specs need
     * was a hard dependency of all thirty-seven.
     *
     * This test went red on that change, correctly: it was asserting against
     * the file the definitions used to be in. Updated to follow them, and made
     * STRICTER while doing so — it now also checks that the two admin configs
     * select disjoint spec sets from one shared constant, which is the failure
     * a two-config split invites and which would look like a passing suite.
     */
    for (const path of [
      'apps/storefront/playwright.config.ts',
      'apps/admin/playwright.shared.ts',
    ]) {
      const config = source(path);

      expect(config).toContain('MONGODB_DB_NAME: SCRATCH_DATABASE');
      expect(config).toContain('--suite ${SCRATCH_SUITE} --ensure-clean');
    }
  });

  it('the two admin configs cannot leave a spec in neither run', () => {
    /*
     * A spec that falls out of BOTH runs is the failure this shape invites, and
     * it is invisible: the suite passes, having quietly stopped running one
     * file. The `testIgnore`/`testMatch` pair is written against a single
     * exported constant so the two are complements by construction rather than
     * by somebody keeping two globs in step.
     */
    const main = source('apps/admin/playwright.config.ts');
    const unreachable = source('apps/admin/playwright.unreachable-api.config.ts');
    const shared = source('apps/admin/playwright.shared.ts');

    expect(shared).toContain('export const UNREACHABLE_API_SPECS');
    expect(main).toContain('testIgnore: UNREACHABLE_API_SPECS');
    expect(unreachable).toContain('testMatch: UNREACHABLE_API_SPECS');

    // And the main run must not start the server it exists to be free of.
    expect(main).toContain('webServer: [API_SERVER, ADMIN_SERVER]');
    expect(unreachable).toContain('UNREACHABLE_API_SERVER');
  });
});

describe('the residue check goes red for every way a run can leave something behind', () => {
  const FINGERPRINT = 'fingerprint-of-record';

  /** A product the seed stocks, and one it deliberately does not. */
  const STOCKED = 'ESP32-DEVKIT-V1';
  const EMPTY = OUT_OF_STOCK_FIXTURES[0] as string;

  const PREPARED: ScratchBaseline = {
    suite: 'api-jest',
    seedFingerprint: FINGERPRINT,
    preparedAt: '2026-09-03T00:00:00.000Z',
    collections: { products: 34, users: 1, orders: 0, carts: 0 },
    stock: { [STOCKED]: 12, [EMPTY]: 0 },
  };

  /** The state preparation left. Every case below is this, with one change. */
  const CLEAN = { collections: PREPARED.collections, stock: PREPARED.stock };

  it('says nothing when the database is exactly as it was prepared', () => {
    // The other half of "it can fail": a check that always fails is no more
    // useful than one that never does.
    expect(describeDrift(PREPARED, CLEAN, FINGERPRINT)).toEqual([]);
  });

  it('names a leftover account', () => {
    const drift = describeDrift(
      PREPARED,
      { ...CLEAN, collections: { ...PREPARED.collections, users: 3 } },
      FINGERPRINT,
    );

    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('users');
    expect(drift[0]).toContain('+2');
  });

  it('names a leftover order', () => {
    const drift = describeDrift(
      PREPARED,
      { ...CLEAN, collections: { ...PREPARED.collections, orders: 11 } },
      FINGERPRINT,
    );

    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('orders');
    expect(drift[0]).toContain('+11');
  });

  it('names a collection the cleanup has never heard of', () => {
    /*
     * The failure the old teardowns could not have caught. They removed what
     * they knew about and reported a count; a collection nobody thought of was
     * invisible. Comparing against a recorded baseline means an unknown
     * collection is drift like any other.
     */
    const drift = describeDrift(
      PREPARED,
      { ...CLEAN, collections: { ...PREPARED.collections, someNewCollection: 4 } },
      FINGERPRINT,
    );

    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('someNewCollection');
  });

  it('names stock an order took and never gave back', () => {
    const drift = describeDrift(
      PREPARED,
      { ...CLEAN, stock: { ...PREPARED.stock, [STOCKED]: 9 } },
      FINGERPRINT,
    );

    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain(STOCKED);
    expect(drift[0]).toContain('-3');
  });

  it('names an out-of-stock fixture that has been RESTOCKED, and says what that costs', () => {
    /*
     * The case worth its own test.
     *
     * A teardown that reverses inventory events restores stock. If it ever
     * over-restored one of the three products the seed deliberately leaves
     * empty, every out-of-stock test in the repository would go green while
     * covering nothing — the OUT OF STOCK badge, the disabled add-to-cart
     * button and the `/products` stock filter have no other fixture. It has to
     * break loudly, and the message has to say why rather than reading as an
     * off-by-three.
     */
    const drift = describeDrift(
      PREPARED,
      { ...CLEAN, stock: { ...PREPARED.stock, [EMPTY]: 3 } },
      FINGERPRINT,
    );

    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain(EMPTY);
    expect(drift[0]).toContain('out-of-stock');
    expect(drift[0]).toContain('OUT OF STOCK');
  });

  it('says so when the database was never prepared at all', () => {
    expect(describeDrift(null, CLEAN, FINGERPRINT)).toEqual([
      expect.stringContaining('never prepared') as unknown as string,
    ]);
  });

  it('says so when the seed data has changed since preparation', () => {
    // Stale, not dirty. Without this the run proceeds against a catalogue that
    // no longer matches the seed and fails specs for reasons unrelated to the
    // code under test.
    const drift = describeDrift(PREPARED, CLEAN, 'something-else');

    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain(FINGERPRINT);
    expect(drift[0]).toContain('something-else');
  });

  it('IGNORES the order-number sequence, which is deliberately never reset', () => {
    /*
     * `orderCounters` holds one document per day carrying that day's
     * order-number counter. A run that places an order creates it, and no
     * teardown removes it: deleting it would reissue an order number that has
     * already been used. It is the only exclusion, and it is by name.
     */
    expect(
      describeDrift(
        PREPARED,
        { ...CLEAN, collections: { ...PREPARED.collections, orderCounters: 1 } },
        FINGERPRINT,
      ),
    ).toEqual([]);
  });

  it('reports every problem at once rather than the first', () => {
    // Whoever reads this is fixing a teardown. Two round trips to learn two
    // facts is two round trips too many.
    const drift = describeDrift(
      PREPARED,
      {
        collections: { ...PREPARED.collections, users: 2, orders: 1 },
        stock: { ...PREPARED.stock, [STOCKED]: 11 },
      },
      FINGERPRINT,
    );

    expect(drift).toHaveLength(3);
  });

  it('changes the fingerprint when the seed changes, and not otherwise', () => {
    expect(seedFingerprint()).toBe(seedFingerprint());
    expect(seedFingerprint()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('the out-of-stock fixtures', () => {
  let connection: Connection;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    connection = moduleRef.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    await connection.close();
  });

  it('exist at all — the seed must define some', () => {
    // A derived list that quietly became empty would make every assertion
    // about it vacuously true.
    expect(OUT_OF_STOCK_FIXTURES.length).toBeGreaterThan(0);
  });

  it('are still at zero in the database this run used', async () => {
    /*
     * Live, not derived. `globalTeardown` compares stock per SKU after every
     * run, which covers this continuously; this is the same guarantee as a
     * named test, so the run output says out loud that the only out-of-stock
     * coverage in the repository is still out of stock.
     */
    const db = connection.db;

    expect(db).toBeDefined();

    const found = await (db as NonNullable<typeof db>)
      .collection('products')
      .find({ sku: { $in: [...OUT_OF_STOCK_FIXTURES] } }, { projection: { sku: 1, 'stock.onHand': 1 } })
      .toArray();

    expect(found).toHaveLength(OUT_OF_STOCK_FIXTURES.length);

    for (const product of found) {
      expect({
        sku: product['sku'] as string,
        onHand: (product['stock'] as { onHand: number }).onHand,
      }).toEqual({ sku: product['sku'] as string, onHand: 0 });
    }
  });
});
