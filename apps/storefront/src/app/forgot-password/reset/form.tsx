'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { KeyRound, Lock } from 'lucide-react';
import { ROUTES } from '@nest/config/constants';
import { resetPasswordAction } from '@/actions/api-auth.actions';
import { emptyActionState } from '@/lib/api/action-state';
import { AuthError, AuthField, AuthSubmit } from '@/components/auth/AuthField';

/**
 * Set a new password with the token from the email.
 *
 * ## The token is a hidden field, not a value this form reads from the URL
 *
 * It arrives in the page's query string and is passed in as a prop, so the
 * component that submits it never has to touch `window.location`. The API
 * hashes it at rest, consumes it once and expires it after an hour; an unknown,
 * expired and already-used token are all one answer, and this form does not try
 * to tell them apart.
 *
 * ## Confirm-password IS checked here, unlike on registration
 *
 * The difference is that this one has something to compare against locally and
 * nothing on the wire: the API takes a single `password`, and a customer who
 * mistypes a password they cannot see is locked out of an account they were in
 * the middle of recovering. The password POLICY is still entirely the server's.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, emptyActionState);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />

      <AuthError message={state.error} />

      <AuthField
        label="New Password"
        name="password"
        type="password"
        icon={Lock}
        autoComplete="new-password"
        placeholder="••••••••"
        error={state.fieldErrors['password']}
      />

      <AuthField
        label="Confirm New Password"
        name="confirmPassword"
        type="password"
        icon={Lock}
        autoComplete="new-password"
        placeholder="••••••••"
        error={state.fieldErrors['confirmPassword']}
      />

      <AuthSubmit pending={pending} idle="Set New Password" busy="Saving…" icon={KeyRound} />

      <div className="pt-6 text-center">
        <p className="text-foreground-muted text-[15px] font-medium">
          Link expired?{' '}
          <Link href={ROUTES.forgotPassword} className="text-primary font-bold hover:underline">
            Request another
          </Link>
        </p>
      </div>
    </form>
  );
}
