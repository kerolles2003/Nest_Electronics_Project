import Link from 'next/link';
import { ROUTES } from '@nest/config/constants';
import { AuthShell } from '@/components/auth/AuthShell';
import { ResetPasswordForm } from './form';

/**
 * Where the reset email lands.
 *
 * The API builds this URL — `${SITE_URL}/forgot-password/reset?token=…` — so
 * the path is a contract with a message already sitting in somebody's inbox,
 * not a routing preference. Moving it breaks every link that has been sent and
 * has not yet expired.
 *
 * A visit with no token is a page, not an error: someone opened the URL by hand
 * or their mail client mangled the link. It says so and offers a new one rather
 * than rendering a form that cannot succeed.
 */
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (token === undefined || token.trim() === '') {
    return (
      <AuthShell
        title="This link is incomplete"
        subtitle="It is missing the part that proves it came from us"
      >
        <p className="text-[15px] font-medium text-foreground-muted">
          Reset links expire after an hour and can only be used once. Ask for a fresh one and use
          the newest email you receive.
        </p>
        <Link
          href={ROUTES.forgotPassword}
          className="mt-2 block w-full rounded-xl bg-primary py-4 text-center text-[13px] font-bold uppercase tracking-widest text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary-hover"
        >
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Signing in again afterwards is required — every session ends"
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
