import Link from 'next/link';
import { AuthForm } from '@/components/shop/AuthForm';

/**
 * Sign in.
 *
 * `?registered=1` arrives from `registerAction`, which redirects here instead
 * of storing a session — the API issues none until the address is verified.
 * Rendering that flag matters: without it a new customer is silently returned
 * to a sign-in form that will refuse them with `EMAIL_NOT_VERIFIED`, and
 * nothing on screen explains why or points at the email that would fix it.
 */
export const dynamic = 'force-dynamic';

export default async function ShopLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string }>;
}) {
  const { registered } = await searchParams;

  return (
    <div>
      {registered === '1' ? (
        <div
          role="status"
          className="mx-auto mb-6 max-w-sm rounded-lg border border-black/10 bg-black/[0.03] p-4 text-sm"
        >
          <p className="font-semibold">Check your email</p>
          <p className="mt-1 text-black/70">
            We sent a verification link to the address you registered. Confirm it, then sign in
            below.
          </p>
          <Link href="/shop/verify-email" className="mt-2 inline-block underline">
            Didn&apos;t get it?
          </Link>
        </div>
      ) : null}

      <AuthForm mode="login" />
    </div>
  );
}
