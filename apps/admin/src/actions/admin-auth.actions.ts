'use server';

import { redirect } from 'next/navigation';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { isStaff } from '@/lib/api/identity';
import { clearSession, readSession, writeSession } from '@/lib/api/session';
import type { LoginFormState } from '@/lib/api/action-state';

/**
 * Admin authentication against the NestJS API.
 *
 * The API owns identity — the password policy, session rotation, revocation and
 * roles all live there. This file is the adapter: it moves a form into an API
 * call and the resulting token pair into httpOnly cookies.
 *
 * ## What this replaces
 *
 * `LoginForm` called `supabase.auth.signInWithPassword` in the BROWSER, and the
 * proxy then verified the role with a `profiles` lookup made using the
 * **service-role key** — a full-privilege database credential, held by the
 * admin app, used on every navigation to read one column. Both are gone. There
 * is no Supabase client in this app's auth path and no service-role key in its
 * environment.
 */

/*
 * `LoginFormState` and `EMPTY_LOGIN_STATE` are NOT declared here.
 *
 * A `'use server'` module may export async functions and nothing else. Every
 * other export is stripped from the client bundle silently, so a constant
 * declared here reaches the form as `undefined` — which is exactly what
 * happened: `useActionState(loginAction, EMPTY_LOGIN_STATE)` got `undefined`,
 * the form read `state.fieldErrors`, and every render of the sign-in page was a
 * 500. See `@/lib/api/action-state`.
 */

/**
 * Signs an operator in.
 *
 * ## A customer's correct password does not open this console
 *
 * The API authenticates any valid account, so a CUSTOMER's credentials produce
 * a perfectly good token pair. Storing it would sign them in to the admin
 * shell, where every screen would then fail with an authorization error that
 * reads like a broken application.
 *
 * The role is therefore checked HERE, against the `user` the API returned with
 * the tokens, before anything is written to a cookie. A non-staff account is
 * told the same thing a wrong password is told — the console does not confirm
 * that the address exists and is merely under-privileged.
 *
 * This is not the authorization boundary. `RolesGuard` on the API refuses a
 * customer token on every `admin/*` route no matter what happens here.
 */
export async function loginAction(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (email === '' || password === '') {
    return {
      error: 'Enter your email address and password.',
      fieldErrors: {
        ...(email === '' ? { email: 'Required.' } : {}),
        ...(password === '' ? { password: 'Required.' } : {}),
      },
    };
  }

  const result = await tryApi(() => api.login({ email, password }));

  if (!result.ok) {
    return { error: operatorMessage(result.error), fieldErrors: {} };
  }

  const { accessToken, refreshToken, user } = result.data.data;

  if (!isStaff(user.role)) {
    /*
     * A valid session was just issued for an account that may not be here. It
     * is revoked rather than merely dropped: the tokens exist on the server,
     * and walking away leaving a live 30-day refresh token in the wild because
     * the UI declined to store it would be careless.
     */
    await tryApi(() => api.logout(refreshToken));

    return {
      error: 'Those credentials are not valid for this console.',
      fieldErrors: {},
    };
  }

  await writeSession({ accessToken, refreshToken });

  redirect('/');
}

/**
 * Ends the session.
 *
 * The refresh token is revoked SERVER-SIDE first, so the credential is dead
 * even if a copy of the cookie survives somewhere. **Clearing a cookie ends the
 * tab, not the session** — the old sign-out called `supabase.auth.signOut()` in
 * the browser and set `window.location`, which left nothing revoked on this
 * API at all because this API had never issued anything to revoke.
 *
 * A failed revocation still clears the cookies: from this browser's point of
 * view the operator is signed out either way, and leaving them signed in
 * because the API was briefly unreachable would be the wrong answer.
 */
export async function logoutAction(): Promise<void> {
  const session = await readSession();

  if (session !== null) {
    await tryApi(() => api.logout(session.refreshToken));
  }

  await clearSession();
  redirect('/login');
}
