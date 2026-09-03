import { createHash } from 'node:crypto';
import type { Connection } from 'mongoose';
import { SEED_BRANDS, SEED_CATEGORIES, SEED_PRODUCTS } from '../seed/catalog.seed-data';
import { DEV_ADMIN_EMAIL, DEV_ADMIN_ROLE } from '../seed/dev-admin.seed-data';
import { SEED_SHIPPING_RATES } from '../seed/shipping.seed-data';

/**
 * What a freshly prepared scratch database looks like, so that "clean" is a
 * comparison rather than an opinion.
 *
 * ## Why a recorded baseline and not a rule
 *
 * The old teardowns REPORTED what they removed: "removed 12 user(s), 11
 * order(s), reversed 12 stock movement(s)". A count of what a cleanup found is
 * not evidence that it found everything, and nothing in the repository would
 * have noticed a collection the cleanup did not know about. That is precisely
 * how a suite drained the catalogue over several runs while printing a
 * reassuring line each time.
 *
 * So preparation writes down the exact state it produced — every collection's
 * document count, and every product's stock — and the run is checked against it
 * afterwards. A suite that finishes with anything left over FAILS, naming what
 * it left. A guarantee needs a check that goes red when it is absent, or it is
 * a hope.
 *
 * ## Stock is compared per SKU, not in aggregate
 *
 * A total would net off: one product over-restored and another under-restored
 * sum to the right answer and read as clean. Per SKU they are two failures with
 * two names.
 */

/**
 * Collections whose document count is a SEQUENCE rather than test data.
 *
 * `orderCounters` holds one document per day — `_id` is `YYYYMMDD` and the
 * only field is that day's order-number counter. A run that places an order
 * creates or increments today's, and no teardown removes it, deliberately:
 * deleting it would reset the sequence and hand the next run an order number
 * that has already been issued.
 *
 * It is the ONLY exclusion, and it is written by name rather than as a
 * pattern. An exclusion rule wide enough to be convenient is wide enough to
 * hide the residue this whole file exists to find.
 */
const SEQUENCE_COLLECTIONS: readonly string[] = ['orderCounters'];

/** Where the baseline lives, inside the scratch database it describes. */
export const BASELINE_COLLECTION = '__scratch_baseline';

const BASELINE_ID = 'baseline';

export interface ScratchObservation {
  /** Document count per collection. A collection that does not exist is absent. */
  readonly collections: Readonly<Record<string, number>>;
  /** `stock.onHand` per product SKU. */
  readonly stock: Readonly<Record<string, number>>;
}

export interface ScratchBaseline extends ScratchObservation {
  readonly suite: string;
  readonly seedFingerprint: string;
  readonly preparedAt: string;
}

/**
 * The SKUs the seed deliberately leaves at zero.
 *
 * Derived, never written out: the seed is the authority for which products are
 * out of stock, and a hard-coded list here would keep passing after somebody
 * restocked one of them in the seed data.
 *
 * They matter more than their number suggests. They are the ONLY out-of-stock
 * coverage in the repository — the OUT OF STOCK badge, the disabled
 * add-to-cart button and the stock filter on `/products` have no other
 * fixture. A teardown that helpfully "restored" them would delete that
 * coverage silently, and every test involved would go green.
 */
export const OUT_OF_STOCK_FIXTURES: readonly string[] = SEED_PRODUCTS.filter(
  (product) => product.onHand === 0,
).map((product) => product.sku);

/**
 * A short hash of everything the seed would write.
 *
 * Without this, a scratch database that is clean but STALE — prepared before
 * the seed data changed — passes every check and then fails specs for reasons
 * that have nothing to do with the code under test. Fingerprinting the derived
 * data rather than the source text means a comment change does not force a
 * rebuild while a price change does.
 */
export function seedFingerprint(): string {
  const shape = {
    categories: SEED_CATEGORIES.map((c) => [c.slug, c.parentSlug, c.sortOrder]),
    brands: SEED_BRANDS.map((b) => b.slug),
    products: SEED_PRODUCTS.map((p) => [
      p.sku,
      p.slug,
      p.onHand,
      p.basePrice,
      p.salePrice,
      p.salesCount,
      p.isFeatured,
      (p.images ?? []).length,
    ]),
    shipping: SEED_SHIPPING_RATES.map((r) => [r.governorate, r.fee]),
    admin: [DEV_ADMIN_EMAIL, DEV_ADMIN_ROLE],
  };

  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16);
}

