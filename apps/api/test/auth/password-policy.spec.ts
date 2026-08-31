import { describe, expect, it } from '@jest/globals';
import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  normaliseEmail,
  validatePassword,
} from '../../src/modules/auth/domain/password-policy';

/**
 * The password policy is pure — no NestJS, no Mongoose, no database — so this
 * suite runs in milliseconds and can be run on every save.
 *
 * That is exactly the property CODEBASE-STRUCTURE.md §3 requires of a Tier-3
 * `domain/` layer: a security rule that needs a running application to test is
 * a security rule nobody tests.
 */
describe('password policy', () => {
  const email = 'maker@example.com';

  it('accepts a long passphrase with no symbols, digits or capitals', () => {
    // Deliberately has none of the composition classes a naive policy demands.
    expect(validatePassword('brass thermionic valve', email)).toBeNull();
  });

  it(`rejects anything under ${String(MIN_PASSWORD_LENGTH)} characters`, () => {
    // Not a repeated character: 'aaaaaaaaaa' is itself on the common list, so
    // it would fail for the wrong reason and prove nothing about length.
    const atLimit = 'vernier-ca'; // exactly MIN_PASSWORD_LENGTH characters
    expect(atLimit).toHaveLength(MIN_PASSWORD_LENGTH);

    expect(validatePassword(atLimit.slice(0, -1), email)?.reason).toBe('TOO_SHORT');
    expect(validatePassword(atLimit, email)).toBeNull();
  });

  it('measures the maximum in BYTES, because that is what bcrypt truncates', () => {
    // 40 four-byte characters = 160 bytes but only 40 JS "characters", so a
    // length check in characters would let this through and bcrypt would
    // silently ignore everything past byte 72.
    const emoji = '🔧'.repeat(40);
    expect(Buffer.byteLength(emoji, 'utf8')).toBeGreaterThan(MAX_PASSWORD_BYTES);
    expect(validatePassword(emoji, email)?.reason).toBe('TOO_LONG');
  });

  it('rejects well-known passwords that are long enough to pass the length rule', () => {
    expect(validatePassword('password123', email)?.reason).toBe('COMMON');
    expect(validatePassword('qwertyuiop', email)?.reason).toBe('COMMON');
    // Case-insensitively — capitalising a common password does not help.
    expect(validatePassword('Password123', email)?.reason).toBe('COMMON');
  });

  it('rejects the email address and its local part', () => {
    expect(validatePassword(email, email)?.reason).toBe('CONTAINS_EMAIL');
    expect(validatePassword('maker-is-my-name', email)?.reason).toBe('CONTAINS_EMAIL');
    expect(validatePassword('MAKER1234567', email)?.reason).toBe('CONTAINS_EMAIL');
  });

  it('does not reject on a short local part that would match by accident', () => {
    // "al" is only two characters; treating it as a forbidden substring would
    // reject almost every password.
    expect(validatePassword('metallurgy is fun', 'al@example.com')).toBeNull();
  });

  it('never puts the password in the rejection message', () => {
    const secret = 'password123';
    const rejection = validatePassword(secret, email);

    expect(rejection).not.toBeNull();
    expect(rejection?.message).not.toContain(secret);
  });
});

describe('email normalisation', () => {
  it('lowercases and trims, so one address cannot become two accounts', () => {
    expect(normaliseEmail('  Maker@Example.COM ')).toBe('maker@example.com');
  });
});
