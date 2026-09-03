import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DEV_ADMIN_EMAIL, E2E_EMAIL_PREFIX } from './fixtures/accounts';
import { SCRATCH_DATABASE, SCRATCH_SUITE } from './origin';

/**
 * Removes everything the admin suite created, and puts the stock back.
 *
 * ## Why this exists, written from the damage it failed to prevent
 *
 * This file was missing on the first several runs, and the consequence was not
 * theoretical. The suite places a real order per spec through the real
 * checkout, which really does `$inc { 'stock.onHand': -q }` on a seeded
 * product. Twelve specs, several runs, and the shared development catalogue was
 * left holding **62 accounts, 35 orders, and four products at zero stock out of
 * thirty-four**.
 *
 * The damage showed up somewhere else entirely: the STOREFRONT suite started
 * failing on `/products › filters by brand and by stock` and on its purchase
 * journey — tests that have nothing to do with the admin, failing because the
 * catalogue underneath them had been quietly drained by another suite. That is
 * the worst shape of test residue, because the failure appears in the innocent
 * suite and the guilty one stays green.
 *
 * The repository's standing rule for suites that touch a shared development
 * database is that they clean up after themselves by tracked identity — never
 * `dropDatabase`, never a broad `deleteMany({})`, and never touching seeded
 * catalogue data beyond giving back exactly what was taken. Every jest suite
 * here does it in `afterAll`; the storefront does it here. This is the same
 * thing for the admin.
 *
 * ## Why it shells out instead of importing a driver
 *
 * The admin has no MongoDB dependency and should not acquire one to support a
 * test. `apps/api` already has Mongoose, so the cleanup runs there, as a string
 * handed to `node`. TypeScript never sees a Mongoose type, so `tsc --noEmit` in
 * this workspace stays honest about what this application depends on.
 *
 * ## Fails loudly
 *
 * A teardown that swallows its own errors is how residue accumulates unnoticed
 * for weeks — which is precisely what happened while this file did not exist.
 * If cleanup cannot run, the run fails and says so.
 */

/**
 * Re-exported so `fixtures/operations.ts` keeps its single import, and so the
 * two halves of this suite cannot disagree about which addresses it owns. The
 * definition lives in `fixtures/accounts.ts` — see that file for what the split
 * used to cost.
 */
export { E2E_EMAIL_PREFIX };

/**
 * Runs inside `apps/api`, where Mongoose resolves.
 *
 * Reads `MONGODB_URI` out of the API's own `.env` rather than taking it from
 * this process, and never prints it — it is a credential.
 */
const CLEANUP = `
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

  throw new Error('MONGODB_URI not found — cannot clean up after the admin e2e run');
}

(async () => {
  // The suite's OWN database, overriding whatever the URI names. Passed in
  // rather than derived, so this script and the API under test cannot end up
  // cleaning and writing two different databases.
  await mongoose.connect(readUri(), { dbName: process.env.MONGODB_DB_NAME });
  const db = mongoose.connection.db;

  const pattern = new RegExp('^' + process.env.E2E_EMAIL_PREFIX + '\\\\.');
  const users = await db.collection('users')
    .find({ email: pattern }, { projection: { _id: 1 } }).toArray();
  const ids = users.map((u) => u._id);

  let orders = 0;
  let restocked = 0;

  if (ids.length > 0) {
    const placed = await db.collection('orders')
      .find({ userId: { $in: ids } }, { projection: { idempotencyKey: 1 } }).toArray();
    const orderIds = placed.map((o) => o._id);

    // RESTORE THE CATALOGUE FIRST.
    //
    // Deleting an order does NOT put its stock back. A teardown that only
    // removed documents would drain the shared catalogue one run at a time —
    // which is exactly what happened before this file existed, and it surfaced
    // as the STOREFRONT suite failing on a stock filter.
    //
    // The inventory EVENTS are the authority for what actually moved, so
    // reversing them is exact. This suite also RETURNS some orders, which
    // writes a positive RETURN event; reversing every event by its own sign
    // handles that correctly, where reversing the order lines would double the
    // restoration.
    const events = await db.collection('inventoryEvents')
      .find({ 'reference.id': { $in: orderIds } }).toArray();

    for (const event of events) {
      const delta = event.quantityDelta;
      if (typeof delta !== 'number' || delta === 0) continue;

      await db.collection('products').updateOne(
        { _id: event.productId },
        { $inc: { 'stock.onHand': -delta, salesCount: delta } },
      );
      restocked += 1;
    }

    await db.collection('inventoryEvents').deleteMany({ 'reference.id': { $in: orderIds } });

    orders = (await db.collection('orders').deleteMany({ userId: { $in: ids } })).deletedCount;
    await db.collection('carts').deleteMany({ userId: { $in: ids } });
    await db.collection('refreshTokens').deleteMany({ userId: { $in: ids } });
    await db.collection('idempotencyKeys').deleteMany({
      key: { $in: placed.map((o) => o.idempotencyKey).filter(Boolean) },
    });
    await db.collection('users').deleteMany({ _id: { $in: ids } });
  }

  /*
   * THE OPERATOR'S OWN SESSIONS.
   *
   * Every spec signs the development admin in, and that account is a seeded
   * fixture: it is deliberately outside the namespace above, so it survives the
   * cleanup — and so did its refresh tokens. Fifteen orphaned session rows per
   * run, invisible until the database started being checked against the state
   * preparation recorded.
   *
   * The ACCOUNT is left alone; only its sessions go. Deleting it would make the
   * next run fail in global-setup with a message about a missing operator.
   */
  const operator = await db.collection('users')
    .findOne({ email: process.env.DEV_ADMIN_EMAIL }, { projection: { _id: 1 } });

  const sessions = operator === null
    ? { deletedCount: 0 }
    : await db.collection('refreshTokens').deleteMany({ userId: operator._id });

  // Counts only. No email address, no id, no connection string.
  console.log(
    'admin e2e teardown: removed ' + ids.length + ' user(s), ' + orders + ' order(s), ' +
      sessions.deletedCount + ' operator session(s), ' +
      'reversed ' + restocked + ' stock movement(s)',
  );
  await mongoose.disconnect();
})().catch((error) => {
  console.error('admin e2e teardown FAILED:', error.message);
  process.exit(1);
});
`;

export default function globalTeardown(): void {
  const api = resolve(__dirname, '../../api');
  const env = {
    ...process.env,
    E2E_EMAIL_PREFIX,
    DEV_ADMIN_EMAIL,
    MONGODB_DB_NAME: SCRATCH_DATABASE,
  };

  execFileSync(process.execPath, ['-e', CLEANUP], { cwd: api, env, stdio: 'inherit' });

  /**
   * And then PROVE it.
   *
   * The cleanup above reports what it removed, which says nothing about what
   * it missed — and what it missed is the entire failure mode. This compares
   * the database against the state preparation recorded before the run: every
   * collection's document count, and every product's stock, per SKU. Anything
   * left over fails the run and is named.
   *
   * It runs from `dist`, which the Playwright web server built before it
   * started the API.
   */
  execFileSync(
    process.execPath,
    [
      'dist/database/testing/scratch-database.cli.js',
      '--suite',
      SCRATCH_SUITE,
      '--assert-clean',
    ],
    { cwd: api, env, stdio: 'inherit' },
  );
}
