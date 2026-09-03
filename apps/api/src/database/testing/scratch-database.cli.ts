import {
  assertScratchDatabaseIsClean,
  ensureCleanScratchDatabase,
} from './scratch-database';
import { SCRATCH_SUITES, parseScratchSuite, type ScratchSuite } from './scratch-databases';

/**
 * The scratch-database harness, for callers that are not this application.
 *
 *   pnpm --filter api test-db -- --suite storefront-e2e --ensure-clean
 *   pnpm --filter api test-db -- --suite storefront-e2e --assert-clean
 *
 * The two Playwright suites live in other workspaces and cannot import from
 * this one, so they reach the same two functions through this command. The jest
 * suite, which is in this workspace, calls them directly and never comes
 * through here.
 *
 * There is deliberately no build step in the `test-db` script: Playwright
 * already runs `pnpm --filter api build` before starting the API, and a second
 * `nest build` inside every invocation would add half a minute to every browser
 * run for no benefit.
 */

interface Invocation {
  readonly suite: ScratchSuite;
  readonly action: 'ensure-clean' | 'assert-clean';
}

const USAGE = [
  'Usage:',
  '  test-db --suite <suite> --ensure-clean   prepare the database, rebuilding it if dirty',
  '  test-db --suite <suite> --assert-clean   fail if the run left anything behind',
  '',
  `Suites: ${SCRATCH_SUITES.join(', ')}`,
].join('\n');

export function parse(argv: readonly string[]): Invocation {
  const suite = parseScratchSuite(valueOf(argv, '--suite'));

  const actions = (['ensure-clean', 'assert-clean'] as const).filter((action) =>
    argv.includes(`--${action}`),
  );

  if (actions.length !== 1) {
    throw new Error(
      actions.length === 0
        ? 'give exactly one of --ensure-clean or --assert-clean'
        : 'give --ensure-clean or --assert-clean, not both',
    );
  }

  // `actions.length === 1` is checked above, so the index is inhabited; the
  // assertion is for the compiler, not a claim about the data.
  return { suite, action: actions[0] as Invocation['action'] };
}

/**
 * The value after a flag.
 *
 * Refuses a value that starts with `--`, because `--suite --ensure-clean` is a
 * forgotten argument rather than a suite called `--ensure-clean`, and taking it
 * literally turns a typo into a confusing failure two steps later. The same
 * trap the staff-provisioning CLI hit with `--email --role`.
 */
function valueOf(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);

  if (index === -1) return undefined;

  const value = argv[index + 1];

  return value === undefined || value.startsWith('--') ? undefined : value;
}

async function main(): Promise<void> {
  const { suite, action } = parse(process.argv.slice(2));

  if (action === 'assert-clean') {
    await assertScratchDatabaseIsClean(suite);
    process.stdout.write(`${suite}: nothing left behind\n`);

    return;
  }

  const prepared = await ensureCleanScratchDatabase(suite);

  process.stdout.write(
    prepared.rebuilt
      ? `${suite}: rebuilt ${prepared.database}\n`
      : `${suite}: reusing ${prepared.database}, already clean\n`,
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    // stderr rather than the Nest logger: these contexts are created with
    // `logger: ['warn', 'error']` and a `logger.log` there goes nowhere, which
    // is how the staff-provisioning CLI once succeeded in silence.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);

    if (error instanceof Error && /--suite|--ensure-clean|--assert-clean/.test(error.message)) {
      process.stderr.write(`\n${USAGE}\n`);
    }

    process.exitCode = 1;
  });
}
