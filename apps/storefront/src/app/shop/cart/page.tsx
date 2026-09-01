import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { readSession } from '@/lib/api/session';
import { ApiErrorNotice } from '@/components/shop/ApiErrorNotice';
import { CartLineControls } from '@/components/shop/CartLineControls';

export const dynamic = 'force-dynamic';

/**
 * The cart, read from the API on every request.
 *
 * The API is the persistence authority: quantities are clamped to live stock,
 * prices are re-read from the catalogue and each line carries a STATUS decided
 * server-side. This page renders that verdict; it does not compute a subtotal,
 * does not decide whether a line is buyable, and keeps no local copy.
 *
 * `effectiveQuantity` — not `quantity` — is what will actually be ordered on a
 * REDUCED_STOCK line, which is why it is shown when the two differ.
 */
export default async function CartPage() {
  if ((await readSession()) === null) redirect('/shop/login');

  const result = await tryApi(() => api.getCart());

  if (!result.ok) {
    if (result.error.kind === 'unauthenticated') redirect('/shop/login');
    return <ApiErrorNotice title="Could not load your cart" message={customerMessage(result.error)} requestId={result.error.requestId} />;
  }

  const cart = result.data.data;

  if (cart.items.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-black tracking-tight">Your cart</h1>
        <p className="mt-4 text-sm text-black/60">Your cart is empty.</p>
        <Link href="/shop" className="mt-4 inline-block text-sm underline">
          Browse products
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-black tracking-tight">Your cart</h1>

      <ul className="mt-6 divide-y divide-black/10">
        {cart.items.map((line) => (
          <li key={line.productId} className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Link href={`/shop/${line.slug}`} className="font-semibold hover:underline">
                  {line.name}
                </Link>
                <p className="text-xs text-black/50">{line.sku}</p>

                {line.status !== 'OK' ? (
                  <p className="mt-1 text-xs font-medium text-amber-700">
                    {line.status === 'PRICE_CHANGED'
                      ? `Price changed — now ${line.unitPrice.formatted}`
                      : line.status === 'REDUCED_STOCK'
                        ? `Only ${line.availableQuantity} left — ${line.effectiveQuantity} will be ordered`
                        : line.status === 'OUT_OF_STOCK'
                          ? 'Out of stock — remove it to continue'
                          : 'No longer available — remove it to continue'}
                  </p>
                ) : null}
              </div>

              <div className="text-right">
                <p className="font-semibold">{line.lineTotal.formatted}</p>
                <p className="text-xs text-black/50">{line.unitPrice.formatted} each</p>
              </div>
            </div>

            <CartLineControls productId={line.productId} quantity={line.quantity} />
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center justify-between border-t border-black/10 pt-4">
        <span className="text-sm text-black/60">
          {cart.itemCount} item{cart.itemCount === 1 ? '' : 's'} · {cart.totalQuantity} unit
          {cart.totalQuantity === 1 ? '' : 's'}
        </span>
        <span className="text-lg font-black">{cart.itemsSubtotal.formatted}</span>
      </div>

      <p className="mt-1 text-right text-xs text-black/50">
        Delivery is calculated at checkout, once you choose an address.
      </p>

      {cart.hasBlockingIssues ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          Resolve the flagged lines above before checking out.
        </p>
      ) : (
        <Link
          href="/shop/checkout"
          className="mt-6 inline-block rounded bg-black px-6 py-2.5 text-sm font-semibold text-white"
        >
          Checkout
        </Link>
      )}
    </div>
  );
}
