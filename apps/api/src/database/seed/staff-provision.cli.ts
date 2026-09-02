import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { Role } from '../../modules/users/infrastructure/schemas/user.schema';

/**
 * The parts of `staff:create` that can be tested without a database.
 *
 * Split out for the same reason `sandbox.seed-data.ts` is split from its seed:
 * `staff.provision.ts` ends in `void main()`, so importing it to reach a
 * function would run the command.
 *
 * The split earns itself. Both bugs found while exercising this command by hand
 * were in here and in neither of the two places that had tests — argument
 * parsing that would take the NEXT FLAG as an email address, and a prompt that
 * silently dropped its answer off a terminal. `staff-provision-cli.spec.ts`
 * pins both.
 */

/**
 * Operator-facing output goes to the STREAMS, not to the Nest logger.
 *
 * The application context is created with `logger: ['warn', 'error']` to keep
 * boot noise out of an interactive command — which silently swallowed
 * `logger.log('created ADMIN ...')`, so a successful run printed the prompts,
 * created the account, and said nothing at all. The result of a command that
 * mints an administrator must not be at the mercy of a log-level setting.
 */
export const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

export const complain = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

export interface Options {
  readonly email: string;
  readonly fullName: string;
  readonly role: Role.ADMIN | Role.SUPER_ADMIN;
  readonly phone: string | null;
  readonly acknowledgeExistingSuperAdmin: boolean;
}

export const USAGE = [
  'Create a staff account.',
  '',
  '  pnpm --filter api staff:create -- \\',
  '    --email operations@your-domain.com \\',
  '    --name "Operations Lead" \\',
  '    --role ADMIN',
  '',
  'Options:',
  '  --email <address>   required',
  '  --name  <full name> required',
  '  --role  ADMIN | SUPER_ADMIN   required',
  '  --phone <number>    optional',
  '  --acknowledge-existing-super-admin',
  '                      in production, permit a SECOND super-admin',
  '',
  'The password is NOT an argument. You will be prompted for it twice, with no',
  'echo. There is no default, none is generated, and none is printed.',
].join('\n');

/** Reads `--flag value` pairs. Nothing here has a default that creates an account. */
export function parse(argv: readonly string[]): Options {
  const value = (flag: string): string | null => {
    const index = argv.indexOf(flag);

    if (index === -1) return null;

    const next = argv[index + 1];

    // `--email --role ADMIN` would otherwise silently take "--role" as the
    // address and create an account nobody meant to create.
    return next === undefined || next.startsWith('--') ? null : next;
  };

  const email = value('--email');
  const fullName = value('--name');
  const role = value('--role');
  const missing: string[] = [];

  if (email === null) missing.push('--email');
  if (fullName === null) missing.push('--name');
  if (role === null) missing.push('--role');

  if (missing.length > 0) {
    throw new Error(`missing required option(s): ${missing.join(', ')}\n\n${USAGE}`);
  }

  if (role !== Role.ADMIN && role !== Role.SUPER_ADMIN) {
    throw new Error(`--role must be ADMIN or SUPER_ADMIN, not "${String(role)}"\n\n${USAGE}`);
  }

  return {
    email: (email as string).trim(),
    fullName: (fullName as string).trim(),
    role,
    phone: value('--phone'),
    acknowledgeExistingSuperAdmin: argv.includes('--acknowledge-existing-super-admin'),
  };
}

/**
 * ONE readline interface for the whole session.
 *
 * Not three, which is what this was first written as — a fresh
 * `createInterface` per prompt. On a terminal that appears to work. On anything
 * else it hangs after the first question, because readline READS AHEAD: the
 * first interface buffers whatever else is available on the stream and throws
 * that buffer away when it is closed, so the second prompt waits forever for
 * input that has already been consumed.
 *
 * That matters beyond tidiness. A command nobody can drive non-interactively is
 * a command nobody can exercise end-to-end, and the refusals below are the part
 * most worth exercising.
 */
export interface Prompter {
  /** Echoes. For the confirmation, which is not a secret. */
  ask(question: string): Promise<string>;
  /** Does not echo. For the password. */
  askSecret(question: string): Promise<string>;
  /**
   * Writes to the SAME stream the prompts go to.
   *
   * `confirm` used `process.stdout` directly, which is invisible to a test
   * driving an in-memory stream — so the account summary an operator is meant
   * to check before typing the address was, as far as any test could tell, not
   * printed at all. One output, one place to observe it.
   */
  write(text: string): void;
  close(): void;
}

