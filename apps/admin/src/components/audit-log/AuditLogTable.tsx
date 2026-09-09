'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Pagination } from '@nest/ui';
import type { AuditLogEntry } from '@/lib/api/types';
import { Filter, ChevronDown, Loader2, Shield, X, ChevronRight, User, Globe } from 'lucide-react';

/**
 * The audit trail, from the API.
 *
 * ## What it used to show
 *
 * Supabase `admin_audit_logs`: a table with **zero rows**, which can no longer
 * receive any — its `admin_id` has a foreign key to Supabase `profiles`, and
 * the acting admin is an API account. So this screen displayed an empty audit
 * log while the real trail filled up beside it, which is the legacy failure
 * (`AUDIT-MODEL.md` §4: "read sixty-one times in that state") reproduced by a
 * different mechanism.
 *
 * ## Three things it deliberately does not do
 *
 * **No text search.** The old toolbar had one — `action.ilike.%…%` joined to
 * `profiles`. No index answers an unanchored pattern, so it would be a
 * collection scan over two years of records on a screen an operator types into,
 * and nobody discovered that because the table was empty. The filters offered
 * here are the four §8 names, each served by a frozen index.
 *
 * **No stat tiles.** The old header showed total / today / this week, each its
 * own `count: exact` query. Three extra aggregate reads to decorate a log that
 * is read to answer a specific question — "what did this person do", "what
 * happened to this order" — is a cost with no reader.
 *
 * **No edit and no delete.** There is no route to call. The trail is
 * append-only and a two-year TTL is the only thing that removes a record: an
 * audit trail somebody can edit is not an audit trail.
 *
 * ## The changes column is the point
 *
 * `{ before, after }` per field, never whole documents. It is collapsed by
 * default because most rows are read for *who and when*, and expanded on demand
 * because the ones that are read for *what* are the ones that matter.
 */

interface AuditLogTableProps {
  logs: AuditLogEntry[];
  actions: string[];
  currentPage: number;
  totalPages: number;
  total: number;
}

/** `PRODUCT_PRICE_CHANGED` → `Product price changed`. */
function humanise(action: string): string {
  const words = action.toLowerCase().split('_');
  const first = words[0] ?? '';

  return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(' ');
}

/**
 * Colour by CONSEQUENCE, not by entity.
 *
 * An operator scanning this page is looking for the destructive and the
 * authorization-changing rows; making every product action one colour and every
 * order action another would bury both.
 */
function tone(action: string): string {
  if (action.includes('DELETED') || action.includes('CANCELLED')) {
    return 'border-destructive/20 bg-destructive/10 text-destructive';
  }
  if (action.includes('ROLE') || action.includes('RESTORED')) {
    return 'border-warning/20 bg-warning/10 text-warning';
  }
  if (action.includes('CREATED') || action.includes('PUBLISHED')) {
    return 'border-success/20 bg-success/10 text-success';
  }

  return 'border-primary/20 bg-primary/10 text-primary';
}

