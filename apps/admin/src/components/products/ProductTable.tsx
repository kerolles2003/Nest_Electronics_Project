'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Pagination, useToast } from '@nest/ui';
import {
  publishProductAction,
  unpublishProductAction,
  softDeleteProductAction,
  restoreProductAction,
} from '@/actions/product.actions';
import { imageUrl, primaryImage } from '@/lib/images';
import { PRODUCT_SORTS } from '@/lib/api/types';
import type { AdminBrand, AdminCategory, AdminProduct, AdminProductSort } from '@/lib/api/types';
import {
  Search, X, Package, Filter, Loader2, ChevronDown, Box, Eye, EyeOff,
  Pencil, Trash2, RotateCcw, AlertTriangle,
} from 'lucide-react';

/**
 * The catalogue, on the API.
 *
 * ## Publish is an action, not a toggle
 *
 * The old table had a status switch that flipped `is_active` through a generic
 * product update. The API refuses that: `isActive` is not accepted on a write,
 * and `POST /publish` / `POST /unpublish` are separate endpoints that are
 * separately audited. That is not ceremony — "who made this visible to
 * customers, and when" is a different question from "who edited the
 * description", and a boolean buried in an update cannot answer it.
 *
 * ## Prices are the server's integers, formatted once, here
 *
 * `pricing.basePrice` is minor units. It is divided for display at the edge and
 * never stored, compared or sent as a float — MONEY-MODEL.md has no floats in
 * it, and a price that round-trips through a display string is a price that can
 * come back different.
 *
 * ## Deleted products are reachable but never mixed in
 *
 * The default listing excludes them; `?state=deleted` is a deliberate choice
 * that changes what the table is. Soft delete is recoverable, so the deleted
 * view offers Restore rather than pretending the row is gone.
 */

interface ProductTableProps {
  products: AdminProduct[];
  categories: AdminCategory[];
  brands: AdminBrand[];
  currentPage: number;
  totalPages: number;
  total: number;
  counts: { published: number | null; draft: number | null; deleted: number | null };
}

const SORT_LABELS: Record<AdminProductSort, string> = {
  updated: 'Recently updated',
  newest: 'Newest first',
  oldest: 'Oldest first',
  name_asc: 'Name A–Z',
  price_asc: 'Price low to high',
  price_desc: 'Price high to low',
  stock_asc: 'Stock low to high',
};

/** Minor units → the string a person reads. Divided at the boundary, never before. */
function money(minor: number): string {
  return `${(minor / 100).toLocaleString('en-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} EGP`;
}

