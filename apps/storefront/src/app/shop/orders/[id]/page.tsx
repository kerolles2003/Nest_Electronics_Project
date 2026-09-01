import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { readSession } from '@/lib/api/session';
import { ApiErrorNotice } from '@/components/shop/ApiErrorNotice';

export const dynamic = 'force-dynamic';

/**
 * One order — and, right after placement, the confirmation screen.
 *
 * ## The address shown here is a SNAPSHOT
 *
 * `order.shippingAddress` was copied onto the order when it was placed. It is
 * NOT a reference into the customer's address book, and this page deliberately
 * never reads the address book to render it: editing or deleting the saved
 * address afterwards must not change one character of where these goods were
 * sent. Reconstructing it from the current address book is precisely the bug
 * the snapshot exists to prevent.
 *
 * ## `?placed=1`
 *
 * Marks the arrival from checkout so the confirmation is shown once. It is a
 * display hint only — the ORDER is what proves placement succeeded, and the
 * page renders identically without it.
 */
export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ placed?: string }>;
}) {
  if ((await readSession()) === null) redirect('/shop/login');

  const [{ id }, { placed }] = await Promise.all([params, searchParams]);
  const result = await tryApi(() => api.getOrder(id));

  if (!result.ok) {
    if (result.error.kind === 'unauthenticated') redirect('/shop/login');
    // A foreign order and one that does not exist answer identically, by
    // design — so both are simply "not found" here.
    if (result.error.kind === 'not_found') notFound();

    return (
      <ApiErrorNotice
        title="Could not load this order"
        message={customerMessage(result.error)}
        requestId={result.error.requestId}
      />
    );
  }

  const order = result.data.data;
  const address = order.shippingAddress;

  return (
    <article>
      {placed === '1' ? (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4">
          <h1 className="text-lg font-black text-green-900">Order placed</h1>
          <p className="mt-1 text-sm text-green-800">
            Your order number is <strong>{order.orderNumber}</strong>. Pay
            {' '}{order.pricing.grandTotal.formatted} in cash when it arrives.
          </p>
        </div>
      ) : null}

      <Link href="/shop/orders" className="text-sm hover:underline">
        &larr; All orders
      </Link>

      <h2 className="mt-4 text-2xl font-black tracking-tight">{order.orderNumber}</h2>
      <p className="mt-1 text-sm text-black/50">
        Placed {new Date(order.placedAt).toLocaleString()} · {order.status}
      </p>

      <section className="mt-8">
        <h3 className="text-sm font-bold uppercase tracking-wide text-black/60">Items</h3>
        <ul className="mt-2 divide-y divide-black/10 text-sm">
          {order.items.map((item) => (
            <li key={item.sku} className="flex justify-between py-2">
              <span>
                {item.name}
                <span className="text-black/50"> × {item.quantity}</span>
                <span className="block text-xs text-black/40">{item.sku}</span>
              </span>
              <span>{item.lineTotal.formatted}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between text-black/70">
            <dt>Subtotal</dt>
            <dd>{order.pricing.itemsSubtotal.formatted}</dd>
          </div>
          <div className="flex justify-between text-black/70">
            <dt>Delivery</dt>
            <dd>{order.pricing.shippingFee.formatted}</dd>
          </div>
          <div className="flex justify-between border-t border-black/10 pt-2 text-base font-black">
            <dt>Total</dt>
            <dd>{order.pricing.grandTotal.formatted}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-8">
        <h3 className="text-sm font-bold uppercase tracking-wide text-black/60">Delivered to</h3>
        <address className="mt-2 not-italic text-sm text-black/70">
          {address.fullName}
          <br />
          {address.phone}
          <br />
          {address.street}
          <br />
          {address.city}, {address.governorate}
          {address.postalCode ? ` ${address.postalCode}` : ''}
        </address>
        <p className="mt-2 text-xs text-black/40">
          This is the address as it was when the order was placed.
        </p>
      </section>

      <section className="mt-8">
        <h3 className="text-sm font-bold uppercase tracking-wide text-black/60">Payment</h3>
        <p className="mt-2 text-sm text-black/70">
          {order.payment.method} · {order.payment.status}
        </p>
      </section>
    </article>
  );
}
