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
}

export const emptyActionState: ActionState = { error: null, fieldErrors: {} };

/** Auth forms use the same shape; the alias keeps call sites readable. */
export type AuthFormState = ActionState;

export const emptyAuthState: AuthFormState = emptyActionState;
