'use client';

import { useActionState } from 'react';
import { Mail, Send } from 'lucide-react';
import { resendVerificationAction } from '@/actions/api-auth.actions';
import { emptyActionState } from '@/lib/api/action-state';
import { AuthError, AuthField, AuthNotice, AuthSubmit } from '@/components/auth/AuthField';

/**
 * Requests a fresh verification email.
 *
 * The response is deliberately the SAME whether or not the address exists, is
 * already verified, or was never registered — the API answers 200 in every
 * case, because a distinguishable answer here would be an account-existence
 * oracle that needs no password. This component must therefore not try to be
 * more helpful than the server: "if that address needs verification, a new
 * email is on its way" is the honest and the safe message at once.
 */
export function ResendVerificationForm() {
  const [state, formAction, pending] = useActionState(resendVerificationAction, emptyActionState);

  return (
    <form action={formAction} className="space-y-4 border-t border-border pt-6">
      <h2 className="text-[13px] font-bold uppercase tracking-wider text-foreground-muted">
        Send a new verification link
      </h2>

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

      <AuthSubmit pending={pending} idle="Send a New Link" busy="Sending…" icon={Send} />
    </form>
  );
}
