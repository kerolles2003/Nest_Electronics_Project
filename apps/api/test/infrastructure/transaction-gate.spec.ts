import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import type { Connection, mongo } from 'mongoose';
import { AppModule } from '../../src/app.module';
import { databaseConfig, type DatabaseConfig } from '../../src/config/database.config';
import { TransactionService } from '../../src/database/transaction.service';

/**
 * THE PHASE 2.5 TRANSACTION HARD GATE.
 *
 * Authority: docs/architecture/CONSISTENCY-MODEL.md §1, §9;
 *            docs/architecture/TESTING-ARCHITECTURE.md §5 (Level 3 —
 *            Infrastructure: "the transaction-rollback test is the Phase 2
 *            completion gate");
 *            docs/architecture/ARCHITECTURE-FREEZE-RATIFICATION.md §11 gate 4.
 *
 * This is INFRASTRUCTURE VERIFICATION, not a domain test. It proves that the
 * MongoDB instance behind `MONGODB_URI` — whichever environment that is —
 * genuinely commits and genuinely rolls back multi-document transactions,
 * through the application's own `DatabaseModule` connection and its own
 * `TransactionService`.
 *
 * WHAT COUNTS AS PROOF. Only observed database state. An exception is not
 * evidence of atomicity: a transaction that threw and left both documents
 * behind throws exactly the same exception as one that rolled back correctly.
 * Every assertion below therefore queries MongoDB after the session has ended,
 * over a SEPARATE connection that never saw the session.
 *
 * WHAT IT MUST NOT TOUCH. No application collection, in any environment. Two
 * throwaway collections hold two-field documents that model nothing. Every
 * document carries the `runId` of the execution that wrote it; every
 * verification and every deletion filters on that exact value. The gate is
 * safe to run repeatedly, concurrently with itself, and against staging.
 */

// ---------------------------------------------------------------------------
// Test-only persistence
// ---------------------------------------------------------------------------

/**
 * Deliberately not `users`, `orders`, `products` or any other name in
 * MONGODB-DESIGN.md §2. Two collections rather than one because atomicity has
 * to be observed across a COLLECTION BOUNDARY: a single-document write is
 * atomic without any transaction at all and would prove nothing.
 */
const COLLECTION_A = 'transaction_gate_a';
const COLLECTION_B = 'transaction_gate_b';

/**
 * The minimum shape that supports run isolation. No timestamps, no enums, no
 * money, no relationships: the subject is transaction atomicity, not schema
 * design. A type alias rather than an interface so the driver accepts it as a
 * `Document`.
 */
type GateDocument = {
  runId: string;
  marker: string;
};

/** Thrown to abort a transaction. Deterministic, in-process, no timing, no I/O. */
class ForcedGateFailure extends Error {
  constructor(runId: string) {
    super(`forced transaction-gate failure for run ${runId}`);
    this.name = 'ForcedGateFailure';
  }
}

interface TopologyEvidence {
  setName: string | null;
  isWritablePrimary: boolean;
  msg: string | null;
  me: string | null;
  memberCount: number | null;
  serverVersion: string;
  maxWireVersion: number | null;
}

/** The subset of `hello` this gate reads. */
interface HelloResult {
  setName?: string;
  isWritablePrimary?: boolean;
  msg?: string;
  me?: string;
  hosts?: string[];
  maxWireVersion?: number;
}

interface BuildInfoResult {
  version?: string;
}

// ---------------------------------------------------------------------------
// Harness state
// ---------------------------------------------------------------------------

let app: INestApplicationContext;
let transactions: TransactionService;

/**
 * A SECOND, INDEPENDENT client. Verification must observe committed state, so
 * it must not be able to join the transaction even by accident: this
 * connection has no session, and no session object is ever in scope where it
 * is used. Reading through the application connection without a session would
 * also be outside the transaction, but this removes the question entirely.
 */
let verifier: Connection;

let topology: TopologyEvidence;

/** Every runId this file creates, so the safety net can clean up after a failure. */
const createdRunIds: string[] = [];

/**
 * A document belonging to a DIFFERENT run, present for the whole file. Every
 * cleanup must leave it untouched — that is what distinguishes
 * `deleteMany({ runId })` from `deleteMany({})`.
 */
const FOREIGN_RUN_ID = `foreign-${randomUUID()}`;

function newRunId(): string {
  const runId = randomUUID();
  createdRunIds.push(runId);
  return runId;
}

function database(connection: Connection): mongo.Db {
  if (connection.db === undefined) {
    throw new Error('Connection has no database handle — the connection is not established.');
  }
  return connection.db;
}

