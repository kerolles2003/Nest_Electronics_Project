/**
 * The accounts this suite uses, in one place.
 *
 * They were spread across `fixtures/operations.ts` (which signs in) and
 * `global-teardown.ts` (which cleans up), and the two files cannot import from
 * each other without a cycle. That split is how the operator's own sessions
 * came to be missed: the teardown removed every account in the `admin-e2e.`
 * namespace and the refresh tokens belonging to them, and never touched the
 * DEVELOPMENT ADMIN — who is not in that namespace, is signed in by every
 * single spec, and left fifteen orphaned session rows per run.
 *
 * Nothing noticed until the run started being checked against a recorded
 * baseline. That is the argument for this file: one module, imported by both
 * halves, so "the accounts this suite touches" is a list rather than a
 * convention.
 */

/**
 * The namespace this suite owns.
 *
 * Fixed rather than per-run, so a crashed run's residue is collected by the
 * NEXT run rather than being orphaned forever. Every address the fixtures
 * create begins `admin-e2e.`, and nothing else in the system does.
 *
 * It deliberately does NOT match the development admin below: that account is
 * a seeded fixture with its own lifecycle (`dev-admin:seed`), and deleting it
 * would make the next run fail in `global-setup` with a message about a
 * missing operator.
 */
export const E2E_EMAIL_PREFIX = 'admin-e2e';

/**
 * The development admin, from `pnpm --filter api dev-admin:seed`.
 *
 * Written as literals rather than imported from the API package, because this
 * workspace does not depend on it. `apps/api/test/database/dev-admin-seed.spec.ts`
 * is what keeps these spellings and the seed's from drifting — it asserts the
 * seed, the docs and the password policy all agree.
 */
export const DEV_ADMIN_EMAIL = 'admin@nest-electronics.test';
export const DEV_ADMIN_PASSWORD = 'copper oscilloscope probe';
export const DEV_ADMIN_NAME = 'Development Admin';
