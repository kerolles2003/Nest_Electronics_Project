import { requireAdmin, getAdminServices } from '@/lib/services';
import { Suspense } from 'react';
import { AuditLogTable } from '@/components/audit-log/AuditLogTable';

function AuditSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 h-20" />
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card h-12" />
      <div className="rounded-xl border border-border bg-card h-96" />
    </div>
  );
}

export default async function AuditLogPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { supabase } = await getAdminServices();
  const sp = await props.searchParams;

  const page = Number(sp.page) || 1;
  const search = (sp.search as string) || '';
  const entityFilter = (sp.entity as string) || '';
  const limit = 25;

  let query = (supabase as any)
    .from('admin_audit_logs')
    .select('*, profiles(full_name)', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (search) {
    query = query.or(`action.ilike.%${search}%,profiles.full_name.ilike.%${search}%`);
  }
  if (entityFilter) {
    query = query.eq('entity_type', entityFilter);
  }

  const { data, count } = await query
    .range((page - 1) * limit, page * limit - 1);

  const logs = (data ?? []) as Array<{
    id: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    changes: any;
    created_at: string;
    profiles?: { full_name: string } | null;
  }>;

  const total = count ?? 0;
  const totalPages = Math.ceil(total / limit);

  /* Stats */
  const { count: totalCount } = await (supabase as any)
    .from('admin_audit_logs')
    .select('*', { count: 'exact', head: true });

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfWeek = new Date(now.getTime() - 7 * 86400000).toISOString();

  const { count: todayCount } = await (supabase as any)
    .from('admin_audit_logs')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfToday);

  const { count: weekCount } = await (supabase as any)
    .from('admin_audit_logs')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfWeek);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">View a complete history of admin actions across the system.</p>
      </div>

      <Suspense fallback={<AuditSkeleton />}>
        <AuditLogTable
          initialLogs={logs}
          currentPage={page}
          totalPages={totalPages}
          total={total}
          stats={{
            total: totalCount ?? 0,
            today: todayCount ?? 0,
            thisWeek: weekCount ?? 0,
          }}
        />
      </Suspense>
    </div>
  );
}
