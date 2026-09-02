import { defineConfig, devices } from '@playwright/test';

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
 * at a DISPOSABLE environment — never at production. `globalTeardown` removes
 * everything it creates; that is a cleanup, not a licence.
 */
/**
 * The ONE host, used three ways that must agree.
 *
 * `next dev` refuses cross-origin requests for `/_next/*` dev assets, and it
 * treats `127.0.0.1` and `localhost` as different origins. So three things have
 * to name the same host or the browser gets no client chunks and React never
 * boots:
 *
 *   1. the origin the tests drive        -> `baseURL` below
 *   2. the host the dev server binds to  -> `next dev --hostname`
 *   3. the origin the dev server trusts  -> `allowedDevOrigins` in next.config
 *
 * They used to be written out separately, two of them in another file, and they
 * drifted — which cost every browser test in the suite its client-side
 * behaviour for months without a single failure. They are one constant now, and
 * the hydration canary in `e2e/fixtures/browser-health.ts` fails every spec
 * immediately if they ever disagree again.
 */
const HOST = process.env['E2E_HOST'] ?? '127.0.0.1';

/**
 * A dedicated port, not 3000.
 *
 * A developer very often already has `next dev` on 3000. Next.js does not fail
 * in that case — it quietly starts on the next free port — so the suite would
 * sit waiting for a server that came up somewhere else and then time out with
 * a message about the web server rather than about the port. Overridable, so
 * CI or a second checkout can move it.
 */
const PORT = process.env['E2E_PORT'] ?? '3100';
const BASE_URL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: './e2e',
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
      command: 'pnpm --filter api build && pnpm --filter api start',
      cwd: '../..',
      url: `http://${HOST}:3002/api/v1/health`,
      timeout: 180_000,
      reuseExistingServer: process.env['CI'] === undefined,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
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
        API_BASE_URL: `http://${HOST}:3002/api/v1`,
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