function collection(connection: Connection, name: string): mongo.Collection<GateDocument> {
  return database(connection).collection<GateDocument>(name);
}

/** The connection the APPLICATION opened, not one this file made. */
function appConnection(): Connection {
  return app.get<Connection>(getConnectionToken());
}

/** Written through the application's own connection, inside the transaction. */
const appA = (): mongo.Collection<GateDocument> => collection(appConnection(), COLLECTION_A);
const appB = (): mongo.Collection<GateDocument> => collection(appConnection(), COLLECTION_B);

/** Read through the independent connection, always outside the transaction. */
const seenA = (): mongo.Collection<GateDocument> => collection(verifier, COLLECTION_A);
const seenB = (): mongo.Collection<GateDocument> => collection(verifier, COLLECTION_B);

/**
 * Records the real topology and FAILS LOUDLY on a standalone.
 *
 * The frozen requirement is a replica set in every environment
 * (CONSISTENCY-MODEL.md §1). A compose filename, an environment variable name
 * or a documentation table proves nothing about the server actually answering
 * on the other end of the socket, so this asks the server.
 *
 * Belt-and-braces: on a standalone the proofs below fail anyway with
 * `IllegalOperation: Transaction numbers are only allowed on a replica set
 * member or mongos`. This exists so the failure NAMES the cause instead of
 * making someone decode a driver error.
 */
async function readTopology(connection: Connection): Promise<TopologyEvidence> {
  const admin = database(connection).admin();
  const hello = (await admin.command({ hello: 1 })) as HelloResult;
  const buildInfo = (await admin.command({ buildInfo: 1 })) as BuildInfoResult;

  return {
    setName: hello.setName ?? null,
    isWritablePrimary: hello.isWritablePrimary === true,
    msg: hello.msg ?? null,
    me: hello.me ?? null,
    memberCount: Array.isArray(hello.hosts) ? hello.hosts.length : null,
    serverVersion: buildInfo.version ?? 'unknown',
    maxWireVersion: hello.maxWireVersion ?? null,
  };
}

/**
 * The topology evidence with every cluster-identifying value removed.
 *
 * `setName` and `me` carry the replica-set name and the host:port of the
 * server that answered. Against the local Docker set those are `rs0` and
 * `localhost:27017` and harmless — but this suite also runs against a cloud
 * development cluster, and it prints into CI logs. A hostname is not a
 * credential, but it is an infrastructure identifier and there is no reason to
 * publish it.
 *
 * Nothing is lost: `isReplicaSet` plus `memberCount` plus `isWritablePrimary`
 * prove exactly what the assertions need. The unredacted values stay available
 * to the assertions themselves.
 *
 * Authority: docs/architecture/OBSERVABILITY.md §4 (mandatory redaction);
 *            docs/architecture/ENVIRONMENT-RATIFICATION.md §2.2.
 */
function redactTopology(evidence: TopologyEvidence): Record<string, unknown> {
  return {
    isReplicaSet: evidence.setName !== null && evidence.setName.length > 0,
    isMongos: evidence.msg === 'isdbgrid',
    isWritablePrimary: evidence.isWritablePrimary,
    memberCount: evidence.memberCount,
    serverVersion: evidence.serverVersion,
    maxWireVersion: evidence.maxWireVersion,
  };
}

/**
 * Creates the two gate collections if they do not exist, OUTSIDE any
 * transaction.
 *
 * Not cosmetic. An insert into a missing collection creates it implicitly, and
 * inside a transaction that implicit creation takes an exclusive collection
 * lock a concurrent reader can block on — which would turn the
 * mid-transaction visibility check below into a hang on a fresh database and a
 * pass on a warm one. Creating them up front makes the first run behave
 * exactly like the hundredth.
 */
async function ensureCollection(connection: Connection, name: string): Promise<void> {
  try {
    await database(connection).createCollection(name);
  } catch (error) {
    // 48 = NamespaceExists. Any other failure is real and must surface.
    if ((error as { code?: number }).code !== 48) {
      throw error;
    }
  }
}

/** Deletes only what `runId` wrote. Never `deleteMany({})`, never a drop. */
async function cleanupRun(runId: string): Promise<{ a: number; b: number }> {
  const a = await seenA().deleteMany({ runId });
  const b = await seenB().deleteMany({ runId });
  return { a: a.deletedCount, b: b.deletedCount };
}