export function ProductTable({
  products,
  categories,
  brands,
  currentPage,
  totalPages,
  total,
  counts,
}: ProductTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminProduct | null>(null);
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const q = searchParams.get('q') ?? '';
  const state = searchParams.get('state') ?? '';
  const categoryId = searchParams.get('category') ?? '';
  const brandId = searchParams.get('brand') ?? '';
  const sort = (searchParams.get('sort') ?? 'updated') as AdminProductSort;
  const hasFilters = q !== '' || state !== '' || categoryId !== '' || brandId !== '';

  useEffect(() => {
    if (searchInput === q) return;
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchInput !== '') params.set('q', searchInput);
      else params.delete('q');
      params.set('page', '1');
      startTransition(() => {
        router.push(`/products?${params.toString()}`);
      });
    }, 350);

    return () => clearTimeout(searchDebounceRef.current);
  }, [searchInput, q, router, searchParams]);

  const updateQueryParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value !== '') params.set(key, value);
    else params.delete(key);
    if (key !== 'page') params.set('page', '1');
    startTransition(() => {
      router.push(`/products?${params.toString()}`);
    });
  };

  const run = async (
    product: AdminProduct,
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
  ) => {
    setBusyId(product.id);
    const result = await action();
    setBusyId(null);

    if (!result.ok) {
      addToast(result.error ?? 'The change was not applied.', 'error');
      return;
    }

    addToast(success, 'success');
    /*
     * Re-read rather than patch local state. What the operator sees next has to
     * be what the API would hand them — publishing also recounts the category
     * and brand totals, which this component has no way to update correctly.
     */
    startTransition(() => {
      router.refresh();
    });
  };

  const viewing =
    state === 'deleted' ? 'deleted' : state === 'draft' ? 'draft' : state === 'published' ? 'published' : 'all';

  return (
    <div className="space-y-5">
      {/* State tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { key: '', label: 'All', count: null },
            { key: 'published', label: 'Published', count: counts.published },
            { key: 'draft', label: 'Drafts', count: counts.draft },
            { key: 'deleted', label: 'Deleted', count: counts.deleted },
          ] as const
        ).map((tab) => {
          const active = state === tab.key;

          return (
            <button
              key={tab.key === '' ? 'all' : tab.key}
              type="button"
              onClick={() => updateQueryParam('state', tab.key)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {tab.label}
              {tab.count !== null && (
                <span className="rounded-full bg-muted px-1.5 py-[1px] text-[10px] tabular-nums text-muted-foreground">
                  {tab.count}
                </span>
              )}
            </button>
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
              data-testid="product-search"
              placeholder="Search by name, SKU or slug..."
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/10"
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

          <div className="flex flex-wrap items-center gap-2">
            <FilterDropdown
              label="Category"
              value={categoryId}
              options={[
                { value: '', label: 'All categories' },
                ...categories.map((category) => ({
                  value: category.id,
                  label: `${'— '.repeat(category.depth)}${category.name.en}`,
                })),
              ]}
              onChange={(value) => updateQueryParam('category', value)}
            />
            <FilterDropdown
              label="Brand"
              value={brandId}
              options={[
                { value: '', label: 'All brands' },
                ...brands.map((brand) => ({ value: brand.id, label: brand.name.en })),
              ]}
              onChange={(value) => updateQueryParam('brand', value)}
            />
            <FilterDropdown
              label="Sort"
              value={sort}
              options={PRODUCT_SORTS.map((key) => ({ value: key, label: SORT_LABELS[key] }))}
              onChange={(value) => updateQueryParam('sort', value)}
            />
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  startTransition(() => {
                    router.push('/products');
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        </div>

        {isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating results...
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {products.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <h3 className="text-base font-bold text-foreground">
              <span data-testid="product-empty">
                {viewing === 'deleted' ? 'Nothing has been deleted' : 'No products match'}
              </span>
            </h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {hasFilters
                ? 'Nothing in the catalogue matches these filters.'
                : 'Add the first product to start the catalogue.'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Product</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Category</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Brand</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Price</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Stock</th>
                    <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground">State</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {products.map((product) => {
                    const image = primaryImage(product.images);
                    const src = imageUrl(image, 'row');
                    const busy = busyId === product.id;
                    const deleted = product.deletedAt !== null;
                    const onSale = product.pricing.salePrice !== null;

                    return (
                      <tr
                        key={product.id}
                        data-testid="product-row"
                        data-sku={product.sku}
                        className={`transition-colors hover:bg-muted/20 ${deleted ? 'opacity-60' : ''}`}
                      >
                        <td className="px-4 py-3 min-w-[240px]">
                          <div className="flex items-center gap-3">
                            {src !== null ? (
                              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border">
                                <Image src={src} alt="" fill className="object-cover" sizes="40px" />
                              </div>
                            ) : (
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                                <Box className="h-4 w-4 text-muted-foreground/50" />
                              </div>
                            )}
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <Link
                                href={`/products/${product.id}/edit`}
                                data-testid="product-name"
                                className="truncate text-sm font-semibold text-foreground transition-colors hover:text-primary"
                                title={product.name.en}
                              >
                                {product.name.en}
                              </Link>
                              <span data-testid="product-sku" className="font-mono text-[11px] text-muted-foreground">
                                {product.sku}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span data-testid="product-category" className="block max-w-[140px] truncate text-xs text-muted-foreground">
                            {product.category.name.en}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span data-testid="product-brand" className="block max-w-[120px] truncate text-xs text-muted-foreground">
                            {product.brand?.name.en ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-col items-end">
                            <span data-testid="product-price" className="text-sm font-bold tabular-nums text-foreground">
                              {money(product.pricing.effectivePrice)}
                            </span>
                            {onSale && (
                              <span
                                data-testid="product-base-price"
                                className="text-[10px] tabular-nums text-muted-foreground line-through"
                              >
                                {money(product.pricing.basePrice)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            data-testid="product-stock"
                            className={`text-sm font-bold tabular-nums ${
                              product.stock.onHand === 0
                                ? 'text-destructive'
                                : product.stock.onHand <= product.stock.lowStockThreshold
                                  ? 'text-warning'
                                  : 'text-foreground'
                            }`}
                          >
                            {product.stock.onHand}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center" data-testid="product-state">
                          <StateChip product={product} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}

                            {deleted ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(product, () => restoreProductAction(product.id), 'Product restored')
                                }
                                data-testid="product-restore"
                                className="inline-flex items-center gap-1 rounded-lg bg-success/10 px-2.5 py-1.5 text-[11px] font-semibold text-success transition-colors hover:bg-success/20 disabled:opacity-50"
                              >
                                <RotateCcw className="h-3 w-3" /> Restore
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void run(
                                      product,
                                      () =>
                                        product.isActive
                                          ? unpublishProductAction(product.id)
                                          : publishProductAction(product.id),
                                      product.isActive ? 'Product unpublished' : 'Product published',
                                    )
                                  }
                                  data-testid="product-visibility"
                                  title={
                                    product.isActive
                                      ? 'Hide from customers. Recorded separately from an edit.'
                                      : 'Make visible to customers. Recorded separately from an edit.'
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                                >
                                  {product.isActive ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                </button>
                                <Link
                                  href={`/products/${product.id}/edit`}
                                  data-testid="product-edit"
                                  className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
                                >
                                  <Pencil className="h-3 w-3" /> Edit
                                </Link>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setConfirmDelete(product)}
                                  data-testid="product-delete"
                                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                                  title="Delete (recoverable)"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-3">
              <span className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{products.length}</span> of{' '}
                <span className="font-semibold text-foreground">{total}</span> products
              </span>
              {totalPages > 1 && (
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={(page) => updateQueryParam('page', String(page))}
                />
              )}
            </div>
          </>
        )}
      </div>

      {confirmDelete !== null && (
        <ConfirmDelete
          product={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const product = confirmDelete;
            setConfirmDelete(null);
            void run(product, () => softDeleteProductAction(product.id), 'Product deleted — it can be restored');
          }}
        />
      )}
    </div>
  );
}

function StateChip({ product }: { product: AdminProduct }) {
  if (product.deletedAt !== null) {
    return (
      <span className="inline-flex items-center rounded-full border border-destructive/20 bg-destructive/10 px-2 py-[2px] text-[10px] font-bold text-destructive">
        Deleted
      </span>
    );
  }

  return product.isActive ? (
    <span className="inline-flex items-center rounded-full border border-success/20 bg-success/10 px-2 py-[2px] text-[10px] font-bold text-success">
      Published
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-[2px] text-[10px] font-bold text-muted-foreground">
      Draft
    </span>
  );
}

/**
 * The confirmation, and what it is honest about.
 *
 * A soft delete is RECOVERABLE and keeps the product's slug and SKU, so this
 * says so rather than asking "are you sure?" about something it implies is
 * permanent. It also says what is not obvious: the SKU stays taken, so
 * recreating the product under the same code will be refused until this one is
 * restored or destroyed.
 */
function ConfirmDelete({
  product,
  onCancel,
  onConfirm,
}: {
  product: AdminProduct;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-elevated">
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">Delete this product?</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{product.name.en}</p>
          </div>
        </div>

        <div className="space-y-2 px-5 py-4 text-sm text-foreground">
          <p>
            It disappears from the storefront immediately and can be restored from the{' '}
            <span className="font-semibold">Deleted</span> tab.
          </p>
          <p className="text-xs text-muted-foreground">
            Its SKU <span className="font-mono">{product.sku}</span> and slug stay taken while it is
            deleted — reusing either would repoint existing links at a different product.
          </p>
          {product.images.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Its {product.images.length} image{product.images.length === 1 ? '' : 's'}{' '}
              {product.images.length === 1 ? 'is' : 'are'} kept.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            data-testid="delete-cancel"
            className="rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="delete-confirm"
            className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-xs font-bold text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

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
        <Filter className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="hidden shrink-0 font-medium text-muted-foreground sm:inline">{label}</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className="min-w-[80px] appearance-none border-none bg-transparent pr-4 text-xs font-semibold text-foreground outline-none focus:ring-0"
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
