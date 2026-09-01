import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

/**
 * Prints what the browser-health fixture chose to ignore.
 *
 * ## Why a reporter and not a `console.log` in the fixture
 *
 * The fixture runs once per test, in a worker process. A line printed there is
 * one line per test, interleaved with the test output, and says nothing about
 * the run as a whole — which is the only level at which "is the ignore list
 * growing?" is a meaningful question. A reporter runs in the main process and
 * sees every test, so it can answer it once, at the end, where somebody will
 * read it.
 *
 * ## Why this exists at all
 *
 * The fixture ignores the Next dev server's hot-reload WebSocket error, and
 * tests may declare further exceptions with `health.allowConsoleError(...)`.
 * Every one of those is a thing the health check is deliberately not checking.
 * That is legitimate, and it is also exactly how a health check dies: one
 * "just this one" at a time, silently, until the suite is green because it
 * stopped looking rather than because the pages are sound.
 *
 * Counting does not prevent that. It makes it visible — the count is printed
 * whether the run passes or fails, and a rule that starts firing appears in the
 * output by its own source text the first time it does.
 *
 * The reporter never fails a run. Deciding that a number is too high is a
 * judgement for a person, and a reporter that started failing builds on a
 * threshold nobody agreed would just be another thing to suppress.
 */

const ATTACHMENT = 'browser-health-suppressed';

export default class HealthSummaryReporter implements Reporter {
  private readonly totals = new Map<string, number>();
  private testsWithSuppressions = 0;

  onTestEnd(_test: TestCase, result: TestResult): void {
    const attachment = result.attachments.find((a) => a.name === ATTACHMENT);
    if (attachment?.body === undefined) return;

    let counts: Record<string, number>;
    try {
      counts = JSON.parse(attachment.body.toString('utf8')) as Record<string, number>;
    } catch {
      // A malformed attachment is not worth failing a run over, and saying so
      // is more useful than a stack trace from a reporter.
      process.stdout.write('browser-health: could not read a suppression attachment\n');
      return;
    }

    this.testsWithSuppressions += 1;

    for (const [rule, count] of Object.entries(counts)) {
      this.totals.set(rule, (this.totals.get(rule) ?? 0) + count);
    }
  }

  onEnd(_result: FullResult): void {
    if (this.totals.size === 0) {
      process.stdout.write('\nbrowser-health: nothing was ignored in this run.\n');
      return;
    }

    const total = [...this.totals.values()].reduce((sum, n) => sum + n, 0);

    const lines = [...this.totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([rule, count]) => `  ${String(count).padStart(5)}  /${rule}/`);

    process.stdout.write(
      `\nbrowser-health: ignored ${String(total)} browser problem(s) ` +
        `across ${String(this.testsWithSuppressions)} test(s), by rule:\n` +
        `${lines.join('\n')}\n` +
        'Each line is something the health check did NOT check. If a rule you do not\n' +
        'recognise appears here, or a count grows, that is the signal to look.\n',
    );
  }
}
