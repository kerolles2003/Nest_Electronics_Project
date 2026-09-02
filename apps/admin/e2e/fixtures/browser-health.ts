import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { route } from '../origin';

/**
 * The browser-health fixture, for the ADMIN application.
 *
 * ## Why this exists here, before a single admin spec does
 *
 * The storefront ran **44 browser specs that were all hollow**. `next dev`
 * refused every cross-origin `/_next/*` request, so React never booted on any
 * page in any test — and they all passed, because pages server-render and forms
 * submit by progressive enhancement. The only visible symptom was a failing
 * hot-reload WebSocket, which was diagnosed as dev noise and added to a
 * suppression list, where it hid the evidence at 77-84 occurrences a run for
 * five phases.
 *
 * The admin is a second Next application with its own dev server and its own
 * config. It can reproduce that failure entirely on its own, and it is the
 * console that moves money, so it gets the protection first: this file and its
 * canary land before any admin spec is written.
 *
 * ## What fails a test
 *
 * - the client never mounted (the hydration canary, below — before the body runs)
 * - an uncaught exception in the page (`pageerror`)
 * - an unhandled promise rejection
 * - anything written to `console.error`
 * - any response with status >= 500 that the test did not declare
 *
 * ## Opting out is a per-test declaration, with a reason, at the call site
 *
 * There is **no blanket suppression list**. A test that means to provoke a
 * failure declares it — `health.allowConsoleError(/…/, 'why')`,
 * `health.allowServerError(/…/, 'why')` — and the reason is required by the
 * signature, so it cannot be omitted in a hurry. Declaring is deliberately more
 * effort than ignoring: an unexplained exception should cost somebody a
 * sentence, and that sentence is then in the diff for a reviewer.
 *
 * Every suppression is counted and the run prints the totals, pass or fail
 * (`reporters/health-summary.ts`). An ignore list nobody watches stops being a
 * health check.
 */

/**
 * The page the hydration canary loads.
 *
 * `/admin/login` and not the dashboard, for one reason that matters: it is the
 * only admin route reachable with NO SESSION. Pointing the canary at a guarded
 * page would mean it measured the proxy's redirect rather than whether React
 * booted, and it would fail for the wrong reason on every unauthenticated spec.
 *
 * It also mounts a client component with state and a submit handler, so a page
 * that renders but does not hydrate is a page this actually catches.
 * `playwright.config.ts` points the dev server's readiness probe at the same
 * path, so it is already compiled before the first test runs.
 */
export const HYDRATION_CANARY_PATH = route('/login');

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
 * ran, and their absence cannot be faked by server-rendered HTML.
 *
 * The two signals separate the two failures. No client runtime at all means the
 * chunks never executed — an origin mismatch, a blocked request, a 404 on
 * `/_next/*`. A runtime that loaded while nothing hydrated means the chunks
 * arrived and hydration THREW, which is a bug in the application and will have
 * left an exception for the fixture to report.
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
    'behaviour at all: no effect, no event handler, no state, no client-side\n' +
    'navigation. Almost every assertion a spec would write still passes in that\n' +
    'state, which is exactly why it is checked rather than assumed — the\n' +
    'storefront held this condition for five phases across 44 tests and nothing\n' +
    'noticed.\n\n' +
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
        'value; all three derive from HOST in e2e/origin.ts. Note that this app\n' +
        'has a basePath, so its chunks are served from /admin/_next/* — a rule\n' +
        'that blocks or rewrites that prefix produces exactly this.\n' +
        'If a dev server was already running on this port it was REUSED, config\n' +
        'and all — stop it and let the suite start its own.')
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

/** What one ignore rule swallowed, and the reason it was allowed to. */
export interface SuppressionRecord {
  readonly reason: string;
  readonly count: number;
}

/** Keyed by the rule's source text, so a new rule names itself in the log. */
export type SuppressionCounts = Readonly<Record<string, SuppressionRecord>>;

