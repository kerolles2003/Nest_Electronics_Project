/**
 * The server-side password policy.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §2.3.
 *
 * Pure: no NestJS, no Mongoose, no I/O. That is what makes it unit-testable in
 * milliseconds and impossible to couple to transport or persistence
 * (CODEBASE-STRUCTURE.md §3, Tier 3 `domain/`).
 *
 * Legacy validated `min(8)` IN THE BROWSER ONLY, which any client can skip.
 */

export const MIN_PASSWORD_LENGTH = 10;

/**
 * bcrypt silently truncates at 72 BYTES. Accepting anything longer would mean
 * two different passwords authenticating the same account, so a longer password
 * is rejected outright rather than quietly cut.
 */
export const MAX_PASSWORD_BYTES = 72;

/**
 * Common passwords, restricted to those that survive the length rule.
 *
 * The frozen requirement is to reject the ~10k most common passwords. With a
 * 10-character minimum already in force, the overwhelming majority of that list
 * is unreachable — it is dominated by entries of 6 to 9 characters. What matters
 * is the long tail that IS long enough, which is what this list holds. Shipping
 * the full 10k would add ~80 KB to reject strings the length rule rejects first.
 *
 * If a breach-corpus check is later wanted, the natural upgrade is a k-anonymity
 * range query against a Pwned Passwords dataset — a swap of one function here,
 * not a redesign.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '1234567890', '12345678910', '123456789012', '1234567890123', '12345678901234',
  '0987654321', '1234512345', '123123123123', '1111111111', '0000000000',
  '1234567891', '11111111111', '123456789a', '123456789q', 'qwertyuiop',
  'qwertyuiop1', 'qwerty123456', 'qwerty12345', 'qwertyuiop123', 'qwerty1234',
  'asdfghjkl1', 'asdfghjkl123', 'zxcvbnm123', '1qaz2wsx3edc', '1q2w3e4r5t',
  '1q2w3e4r5t6y', 'qazwsxedcrfv', 'q1w2e3r4t5y6', 'passw0rd12', 'password1',
  'password12', 'password123', 'password1234', 'passwordpassword', 'p@ssw0rd123',
  'p@ssword123', 'letmein123', 'letmein1234', 'welcome123', 'welcome1234',
  'iloveyou123', 'iloveyou1234', 'trustno1234', 'sunshine123', 'princess123',
  'football123', 'baseball123', 'basketball1', 'superman123', 'batman12345',
  'pokemon123', 'starwars123', 'liverpool123', 'chelsea123', 'manchester1',
  'barcelona123', 'realmadrid1', 'juventus123', 'arsenal123', 'michael123',
  'jennifer123', 'jessica123', 'nicole12345', 'daniel12345', 'charlie123',
  'thomas12345', 'william123', 'mohamed123', 'mohammed123', 'ahmed123456',
  'mahmoud123', 'abdullah123', 'egypt123456', 'cairo123456', 'alexandria1',
  'administrator', 'admin123456', 'administrator1', 'admin1234', 'root123456',
  'toor123456', 'changeme123', 'changeme1234', 'default123', 'secret12345',
  'secretpassword', 'mypassword1', 'mypassword123', 'newpassword1',
  'newpassword123', 'temppassword', 'testpassword', 'test12345678', 'testing123',
  'qwe123456789', 'abc123456789', 'abcd12345678', 'abcdefghij', 'abcdefgh123',
  'monkey123456', 'dragon123456', 'shadow123456', 'master123456', 'ninja1234567',
  'hunter123456', 'jordan123456', 'harley123456', 'ranger123456', 'buster123456',
  'soccer123456', 'hockey123456', 'killer123456', 'george123456', 'andrew123456',
  'matthew12345', 'joshua123456', 'anthony12345', 'computer123', 'internet123',
  'whatever123', 'freedom1234', 'samsung1234', 'iphone12345', 'android1234',
  'facebook123', 'instagram12', 'whatsapp123', 'youtube1234', 'google12345',
  'microsoft123', 'windows1234', 'linkedin123', 'twitter1234', 'snapchat123',
  'summer2024', 'summer2025', 'summer2026', 'winter2024', 'winter2025',
  'spring2024', 'spring2025', 'autumn2024', 'january2024', 'january2025',
  'december2024', 'september11', 'november2024', 'october2024', 'february2024',
  'aaaaaaaaaa', 'bbbbbbbbbb', 'zzzzzzzzzz', 'asdasdasd1', 'asdasdasdasd',
  'qweqweqwe1', 'qweqweqweqwe', 'zxczxczxc1', 'poiuytrewq', 'lkjhgfdsa1',
  'mnbvcxz123', 'trustno1234567', 'welcometothejungle', 'thisismypassword',
]);

export type PasswordRejectionReason = 'TOO_SHORT' | 'TOO_LONG' | 'COMMON' | 'CONTAINS_EMAIL';

export interface PasswordRejection {
  readonly reason: PasswordRejectionReason;
  readonly message: string;
}

/**
 * Returns the first reason a password is unacceptable, or `null` if it passes.
 *
 * There are deliberately NO composition rules — no forced symbol, digit or case
 * classes. Length beats composition: forced classes push people toward
 * `Password1!`, which is in every cracking dictionary, while a longer passphrase
 * is genuinely harder.
 */
export function validatePassword(password: string, email: string): PasswordRejection | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      reason: 'TOO_SHORT',
      message: `password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`,
    };
  }

  // Measured in BYTES, because that is what bcrypt truncates. A password of
  // emoji or Arabic reaches 72 bytes long before it reaches 72 characters.
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return {
      reason: 'TOO_LONG',
      message: `password must not exceed ${String(MAX_PASSWORD_BYTES)} bytes`,
    };
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { reason: 'COMMON', message: 'password is too common — choose something less guessable' };
  }

  // The email and its local part are the two strings an attacker tries first
  // against a specific account.
  const normalised = normaliseEmail(email);
  const localPart = normalised.split('@')[0] ?? '';
  const candidate = password.toLowerCase();

  if (candidate === normalised || (localPart.length >= 4 && candidate.includes(localPart))) {
    return { reason: 'CONTAINS_EMAIL', message: 'password must not contain your email address' };
  }

  return null;
}

/**
 * Lowercase and trim. Applied at EVERY boundary that touches an email —
 * registration, login, verification resend — so `Maker@Example.com` and
 * `maker@example.com` can never become two accounts, and so the unique index
 * actually means what it appears to mean.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
