'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Pagination, StatusBadge } from '@nest/ui';
import Link from 'next/link';
import type { OrderStatus, OrderSummary, PaginationMeta } from '@/lib/api/types';
import {
  Package, CheckCircle2, Clock, Truck, ArrowUpRight, Loader2, Ban, RotateCcw, AlertTriangle, X,
} from 'lucide-react';

/**
 * The order work queue.
 *
 * Same table, same tiles, same interaction as the Supabase version — only the
 * model behind it moved. What changed is forced by the API's data model, not by
 * a redesign:
 *
 *   - ONE status column instead of three. Legacy carried order, payment and
 *     fulfilment as independent axes: 210 combinations, no cross-field
 *     validation, and live data that was already incoherent. Payment is still
 *     shown, because it is still a separate axis, but it is not something an
 *     operator sets — delivery collects the cash atomically.
 *   - Money comes from `pricing.grandTotal.formatted`, pre-formatted by the
 *     server. It is NEVER re-derived here. The server owns rounding, currency
 *     and the VAT rule, and a console that formats minor units itself is a
 *     console that will eventually disagree with the invoice.
 */

interface OrdersTableProps {
  orders: OrderSummary[];
  meta: PaginationMeta;
  activeStatus: OrderStatus | null;
  /** `null` for a count the API did not answer — NOT zero. */
  counts: Record<string, number | null>;
  total: number | null;
}

/** The tiles, in lifecycle order. */
const TILES: readonly { status: OrderStatus; label: string; icon: typeof Package }[] = [
  { status: 'PLACED', label: 'Placed', icon: Clock },
  { status: 'CONFIRMED', label: 'Confirmed', icon: CheckCircle2 },
  { status: 'SHIPPED', label: 'Shipped', icon: Truck },
  { status: 'DELIVERED', label: 'Delivered', icon: CheckCircle2 },
  { status: 'DELIVERY_FAILED', label: 'Delivery failed', icon: AlertTriangle },
  { status: 'CANCELLED', label: 'Cancelled', icon: Ban },
  { status: 'RETURNED', label: 'Returned', icon: RotateCcw },
];

function label(status: OrderStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.floor((Date.now() - then) / 60000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${String(minutes)}m ago`;
  if (minutes < 1440) return `${String(Math.floor(minutes / 60))}h ago`;
  if (minutes < 2880) return 'Yesterday';
  if (minutes < 10080) return `${String(Math.floor(minutes / 1440))}d ago`;

  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function OrdersTable({
  orders,
  meta,
  activeStatus,
  counts,
  total,
}: OrdersTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const go = (params: URLSearchParams) => {
    startTransition(() => {
      const query = params.toString();
      router.push(`/orders${query === '' ? '' : `?${query}`}`);
    });
  };

  const filterBy = (status: OrderStatus | null) => {
    const params = new URLSearchParams(searchParams.toString());

    if (status === null) params.delete('status');
    else params.set('status', status);

    // Any filter change returns to page 1: staying on page 4 of a filter that
    // has two pages shows an empty table that looks like an empty queue.
    params.delete('page');
    go(params);
  };

  const changePage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(page));
    go(params);
  };

  return (
    <div className="space-y-5">
      {/* Status tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {TILES.map((tile) => {
          const Icon = tile.icon;
          const count = counts[tile.status];
          const active = activeStatus === tile.status;

          return (
            <button
              key={tile.status}
              onClick={() => filterBy(active ? null : tile.status)}
              aria-pressed={active}
              className={`relative overflow-hidden rounded-xl border ${
                active ? 'border-primary ring-1 ring-primary/30' : 'border-border'
              } bg-card p-3 text-left transition-all hover:shadow-md`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="rounded-lg p-1.5 bg-muted">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                {active && (
                  <span className="text-[10px] font-bold px-1.5 py-[2px] rounded-full bg-primary/10 text-primary">
                    Active
                  </span>
                )}
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                {tile.label}
              </p>
              <p
                className="text-lg font-bold tracking-tight text-foreground mt-0.5"
                data-testid={`count-${tile.status}`}
              >
                {/*
                  A count the API did not answer shows an em dash, not 0.
                  "0 orders awaiting confirmation" is a statement of fact and
                  the console must not make it because a request failed.
                */}
                {count === null ? '—' : count.toLocaleString('en-GB')}
              </p>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card shadow-sm p-4 flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {total === null ? (
            'Total unavailable'
          ) : (
            <>
              <span className="font-semibold text-foreground" data-testid="queue-total">
                {total.toLocaleString('en-GB')}
              </span>{' '}
              order{total === 1 ? '' : 's'} in the system
            </>
          )}
        </span>

        {activeStatus !== null && (
          <button
            onClick={() => filterBy(null)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
          >
            <X className="h-3.5 w-3.5" /> Clear filter: {label(activeStatus)}
          </button>
        )}

        {isPending && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating…
          </span>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Order</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Items</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Payment</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-muted/20 transition-colors" data-testid="order-row">
                  <td className="px-5 py-3">
                    <div className="flex flex-col gap-0.5">
                      <Link
                        href={`/orders/${order.id}`}
                        className="font-mono text-[11px] font-bold text-primary hover:underline"
                        data-testid="order-number"
                      >
                        {order.orderNumber}
                      </Link>
                      <span className="text-[10px] text-muted-foreground">
                        {relativeTime(order.placedAt)}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-foreground">
                      {order.itemCount} line{order.itemCount === 1 ? '' : 's'}
                    </span>
                    <span className="text-[10px] text-muted-foreground block">
                      {order.totalQuantity} item{order.totalQuantity === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {/*
                      The SERVER's formatted string. Never re-derived from
                      minor units here — the server owns rounding, the currency
                      and the VAT rule, and a second formatter is a second
                      answer.
                    */}
                    <span
                      className="text-sm font-bold text-foreground tabular-nums"
                      data-testid="order-total"
                    >
                      {order.pricing.grandTotal.formatted}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span data-testid="order-status">
                      <StatusBadge status={order.status} />
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span data-testid="order-payment">
                      <StatusBadge status={order.payment.status} />
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/orders/${order.id}`}
                      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold bg-muted/50 text-foreground hover:bg-primary hover:text-primary-foreground transition-all"
                    >
                      Manage
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-muted-foreground" data-testid="empty-queue">
                        {activeStatus === null
                          ? 'No orders yet.'
                          : `No orders are ${label(activeStatus).toLowerCase()}.`}
                      </p>
                      {activeStatus !== null && (
                        <button
                          onClick={() => filterBy(null)}
                          className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted transition-all"
                        >
                          <X className="h-3.5 w-3.5" /> Clear filter
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{orders.length}</span> of{' '}
            <span className="font-semibold text-foreground">{meta.total}</span>
          </span>
          {meta.totalPages > 1 && (
            <Pagination
              currentPage={meta.page}
              totalPages={meta.totalPages}
              onPageChange={changePage}
            />
          )}
        </div>
      </div>
    </div>
  );
}