/** One recorded problem, with enough context to act on it. */
interface HealthProblem {
  readonly kind: 'pageerror' | 'unhandledrejection' | 'console.error' | 'server-error';
  readonly detail: string;
  /** The page URL at the moment it happened — the single most useful field. */
  readonly at: string;
}

export interface BrowserHealth {
  /**
   * Permit console errors whose text matches, and say WHY. Call BEFORE the
   * action that provokes them.
   *
   * `reason` is a required parameter rather than an optional one on purpose.
   * The storefront's suppression cost a whole class of evidence precisely
   * because nobody had to write down what was being hidden.
   */
  allowConsoleError(pattern: RegExp, reason: string): void;
  /** Permit >= 500 responses whose URL matches, and say why. */
  allowServerError(pattern: RegExp, reason: string): void;
  /** Everything recorded so far — for a test that wants to assert positively. */
  problems(): readonly HealthProblem[];
  /** What each rule swallowed during this test, with its reason. */
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
    'these is genuinely expected, declare it with health.allowConsoleError(pattern,\n' +
    'reason) or health.allowServerError(pattern, reason) — the reason is required,\n' +
    'and it is what a reviewer will read.'
  );
}

function install(page: Page): BrowserHealth {
  const problems: HealthProblem[] = [];
  const allowedConsole: { pattern: RegExp; reason: string }[] = [];
  const allowedServer: { pattern: RegExp; reason: string }[] = [];

  /**
   * Everything the ignore rules swallowed, counted by rule.
   *
   * An ignore list nobody looks at stops being a health check: it grows one
   * "just this one" at a time, and the suite goes quiet without anybody
   * deciding that it should. Counting is the cheapest thing that makes the
   * growth visible, and the reason travels with the count so the summary says
   * what was hidden and not merely how often.
   */
  const suppressed = new Map<string, SuppressionRecord>();

  const suppress = (rule: RegExp, reason: string): void => {
    const seen = suppressed.get(rule.source);

    suppressed.set(rule.source, { reason, count: (seen?.count ?? 0) + 1 });
  };

  const record = (kind: HealthProblem['kind'], detail: string): void => {
    problems.push({ kind, detail, at: page.url() });
  };

  void page.addInitScript(REJECTION_REPORTER);

  page.on('pageerror', (error) => {
    record('pageerror', error.stack ?? error.message);
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;

    const text = message.text();

    /*
     * There is no DEV_SERVER_NOISE list here, and that absence is deliberate.
     * The storefront had one. It held exactly one entry — the hot-reload
     * WebSocket failure — added because the socket failed on every page. The
     * diagnosis was wrong: the socket was failing because the dev server was
     * refusing every cross-origin `/_next/*` request, the same refusal that
     * stopped React booting at all. The entry was not suppressing dev noise, it
     * was suppressing the only visible symptom of the bug that invalidated the
     * entire suite.
     *
     * So this application starts with none, and every suppression is a per-test
     * declaration with a reason at the call site.
     */
    const allowed = allowedConsole.find((rule) => rule.pattern.test(text));

    if (allowed !== undefined) {
      suppress(allowed.pattern, allowed.reason);
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
    const allowed = allowedServer.find((rule) => rule.pattern.test(url));

    if (allowed !== undefined) {
      suppress(allowed.pattern, allowed.reason);
      return;
    }

    record('server-error', `${String(response.status())} ${response.request().method()} ${url}`);
  });

  return {
    allowConsoleError(pattern, reason) {
      allowedConsole.push({ pattern, reason });
    },
    allowServerError(pattern, reason) {
      allowedServer.push({ pattern, reason });
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
 * admin spec is covered without opting in.
 */
export const test = base.extend<{ health: BrowserHealth }>({
  health: [
    async ({ page }, use, testInfo) => {
      const health = install(page);

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
       * list is quietly growing.
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
