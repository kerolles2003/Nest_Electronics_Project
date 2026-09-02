import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { StatusBadge } from '@nest/ui';
import { ROUTES } from '@nest/config/constants';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { readSession } from '@/lib/api/session';
import { CancelOrderForm } from '@/components/account/CancelOrderForm';
import type { Order } from '@/lib/api/types';

/**
 * One order — and, right after placement, the confirmation screen.
 *
 * ## The address shown here is a SNAPSHOT
 *
 * `order.shippingAddress` was copied onto the order when it was placed. It is
 * NOT a reference into the customer's address book, and this page deliberately
 * never reads the address book to render it: editing or deleting the saved
 * address afterwards must not change one character of where these goods were
 * sent.
 *
 * ## Delivery reads `shippingPriced`, not the fee
 *
 * An order whose delivery was never priced carries `shippingFee: 0`, and
 * printing that unconditionally tells the customer their delivery was free. The
 * order carries its own answer in the persisted snapshot, so this reports what
 * was true when it was placed rather than what the configuration says today.
 *
 * ## `?placed=1`
 *
 * Marks the arrival from checkout so the confirmation is shown once. It is a
 * display hint only — the ORDER is what proves placement succeeded, and the
 * page renders identically without it.
 */
export const dynamic = 'force-dynamic';

/**
 * The statuses the API will still cancel.
 *
 * Restated from the endpoint's own documentation, and **not trusted**: the page
 * decides whether to draw the button, the API decides whether to honour it, and
 * a status that went stale between the two produces a `409` the form shows.
 */
const CANCELLABLE = new Set(['PLACED', 'CONFIRMED']);

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ placed?: string }>;
}) {
  const [{ id }, { placed }] = await Promise.all([params, searchParams]);

  if ((await readSession()) === null) {
    redirect(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.account.order(id))}`);
  }

  const result = await tryApi(() => api.getOrder(id));

  if (!result.ok) {
    if (result.error.kind === 'unauthenticated') {
      redirect(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.account.order(id))}`);
    }
    // A foreign order and one that does not exist answer identically, by
    // design — so both are simply "not found" here.
    if (result.error.kind === 'not_found') notFound();

    return (
      <div className="min-h-[300px] space-y-4">
        <h2 className="text-2xl font-black uppercase tracking-tight">
          Could not load this order
        </h2>
        <p role="alert" className="font-medium text-danger">
          {customerMessage(result.error)}
        </p>
        <Link href={ROUTES.account.orders} className="inline-block font-bold text-primary hover:underline">
          Back to your orders
        </Link>
      </div>
    );
  }

  const order = result.data.data;

  return (
    <article className="space-y-8 animate-in fade-in duration-500">
      {placed === '1' && <PlacedBanner order={order} />}

      <Link
        href={ROUTES.account.orders}
        className="inline-flex items-center gap-2 text-[12px] font-black uppercase tracking-widest text-foreground-muted hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        All orders
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-border)] pb-6">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tight" data-testid="order-number">
            {order.orderNumber}
          </h2>
          <p className="mt-2 text-[13px] font-medium text-foreground-muted">
            Placed {new Date(order.placedAt).toLocaleString()}
          </p>
        </div>
        <StatusBadge
          status={order.status}
          className="text-[11px] px-3 py-1 font-black uppercase tracking-widest"
        />
      </header>

      <section>
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground-muted">
          Items
        </h3>
        <ul className="mt-3 divide-y divide-[var(--color-border)] text-sm">
          {order.items.map((item) => (
            <li key={item.sku} className="flex justify-between gap-4 py-3">
              <span>
                <span className="font-bold text-foreground">{item.name}</span>
                <span className="text-foreground-muted"> × {item.quantity}</span>
                <span className="block text-xs text-foreground-muted">{item.sku}</span>
              </span>
              <span className="font-bold">{item.lineTotal.formatted}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-5 space-y-2 text-sm">
          <div className="flex justify-between text-foreground-muted">
            <dt>Subtotal</dt>
            <dd>{order.pricing.itemsSubtotal.formatted}</dd>
          </div>
          <div className="flex justify-between text-foreground-muted">
            <dt>Delivery</dt>
            <dd data-testid="order-delivery">
              {order.pricing.shippingPriced
                ? order.pricing.shippingFee.amount === 0
                  ? 'Free'
                  : order.pricing.shippingFee.formatted
                : 'Not yet calculated'}
            </dd>
          </div>
          <div className="flex justify-between border-t border-[var(--color-border)] pt-3 text-base font-black">
            <dt>Total</dt>
            <dd data-testid="order-total">{order.pricing.grandTotal.formatted}</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-8 sm:grid-cols-2">
        <div>
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground-muted">
            Delivered to
          </h3>
          <address className="mt-3 text-sm not-italic text-foreground-muted">
            {order.shippingAddress.fullName}
            <br />
            {order.shippingAddress.phone}
            <br />
            {order.shippingAddress.street}
            <br />
            {order.shippingAddress.city}, {order.shippingAddress.governorate}
            {order.shippingAddress.postalCode === null
              ? ''
              : ` ${order.shippingAddress.postalCode}`}
          </address>
          <p className="mt-2 text-xs text-foreground-muted">
            This is the address as it was when the order was placed.
          </p>
        </div>

        <div>
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground-muted">
            Payment
          </h3>
          <p className="mt-3 text-sm text-foreground-muted">
            {order.payment.method} · {order.payment.status}
          </p>
        </div>
      </section>

      {order.cancellation !== null ? (
        <section className="rounded-sm border border-[var(--color-border)] bg-surface/40 p-5">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground-muted">
            Cancelled
          </h3>
          <p className="mt-2 text-sm text-foreground-muted">
            {new Date(order.cancellation.cancelledAt).toLocaleString()}
            {order.cancellation.reason === null ? '' : ` — ${order.cancellation.reason}`}
          </p>
        </section>
      ) : CANCELLABLE.has(order.status) ? (
        <section className="border-t border-[var(--color-border)] pt-6">
          <CancelOrderForm orderId={order.id} />
        </section>
      ) : null}
    </article>
  );
}

function PlacedBanner({ order }: { order: Order }) {
  return (
    <div className="flex gap-4 rounded-sm border border-primary/20 bg-primary/5 p-5">
      <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
      <div>
        <h1 className="text-lg font-black uppercase tracking-tight text-foreground">
          Order placed
        </h1>
        <p className="mt-1 text-sm font-medium text-foreground-muted">
          Your order number is <strong className="text-foreground">{order.orderNumber}</strong>.
          Pay {order.pricing.grandTotal.formatted} in cash when it arrives.
        </p>
      </div>
    </div>
  );
}
