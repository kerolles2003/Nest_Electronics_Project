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

export default async function globalSetup(): Promise<void> {
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
