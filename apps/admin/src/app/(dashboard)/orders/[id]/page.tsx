import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package, AlertCircle } from 'lucide-react';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { requireAdmin } from '@/lib/api/identity';
import OrderDetail from '@/components/orders/OrderDetail';

/**
 * One order, as staff see it.
 *
 * Reads `GET /admin/orders/{id}`, which returns the canonical order plus the
 * two things only an operator needs: `allowedTransitions` and `statusHistory`.
 *
 * **No `adminId` is passed down.** The old page handed `admin.user.id` to
 * `OrderDetail` so it could send it back up with every mutation. The API
 * derives the operator from the token and records it itself, so there is
 * nothing to pass and nothing for a client to forge.
 */

export const dynamic = 'force-dynamic';

export default async function OrderDetailPage(props: { params: Promise<{ id: string }> }) {
  await requireAdmin();

  const { id } = await props.params;
  const result = await tryApi(() => api.getOrder(id));

  if (!result.ok) {
    // A missing order is a 404 page. Anything else is a failure to READ, which
    // must not be rendered as an absence — "this order does not exist" and "I
    // could not ask" are different facts and only one of them is about the
    // order.
    if (result.error.kind === 'not-found') notFound();

    return (
      <div className="space-y-5">
        <BackLink />
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center"
        >
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
          <h2 className="text-base font-bold text-foreground">This order could not be loaded</h2>
          <p className="text-sm text-muted-foreground mt-1">{result.error.message}</p>
        </div>
      </div>
    );
  }

  const order = result.data.data;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackLink />
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <h1 className="text-xl font-bold tracking-tight text-foreground" data-testid="order-number">
            {order.orderNumber}
          </h1>
        </div>
      </div>

      <OrderDetail order={order} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/orders"
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to Orders
    </Link>
  );
}
