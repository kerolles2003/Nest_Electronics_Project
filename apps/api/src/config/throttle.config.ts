import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { env } from './env.schema';

/**
 * How much of the rate limit actually applies.
 *
 * THE ONE PLACE. Every rate limit in this API is written once, at the route it
 * protects, in a `@Throttle` decorator whose numbers are the frozen policy
 * (AUTHORIZATION-MODEL.md §7). Nothing rewrites those numbers. What this
 * namespace decides is a single multiplier that `AppThrottlerGuard` applies to
 * whatever limit the route declared, so relaxing the limits for a test run is
 * one decision in one file rather than an env var per endpoint.
 *
 * ## Why relaxing exists at all
 *
 * The browser suite needs accounts, and registration is 3 an hour per IP while
 * login is 5 per 15 minutes. Those are the right numbers for the internet and a
 * hard ceiling for a suite: a second run inside the hour failed on the throttle
 * rather than on the code. A suite that fails for environmental reasons trains
 * everybody to disregard failures, and that is how a real one gets missed.
 *
 * ## Why a multiplier rather than a switch
 *
 * Turning the guard off would stop exercising it: the tracker, the IP+email
 * key, the `Retry-After` header and the error envelope would all go untested in
 * every browser run. Multiplying keeps the whole path live and only moves the
 * ceiling out of the suite's way.
 */

/**
 * Applied to every declared limit when relaxed.
 *
 * Large enough that no plausible suite reaches it — 3 registrations an hour
 * becomes 600 — and finite on purpose, so a runaway loop in a test still stops
 * instead of hammering the process until it falls over.
 */
export const RELAXED_LIMIT_MULTIPLIER = 200;

export const throttleConfig = registerAs('throttle', () => {
  const e = env();

  return {
    /**
     * True only in a test environment that asked for it. The schema refuses
     * this value in production outright, so the escape hatch cannot escape.
     */
    relaxed: e.RATE_LIMIT_RELAXED,

    /** 1 in every normal process; the multiplier above in a relaxed one. */
    limitMultiplier: e.RATE_LIMIT_RELAXED ? RELAXED_LIMIT_MULTIPLIER : 1,
  } as const;
});

export type ThrottleConfig = ConfigType<typeof throttleConfig>;