function when(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AuditLogTable({ logs, actions, currentPage, totalPages, total }: AuditLogTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);

  const action = searchParams.get('action') ?? '';
  const entityType = searchParams.get('entityType') ?? '';
  const actorId = searchParams.get('actorId') ?? '';
  const hasFilters = action !== '' || entityType !== '' || actorId !== '';

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value !== '') params.set(key, value);
    else params.delete(key);
    params.set('page', '1');
    startTransition(() => {
      router.push(`/audit-log?${params.toString()}`);
    });
  };

  const entityTypes = [...new Set(logs.map((log) => log.entity.type))].sort((a, b) =>
    a.localeCompare(b),
  );

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            label="Action"
            value={action}
            options={[
              { value: '', label: 'Every action' },
              ...actions.map((value) => ({ value, label: humanise(value) })),
            ]}
            onChange={(value) => setParam('action', value)}
          />
          <Dropdown
            label="Entity"
            value={entityType}
            options={[
              { value: '', label: 'Every entity' },
              ...entityTypes.map((value) => ({ value, label: humanise(value) })),
            ]}
            onChange={(value) => setParam('entityType', value)}
          />
          {actorId !== '' && (
            <button
              type="button"
              onClick={() => setParam('actorId', '')}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted"
            >
              One person only
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                startTransition(() => {
                  router.push('/audit-log');
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          {/*
            Said rather than left to be discovered by an operator typing into a
            search box that is not there.
          */}
          Filtered by action, entity and person — each served by an index. There is no free-text
          search: no index answers one, and it would read two years of records per keystroke.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {logs.length === 0 ? (
          <div className="p-12 text-center">
            <Shield className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <h3 className="text-base font-bold text-foreground">
              <span data-testid="audit-empty">
                {hasFilters ? 'Nothing matches these filters' : 'Nothing recorded yet'}
              </span>
            </h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {hasFilters
                ? 'The trail has no entries for this combination.'
                : 'Every administrative action is recorded here as it happens.'}
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {logs.map((log) => {
                const open = expanded === log.id;

                return (
                  <li
                    key={log.id}
                    data-testid="audit-entry"
                    data-action={log.action}
                    data-entity-type={log.entity.type}
                    className="px-4 py-3 transition-colors hover:bg-muted/20"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            data-testid="audit-action"
                            className={`rounded-full border px-1.5 py-[2px] text-[10px] font-bold ${tone(log.action)}`}
                          >
                            {humanise(log.action)}
                          </span>
                          <span data-testid="audit-entity" className="text-sm font-semibold text-foreground">
                            {log.entity.label}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {log.entity.type}
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                          <button
                            type="button"
                            onClick={() => setParam('actorId', log.actor.id)}
                            className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                            title="Everything this person did"
                          >
                            <User className="h-3 w-3" />
                            <span data-testid="audit-actor">{log.actor.name}</span>
                            <span className="text-muted-foreground/60">({log.actor.role})</span>
                          </button>
                          {log.ip !== null && (
                            <span className="inline-flex items-center gap-1 font-mono">
                              <Globe className="h-3 w-3" />
                              {log.ip}
                            </span>
                          )}
                          <span>{when(log.createdAt)}</span>
                        </div>
                      </div>

                      {(log.changes !== null || log.metadata !== null) && (
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : log.id)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
                          {open ? 'Hide' : 'What changed'}
                        </button>
                      )}
                    </div>

                    {open && (
                      <div className="mt-2 space-y-2 rounded-lg border border-border bg-background p-3">
                        {log.changes !== null && (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <ChangeSide title="Before" values={log.changes.before} />
                            <ChangeSide title="After" values={log.changes.after} />
                          </div>
                        )}
                        {log.metadata !== null && (
                          <div>
                            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Context
                            </p>
                            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-foreground">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </div>
                        )}
                        <p className="font-mono text-[10px] text-muted-foreground/70">
                          {/* The one field that ties this row to a server log line. */}
                          request {log.requestId}
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-3">
              <span className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{logs.length}</span> of{' '}
                <span className="font-semibold text-foreground">{total}</span> records
              </span>
              {totalPages > 1 && (
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={(page) => {
                    const params = new URLSearchParams(searchParams.toString());
                    params.set('page', String(page));
                    startTransition(() => {
                      router.push(`/audit-log?${params.toString()}`);
                    });
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Records are kept for two years and cannot be edited or deleted — there is no route to do
        either. <Link href="/settings" className="hover:text-primary hover:underline">Settings</Link>
      </p>
    </div>
  );
}

function ChangeSide({ title, values }: { title: string; values: Record<string, unknown> }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <dl className="space-y-0.5">
        {Object.entries(values).map(([key, value]) => (
          <div key={key} className="flex gap-2 text-[11px]">
            <dt className="shrink-0 font-mono text-muted-foreground">{key}</dt>
            <dd className="min-w-0 break-words text-foreground">{JSON.stringify(value)}</dd>
          </div>
        ))}
        {Object.keys(values).length === 0 && (
          <span className="text-[11px] text-muted-foreground/60">—</span>
        )}
      </dl>
    </div>
  );
}

function Dropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs">
        <Filter className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="hidden shrink-0 font-medium text-muted-foreground sm:inline">{label}</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className="min-w-[110px] appearance-none border-none bg-transparent pr-4 text-xs font-semibold text-foreground outline-none focus:ring-0"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}
