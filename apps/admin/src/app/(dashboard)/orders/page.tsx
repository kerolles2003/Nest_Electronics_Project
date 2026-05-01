import { requireAdmin, getAdminServices, getOrderStats } from '@/lib/services';
import { Suspense } from 'react';
import OrdersTable from '@/components/orders/OrdersTable';
import type { Order } from '@nest/types';

function OrdersSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div>
        <div className="h-8 w-32 bg-muted rounded-lg" />
        <div className="h-4 w-56 bg-muted rounded mt-2" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 h-20" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 h-16" />
        <div className="rounded-xl border border-border bg-card p-4 h-16" />
      </div>
      <div className="rounded-xl border border-border bg-card h-12" />
      <div className="rounded-xl border border-border bg-card h-96" />
    </div>
  );
}

function resolveDateRange(preset: string): { from?: string; to?: string } {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  switch (preset) {
    case 'today': {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      return { from, to };
    }
    case 'yesterday': {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const from = d.toISOString();
      const yto = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59).toISOString();
      return { from, to: yto };
    }
    case 'last7': {
      const from = new Date(now.getTime() - 7 * 86400000).toISOString();
      return { from, to };
    }
    case 'last30': {
      const from = new Date(now.getTime() - 30 * 86400000).toISOString();
      return { from, to };
    }
    case 'this_month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      return { from, to };
    }
    default:
      return {};
  }
}

export default async function OrdersPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { supabase } = await getAdminServices();
  const sp = await props.searchParams;

  const page = Number(sp.page) || 1;
  const search = (sp.search as string) || '';
  const statusFilter = (sp.status as string) || '';
  const paymentFilter = (sp.payment as string) || '';
  const fulfillmentFilter = (sp.fulfillment as string) || '';
  const datePreset = (sp.date as string) || '';
  const limit = 20;

  const stats = await getOrderStats();

  let dbQuery = supabase
    .from('orders')
    .select(
      'id, order_number, order_status, payment_status, fulfillment_status, total, payment_method, shipping_address, created_at, items:order_items(count)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false });

  if (statusFilter) {
    dbQuery = dbQuery.eq('order_status', statusFilter);
  }
  if (paymentFilter) {
    dbQuery = dbQuery.eq('payment_status', paymentFilter);
  }
  if (fulfillmentFilter) {
    dbQuery = dbQuery.eq('fulfillment_status', fulfillmentFilter);
  }
  if (datePreset) {
    const { from, to } = resolveDateRange(datePreset);
    if (from) dbQuery = dbQuery.gte('created_at', from);
    if (to) dbQuery = dbQuery.lte('created_at', to);
  }

  const { data, count, error } = await dbQuery.range((page - 1) * limit, page * limit - 1);

  if (error) {
    console.error('Orders query error:', error);
  }

  let orders = (data ?? []) as Order[];

  // Client-side search for order number / customer name / phone (Supabase text search on JSON is limited)
  if (search) {
    const q = search.toLowerCase();
    orders = orders.filter((o: Order) =>
      o.order_number?.toLowerCase().includes(q) ||
      (o.shipping_address as any)?.full_name?.toLowerCase().includes(q) ||
      (o.shipping_address as any)?.phone?.includes(q)
    );
  }

  const total = count ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Orders</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage and fulfill customer orders.</p>
      </div>

      <Suspense fallback={<OrdersSkeleton />}>
        <OrdersTable
          initialOrders={orders}
          currentPage={page}
          totalPages={totalPages}
          total={total}
          stats={stats}
        />
      </Suspense>
    </div>
  );
}
