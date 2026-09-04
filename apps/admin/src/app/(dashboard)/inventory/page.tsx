import { requireAdmin } from '@/lib/services';
import { Suspense } from 'react';
import { InventoryTable } from '@/components/inventory/InventoryTable';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { AlertTriangle } from 'lucide-react';

/**
 * Stock, from the API.
 *
 * ## What changed, and what had to be given up to make it true
 *
 * This screen used to query Supabase `products` directly and write through
 * `adjust_stock_v2`. Both halves were writing into a database nothing reads —
 * and the RPC has never once completed successfully in production, so the
 * screen's central action did nothing even there.
 *
 * Three things the old screen showed are gone, and each is an invention rather
 * than a loss:
 *
 * **Reserved / Available.** The API's stock is a single `onHand`. There is no
 * reservation in the model, so "Reserved: 0" beside every row was a column of
 * zeroes describing a mechanism that does not exist.
 *
 * **The brand filter.** `GET /admin/inventory` filters by search, category
 * subtree, low-stock and out-of-stock. A brand dropdown that quietly did
 * nothing is worse than no dropdown.
 *
 * **Client-side low-stock refinement.** The old page fetched `stock <= 15` and
 * then filtered in JavaScript against each product's threshold, so page 2 of a
 * low-stock list could be shorter than page 1 and the count above it was never
 * the count of rows below it. `?lowStock=true` is a database predicate against
 * the product's OWN threshold.
 *
 * ## The counters come from the dashboard aggregate
 *
 * There is no inventory-stats endpoint, and there should not be: the dashboard
 * already computes active/low/out over the same collection in one pass. The
 * strip says "active products" because that is what the aggregate covers —
 * `?includeInactive=true` widens the LIST, and the counters keep saying what
 * they actually counted rather than following the filter.
 */

function InventorySkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 h-20" />
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card h-12" />
      <div className="rounded-xl border border-border bg-card h-96" />
    </div>
  );
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default async function InventoryPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await props.searchParams;

  const page = Number(one(sp['page'])) || 1;
  const search = one(sp['search']);
  const categoryId = one(sp['category']);
  const stockFilter = one(sp['stock']);
  const includeInactive = one(sp['inactive']) === 'true';
  const limit = 25;

  const [levelsRes, categoriesRes, statsRes] = await Promise.all([
    tryApi(() =>
      api.listStockLevels({
        page,
        limit,
        q: search,
        categoryId,
        includeInactive,
        lowStock: stockFilter === 'low_stock',
        outOfStock: stockFilter === 'out_of_stock',
      }),
    ),
    tryApi(() => api.listAdminCategories()),
    tryApi(() => api.dashboardStats()),
  ]);

  /*
   * A failed list is stated, never rendered as an empty inventory. "No products
   * found" when the request failed is the same class of lie as a dashboard
   * printing 0 orders because a fetch timed out.
   */
  if (!levelsRes.ok) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground mt-1">Stock levels and movements, from the API.</p>
        </div>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive/70 mx-auto mb-3" />
          <h2 className="text-base font-bold text-foreground">Stock levels could not be loaded</h2>
          <p className="text-sm text-muted-foreground mt-1">{operatorMessage(levelsRes.error)}</p>
        </div>
      </div>
    );
  }

  const levels = levelsRes.data.data;
  const meta = levelsRes.data.meta;

  const categories = categoriesRes.ok
    ? categoriesRes.data.data.filter((category) => category.deletedAt === null)
    : [];

  const products = statsRes.ok ? statsRes.data.data.products : null;

  /*
   * `lowStockCount` is `onHand <= threshold`, which INCLUDES zero. Subtracting
   * gives the two disjoint groups an operator reads as "low" and "out", so the
   * three counters add up to the total instead of double-counting the empty
   * shelves.
   */
  const stats =
    products === null
      ? null
      : {
          total: products.total,
          lowStock: Math.max(products.lowStockCount - products.outOfStockCount, 0),
          outOfStock: products.outOfStockCount,
          inStock: Math.max(products.total - products.lowStockCount, 0),
        };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Inventory</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Stock levels and movements. Scarcest first — the order is the server&apos;s, because the
          list exists to be worked down.
        </p>
      </div>

      <Suspense fallback={<InventorySkeleton />}>
        <InventoryTable
          levels={levels}
          categories={categories}
          currentPage={meta.page}
          totalPages={meta.totalPages}
          total={meta.total}
          stats={stats}
        />
      </Suspense>
    </div>
  );
}
