import { createClient } from '@/lib/supabase'
import { SupabaseCategoryProvider, SupabaseBrandProvider, SupabaseProductProvider } from '@nest/providers'
import { ProductService } from '@nest/services'
import { cache } from 'react'

/**
 * ## Authentication moved to the API. Data has not.
 *
 * `requireAdmin` is re-exported from `@/lib/api/identity` and is `GET /auth/me`
 * against the NestJS API — nothing in this file authenticates anybody any more.
 *
 * What it REPLACED is worth naming, because it was two separate problems:
 *
 *   1. `supabase.auth.getUser()` — a network call to Supabase Auth to identify
 *      the operator, on every guarded page.
 *   2. A `profiles` lookup made with `createAdminClient()`, which used
 *      **`SUPABASE_SERVICE_ROLE_KEY`** — a credential that bypasses row-level
 *      security completely and is effectively an unrestricted database login.
 *      The admin app held it, in its own environment, to read one column.
 *
 * Both are gone, and so is `createAdminClient` itself: it had no other caller,
 * so the service-role key is no longer read, needed, or present in
 * `.env.example`.
 *
 * ## Everything below is still Supabase, deliberately
 *
 * Products, categories, brands, coupons, inventory, reviews, customers and the
 * dashboard statistics all still read from Supabase. That is Phase 7, and
 * migrating them here would have meant moving eight screens in the change that
 * moves authentication — the scope is drawn at the seam, not through the
 * middle of it.
 *
 * ORDERS are gone from this file entirely — the provider, the service and
 * `getOrderStats` were all deleted rather than left dormant. Supabase order
 * rows are discarded (D-6) and nothing in this console reads them any more.
 * See `lib/api/endpoints.ts` and `lib/api/order-stats.ts`.
 */

export { requireAdmin } from '@/lib/api/identity'

/* ------------------------------------------------------------------ */
/*  Cached Supabase Client (same request dedup)                       */
/* ------------------------------------------------------------------ */

const getCachedClient = cache(async () => createClient())

/* ------------------------------------------------------------------ */
/*  Cached Service Factory                                            */
/* ------------------------------------------------------------------ */

const buildServices = cache(async () => {
  const supabase = await getCachedClient()
  const categoryRepo = new SupabaseCategoryProvider(supabase as any)
  const brandRepo = new SupabaseBrandProvider(supabase as any)
  const productRepo = new SupabaseProductProvider(supabase as any)
  const productService = new ProductService(productRepo, categoryRepo, brandRepo)
  /*
   * NO `orderService`. `SupabaseOrderProvider` and `OrderService` were
   * constructed here and are gone: orders are the API's now, and a service
   * still wired to the legacy tables is exactly the dormant duplicate this
   * phase was told not to leave behind.
   */
  return { supabase, categoryRepo, brandRepo, productRepo, productService }
})

export async function getAdminServices() {
  return buildServices()
}

/* ------------------------------------------------------------------ */
/*  Cached Lookups (categories & brands rarely change)                */
/* ------------------------------------------------------------------ */

export const getCachedCategories = cache(async () => {
  const { productService } = await getAdminServices()
  return productService.getCategoryTree()
})

export const getCachedBrands = cache(async () => {
  const { productService } = await getAdminServices()
  return productService.getAllBrands()
})

/* ------------------------------------------------------------------ */
/*  Combined Stats Queries (single round trip per table)              */
/* ------------------------------------------------------------------ */

/**
 * The dashboard's PRODUCT and CUSTOMER numbers.
 *
 * ## Every order query that was here is gone
 *
 * It used to run eight queries, five of which read `orders` or `order_items`:
 * a total order count, a pending count, the eight most recent orders, a revenue
 * sum over every paid row, a top-products join through `order_items`, and a
 * status breakdown. All five read the LEGACY tables.
 *
 * Those rows are discarded (D-6) — the storefront has placed orders through the
 * API since T2 — so every one of those numbers was either stale or zero, and
 * the "Recent Orders" table linked to `/orders/<supabase-uuid>`, which the
 * API-backed detail page answers with a 400 because it is not a 24-character
 * hex id. A dashboard confidently reporting revenue from a discarded table is
 * the clearest possible case of the legacy view this phase was told not to
 * keep.
 *
 * The order half of the dashboard now comes from `lib/api/order-stats.ts` and
 * `GET /admin/orders`. What is left here is products, customers and stock,
 * which are still Supabase until Phase 7.
 *
 * ## Revenue is not reported at all
 *
 * No API endpoint exposes a revenue aggregate. Summing a page gives a figure
 * that changes when you paginate, and fetching every order to add them up is a
 * table scan on every dashboard load. A wrong money figure is worse than none,
 * so there is none until an aggregate endpoint exists.
 */
