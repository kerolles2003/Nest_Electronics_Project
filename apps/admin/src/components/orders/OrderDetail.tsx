'use client';

import { useState } from 'react';
import { useToast, StatusBadge } from '@nest/ui';
import {
  updateOrderStatusAction,
  updatePaymentStatusAction,
  updateFulfillmentStatusAction,
} from '@/actions/order.actions';
import { OrderStatus, PaymentStatus, FulfillmentStatus } from '@nest/types';
import {
  Package, CreditCard, Clock, MapPin, Phone, User,
  Printer, AlertCircle, Loader2, Route, StickyNote
} from 'lucide-react';

const VALID_ORDER_TRANSITIONS: Record<string, string[]> = {
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.FAILED],
  [OrderStatus.PAID]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
};

const VALID_PAYMENT_TRANSITIONS: Record<string, string[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.PAID, PaymentStatus.FAILED],
  [PaymentStatus.PAID]: [PaymentStatus.REFUNDED],
};

const VALID_FULFILLMENT_TRANSITIONS: Record<string, string[]> = {
  [FulfillmentStatus.UNFULFILLED]: [FulfillmentStatus.PROCESSING],
  [FulfillmentStatus.PROCESSING]: [FulfillmentStatus.SHIPPED],
  [FulfillmentStatus.SHIPPED]: [FulfillmentStatus.DELIVERED, FulfillmentStatus.RETURNED],
};

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Pending Payment',
  paid: 'Paid',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Failed',
  pending: 'Pending',
  authorized: 'Authorized',
  refunded: 'Refunded',
  partially_refunded: 'Partially Refunded',
  unfulfilled: 'Unfulfilled',
  returned: 'Returned',
};

interface OrderDetailProps {
  order: any;
  adminId: string;
}