/** The database handle, or a failure that says which connection had none. */
function handleOf(connection: Connection): NonNullable<Connection['db']> {
  const db = connection.db;

  if (db === undefined) {
    throw new Error('the mongoose connection carries no database handle');
  }

  return db;
}

/** Reads the current state of a scratch database. */
export async function observeScratchDatabase(
  connection: Connection,
): Promise<ScratchObservation> {
  const db = handleOf(connection);
  const collections: Record<string, number> = {};

  for (const info of await db.listCollections({}, { nameOnly: true }).toArray()) {
    // The baseline describes the database; counting it would make every
    // comparison depend on whether one had been written yet.
    if (info.name === BASELINE_COLLECTION) continue;

    collections[info.name] = await db.collection(info.name).countDocuments();
  }

  const stock: Record<string, number> = {};

  const products = await db
    .collection('products')
    .find({}, { projection: { sku: 1, 'stock.onHand': 1 } })
    .toArray();

  for (const product of products) {
    const sku: unknown = product['sku'];
    const onHand: unknown = (product['stock'] as { onHand?: unknown } | undefined)?.onHand;

    if (typeof sku === 'string' && typeof onHand === 'number') stock[sku] = onHand;
  }

  return { collections, stock };
}

export async function readBaseline(connection: Connection): Promise<ScratchBaseline | null> {
  const document = await handleOf(connection)
    .collection(BASELINE_COLLECTION)
    .findOne({ _id: BASELINE_ID as never });

  return (document?.['baseline'] as ScratchBaseline | undefined) ?? null;
}

export async function writeBaseline(
  connection: Connection,
  baseline: ScratchBaseline,
): Promise<void> {
  await handleOf(connection)
    .collection(BASELINE_COLLECTION)
    .replaceOne({ _id: BASELINE_ID as never }, { baseline }, { upsert: true });
}

/**
 * Every way the database differs from the state preparation left it in, in
 * sentences.
 *
 * PURE, and separated from the reading above for exactly that reason: this is
 * the part that decides whether a run passes, so it is the part that has to be
 * testable without a database — including the cases where it must go red.
 *
 * Returns an empty array when the database is clean. The order is stable: the
 * fingerprint first because it explains everything after it, then collections,
 * then stock.
 */
export function describeDrift(
  baseline: ScratchBaseline | null,
  observed: ScratchObservation,
  fingerprint: string = seedFingerprint(),
): string[] {
  if (baseline === null) {
    return ['this database has no baseline — it was never prepared by the test harness'];
  }

  const drift: string[] = [];

  if (baseline.seedFingerprint !== fingerprint) {
    drift.push(
      'the seed data has changed since this database was prepared ' +
        `(${baseline.seedFingerprint} -> ${fingerprint})`,
    );
  }

  for (const name of namesIn(baseline.collections, observed.collections)) {
    if (SEQUENCE_COLLECTIONS.includes(name)) continue;

    const before = baseline.collections[name] ?? 0;
    const after = observed.collections[name] ?? 0;

    if (before === after) continue;

    drift.push(
      `${name}: ${String(after)} document(s), prepared with ${String(before)} ` +
        `(${signed(after - before)})`,
    );
  }

  for (const sku of namesIn(baseline.stock, observed.stock)) {
    const before = baseline.stock[sku];
    const after = observed.stock[sku];

    if (before === after) continue;

    if (after === undefined) {
      drift.push(`${sku}: the product is gone; it was stocked at ${String(before)}`);
      continue;
    }

    if (before === undefined) {
      drift.push(`${sku}: a product the seed does not define, stocked at ${String(after)}`);
      continue;
    }

    drift.push(
      OUT_OF_STOCK_FIXTURES.includes(sku)
        ? `${sku}: stocked at ${String(after)}, and the seed deliberately leaves it at ` +
            `${String(before)}. It is one of the ${String(OUT_OF_STOCK_FIXTURES.length)} ` +
            'out-of-stock fixtures — the only out-of-stock coverage in the repository — so ' +
            'restoring it silently deletes the coverage behind the OUT OF STOCK badge, the ' +
            'disabled add-to-cart button and the stock filter'
        : `${sku}: stocked at ${String(after)}, prepared at ${String(before)} ` +
            `(${signed(after - before)})`,
    );
  }

  return drift;
}

/** Every key in either record, in a stable order. */
function namesIn(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
}

function signed(delta: number): string {
  return delta > 0 ? `+${String(delta)}` : String(delta);
}
