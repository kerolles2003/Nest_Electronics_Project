import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { request } from '@playwright/test';
import { API_BASE_URL } from './origin';

/**
 * Refuses to start a run against an API that will throttle it.
 *
 * ## The problem this removes
 *
 * Registration is capped at 3 an hour per IP and login at 5 per 15 minutes.
 * Right for the internet; a hard ceiling for a suite that creates accounts.
 * `RATE_LIMIT_RELAXED=true` lifts it for the API process Playwright starts —
 * but `reuseExistingServer` means a server a developer started by hand is used
 * instead, and that one does not have the variable set.
 *
 * The failure that produces is genuinely confusing: specs fail on
 * `expect(registered.ok()).toBe(true)` in a helper, several files apart, with
 * nothing on screen about rate limits. A suite that fails for environmental
 * reasons teaches everyone to disregard failures, which is how a real one gets
 * missed — so it says which it is, once, before any test runs.
 *
 * ## The probe
 *
 * One deliberately-wrong sign-in. `@nestjs/throttler` reports the effective
 * ceiling in `X-RateLimit-Limit-global`, and `AppThrottlerGuard` multiplies the
 * route's declared limit before the header is written — so the number is the
 * whole answer. The request costs one of five attempts in the case where it
 * fails, which is the case that was about to fail anyway.
 *
 * It asserts on the number rather than on the environment variable, because the
 * variable is only how the value gets in, and this suite may be talking to a
 * server it did not start.
 */

/** The production login limit. Anything at or below it means NOT relaxed. */
const PRODUCTION_LOGIN_LIMIT = 5;

/**
 * Refuses to start a run against a database that cannot do transactions.
 *
 * ## The failure this replaces
 *
 * `purchase-journey.spec.ts` places a real order, and `POST /orders` writes
 * stock, the inventory ledger, the order and the cart emptying in ONE MongoDB
 * transaction. A standalone `mongod` rejects that with
 *
 *     Transaction numbers are only allowed on a replica set member or mongos
 *
 * and the failure arrives at the checkout step, eight steps into a journey,
 * as a 500 from a button click. Nothing on the screen or in the report says
 * "your database is the wrong topology". The suite had been depending on
 * whatever `mongod` happened to be listening, and the compose file is the only
 * thing that starts the right one.
 *
 * ## Why it runs a real transaction rather than reading `hello`
 *
 * Because `docker-compose.dev.yml` says so, in its own words: *"This file
 * provides DATABASE AVAILABILITY only… Connection readiness is not transaction
 * readiness."* A replica set that reports a PRIMARY can still be mid-election,
 * and `rs.status().ok` would be a proxy for the thing rather than the thing.
 * So the probe starts a session, opens a transaction and aborts it — the same
 * operation the checkout needs, minus the writing.
 *
 * It uses a database of its OWN and drops it, so it cannot disturb the scratch
 * database whose document counts the teardown compares against a baseline.
 *
 * ## Why it shells out
 *
 * This workspace has no MongoDB dependency and should not acquire one to
 * support a test. `apps/api` already has Mongoose, so the probe runs there, as
 * a string handed to `node` — the same argument, and the same mechanism, as
 * `apps/admin/e2e/global-teardown.ts`.
 */
const TRANSACTION_PROBE = `
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

function readUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;

  for (const name of ['.env.local', '.env']) {
    const file = path.join(process.cwd(), name);
    if (!fs.existsSync(file)) continue;

    for (const line of fs.readFileSync(file, 'utf8').split(/\\r?\\n/)) {
      const match = /^\\s*MONGODB_URI\\s*=\\s*(.*)$/.exec(line);
      if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    }
  }

  throw new Error('MONGODB_URI not found');
}

(async () => {
  // A database of its own, never the suite's.
  await mongoose.connect(readUri(), { dbName: 'nest_electronics_txn_probe' });

  const db = mongoose.connection.db;
  // Created OUTSIDE the transaction: what is under test is the transaction, and
  // an implicit create inside one is a different capability.
  await db.createCollection('probe').catch(() => undefined);

  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    await db.collection('probe').insertOne({ at: new Date() }, { session });
    // ABORTED on purpose. The transaction had to START, which is the whole
    // question; committing it would leave a row for no reason.
    await session.abortTransaction();
  } finally {
    await session.endSession();
  }

  await db.dropDatabase();
  await mongoose.disconnect();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
`;

function assertTransactionsWork(): void {
  const api = resolve(__dirname, '../../api');

  try {
    execFileSync(process.execPath, ['-e', TRANSACTION_PROBE], {
      cwd: api,
      env: process.env,
      stdio: 'pipe',
      timeout: 60_000,
    });
  } catch (error) {
    const detail =
      error instanceof Error && 'stderr' in error
        ? String((error as { stderr?: Buffer }).stderr ?? '').trim()
        : String(error);

    throw new Error(
      [
        'This suite places a real order, and that write is a MongoDB TRANSACTION.',
        'The database it is pointed at cannot run one.',
        '',
        detail === '' ? '(the probe gave no detail)' : detail,
        '',
        'A standalone mongod is the usual cause. The API needs a REPLICA SET —',
        'the same one CI uses:',
        '',
        '    docker compose -f docker-compose.dev.yml up -d --wait',
        '',
        'Checked here rather than left to fail at the checkout step, where it',
        'arrives as a 500 from a button click with nothing about topology in it.',
      ].join('\n'),
    );
  }
}

export default async function globalSetup(): Promise<void> {
  /*
   * FIRST, because everything else is downstream of it. A run against a
   * standalone mongod cannot pass, and every minute it spends compiling two
   * Next applications before finding that out is a minute wasted.
   */
  assertTransactionsWork();

  const context = await request.newContext();

  try {
    const response = await context.post(`${API_BASE_URL}/auth/login`, {
      data: {
        email: 'rate-limit-probe@example.invalid',
        password: 'this is not anybody’s password',
      },
      failOnStatusCode: false,
    });

    const header = response.headers()['x-ratelimit-limit-global'];

    if (header === undefined) {
      /*
       * Not fatal. The header is a convenience of the current throttler; if a
       * future version stops sending it, the right outcome is a run that
       * proceeds and possibly fails on the throttle, not a suite that cannot
       * start at all.
       */
      console.warn(
        'e2e setup: could not read X-RateLimit-Limit-global; skipping the rate-limit check.',
      );
      return;
    }

    const limit = Number(header);

    if (Number.isFinite(limit) && limit > PRODUCTION_LOGIN_LIMIT) return;

    throw new Error(
      [
        `The API at ${API_BASE_URL} is running with PRODUCTION rate limits ` +
          `(login limit: ${header}).`,
        '',
        'This suite creates accounts, and 3 registrations an hour is a ceiling it',
        'will hit — as failures in unrelated specs that say nothing about rate',
        'limits.',
        '',
        'Playwright starts the API with RATE_LIMIT_RELAXED=true. Seeing this means',
        'an API was already listening on that port and was REUSED, config and all.',
        '',
        'Stop it and let the suite start its own, or set RATE_LIMIT_RELAXED=true',
        'for it. See apps/api/src/config/throttle.config.ts.',
      ].join('\n'),
    );
  } finally {
    await context.dispose();
  }
}
