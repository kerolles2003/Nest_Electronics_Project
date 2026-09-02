import { describe, expect, it } from '@jest/globals';
import { PassThrough } from 'node:stream';
import {
  confirm,
  openPrompter,
  parse,
  readPassword,
  type Options,
} from '../../src/database/seed/staff-provision.cli';
import { Role } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * The command-line half of `staff:create`.
 *
 * ## Why this file exists
 *
 * `StaffProvisioningService` has the security rules and its own suite. This has
 * the part that decides WHAT is handed to those rules — and both bugs found
 * while exercising the command by hand were here, in code that looked obviously
 * correct:
 *
 *  1. `--email --role ADMIN` took `"--role"` as the email address, so a slip of
 *     the hand would have created an account nobody asked for, under a name
 *     that is not an address.
 *  2. The prompts used a fresh `readline` interface each, which works on a
 *     terminal and **silently loses every answer after the first** anywhere
 *     else — readline reads ahead, and closing an interface discards what it
 *     buffered. The command hung forever having already been told the password.
 *
 * The second is the reason the whole file is here. A provisioning command that
 * cannot be driven except by hand is a command whose refusals are never
 * exercised, and its refusals are the entire point.
 *
 * Pure: streams in memory, no database, no Nest. Milliseconds.
 */

/** A prompter wired to in-memory streams, plus what was written to the output. */
function prompterOver(input: string): {
  prompt: ReturnType<typeof openPrompter>;
  written: () => string;
} {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const chunks: string[] = [];

  stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));

  const prompt = openPrompter(stdin, stdout);

  /*
   * Written in ONE chunk, deliberately. That is exactly the shape that broke
   * the original: readline splits the chunk into every line it contains and
   * emits them all in one tick, before any `await` has registered the next
   * question.
   */
  stdin.end(input);

  return { prompt, written: () => chunks.join('') };
}

const OPTIONS: Options = {
  email: 'operations@example.com',
  fullName: 'Operations Lead',
  role: Role.ADMIN,
  phone: null,
  acknowledgeExistingSuperAdmin: false,
};

describe('parsing the arguments', () => {
  it('reads a complete invocation', () => {
    const options = parse([
      '--email', ' Operations@Example.com ',
      '--name', ' Operations Lead ',
      '--role', 'SUPER_ADMIN',
      '--phone', '01012345678',
    ]);

    expect(options).toEqual({
      email: 'Operations@Example.com',
      fullName: 'Operations Lead',
      role: Role.SUPER_ADMIN,
      phone: '01012345678',
      acknowledgeExistingSuperAdmin: false,
    });
  });

  it('refuses a flag whose value is the NEXT FLAG', () => {
    /*
     * `--email --role ADMIN`. A naive `argv[i + 1]` reads "--role" as the
     * address, and the command then offers to create an account called
     * `--role`. It is one missing shell argument away from happening.
     */
    expect(() => parse(['--email', '--role', 'ADMIN', '--name', 'X'])).toThrow(/--email/);
  });

  it('refuses each missing option by NAME, and names all of them at once', () => {
    const error = (() => {
      try {
        parse([]);
        return null;
      } catch (thrown) {
        return thrown as Error;
      }
    })();

    expect(error?.message).toContain('--email');
    expect(error?.message).toContain('--name');
    expect(error?.message).toContain('--role');
  });

  it('refuses a role that is not a staff role', () => {
    expect(() => parse(['--email', 'a@b.com', '--name', 'A', '--role', 'CUSTOMER'])).toThrow(
      /--role must be ADMIN or SUPER_ADMIN/,
    );
    expect(() => parse(['--email', 'a@b.com', '--name', 'A', '--role', 'admin'])).toThrow();
  });

  it('has NO password option at all', () => {
    // The single most important property of this command's interface. A
    // password that can be an argument is a password that can have a default,
    // and one that appears in `ps` and in shell history.
    const usage = (() => {
      try {
        parse([]);
        return '';
      } catch (thrown) {
        return (thrown as Error).message;
      }
    })();

    expect(usage).not.toMatch(/--password/);
    expect(usage).toContain('The password is NOT an argument');

    // And passing one is not quietly accepted as anything.
    const options = parse([
      '--email', 'a@b.com', '--name', 'A', '--role', 'ADMIN',
      '--password', 'hunter2',
    ]);

    expect(Object.values(options)).not.toContain('hunter2');
  });

  it('treats the super-admin acknowledgement as a bare flag', () => {
    expect(
      parse(['--email', 'a@b.com', '--name', 'A', '--role', 'SUPER_ADMIN',
             '--acknowledge-existing-super-admin']).acknowledgeExistingSuperAdmin,
    ).toBe(true);

    expect(
      parse(['--email', 'a@b.com', '--name', 'A', '--role', 'SUPER_ADMIN'])
        .acknowledgeExistingSuperAdmin,
    ).toBe(false);
  });
});

