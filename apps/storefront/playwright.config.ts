import { defineConfig, devices } from '@playwright/test';
import { API_BASE_URL, BASE_URL, HOST, PORT, SCRATCH_DATABASE, SCRATCH_SUITE } from './e2e/origin';

/**
 * Browser end-to-end configuration.
 *
 * ## Scope, deliberately small
 *
 * ONE journey: the purchase path a real customer walks. This is not the start
 * of a broad UI suite — the API contract journey (`apps/api/test/journey`) and
 * the 400+ API tests remain the primary safety net, and they are faster,
 * cheaper and more precise than a browser. What a browser adds, and nothing
 * else can, is proof that the rendered pages, forms, server actions and
 * redirects actually connect to each other.
 *
 * ## Not part of `pnpm test`
 *
 * There is no `test` script in this workspace, so `turbo test` does not reach
 * this file. That is intentional: these tests need a database, a running API
 * and a running storefront, and wiring three moving parts into the standard
 * verification chain would make a green build depend on local infrastructure.
 * Run them explicitly with `pnpm --filter storefront test:e2e`.
 *
 * ## They write to a real database
 *
 * The journey registers an account and places an order, so it must be pointed
 * at a DISPOSABLE environment — never at production. It writes to a database of
 * its own (`SCRATCH_DATABASE`), which the API rebuilds before the run if the
 * last one left it dirty and which `globalTeardown` proves is untouched
 * afterwards. That is a cleanup, not a licence.
 */
/*
 * HOST, PORT, BASE_URL and API_BASE_URL all come from `e2e/origin.ts` — one
 * module, so the origin the tests drive, the host the dev server binds to and
 * the origin it trusts cannot become three different strings. See that file for
 * what went wrong when they were written out separately.
 */

export default defineConfig({
  testDir: './e2e',
  /*
   * Runs before anything else and refuses a run against an API that will
   * throttle it — see the file for why that failure is worth catching early
   * rather than letting it surface as unrelated specs failing in a helper.
   */
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  // One worker: the journey is inherently sequential and shares one catalogue.
  // Parallel workers would contend for stock on the same seeded product.
  workers: 1,
  fullyParallel: false,

  // Generous, because the storefront runs in dev mode and compiles each route
  // on first request. A timeout here would report a slow compile as a broken
  // application.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // No retries locally: a flaky pass is worse than an honest failure, because
  // it hides the flake. CI gets one retry to absorb genuine infrastructure
  // noise without masking a real regression.
  retries: process.env['CI'] === undefined ? 0 : 1,

  /**
   * `list` for the run itself, plus a summary of everything the browser-health
   * fixture chose to IGNORE. An ignore list nobody watches stops being a health
   * check, so the counts are printed on every run, pass or fail.
   */
  reporter: [['list'], ['./e2e/reporters/health-summary.ts']],

  use: {
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
   * The storefront runs in dev mode — `next build` would add minutes to every
   * run for a journey that exercises behaviour, not bundle output.
   */
  webServer: [
    {
      /*
       * Build, then prepare this suite's database, then serve.
       *
       * `test-db --ensure-clean` reuses the database when it matches the
       * baseline preparation recorded, and drops and rebuilds it when it does
       * not — which is what a crashed previous run leaves behind. It has no
       * build step of its own precisely because the line before it is one.
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
       * This used to reuse an API already listening on the port, which meant a
       * server a developer started by hand — pointed at the DEVELOPMENT
       * database, with production rate limits — silently became the system
       * under test. The rate-limit half of that was caught by `global-setup`;
       * the database half was not, and it is the half that destroys data.
       *
       * The cost is one build and boot per run. The alternative is a suite
       * that writes real orders into whichever database somebody else's
       * process happened to open, which is exactly the damage that made all of
       * this necessary. If the port is busy Playwright says so and stops,
       * which is the right conversation to have.
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
         * The browser journey covers the PURCHASE path. Email verification is
         * proven end-to-end elsewhere — `apps/api/test/notifications/
         * email-integration.spec.ts` reads the token out of the actual message
         * body, posts it to the real endpoint and then signs in.
         *
         * Reproducing that here would mean scraping a token out of another
         * process's stdout, which buys no additional coverage and buys real
         * flakiness. So verification is disabled for this process only, and
         * the journey starts where a verified customer starts.
         */
        AUTH_REQUIRE_EMAIL_VERIFICATION: 'false',
        // Belt and braces. The default is already `console`, and `console` has
        // no network call at all, so no test can send real mail.
        EMAIL_PROVIDER: 'console',
        SITE_URL: BASE_URL,
        /**
         * Rate limits raised for THIS process only — see
         * `apps/api/src/config/rate-limits.ts` for the multiplier and the
         * reasoning.
         *
         * The production limits (3 registrations an hour, 5 logins per 15
         * minutes) are right for the internet and a hard ceiling for a suite
         * that needs an account or two per run: a second run inside the hour
         * failed on the throttle rather than on the code. A suite that fails
         * for environmental reasons teaches everyone to disregard failures,
         * which is how a real one gets missed.
         *
         * The guard itself is still tested, against the real numbers, in
         * `apps/api/test/auth/auth-guards.spec.ts` — jest pins them so this
         * relaxation cannot reach it.
         */
        RATE_LIMIT_RELAXED: 'true',
      },
    },
    {
      // `next dev` directly rather than through the `dev` script, so the host
      // and port are passed without depending on pnpm argument forwarding.
      // `--hostname` is what makes the dev server call itself the same thing
      // the tests call it.
      command: `pnpm exec next dev --hostname ${HOST} --port ${PORT}`,
      cwd: '.',
      // The hydration canary's page (`HYDRATION_CANARY_PATH`), so readiness
      // also warms the route every test loads first.
      url: `${BASE_URL}/`,
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
         * The third use of HOST: the origin `next dev` will serve `/_next/*`
         * to. Passed rather than written out in `next.config.ts`, so there is
         * no second place for it to drift from.
         */
        DEV_ORIGIN_HOST: HOST,
        /*
         * A bigger heap for `next dev`.
         *
         * Turbopack's dev server ran out of memory part-way through a full run
         * once the suite started exercising CLIENT behaviour — until
         * `allowedDevOrigins` was set, every `/_next/*` chunk was refused, so
         * the dev server was never asked to compile and serve most of them.
         * Doing the work it was always supposed to do needs more than Node's
         * default heap on this machine.
         *
         * A harness setting, not a product one: `next build` is unaffected and
         * production serves pre-built chunks.
         */
        NODE_OPTIONS: '--max-old-space-size=4096',
      },
    },
  ],
});
