'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Pagination, StatusBadge } from '@nest/ui';
import { InventoryAdjustDialog } from './InventoryAdjustDialog';
import { InventoryTransactionDrawer } from './InventoryTransactionDrawer';
import type { Product, Category, Brand } from '@nest/types';
import {
  Search, X, AlertTriangle, Package, CheckCircle2, Archive,
  Boxes, ArrowUpRight, Filter, Loader2, ChevronDown, Box,
  Minus, Plus, Activity, Tag, RefreshCcw, History
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface InventoryTableProps {
  initialProducts: Product[];
  categories: Category[];
  brands: Brand[];
  currentPage: number;
  totalPages: number;
  total: number;
  stats: {
    total: number;
    inStock: number;
    lowStock: number;
    outOfStock: number;
    totalReserved: number;
  };
  recentActivity: any[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getStockState(product: Product) {
  const threshold = product.low_stock_threshold ?? 5;
  const available = product.available_stock;
  if (product.stock_quantity === 0) {
    return { label: 'Out of Stock', status: 'out_of_stock', bar: 'bg-destructive' };
  }
  if (available <= threshold && available > 0) {
    return { label: 'Low Stock', status: 'low_stock', bar: 'bg-warning' };
  }
  return { label: 'In Stock', status: 'in_stock', bar: 'bg-success' };
}

function formatRelativeTime(dateString: string | null) {
  if (!dateString) return '—';
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

function formatTransactionType(type: string) {
  const map: Record<string, string> = {
    purchase: 'Restock',
    sale: 'Order Deduction',
    return: 'Return',
    adjustment: 'Adjustment',
    reservation: 'Reservation',
    reservation_release: 'Release',
    damaged: 'Damaged',
  };
  return map[type] || type.replace(/_/g, ' ');
}

function formatTransactionColor(type: string) {
  const map: Record<string, string> = {
    purchase: 'bg-success/10 text-success border-success/20',
    sale: 'bg-primary/10 text-primary border-primary/20',
    return: 'bg-primary/10 text-primary border-primary/20',
    adjustment: 'bg-warning/10 text-warning border-warning/20',
    reservation: 'bg-warning/10 text-warning border-warning/20',
    reservation_release: 'bg-muted text-muted-foreground border-border',
    damaged: 'bg-destructive/10 text-destructive border-destructive/20',
  };
  return map[type] || 'bg-muted text-muted-foreground border-border';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function InventoryTable({
  initialProducts,
  categories,
  brands,
  currentPage,
  totalPages,
  total,
  stats,
  recentActivity,
}: InventoryTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [products, setProducts] = useState(initialProducts);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setProducts(initialProducts);
    setSelectedIds(new Set());
  }, [initialProducts]);

  const search = searchParams.get('search') || '';
  const categorySlug = searchParams.get('category') || '';
  const brandSlug = searchParams.get('brand') || '';
  const stockFilter = searchParams.get('stock') || '';
  const hasFilters = search || categorySlug || brandSlug || stockFilter;

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
        router.push(`/inventory?${params.toString()}`);
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

  /* ---- selection ------------------------------------------------- */
  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === products.length && products.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(products.map(p => p.id)));
    }
  };

  /* ---- filter chips ---------------------------------------------- */
  const filterChips: { key: string; label: string }[] = [];
  if (search) filterChips.push({ key: 'search', label: `Search: "${search}"` });
  if (categorySlug) {
    const cat = categories.find(c => c.slug === categorySlug);
    filterChips.push({ key: 'category', label: `Category: ${cat?.name_en || categorySlug}` });
  }
  if (brandSlug) {
    const brand = brands.find(b => b.slug === brandSlug);
    filterChips.push({ key: 'brand', label: `Brand: ${brand?.name_en || brandSlug}` });
  }
  if (stockFilter) {
    const stockLabel = stockFilter === 'in_stock' ? 'In Stock' : stockFilter === 'out_of_stock' ? 'Out of Stock' : stockFilter === 'low_stock' ? 'Low Stock' : 'Reserved';
    filterChips.push({ key: 'stock', label: `Stock: ${stockLabel}` });
  }

  /* ---- flat categories for selects ------------------------------- */
  const flatCategories: Category[] = [];
  const collectCats = (cats: Category[]) => {
    for (const c of cats) {
      flatCategories.push(c);
      if (c.children) collectCats(c.children);
    }
  };
  collectCats(categories);

  /* ---- empty state ----------------------------------------------- */
  if (products.length === 0) {
    return (
      <div className="space-y-5">
        <StatsStrip stats={stats} activeFilter={stockFilter} onFilterClick={(val) => updateQueryParam('stock', val)} onClear={clearAllFilters} />
        <Toolbar />
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Archive className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-base font-bold text-foreground">No products found</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            {hasFilters
              ? 'Try adjusting your filters or search query.'
              : 'Your inventory is empty.'}
          </p>
          {hasFilters && (
            <button
              onClick={clearAllFilters}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted transition-all"
            >
              <X className="h-4 w-4" />
              Clear all filters
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stats Strip */}
      <StatsStrip stats={stats} activeFilter={stockFilter} onFilterClick={(val) => updateQueryParam('stock', val)} onClear={clearAllFilters} />

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
            <FilterDropdown label="Category" value={categorySlug} options={[{ value: '', label: 'All Categories' }, ...flatCategories.map(c => ({ value: c.slug, label: c.name_en }))]} onChange={(v) => updateQueryParam('category', v)} />
            <FilterDropdown label="Brand" value={brandSlug} options={[{ value: '', label: 'All Brands' }, ...brands.map(b => ({ value: b.slug, label: b.name_en }))]} onChange={(v) => updateQueryParam('brand', v)} />
            <FilterDropdown label="Stock" value={stockFilter} options={[
              { value: '', label: 'All Stock' },
              { value: 'in_stock', label: 'In Stock' },
              { value: 'low_stock', label: 'Low Stock' },
              { value: 'out_of_stock', label: 'Out of Stock' },
              { value: 'reserved', label: 'Reserved' },
            ]} onChange={(v) => updateQueryParam('stock', v)} />
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

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <span className="text-sm font-bold text-foreground">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIds(new Set())} className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* Main Grid: Table + Activity */}
      <div className="grid gap-5 lg:grid-cols-12">
        {/* Inventory Table */}
        <div className="lg:col-span-9">
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="px-4 py-3 text-left w-10">
                      <input type="checkbox" className="h-4 w-4 rounded border-border" checked={selectedIds.size === products.length && products.length > 0} onChange={toggleAll} />
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Image</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Product</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Category</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Brand</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Stock</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Reserved</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Available</th>
                    <th className="px-4 py-3 text-center text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {products.map((product) => {
                    const state = getStockState(product);
                    const isSelected = selectedIds.has(product.id);
                    const stockRatio = product.stock_quantity > 0
                      ? Math.min(product.available_stock / (product.stock_quantity * 1.5), 1)
                      : 0;

                    return (
                      <tr key={product.id} className={`hover:bg-muted/20 transition-colors group ${isSelected ? 'bg-primary/5' : ''}`}>
                        <td className="px-4 py-3">
                          <input type="checkbox" className="h-4 w-4 rounded border-border" checked={isSelected} onChange={() => toggleSelection(product.id)} />
                        </td>
                        <td className="px-4 py-3">
                          {product.images && product.images[0]?.url ? (
                            <div className="relative h-10 w-10 overflow-hidden rounded-lg border border-border shrink-0">
                              <Image src={product.images[0].url} alt={product.name_en} fill className="object-cover" sizes="40px" />
                            </div>
                          ) : (
                            <div className="h-10 w-10 rounded-lg border border-border bg-muted flex items-center justify-center shrink-0">
                              <Box className="h-4 w-4 text-muted-foreground/50" />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 min-w-[180px]">
                          <div className="flex flex-col gap-0.5">
                            <Link href={`/products/${product.id}/edit`} className="text-sm font-semibold text-foreground hover:text-primary transition-colors truncate max-w-[200px]" title={product.name_en}>
                              {product.name_en}
                            </Link>
                            <span className="text-[11px] font-mono text-muted-foreground">{product.sku}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-muted-foreground truncate max-w-[100px] block">{product.category?.name_en || '—'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-muted-foreground truncate max-w-[90px] block">{product.brand?.name_en || '—'}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-bold text-foreground tabular-nums">{product.stock_quantity}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-sm font-bold tabular-nums ${product.reserved_quantity > 0 ? 'text-warning' : 'text-muted-foreground'}`}>
                            {product.reserved_quantity}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <span className={`text-sm font-bold tabular-nums ${product.available_stock <= 0 ? 'text-destructive' : product.available_stock <= (product.low_stock_threshold ?? 5) ? 'text-warning' : 'text-success'}`}>
                              {product.available_stock}
                            </span>
                            <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
                              <div className={`h-full rounded-full ${state.bar}`} style={{ width: `${Math.max(stockRatio * 100, 4)}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <StatusBadge status={state.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setHistoryProduct(product)}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              title="Transaction history"
                            >
                              <History className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => setAdjustProduct(product)}
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
                Showing <span className="font-semibold text-foreground">{products.length}</span> of <span className="font-semibold text-foreground">{total}</span> items
              </span>
              {totalPages > 1 && (
                <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
              )}
            </div>
          </div>
        </div>

        {/* Activity Feed */}
        <div className="lg:col-span-3 space-y-5">
          {/* Critical Alerts */}
          {stats.outOfStock > 0 && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Critical Alerts</h3>
              </div>
              <div className="space-y-2">
                {stats.outOfStock > 0 && (
                  <button onClick={() => updateQueryParam('stock', 'out_of_stock')} className="w-full flex items-center justify-between rounded-lg border border-destructive/15 bg-card px-3 py-2 text-left hover:bg-destructive/10 transition-colors">
                    <span className="text-xs font-medium text-foreground">Out of Stock</span>
                    <span className="text-sm font-bold text-destructive">{stats.outOfStock}</span>
                  </button>
                )}
                {stats.lowStock > 0 && (
                  <button onClick={() => updateQueryParam('stock', 'low_stock')} className="w-full flex items-center justify-between rounded-lg border border-warning/15 bg-card px-3 py-2 text-left hover:bg-warning/10 transition-colors">
                    <span className="text-xs font-medium text-foreground">Low Stock</span>
                    <span className="text-sm font-bold text-warning">{stats.lowStock}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Recent Activity */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/20">
              <h3 className="text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider">
                <Activity className="h-4 w-4 text-primary" />
                Recent Activity
              </h3>
            </div>
            <div>
              {recentActivity.length > 0 ? (
                <div className="divide-y divide-border">
                  {recentActivity.map((act: any) => (
                    <div key={act.id} className="px-4 py-3 hover:bg-muted/20 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={`text-[10px] font-bold px-1.5 py-[2px] rounded-full border ${formatTransactionColor(act.type)}`}>
                          {formatTransactionType(act.type)}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60 shrink-0">{formatRelativeTime(act.created_at)}</span>
                      </div>
                      <p className="text-xs font-semibold text-foreground truncate">{act.product?.name_en || 'Unknown Product'}</p>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className={`text-xs font-bold tabular-nums ${(act.quantity ?? 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {(act.quantity ?? 0) >= 0 ? '+' : ''}{act.quantity}
                        </span>
                        {act.profiles?.full_name && (
                          <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{act.profiles.full_name}</span>
                        )}
                      </div>
                      {act.notes && (
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">{act.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                  <Activity className="h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-medium text-muted-foreground">No recent activity</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">Inventory transactions will appear here.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Adjust Dialog */}
      {adjustProduct && (
        <InventoryAdjustDialog product={adjustProduct} onClose={() => setAdjustProduct(null)} />
      )}

      {/* History Drawer */}
      {historyProduct && (
        <InventoryTransactionDrawer product={historyProduct} onClose={() => setHistoryProduct(null)} />
      )}
    </div>
  );

  function Toolbar() {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input type="text" placeholder="Search by name or SKU..." value={searchInput} className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/10 transition-all outline-none" onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <FilterDropdown label="Category" value={categorySlug} options={[{ value: '', label: 'All Categories' }, ...flatCategories.map(c => ({ value: c.slug, label: c.name_en }))]} onChange={(v) => updateQueryParam('category', v)} />
            <FilterDropdown label="Brand" value={brandSlug} options={[{ value: '', label: 'All Brands' }, ...brands.map(b => ({ value: b.slug, label: b.name_en }))]} onChange={(v) => updateQueryParam('brand', v)} />
            <FilterDropdown label="Stock" value={stockFilter} options={[{ value: '', label: 'All Stock' }, { value: 'in_stock', label: 'In Stock' }, { value: 'low_stock', label: 'Low Stock' }, { value: 'out_of_stock', label: 'Out of Stock' }, { value: 'reserved', label: 'Reserved' }]} onChange={(v) => updateQueryParam('stock', v)} />
            {hasFilters && (
              <button onClick={clearAllFilters} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
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
  stats: InventoryTableProps['stats'];
  activeFilter: string;
  onFilterClick: (value: string) => void;
  onClear: () => void;
}) {
  const items = [
    { label: 'Total Products', value: stats.total, icon: Boxes, color: 'primary' as const, active: !activeFilter, onClick: onClear },
    { label: 'In Stock', value: stats.inStock, icon: CheckCircle2, color: 'success' as const, active: activeFilter === 'in_stock', onClick: () => onFilterClick('in_stock') },
    { label: 'Low Stock', value: stats.lowStock, icon: AlertTriangle, color: 'warning' as const, active: activeFilter === 'low_stock', onClick: () => onFilterClick('low_stock') },
    { label: 'Out of Stock', value: stats.outOfStock, icon: Package, color: 'destructive' as const, active: activeFilter === 'out_of_stock', onClick: () => onFilterClick('out_of_stock') },
    { label: 'Reserved', value: stats.totalReserved, icon: Archive, color: 'warning' as const, active: activeFilter === 'reserved', onClick: () => onFilterClick('reserved') },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
