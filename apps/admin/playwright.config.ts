import { defineConfig } from '@playwright/test';
import {
  ADMIN_SERVER,
  API_SERVER,
  UNREACHABLE_API_SPECS,
  sharedConfig,
} from './playwright.shared';

/**
 * Browser end-to-end configuration for the ADMIN console — the main run.
 *
 * ## Why the admin gets its own suite
 *
 * It is a second Next application, with its own dev server, its own config and
 * its own `basePath`. It can reproduce the storefront's "React never booted"
 * failure entirely on its own — and it is the console that confirms, ships and
 * delivers orders, so it is the worse place for a hollow suite to live.
 *
 * The harness therefore landed BEFORE the first admin spec: the origin is
 * pinned from one constant, the hydration canary runs before every test body,
 * and the canary itself is tested (`e2e/hydration-canary.spec.ts`).
 *
 * ## TWO servers, not three
 *
 * The unreachable-API specs need a third — the same application pointed at an
 * API that is not there — and Playwright has no per-project web server, so
 * listing it here made every spec in this file depend on it. The consequence
 * was not theoretical: on a memory-constrained machine that third server failed
 * to start with STATUS_DLL_INIT_FAILED and took all thirty-seven specs down
 * with it, including the thirty-three that never touch it.
 *
 * Those specs now live in `playwright.unreachable-api.config.ts`, which starts
 * three. This file ignores them and starts the two it uses.
 *
 * ## Not part of `pnpm test`
 *
 * There is no `test` script in this workspace, so `turbo test` does not reach
 * this file. That is intentional: these tests need a database, a running API
 * and a running admin app, and wiring three moving parts into the standard
 * verification chain would make a green build depend on local infrastructure.
 * Run them explicitly with `pnpm --filter admin test:e2e`.
 *
 * ## They write to a real database
 *
 * The specs sign an operator in and drive real orders through real lifecycle
 * endpoints, so this must be pointed at a DISPOSABLE environment — never at
 * production. It writes to a database of its own, which the API rebuilds if the
 * last run left it dirty and which `globalTeardown` proves is untouched after.
 */
export default defineConfig({
  ...sharedConfig,

  /*
   * The one place this run differs in WHAT it selects. Paired with the
   * `testMatch` in the unreachable-API config against the same constant, so a
   * spec cannot fall into both runs or out of both.
   */
  testIgnore: UNREACHABLE_API_SPECS,

  webServer: [API_SERVER, ADMIN_SERVER],
});
