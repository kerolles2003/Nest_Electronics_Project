'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, StatusBadge } from '@nest/ui';
import {
  Package, CreditCard, Clock, MapPin, Phone, User, Printer, AlertCircle, Loader2, Route,
  StickyNote, Truck, CheckCircle2, RotateCcw, XCircle, Ban,
} from 'lucide-react';
import {
  confirmOrderAction,
  deliverOrderAction,
  failDeliveryAction,
  retryShipmentAction,
  returnOrderAction,
  shipOrderAction,
  type OrderActionResult,
} from '@/actions/admin-order.actions';
import type { AdminOrder, AdminOrderTransition, OrderStatus } from '@/lib/api/types';

/**
 * One order, and the moves an operator may make on it.
 *
 * ## THERE IS NO TRANSITION MAP IN THIS FILE
 *
 * That sentence is the entire point of this component. It used to hold
 * `VALID_ORDER_TRANSITIONS`, `VALID_PAYMENT_TRANSITIONS` and
 * `VALID_FULFILLMENT_TRANSITIONS` — a copy of the state machine, over a status
 * vocabulary the server does not have — and `order.actions.ts` held a SECOND
 * copy of the same three maps. They had already drifted from each other, and
 * neither was enforced: the RPC underneath was callable by the `anon` role, so
 * the rules were advisory and anybody who skipped the UI skipped them
 * (F-CRIT-1 / F-HIGH-1).
 *
 * The buttons below are rendered from `order.allowedTransitions`, which the API
 * computes with the SAME function its engine calls before it writes. What this
 * screen offers and what the server accepts cannot drift, because there is only
 * one of them.
 *
 * A move whose `action` is `null` is legal in the matrix but has no staff route
 * — cancellation is the customer's own operation — so it is shown as
 * unavailable with the reason, rather than as a button that would 404.
 *
 * ## Payment is not a control
 *
 * There is no "update payment status" selector any more, and its absence is a
 * fix. Under COD, delivery IS the payment event: the API sets `payment.status`
 * to `PAID` and `payment.collectedAt` in the same atomic write as the transition
 * to `DELIVERED`. Legacy let the two be set independently, which is why live
 * data contained orders that were delivered and unpaid, and shipped and paid.
 * Payment is displayed here and driven by the lifecycle.
 */

interface OrderDetailProps {
  order: AdminOrder;
}

/** The three lifecycle actions that need something typed before they can run. */
const NEEDS_REASON = new Set(['delivery-failed', 'return']);

function label(status: OrderStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
}

function iconFor(status: OrderStatus) {
  switch (status) {
    case 'CONFIRMED': return CheckCircle2;
    case 'SHIPPED': return Truck;
    case 'DELIVERED': return CheckCircle2;
    case 'DELIVERY_FAILED': return AlertCircle;
    case 'RETURNED': return RotateCcw;
    case 'CANCELLED': return Ban;
    default: return Package;
  }
}

