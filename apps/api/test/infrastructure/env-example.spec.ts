import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLACEHOLDER_SECRET, envSchema } from '../../src/config/env.schema';

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
