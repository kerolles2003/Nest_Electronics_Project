import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, VersioningType } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import mongoose, { Connection, Model, Schema } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { databaseConfig, type DatabaseConfig } from '../../src/config/database.config';
import {
  INDEX_SYNC_REMEDY,
  IndexHealthService,
} from '../../src/database/index-health.service';
import { Brand } from '../../src/modules/catalog/infrastructure/schemas/brand.schema';

/**
 * Readiness refuses traffic when a declared index is absent.
 *
 * Authority: docs/architecture/OBSERVABILITY.md §9; CODEBASE-STRUCTURE.md §6.1.
 *
 * ## The failure this exists to end
 *
 * `autoIndex` is off by design, so a database that never had `indexes:sync` run
 * against it connects, answers every query, and serves traffic — with several
 * unique constraints simply absent. That is not slower; it is WRONG, because
 * `CredentialRepository` and `CartRepository` catch MongoDB error 11000 and
 * translate it, and that is their entire concurrency control. No index, no
 * error, no `catch`, and the race quietly succeeds.
 *
 * A previous session opened with 19 red tests on a clean tree for exactly this
 * reason, and the tests were the only thing that noticed. A runbook step is not
 * a fix, because runbooks get skipped; refusing traffic is.
 *
 * ## Why one index is dropped for real
 *
 * The HTTP cases drop `brand_visibility` from the live development database and
 * put it back. That is the mechanism actually being claimed, so mocking the
 * check would leave the claim untested.
 *
 * `brand_visibility` specifically, and not a unique index, because the blast
 * radius of a failed restore has to be survivable: a missing NON-unique index
 * costs a collection scan on one admin query until `indexes:sync` runs. Dropping
 * `user_email_unique` to prove a point and then crashing would leave a database
 * that accepts duplicate accounts. The wrong-options case — which is the one a
 * name comparison would miss — is proven separately, on a scratch collection.
 */

const RUN_ID = randomUUID().slice(0, 8);
const SCRATCH_DB = `nest_index_health_${RUN_ID}`;
const DROPPED_INDEX = 'brand_visibility';

let app: INestApplication;
let brands: Model<Brand>;
let uri: string;

function http(): request.Agent {
  return request(app.getHttpServer());
}

/** Restores anything a case dropped, whether it asserted or threw. */
async function resyncBrandIndexes(): Promise<void> {
  await brands.syncIndexes();
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getStorageToken())
    .useValue({
      increment: () =>
        Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
    } satisfies ThrottlerStorage)
    .compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  await app.init();

  brands = app.get<Model<Brand>>(getModelToken(Brand.name));
  uri = app.get<DatabaseConfig>(databaseConfig.KEY).uri;

  // The suite asserts on a database that HAS its indexes. Establishing that
  // first means a failure below is the dropped index, not a machine that was
  // already in the state the probe is meant to catch.
  await resyncBrandIndexes();
});

afterAll(async () => {
  await resyncBrandIndexes();
  await app.close();
});

describe('GET /health/ready', () => {
  afterEach(resyncBrandIndexes);

  it('is 200 with every declared index present', async () => {
    const response = await http().get('/api/v1/health/ready').expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.checks.mongo.status).toBe('up');
    expect(response.body.checks.indexes.status).toBe('up');
    expect(response.body.checks.indexes.missing).toEqual([]);
    expect(response.body.checks.indexes.remedy).toBeNull();
  });

  it('returns exactly the documented body and nothing else', async () => {
    /*
     * An exact whole-body assertion, deliberately.
     *
     * This endpoint is unauthenticated, so anything that appears in it is
     * public. `toEqual` means a field cannot be added to a probe response
     * without a test failing and somebody deciding, on purpose, that the new
     * field is safe to publish. A version string or a host name arriving here
     * by accident is precisely the kind of thing that is never noticed.
     */
    const response = await http().get('/api/v1/health/ready').expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      checks: {
        mongo: { status: 'up', detail: null },
        indexes: {
          status: 'up',
          detail: null,
          missing: [],
          unexpected: [],
          remedy: null,
        },
      },
    });
  });

  it('checked a real, non-trivial number of indexes rather than none', async () => {
    /*
     * The check iterates `connection.models`. If a refactor ever left that
     * empty — a renamed export, a module not imported by AppModule — `missing`
     * would be `[]` and every other assertion here would still pass while the
     * probe verified nothing at all. This is the assertion that fails instead.
     */
    const report = await app.get(IndexHealthService).verify();

    expect(report.declared).toBeGreaterThanOrEqual(30);
  });

  it('is 503 and names the index when one is missing', async () => {
    await brands.collection.dropIndex(DROPPED_INDEX);

    const response = await http().get('/api/v1/health/ready').expect(503);

    expect(response.body.status).toBe('degraded');
    expect(response.body.checks.indexes.status).toBe('down');
    expect(response.body.checks.indexes.missing).toEqual([`brands.${DROPPED_INDEX}`]);

    // The remedy, verbatim, because the failure mode this ends was expensive
    // precisely because the state gave no clue what to do about it.
    expect(response.body.checks.indexes.remedy).toBe(INDEX_SYNC_REMEDY);
    expect(response.body.checks.indexes.detail).toContain(INDEX_SYNC_REMEDY);

    // And it must not blame the database, which is answering perfectly.
    expect(response.body.checks.mongo.status).toBe('up');
  });

  it('keeps LIVENESS green while readiness is red', async () => {
    /*
     * The single most important assertion in this file.
     *
     * A missing index is a reason to stop sending traffic and NOT a reason to
     * restart the process — restarting cannot create an index. If liveness
     * failed here, an orchestrator would kill every instance in a rolling loop
     * forever while the actual remedy went unrun. This is the same
     * outage-amplification trap that keeps MongoDB out of liveness, and it has
     * to hold for this check too.
     */
    await brands.collection.dropIndex(DROPPED_INDEX);

    await http().get('/api/v1/health/ready').expect(503);
    const liveness = await http().get('/api/v1/health').expect(200);

    expect(liveness.body).toEqual({ status: 'ok' });
  });

  it('goes green again once the indexes are restored, without a restart', async () => {
    /*
     * The recovery path, which is the reason the check holds no cache. An
     * operator who follows the remedy must see readiness change on the NEXT
     * probe. If they have to restart the process to clear a memoised verdict,
     * the remedy in the response is a lie.
     */
    await brands.collection.dropIndex(DROPPED_INDEX);
    await http().get('/api/v1/health/ready').expect(503);

    await resyncBrandIndexes();

    const recovered = await http().get('/api/v1/health/ready').expect(200);
    expect(recovered.body.checks.indexes.status).toBe('up');
  });
});