export default function OrderDetail({ order }: OrderDetailProps) {
  const { addToast } = useToast();
  const router = useRouter();

  const [running, setRunning] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  /** The last server refusal, shown in place rather than only as a toast. */
  const [refusal, setRefusal] = useState<string | null>(null);

  const isCod = order.payment.method === 'COD';

  /**
   * Dispatches one move.
   *
   * The mapping from `action` to server action is the ONLY place this file
   * knows the names of the six endpoints, and it knows nothing about WHEN each
   * is legal — that is `allowedTransitions`.
   */
  async function perform(move: AdminOrderTransition): Promise<void> {
    if (move.action === null) return;

    setRunning(move.action);
    setRefusal(null);

    let result: OrderActionResult;

    switch (move.action) {
      case 'confirm':
        result = await confirmOrderAction(order.id, note);
        break;
      case 'ship':
        result = await shipOrderAction(order.id, { carrier, trackingNumber, note });
        break;
      case 'deliver':
        result = await deliverOrderAction(order.id, note);
        break;
      case 'delivery-failed':
        result = await failDeliveryAction(order.id, reason);
        break;
      case 'retry-shipment':
        result = await retryShipmentAction(order.id, { carrier, trackingNumber, note });
        break;
      case 'return':
        result = await returnOrderAction(order.id, reason);
        break;
      default:
        /*
         * An action the server advertised and this build does not implement.
         * Reported rather than ignored: silently doing nothing when a button is
         * pressed on a fulfilment console is the worst available outcome.
         */
        result = { ok: false, error: `This console cannot perform "${move.action}" yet.` };
    }

    setRunning(null);

    if (!result.ok) {
      setRefusal(result.error ?? 'The action was refused.');
      addToast(result.error ?? 'The action was refused.', 'error');
      return;
    }

    addToast(`Order is now ${label(move.to).toLowerCase()}.`, 'success');
    setNote('');
    setReason('');
    setCarrier('');
    setTrackingNumber('');

    // The server action revalidated both paths; this re-renders from them.
    // Not `window.location.reload()`, which the old version used and which
    // throws away the toast the operator was meant to read.
    router.refresh();
  }

  /** Whether a move has everything it needs to be attempted. */
  function ready(move: AdminOrderTransition): boolean {
    if (move.action === null) return false;
    if (move.requires.includes('carrier') && carrier.trim() === '') return false;
    if (move.requires.includes('trackingNumber') && trackingNumber.trim() === '') return false;
    if (NEEDS_REASON.has(move.action) && reason.trim().length < 3) return false;

    return true;
  }

  const routable = order.allowedTransitions.filter((move) => move.action !== null);
  const unroutable = order.allowedTransitions.filter((move) => move.action === null);

  /** The union of every field the currently-available moves ask for. */
  const wantsCarrier = routable.some((move) => move.requires.includes('carrier'));
  const wantsTracking = routable.some((move) => move.requires.includes('trackingNumber'));
  const wantsReason = routable.some((move) => NEEDS_REASON.has(move.action ?? ''));
  const optionalTracking = routable.some((move) => move.action === 'retry-shipment');

  return (
    <div className="space-y-5 pb-10">
      {/* Status header */}
      <div className="rounded-xl border border-border bg-card shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span data-testid="order-status">
            <StatusBadge status={order.status} />
          </span>
          <span data-testid="payment-status">
            <StatusBadge status={order.payment.status} />
          </span>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <span className="text-xs text-muted-foreground">
            Placed {new Date(order.placedAt).toLocaleString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
        >
          <Printer className="h-3.5 w-3.5" />
          Print Invoice
        </button>
      </div>

      {isCod && (
        <div className="rounded-lg border border-warning/20 bg-warning/5 px-4 py-2.5 flex items-center gap-2 text-xs text-warning">
          <Route className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold">Cash on delivery:</span>
          <span className="text-warning/80">
            marking this order delivered records the cash as collected, in the same write.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 space-y-5">
          {/* Available moves */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/20">
              <h2 className="text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider">
                <Clock className="h-4 w-4 text-primary" />
                Available actions
              </h2>
            </div>

            <div className="p-5 space-y-4">
              {refusal !== null && (
                <div
                  role="alert"
                  data-testid="action-refusal"
                  className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs"
                >
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{refusal}</span>
                </div>
              )}

              {routable.length === 0 && unroutable.length === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="terminal-order">
                  This order is <strong>{label(order.status).toLowerCase()}</strong> and cannot be
                  moved any further. That is the complete answer, not a missing one.
                </p>
              )}

              {/* The fields the available moves ask for, and only those. */}
              {(wantsCarrier || wantsTracking) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="carrier" className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                      Carrier {optionalTracking && <span className="font-normal normal-case">(optional — keeps the current one)</span>}
                    </label>
                    <input
                      id="carrier"
                      data-testid="carrier"
                      value={carrier}
                      onChange={(e) => setCarrier(e.target.value)}
                      placeholder="Bosta"
                      className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs focus:ring-2 focus:ring-primary/10 outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="tracking" className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                      Tracking number {optionalTracking && <span className="font-normal normal-case">(optional)</span>}
                    </label>
                    <input
                      id="tracking"
                      data-testid="tracking-number"
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                      placeholder="BST-123456789"
                      className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs focus:ring-2 focus:ring-primary/10 outline-none"
                    />
                  </div>
                </div>
              )}

              {wantsReason && (
                <div className="space-y-1.5">
                  <label htmlFor="reason" className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                    Reason <span className="font-normal normal-case">(required — recorded on the order)</span>
                  </label>
                  <input
                    id="reason"
                    data-testid="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Customer unreachable on three call attempts."
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs focus:ring-2 focus:ring-primary/10 outline-none"
                  />
                </div>
              )}

              {/* ONE button per move the SERVER says is available. */}
              <div className="flex flex-wrap gap-2">
                {routable.map((move) => {
                  const Icon = iconFor(move.to);
                  const busy = running === move.action;

                  return (
                    <button
                      key={`${move.to}-${move.action ?? ''}`}
                      data-testid={`action-${move.action ?? 'none'}`}
                      onClick={() => void perform(move)}
                      disabled={busy || running !== null || !ready(move)}
                      title={ready(move) ? undefined : `Fill in: ${move.requires.join(', ') || 'reason'}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                      {busy ? 'Working…' : `Mark ${label(move.to).toLowerCase()}`}
                    </button>
                  );
                })}
              </div>

              {unroutable.length > 0 && (
                <p className="text-[11px] text-muted-foreground" data-testid="unroutable-moves">
                  {unroutable.map((move) => label(move.to).toLowerCase()).join(', ')}
                  {unroutable.length === 1 ? ' is' : ' are'} possible for this order but not from
                  this console — cancelling is the customer&apos;s own action.
                </p>
              )}

              {routable.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <input
                    data-testid="note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional note, recorded on the status history…"
                    className="flex-1 h-8 rounded-md border border-border bg-background px-2 text-xs focus:ring-1 focus:ring-primary/20 outline-none"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Line items */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
              <h2 className="text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider">
                <Package className="h-4 w-4 text-primary" />
                Line items
              </h2>
              <span className="text-[11px] text-muted-foreground">{order.items.length} lines</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Product</th>
                    <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">SKU</th>
                    <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Unit</th>
                    <th className="px-5 py-3 text-center text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Qty</th>
                    <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {order.items.map((item) => (
                    <tr key={item.productId} className="hover:bg-muted/10 transition-colors">
                      <td className="px-5 py-3">
                        <div className="text-xs font-semibold text-foreground">{item.name}</div>
                        {item.brandName !== null && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">{item.brandName}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground font-mono text-[11px]">{item.sku}</td>
                      <td className="px-5 py-3 text-right text-xs tabular-nums">{item.unitPrice.formatted}</td>
                      <td className="px-5 py-3 text-center text-xs font-bold">{item.quantity}</td>
                      <td className="px-5 py-3 text-right text-xs font-bold tabular-nums">{item.lineTotal.formatted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-5">
          {/* Customer */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/20">
              <h2 className="text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider">
                <User className="h-4 w-4 text-primary" />
                Customer
              </h2>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-muted shrink-0">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">{order.customer.fullName}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{order.customer.email}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <Phone className="h-4 w-4 text-primary" />
                </div>
                <a
                  href={`tel:${order.shippingAddress.phone}`}
                  className="text-sm font-semibold text-foreground hover:text-primary transition-colors"
                >
                  {order.shippingAddress.phone}
                </a>
              </div>
              <div className="flex items-start gap-3 border-t border-border pt-3">
                <div className="p-2 rounded-lg bg-muted shrink-0">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                    Shipping address
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {order.shippingAddress.fullName}<br />
                    {order.shippingAddress.street}<br />
                    {order.shippingAddress.city}, {order.shippingAddress.governorate}
                    {order.shippingAddress.postalCode !== null && <><br />{order.shippingAddress.postalCode}</>}
                  </p>
                </div>
              </div>
              {order.customerNote !== null && (
                <div className="border-t border-border pt-3">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                    Customer note
                  </p>
                  <p className="text-xs text-muted-foreground italic">&ldquo;{order.customerNote}&rdquo;</p>
                </div>
              )}
            </div>
          </div>

          {/* Money */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/20">
              <h2 className="text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider">
                <CreditCard className="h-4 w-4 text-primary" />
                Order summary
              </h2>
            </div>
            <div className="p-5 space-y-2.5">
              {/*
                Every figure is the SERVER's formatted string. Nothing is
                summed, divided or rounded here — the order is a frozen
                financial record and a second formatter is a second answer.
              */}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium text-foreground">{order.pricing.itemsSubtotal.formatted}</span>
              </div>
              {order.pricing.discountTotal.amount > 0 && (
                <div className="flex justify-between text-sm text-success">
                  <span>Discount</span>
                  <span className="font-medium">-{order.pricing.discountTotal.formatted}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Shipping</span>
                <span className="font-medium text-foreground">
                  {/*
                    `shippingPriced: false` is NOT "free delivery" — it means no
                    rate was supplied when this order was placed. Printing 0.00
                    for it would state a price nobody quoted.
                  */}
                  {order.pricing.shippingPriced ? order.pricing.shippingFee.formatted : 'Not priced'}
                </span>
              </div>
              <div className="pt-2.5 border-t border-border">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                      Total {order.payment.status === 'PENDING' ? 'due on delivery' : 'collected'}
                    </p>
                    <p className="text-2xl font-bold text-foreground" data-testid="grand-total">
                      {order.pricing.grandTotal.formatted}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Payment</p>
                    <p className="text-sm font-semibold text-foreground">{order.payment.method}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Shipment */}
          {order.shipment !== null && (
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/20">
                <h2 className="text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider">
                  <Truck className="h-4 w-4 text-primary" />
                  Shipment
                </h2>
              </div>
              <div className="p-5 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Carrier</span>
                  <span className="font-semibold text-foreground" data-testid="shipment-carrier">
                    {order.shipment.carrier}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground shrink-0">Tracking</span>
                  <span className="font-mono font-semibold text-foreground truncate" data-testid="shipment-tracking">
                    {order.shipment.trackingNumber}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Delivery attempts</span>
                  <span className="font-semibold text-foreground" data-testid="delivery-attempts">
                    {order.shipment.deliveryAttempts}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Who did what */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/20">
              <h2 className="text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider">
                <Clock className="h-4 w-4 text-primary" />
                History
              </h2>
            </div>
            <div className="p-4 space-y-3" data-testid="status-history">
              {/*
                Newest first for reading; the API returns oldest first because
                that is the order things happened in. The ACTOR on each entry
                comes from the token server-side and cannot be forged — it is
                the answer to "who confirmed this order", which no screen in
                this console could give before Phase 6.
              */}
              {[...order.statusHistory].reverse().map((entry, index) => (
                <div key={`${entry.to}-${entry.at}-${String(index)}`} className="relative flex gap-3">
                  {index < order.statusHistory.length - 1 && (
                    <div className="absolute left-[7px] top-5 bottom-0 w-px bg-border" />
                  )}
                  <div className="mt-0.5 h-3.5 w-3.5 rounded-full border-2 border-background bg-primary shrink-0 z-10" />
                  <div className="space-y-0 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-foreground">{label(entry.to)}</span>
                      <span className="text-[9px] text-muted-foreground">
                        {new Date(entry.at).toLocaleString('en-GB', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground" data-testid="history-actor">
                      {entry.actor.name}
                      <span className="text-muted-foreground/70"> · {entry.actor.role.replace('_', ' ').toLowerCase()}</span>
                    </p>
                    {entry.note !== null && (
                      <p className="text-[11px] text-muted-foreground italic mt-0.5">&ldquo;{entry.note}&rdquo;</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
