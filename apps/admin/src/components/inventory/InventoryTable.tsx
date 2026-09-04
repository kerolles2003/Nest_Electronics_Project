'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Pagination } from '@nest/ui';
import { InventoryAdjustDialog } from './InventoryAdjustDialog';
import { InventoryHistoryDrawer } from './InventoryHistoryDrawer';
import type { AdminCategory, StockLevel } from '@/lib/api/types';
import {
  Search, X, AlertTriangle, Package, CheckCircle2, Archive,
  Boxes, Filter, Loader2, ChevronDown, RefreshCcw, History, EyeOff,
} from 'lucide-react';

/**
 * The stock work list, on the API.
 *
 * ## Why there is no sort control
 *
 * `GET /admin/inventory` orders by `onHand` ascending and offers no
 * alternative, deliberately: the list exists to be acted on, and what runs out
 * next belongs at the top. A console control that cannot be honoured is worse
 * than its absence.
 *
 * ## Why the filters are the ones they are
 *
 * Search, category subtree, low-stock, out-of-stock, and show-inactive. That is
 * the whole of what the endpoint accepts. The brand dropdown that used to sit
 * here is gone rather than left in place doing nothing.
 *
 * ## Reserved and Available are gone
 *
 * The API's stock is one number, `onHand`. There is no reservation in the
 * model, so those two columns were describing a mechanism that does not exist —
 * one of them always equal to zero and the other always equal to `onHand`.
 */

interface InventoryTableProps {
  levels: StockLevel[];
  categories: AdminCategory[];
  currentPage: number;
  totalPages: number;
  total: number;
  /** `null` when the aggregate could not be read. Rendered as em dashes. */
  stats: {
    total: number;
    inStock: number;
    lowStock: number;
    outOfStock: number;
  } | null;
}

const STATE_STYLE: Record<StockLevel['state'], { label: string; chip: string; value: string }> = {
  IN_STOCK: {
    label: 'In stock',
    chip: 'bg-success/10 text-success border-success/20',
    value: 'text-success',
  },
  LOW_STOCK: {
    label: 'Low stock',
    chip: 'bg-warning/10 text-warning border-warning/20',
    value: 'text-warning',
  },
  OUT_OF_STOCK: {
    label: 'Out of stock',
    chip: 'bg-destructive/10 text-destructive border-destructive/20',
    value: 'text-destructive',
  },
};

