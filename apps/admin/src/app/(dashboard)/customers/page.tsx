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

  /*
   * `formattedTotalSpent`, not `totalSpent`. The second is minor units — the
   * API's own description says so — and this map used to carry it into a cell
   * that printed `EGP {total}`, so every row showed a hundred times the real
   * figure. The server already formats it; taking the number instead was the
   * whole defect.
   */
  const orderMap: Record<string, { count: number; spent: string }> = {};
  for (const c of customerItems) {
    orderMap[c.id] = { count: c.orderCount, spent: c.formattedTotalSpent };
  }

  const dStats = dashboardRes.ok ? dashboardRes.data.data : null;

  /*
   * Two of these come from the dashboard aggregate and are therefore bounded by
   * its trailing window — 30 days by default. `withOrdersCount` becomes
   * "customers who ordered recently" rather than "who have ever ordered", and
   * the revenue figure is the same window's. Both carry the server's own label
   * into the card rather than being presented as lifetime totals.
   *
   * The revenue string is the server's `formatted`, not its `amount`. `amount`
   * is in piastres, and this screen used to print it with an "EGP" in front —
   * a card reading "EGP 5,000" for fifty pounds.
   */
  const stats = {
    total: dStats?.customers.total ?? meta.total,
    newThisWeek: dStats?.customers.newThisWeek ?? 0,
    withOrders: dStats?.customers.withOrdersCount ?? 0,
    revenueFormatted: dStats?.revenue.delivered.formatted ?? '—',
    windowLabel: dStats?.window.label ?? null,
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
