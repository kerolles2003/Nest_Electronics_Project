/**
 * The shapes a server action returns to a form.
 *
 * ## Why these are NOT in the `'use server'` file beside the actions
 *
 * A module marked `'use server'` may export **async functions and nothing
 * else**. Every other export is stripped from the client bundle — not with an
 * error at the import site, but silently, so the value arrives as `undefined`.
 *
 * `EMPTY_LOGIN_STATE` lived next to `loginAction` and was passed to
 * `useActionState` as its initial state. It came across as `undefined`, the
 * form read `state.fieldErrors['email']`, and **every render of the sign-in
 * page was a 500** — a server console nobody could sign in to. It was found by
 * the browser-health fixture on the first admin run, which is what that fixture
 * is for: the page still returned HTML, and a test that only looked for a form
 * would have passed.
 *
 * So the constants live in a plain module. Types alone would have been fine —
 * they are erased — but a value is not, and keeping both here means the rule
 * does not have to be remembered twice.
 */

export interface LoginFormState {
  error: string | null;
  /** Keyed by field name, so the form can mark the input that was wrong. */
  fieldErrors: Record<string, string>;
}

export const EMPTY_LOGIN_STATE: LoginFormState = { error: null, fieldErrors: {} };
