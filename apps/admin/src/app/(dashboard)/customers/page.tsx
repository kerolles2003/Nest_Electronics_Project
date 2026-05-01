import { requireAdmin, getAdminServices } from '@/lib/services';
import { Suspense } from 'react';
import { CustomersTable } from '@/components/customers/CustomersTable';

function CustomersSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 h-20" />
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card h-12" />
      <div className="rounded-xl border border-border bg-card h-96" />
    </div>
  );
}

export default async function CustomersPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { supabase } = await getAdminServices();
  const sp = await props.searchParams;

  const page = Number(sp.page) || 1;
  const search = (sp.search as string) || '';
  const limit = 25;

  let query = supabase
    .from('profiles')
    .select('id, full_name, phone, avatar_url, created_at', { count: 'exact' })
    .eq('role', 'customer');

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`);
  }

  const { data, count } = await query
    .range((page - 1) * limit, page * limit - 1)
    .order('created_at', { ascending: false });

  const customers = (data ?? []) as Array<{ id: string; full_name: string; phone: string | null; avatar_url: string | null; created_at: string }>;
  const total = count ?? 0;
  const totalPages = Math.ceil(total / limit);

  /* Order stats for current page customers */
  const userIds = customers.map(c => c.id);
  let orderMap: Record<string, { count: number; total: number }> = {};
  if (userIds.length > 0) {
    const { data: orders } = await supabase
      .from('orders')
      .select('user_id, total')
      .in('user_id', userIds)
      .not('order_status', 'in', '(cancelled,failed)');

    for (const o of (orders ?? []) as Array<{ user_id: string; total: number }>) {
      if (!orderMap[o.user_id]) orderMap[o.user_id] = { count: 0, total: 0 };
      orderMap[o.user_id].count++;
      orderMap[o.user_id].total += o.total ?? 0;
    }
  }

  /* Stats */
  const { count: totalCustomers } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'customer');

  const now = new Date();
  const startOfWeek = new Date(now.getTime() - 7 * 86400000).toISOString();
  const { count: newThisWeek } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'customer')
    .gte('created_at', startOfWeek);

  const { data: orderUsers } = await supabase
    .from('orders')
    .select('user_id')
    .not('order_status', 'in', '(cancelled,failed)');
  const uniqueUserIds = new Set(((orderUsers ?? []) as Array<{ user_id: string }>).map(o => o.user_id));
  const withOrders = uniqueUserIds.size;

  const { data: revenueRows } = await supabase
    .from('orders')
    .select('total')
    .eq('payment_status', 'paid')
    .not('order_status', 'in', '(cancelled,failed)');
  const totalRevenue = (revenueRows ?? []).reduce((sum: number, r: any) => sum + (r.total ?? 0), 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Customers</h1>
        <p className="text-sm text-muted-foreground mt-1">View customer accounts and their purchase activity.</p>
      </div>

      <Suspense fallback={<CustomersSkeleton />}>
        <CustomersTable
          initialCustomers={customers}
          orderMap={orderMap}
          currentPage={page}
          totalPages={totalPages}
          total={total}
          stats={{
            total: totalCustomers ?? 0,
            newThisWeek: newThisWeek ?? 0,
            withOrders,
            totalRevenue,
          }}
        />
      </Suspense>
    </div>
  );
}
