import { test as base, expect, type Page, type TestInfo } from '@playwright/test';

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
 * **Deliberately empty.**
 *
 * It held one entry, `/_next\/webpack-hmr/`, added because the hot-module-reload
 * WebSocket failed on every page and reported the failed handshake through
 * `console.error`. That diagnosis was wrong. The socket was failing because the
 * dev server was refusing every cross-origin `/_next/*` request — the same
 * refusal that stopped React booting at all — so the entry was not suppressing
 * dev noise, it was suppressing **the only visible symptom of the bug that
 * invalidated every browser test in the suite**, at 77-84 occurrences a run.
 *
 * With the origin pinned (see `playwright.config.ts`) the socket connects and
 * nothing needs suppressing. The list stays as a named, empty thing rather than
 * being deleted, because the next person to add an entry should have to read
 * this paragraph first: an ignore rule costs a whole class of evidence, and the
 * counting machinery below exists because this one went unexamined for months.
 *
 * Anything added here must be scoped by URL or exact text, never by category
 * ("WebSocket errors", "hydration warnings"), and must say what it is hiding.
 */
const DEV_SERVER_NOISE: readonly RegExp[] = [];

/**
 * The page the hydration canary loads.
 *
 * Any page would prove the point — the root layout mounts client components on
 * every route — so this is the one that is always present and cheapest to
 * reach. `playwright.config.ts` points the storefront's readiness probe at the
 * same path, so it is already compiled before the first test runs.
 */
export const HYDRATION_CANARY_PATH = '/';

/**
 * How long to wait for React to take over the server-rendered HTML.
 *
 * Generous, because `next dev` compiles a route on first request. The cost of
 * being wrong in this direction is a slow first test; the cost of being wrong
 * in the other is reporting a compile as a broken application.
 */
const HYDRATION_TIMEOUT_MS = 30_000;

/** Polled inside the browser. Both signals, because the difference is triage. */
export interface HydrationProbe {
  /** A React root is attached to the document — the application is running. */
  readonly hydrated: boolean;
  /** Next's client runtime evaluated — the chunks at least arrived. */
  readonly clientRuntimeLoaded: boolean;
}

/**
 * Runs in the page. Looks for React's own internal markers rather than for
 * anything the application has to opt into: React writes `__reactContainer$…`
 * on the hydration container and `__reactFiber$…` / `__reactProps$…` on every
 * host node it owns, so their presence is proof that `hydrateRoot` actually
 * ran, and their absence cannot be faked by server HTML.
 */
export function probeHydration(): HydrationProbe {
  const marked = (node: unknown): boolean =>
    node !== null &&
    node !== undefined &&
    Object.keys(node as object).some((key) => key.startsWith('__react'));

  const candidates: unknown[] = [
    document,
    document.documentElement,
    document.body,
    ...Array.from(document.querySelectorAll('body *')).slice(0, 200),
  ];

  return {
    hydrated: candidates.some(marked),
    clientRuntimeLoaded: 'next' in window,
  };
}

function explainDeadClient(url: string, probe: HydrationProbe): string {
  return (
    `Client-side React never mounted on ${url}.\n\n` +
    'This test was about to run against server-rendered HTML with no client\n' +
    'behaviour at all: no effect, no event handler, no store hydration, no\n' +
    'client-side navigation. Almost every assertion in the suite still passes in\n' +
    'that state, which is exactly why it is checked rather than assumed — this\n' +
    'condition held for the whole of phases 1 to 5a and nothing noticed.\n\n' +
    `  React root attached ......... ${probe.hydrated ? 'yes' : 'NO'}\n` +
    `  Next client runtime loaded .. ${probe.clientRuntimeLoaded ? 'yes' : 'NO'}\n\n` +
    (probe.clientRuntimeLoaded
      ? 'The chunks arrived and the runtime evaluated, so this is a hydration\n' +
        'failure inside the application rather than a serving problem. Look for a\n' +
        'thrown error in the browser-health attachment for this test.'
      : 'No client runtime at all, so the browser never executed /_next/* chunks.\n' +
        'The usual cause is an ORIGIN MISMATCH: `next dev` refuses cross-origin\n' +
        'requests for dev assets and treats `127.0.0.1` and `localhost` as\n' +
        'different origins. The host the suite drives, the `--hostname` the dev\n' +
        'server is started with and `allowedDevOrigins` must all be the same\n' +
        'value; all three derive from HOST in playwright.config.ts. If a dev\n' +
        'server was already running on this port it was REUSED, config and all —\n' +
        'stop it and let the suite start its own.')
  );
}

