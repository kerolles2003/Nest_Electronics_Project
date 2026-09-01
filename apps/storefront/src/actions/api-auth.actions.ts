'use server';

import { redirect } from 'next/navigation';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { clearSession, readSession, writeSession } from '@/lib/api/session';
import type { ActionState, AuthFormState } from '@/lib/api/action-state';

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
  redirect('/shop/login?registered=1');
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
    return { error: customerMessage(result.error), fieldErrors: fieldErrorsOf(result.error) };
  }

  // Tokens sit at the TOP of `data`, alongside `user`.
  await writeSession({
    accessToken: result.data.data.accessToken,
    refreshToken: result.data.data.refreshToken,
  });
  redirect('/shop');
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
  redirect('/shop/login');
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
