/**
 * The shape a form action hands back, and its empty value.
 *
 * These live OUTSIDE the `'use server'` files on purpose. In Next.js 16 a
 * `"use server"` module may export only async functions — every export becomes
 * a callable server endpoint, so a plain object export is a build error:
 *
 *   A "use server" file can only export async functions, found object.
 *
 * Keeping the constants here lets both the server actions and the client
 * components that seed `useActionState` import one definition, with no
 * duplicated literal drifting between them.
 */

export interface ActionState {
  /** A message already safe to show a customer, or null. */
  error: string | null;
  /** Server-named field errors, keyed by the field the API blamed. */
  fieldErrors: Record<string, string>;
  /**
   * A SUCCESS message, when the server produced one worth showing.
   *
   * Optional rather than nullable so the many actions that only ever fail or
   * redirect are not forced to write `message: null` — and so the type keeps
   * saying that a successful action normally has nothing to add.
   */
  message?: string;
  /**
   * The API's stable error code, when a form needs to BRANCH on the failure
   * rather than only show it.
   *
   * Optional, and set by the few actions that have a reader for it. The one
   * that does is sign-in: a refused password and an unverified address are both
   * "you cannot sign in", but only the second has a next step the customer can
   * take, and offering "resend the verification email" after a wrong password
   * would be telling them the wrong thing about their own account.
   *
   * A code and not the message. The first version of that branch tested
   * `error.includes('not verified')` against a message the API words as
   * *"Verify your email address before signing in."* — so it matched nothing,
   * and the resend offer it guarded could never appear. Nothing failed: the
   * types were satisfied, the build was clean, and the feature was simply
   * absent. Rewording a sentence must not silently remove a control.
   */
  code?: string;
}

export const emptyActionState: ActionState = { error: null, fieldErrors: {} };

/** Auth forms use the same shape; the alias keeps call sites readable. */
export type AuthFormState = ActionState;

export const emptyAuthState: AuthFormState = emptyActionState;
