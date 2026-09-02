import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLACEHOLDER_SECRET, envSchema, formatIssues } from '../../src/config/env.schema';

/**
 * `.env.example` must not be a working configuration.
 *
 * ## What went wrong
 *
 * The example shipped
 * `JWT_SECRET=REPLACE_WITH_A_LOCALLY_GENERATED_KEY_OF_AT_LEAST_32_CHARS`, which
 * is 57 characters, so it satisfied the "at least 32" rule. `cp .env.example
 * .env` — the first command in the sandbox guide — produced an API that booted,
 * seeded and issued signed tokens using a key committed to the repository.
 *
 * The schema's own comment said "no default, deliberately: a defaulted signing
 * key is a forged-token vulnerability that reaches production silently". That
 * was true of the schema and false of the workflow. A placeholder nothing
 * rejects IS a default.
 *
 * ## Why a test rather than a code review note
 *
 * The failure mode is a value in an untyped text file drifting into something
 * that happens to validate. Nobody reviews `.env.example` for that. This does,
 * on every run, and it fails on the commit rather than in whatever environment
 * copied the file.
 */

const EXAMPLE = join(__dirname, '../../.env.example');

/** The value of one `KEY=value` line, ignoring commented-out lines. */
function exampleValue(key: string): string | undefined {
  const source = readFileSync(EXAMPLE, 'utf8');
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm').exec(source);

  return match?.[1]?.trim().replace(/^["']|["']$/g, '');
}

describe('.env.example cannot be used as it stands', () => {
  it('ships a JWT_SECRET the schema refuses', () => {
    const value = exampleValue('JWT_SECRET');

    expect(value).toBeDefined();
    expect(PLACEHOLDER_SECRET.test(value as string)).toBe(true);

    const result = envSchema.shape.JWT_SECRET.safeParse(value);

    expect(result.success).toBe(false);
  });

  it('says how to generate a real one when it refuses', () => {
    /*
     * The refusal is the whole user experience of this control: someone who
     * skipped the step sees only this sentence, and it has to be enough to act
     * on without opening the source.
     */
    const result = envSchema.shape.JWT_SECRET.safeParse(exampleValue('JWT_SECRET'));

    expect(result.success).toBe(false);

    if (!result.success) {
      const message = result.error.issues[0]?.message ?? '';

      expect(message).toContain('randomBytes');
      expect(message).toContain('apps/api/.env');
    }
  });

  it('accepts a genuinely generated key of the documented length', () => {
    // The control must refuse the placeholder and nothing else. A key that
    // merely contains the word "replace" is fine; only the prefix is refused.
    const generated = 'kJ8vQx2mNp4rTz9wLc7hYb3sVf6dGa1eXu5nRj0iOk';

    expect(envSchema.shape.JWT_SECRET.safeParse(generated).success).toBe(true);
    expect(
      envSchema.shape.JWT_SECRET.safeParse('a-key-that-says-replace-and-is-long-enough').success,
    ).toBe(true);
  });

  it('still refuses a key that is merely too short', () => {
    // The new rule is an addition, not a replacement.
    expect(envSchema.shape.JWT_SECRET.safeParse('too-short').success).toBe(false);
  });
});

/**
 * A guard that fires and says nothing is half a guard.
 *
 * `formatIssues` redacts every message on a secret key, because a Zod message
 * can interpolate the value it rejected. Right in general — and it swallowed
 * the remedy: the first version of the placeholder rule printed
 * `JWT_SECRET  Invalid or missing value`, which does not tell a developer
 * which of the two rules they broke or what to do about it. Found by running
 * the sandbox guide on a clean clone, the same way the hole itself was.
 *
 * These assert both halves: the remedy reaches the developer, and nothing that
 * has not declared itself value-free does.
 */
describe('a secret-key failure says what to do without echoing the secret', () => {
  const messagesFor = (value: unknown): string[] => {
    const result = envSchema.shape.JWT_SECRET.safeParse(value);

    expect(result.success).toBe(false);

    return result.success ? [] : formatIssues(result.error).map((line) => line.trim());
  };

  it('prints the remedy when the placeholder is still in place', () => {
    const printed = messagesFor(exampleValue('JWT_SECRET')).join('\n');

    expect(printed).toContain('.env.example placeholder');
    expect(printed).toContain('randomBytes');
    expect(printed).toContain('apps/api/.env');
    expect(printed).not.toContain('Invalid or missing value');
  });

  it('prints the length rule rather than hiding it', () => {
    expect(messagesFor('short').join('\n')).toContain('at least 32 characters');
  });

  it('NEVER prints a message it was not told is value-free', () => {
    /*
     * The default must stay redaction. A future rule added to JWT_SECRET
     * without the marker — or any message Zod writes itself, some of which
     * interpolate the received value — has to come out as the placeholder
     * string, or this whole mechanism becomes a way to leak a credential into
     * a boot log.
     */
    const leaky = z
      .string()
      .refine(() => false, { message: 'the value you sent was hunter2' });

    const result = leaky.safeParse('hunter2');

    expect(result.success).toBe(false);

    if (!result.success) {
      // Re-pathed to a secret key, which is what the formatter keys on.
      const issue = { ...result.error.issues[0], path: ['JWT_SECRET'] };
      const printed = formatIssues({ issues: [issue] } as never).join('');

      expect(printed).toContain('Invalid or missing value');
      expect(printed).not.toContain('hunter2');
    }
  });
});
