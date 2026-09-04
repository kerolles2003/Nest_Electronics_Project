import { requireAdmin, getAdminServices } from '@/lib/services';
import { DomainNotLiveNotice } from '@/components/system/DomainNotLiveNotice';
import { Suspense } from 'react';
import { CouponsTable } from '@/components/coupons/CouponsTable';

function CouponsSkeleton() {
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

export default async function CouponsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { supabase } = await getAdminServices();
  const sp = await props.searchParams;

  const page = Number(sp.page) || 1;
  const search = (sp.search as string) || '';
  const statusFilter = (sp.status as string) || '';
  const limit = 25;

  let query = (supabase as any)
    .from('coupons')
    .select('*', { count: 'exact' });

  if (search) {
    query = query.ilike('code', `%${search}%`);
  }
  if (statusFilter === 'active') {
    query = query.eq('is_active', true);
  } else if (statusFilter === 'inactive') {
    query = query.eq('is_active', false);
  } else if (statusFilter === 'expired') {
    query = query.lt('expires_at', new Date().toISOString());
  }

  const { data, count } = await query
    .range((page - 1) * limit, page * limit - 1)
    .order('created_at', { ascending: false });

  const coupons = (data ?? []) as Array<{
    id: string;
    code: string;
    type: string;
    value: number;
    min_order: number | null;
    max_discount: number | null;
    usage_limit: number | null;
    used_count: number | null;
    starts_at: string | null;
    expires_at: string | null;
    is_active: boolean | null;
  }>;

  const total = count ?? 0;
  const totalPages = Math.ceil(total / limit);

  /* Stats */
  const { count: totalCount } = await (supabase as any)
    .from('coupons')
    .select('*', { count: 'exact', head: true });

  const { count: activeCount } = await (supabase as any)
    .from('coupons')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  const { count: expiredCount } = await (supabase as any)
    .from('coupons')
    .select('*', { count: 'exact', head: true })
    .lt('expires_at', new Date().toISOString());

  const { data: usedData } = await (supabase as any)
    .from('coupons')
    .select('used_count');
  const totalUsed = (usedData ?? []).reduce((sum: number, c: any) => sum + (c.used_count ?? 0), 0);

  return (
    <div className="space-y-5">
      <DomainNotLiveNotice domain="coupons" />

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Coupons</h1>
        <p className="text-sm text-muted-foreground mt-1">Create and manage promotional coupon codes.</p>
      </div>

      <Suspense fallback={<CouponsSkeleton />}>
        <CouponsTable
          initialCoupons={coupons}
          currentPage={page}
          totalPages={totalPages}
          total={total}
          stats={{
            total: totalCount ?? 0,
            active: activeCount ?? 0,
            expired: expiredCount ?? 0,
            used: totalUsed,
          }}
        />
      </Suspense>
    </div>
  );
}
