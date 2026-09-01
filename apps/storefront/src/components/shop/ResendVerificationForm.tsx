'use client';

import { useActionState } from 'react';
import { resendVerificationAction } from '@/actions/api-auth.actions';
import { emptyActionState } from '@/lib/api/action-state';

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
    <form action={formAction} className="mt-8 border-t border-black/10 pt-6">
      <h2 className="text-sm font-bold uppercase tracking-wide text-black/60">
        Send a new verification link
      </h2>

      <label className="mt-3 block text-sm">
        <span className="block text-black/60">Email address</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 w-full rounded border border-black/20 px-3 py-2"
        />
      </label>

      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      {state.message ? (
        <p role="status" className="mt-2 text-sm text-green-700">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded bg-black px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Send a new link'}
      </button>
    </form>
  );
}
