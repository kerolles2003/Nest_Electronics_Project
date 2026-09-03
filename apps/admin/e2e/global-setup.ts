import { request, type APIRequestContext } from '@playwright/test';
import { API_BASE_URL } from './origin';
import { DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD } from './fixtures/operations';

/**
 * Refuses to start a run against an API that will throttle it.
 *
 * ## The problem this removes
 *
 * `POST /auth/login` is capped at **5 per 15 minutes per IP and email**. Right
 * for the internet; a hard ceiling for a suite where every spec signs an
 * operator in. `RATE_LIMIT_RELAXED=true` lifts it for the API process Playwright
 * starts — but `reuseExistingServer` means a server a developer started by hand
 * is used instead, and that one does not have the variable set.
 *
 * The failure that produces is genuinely confusing: specs fail on a sign-in
 * helper several files away, with nothing on screen about rate limits. A suite
 * that fails for environmental reasons teaches everyone to disregard failures,
 * which is how a real one gets missed — so it says which it is, once, before
 * any test runs.
 *
 * ## The limits themselves are still proven, at production strength
 *
 * Relaxing here does not weaken the guard anywhere it counts.
 * `AppThrottlerGuard` still runs, the tracker still runs, the IP+email key
 * still runs — only the ceiling moves, by a multiplier
 * (`apps/api/src/config/rate-limits.ts`). The REAL numbers are asserted in
 * `apps/api/test/auth/auth-guards.spec.ts`, which pins
 * `limitMultiplier === 1` before it asserts a 429, and
 * `apps/api/test/setup/production-like-limits.ts` forces the pin for every jest
 * suite so a stray shell export cannot silently relax it.
 *
 * ## The probe
 *
 * One deliberately-wrong sign-in. `@nestjs/throttler` reports the effective
 * ceiling in `X-RateLimit-Limit-global`, and the guard multiplies the route's
 * declared limit before the header is written — so the number is the whole
 * answer. It asserts on the number rather than on the environment variable,
 * because the variable is only how the value gets in, and this suite may be
 * talking to a server it did not start.
 */

/** The production login limit. Anything at or below it means NOT relaxed. */
const PRODUCTION_LOGIN_LIMIT = 5;

export default async function globalSetup(): Promise<void> {
  const context = await request.newContext();

  try {
    await assertTheDevelopmentAdminExists(context);

    const response = await context.post(`${API_BASE_URL}/auth/login`, {
      data: {
        email: 'admin-rate-limit-probe@example.invalid',
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
        'admin e2e setup: could not read X-RateLimit-Limit-global; skipping the rate-limit check.',
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
        'Every admin spec signs an operator in, and 5 logins per 15 minutes is a',
        'ceiling this suite will hit — as failures in unrelated specs that say',
        'nothing about rate limits.',
        '',
        'Playwright starts the API with RATE_LIMIT_RELAXED=true. Seeing this means',
        'an API was already listening on that port and was REUSED, config and all.',
        '',
        'Stop it and let the suite start its own, or set RATE_LIMIT_RELAXED=true',
        'for it. See apps/api/src/config/throttle.config.ts. The production numbers',
        'stay asserted in apps/api/test/auth/auth-guards.spec.ts.',
      ].join('\n'),
    );
  } finally {
    await context.dispose();
  }
}

/**
 * Refuses to start a run with no operator to sign in as.
 *
 * Every spec here signs in as the development admin, which
 * `pnpm --filter api dev-admin:seed` creates. Without it every spec fails on a
 * sign-in form with "those credentials are not valid for this console" — which
 * is a true message about a missing fixture, and reads like a broken login.
 *
 * Checked by actually signing in, not by looking for an environment variable:
 * the account either works or it does not, and only one of those is worth
 * starting a run on.
 */
async function assertTheDevelopmentAdminExists(context: APIRequestContext): Promise<void> {
  const response = await context.post(`${API_BASE_URL}/auth/login`, {
    data: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASSWORD },
    failOnStatusCode: false,
  });

  if (response.ok()) {
    const role = ((await response.json()) as { data: { user: { role: string } } }).data.user.role;

    if (role === 'ADMIN' || role === 'SUPER_ADMIN') return;

    throw new Error(
      `${DEV_ADMIN_EMAIL} exists but its role is ${role}, not a staff role.\n\n` +
        'Re-provision it: pnpm --filter api dev-admin:seed',
    );
  }

  throw new Error(
    [
      `Could not sign in as ${DEV_ADMIN_EMAIL} (HTTP ${String(response.status())}).`,
      '',
      'Every admin spec signs in as the development admin. It is a local fixture',
      'on a reserved .test domain, documented in docs/api/SANDBOX.md §4a, and the',
      'seed refuses to run under NODE_ENV=production.',
      '',
      'Create it:  pnpm --filter api dev-admin:seed',
      '',
      'If it exists but the password was changed, recreate it:',
      '            pnpm --filter api dev-admin:seed -- --reset',
    ].join('\n'),
  );
}