/** Both sentinel documents must survive every cleanup in this file. */
async function expectForeignRunUntouched(): Promise<void> {
  expect(await seenA().countDocuments({ runId: FOREIGN_RUN_ID })).toBe(1);
  expect(await seenB().countDocuments({ runId: FOREIGN_RUN_ID })).toBe(1);
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  /**
   * The REAL composition root, not a bespoke test wiring: `ConfigModule`
   * validates `MONGODB_URI` through the single environment boundary, and
   * `DatabaseModule` opens the connection with the same `autoIndex: false` /
   * `retryAttempts: 0` options production uses. What passes here is what
   * production runs.
   *
   * Logging is off because CONFIGURATION-ARCHITECTURE.md §7 silences it under
   * test; the gate prints its own evidence instead.
   */
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  transactions = app.get(TransactionService);

  // The URI comes from the typed configuration namespace. This file never
  // reads process.env and never parses a connection string.
  const uri = app.get<DatabaseConfig>(databaseConfig.KEY).uri;
  verifier = await mongoose.createConnection(uri).asPromise();

  topology = await readTopology(verifier);

  await ensureCollection(verifier, COLLECTION_A);
  await ensureCollection(verifier, COLLECTION_B);

  await seenA().insertOne({ runId: FOREIGN_RUN_ID, marker: 'foreign-sentinel' });
  await seenB().insertOne({ runId: FOREIGN_RUN_ID, marker: 'foreign-sentinel' });
}, 120_000);

afterAll(async () => {
  // Safety net only — each test already cleaned up after verifying. Runs even
  // when a test failed, so a failure never leaves residue behind.
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  await seenA().deleteMany({ runId: FOREIGN_RUN_ID });
  await seenB().deleteMany({ runId: FOREIGN_RUN_ID });

  // The collections themselves are LEFT IN PLACE. Dropping them is forbidden:
  // this file must be safe to run against staging.
  await verifier.close();
  await app.close();
}, 120_000);

