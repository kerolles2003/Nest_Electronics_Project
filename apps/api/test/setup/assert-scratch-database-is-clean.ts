import { assertScratchDatabaseIsClean } from '../../src/database/testing/scratch-database';

/**
 * Fails the run if it left anything in its database.
 *
 * The suites all clean up in `afterAll`. This is the check that the cleanup
 * WORKED — every collection back to the document count preparation recorded,
 * and every product back to the stock it was seeded with.
 *
 * Reporting it was not enough. The teardowns used to print what they removed,
 * which says nothing about what they missed, and a suite drained the shared
 * catalogue over several runs while printing a reassuring line each time. A
 * guarantee needs a check that goes red when it is absent.
 */
export default async function assertNothingWasLeftBehind(): Promise<void> {
  await assertScratchDatabaseIsClean('api-jest');
}
