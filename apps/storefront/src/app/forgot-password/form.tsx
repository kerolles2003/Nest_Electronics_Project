'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Mail, Send } from 'lucide-react';
import { ROUTES } from '@nest/config/constants';
import { forgotPasswordAction } from '@/actions/api-auth.actions';
import { emptyActionState } from '@/lib/api/action-state';
import { AuthError, AuthField, AuthNotice, AuthSubmit } from '@/components/auth/AuthField';

/**
 * Ask for a reset link.
 *
 * ## The answer is the same either way, on purpose
 *
 * The API replies identically whether or not the address has an account, and
 * so does this form. There is no "we couldn't find that account" branch to
 * write here, and no way to write one — the success path never learns which
 * case it was. Telling a visitor that an address is unknown is a password-free
 * way to find out who shops here.
 *
 * The old form sent the reset through Supabase, to a `/auth/callback` route
 * that was PKCE-only and orphaned, so the link it produced could not complete a
 * reset. The API mails a link to `/forgot-password/reset`, which exists.
 */
export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, emptyActionState);

  return (
    <form action={formAction} className="space-y-5">
      <AuthError message={state.error} />
      <AuthNotice message={state.message} />

      <AuthField
        label="Email Address"
        name="email"
        type="email"
        icon={Mail}
        autoComplete="email"
        placeholder="name@company.com"
        error={state.fieldErrors['email']}
      />

      <AuthSubmit pending={pending} idle="Send Reset Link" busy="Sending…" icon={Send} />

      <div className="pt-6 text-center">
        <p className="text-foreground-muted text-[15px] font-medium">
          Remembered it?{' '}
          <Link href={ROUTES.login} className="text-primary font-bold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </form>
  );
}
