import { redirect } from 'next/navigation';
import { ROUTES } from '@nest/config/constants';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { readSession } from '@/lib/api/session';
import { ProfileForm } from './form';

/**
 * The customer's own details.
 *
 * Two fields exist on the wire — name and phone — and only those two are
 * offered. Email is shown read-only because changing it is a re-verification
 * flow rather than a field edit, and the API has no route for it; an input that
 * cannot succeed is worse than no input.
 *
 * The old page read and wrote a Supabase `profiles` row directly from the
 * browser, which meant the storefront could write columns the API considers
 * its own.
 */
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  if ((await readSession()) === null) {
    redirect(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.account.profile)}`);
  }

  const result = await tryApi(() => api.currentUser());

  if (!result.ok) {
    if (result.error.kind === 'unauthenticated') {
      redirect(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.account.profile)}`);
    }

    return (
      <div className="min-h-[300px] space-y-3">
        <h2 className="text-2xl font-black uppercase tracking-tight">
          Could not load your profile
        </h2>
        <p role="alert" className="font-medium text-danger">
          {customerMessage(result.error)}
        </p>
      </div>
    );
  }

  const user = result.data.data;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="border-b border-[var(--color-border)] pb-6">
        <h2 className="text-3xl font-black uppercase tracking-tight text-foreground">
          Your Details
        </h2>
        <p className="mt-2 text-[13px] font-medium text-foreground-muted">
          Used on every order you place and every delivery we make.
        </p>
      </div>

      <ProfileForm
        fullName={user.fullName}
        phone={user.phone}
        email={user.email}
        emailVerified={user.emailVerified}
      />
    </div>
  );
}