describe('the prompts survive input that arrives all at once', () => {
  it('answers three questions from a single chunk', async () => {
    // THE regression test. Before the input queue this hung on the second
    // prompt, having already been given every answer.
    const { prompt } = prompterOver('operations@example.com\nsecret one\nsecret one\n');

    try {
      expect(await confirm(prompt, OPTIONS, 'development')).toBe(true);
      expect(await readPassword(prompt)).toBe('secret one');
    } finally {
      prompt.close();
    }
  });

  it('names the account and the environment before asking', async () => {
    const { prompt, written } = prompterOver('operations@example.com\n');

    try {
      await confirm(prompt, { ...OPTIONS, role: Role.SUPER_ADMIN }, 'production');
    } finally {
      prompt.close();
    }

    const output = written();

    for (const shown of ['operations@example.com', 'Operations Lead', 'SUPER_ADMIN', 'production']) {
      expect(output).toContain(shown);
    }

    // The extra sentence a super-admin gets. It is the role that can grant
    // roles, and the prompt should say so before it is granted.
    expect(output).toContain('There is no undo here.');
  });

  it('aborts on anything other than the exact address', async () => {
    for (const typed of ['y', 'yes', '', 'operations@example.co', 'Operations@example.com']) {
      const { prompt } = prompterOver(`${typed}\n`);

      try {
        expect([typed, await confirm(prompt, OPTIONS, 'development')]).toEqual([typed, false]);
      } finally {
        prompt.close();
      }
    }
  });

  it('does not echo the password, and does echo the prompt', async () => {
    const { prompt, written } = prompterOver('correct horse battery\ncorrect horse battery\n');

    try {
      await readPassword(prompt);
    } finally {
      prompt.close();
    }

    const output = written();

    expect(output).toContain('Password (not echoed):');
    expect(output).toContain('Repeat it:');
    expect(output).not.toContain('correct horse battery');
  });

  it('refuses two passwords that do not match, and creates nothing', async () => {
    const { prompt } = prompterOver('first phrase\nsecond phrase\n');

    try {
      await expect(readPassword(prompt)).rejects.toThrow(/did not match/);
    } finally {
      prompt.close();
    }
  });

  it('refuses an empty password rather than defaulting one', async () => {
    const { prompt } = prompterOver('\n\n');

    try {
      await expect(readPassword(prompt)).rejects.toThrow(/no password was entered/);
    } finally {
      prompt.close();
    }
  });

  it('refuses rather than hanging when the input ends early', async () => {
    /*
     * EOF with a question outstanding — a script that pipes too few lines, or
     * an operator pressing Ctrl-D. Answering with an empty string turns it into
     * the "no password" refusal above; without the close handler this waits
     * forever, which in CI is a job that has to be killed rather than a
     * failure anybody can read.
     */
    const { prompt } = prompterOver('');

    try {
      await expect(readPassword(prompt)).rejects.toThrow(/no password was entered/);
    } finally {
      prompt.close();
    }
  });
});
