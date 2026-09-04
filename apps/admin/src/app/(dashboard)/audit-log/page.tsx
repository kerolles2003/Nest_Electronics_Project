import { requireAdmin } from '@/lib/services';
import { Suspense } from 'react';
import { AuditLogTable } from '@/components/audit-log/AuditLogTable';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { AlertTriangle } from 'lucide-react';

/**
 * The audit trail, from the API.
 *
 * ## What this screen was showing until now
 *
 * Supabase `admin_audit_logs`: a table with **zero rows**, which can no longer
 * receive any — its `admin_id` has a foreign key to Supabase `profiles`, and
 * the acting admin has been an API account since Phase 6. So an empty audit log
 * was displayed while the real one filled up beside it, which is precisely the
 * legacy failure `AUDIT-MODEL.md` §4 records: an empty table that read as "no
 * admin activity yet" rather than "this subsystem is broken", looked at
 * sixty-one times in that state.
 *
 * The trail itself was never the problem. Every catalogue, inventory, order and
 * role change since Phase 4 is in `auditLogs`; what was missing was any way to
 * read it, and §8 specified the endpoint all along.
 */

function AuditSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-16 rounded-xl border border-border bg-card" />
      <div className="h-96 rounded-xl border border-border bg-card" />
    </div>
  );
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default async function AuditLogPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await props.searchParams;

  const page = Number(one(sp['page'])) || 1;

  const [logsRes, actionsRes] = await Promise.all([
    tryApi(() =>
      api.listAuditLogs({
        page,
        limit: 25,
        action: one(sp['action']),
        entityType: one(sp['entityType']),
        actorId: one(sp['actorId']),
      }),
    ),
    tryApi(() => api.auditActions()),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Audit log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every administrative action, with who did it and which fields changed. Append-only, kept
          for two years.
        </p>
      </div>

      {logsRes.ok ? (
        <Suspense fallback={<AuditSkeleton />}>
          <AuditLogTable
            logs={logsRes.data.data}
            actions={actionsRes.ok ? actionsRes.data.data : []}
            currentPage={logsRes.data.meta.page}
            totalPages={logsRes.data.meta.totalPages}
            total={logsRes.data.meta.total}
          />
        </Suspense>
      ) : (
        /*
         * An unreadable trail is stated as unreadable. An empty table here is
         * the exact shape of the failure this screen exists to have stopped
         * repeating.
         */
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive/70" />
          <h2 className="text-base font-bold text-foreground">The audit trail could not be read</h2>
          <p className="mt-1 text-sm text-muted-foreground">{operatorMessage(logsRes.error)}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            This is not the same as an empty log. Nothing has been lost — the records are written by
            the API and are still there.
          </p>
        </div>
      )}
    </div>
  );
}
