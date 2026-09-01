import { test as base, expect, type Page } from '@playwright/test';

/**
 * The browser-health fixture (F-14).
 *
 * ## Why this exists
 *
 * The e2e suite had **zero** console or page-error listeners, so a test passed
 * as long as the assertions it happened to write were satisfied. The reported
 * production bug — "An unexpected response was received from the server."
 * (F-05) — is exactly the shape that slips through: the page still renders,
 * navigation still appears to work, and the failure lives entirely in an
 * exception the test never looks at.
 *
 * A green test that ignores a thrown exception is not evidence of a working
 * page. This fixture makes the browser's own distress signals part of every
 * assertion budget, automatically, so the next bug of that class fails a test
 * instead of reaching a customer.
 *
 * ## What fails a test
 *
 * - an uncaught exception in the page (`pageerror`)
 * - an unhandled promise rejection
 * - anything written to `console.error`
 * - any response with status >= 500 that the test did not declare
 *
 * ## Opting out, explicitly
 *
 * A test that MEANS to provoke a failure declares it — `health.allowConsoleError(...)`,
 * `health.allowServerError(...)`. Declaring is deliberately more effort than
 * ignoring: an unexplained exception should cost someone a sentence explaining
 * why it is acceptable, and that sentence is then in the diff for a reviewer.
 */

/**
 * Noise from the DEV SERVER, not from the application — excluded globally.
 *
 * The storefront is served by `next dev` during e2e (a production build would
 * add minutes to every run), and the dev server opens a hot-module-reload
 * WebSocket that the Playwright-driven browser cannot always complete. Chromium
 * reports that failed handshake through `console.error`, so without this the
 * fixture fails every test in the suite for a channel that **does not exist in
 * a production build** and carries no information about the application.
 *
 * Scoped to the HMR endpoint by URL rather than to "WebSocket errors" in
 * general: a real WebSocket failure in application code must still fail a test.
 * This list is deliberately short and each entry has to justify itself — an
 * ignore list is how a health check quietly stops checking anything.
 */
const DEV_SERVER_NOISE: readonly RegExp[] = [/_next\/webpack-hmr/];

/** One recorded problem, with enough context to act on it. */
interface HealthProblem {
  readonly kind: 'pageerror' | 'unhandledrejection' | 'console.error' | 'server-error';
  readonly detail: string;
  /** The page URL at the moment it happened — the single most useful field. */
  readonly at: string;
}

export interface BrowserHealth {
  /**
   * Permit console errors whose text matches. Call BEFORE the action that
   * provokes them.
   */
  allowConsoleError(pattern: RegExp): void;
  /** Permit >= 500 responses whose URL matches. */
  allowServerError(pattern: RegExp): void;
  /** Everything recorded so far — for a test that wants to assert positively. */
  problems(): readonly HealthProblem[];
}

/**
 * Reported from inside the page.
 *
 * Playwright surfaces uncaught exceptions through `pageerror`, but an unhandled
 * promise rejection is not an uncaught exception and does not reliably arrive
 * there. Since a rejected promise is the normal shape of a failed `fetch` or a
 * failed server action, missing it would leave the fixture blind to precisely
 * the class of bug it was built for — so the page reports them itself.
 */
const REJECTION_REPORTER = `
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const text = reason instanceof Error
      ? (reason.stack || reason.message)
      : String(reason);
    console.error('[unhandledrejection] ' + text);
  });
`;

function describe(problems: readonly HealthProblem[]): string {
  const lines = problems.map((p, i) => `  ${String(i + 1)}. [${p.kind}] at ${p.at}\n     ${p.detail}`);

  return (
    `The browser reported ${String(problems.length)} problem(s) during this test.\n\n` +
    `${lines.join('\n')}\n\n` +
    'A page that throws is a broken page even when the assertions pass. If one of\n' +
    'these is genuinely expected, declare it with health.allowConsoleError(...) or\n' +
    'health.allowServerError(...) and say why.'
  );
}

async function install(page: Page): Promise<BrowserHealth> {
  const problems: HealthProblem[] = [];
  const allowedConsole: RegExp[] = [];
  const allowedServer: RegExp[] = [];

  const record = (kind: HealthProblem['kind'], detail: string): void => {
    problems.push({ kind, detail, at: page.url() });
  };

  await page.addInitScript(REJECTION_REPORTER);

  page.on('pageerror', (error) => {
    record('pageerror', error.stack ?? error.message);
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;

    const text = message.text();
    if (DEV_SERVER_NOISE.some((pattern) => pattern.test(text))) return;
    if (allowedConsole.some((pattern) => pattern.test(text))) return;

    // The in-page reporter above routes rejections through console.error;
    // relabel them so the report names the real kind.
    const isRejection = text.startsWith('[unhandledrejection]');
    record(isRejection ? 'unhandledrejection' : 'console.error', text);
  });

  page.on('response', (response) => {
    if (response.status() < 500) return;

    const url = response.url();
    if (allowedServer.some((pattern) => pattern.test(url))) return;

    record('server-error', `${String(response.status())} ${response.request().method()} ${url}`);
  });

  return {
    allowConsoleError(pattern) {
      allowedConsole.push(pattern);
    },
    allowServerError(pattern) {
      allowedServer.push(pattern);
    },
    problems() {
      return problems;
    },
  };
}

/**
 * The extended `test`. Import this instead of `@playwright/test` and every
 * spec is covered without opting in.
 */
export const test = base.extend<{ health: BrowserHealth }>({
  health: [
    async ({ page }, use, testInfo) => {
      const health = await install(page);

      await use(health);

      const problems = health.problems();

      if (problems.length > 0) {
        // Attached before the assertion so the artifact exists even though the
        // next line fails the test.
        await testInfo.attach('browser-health.txt', {
          body: describe(problems),
          contentType: 'text/plain',
        });
      }

      expect(problems, describe(problems)).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