export default function OrderDetail({ order, adminId: _adminId }: OrderDetailProps) {
  const { addToast } = useToast();
  const [selectedOrderStatus, setSelectedOrderStatus] = useState('');
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState('');
  const [selectedFulfillmentStatus, setSelectedFulfillmentStatus] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [updating, setUpdating] = useState('');

  const handleOrderStatusUpdate = async () => {
    if (!selectedOrderStatus) return;
    setUpdating('order_status');
    const result = await updateOrderStatusAction(order.id, selectedOrderStatus, statusNote || undefined);
    setUpdating('');
    if (result.success) {
      addToast('Order status updated successfully.', 'success');
      setSelectedOrderStatus('');
      setStatusNote('');
      window.location.reload();
    } else {
      addToast(result.error || 'Update failed.', 'error');
    }
  };

  const handlePaymentStatusUpdate = async () => {
    if (!selectedPaymentStatus) return;
    setUpdating('payment_status');
    const result = await updatePaymentStatusAction(order.id, selectedPaymentStatus, statusNote || undefined);
    setUpdating('');
    if (result.success) {
      addToast('Payment status updated successfully.', 'success');
      setSelectedPaymentStatus('');
      setStatusNote('');
      window.location.reload();
    } else {
      addToast(result.error || 'Update failed.', 'error');
    }
  };

  const handleFulfillmentStatusUpdate = async () => {
    if (!selectedFulfillmentStatus) return;
    setUpdating('fulfillment_status');
    const result = await updateFulfillmentStatusAction(
      order.id,
      selectedFulfillmentStatus,
      selectedFulfillmentStatus === 'shipped' ? trackingNumber : undefined,
      statusNote || undefined
    );
    setUpdating('');
    if (result.success) {
      addToast('Fulfillment status updated successfully.', 'success');
      setSelectedFulfillmentStatus('');
      setTrackingNumber('');
      setStatusNote('');
      window.location.reload();
    } else {
      addToast(result.error || 'Update failed.', 'error');
    }
  };

  const orderTransitions = VALID_ORDER_TRANSITIONS[order.order_status as string] || [];
  const paymentTransitions = VALID_PAYMENT_TRANSITIONS[order.payment_status as string] || [];
  const fulfillmentTransitions = VALID_FULFILLMENT_TRANSITIONS[order.fulfillment_status as string] || [];

  const statusHistory = Array.isArray(order.status_history)
    ? [...order.status_history].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    : [];

  const isCod = order.payment_method === 'cod';

  return (
    <div className="space-y-5 pb-10">
      {/* Status Header Bar */}
      <div className="rounded-xl border border-border bg-card shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={order.order_status} />
          <StatusBadge status={order.payment_status} />
          <StatusBadge status={order.fulfillment_status} />
          <div className="h-4 w-px bg-border hidden sm:block" />
          <span className="text-xs text-muted-foreground">
            Placed {new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
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

      {/* COD Workflow Hint */}
      {isCod && (
        <div className="rounded-lg border border-warning/20 bg-warning/5 px-4 py-2.5 flex items-center gap-2 text-xs text-warning">
          <Route className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold">COD Workflow:</span>
          <span className="text-warning/80">Pending Confirmation &rarr; Confirmed &rarr; Packed &rarr; Shipped &rarr; Delivered / Refused</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 space-y-5">
          {/* Status Update Panel */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/20">
              <h2 className="text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider">
                <Clock className="h-4 w-4 text-primary" />
                Update Status
              </h2>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Order Status */}
                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    Order Status
                  </label>
                  <select
                    value={selectedOrderStatus}
                    onChange={(e) => setSelectedOrderStatus(e.target.value)}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs focus:ring-2 focus:ring-primary/10 outline-none"
                  >
                    <option value="">Current: {STATUS_LABEL[order.order_status] || order.order_status}</option>
                    {orderTransitions.map((status: string) => (
                      <option key={status} value={status}>{STATUS_LABEL[status] || status}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleOrderStatusUpdate}
                    disabled={!selectedOrderStatus || updating === 'order_status'}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50"
                  >
                    {updating === 'order_status' && <Loader2 className="h-3 w-3 animate-spin" />}
                    {updating === 'order_status' ? 'Updating...' : 'Update Order'}
                  </button>
                </div>

                {/* Payment Status */}
                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                    <div className="w-1.5 h-1.5 rounded-full bg-success" />
                    Payment Status
                  </label>
                  <select
                    value={selectedPaymentStatus}
                    onChange={(e) => setSelectedPaymentStatus(e.target.value)}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs focus:ring-2 focus:ring-primary/10 outline-none"
                  >
                    <option value="">Current: {STATUS_LABEL[order.payment_status] || order.payment_status}</option>
                    {paymentTransitions.map((status: string) => (
                      <option key={status} value={status}>{STATUS_LABEL[status] || status}</option>
                    ))}
                  </select>
                  <button
                    onClick={handlePaymentStatusUpdate}
                    disabled={!selectedPaymentStatus || updating === 'payment_status'}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-all disabled:opacity-50"
                  >
                    {updating === 'payment_status' && <Loader2 className="h-3 w-3 animate-spin" />}
                    {updating === 'payment_status' ? 'Updating...' : 'Update Payment'}
                  </button>
                </div>

                {/* Fulfillment */}
                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    Fulfillment
                  </label>
                  <select
                    value={selectedFulfillmentStatus}
                    onChange={(e) => setSelectedFulfillmentStatus(e.target.value)}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs focus:ring-2 focus:ring-primary/10 outline-none"
                  >
                    <option value="">Current: {STATUS_LABEL[order.fulfillment_status] || order.fulfillment_status}</option>
                    {fulfillmentTransitions.map((status: string) => (
                      <option key={status} value={status}>{STATUS_LABEL[status] || status}</option>
                    ))}
                  </select>
                  {selectedFulfillmentStatus === 'shipped' && (
                    <input
                      type="text"
                      placeholder="Tracking number"
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                      className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs focus:ring-2 focus:ring-primary/10 outline-none"
                    />
                  )}
                  <button
                    onClick={handleFulfillmentStatusUpdate}
                    disabled={!selectedFulfillmentStatus || updating === 'fulfillment_status' || (selectedFulfillmentStatus === 'shipped' && !trackingNumber)}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-all disabled:opacity-50"
                  >
                    {updating === 'fulfillment_status' && <Loader2 className="h-3 w-3 animate-spin" />}
                    {updating === 'fulfillment_status' ? 'Updating...' : 'Update Fulfillment'}
                  </button>
                </div>
              </div>

              {/* Optional note */}
              <div className="flex items-center gap-2">
                <StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  placeholder="Optional note for status history..."
                  className="flex-1 h-8 rounded-md border border-border bg-background px-2 text-xs focus:ring-1 focus:ring-primary/20 outline-none"
                />
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
              <h2 className="text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider">
                <Package className="h-4 w-4 text-primary" />
                Line Items
              </h2>
              <span className="text-[11px] text-muted-foreground">
                {Array.isArray(order.items) ? order.items.length : 0} items
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Product</th>
                    <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">SKU</th>
                    <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Unit Price</th>
                    <th className="px-5 py-3 text-center text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Qty</th>
                    <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {Array.isArray(order.items) &&
                    order.items.map((item: any) => (
                      <tr key={item.id} className="hover:bg-muted/10 transition-colors">
                        <td className="px-5 py-3">
                          <div className="text-xs font-semibold text-foreground">{item.name}</div>
                          {item.variant_name && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">{item.variant_name}</div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground font-mono text-[11px]">{item.sku}</td>
                        <td className="px-5 py-3 text-right text-xs tabular-nums">{item.price.toLocaleString('en-EG')} EGP</td>
                        <td className="px-5 py-3 text-center text-xs font-bold">{item.quantity}</td>
                        <td className="px-5 py-3 text-right text-xs font-bold tabular-nums">{item.total.toLocaleString('en-EG')} EGP</td>
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
            {order.shipping_address ? (
              <div className="p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-muted shrink-0">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">{order.shipping_address.full_name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">ID: {order.user_id.slice(0, 8)}...</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                    <Phone className="h-4 w-4 text-primary" />
                  </div>
                  <a href={`tel:${order.shipping_address.phone}`} className="text-sm font-semibold text-foreground hover:text-primary transition-colors">
                    {order.shipping_address.phone}
                  </a>
                </div>
                <div className="flex items-start gap-3 border-t border-border pt-3">
                  <div className="p-2 rounded-lg bg-muted shrink-0">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Shipping Address</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {order.shipping_address.street}<br />
                      {order.shipping_address.city}, {order.shipping_address.governorate}<br />
                      {order.shipping_address.postal_code && `Postal: ${order.shipping_address.postal_code}`}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center px-5">
                <AlertCircle className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No address data available.</p>
              </div>
            )}
          </div>

          {/* Order Summary */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/20">
              <h2 className="text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider">
                <CreditCard className="h-4 w-4 text-primary" />
                Order Summary
              </h2>
            </div>
            <div className="p-5 space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium text-foreground">{order.subtotal.toLocaleString('en-EG')} EGP</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-sm text-success">
                  <span>Discount</span>
                  <span className="font-medium">-{order.discount.toLocaleString('en-EG')} EGP</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Shipping</span>
                <span className="font-medium text-foreground">{order.shipping_fee.toLocaleString('en-EG')} EGP</span>
              </div>
              <div className="pt-2.5 border-t border-border">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total</p>
                    <p className="text-2xl font-bold text-foreground">{order.total.toLocaleString('en-EG')} <span className="text-sm font-normal text-muted-foreground">EGP</span></p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Payment</p>
                    <p className="text-sm font-semibold capitalize text-foreground">{order.payment_method}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Status History — Compact Timeline */}
          {statusHistory.length > 0 && (
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/20">
                <h2 className="text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider">
                  <Clock className="h-4 w-4 text-primary" />
                  Status History
                </h2>
              </div>
              <div className="p-4 space-y-3">
                {statusHistory.map((entry, index) => (
                  <div key={entry.id} className="relative flex gap-3">
                    {index < statusHistory.length - 1 && (
                      <div className="absolute left-[7px] top-5 bottom-0 w-px bg-border" />
                    )}
                    <div className={`mt-0.5 h-3.5 w-3.5 rounded-full border-2 border-background shrink-0 z-10
                      ${entry.field === 'order_status' ? 'bg-primary' :
                        entry.field === 'payment_status' ? 'bg-success' : 'bg-primary'}`}
                    />
                    <div className="space-y-0 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold capitalize text-foreground">
                          {entry.to_value.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[9px] text-muted-foreground">
                          {new Date(entry.created_at).toLocaleDateString()} {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {entry.notes && (
                        <p className="text-[11px] text-muted-foreground italic mt-0.5">&ldquo;{entry.notes}&rdquo;</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