describe('MongoDB transaction hard gate', () => {
  it('runs against a transaction-capable topology, not a standalone', () => {
    console.log(`  topology  ${JSON.stringify(redactTopology(topology))}`);

    const isReplicaSet = topology.setName !== null && topology.setName.length > 0;
    const isMongos = topology.msg === 'isdbgrid';

    expect(isReplicaSet || isMongos).toBe(true);
    if (isReplicaSet) {
      expect(topology.isWritablePrimary).toBe(true);
    }
  });

  /**
   * COMMIT PROOF — and the session-propagation proof.
   *
   * The mid-transaction reads are the load-bearing part. Uncommitted
   * transactional writes are invisible outside the transaction, so
   * `0 → 0 → commit → 1 → 1` can only happen if BOTH writes were held by the
   * session until the commit released them. Had either insert omitted
   * `{ session }`, the independent reader would have seen it immediately and
   * the mid-transaction expectation would fail — which is exactly what the
   * negative control below demonstrates.
   */
  it('commits: A and B both exist afterwards, and neither was visible before the commit', async () => {
    const runId = newRunId();

    const observed = {
      inTransactionBeforeA: false,
      inTransactionBeforeB: false,
      acknowledgedA: false,
      acknowledgedB: false,
      visibleOutsideA: -1,
      visibleOutsideB: -1,
    };

    await transactions.run(async (session) => {
      observed.inTransactionBeforeA = session.inTransaction();
      const insertedA = await appA().insertOne({ runId, marker: 'A' }, { session });
      observed.acknowledgedA = insertedA.acknowledged;

      observed.inTransactionBeforeB = session.inTransaction();
      const insertedB = await appB().insertOne({ runId, marker: 'B' }, { session });
      observed.acknowledgedB = insertedB.acknowledged;

      // SESSION PROPAGATION PROOF — independent connection, no session.
      observed.visibleOutsideA = await seenA().countDocuments({ runId });
      observed.visibleOutsideB = await seenB().countDocuments({ runId });
    });

    console.log(`  commit    run=${runId} ${JSON.stringify(observed)}`);

    expect(observed.inTransactionBeforeA).toBe(true);
    expect(observed.inTransactionBeforeB).toBe(true);
    expect(observed.acknowledgedA).toBe(true);
    expect(observed.acknowledgedB).toBe(true);
    expect(observed.visibleOutsideA).toBe(0);
    expect(observed.visibleOutsideB).toBe(0);

    // INDEPENDENT READ, after the session ended. This is the proof.
    const committedA = await seenA().countDocuments({ runId });
    const committedB = await seenB().countDocuments({ runId });
    console.log(`  commit    run=${runId} A=${String(committedA)} B=${String(committedB)}`);

    expect(committedA).toBe(1);
    expect(committedB).toBe(1);

    // CLEANUP — strictly after verification, this run only.
    const deleted = await cleanupRun(runId);
    expect(deleted).toEqual({ a: 1, b: 1 });
    expect(await seenA().countDocuments({ runId })).toBe(0);
    expect(await seenB().countDocuments({ runId })).toBe(0);
    await expectForeignRunUntouched();
  });

  /**
   * ROLLBACK PROOF — the gate.
   *
   * The failure is forced AFTER both writes have been acknowledged by the
   * server, so `0` afterwards means the writes were undone, not that they
   * never happened. `acknowledged` and `insertedId` are recorded to make that
   * distinction evidence rather than assumption.
   */
  it('rolls back: neither A nor B exists after a forced failure', async () => {
    const runId = newRunId();

    const observed = {
      attempts: 0,
      acknowledgedA: false,
      acknowledgedB: false,
      insertedIdA: null as string | null,
      insertedIdB: null as string | null,
      visibleOutsideA: -1,
      visibleOutsideB: -1,
    };

    await expect(
      transactions.run(async (session) => {
        observed.attempts += 1;

        const insertedA = await appA().insertOne({ runId, marker: 'A' }, { session });
        observed.acknowledgedA = insertedA.acknowledged;
        observed.insertedIdA = insertedA.insertedId.toHexString();

        const insertedB = await appB().insertOne({ runId, marker: 'B' }, { session });
        observed.acknowledgedB = insertedB.acknowledged;
        observed.insertedIdB = insertedB.insertedId.toHexString();

        observed.visibleOutsideA = await seenA().countDocuments({ runId });
        observed.visibleOutsideB = await seenB().countDocuments({ runId });

        // Deterministic, after BOTH writes. Not a network fault, not a timing
        // window, not a killed process — the same failure on every run.
        throw new ForcedGateFailure(runId);
      }),
    ).rejects.toThrow(ForcedGateFailure);

    console.log(`  rollback  run=${runId} ${JSON.stringify(observed)}`);

    // The driver retries only errors the server labelled
    // TransientTransactionError. A plain domain error carries no label, so
    // exactly one attempt is made and the abort is deterministic.
    expect(observed.attempts).toBe(1);
    expect(observed.acknowledgedA).toBe(true);
    expect(observed.acknowledgedB).toBe(true);
    expect(observed.insertedIdA).not.toBeNull();
    expect(observed.insertedIdB).not.toBeNull();
    expect(observed.visibleOutsideA).toBe(0);
    expect(observed.visibleOutsideB).toBe(0);

    // INDEPENDENT READS, after the session was aborted and ended.
    const remainingA = await seenA().countDocuments({ runId });
    const remainingB = await seenB().countDocuments({ runId });
    const documentsA = await seenA().find({ runId }).toArray();
    const documentsB = await seenB().find({ runId }).toArray();
    console.log(`  rollback  run=${runId} A=${String(remainingA)} B=${String(remainingB)}`);

    expect(remainingA).toBe(0);
    expect(remainingB).toBe(0);
    expect(documentsA).toEqual([]);
    expect(documentsB).toEqual([]);

    // Nothing to remove. Recorded so "cleanup did not manufacture the result"
    // is observable rather than merely asserted.
    const deleted = await cleanupRun(runId);
    expect(deleted).toEqual({ a: 0, b: 0 });
    await expectForeignRunUntouched();
  });

  /**
   * NEGATIVE CONTROL — proves the rollback assertion above is not vacuous.
   *
   * Write A joins the session; write B deliberately does NOT. The transaction
   * aborts identically. A = 0 with B = 1 shows that the verification queries
   * CAN see a write that escaped the transaction — so `A = 0, B = 0` in the
   * rollback proof is a real observation, not a query that could never have
   * found anything either way.
   *
   * This is the one place in the repository where a write omits its session,
   * and it exists precisely to demonstrate what that mistake looks like.
   */
  it('negative control: a write that omits the session survives the abort', async () => {
    const runId = newRunId();

    await expect(
      transactions.run(async (session) => {
        await appA().insertOne({ runId, marker: 'A-in-session' }, { session });
        await appB().insertOne({ runId, marker: 'B-NOT-in-session' });
        throw new ForcedGateFailure(runId);
      }),
    ).rejects.toThrow(ForcedGateFailure);

    const rolledBackA = await seenA().countDocuments({ runId });
    const survivingB = await seenB().countDocuments({ runId });
    console.log(
      `  control   run=${runId} A=${String(rolledBackA)} (rolled back) ` +
        `B=${String(survivingB)} (escaped the transaction)`,
    );

    expect(rolledBackA).toBe(0);
    expect(survivingB).toBe(1);

    const deleted = await cleanupRun(runId);
    expect(deleted).toEqual({ a: 0, b: 1 });
    expect(await seenB().countDocuments({ runId })).toBe(0);
    await expectForeignRunUntouched();
  });
});
