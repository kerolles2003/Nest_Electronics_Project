'use server';

import { redirect } from 'next/navigation';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { clearSession, readSession, writeSession } from '@/lib/api/session';
import type { ActionState, AuthFormState } from '@/lib/api/action-state';
import { safeRedirect } from '@/lib/safe-redirect';

/**
 * Authentication against the NestJS API.
 *
 * The API owns identity — registration, password policy, verification, session
 * rotation and roles all live there. This file is the adapter, nothing more: it
 * moves a form into an API call and the resulting token pair into httpOnly
 * cookies. No Supabase Auth, no Clerk, no second session store, and no
 * client-side notion of "logged in" beyond the presence of that cookie.
 */

function fieldErrorsOf(error: {
  details: readonly { field: string; message: string }[];
}): Record<string, string> {
  const out: Record<string, string> = {};

  for (const d of error.details) {
    // First message per field wins: a form shows one message per input.
    if (!(d.field in out)) out[d.field] = d.message;
  }

  return out;
}

export async function registerAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const phone = String(formData.get('phone') ?? '').trim();

  const result = await tryApi(() =>
    api.register({
      email: String(formData.get('email') ?? '').trim(),
      password: String(formData.get('password') ?? ''),
      fullName: String(formData.get('fullName') ?? '').trim(),
      ...(phone === '' ? {} : { phone }),
    }),
  );

  if (!result.ok) {
    return { error: customerMessage(result.error), fieldErrors: fieldErrorsOf(result.error) };
  }

  /*
   * Registration issues NO session, by design: the API requires the address to
   * be verified before the account can sign in, so there are no tokens to
   * store. Sending the customer to a guarded route here would bounce them
   * straight back to the sign-in page.
   */
  redirect('/login?registered=1');
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const result = await tryApi(() =>
    api.login({
      email: String(formData.get('email') ?? '').trim(),
      password: String(formData.get('password') ?? ''),
    }),
  );

  if (!result.ok) {
    return {
      error: customerMessage(result.error),
      fieldErrors: fieldErrorsOf(result.error),
      // So the form can offer a resend on EMAIL_NOT_VERIFIED without reading
      // the prose. See the note on `ActionState.code`.
      code: result.error.code,
    };
  }

  // Tokens sit at the TOP of `data`, alongside `user`.
  await writeSession({
    accessToken: result.data.data.accessToken,
    refreshToken: result.data.data.refreshToken,
  });

  redirect(safeRedirect(String(formData.get('redirectTo') ?? '')));
}

/**
 * Ends the session.
 *
 * The refresh token is revoked SERVER-SIDE first, so the credential is dead
 * even if a copy of the cookie survives somewhere. Clearing the cookies alone
 * would leave a working 30-day token in the wild.
 *
 * A failed revocation still clears the cookies: from this browser's point of
 * view the customer is signed out either way, and leaving them signed in
 * because the server was briefly unreachable would be the wrong answer.
 */
export async function logoutAction(): Promise<void> {
  const session = await readSession();

  if (session !== null) {
    await tryApi(() => api.logout(session.refreshToken));
  }

  await clearSession();
  redirect('/');
}

/**
 * Requests a fresh verification email.
 *
 * Reports the SAME message on every outcome, because the API does: telling a
 * visitor "no such account" here would hand an enumerator a password-free
 * oracle. The only failure surfaced is a transport one, where nothing was
 * asked at all.
 */
export async function resendVerificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim();

  if (email.length === 0) {
    return { error: 'Enter the email address you registered with.', fieldErrors: {} };
  }

  const result = await tryApi(() => api.resendVerification(email));

  if (!result.ok) {
    return { error: customerMessage(result.error), fieldErrors: {} };
  }

  return { error: null, fieldErrors: {}, message: result.data.data.message };
}

/**
 * Starts a password reset.
 *
 * Returns the SAME message on every outcome, because the API does. An address
 * with no account, an address that has one, and an address that already has a
 * live reset token are indistinguishable here — anything else hands an
 * enumerator a password-free oracle, and it would be this page that gave it to
 * them.
 *
 * So there is deliberately no "we couldn't find that account" branch to write,
 * and no way to write one: the success path never learns which case it was.
 */
export async function forgotPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim();

  if (email.length === 0) {
    return { error: 'Enter the email address for your account.', fieldErrors: {} };
  }

  const result = await tryApi(() => api.forgotPassword(email));

  if (!result.ok) {
    return { error: customerMessage(result.error), fieldErrors: fieldErrorsOf(result.error) };
  }

  return { error: null, fieldErrors: {}, message: result.data.data.message };
}

/**
 * Completes a reset with the token from the email.
 *
 * The confirm-password field is checked HERE and only here: it does not exist
 * on the wire, because the server has no second copy to compare against. The
 * password policy itself is NOT re-implemented — the API owns it and reports
 * it per field, so a local copy would drift and start rejecting passwords the
 * server would accept.
 *
 * On success the API has revoked every session for that account, including any
 * this browser held, so the customer is sent to sign in rather than anywhere
 * that assumes one.
 */
export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get('token') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirmPassword') ?? '');

  if (token.length === 0) {
    return {
      error: 'This reset link is incomplete. Request a new one below.',
      fieldErrors: {},
    };
  }

  if (password !== confirm) {
    return { error: null, fieldErrors: { confirmPassword: 'The two passwords do not match.' } };
  }

  const result = await tryApi(() => api.resetPassword({ token, password }));

  if (!result.ok) {
    return { error: customerMessage(result.error), fieldErrors: fieldErrorsOf(result.error) };
  }

  redirect('/login?reset=1');
}
