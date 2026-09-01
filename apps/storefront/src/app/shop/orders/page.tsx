import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { readSession } from '@/lib/api/session';
import { ApiErrorNotice } from '@/components/shop/ApiErrorNotice';

export const dynamic = 'force-dynamic';

/** The customer's own orders, newest first, straight from the API. */
export default async function OrdersPage() {
  if ((await readSession()) === null) redirect('/shop/login');

  const result = await tryApi(() => api.listOrders({ limit: 20 }));

  if (!result.ok) {
    if (result.error.kind === 'unauthenticated') redirect('/shop/login');

    return (
      <ApiErrorNotice
        title="Could not load your orders"
        message={customerMessage(result.error)}
        requestId={result.error.requestId}
      />
    );
  }

  const orders = result.data.data;

  return (
    <div>
      <h1 className="text-2xl font-black tracking-tight">Your orders</h1>

      {orders.length === 0 ? (
        <p className="mt-4 text-sm text-black/60">You have not placed an order yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-black/10">
          {orders.map((order) => (
            <li key={order.id} className="py-4">
              <Link href={`/shop/orders/${order.id}`} className="flex justify-between gap-4">
                <span>
                  <span className="font-semibold">{order.orderNumber}</span>
                  <span className="block text-xs text-black/50">
                    {new Date(order.placedAt).toLocaleDateString()} · {order.itemCount} item
                    {order.itemCount === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold">{order.pricing.grandTotal.formatted}</span>
                  <span className="block text-xs text-black/50">{order.status}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
