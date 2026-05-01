'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Pagination, StatusBadge } from '@nest/ui';
import {
  Search, X, ClipboardList, User, Package, Tag, ShoppingCart, Settings,
  Filter, ChevronDown, Calendar, Loader2, Shield, FileText
} from 'lucide-react';

interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: any;
  created_at: string;
  profiles?: { full_name: string } | null;
}

interface AuditLogTableProps {
  initialLogs: AuditLog[];
  currentPage: number;
  totalPages: number;
  total: number;
  stats: {
    total: number;
    today: number;
    thisWeek: number;
  };
}

function formatDate(dateString: string) {
  const d = new Date(dateString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateString);
}

function getEntityIcon(type: string) {
  switch (type) {
    case 'product': return Package;
    case 'category': return Tag;
    case 'brand': return Tag;
    case 'order': return ShoppingCart;
    case 'coupon': return Tag;
    case 'review': return FileText;
    case 'settings': return Settings;
    default: return Shield;
  }
}

function formatAction(action: string) {
  return action.replace(/_/g, ' ').replace(/:/g, ' › ');
}

export function AuditLogTable({ initialLogs, currentPage, totalPages, total, stats }: AuditLogTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');

  const search = searchParams.get('search') || '';
  const entityFilter = searchParams.get('entity') || '';
  const hasFilters = search || entityFilter;

  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchInput) {
        params.set('search', searchInput);
      } else {
        params.delete('search');
      }
      params.set('page', '1');
      startTransition(() => {
        router.push(`/audit-log?${params.toString()}`);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, search, router, searchParams]);

  const updateQueryParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key !== 'page') params.set('page', '1');
    startTransition(() => {
      router.push(`/audit-log?${params.toString()}`);
    });
  };

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(page));
    startTransition(() => {
      router.push(`/audit-log?${params.toString()}`);
    });
  };

  const clearAllFilters = () => {
    startTransition(() => {
      router.push('/audit-log');
    });
  };

  const filterChips: { key: string; label: string }[] = [];
  if (search) filterChips.push({ key: 'search', label: `Search: "${search}"` });
  if (entityFilter) filterChips.push({ key: 'entity', label: `Entity: ${entityFilter}` });

  const statItems = [
    { label: 'Total Entries', value: stats.total, icon: ClipboardList, color: 'primary' as const },
    { label: 'Today', value: stats.today, icon: Calendar, color: 'success' as const },
    { label: 'This Week', value: stats.thisWeek, icon: Calendar, color: 'warning' as const },
  ];

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {statItems.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <div className={`rounded-lg p-1.5 bg-${item.color}/10`}>
                  <Icon className={`h-3.5 w-3.5 text-${item.color}`} />
                </div>
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{item.label}</p>
              <p className="text-lg font-bold tracking-tight text-foreground mt-0.5">{item.value.toLocaleString('en-EG')}</p>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by action or admin..."
              value={searchInput}
              className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/10 transition-all outline-none"
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs">
                <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground font-medium shrink-0 hidden sm:inline">Entity</span>
                <select
                  value={entityFilter}
                  onChange={(e) => updateQueryParam('entity', e.target.value)}
                  className="bg-transparent border-none focus:ring-0 cursor-pointer text-foreground font-semibold text-xs outline-none appearance-none pr-4 min-w-[80px]"
                >
                  <option value="">All Entities</option>
                  <option value="product">Product</option>
                  <option value="category">Category</option>
                  <option value="brand">Brand</option>
                  <option value="order">Order</option>
                  <option value="coupon">Coupon</option>
                  <option value="review">Review</option>
                  <option value="settings">Settings</option>
                </select>
                <ChevronDown className="h-3 w-3 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
            {hasFilters && (
              <button onClick={clearAllFilters} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        </div>
        {filterChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Active:</span>
            {filterChips.map(chip => (
              <button
                key={chip.key}
                onClick={() => updateQueryParam(chip.key, '')}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted transition-colors"
              >
                {chip.label}
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
        {isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating results...
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Action</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Entity</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Admin</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Details</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {initialLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-muted-foreground">
                        {hasFilters ? 'No entries match your filters' : 'No audit entries yet'}
                      </p>
                      <p className="text-xs text-muted-foreground/60">
                        {hasFilters ? 'Try adjusting your filters.' : 'Admin actions will be logged here.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                initialLogs.map((log) => {
                  const Icon = getEntityIcon(log.entity_type);
                  return (
                    <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-lg border border-border bg-muted flex items-center justify-center shrink-0">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground/50" />
                          </div>
                          <span className="text-xs font-bold text-foreground">{formatAction(log.action)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={log.entity_type} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 border border-border">
                            <User className="h-3 w-3 text-muted-foreground/50" />
                          </div>
                          <span className="text-xs font-semibold text-foreground">
                            {log.profiles?.full_name ?? 'System'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        {log.entity_id && (
                          <span className="text-[11px] font-mono text-muted-foreground">
                            {log.entity_id.slice(0, 8)}…
                          </span>
                        )}
                        {log.changes && (
                          <span className="text-[10px] text-muted-foreground/60 ml-2">
                            {JSON.stringify(log.changes).slice(0, 60)}
                            {JSON.stringify(log.changes).length > 60 ? '…' : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="text-[11px] text-muted-foreground">{formatRelativeTime(log.created_at)}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{initialLogs.length}</span> of <span className="font-semibold text-foreground">{total}</span> entries
          </span>
          {totalPages > 1 && (
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
          )}
        </div>
      </div>
    </div>
  );
}
