'use client';

import { useState, FormEvent } from 'react';
import { Input } from '@nest/ui';
import { Label } from '@nest/ui';
import { Button } from '@nest/ui';
import { ArrowLeft, PackageSearch, Search } from 'lucide-react';
import Link from 'next/link';
import { StatusBadge } from '@nest/ui';
import { useOrderTrackingStore } from '@/stores/orderTrackingStore';
import OrderTimeline from './OrderTimeline';
import ShipmentInfo from './ShipmentInfo';
import { useToast } from '@nest/ui';
import { ROUTES } from '@nest/config/constants';

export default function OrderTracker() {
  const { order, loading, error, fetchOrder } = useOrderTrackingStore();
  const [orderNumber, setOrderNumber] = useState('');
  const [phone, setPhone] = useState('');
  const toast = useToast();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      // Sanitize order number (remove # if present)
      const sanitizedOrderNumber = orderNumber.trim().replace(/^#/, '');
      await fetchOrder({ order_number: sanitizedOrderNumber, phone: phone.trim() });
    } catch (err: any) {
      toast.addToast('An error occurred while tracking.', 'error');
    }
  };

  const handleReset = () => {
    useOrderTrackingStore.setState({ order: null, error: null });
    setOrderNumber('');
    setPhone('');
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-6 bg-white border border-[var(--color-border)] rounded-sm shadow-sm">
      <div className="relative">
        <PackageSearch className="w-16 h-16 text-primary animate-pulse" strokeWidth={1} />
        <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin opacity-20" />
      </div>
      <div className="text-center">
        <p className="text-xl font-bold text-foreground">Locating your order...</p>
        <p className="text-sm text-foreground-muted mt-1">This will only take a moment</p>
      </div>
    </div>
  );

  if (order) {
    const statusLabels: Record<string, string> = {
      pending_payment: 'Pending Payment',
      paid: 'Paid',
      processing: 'Processing',
      shipped: 'Shipped',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
      failed: 'Failed',
    };

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center justify-between px-2">
          <Link href={ROUTES.home} className="inline-flex items-center gap-2 text-sm font-bold text-foreground-muted hover:text-primary transition-colors group">
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
            BACK TO STORE
          </Link>
          <button 
            onClick={handleReset}
            className="text-xs font-black text-primary hover:text-primary-hover uppercase tracking-widest border-b-2 border-primary/20 hover:border-primary transition-all"
          >
            Track another order
          </button>
        </div>

        <div className="bg-white border border-[var(--color-border)] rounded-sm p-6 sm:p-10 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none">
            <PackageSearch className="w-40 h-40" />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 mb-10 pb-8 border-b border-[var(--color-border)]">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-black uppercase tracking-widest text-primary bg-primary/10 px-2 py-0.5 rounded-full">Order Details</span>
                <span className="text-xs font-bold text-foreground-muted">#{order.order_number}</span>
              </div>
              <h2 className="text-3xl font-black text-foreground leading-tight">Order #{order.order_number}</h2>
              <p className="text-[13px] text-foreground-muted mt-2 font-medium">
                Placed on <span className="text-foreground">{new Date(order.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
              </p>
            </div>
            <StatusBadge
              status={statusLabels[order.order_status] ?? order.order_status}
              className="self-start sm:self-center text-sm px-6 py-2.5 font-black uppercase tracking-widest shadow-sm"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            <div className="lg:col-span-7">
              {order.status_history && order.status_history.length > 0 ? (
                <OrderTimeline history={order.status_history} />
              ) : (
                <div className="p-8 bg-[var(--color-surface)] rounded-sm border border-dashed border-[var(--color-border-strong)] text-center">
                  <p className="text-sm text-foreground-muted">No status history available yet.</p>
                </div>
              )}
            </div>
            <div className="lg:col-span-5">
              <ShipmentInfo address={order.shipping_address} />
            </div>
          </div>
        </div>

        {/* Items list */}
        <div className="bg-white border border-[var(--color-border)] rounded-sm p-6 sm:p-10 shadow-sm">
          <h3 className="font-black text-foreground mb-8 uppercase tracking-[0.2em] text-[11px] border-b border-primary/20 pb-4 inline-block">Order Summary</h3>
          <div className="divide-y divide-[var(--color-border)]">
            {order.items?.map((item) => (
              <div key={item.id} className="flex items-center justify-between py-5 first:pt-0 last:pb-0 group">
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold text-foreground group-hover:text-primary transition-colors">{item.name}</p>
                  <p className="text-[12px] text-foreground-muted mt-1 font-medium">
                    SKU: <span className="text-foreground/70">{item.sku}</span> 
                    <span className="mx-3 text-[var(--color-border-strong)]">|</span> 
                    Qty: <span className="text-foreground/70">{item.quantity}</span>
                  </p>
                </div>
                <div className="text-right ml-6">
                  <p className="text-[16px] font-black text-foreground">{item.total.toLocaleString()} EGP</p>
                  <p className="text-[11px] text-foreground-muted font-bold uppercase tracking-wider">{item.price.toLocaleString()} EGP / unit</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-10 pt-8 border-t-2 border-[var(--color-border)] flex justify-between items-end">
            <div>
              <p className="text-[11px] font-black text-foreground-muted uppercase tracking-[0.2em] mb-1">Final Amount</p>
              <span className="font-black text-foreground text-sm">TOTAL TO PAY</span>
            </div>
            <div className="text-right">
              <span className="text-3xl font-black text-primary leading-none">
                {order.total.toLocaleString()} <span className="text-base font-bold ml-1">EGP</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Form ----------
  return (
    <div className="bg-white border border-[var(--color-border)] rounded-sm p-10 sm:p-16 shadow-lg relative overflow-hidden">
      <div className="absolute top-0 right-0 p-12 opacity-[0.02] pointer-events-none">
        <Search className="w-64 h-64" />
      </div>

      <form onSubmit={handleSubmit} className="max-w-md mx-auto space-y-8 relative z-10">
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/5 mb-6">
            <PackageSearch className="w-10 h-10 text-primary" strokeWidth={1.5} />
          </div>
          <h2 className="text-3xl font-black text-foreground mb-4 uppercase tracking-tight">Track Your Order</h2>
          <p className="text-foreground-muted text-[15px] leading-relaxed font-medium">
            Enter your order number and the phone number used during checkout to see live updates on your shipment.
          </p>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border-l-4 border-red-500 rounded-sm text-[13px] text-red-700 font-bold animate-in fade-in zoom-in-95 duration-200">
            <p className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              {error}
            </p>
          </div>
        )}

        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="orderNumber" className="text-[11px] font-black text-foreground uppercase tracking-[0.15em]">
              Order Number
            </Label>
            <div className="relative">
              <Input
                id="orderNumber"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                placeholder="e.g. #12345"
                className="h-14 rounded-sm border-[var(--color-border-strong)] bg-[var(--color-surface)] focus:bg-white transition-all text-base pl-4"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone" className="text-[11px] font-black text-foreground uppercase tracking-[0.15em]">
              Billing Phone Number
            </Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01xxxxxxxxx"
              className="h-14 rounded-sm border-[var(--color-border-strong)] bg-[var(--color-surface)] focus:bg-white transition-all text-base pl-4"
              required
            />
          </div>
        </div>

        <Button 
          type="submit" 
          disabled={loading}
          className="w-full h-14 text-[14px] font-black uppercase tracking-[0.2em] bg-primary hover:bg-primary-hover text-primary-foreground rounded-sm shadow-xl shadow-primary/20 transition-all hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
        >
          <Search className="w-4 h-4 mr-2" />
          FIND MY ORDER
        </Button>
        
        <p className="text-center text-[11px] text-foreground-muted font-bold uppercase tracking-widest pt-4">
          Secured tracking powered by Nest
        </p>
      </form>
    </div>
  );
}