/**
 * Fails the test, before its body runs, if the browser is not running the
 * application.
 */
async function assertClientBooted(page: Page, testInfo: TestInfo): Promise<void> {
  await page.goto(HYDRATION_CANARY_PATH);

  let probe: HydrationProbe = { hydrated: false, clientRuntimeLoaded: false };
  const deadline = Date.now() + HYDRATION_TIMEOUT_MS;

  do {
    probe = await page.evaluate(probeHydration);
    if (probe.hydrated) return;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);

  const message = explainDeadClient(page.url(), probe);

  await testInfo.attach('hydration-canary.txt', { body: message, contentType: 'text/plain' });

  throw new Error(message);
}

/**
 * The attachment the summary reporter reads.
 *
 * A name rather than a shared import so the reporter, which runs in the main
 * process, never has to load this module and its Playwright fixtures.
 */
export const SUPPRESSION_ATTACHMENT = 'browser-health-suppressed';

/** How many problems each ignore rule swallowed, by rule. */
export interface SuppressionCounts {
  /** Keyed by the rule's source text, so a new entry names itself in the log. */
  readonly [rule: string]: number;
}

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
  /** How many problems each ignore rule swallowed during this test. */
  suppressions(): SuppressionCounts;
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

  /**
   * Everything the ignore rules swallowed, counted by rule.
   *
   * An ignore list nobody looks at stops being a health check: it grows one
   * "just this one" at a time, and the suite goes quiet without anyone deciding
   * that it should. Counting is the cheapest thing that makes the growth
   * visible — the rule's own source text is the key, so a new entry announces
   * itself in the summary the first time it fires.
   */
  const suppressed = new Map<string, number>();

  const suppress = (rule: RegExp): void => {
    suppressed.set(rule.source, (suppressed.get(rule.source) ?? 0) + 1);
  };

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

    const noise = DEV_SERVER_NOISE.find((pattern) => pattern.test(text));
    if (noise !== undefined) {
      suppress(noise);
      return;
    }

    const allowed = allowedConsole.find((pattern) => pattern.test(text));
    if (allowed !== undefined) {
      suppress(allowed);
      return;
    }

    // The in-page reporter above routes rejections through console.error;
    // relabel them so the report names the real kind.
    const isRejection = text.startsWith('[unhandledrejection]');
    record(isRejection ? 'unhandledrejection' : 'console.error', text);
  });

  page.on('response', (response) => {
    if (response.status() < 500) return;

    const url = response.url();

    const allowed = allowedServer.find((pattern) => pattern.test(url));
    if (allowed !== undefined) {
      suppress(allowed);
      return;
    }

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
    suppressions() {
      return Object.fromEntries(suppressed);
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

      /*
       * Before the test body, on every spec that takes a browser.
       *
       * The listeners above are installed first on purpose: if the canary page
       * throws while loading, that error is captured and attached rather than
       * lost behind the canary's own failure.
       */
      await assertClientBooted(page, testInfo);

      await use(health);

      const problems = health.problems();
      const suppressions = health.suppressions();

      /*
       * Attached on EVERY test, including passing ones.
       *
       * The point is visibility of what was ignored, and a suppression that
       * only surfaces on failure is invisible in exactly the runs where the
       * list is quietly growing. The summary reporter aggregates these and
       * prints one line per rule at the end of the run.
       */
      if (Object.keys(suppressions).length > 0) {
        await testInfo.attach(SUPPRESSION_ATTACHMENT, {
          body: JSON.stringify(suppressions),
          contentType: 'application/json',
        });
      }

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
