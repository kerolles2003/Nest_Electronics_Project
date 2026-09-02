'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Lock, LogIn, Mail } from 'lucide-react';
import { ROUTES } from '@nest/config/constants';
import { loginAction } from '@/actions/api-auth.actions';
import { emptyAuthState } from '@/lib/api/action-state';
import { AuthError, AuthField, AuthSubmit } from '@/components/auth/AuthField';

/**
 * Sign in, against the API.
 *
 * ## What this form no longer does
 *
 * It no longer opens a Supabase client in the browser, no longer validates the
 * credentials against a local zod schema, and no longer merges the cart itself.
 * Each of those was a second implementation of something the server owns.
 *
 * The cart merge in particular: this form used to read a client cart store —
 * which held **prices** — and post them to a server action that trusted them.
 * The basket now holds `{productId, quantity}` and merges after sign-in through
 * `GuestCartMerge`, which is mounted for every signed-in page. So there is
 * nothing to do here beyond signing in, and no `try/catch` around a cart call
 * that could strand the form.
 *
 * ## No Google button
 *
 * Removed under D-3: OAuth is not required at launch. The old button called
 * `signInWithOAuth` with a redirect to `/auth/callback`, a route that was
 * PKCE-only and orphaned — it could not have completed a sign-in if anyone had
 * pressed it. An API OAuth flow is recorded as post-launch work.
 */
export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, emptyAuthState);

  return (
    <form action={formAction} className="space-y-5">
      {/*
        * Where to go afterwards, carried through the submission.
        *
        * The action treats it as untrusted and refuses anything that is not a
        * path on this site — `?redirect=` arrives in a link anybody can send,
        * and an unchecked value here is an open redirect reached through a
        * genuine sign-in on a correctly-spelled link.
        */}
      <input type="hidden" name="redirectTo" value={redirectTo ?? ''} />

      <AuthError message={state.error} />

      <AuthField
        label="Email Address"
        name="email"
        type="email"
        icon={Mail}
        autoComplete="email"
        placeholder="name@company.com"
        error={state.fieldErrors['email']}
      />

      <AuthField
        label="Password"
        name="password"
        type="password"
        icon={Lock}
        autoComplete="current-password"
        placeholder="••••••••"
        error={state.fieldErrors['password']}
        hint={
          <Link
            href={ROUTES.forgotPassword}
            className="text-[12px] font-bold text-primary hover:underline"
          >
            Forgot?
          </Link>
        }
      />

      <AuthSubmit pending={pending} idle="Sign In" busy="Authenticating…" icon={LogIn} />

      <div className="pt-6 text-center">
        <p className="text-foreground-muted text-[15px] font-medium">
          New to Nest?{' '}
          <Link href={ROUTES.register} className="text-primary font-bold hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </form>
  );
}
