'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import { EMPTY_LOGIN_STATE, loginAction } from '@/actions/admin-auth.actions';

/**
 * The sign-in form.
 *
 * ## The credentials never touch client JavaScript
 *
 * This posts to a SERVER ACTION. The previous version called
 * `supabase.auth.signInWithPassword` in the browser, which meant the password
 * was handled by client code, the session was established by a library this app
 * does not control, and the resulting token was readable by any script on the
 * page.
 *
 * Here the form submits, the action calls the API server-side, and the token
 * pair goes straight into httpOnly cookies the browser cannot read. Nothing
 * about the session is available to client JavaScript, by construction.
 *
 * ## It works without JavaScript, and that is not a nicety
 *
 * A `<form action={...}>` with a server action is a real form post under
 * progressive enhancement. This is a console people sign in to at seven in the
 * morning on whatever machine is in the warehouse; a login that requires a
 * hydrated React tree is a login that fails when a chunk 404s.
 *
 * The visual design is unchanged from the Supabase version — same shell, same
 * fields, same error placement. Only what happens on submit moved.
 */
export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, EMPTY_LOGIN_STATE);

  return (
    <form action={formAction} className="space-y-4">
      {state.error !== null && (
        <div
          role="alert"
          className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium text-muted-foreground">
          Email Address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          aria-invalid={state.fieldErrors['email'] !== undefined}
          className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
          placeholder="operations@example.com"
        />
        {state.fieldErrors['email'] !== undefined && (
          <p className="text-xs text-destructive">{state.fieldErrors['email']}</p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium text-muted-foreground">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          aria-invalid={state.fieldErrors['password'] !== undefined}
          className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
          placeholder="••••••••"
        />
        {state.fieldErrors['password'] !== undefined && (
          <p className="text-xs text-destructive">{state.fieldErrors['password']}</p>
        )}
      </div>

      <SubmitButton />
    </form>
  );
}

/**
 * Split out because `useFormStatus` reports the status of the form it is
 * rendered INSIDE — reading it in the component that owns the `<form>` returns
 * `pending: false` forever, which is a silent bug that looks like a slow server.
 */
function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full bg-primary hover:bg-primary-hover disabled:bg-primary/50 text-primary-foreground font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-2"
    >
      {pending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
      {pending ? 'Signing in…' : 'Sign In'}
    </button>
  );
}
