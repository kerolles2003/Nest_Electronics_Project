/**
 * Data contract for `auth/verify-email`.
 *
 * Authority: docs/architecture/TEMPLATE-ARCHITECTURE.md §5.
 *
 * Note what is NOT here: no user id, no email address, no role, no token hash.
 * A template receives what the reader needs to see, and nothing that merely
 * happens to be nearby — rule 1 exists because an internal field is otherwise
 * one typo away from a customer's inbox.
 */
export interface VerifyEmailData {
  readonly customerName: string;
  /** Absolute, single-use, and the only place the raw token ever appears. */
  readonly verifyUrl: string;
  /** Pre-formatted for display, e.g. "24 hours". Templates never compute. */
  readonly expiresIn: string;
}
