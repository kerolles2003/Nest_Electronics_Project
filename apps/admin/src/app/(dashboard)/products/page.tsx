import { requireAdmin } from '@/lib/services';
import Link from 'next/link';
import { Suspense } from 'react';
import { ProductTable } from '@/components/products/ProductTable';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { PRODUCT_SORTS, PRODUCT_STATES } from '@/lib/api/types';
import type { AdminProductSort, AdminProductState } from '@/lib/api/types';
import { Plus, AlertTriangle } from 'lucide-react';

/**
 * The catalogue, from the API.
 *
 * ## The counts are three real queries, not a guess
 *
 * The tab badges ask the API for each state with `limit=1` and read `meta.total`
 * — three cheap counts rather than one list the console tries to bucket
 * client-side, which could only ever count the current page. They are fetched
 * beside the list, and any that fails renders as absent rather than as zero: a
 * badge reading "0 drafts" because a request failed would send an operator
 * looking for work that is sitting there.
 *
 * ## Filters are ids, not slugs
 *
 * `?category=` and `?brand=` carry ObjectIds because that is what the endpoint
 * takes. The old page passed slugs into a Supabase relational filter
 * (`.eq('category.slug', …)`), which silently matched nothing when the join
 * was not what it assumed.
 */

function ProductsSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-8 w-72 rounded-lg border border-border bg-card" />
      <div className="h-12 rounded-xl border border-border bg-card" />
      <div className="h-96 rounded-xl border border-border bg-card" />
    </div>
  );
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default async function ProductsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await props.searchParams;

  const page = Number(one(sp['page'])) || 1;
  const q = one(sp['q']);
  const categoryId = one(sp['category']);
  const brandId = one(sp['brand']);
  const limit = 20;

  const rawState = one(sp['state']);
  const state = PRODUCT_STATES.includes(rawState as AdminProductState)
    ? (rawState as AdminProductState)
    : undefined;

  const rawSort = one(sp['sort']);
  const sort = PRODUCT_SORTS.includes(rawSort as AdminProductSort)
    ? (rawSort as AdminProductSort)
    : undefined;

  const [listRes, categoriesRes, brandsRes, publishedRes, draftRes, deletedRes] = await Promise.all([
    tryApi(() =>
      api.listAdminProducts({
        page,
        limit,
        q,
        categoryId,
        brandId,
        ...(state === undefined ? {} : { state }),
        ...(sort === undefined ? {} : { sort }),
      }),
    ),
    tryApi(() => api.listAdminCategories()),
    tryApi(() => api.listAdminBrands()),
    tryApi(() => api.listAdminProducts({ state: 'published', limit: 1 })),
    tryApi(() => api.listAdminProducts({ state: 'draft', limit: 1 })),
    tryApi(() => api.listAdminProducts({ state: 'deleted', limit: 1 })),
  ]);

  const header = (
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Products</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The catalogue customers buy from. Drafts are included; deleted products live behind their
          own tab.
        </p>
      </div>
      <Link
        href="/products/new"
        className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" /> Add product
      </Link>
    </div>
  );

  /*
   * A failed list is stated. "No products found" because a request failed is
   * how an operator concludes the catalogue is empty and starts re-entering it.
   */
  if (!listRes.ok) {
    return (
      <div className="space-y-5">
        {header}
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive/70" />
          <h2 className="text-base font-bold text-foreground">The catalogue could not be loaded</h2>
          <p className="mt-1 text-sm text-muted-foreground">{operatorMessage(listRes.error)}</p>
        </div>
      </div>
    );
  }

  const categories = categoriesRes.ok
    ? categoriesRes.data.data.filter((category) => category.deletedAt === null)
    : [];
  const brands = brandsRes.ok ? brandsRes.data.data.filter((brand) => brand.deletedAt === null) : [];

  return (
    <div className="space-y-5">
      {header}

      <Suspense fallback={<ProductsSkeleton />}>
        <ProductTable
          products={listRes.data.data}
          categories={categories}
          brands={brands}
          currentPage={listRes.data.meta.page}
          totalPages={listRes.data.meta.totalPages}
          total={listRes.data.meta.total}
          counts={{
            published: publishedRes.ok ? publishedRes.data.meta.total : null,
            draft: draftRes.ok ? draftRes.data.meta.total : null,
            deleted: deletedRes.ok ? deletedRes.data.meta.total : null,
          }}
        />
      </Suspense>
    </div>
  );
}
