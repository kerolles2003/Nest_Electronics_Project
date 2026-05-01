'use client';

import { useState, useTransition, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Pagination, StatusBadge } from '@nest/ui';
import Link from 'next/link';
import type { Order } from '@nest/types';
import {
  Search, X, Package, CreditCard, Truck, CheckCircle2,
  Clock, AlertTriangle, ShoppingBag, Calendar, ArrowUpRight,
  Filter, Loader2, ChevronDown, Ban
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OrdersTableProps {
  initialOrders: Order[];
  currentPage: number;
  totalPages: number;
  total: number;
  stats: {
    total: number;
    pendingPayment: number;
    paid: number;
    processing: number;
    shipped: number;
    delivered: number;
    cancelled: number;
    todayRevenue: number;
    weekRevenue: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCurrency(value: number) {
  return `EGP ${value.toLocaleString('en-EG')}`;
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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const DATE_PRESETS = [
  { value: '', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 Days' },
  { value: 'last30', label: 'Last 30 Days' },
  { value: 'this_month', label: 'This Month' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function OrdersTable({
  initialOrders,
  currentPage,
  totalPages,
  total,
  stats,
}: OrdersTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [orders] = useState(initialOrders);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [initialOrders]);

  const search = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status') || '';
  const paymentFilter = searchParams.get('payment') || '';
  const fulfillmentFilter = searchParams.get('fulfillment') || '';
  const datePreset = searchParams.get('date') || '';
  const hasFilters = search || statusFilter || paymentFilter || fulfillmentFilter || datePreset;

  /* debounced search */
  useEffect(() => {
    if (searchInput === search) return;
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchInput) {
        params.set('search', searchInput);
      } else {
        params.delete('search');
      }
      params.set('page', '1');
      startTransition(() => {
        router.push(`/orders?${params.toString()}`);
      });
    }, 350);
    return () => clearTimeout(searchDebounceRef.current);
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
      router.push(`/orders?${params.toString()}`);
    });
  };

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(page));
    startTransition(() => {
      router.push(`/orders?${params.toString()}`);
    });
  };

  const clearAllFilters = () => {
    startTransition(() => {
      router.push('/orders');
    });
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === orders.length && orders.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(orders.map(o => o.id)));
    }
  };

  /* ---- filter chips ---------------------------------------------- */
  const filterChips: { key: string; label: string }[] = [];
  if (search) filterChips.push({ key: 'search', label: `Search: "${search}"` });
  if (statusFilter) filterChips.push({ key: 'status', label: `Order: ${statusFilter.replace(/_/g, ' ')}` });
  if (paymentFilter) filterChips.push({ key: 'payment', label: `Payment: ${paymentFilter}` });
  if (fulfillmentFilter) filterChips.push({ key: 'fulfillment', label: `Fulfillment: ${fulfillmentFilter}` });
  if (datePreset) {
    const preset = DATE_PRESETS.find(p => p.value === datePreset);
    filterChips.push({ key: 'date', label: `Date: ${preset?.label || datePreset}` });
  }

  /* ---- empty state ----------------------------------------------- */
  if (orders.length === 0 && !hasFilters) {
    return (
      <div className="space-y-5">
        <StatsStrip stats={stats} activeFilter={statusFilter} onFilterClick={(val) => updateQueryParam('status', val)} onClear={clearAllFilters} />
        <div className="rounded-xl border-2 border-dashed border-border bg-card p-16 text-center">
          <Package className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-base font-bold text-foreground">No orders yet</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            When customers start placing orders, they will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stats Strip */}
      <StatsStrip stats={stats} activeFilter={statusFilter} onFilterClick={(val) => updateQueryParam('status', val)} onClear={clearAllFilters} />

      {/* Revenue Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="rounded-lg p-2 bg-success/10">
            <CreditCard className="h-4 w-4 text-success" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Today&apos;s Revenue</p>
            <p className="text-lg font-bold text-foreground">{formatCurrency(stats.todayRevenue)}</p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="rounded-lg p-2 bg-primary/10">
            <ShoppingBag className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">This Week</p>
            <p className="text-lg font-bold text-foreground">{formatCurrency(stats.weekRevenue)}</p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by order number, customer, or phone..."
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
            <FilterDropdown
              label="Order"
              value={statusFilter}
              options={[
                { value: '', label: 'All Orders' },
                { value: 'pending_payment', label: 'Pending Payment' },
                { value: 'paid', label: 'Paid' },
                { value: 'processing', label: 'Processing' },
                { value: 'shipped', label: 'Shipped' },
                { value: 'delivered', label: 'Delivered' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
              onChange={(v) => updateQueryParam('status', v)}
            />
            <FilterDropdown
              label="Payment"
              value={paymentFilter}
              options={[
                { value: '', label: 'All Payments' },
                { value: 'pending', label: 'Pending' },
                { value: 'paid', label: 'Paid' },
                { value: 'failed', label: 'Failed' },
                { value: 'refunded', label: 'Refunded' },
              ]}
              onChange={(v) => updateQueryParam('payment', v)}
            />
            <FilterDropdown
              label="Fulfillment"
              value={fulfillmentFilter}
              options={[
                { value: '', label: 'All Fulfillment' },
                { value: 'unfulfilled', label: 'Unfulfilled' },
                { value: 'processing', label: 'Processing' },
                { value: 'shipped', label: 'Shipped' },
                { value: 'delivered', label: 'Delivered' },
              ]}
              onChange={(v) => updateQueryParam('fulfillment', v)}
            />
            <FilterDropdown
              label="Date"
              value={datePreset}
              options={DATE_PRESETS}
              onChange={(v) => updateQueryParam('date', v)}
            />
            {hasFilters && (
              <button
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
              >
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
                <th className="px-5 py-3 text-left w-10">
                  <input type="checkbox" className="h-4 w-4 rounded border-border" checked={selectedIds.size === orders.length && orders.length > 0} onChange={toggleAll} />
                </th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Order</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Customer</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Order</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Payment</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Fulfillment</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((order) => {
                const isSelected = selectedIds.has(order.id);
                return (
                  <tr key={order.id} className={`hover:bg-muted/20 transition-colors group ${isSelected ? 'bg-primary/5' : ''}`}>
                    <td className="px-5 py-3">
                      <input type="checkbox" className="h-4 w-4 rounded border-border" checked={isSelected} onChange={() => toggleSelection(order.id)} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-col gap-0.5">
                        <Link href={`/orders/${order.id}`} className="font-mono text-[11px] font-bold text-primary hover:underline">
                          #{order.order_number}
                        </Link>
                        <span className="text-[10px] text-muted-foreground">{formatRelativeTime(order.created_at)}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-semibold text-foreground">
                          {(order.shipping_address as any)?.full_name || '—'}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">{(order.shipping_address as any)?.phone || '—'}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-foreground tabular-nums">
                          {order.total.toLocaleString('en-EG')}
                          <span className="text-[10px] font-normal text-muted-foreground ml-1">EGP</span>
                        </span>
                        <span className="text-[10px] text-muted-foreground uppercase">{order.payment_method}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={order.order_status} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={order.payment_status} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={order.fulfillment_status} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/orders/${order.id}`}
                        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold bg-muted/50 text-foreground hover:bg-primary hover:text-primary-foreground transition-all"
                      >
                        Manage
                        <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-muted-foreground">No orders match your criteria</p>
                      <button onClick={clearAllFilters} className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted transition-all">
                        <X className="h-3.5 w-3.5" /> Clear filters
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{orders.length}</span> of <span className="font-semibold text-foreground">{total}</span> orders
          </span>
          {totalPages > 1 && (
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stats Strip                                                        */
/* ------------------------------------------------------------------ */

function StatsStrip({
  stats,
  activeFilter,
  onFilterClick,
  onClear,
}: {
  stats: OrdersTableProps['stats'];
  activeFilter: string;
  onFilterClick: (value: string) => void;
  onClear: () => void;
}) {
  const items = [
    { label: 'Total', value: stats.total, icon: Package, color: 'primary' as const, filter: '', active: !activeFilter, onClick: onClear },
    { label: 'Pending', value: stats.pendingPayment, icon: Clock, color: 'warning' as const, filter: 'pending_payment', active: activeFilter === 'pending_payment', onClick: () => onFilterClick('pending_payment') },
    { label: 'Paid', value: stats.paid, icon: CheckCircle2, color: 'success' as const, filter: 'paid', active: activeFilter === 'paid', onClick: () => onFilterClick('paid') },
    { label: 'Processing', value: stats.processing, icon: ShoppingBag, color: 'primary' as const, filter: 'processing', active: activeFilter === 'processing', onClick: () => onFilterClick('processing') },
    { label: 'Shipped', value: stats.shipped, icon: Truck, color: 'primary' as const, filter: 'shipped', active: activeFilter === 'shipped', onClick: () => onFilterClick('shipped') },
    { label: 'Delivered', value: stats.delivered, icon: CheckCircle2, color: 'success' as const, filter: 'delivered', active: activeFilter === 'delivered', onClick: () => onFilterClick('delivered') },
    { label: 'Cancelled', value: stats.cancelled, icon: Ban, color: 'destructive' as const, filter: 'cancelled', active: activeFilter === 'cancelled', onClick: () => onFilterClick('cancelled') },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            onClick={item.onClick}
            className={`relative overflow-hidden rounded-xl border ${item.active ? 'border-primary ring-1 ring-primary/30' : 'border-border'} bg-card p-3 text-left transition-all hover:shadow-md`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`rounded-lg p-1.5 bg-${item.color}/10`}>
                <Icon className={`h-3.5 w-3.5 text-${item.color}`} />
              </div>
              {item.active && (
                <span className={`text-[10px] font-bold px-1.5 py-[2px] rounded-full bg-${item.color}/10 text-${item.color}`}>Active</span>
              )}
            </div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{item.label}</p>
            <p className="text-lg font-bold tracking-tight text-foreground mt-0.5">{item.value.toLocaleString('en-EG')}</p>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Filter Dropdown                                                    */
/* ------------------------------------------------------------------ */

function FilterDropdown({
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
        <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground font-medium shrink-0 hidden sm:inline">{label}</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-transparent border-none focus:ring-0 cursor-pointer text-foreground font-semibold text-xs outline-none appearance-none pr-4 min-w-[80px]"
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <ChevronDown className="h-3 w-3 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
    </div>
  );
}