describe('IndexHealthService, against a scratch collection', () => {
  /*
   * A separate connection and a throwaway database, because these cases need
   * index states that must never exist in the development database — including
   * a unique constraint that is not enforced.
   */
  let scratch: Connection;
  let model: Model<{ email: string; note: string }>;

  beforeAll(async () => {
    /*
     * The same server, a database of its own, and its OWN client.
     *
     * `connection.useDb()` would be shorter and shares the application's
     * client — which means it cannot be closed without taking the application's
     * connection down with it, and jest then reports an open handle at the end
     * of the run. `dbName` overrides the database in the URI without parsing
     * it, so the two connections still cannot drift onto different servers.
     */
    scratch = mongoose.createConnection(uri, { dbName: SCRATCH_DB, autoIndex: false });
    await scratch.asPromise();

    const schema = new Schema<{ email: string; note: string }>(
      { email: String, note: String },
      { collection: 'scratch_things', autoIndex: false },
    );
    schema.index({ email: 1 }, { unique: true, name: 'scratch_email_unique' });
    schema.index({ note: 1 }, { name: 'scratch_note' });

    model = scratch.model('ScratchThing', schema);
  });

  afterAll(async () => {
    await scratch.dropDatabase();
    await scratch.close();
  });

  afterEach(async () => {
    await model.collection.drop().catch(() => undefined);
  });

  function service(): IndexHealthService {
    return new IndexHealthService(scratch);
  }

  it('reports every index missing on a database nothing has synced', async () => {
    const report = await service().verify();

    expect(report.missing.map((index) => index.name).sort()).toEqual([
      'scratch_email_unique',
      'scratch_note',
    ]);
    expect(report.declared).toBe(2);
  });

  it('reports nothing missing once they are created', async () => {
    await model.createIndexes();

    const report = await service().verify();

    expect(report.missing).toEqual([]);
    expect(report.unexpected).toEqual([]);
  });

  it('catches an index that exists under the right NAME but is not unique', async () => {
    /*
     * The case a name comparison cannot see, and the reason this uses Mongoose's
     * own `diffIndexes()` — the same primitive `syncIndexes()` uses, so the
     * probe cannot disagree with the command it recommends.
     *
     * An index called `scratch_email_unique` exists. Anything asking "is there
     * an index by that name?" is satisfied. It enforces nothing, and the second
     * half of this test proves that rather than asserting it: two documents with
     * the same email are stored.
     */
    await model.collection.createIndex({ email: 1 }, { name: 'scratch_email_unique' });
    await model.collection.createIndex({ note: 1 }, { name: 'scratch_note' });

    await model.create({ email: 'same@example.test', note: 'first' });
    await model.create({ email: 'same@example.test', note: 'second' });
    expect(await model.countDocuments({ email: 'same@example.test' })).toBe(2);

    const report = await service().verify();

    expect(report.missing.map((index) => index.name)).toEqual(['scratch_email_unique']);
  });

  it('reports an undeclared index as unexpected, and does NOT call it missing', async () => {
    /*
     * An extra index wastes write throughput. It breaks no invariant, so
     * refusing traffic over it would turn a tidy-up into an outage. Reported,
     * never fatal — and `missing` staying empty is what keeps readiness green.
     */
    await model.createIndexes();
    await model.collection.createIndex({ note: -1, email: 1 }, { name: 'scratch_rogue' });

    const report = await service().verify();

    expect(report.missing).toEqual([]);
    expect(report.unexpected).toEqual([
      { collection: 'scratch_things', name: 'scratch_rogue' },
    ]);
  });
});
