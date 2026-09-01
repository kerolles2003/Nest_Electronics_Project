import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { StatusBadge } from '@nest/ui';
import { Package, AlertTriangle, ArrowRight, PackageSearch, ShoppingBag } from 'lucide-react';
import { ROUTES } from '@nest/config/constants';

export const dynamic = 'force-dynamic';

const statusLabels: Record<string, string> = {
  pending_payment: 'Pending Payment',
  paid: 'Paid',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

export default async function OrdersPage() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return (
        <div className="min-h-[400px] flex flex-col items-center justify-center text-center p-8 bg-white border border-[var(--color-border)] rounded-sm shadow-sm">
          <div className="w-20 h-20 bg-primary/5 rounded-full flex items-center justify-center mb-6">
            <Package className="w-10 h-10 text-primary/40" strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-black text-foreground uppercase tracking-tight mb-2">Sign in Required</h2>
          <p className="text-foreground-muted max-w-xs font-medium mb-8">
            Please sign in to your account to view and track your orders.
          </p>
          <Link
            href={ROUTES.login}
            className="bg-primary text-white px-8 py-3 rounded-sm font-black uppercase tracking-widest text-[13px] hover:bg-primary-hover transition-all shadow-lg shadow-primary/20"
          >
            Sign In Now
          </Link>
        </div>
      );
    }

    const { data: orders } = await supabase
      .from('orders')
      .select('*, items:order_items(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!orders || orders.length === 0) {
      return (
        <div className="min-h-[400px] flex flex-col items-center justify-center text-center p-8 bg-white border border-[var(--color-border)] rounded-sm shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-12 opacity-[0.02] pointer-events-none">
            <PackageSearch className="w-64 h-64" />
          </div>
          <div className="w-24 h-24 bg-primary/5 rounded-full flex items-center justify-center mb-6 relative z-10">
            <ShoppingBag className="w-12 h-12 text-primary/40" strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-black text-foreground uppercase tracking-tight mb-2 relative z-10">No Orders Yet</h2>
          <p className="text-foreground-muted max-w-xs font-medium mb-8 relative z-10">
            It looks like you haven&apos;t placed any orders yet. Start exploring our latest products!
          </p>
          <Link
            href={ROUTES.products}
            className="bg-primary text-white px-10 py-4 rounded-sm font-black uppercase tracking-widest text-[13px] hover:bg-primary-hover transition-all shadow-xl shadow-primary/20 relative z-10 hover:-translate-y-0.5 active:translate-y-0"
          >
            Start Shopping
          </Link>
        </div>
      );
    }

    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[var(--color-border)] pb-6">
          <div>
            <h2 className="text-3xl font-black text-foreground uppercase tracking-tight">Order History</h2>
            <p className="text-[13px] text-foreground-muted mt-2 font-medium">
              Showing your <span className="text-foreground font-bold">{orders.length}</span> most recent orders
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-primary/40">
            <Package className="w-4 h-4" />
            Nest Secured Management
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {orders.map((order) => {
            const itemCount = Array.isArray(order.items) ? order.items.length : 0;
            const formattedDate = new Date(order.created_at).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            });

            return (
              <Link
                key={order.id}
                href={ROUTES.account.order(order.id)}
                className="group relative bg-white border border-[var(--color-border)] rounded-sm p-6 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5 transition-all"
              >
                <div className="flex flex-col lg:flex-row lg:items-center gap-6">
                  {/* Order ID & Date */}
                  <div className="lg:w-1/4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-black text-primary uppercase tracking-widest bg-primary/10 px-1.5 py-0.5 rounded-full">Order</span>
                      <p className="text-[15px] font-black text-foreground leading-none">#{order.order_number}</p>
                    </div>
                    <p className="text-xs text-foreground-muted font-bold uppercase tracking-wider mt-2">{formattedDate}</p>
                  </div>

                  {/* Status & Items */}
                  <div className="flex-1 flex flex-wrap items-center gap-x-12 gap-y-4">
                    <div className="min-w-[120px]">
                      <p className="text-[10px] font-black text-foreground-muted uppercase tracking-[0.2em] mb-2">Status</p>
                      <StatusBadge status={statusLabels[order.order_status] ?? order.order_status} className="text-[11px] px-3 py-1 font-black uppercase tracking-widest" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-foreground-muted uppercase tracking-[0.2em] mb-2">Items</p>
                      <p className="text-sm font-black text-foreground">{itemCount} {itemCount === 1 ? 'Product' : 'Products'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-foreground-muted uppercase tracking-[0.2em] mb-2">Total Amount</p>
                      <p className="text-[16px] font-black text-primary">EGP {order.total.toLocaleString()}</p>
                    </div>
                  </div>

                  {/* Action */}
                  <div className="lg:w-auto flex items-center justify-end lg:pl-6">
                    <div className="w-10 h-10 rounded-full bg-[var(--color-surface)] flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-all">
                      <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    );
  } catch (error) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center text-center p-8 bg-white border border-[var(--color-border)] rounded-sm shadow-sm">
        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mb-6">
          <AlertTriangle className="w-10 h-10 text-red-400" strokeWidth={1.5} />
        </div>
        <h2 className="text-2xl font-black text-foreground uppercase tracking-tight mb-2">Something went wrong</h2>
        <p className="text-foreground-muted max-w-xs font-medium mb-8">
          We couldn&apos;t load your order history. Please try refreshing the page.
        </p>
        <Link
          href={ROUTES.account.orders}
          className="bg-foreground text-white px-8 py-3 rounded-sm font-black uppercase tracking-widest text-[13px] hover:bg-black transition-all"
        >
          Try Again
        </Link>
      </div>
    );
  }
}

