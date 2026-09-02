import Link from 'next/link';
import { ROUTES } from '@nest/config/constants';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { AuthShell } from '@/components/auth/AuthShell';
import { ResendVerificationForm } from '@/components/auth/ResendVerificationForm';

/**
 * The destination of the link in the verification email.
 *
 * Without this page the whole verification flow is theatre: the API mints a
 * token, the email carries it, and it lands on a 404. The address in the mail
 * is `${SITE_URL}/verify-email?token=…`, so this route IS that contract.
 *
 * It used to be `/shop/verify-email`. The API now builds the canonical address,
 * because these links sit in inboxes for as long as the token lives and a link
 * that only works via a redirect breaks the day the redirect is tidied away.
 *
 * The token is consumed SERVER-SIDE, on render. That is deliberate:
 *
 *   - the token never reaches client JavaScript, where an extension or a
 *     third-party script could read it out of the page;
 *   - the customer sees a finished answer rather than a spinner that resolves
 *     into one.
 *
 * The cost is that a prefetch or a link-scanner following the URL consumes the
 * token — real behaviour in corporate mail filters. `force-dynamic` keeps
 * Next.js itself from prefetching it, and the recovery path is the resend form,
 * shown on every failure precisely because "expired", "already used" and
 * "scanned by a filter" are indistinguishable from here — and the API reports
 * them identically by design.
 */
export const dynamic = 'force-dynamic';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (token === undefined || token.trim().length === 0) {
    return (
      <Outcome
        heading="This link is incomplete"
        tone="error"
        body="The address is missing its verification token. Copy the whole link from the email, or request a new one below."
        showResend
      />
    );
  }

  const result = await tryApi(() => api.verifyEmail(token));

  if (!result.ok) {
    return (
      <Outcome
        heading="We could not verify this link"
        tone="error"
        body={customerMessage(result.error)}
        showResend
      />
    );
  }

  return (
    <Outcome
      heading="Your email address is verified"
      tone="success"
      body={result.data.data.message}
    />
  );
}

function Outcome({
  heading,
  body,
  tone,
  showResend = false,
}: {
  heading: string;
  body: string;
  tone: 'success' | 'error';
  showResend?: boolean;
}) {
  return (
    <AuthShell title={heading} subtitle={tone === 'success' ? 'You can sign in now' : 'Here is how to fix it'}>
      <p
        role={tone === 'error' ? 'alert' : 'status'}
        className={`text-[15px] font-medium ${tone === 'error' ? 'text-danger' : 'text-foreground-muted'}`}
      >
        {body}
      </p>

      {tone === 'success' && (
        <Link
          href={ROUTES.login}
          className="mt-2 block w-full rounded-xl bg-primary py-4 text-center text-[13px] font-bold uppercase tracking-widest text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary-hover"
        >
          Sign in
        </Link>
      )}

      {showResend && <ResendVerificationForm />}
    </AuthShell>
  );
}
