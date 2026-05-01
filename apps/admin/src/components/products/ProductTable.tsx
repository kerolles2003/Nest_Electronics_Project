"use client";

import { useState, useTransition, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Pagination, Button, StatusBadge } from "@nest/ui";
import { softDeleteProductAction, toggleProductStatusAction } from "@/actions/product.actions";
import type { Product, Category, Brand } from "@nest/types";
import {
  Search, X, Plus, Pencil, Trash2, Power, PowerOff,
  Package, AlertTriangle, CheckCircle2, XCircle, Star,
  ArrowUpRight, Filter, Loader2, ChevronDown, Boxes, Download
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ProductTableProps {
  initialProducts: Product[];
  categories: Category[];
  brands: Brand[];
  currentPage: number;
  totalPages: number;
  total: number;
  stats: {
    total: number;
    active: number;
    inactive: number;
    lowStock: number;
    outOfStock: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getStockInfo(product: Product) {
  const threshold = product.low_stock_threshold ?? 5;
  if (product.stock_quantity === 0) {
    return { label: 'Out', color: 'text-rose-400', badge: 'bg-rose-500/10 text-rose-400' };
  }
  if (product.stock_quantity <= threshold) {
    return { label: 'Low', color: 'text-amber-400', badge: 'bg-amber-500/10 text-amber-400' };
  }
  return { label: 'In Stock', color: 'text-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400' };
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



/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ProductTable({
  initialProducts,
  categories,
  brands,
  currentPage,
  totalPages,
  total,
  stats,
}: ProductTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [products, setProducts] = useState(initialProducts);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* sync when server re-renders with new data */
  useEffect(() => {
    setProducts(initialProducts);
    setSelectedIds(new Set());
  }, [initialProducts]);

  const search = searchParams.get("search") || "";
  const categorySlug = searchParams.get("category") || "";
  const brandSlug = searchParams.get("brand") || "";
  const statusFilter = searchParams.get("status") || "";
  const stockFilter = searchParams.get("stock") || "";

  const hasFilters = search || categorySlug || brandSlug || statusFilter || stockFilter;

  /* ---- navigation helpers ---------------------------------------- */
  const updateQueryParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key !== "page") params.set("page", "1");
    startTransition(() => {
      router.push(`/products?${params.toString()}`);
    });
  };

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    startTransition(() => {
      router.push(`/products?${params.toString()}`);
    });
  };

  const clearAllFilters = () => {
    startTransition(() => {
      router.push("/products");
    });
  };

  /* debounced search */
  useEffect(() => {
    if (searchInput === search) return;
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchInput) {
        params.set("search", searchInput);
      } else {
        params.delete("search");
      }
      params.set("page", "1");
      startTransition(() => {
        router.push(`/products?${params.toString()}`);
      });
    }, 350);
    return () => clearTimeout(searchDebounceRef.current);
  }, [searchInput, search, router, searchParams]);

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

  /* ---- single actions -------------------------------------------- */
  const handleToggleStatus = async (productId: string, currentActive: boolean) => {
    const result = await toggleProductStatusAction(productId, !currentActive);
    if (result.success) {
      setProducts(prev =>
        prev.map(p =>
          p.id === productId ? { ...p, is_active: !currentActive } : p
        )
      );
    }
  };

  const handleDelete = async (productId: string) => {
    if (!confirm("Are you sure you want to delete this product?")) return;
    const result = await softDeleteProductAction(productId);
    if (result.success) {
      setProducts(prev => prev.filter(p => p.id !== productId));
    }
  };

  /* ---- csv export ------------------------------------------------ */
  const handleExportCSV = useCallback(() => {
    const headers = ['ID', 'SKU', 'Name', 'Category', 'Brand', 'Base Price', 'Sale Price', 'Stock', 'Status', 'Featured', 'Created At'];
    const rows = products.map(p => [
      p.id,
      p.sku,
      p.name_en,
      p.category?.name_en || '',
      p.brand?.name_en || '',
      p.base_price,
      p.sale_price ?? '',
      p.stock_quantity,
      p.is_active ? 'Active' : 'Inactive',
      p.is_featured ? 'Yes' : 'No',
      p.created_at,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `products-export-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [products]);

  /* ---- bulk actions ---------------------------------------------- */
  const handleBulkActivate = async () => {
    setIsBulkProcessing(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map(id => toggleProductStatusAction(id, true)));
    const succeeded = results.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
    setProducts(prev => prev.map(p => selectedIds.has(p.id) ? { ...p, is_active: true } : p));
    setSelectedIds(new Set());
    setIsBulkProcessing(false);
    alert(`${succeeded} of ${ids.length} products activated`);
  };

  const handleBulkDeactivate = async () => {
    setIsBulkProcessing(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map(id => toggleProductStatusAction(id, false)));
    const succeeded = results.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
    setProducts(prev => prev.map(p => selectedIds.has(p.id) ? { ...p, is_active: false } : p));
    setSelectedIds(new Set());
    setIsBulkProcessing(false);
    alert(`${succeeded} of ${ids.length} products deactivated`);
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedIds.size} products?`)) return;
    setIsBulkProcessing(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map(id => softDeleteProductAction(id)));
    const succeeded = results.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
    setProducts(prev => prev.filter(p => !selectedIds.has(p.id)));
    setSelectedIds(new Set());
    setIsBulkProcessing(false);
    alert(`${succeeded} of ${ids.length} products deleted`);
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
  if (statusFilter) filterChips.push({ key: 'status', label: `Status: ${statusFilter}` });
  if (stockFilter) {
    const stockLabel = stockFilter === 'in_stock' ? 'In Stock' : stockFilter === 'out_of_stock' ? 'Out of Stock' : 'Low Stock';
    filterChips.push({ key: 'stock', label: `Stock: ${stockLabel}` });
  }

  /* ---- category/brand flat lists for selects --------------------- */
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
        <StatsStrip stats={stats} activeFilters={{ statusFilter, stockFilter }} onFilterClick={(key, val) => updateQueryParam(key, val)} onClear={clearAllFilters} />
        <Toolbar />
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Package className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-base font-bold text-foreground">No products found</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            {hasFilters
              ? 'Try adjusting your filters or search query to find what you are looking for.'
              : 'Your catalog is empty. Add your first product to get started.'}
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
          {!hasFilters && (
            <Link
              href="/products/new"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-all"
            >
              <Plus className="h-4 w-4" />
              Add Product
            </Link>
          )}
        </div>
      </div>
    );
  }

  /* ---- render ---------------------------------------------------- */
  return (
    <div className="space-y-5">
      {/* Stats Strip */}
      <StatsStrip stats={stats} activeFilters={{ statusFilter, stockFilter }} onFilterClick={(key, val) => updateQueryParam(key, val)} onClear={clearAllFilters} />

      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name or SKU..."
              defaultValue={search}
              className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/10 transition-all outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  updateQueryParam("search", (e.target as HTMLInputElement).value);
                }
              }}
            />
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <FilterDropdown
              label="Category"
              value={categorySlug}
              options={[{ value: '', label: 'All Categories' }, ...flatCategories.map(c => ({ value: c.slug, label: c.name_en }))]}
              onChange={(v) => updateQueryParam('category', v)}
            />
            <FilterDropdown
              label="Brand"
              value={brandSlug}
              options={[{ value: '', label: 'All Brands' }, ...brands.map(b => ({ value: b.slug, label: b.name_en }))]}
              onChange={(v) => updateQueryParam('brand', v)}
            />
            <FilterDropdown
              label="Status"
              value={statusFilter}
              options={[
                { value: '', label: 'All Statuses' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
              onChange={(v) => updateQueryParam('status', v)}
            />
            <FilterDropdown
              label="Stock"
              value={stockFilter}
              options={[
                { value: '', label: 'All Stock' },
                { value: 'in_stock', label: 'In Stock' },
                { value: 'low_stock', label: 'Low Stock' },
                { value: 'out_of_stock', label: 'Out of Stock' },
              ]}
              onChange={(v) => updateQueryParam('stock', v)}
            />

            {hasFilters && (
              <button
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Active Filter Chips */}
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

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-foreground">
              {selectedIds.size} {selectedIds.size === 1 ? 'product' : 'products'} selected
            </span>
            {isBulkProcessing && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBulkActivate}
              disabled={isBulkProcessing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              <Power className="h-3.5 w-3.5" />
              Activate
            </button>
            <button
              onClick={handleBulkDeactivate}
              disabled={isBulkProcessing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
            >
              <PowerOff className="h-3.5 w-3.5" />
              Deactivate
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={isBulkProcessing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
            <div className="h-5 w-px bg-border mx-1" />
            <button
              onClick={() => setSelectedIds(new Set())}
              disabled={isBulkProcessing}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="px-4 py-3 text-left w-10">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={selectedIds.size === products.length && products.length > 0}
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Image</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Product</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Category</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Brand</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Price</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Stock</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.map((product) => {
                const stock = getStockInfo(product);
                const isSelected = selectedIds.has(product.id);

                return (
                  <tr
                    key={product.id}
                    className={`hover:bg-muted/20 transition-colors duration-150 group ${isSelected ? 'bg-primary/5' : ''}`}
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border"
                        checked={isSelected}
                        onChange={() => toggleSelection(product.id)}
                      />
                    </td>

                    {/* Image */}
                    <td className="px-4 py-3">
                      {product.images && product.images[0]?.url ? (
                        <div className="relative h-10 w-10 overflow-hidden rounded-lg border border-border shrink-0">
                          <Image
                            src={product.images[0].url}
                            alt={product.name_en}
                            fill
                            className="object-cover"
                            sizes="40px"
                          />
                        </div>
                      ) : (
                        <div className="h-10 w-10 rounded-lg border border-border bg-muted flex items-center justify-center shrink-0">
                          <Package className="h-4 w-4 text-muted-foreground/50" />
                        </div>
                      )}
                    </td>

                    {/* Product */}
                    <td className="px-4 py-3 min-w-[200px]">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/products/${product.id}/edit`}
                            className="text-sm font-semibold text-foreground hover:text-primary transition-colors truncate max-w-[240px]"
                            title={product.name_en}
                          >
                            {product.name_en}
                          </Link>
                          {product.is_featured && (
                            <span className="inline-flex items-center rounded-full px-1.5 py-[2px] text-[10px] font-bold bg-amber-500/10 text-amber-400 shrink-0">
                              <Star className="h-2.5 w-2.5 mr-0.5" fill="currentColor" />
                              Featured
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-muted-foreground">{product.sku}</span>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground truncate max-w-[120px] block">
                        {product.category?.name_en || '—'}
                      </span>
                    </td>

                    {/* Brand */}
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground truncate max-w-[100px] block">
                        {product.brand?.name_en || '—'}
                      </span>
                    </td>

                    {/* Price */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        {product.sale_price && product.sale_price < product.base_price ? (
                          <span className="text-sm font-bold text-foreground tabular-nums">
                            {product.sale_price.toLocaleString('en-EG')}
                            <span className="text-[10px] font-normal text-muted-foreground ml-1">EGP</span>
                            <span className="text-[11px] text-muted-foreground line-through ml-1.5 font-normal">
                              {product.base_price.toLocaleString('en-EG')}
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm font-bold text-foreground tabular-nums">
                            {product.base_price.toLocaleString('en-EG')}
                            <span className="text-[10px] font-normal text-muted-foreground ml-1">EGP</span>
                          </span>
                        )}
                        {product.cost_price && (
                          <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                            Cost: {product.cost_price.toLocaleString('en-EG')} EGP
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Stock */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className={`text-sm font-bold tabular-nums ${stock.color}`}>
                          {product.stock_quantity}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-1.5 py-[2px] text-[10px] font-bold w-fit ${stock.badge}`}>
                          {stock.label}
                        </span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <StatusBadge status={product.is_active ? 'active' : 'inactive'} />
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity duration-150">
                        <Link
                          href={`/products/${product.id}/edit`}
                          className="inline-flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors duration-150"
                          title="Edit product"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
                        <button
                          onClick={() => handleToggleStatus(product.id, product.is_active)}
                          className={`inline-flex items-center justify-center rounded-md h-8 w-8 transition-colors duration-150 ${product.is_active ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-amber-400 hover:bg-amber-500/10'}`}
                          title={product.is_active ? 'Deactivate' : 'Activate'}
                        >
                          {product.is_active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => handleDelete(product.id)}
                          className="inline-flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400 transition-colors duration-150"
                          title="Delete product"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="px-5 py-3 border-t border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{products.length}</span> of{' '}
            <span className="font-semibold text-foreground">{total}</span> products
          </span>
          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          )}
        </div>
      </div>
    </div>
  );

  /* ---- sub-components -------------------------------------------- */

  function Toolbar() {
    return (
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
            <FilterDropdown label="Status" value={statusFilter} options={[{ value: '', label: 'All Statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} onChange={(v) => updateQueryParam('status', v)} />
            <FilterDropdown label="Stock" value={stockFilter} options={[{ value: '', label: 'All Stock' }, { value: 'in_stock', label: 'In Stock' }, { value: 'low_stock', label: 'Low Stock' }, { value: 'out_of_stock', label: 'Out of Stock' }]} onChange={(v) => updateQueryParam('stock', v)} />
            {hasFilters && (
              <button onClick={clearAllFilters} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
              title="Export current view as CSV"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
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
  activeFilters,
  onFilterClick,
  onClear,
}: {
  stats: ProductTableProps['stats'];
  activeFilters: { statusFilter: string; stockFilter: string };
  onFilterClick: (key: string, value: string) => void;
  onClear: () => void;
}) {
  const { statusFilter, stockFilter } = activeFilters;

  const items = [
    {
      label: 'Total Products',
      value: stats.total,
      icon: Boxes,
      color: 'blue',
      active: !statusFilter && !stockFilter,
      onClick: onClear,
    },
    {
      label: 'Active',
      value: stats.active,
      icon: CheckCircle2,
      color: 'emerald',
      active: statusFilter === 'active',
      onClick: () => onFilterClick('status', 'active'),
    },
    {
      label: 'Inactive',
      value: stats.inactive,
      icon: XCircle,
      color: 'gray',
      active: statusFilter === 'inactive',
      onClick: () => onFilterClick('status', 'inactive'),
    },
    {
      label: 'Low Stock',
      value: stats.lowStock,
      icon: AlertTriangle,
      color: 'amber',
      active: stockFilter === 'low_stock',
      onClick: () => onFilterClick('stock', 'low_stock'),
    },
    {
      label: 'Out of Stock',
      value: stats.outOfStock,
      icon: Package,
      color: 'rose',
      active: stockFilter === 'out_of_stock',
      onClick: () => onFilterClick('stock', 'out_of_stock'),
    },
  ];

  const colorMap: Record<string, { bg: string; text: string; border: string; ring: string }> = {
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', ring: 'ring-emerald-500/30' },
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', ring: 'ring-blue-500/30' },
    gray: { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20', ring: 'ring-gray-500/30' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', ring: 'ring-amber-500/30' },
    rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20', ring: 'ring-rose-500/30' },
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {items.map((item) => {
        const Icon = item.icon;
        const colors = colorMap[item.color];
        return (
          <button
            key={item.label}
            onClick={item.onClick}
            className={`relative overflow-hidden rounded-xl border ${item.active ? colors.border + ' ring-1 ' + colors.ring : 'border-border'} bg-card p-3 text-left transition-all hover:shadow-md hover:border-opacity-40`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`rounded-lg p-1.5 ${colors.bg}`}>
                <Icon className={`h-3.5 w-3.5 ${colors.text}`} />
              </div>
              {item.active && (
                <span className={`text-[10px] font-bold px-1.5 py-[2px] rounded-full ${colors.bg} ${colors.text}`}>
                  Active
                </span>
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
  const selected = options.find(o => o.value === value);

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
