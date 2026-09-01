'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { loginAction, registerAction } from '@/actions/api-auth.actions';
import { emptyAuthState } from '@/lib/api/action-state';

/**
 * Sign in / create account, both against the API.
 *
 * Field-level messages come from the API's `error.details`, which names the
 * offending field — so the password policy, the email format and the phone
 * format are all reported by the authority that enforces them. This form
 * deliberately re-implements none of those rules: a second copy would drift
 * from the server's and reject input the server accepts.
 */
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const isRegister = mode === 'register';
  const [state, formAction, pending] = useActionState(
    isRegister ? registerAction : loginAction,
    emptyAuthState,
  );

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-black tracking-tight">
        {isRegister ? 'Create your account' : 'Sign in'}
      </h1>

      <form action={formAction} className="mt-6 space-y-4">
        {isRegister ? (
          <Field
            label="Full name"
            name="fullName"
            autoComplete="name"
            error={state.fieldErrors['fullName']}
          />
        ) : null}

        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          error={state.fieldErrors['email']}
        />

        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          error={state.fieldErrors['password']}
        />

        {isRegister ? (
          <Field
            label="Phone (optional)"
            name="phone"
            autoComplete="tel"
            error={state.fieldErrors['phone']}
          />
        ) : null}

        {state.error ? (
          <p role="alert" className="text-sm text-red-700">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="mt-4 text-sm text-black/60">
        {isRegister ? (
          <>
            Already have an account?{' '}
            <Link href="/shop/login" className="underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{' '}
            <Link href="/shop/register" className="underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  error?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-black/60">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        className="mt-1 w-full rounded border border-black/20 px-3 py-2"
      />
      {error ? <span className="mt-1 block text-xs text-red-700">{error}</span> : null}
    </label>
  );
}
