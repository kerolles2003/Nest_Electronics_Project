import { ensureCleanScratchDatabase } from '../../src/database/testing/scratch-database';

/**
 * Hands the jest run a database of its own, in a known state.
 *
 * ## Why this suite needs one at all
 *
 * Every suite here cleans up after itself by tracked id in `afterAll`, and
 * several assert the seeded catalogue is intact at the end. That is good
 * discipline and it is not isolation: it holds only while the process survives
 * to run `afterAll`. A killed run, a dead database container or a crashed
 * editor leaves the residue in place, and — until this change — in a database
 * shared with two browser suites and with the developer's own storefront.
 *
 * ## Rebuilt only when it is dirty
 *
 * A run that ended clean leaves a database matching its recorded baseline
 * exactly, and this returns in about a second. A run that did not costs one
 * rebuild: drop, index sync, catalogue, shipping rates, development admin.
 * See `src/database/testing/scratch-database.ts` for why that is still
 * "drop it wholesale" rather than reasoning about residue.
 */
export default async function prepareScratchDatabase(): Promise<void> {
  const prepared = await ensureCleanScratchDatabase('api-jest');

  if (!prepared.rebuilt) return;

  // Printed rather than silent: a rebuild means the LAST run left something
  // behind, and that is worth seeing even though this run will pass.
  process.stdout.write(
    `\njest: rebuilt ${prepared.database} because ${prepared.reasons.join('; ')}\n\n`,
  );
}