export function openPrompter(input: Readable = process.stdin, output: Writable = process.stdout): Prompter {
  /*
   * `terminal` is deliberately NOT set. Left alone, readline detects it — true
   * for a real terminal, false for a pipe — and forcing `true` makes it apply
   * line editing to a stream that has none. When it is false there is no echo
   * to suppress in the first place, because a pipe does not echo.
   */
  const rl = createInterface({ input, output });

  const internal = rl as unknown as { _writeToOutput?: ((text: string) => void) | undefined };
  const echo = internal._writeToOutput?.bind(rl);
  let muted = false;

  if (echo !== undefined) {
    // The documented way to write a no-echo prompt with readline: the prompt is
    // printed by us, and everything readline would draw is swallowed.
    internal._writeToOutput = (text: string): void => {
      if (!muted) echo(text);
    };
  }

  /*
   * ## Lines are QUEUED, and `rl.question` is not used
   *
   * On a pipe, readline consumes the whole available chunk in one tick and
   * emits a `line` event for every line in it — before any `await` in this file
   * has had a chance to register the next question. `rl.question` installs a
   * one-shot listener, so lines that arrive while no question is pending are
   * delivered to the general `line` event and dropped on the floor.
   *
   * The symptom is that the command answers the first prompt and then hangs
   * forever on the second, having already been given the answer. It only
   * happens off a terminal, which is exactly where an end-to-end test of the
   * refusals has to run.
   *
   * So every line is kept, and a question takes the next one from the queue if
   * it is already there. On a real terminal the queue is always empty and this
   * behaves identically.
   */
  const queued: string[] = [];
  let waiting: ((line: string) => void) | null = null;
  let closed = false;

  rl.on('line', (line: string) => {
    const waiter = waiting;

    if (waiter !== null) {
      waiting = null;
      waiter(line);
      return;
    }

    queued.push(line);
  });

  rl.on('close', () => {
    closed = true;

    // EOF with a question outstanding. Answering with an empty string lets the
    // caller refuse ("no password was entered") rather than hang, which is the
    // honest outcome for input that ended early.
    const waiter = waiting;
    waiting = null;
    waiter?.('');
  });

  const question = async (prompt: string): Promise<string> => {
    if (prompt.length > 0) output.write(prompt);

    const buffered = queued.shift();
    if (buffered !== undefined) return buffered;
    if (closed) return '';

    return new Promise<string>((done) => {
      waiting = done;
    });
  };

  return {
    async ask(text) {
      return (await question(text)).trim();
    },
    async askSecret(text) {
      output.write(text);
      muted = true;

      try {
        return await question('');
      } finally {
        muted = false;
        // The newline the operator's own Return would have echoed.
        process.stdout.write('\n');
      }
    },
    write(text) {
      output.write(text);
    },
    close() {
      if (echo !== undefined) internal._writeToOutput = echo;
      rl.close();
    },
  };
}

/**
 * The password, typed twice and matching.
 *
 * Twice because a mistyped password on an account with no recovery path locks
 * out the only super-admin, and the reset flow needs mail that a fresh
 * installation may not have configured yet.
 */
export async function readPassword(prompt: Prompter): Promise<string> {
  const first = await prompt.askSecret('Password (not echoed): ');

  if (first.length === 0) {
    throw new Error('no password was entered. There is no default — the command creates nothing.');
  }

  const second = await prompt.askSecret('Repeat it: ');

  if (first !== second) {
    throw new Error('the two passwords did not match. Nothing was created.');
  }

  return first;
}

/** Names the account, in full, and requires the address to be retyped. */
export async function confirm(
  prompt: Prompter,
  options: Options,
  nodeEnv: string,
): Promise<boolean> {
  prompt.write(
    [
      '',
      'About to create a STAFF account:',
      '',
      `  email        ${options.email}`,
      `  name         ${options.fullName}`,
      `  role         ${options.role}`,
      `  phone        ${options.phone ?? '(none)'}`,
      `  environment  ${nodeEnv}`,
      '',
      options.role === Role.SUPER_ADMIN
        ? 'SUPER_ADMIN can manage roles and delete accounts. There is no undo here.\n'
        : '',
    ].join('\n'),
  );

  const typed = await prompt.ask('Retype the email address to confirm (or anything else to abort): ');

  return typed === options.email;
}