export async function getDashboardStats() {
  const { supabase } = await getAdminServices()

  const [
    { count: activeProductCount, data: productsForStock },
    { count: customerCount },
  ] = await Promise.all([
    /* Products for stock analysis */
    supabase
      .from('products')
      .select('name_en, stock_quantity, reserved_quantity, low_stock_threshold, sku', { count: 'exact' })
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('stock_quantity', { ascending: true })
      .limit(100),

    /* Customer count */
    supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'customer'),
  ])

  const lowStock = (productsForStock ?? [])
    .filter((p: any) => {
      const available = (p.stock_quantity ?? 0) - (p.reserved_quantity ?? 0)
      return available <= (p.low_stock_threshold ?? 5)
    })
    .sort((a: any, b: any) => {
      const availA = (a.stock_quantity ?? 0) - (a.reserved_quantity ?? 0)
      const availB = (b.stock_quantity ?? 0) - (b.reserved_quantity ?? 0)
      return availA - availB
    })
    .slice(0, 8)

  return {
    productCount: activeProductCount ?? 0,
    customerCount: customerCount ?? 0,
    lowStock: lowStock as Array<{
      name_en: string
      stock_quantity: number
      reserved_quantity: number
      low_stock_threshold: number | null
      sku: string
    }>,
  }
}

export async function getProductStats() {
  const { supabase } = await getAdminServices()

  const { count: total } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)

  const { count: active } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .eq('is_active', true)
    .gt('stock_quantity', 0)

  const { count: inactive } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .eq('is_active', false)

  const { count: outOfStock } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .eq('stock_quantity', 0)

  const { count: lowStock } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .gt('stock_quantity', 0)
    .lte('stock_quantity', 5)

  return {
    total: total ?? 0,
    active: active ?? 0,
    inactive: inactive ?? 0,
    lowStock: lowStock ?? 0,
    outOfStock: outOfStock ?? 0,
  }
}

export async function getInventoryStats() {
  const { supabase } = await getAdminServices()

  const { data } = await supabase
    .from('products')
    .select('stock_quantity, reserved_quantity, low_stock_threshold')
    .is('deleted_at', null)

  const rows = data ?? []
  const totalReserved = rows.reduce((sum: number, r: any) => sum + (r.reserved_quantity ?? 0), 0)
  const inStock = rows.filter((r: any) => r.stock_quantity > 0).length
  const outOfStock = rows.filter((r: any) => r.stock_quantity === 0).length

  // Use available_stock logic: stock - reserved > 0 and <= threshold
  const lowStock = rows.filter((r: any) => {
    const available = (r.stock_quantity ?? 0) - (r.reserved_quantity ?? 0)
    return available > 0 && available <= (r.low_stock_threshold ?? 5)
  }).length

  return { total: rows.length, inStock, lowStock, outOfStock, totalReserved }
}

/**
 * Recent ADMIN actions.
 *
 * ## Its order source was removed, and its remaining source is broken
 *
 * This used to merge two feeds: `order_status_history` and `admin_audit_logs`.
 * The first is a legacy-orders view — those rows are discarded (D-6) and
 * nothing writes them any more, because order transitions go through the API,
 * which records its own history ON THE ORDER and exposes it at
 * `GET /admin/orders/{id}` as `statusHistory[]`. So it is gone.
 *
 * `admin_audit_logs` remains the only source, and it will be EMPTY going
 * forward: its `admin_id` column has a foreign key to Supabase `profiles.id`,
 * and the acting admin is now an API account. `lib/audit/log-action.ts` refuses
 * those writes and says so once per process rather than letting the constraint
 * swallow them silently.
 *
 * An empty panel is the honest state. Filling it from the discarded table would
 * show activity that did not happen, and inventing an API-wide activity feed is
 * Phase 7's job — `AUDIT-MODEL.md` is where it belongs.
 */
export async function getRecentActivity(limit = 8) {
  const { supabase } = await getAdminServices()

  const { data: recentAuditLogs } = await supabase
    .from('admin_audit_logs')
    .select('id, action, entity_type, entity_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  return (recentAuditLogs ?? []).map((a: any) => ({
    id: a.id as string,
    type: 'audit' as const,
    title: `${(a.entity_type as string)?.replace(/_/g, ' ') ?? 'Item'} ${a.action as string}`,
    description: a.entity_id ? `Ref: ${(a.entity_id as string).slice(0, 8)}…` : 'System action',
    time: a.created_at as string,
  }))
}

export async function getInventoryTransactions(limit = 8) {
  const { supabase } = await getAdminServices()
  const { data } = await supabase
    .from('inventory_transactions')
    .select('id, type, quantity, notes, created_at, product:products(name_en), profiles(full_name)')
    .order('created_at', { ascending: false })
    .limit(limit)
  return data ?? []
}
