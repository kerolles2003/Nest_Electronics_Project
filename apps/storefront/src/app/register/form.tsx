'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Lock, Mail, Phone, User, UserPlus } from 'lucide-react';
import { ROUTES } from '@nest/config/constants';
import { registerAction } from '@/actions/api-auth.actions';
import { emptyAuthState } from '@/lib/api/action-state';
import { AuthError, AuthField, AuthSubmit } from '@/components/auth/AuthField';

/**
 * Create an account, against the API.
 *
 * ## No confirm-password field
 *
 * There was one, checked by a local zod schema. It is gone, and deliberately:
 * the field exists nowhere on the wire, so the check could only ever be
 * client-side theatre next to a "show password" toggle that solves the same
 * problem better. What remains is the API's password policy, reported by the
 * API, per field.
 *
 * ## Registration does not sign you in
 *
 * The API issues NO session until the address is verified. The old form pushed
 * to `/account/orders` immediately, which bounced the customer straight back to
 * a sign-in page with no explanation (F-04). The action redirects to
 * `/login?registered=1`, which says what happened and where the link went.
 */
export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, emptyAuthState);

  return (
    <form action={formAction} className="space-y-5">
      <AuthError message={state.error} />

      <AuthField
        label="Full Name"
        name="fullName"
        icon={User}
        autoComplete="name"
        placeholder="Nadia Hassan"
        error={state.fieldErrors['fullName']}
      />

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
        autoComplete="new-password"
        placeholder="••••••••"
        error={state.fieldErrors['password']}
      />

      <AuthField
        label="Phone (optional)"
        name="phone"
        type="tel"
        icon={Phone}
        autoComplete="tel"
        required={false}
        placeholder="01012345678"
        error={state.fieldErrors['phone']}
      />

      <AuthSubmit pending={pending} idle="Create Account" busy="Creating…" icon={UserPlus} />

      <div className="pt-6 text-center">
        <p className="text-foreground-muted text-[15px] font-medium">
          Already have an account?{' '}
          <Link href={ROUTES.login} className="text-primary font-bold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </form>
  );
}
