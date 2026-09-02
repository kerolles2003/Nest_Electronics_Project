/**
 * What the development admin account is, with no code that does anything.
 *
 * Separated from `dev-admin.seed.ts` for the same reason `sandbox.seed-data.ts`
 * is separated from its seed: the seed is a SCRIPT — it ends in `void main()` —
 * so importing it to read a constant would run it. The test that checks the
 * documented credentials against the seeded ones must be able to read them
 * without connecting to a database.
 */

/**
 * The documented credentials.
 *
 * A development fixture on a local database, and NOT a default credential —
 * the distinction is the whole of Phase 6 Part 1, so it is worth being precise
 * about which this is.
 *
 * A default is a value that appears when nobody chose one. `staff:create`, the
 * command that provisions a REAL staff account, has no default: it prompts, it
 * refuses an empty answer, and it refuses any password that appears in this
 * repository — including this one.
 *
 * This is the opposite: a value chosen deliberately, written down on purpose,
 * and fenced so it cannot escape the machine it was written for. Three fences,
 * the same three the sandbox customer has:
 *
 *   1. `.test` is reserved and unresolvable (RFC 2606), so this address can
 *      never belong to a person and can never receive mail.
 *   2. `dev-admin.seed.ts` refuses to run under `NODE_ENV=production`, and
 *      `StaffProvisioningService` independently refuses a `.test` address there
 *      — so the seed failing open would still not create this in production.
 *   3. `test/database/dev-admin-seed.spec.ts` asserts that this file, the docs
 *      and the password policy all agree, so the documented password cannot
 *      drift from the seeded one.
 */
export const DEV_ADMIN_EMAIL = 'admin@nest-electronics.test';

/**
 * Long enough for the real policy, memorable enough to type, and deliberately
 * unlike the sandbox customer's — two accounts that share a password teach the
 * habit of reusing one.
 */
export const DEV_ADMIN_PASSWORD = 'copper oscilloscope probe';

export const DEV_ADMIN_FULL_NAME = 'Development Admin';
export const DEV_ADMIN_PHONE = '01098765432';

/**
 * `SUPER_ADMIN`, not `ADMIN`.
 *
 * The point of the local account is to be able to exercise every screen,
 * including the ones only a super-admin reaches. Seeding the lesser role would
 * mean discovering the difference in production. The production guard is what
 * makes this safe, not the choice of role.
 */
export const DEV_ADMIN_ROLE = 'SUPER_ADMIN' as const;
