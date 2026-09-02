import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { LoginForm } from './form';

/**
 * Sign in.
 *
 * ## The redirect-away-when-signed-in check is NOT here
 *
 * It used to be: this page opened a Supabase client, asked for the user and
 * redirected. That put an authorization decision in a page, which meant every
 * auth page had its own copy and each one could get it subtly different. It
 * lives in `proxy.ts` now, once, for every route in the cluster.
 *
 * ## Two arrivals worth explaining
 *
 * `?registered=1` comes from `registerAction`, which stores no session because
 * the API issues none until the address is verified. Without a word on screen,
 * a new customer is returned to a form that will refuse them with
 * `EMAIL_NOT_VERIFIED` and nothing says why.
 *
 * `?reset=1` comes from a completed password reset. The API revokes every
 * session for the account when the password changes, so signing in again is
 * required rather than optional — saying so prevents it reading as a failure.
 */
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; registered?: string; reset?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell title="Welcome back" subtitle="Enter your credentials to access your account">
      {params.registered === '1' && (
        <div
          role="status"
          className="rounded-xl border border-primary/10 bg-primary/5 p-4 text-sm"
        >
          <p className="font-bold text-foreground">Check your email</p>
          <p className="mt-1 text-foreground-muted">
            We sent a verification link to the address you registered. Confirm it, then sign in
            below.
          </p>
          <Link href="/verify-email" className="mt-2 inline-block font-bold text-primary hover:underline">
            Didn&apos;t get it?
          </Link>
        </div>
      )}

      {params.reset === '1' && (
        <div
          role="status"
          className="rounded-xl border border-primary/10 bg-primary/5 p-4 text-sm"
        >
          <p className="font-bold text-foreground">Password changed</p>
          <p className="mt-1 text-foreground-muted">
            Every device that was signed in has been signed out. Use your new password below.
          </p>
        </div>
      )}

      <LoginForm redirectTo={params.redirect} />
    </AuthShell>
  );
}
