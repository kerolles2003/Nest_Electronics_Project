import { requireAdmin } from '@/lib/services';
import { Suspense } from 'react';
import { CustomersTable } from '@/components/customers/CustomersTable';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';

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
  const sp = await props.searchParams;

  const page = Number(sp.page) || 1;
  const search = (sp.search as string) || '';
  const limit = 25;

  const [customerRes, dashboardRes] = await Promise.all([
    tryApi(() => api.listCustomers({ page, limit, q: search })),
    tryApi(() => api.dashboardStats()),
  ]);

  const customerItems = customerRes.ok ? customerRes.data.data : [];
  const meta = customerRes.ok ? customerRes.data.meta : { total: 0, totalPages: 1 };

  const customers = customerItems.map((c) => ({
    id: c.id,
    full_name: c.fullName,
    phone: c.phone,
    avatar_url: null,
    created_at: c.createdAt,
  }));

  const orderMap: Record<string, { count: number; total: number }> = {};
  for (const c of customerItems) {
    orderMap[c.id] = { count: c.orderCount, total: c.totalSpent };
  }

  const dStats = dashboardRes.ok ? dashboardRes.data.data : null;
  const stats = {
    total: dStats?.customers.total ?? meta.total,
    newThisWeek: dStats?.customers.newThisWeek ?? 0,
    withOrders: dStats?.customers.withOrdersCount ?? 0,
    totalRevenue: dStats?.revenue.delivered.amount ?? 0,
  };

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
          totalPages={meta.totalPages}
          total={meta.total}
          stats={stats}
        />
      </Suspense>
    </div>
  );
}
