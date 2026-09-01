/**
 * Data contract for `auth/password-reset`.
 *
 * Authority: docs/architecture/TEMPLATE-ARCHITECTURE.md §5.
 *
 * Deliberately the same three fields as `VerifyEmailData` and no more. Note in
 * particular what is absent: no email address, no user id, no token hash, and
 * no "requested from" IP or user agent. A reset email is read by whoever holds
 * the mailbox — including, in the case this feature exists for, someone who
 * should not — so it carries the minimum needed to act and nothing that would
 * confirm a fact about the account to a reader who has not proven they own it.
 */
export interface PasswordResetData {
  readonly customerName: string;
  /** Absolute, single-use, and the only place the raw token ever appears. */
  readonly resetUrl: string;
  /** Pre-formatted for display, e.g. "1 hour". Templates never compute. */
  readonly expiresIn: string;
}
