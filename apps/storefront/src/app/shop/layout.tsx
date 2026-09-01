import Link from 'next/link';
import { readSession } from '@/lib/api/session';
import { logoutAction } from '@/actions/api-auth.actions';

/**
 * The API-backed storefront.
 *
 * Everything under `/shop` talks to the NestJS API and nothing else. It runs
 * ALONGSIDE the existing Supabase-backed pages rather than replacing them, so
 * the working store keeps working while this slice proves the journey
 * end-to-end. Each legacy page migrates here once its API equivalent is
 * verified.
 *
 * There is exactly one authority per domain in here:
 * identity, catalogue, cart, addresses, pricing, checkout and orders are all
 * the API's. This app owns presentation, interaction and navigation.
 */
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  const signedIn = session !== null;

  return (
    <div className="min-h-screen bg-[var(--color-background,#fff)]">
      <header className="border-b border-black/10">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-4 text-sm">
          <Link href="/shop" className="font-black tracking-tight">
            Nest Electronics
          </Link>
          <Link href="/shop" className="hover:underline">
            Products
          </Link>
          <Link href="/shop/cart" className="hover:underline">
            Cart
          </Link>
          <Link href="/shop/addresses" className="hover:underline">
            Addresses
          </Link>
          <Link href="/shop/orders" className="hover:underline">
            Orders
          </Link>

          <div className="ml-auto flex items-center gap-4">
            {signedIn ? (
              <form action={logoutAction}>
                <button type="submit" className="hover:underline">
                  Sign out
                </button>
              </form>
            ) : (
              <>
                <Link href="/shop/login" className="hover:underline">
                  Sign in
                </Link>
                <Link href="/shop/register" className="font-semibold hover:underline">
                  Create account
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
