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
 * A dedicated port, not 3000.
 *
 * A developer very often already has `next dev` on 3000. Next.js does not fail
 * in that case — it quietly starts on the next free port — so the suite would
 * sit waiting for a server that came up somewhere else and then time out with
 * a message about the web server rather than about the port. Overridable, so
 * CI or a second checkout can move it.
 */
const PORT = process.env['E2E_PORT'] ?? '3100';
const BASE_URL = `http://127.0.0.1:${PORT}`;

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
      url: 'http://127.0.0.1:3002/api/v1/health',
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
      },
    },
    {
      // `next dev` directly rather than through the `dev` script, so the port
      // is passed without depending on pnpm argument forwarding.
      command: `pnpm exec next dev --port ${PORT}`,
      cwd: '.',
      url: `${BASE_URL}/shop`,
      timeout: 180_000,
      reuseExistingServer: process.env['CI'] === undefined,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        API_BASE_URL: 'http://127.0.0.1:3002/api/v1',
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
