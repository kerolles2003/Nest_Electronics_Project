import { defineConfig } from '@playwright/test';
import {
  ADMIN_SERVER,
  API_SERVER,
  UNREACHABLE_API_SERVER,
  UNREACHABLE_API_SPECS,
  sharedConfig,
} from './playwright.shared';

/**
 * The specs that need an API which is not there, and the third server they need.
 *
 * ## Why these are separated
 *
 * `readAdminIdentity()` has three outcomes — signed in, not signed in, and the
 * API could not be asked — and only the third is unreachable from a normal
 * test. `GET /auth/me` is called SERVER-side by the Next process, so
 * `page.route()` cannot intercept it, and stopping the real API would break
 * every other spec in the run. The only honest way to reach that branch is a
 * second copy of the application pointed at a port nothing listens on.
 *
 * That copy is a whole extra `next dev`. Playwright has no per-project web
 * server, so while it lived in the main configuration it was a hard dependency
 * of every admin spec — and when it failed to start, all thirty-seven went with
 * it rather than the four that need it. A spec should depend on what it uses.
 *
 * ## Why all THREE servers are here
 *
 * These specs use every one. They sign in against the healthy server, because
 * a session cannot be obtained from a broken one, and then navigate to the dead
 * server carrying the same cookies — host-scoped, not port-scoped — which is
 * exactly the state under test: a valid session and an unreachable API.
 *
 * ## Same database, run sequentially
 *
 * Both configurations use the admin suite's one scratch database, so they must
 * not run at the same time. `test:e2e` runs them in sequence; running them
 * concurrently would have two suites cleaning up after each other.
 */
export default defineConfig({
  ...sharedConfig,

  /* Paired with the `testIgnore` in `playwright.config.ts` against the same
   * constant, so a spec cannot fall into both runs or out of both. */
  testMatch: UNREACHABLE_API_SPECS,

  webServer: [API_SERVER, ADMIN_SERVER, UNREACHABLE_API_SERVER],
});