export function InventoryTable({
  levels,
  categories,
  currentPage,
  totalPages,
  total,
  stats,
}: InventoryTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [adjusting, setAdjusting] = useState<StockLevel | null>(null);
  const [viewingHistory, setViewingHistory] = useState<StockLevel | null>(null);
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = searchParams.get('search') ?? '';
  const categoryId = searchParams.get('category') ?? '';
  const stockFilter = searchParams.get('stock') ?? '';
  const includeInactive = searchParams.get('inactive') === 'true';
  const hasFilters = search !== '' || categoryId !== '' || stockFilter !== '' || includeInactive;

  useEffect(() => {
    if (searchInput === search) return;
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchInput !== '') params.set('search', searchInput);
      else params.delete('search');
      params.set('page', '1');
      startTransition(() => {
        router.push(`/inventory?${params.toString()}`);
      });
    }, 350);

    return () => clearTimeout(searchDebounceRef.current);
  }, [searchInput, search, router, searchParams]);

  const updateQueryParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value !== '') params.set(key, value);
    else params.delete(key);
    if (key !== 'page') params.set('page', '1');
    startTransition(() => {
      router.push(`/inventory?${params.toString()}`);
    });
  };

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(page));
    startTransition(() => {
      router.push(`/inventory?${params.toString()}`);
    });
  };

  const clearAllFilters = () => {
    startTransition(() => {
      router.push('/inventory');
    });
  };

  /*
   * After an adjustment the server data is stale. `router.refresh()` re-runs the
   * page's own fetch rather than patching a number into local state — the row
   * an operator reads next must be the row the API would hand them, not this
   * component's guess at it.
   */
  const onAdjusted = () => {
    setAdjusting(null);
    startTransition(() => {
      router.refresh();
    });
  };

  const categoryOptions = [
    { value: '', label: 'All categories' },
    ...categories.map((category) => ({
      value: category.id,
      // Depth as indentation: the list is flat and shallowest-first, so a
      // prefix is what makes a subtree readable in a <select>.
      label: `${'— '.repeat(category.depth)}${category.name.en}`,
    })),
  ];

  const chips: { key: string; label: string; value: string }[] = [];
  if (search !== '') chips.push({ key: 'search', label: `Search: "${search}"`, value: '' });
  if (categoryId !== '') {
    const name = categories.find((c) => c.id === categoryId)?.name.en ?? categoryId;
    chips.push({ key: 'category', label: `Category: ${name}`, value: '' });
  }
  if (stockFilter !== '') {
    chips.push({
      key: 'stock',
      label: stockFilter === 'low_stock' ? 'Low stock only' : 'Out of stock only',
      value: '',
    });
  }
  if (includeInactive) chips.push({ key: 'inactive', label: 'Including unpublished', value: '' });

  return (
    <div className="space-y-5">
      <StatsStrip
        stats={stats}
        activeFilter={stockFilter}
        onFilterClick={(value) => updateQueryParam('stock', value)}
        onClear={clearAllFilters}
      />

      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name or SKU..."
              value={searchInput}
              className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/10 transition-all outline-none"
              onChange={(event) => setSearchInput(event.target.value)}
            />
            {searchInput !== '' && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <FilterDropdown
              label="Category"
              value={categoryId}
              options={categoryOptions}
              onChange={(value) => updateQueryParam('category', value)}
            />
            <FilterDropdown
              label="Stock"
              value={stockFilter}
              options={[
                { value: '', label: 'All stock' },
                { value: 'low_stock', label: 'Low stock' },
                { value: 'out_of_stock', label: 'Out of stock' },
              ]}
              onChange={(value) => updateQueryParam('stock', value)}
            />
            <button
              type="button"
              onClick={() => updateQueryParam('inactive', includeInactive ? '' : 'true')}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
                includeInactive
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title="Unpublished products are hidden by default: a draft is not something anybody is about to run out of."
            >
              <EyeOff className="h-3.5 w-3.5" />
              Unpublished
            </button>
            {hasFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
              >
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Active:
            </span>
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => updateQueryParam(chip.key, chip.value)}
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
        {levels.length === 0 ? (
          <div className="p-12 text-center">
            <Archive className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <h3 className="text-base font-bold text-foreground">No products match</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              {hasFilters
                ? 'Nothing in the catalogue matches these filters.'
                : 'The catalogue has no products yet.'}
            </p>
            {hasFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted transition-all"
              >
                <X className="h-4 w-4" />
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Product</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Category</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">On hand</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Reorder at</th>
                    <th className="px-4 py-3 text-center text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {levels.map((level) => {
                    const style = STATE_STYLE[level.state];

                    return (
                      <tr key={level.productId} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 min-w-[200px]">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/products/${level.productId}/edit`}
                                className="text-sm font-semibold text-foreground hover:text-primary transition-colors truncate max-w-[240px]"
                                title={level.name}
                              >
                                {level.name}
                              </Link>
                              {!level.isActive && (
                                <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-[1px] text-[10px] font-bold text-muted-foreground">
                                  Unpublished
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] font-mono text-muted-foreground">{level.sku}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-muted-foreground truncate max-w-[140px] block">
                            {level.categoryName}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-sm font-bold tabular-nums ${style.value}`}>
                            {level.onHand}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {level.lowStockThreshold}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {/*
                            The SERVER's `state`, never re-derived from onHand
                            and the threshold here. That re-derivation in five
                            places is how legacy got five different answers.
                          */}
                          <span className={`inline-flex items-center rounded-full border px-2 py-[2px] text-[10px] font-bold ${style.chip}`}>
                            {style.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setViewingHistory(level)}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              title="Movement history"
                            >
                              <History className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setAdjusting(level)}
                              className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/20 transition-colors"
                            >
                              <RefreshCcw className="h-3 w-3" />
                              Adjust
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-3 border-t border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{levels.length}</span> of{' '}
                <span className="font-semibold text-foreground">{total}</span> products
              </span>
              {totalPages > 1 && (
                <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
              )}
            </div>
          </>
        )}
      </div>

      {adjusting && (
        <InventoryAdjustDialog
          level={adjusting}
          onClose={() => setAdjusting(null)}
          onAdjusted={onAdjusted}
        />
      )}

      {viewingHistory && (
        <InventoryHistoryDrawer level={viewingHistory} onClose={() => setViewingHistory(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stats strip                                                        */
/* ------------------------------------------------------------------ */

/**
 * Counts over ACTIVE products, from the dashboard aggregate.
 *
 * Labelled as such, and deliberately not recomputed to follow the "include
 * unpublished" toggle: a counter that silently changes population when a
 * filter moves is a counter nobody can reason about. The list widens; the
 * counters keep saying what they counted.
 */
function StatsStrip({
  stats,
  activeFilter,
  onFilterClick,
  onClear,
}: {
  stats: InventoryTableProps['stats'];
  activeFilter: string;
  onFilterClick: (value: string) => void;
  onClear: () => void;
}) {
  const show = (value: number | undefined) =>
    value === undefined ? '—' : value.toLocaleString('en-EG');

  const items = [
    { label: 'Active products', value: stats?.total, icon: Boxes, color: 'primary', active: activeFilter === '', onClick: onClear },
    { label: 'In stock', value: stats?.inStock, icon: CheckCircle2, color: 'success', active: false, onClick: onClear },
    { label: 'Low stock', value: stats?.lowStock, icon: AlertTriangle, color: 'warning', active: activeFilter === 'low_stock', onClick: () => onFilterClick('low_stock') },
    { label: 'Out of stock', value: stats?.outOfStock, icon: Package, color: 'destructive', active: activeFilter === 'out_of_stock', onClick: () => onFilterClick('out_of_stock') },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className={`relative overflow-hidden rounded-xl border ${
              item.active ? 'border-primary ring-1 ring-primary/30' : 'border-border'
            } bg-card p-3 text-left transition-all hover:shadow-md`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`rounded-lg p-1.5 bg-${item.color}/10`}>
                <Icon className={`h-3.5 w-3.5 text-${item.color}`} />
              </div>
              {item.active && (
                <span className={`text-[10px] font-bold px-1.5 py-[2px] rounded-full bg-${item.color}/10 text-${item.color}`}>
                  Active
                </span>
              )}
            </div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{item.label}</p>
            <p className="text-lg font-bold tracking-tight text-foreground mt-0.5">{show(item.value)}</p>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Filter dropdown                                                    */
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
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className="bg-transparent border-none focus:ring-0 cursor-pointer text-foreground font-semibold text-xs outline-none appearance-none pr-4 min-w-[80px]"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="h-3 w-3 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
    </div>
  );
}
