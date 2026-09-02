import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, ArrowRight, Package, PackageSearch, ShoppingBag } from 'lucide-react';
import { StatusBadge } from '@nest/ui';
import { ROUTES } from '@nest/config/constants';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { readSession } from '@/lib/api/session';
import type { OrderSummary } from '@/lib/api/types';

/**
 * Order history, from the API.
 *
 * ## Every figure is the server's, including the money
 *
 * The old page read `orders` out of Supabase and printed
 * `EGP {order.total.toLocaleString()}` — a float, formatted in the browser's
 * locale, from a column the storefront could also write. `pricing.grandTotal`
 * arrives as integer minor units WITH the string to show, so the number on this
 * card is the number the customer was charged, formatted once, by the system
 * that charged it.
 *
 * ## Statuses are not translated here
 *
 * There was a `statusLabels` map turning `pending_payment` into "Pending
 * Payment". The API's statuses are its own vocabulary and it is the authority
 * on which ones exist; a local map silently renders an unknown one as a raw
 * token, and grows stale the moment a status is added. `StatusBadge` gets the
 * value; the display casing is a presentation concern it already handles.
 */
export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  // Belt and braces with the proxy: this is a server component, so an expired
  // session must not be allowed to render an empty history as though the
  // customer had never ordered.
  if ((await readSession()) === null) redirect(`${ROUTES.login}?redirect=${ROUTES.account.orders}`);

  const result = await tryApi(() => api.listOrders({ limit: 20 }));

  if (!result.ok) {
    if (result.error.kind === 'unauthenticated') {
      redirect(`${ROUTES.login}?redirect=${ROUTES.account.orders}`);
    }

    return (
      <EmptyState
        icon={AlertTriangle}
        tone="danger"
        heading="Something went wrong"
        body={customerMessage(result.error)}
        cta={{ href: ROUTES.account.orders, label: 'Try Again' }}
      />
    );
  }

  const orders = result.data.data;

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBag}
        watermark={PackageSearch}
        heading="No Orders Yet"
        body="It looks like you haven't placed any orders yet. Start exploring our latest products!"
        cta={{ href: ROUTES.products, label: 'Start Shopping' }}
      />
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[var(--color-border)] pb-6">
        <div>
          <h2 className="text-3xl font-black text-foreground uppercase tracking-tight">
            Order History
          </h2>
          <p className="text-[13px] text-foreground-muted mt-2 font-medium">
            Showing your{' '}
            <span className="text-foreground font-bold">{orders.length}</span> most recent orders
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-primary/40">
          <Package className="w-4 h-4" />
          Nest Secured Management
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {orders.map((order) => (
          <OrderRow key={order.id} order={order} />
        ))}
      </div>
    </div>
  );
}

function OrderRow({ order }: { order: OrderSummary }) {
  const placed = new Date(order.placedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Link
      href={ROUTES.account.order(order.id)}
      data-testid="order-row"
      className="group relative bg-white border border-[var(--color-border)] rounded-sm p-6 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5 transition-all"
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-6">
        <div className="lg:w-1/4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-black text-primary uppercase tracking-widest bg-primary/10 px-1.5 py-0.5 rounded-full">
              Order
            </span>
            <p className="text-[15px] font-black text-foreground leading-none">
              {order.orderNumber}
            </p>
          </div>
          <p className="text-xs text-foreground-muted font-bold uppercase tracking-wider mt-2">
            {placed}
          </p>
        </div>

        <div className="flex-1 flex flex-wrap items-center gap-x-12 gap-y-4">
          <div className="min-w-[120px]">
            <p className="text-[10px] font-black text-foreground-muted uppercase tracking-[0.2em] mb-2">
              Status
            </p>
            <StatusBadge
              status={order.status}
              className="text-[11px] px-3 py-1 font-black uppercase tracking-widest"
            />
          </div>
          <div>
            <p className="text-[10px] font-black text-foreground-muted uppercase tracking-[0.2em] mb-2">
              Items
            </p>
            <p className="text-sm font-black text-foreground">
              {order.itemCount} {order.itemCount === 1 ? 'Product' : 'Products'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-black text-foreground-muted uppercase tracking-[0.2em] mb-2">
              Total Amount
            </p>
            <p className="text-[16px] font-black text-primary">
              {order.pricing.grandTotal.formatted}
            </p>
          </div>
        </div>

        <div className="lg:w-auto flex items-center justify-end lg:pl-6">
          <div className="w-10 h-10 rounded-full bg-[var(--color-surface)] flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-all">
            <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
          </div>
        </div>
      </div>
    </Link>
  );
}

function EmptyState({
  icon: Icon,
  watermark: Watermark,
  heading,
  body,
  cta,
  tone = 'primary',
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  watermark?: React.ComponentType<{ className?: string }>;
  heading: string;
  body: string;
  cta: { href: string; label: string };
  tone?: 'primary' | 'danger';
}) {
  return (
    <div className="min-h-[400px] flex flex-col items-center justify-center text-center p-8 bg-white border border-[var(--color-border)] rounded-sm shadow-sm relative overflow-hidden">
      {Watermark !== undefined && (
        <div className="absolute top-0 right-0 p-12 opacity-[0.02] pointer-events-none">
          <Watermark className="w-64 h-64" />
        </div>
      )}
      <div
        className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 relative z-10 ${
          tone === 'danger' ? 'bg-red-50' : 'bg-primary/5'
        }`}
      >
        <Icon
          className={`w-12 h-12 ${tone === 'danger' ? 'text-red-400' : 'text-primary/40'}`}
          strokeWidth={1.5}
        />
      </div>
      <h2 className="text-2xl font-black text-foreground uppercase tracking-tight mb-2 relative z-10">
        {heading}
      </h2>
      <p className="text-foreground-muted max-w-xs font-medium mb-8 relative z-10">{body}</p>
      <Link
        href={cta.href}
        className="bg-primary text-white px-10 py-4 rounded-sm font-black uppercase tracking-widest text-[13px] hover:bg-primary-hover transition-all shadow-xl shadow-primary/20 relative z-10 hover:-translate-y-0.5 active:translate-y-0"
      >
        {cta.label}
      </Link>
    </div>
  );
}
