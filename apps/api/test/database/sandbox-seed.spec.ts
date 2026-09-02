import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SANDBOX_EMAIL,
  SANDBOX_PASSWORD,
} from '../../src/database/seed/sandbox.seed-data';
import { validatePassword } from '../../src/modules/auth/domain/password-policy';

/**
 * The sandbox account's credentials are a promise made in a document.
 *
 * `docs/api/SANDBOX.md` tells a mobile developer to sign in with a specific
 * email and password, and a document is exactly the thing that drifts: someone
 * changes the seed, the docs still say the old value, and the first thing the
 * new developer does is fail to log in and conclude the API is broken. Nothing
 * else in the repository would notice.
 *
 * These read the two sources and compare them. No database, no network — this
 * runs in milliseconds and fails on the commit that breaks it rather than on
 * the afternoon somebody follows the guide.
 */

const SANDBOX_DOC = join(__dirname, '../../../../docs/api/SANDBOX.md');

describe('the documented sandbox credentials are the seeded ones', () => {
  const doc = readFileSync(SANDBOX_DOC, 'utf8');

  it('SANDBOX.md names the email the seed creates', () => {
    expect(doc).toContain(SANDBOX_EMAIL);
  });

  it('SANDBOX.md names the password the seed sets', () => {
    expect(doc).toContain(SANDBOX_PASSWORD);
  });

  it('documents the reset command the seed actually implements', () => {
    // The flag is parsed by `process.argv.includes('--reset')`. If the doc
    // taught a different one, reset would silently do nothing and re-converge,
    // which looks like it worked.
    expect(doc).toContain('pnpm --filter api sandbox:seed -- --reset');
  });

  it('offers a password the API would itself accept', () => {
    /*
     * The seed creates the account through `AuthService.register`, so a
     * password the policy rejects would fail the seed rather than silently
     * documenting an unusable one. This asserts the same thing one layer
     * earlier and without a database, so the failure names the cause.
     */
    expect(validatePassword(SANDBOX_PASSWORD, SANDBOX_EMAIL)).toBeNull();
  });

  it('uses a reserved test domain, so the address can never receive mail', () => {
    // RFC 2606: `.test` is reserved and unresolvable. A seeded account on a
    // real domain would mean a development run could mail a stranger.
    expect(SANDBOX_EMAIL).toMatch(/\.test$/);
  });
});
