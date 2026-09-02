/**
 * Every jest suite runs against the REAL rate limits.
 *
 * `RATE_LIMIT_RELAXED` exists so the browser suite can create the accounts it
 * needs without failing on a throttle (see `config/throttle.config.ts`). It is
 * set for one process — the API that Playwright starts — and nothing else.
 *
 * This file makes that a guarantee rather than a habit. A developer who exports
 * the variable in their shell, or leaves it in `.env` after debugging an e2e
 * run, would otherwise silently relax the limits for the jest suite too, and
 * `test/auth/auth-guards.spec.ts` — the one place the throttle is actually
 * proven — would go quiet without failing. Losing coverage of a security
 * control is not an acceptable price for a quiet suite.
 *
 * `setupFiles`, not `setupFilesAfterEnv`, for the same reason as the email
 * isolation beside it: `ConfigModule` reads the environment the first time a
 * module graph compiles, so a value set afterwards would be too late. dotenv
 * does not overwrite a variable that is already present, so this also wins over
 * a `.env` file.
 *
 * `auth-guards.spec.ts` asserts the pin is in force before it asserts the 429,
 * so deleting this file fails a test that names the problem.
 */
process.env['RATE_LIMIT_RELAXED'] = 'false';
