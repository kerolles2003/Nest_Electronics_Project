import { SCRATCH_DATABASES } from '../../src/database/testing/scratch-databases';

/**
 * Points every jest suite at this suite's own database.
 *
 * `setupFiles`, not `setupFilesAfterEach`, and for the same reason as
 * `email-isolation.ts`: `ConfigModule` reads the environment the first time a
 * module graph compiles, so setting this afterwards would be too late and the
 * suite would connect to the development database while believing otherwise.
 *
 * Centralised for the same reason too. A per-suite override would isolate the
 * suites that remembered to do it; this isolates the ones that do not, which
 * is where shared-database damage comes from.
 *
 * Deliberately imports the registry ONLY — a dependency-free module — and not
 * the harness that uses it. A `setupFiles` entry runs once per test file, and
 * pulling `AppModule` into every one of them to set a single string would be
 * paid 19 times per run for nothing.
 */
process.env['MONGODB_DB_NAME'] = SCRATCH_DATABASES['api-jest'];
