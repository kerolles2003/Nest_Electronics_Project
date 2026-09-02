import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Prints what the browser-health fixture chose to ignore, and why.
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
 * ## Why it exists at all
 *
 * Every suppression is a thing the health check is deliberately not checking.
 * That is legitimate, and it is also exactly how a health check dies: one "just
 * this one" at a time, silently, until the suite is green because it stopped
 * looking rather than because the pages are sound. The storefront lost five
 * phases of client-side coverage to a single unexamined entry.
 *
 * Counting does not prevent that. It makes it visible — the count is printed
 * whether the run passes or fails, each rule appears with the REASON the test
 * gave for it, and a rule that starts firing announces itself by its own source
 * text the first time it does.
 *
 * The reporter never fails a run. Deciding that a number is too high is a
 * judgement for a person, and a reporter that started failing builds on a
 * threshold nobody agreed would just be another thing to suppress.
 */

const ATTACHMENT = 'browser-health-suppressed';

interface Record {
  reason: string;
  count: number;
}

export default class HealthSummaryReporter implements Reporter {
  private readonly totals = new Map<string, Record>();
  private testsWithSuppressions = 0;

  onTestEnd(_test: TestCase, result: TestResult): void {
    const attachment = result.attachments.find((a) => a.name === ATTACHMENT);
    if (attachment?.body === undefined) return;

    let counts: Record_Map;
    try {
      counts = JSON.parse(attachment.body.toString('utf8')) as Record_Map;
    } catch {
      // A malformed attachment is not worth failing a run over, and saying so
      // is more useful than a stack trace from a reporter.
      process.stdout.write('browser-health: could not read a suppression attachment\n');
      return;
    }

    this.testsWithSuppressions += 1;

    for (const [rule, record] of Object.entries(counts)) {
      const seen = this.totals.get(rule);

      this.totals.set(rule, {
        // The first reason wins. Two tests suppressing the same pattern for
        // different reasons is itself worth noticing, and the alternative —
        // concatenating them — makes the common case unreadable.
        reason: seen?.reason ?? record.reason,
        count: (seen?.count ?? 0) + record.count,
      });
    }
  }

  onEnd(_result: FullResult): void {
    if (this.totals.size === 0) {
      process.stdout.write('\nbrowser-health: nothing was ignored in this run.\n');
      return;
    }

    const total = [...this.totals.values()].reduce((sum, record) => sum + record.count, 0);

    const lines = [...this.totals.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([rule, record]) => `  ${String(record.count).padStart(5)}  /${rule}/\n         ${record.reason}`);

    process.stdout.write(
      `\nbrowser-health: ignored ${String(total)} browser problem(s) ` +
        `across ${String(this.testsWithSuppressions)} test(s), by rule:\n` +
        `${lines.join('\n')}\n` +
        'Each line is something the health check did NOT check, with the reason the\n' +
        'test gave. If a rule you do not recognise appears here, or a count grows,\n' +
        'that is the signal to look.\n',
    );
  }
}

/** The attachment's shape. Mirrors `SuppressionCounts` in the fixture. */
type Record_Map = globalThis.Record<string, Record>;
