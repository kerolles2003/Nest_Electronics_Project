import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { StatusBadge } from '@nest/ui';
import { ArrowLeft, Package, PackageSearch } from 'lucide-react';
import { OrderStatus } from '@nest/types';
import { ROUTES } from '@nest/config/constants';
import TrackOrderToggle from '@/components/order-tracking/TrackOrderToggle';

export const dynamic = 'force-dynamic';

const statusLabels: Record<string, string> = {
  [OrderStatus.PENDING_PAYMENT]: 'Pending Payment',
  [OrderStatus.PAID]: 'Paid',
  [OrderStatus.PROCESSING]: 'Processing',
  [OrderStatus.SHIPPED]: 'Shipped',
  [OrderStatus.DELIVERED]: 'Delivered',
  [OrderStatus.CANCELLED]: 'Cancelled',
  [OrderStatus.FAILED]: 'Failed',
};

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient() as any;
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  const { data: order } = await supabase
    .from('orders')
    .select('*, items:order_items(*), status_history:order_status_history(*)')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (!order) {
    notFound();
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between">
        <Link
          href={ROUTES.account.orders}
          className="inline-flex items-center gap-2 text-sm font-bold text-foreground-muted hover:text-primary transition-all group"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
          BACK TO MY ORDERS
        </Link>
        <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-primary/40">
          <Package className="w-4 h-4" />
          Nest Secured Tracking
        </div>
      </div>

      {/* Main Order Status Header */}
      <div className="bg-white border border-[var(--color-border)] rounded-sm p-6 sm:p-10 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none">
          <PackageSearch className="w-40 h-40" />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
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
      </div>

      {/* Track Order Section */}
      <TrackOrderToggle order={order} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Items List */}
        <div className="lg:col-span-8 bg-white border border-[var(--color-border)] rounded-sm p-6 sm:p-8 shadow-sm">
          <h3 className="font-black text-foreground mb-8 uppercase tracking-[0.2em] text-[11px] border-b border-primary/20 pb-4 inline-block">Order Summary</h3>
          <div className="divide-y divide-[var(--color-border)]">
            {(order.items as any[])?.map((item: any) => (
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
                  <p className="text-[16px] font-black text-foreground">EGP {item.total.toLocaleString()}</p>
                  <p className="text-[11px] text-foreground-muted font-bold uppercase tracking-wider">EGP {item.price.toLocaleString()} / unit</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Totals Breakdown */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white border border-[var(--color-border)] rounded-sm p-6 sm:p-8 shadow-sm">
            <h3 className="font-black text-foreground mb-6 uppercase tracking-[0.2em] text-[11px]">Payment Summary</h3>
            <div className="space-y-4">
              <div className="flex justify-between text-[14px] font-medium">
                <span className="text-foreground-muted">Subtotal</span>
                <span className="text-foreground font-bold">EGP {order.subtotal.toLocaleString()}</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-[14px] font-medium">
                  <span className="text-foreground-muted">Discount</span>
                  <span className="text-green-600 font-bold">-EGP {order.discount.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-[14px] font-medium">
                <span className="text-foreground-muted">Shipping</span>
                <span className="text-foreground font-bold">EGP {order.shipping_fee.toLocaleString()}</span>
              </div>
              {order.tax > 0 && (
                <div className="flex justify-between text-[14px] font-medium">
                  <span className="text-foreground-muted">Tax</span>
                  <span className="text-foreground font-bold">EGP {order.tax.toLocaleString()}</span>
                </div>
              )}
              <div className="pt-4 border-t-2 border-[var(--color-border)] flex justify-between items-end">
                <div>
                  <p className="text-[10px] font-black text-foreground-muted uppercase tracking-widest mb-1">Total to Pay</p>
                  <span className="font-black text-foreground text-sm uppercase tracking-tighter">FINAL AMOUNT</span>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black text-primary leading-none">
                    EGP {order.total.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 bg-primary/5 border border-primary/10 rounded-sm">
            <h4 className="text-[11px] font-black text-primary uppercase tracking-widest mb-2">Need Help?</h4>
            <p className="text-[12px] text-foreground-muted font-medium mb-4">If you have any questions regarding your order, please contact our support team.</p>
            <Link href={ROUTES.contact} className="text-[12px] font-black text-primary hover:underline uppercase tracking-widest">
              Contact Support →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}


