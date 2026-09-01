import Link from 'next/link';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { ResendVerificationForm } from '@/components/shop/ResendVerificationForm';

/**
 * The destination of the link in the verification email.
 *
 * Without this page the whole verification flow is theatre: the API mints a
 * token, the email carries it, and it lands on a 404. The address in the mail
 * is `${SITE_URL}/shop/verify-email?token=…`, so this route IS that contract.
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
 * Next.js itself from prefetching it, and the recovery path is the resend form
 * below, which is shown on every failure precisely because "expired", "already
 * used" and "scanned by a filter" are indistinguishable from here — and the
 * API reports them identically by design.
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
    <div className="mx-auto max-w-md py-6">
      <h1 className="text-2xl font-black tracking-tight">{heading}</h1>
      <p
        role={tone === 'error' ? 'alert' : undefined}
        className={`mt-3 text-sm ${tone === 'error' ? 'text-red-700' : 'text-black/70'}`}
      >
        {body}
      </p>

      {tone === 'success' ? (
        <Link
          href="/shop/login"
          className="mt-6 inline-block rounded bg-black px-5 py-2.5 text-sm font-semibold text-white"
        >
          Sign in
        </Link>
      ) : null}

      {showResend ? <ResendVerificationForm /> : null}
    </div>
  );
}
