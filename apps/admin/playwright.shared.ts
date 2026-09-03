import { devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';
import {
  API_BASE_URL,
  BASE_URL,
  DEAD_API_PORT,
  HOST,
  PORT,
  SCRATCH_DATABASE,
  SCRATCH_SUITE,
  UNREACHABLE_API_BASE_URL,
} from './e2e/origin';

/**
 * Everything the admin's two Playwright configurations have in common.
 *
 * ## Why there are two configurations at all
 *
 * Playwright has no per-project web server: `webServer` is a property of the
 * CONFIG, so every server listed there is started for every spec in it. One of
 * these servers exists for exactly four specs — the same application pointed at
 * an API that is not there, so the "the API could not be asked" branch can be
 * reached at all.
 *
 * With one config that made a server four specs need into a hard dependency of
 * all thirty-seven. That is a design flaw rather than a preference, and it
 * showed itself as one: on a memory-constrained machine the third server failed
 * to start with `STATUS_DLL_INIT_FAILED`, and the entire admin suite became
 * unrunnable — including every spec that has nothing to do with it.
 *
 * So the specs that need three servers live in their own configuration with
 * three servers, and the rest run on the two they actually use. A spec depends
 * on what it uses and nothing else.
 *
 * ## Why the shared parts live here rather than being repeated
 *
 * Two configurations mean two places for the origin, the database, the rate
 * limits and the teardown to drift apart — and drift between two copies of a
 * harness setting is precisely how the storefront lost five phases of
 * client-side coverage. Everything below is defined once and spread into both.
 */

/**
 * The base URL, the database, the timeouts, the reporters and the teardown.
 *
 * Deliberately NOT including `webServer`, `testMatch` or `testIgnore`: those
 * are the three things the two configurations must differ in, and spreading a
 * default for them would make the difference easy to lose.
 */
export const sharedConfig = {
  testDir: './e2e',
  /*
   * Runs before anything else and refuses a run against an API that will
   * throttle it — see the file for why that failure is worth catching early
   * rather than letting it surface as unrelated specs failing in a helper.
   */
  globalSetup: './e2e/global-setup.ts',
  /*
   * Removes the accounts and orders every run creates, and gives the seeded
   * catalogue back exactly the stock they took. It was missing at first, and
   * the residue surfaced as the STOREFRONT suite failing on a stock filter —
   * see the file for what that cost.
   */
  globalTeardown: './e2e/global-teardown.ts',

  /*
   * One worker. The lifecycle specs drive orders through a shared catalogue and
   * a shared work queue, and a second worker would contend for both — and for
   * the same operator's session.
   */
  workers: 1,
  fullyParallel: false,

  // Generous, because the admin runs in dev mode and compiles each route on
  // first request. A timeout here would report a slow compile as a broken app.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // No retries locally: a flaky pass is worse than an honest failure, because
  // it hides the flake. CI gets one retry to absorb genuine infrastructure
  // noise without masking a real regression.
  retries: process.env['CI'] === undefined ? 0 : 1,

  /**
   * `list` for the run itself, plus a summary of everything the browser-health
   * fixture chose to IGNORE, with the reason each test gave. An ignore list
   * nobody watches stops being a health check, so the counts are printed on
   * every run, pass or fail.
   */
  reporter: [['list'], ['./e2e/reporters/health-summary.ts']],

  use: {
    /*
     * The ORIGIN, without the basePath. Playwright resolves an absolute path
     * against the origin and discards any path on the base URL, so a base of
     * `.../admin` would make `page.goto('/orders')` load `/orders` and 404.
     * `route()` in `e2e/origin.ts` adds the prefix instead.
     */
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * Both halves of the system, started together.
   *
   * The API is BUILT and run from `dist`, not `nest start --watch`: a watcher
   * restarts mid-run on any file event, and the thing under test should be the
   * compiled artifact anyway.
   *
   * The admin runs in dev mode — `next build` would add minutes to every run
   * for a suite that exercises behaviour, not bundle output.
   */
} satisfies PlaywrightTestConfig;

/**
 * The type of ONE web server entry.
 *
 * Derived rather than imported: Playwright declares `TestConfigWebServer` in
 * its `.d.ts` without exporting it, so the only supported way to name it is
 * through the config type that uses it.
 *
 * Each server is annotated INDIVIDUALLY. Putting all three in one array
 * literal makes TypeScript unify their `env` objects, which adds every other
 * server's keys as `?: undefined` — and `undefined` is not assignable to the
 * `{ [key: string]: string }` index signature Playwright declares. The
 * three-separate-constants shape is not a style preference; the array does not
 * compile.
 */
type WebServer = Extract<
  NonNullable<PlaywrightTestConfig['webServer']>,
  readonly unknown[]
>[number];

export const API_SERVER: WebServer = {
  /*
   * Build, then prepare this suite's database, then serve.
   *
   * `test-db --ensure-clean` reuses the database when it still matches the
   * baseline recorded at preparation and drops and rebuilds it when it does
   * not — which is what the last run leaves behind when it is killed part
   * way. It carries no build step of its own because the line before it is
   * one.
   */
  command:
    'pnpm --filter api build && ' +
    `pnpm --filter api test-db -- --suite ${SCRATCH_SUITE} --ensure-clean && ` +
    'pnpm --filter api start',
  cwd: '../..',
  url: `${API_BASE_URL}/health`,
  timeout: 180_000,
  /**
   * NEVER reused, locally or in CI.
   *
   * A reused API is one a developer started by hand, pointed at the
   * DEVELOPMENT database. This suite places a real order per spec, and
   * pointing those orders at a shared database is precisely the mistake
   * that drained the catalogue and broke the storefront suite. The
   * rate-limit probe in `global-setup` caught the throttle half of a reused
   * server; nothing caught the database half, and that is the half that
   * destroys data.
   */
  reuseExistingServer: false,
  stdout: 'pipe',
  stderr: 'pipe',
  env: {
    /**
     * The suite's own database. Overrides the one named in `MONGODB_URI`,
     * for this process only — see `e2e/origin.ts`.
     */
    MONGODB_DB_NAME: SCRATCH_DATABASE,

    /**
     * Rate limits raised for THIS process only — see
     * `apps/api/src/config/throttle.config.ts` for the multiplier and the
     * reasoning.
     *
     * Every spec here signs an operator in, and 5 logins per 15 minutes is
     * the production number: a second run inside the window would fail on
     * the throttle rather than on the code. A suite that fails for
     * environmental reasons teaches everyone to disregard failures.
     *
     * The guard itself is still tested, against the REAL numbers, in
     * `apps/api/test/auth/auth-guards.spec.ts` — and
     * `apps/api/test/setup/production-like-limits.ts` pins the multiplier
     * to 1 for every jest suite, so this relaxation cannot reach it.
     */
    RATE_LIMIT_RELAXED: 'true',
    // Staff accounts are provisioned already verified, so this changes
    // nothing for them. Set for the same reason the storefront sets it:
    // no test should depend on reading a token out of another process's
    // stdout.
    AUTH_REQUIRE_EMAIL_VERIFICATION: 'false',
    // The default is already `console`, which has no network call at all,
    // so no test can send real mail. Belt and braces.
    EMAIL_PROVIDER: 'console',
  },
};

export const ADMIN_SERVER: WebServer = {
  // `next dev` directly rather than through the `dev` script, so the host
  // and port are passed without depending on pnpm argument forwarding.
  // `--hostname` is what makes the dev server call itself the same thing
  // the tests call it.
  command: `pnpm exec next dev --hostname ${HOST} --port ${PORT}`,
  cwd: '.',
  /*
   * The hydration canary's page, so readiness also warms the route every
   * test loads first. It carries the basePath because every route in this
   * application does.
   */
  url: `${BASE_URL}/admin/login`,
  timeout: 180_000,
  reuseExistingServer: process.env['CI'] === undefined,
  stdout: 'pipe',
  stderr: 'pipe',
  env: {
    API_BASE_URL,
    /**
     * Its OWN build directory, not `.next`.
     *
     * A developer's `pnpm dev` and this suite both used `.next`, so they
     * shared one dev cache and route manifest. A killed run or two servers
     * racing on it leaves that cache in a state the next server serves
     * happily and wrongly — on the admin console it produced clean 404s for
     * every nested route while the index answered 200. Same reasoning as
     * the per-suite databases: no shared mutable state between a developer
     * and a run.
     */
    NEXT_DIST_DIR: '.next-e2e',
    /**
     * The third use of HOST: the origin `next dev` will serve
     * `/admin/_next/*` to. Passed rather than written out in
     * `next.config.ts`, so there is no second place for it to drift from —
     * which is exactly how the storefront lost five phases of client-side
     * coverage.
     */
    DEV_ORIGIN_HOST: HOST,
    /*
     * A bigger heap for `next dev`, for the same reason the storefront
     * needs one: once the suite exercises CLIENT behaviour the dev server
     * is actually asked to compile and serve every chunk, which needs more
     * than Node's default heap on this machine.
     *
     * A harness setting, not a product one: `next build` is unaffected and
     * production serves pre-built chunks.
     */
    NODE_OPTIONS: '--max-old-space-size=4096',
  },
};

export const UNREACHABLE_API_SERVER: WebServer = {
  /**
   * The same application, pointed at an API that is not there.
   *
   * Exists so `admin-identity.spec.ts` can reach the "the API could not be
   * asked" branch — see `e2e/origin.ts` for why that branch cannot be
   * tested any other way. Cookies are host-scoped, so a spec signs in
   * against the healthy server above and navigates here with the same
   * session: a valid session and an unreachable API.
   */
  command: `pnpm exec next dev --hostname ${HOST} --port ${DEAD_API_PORT}`,
  cwd: '.',
  // The LOGIN page, which needs no API call to render — the dashboard here
  // would render an error, and readiness must not depend on the thing this
  // server exists to have broken.
  url: `http://${HOST}:${DEAD_API_PORT}/admin/login`,
  timeout: 180_000,
  reuseExistingServer: process.env['CI'] === undefined,
  stdout: 'pipe',
  stderr: 'pipe',
  env: {
    API_BASE_URL: UNREACHABLE_API_BASE_URL,
    DEV_ORIGIN_HOST: HOST,
    /*
     * Its own build directory. Next 16 locks on that directory and refuses
     * to start a second `next dev` for the same project without it —
     * "Another next dev server is already running."
     */
    NEXT_DIST_DIR: '.next-dead-api',
    NODE_OPTIONS: '--max-old-space-size=4096',
  },
};

/**
 * The specs that need the unreachable-API server, named in ONE place.
 *
 * `playwright.config.ts` ignores this file and
 * `playwright.unreachable-api.config.ts` matches it, so a spec cannot end up in
 * both runs or in neither.
 */
export const UNREACHABLE_API_SPECS = 'admin-identity-unreachable.spec.ts';
