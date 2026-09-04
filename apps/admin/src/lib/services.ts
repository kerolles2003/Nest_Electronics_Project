import { createClient } from '@/lib/supabase'
import { cache } from 'react'
import { tryApi } from '@/lib/api/client'
import * as api from '@/lib/api/endpoints'
import type { DashboardWindowKey } from '@/lib/api/types'

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
 * ## What is LEFT of Supabase in this file, and it is nearly nothing
 *
 * Orders went first (D-6). Then products, categories, brands, inventory and the
 * dashboard statistics, each with its screen, and each deleted here rather than
 * left dormant — a repository still wired to a table nobody reads is a
 * duplicate waiting to be picked up by mistake.
 *
 * Gone with them: `SupabaseCategoryProvider`, `SupabaseBrandProvider`,
 * `SupabaseProductProvider` and `ProductService`. The admin no longer imports
 * `@nest/providers` or `@nest/services` at all.
 *
 * What remains is `getAdminServices()`, which hands out one thing — the raw
 * client — to exactly three screens: **coupons, reviews and the audit log**.
 * The first two are Phase 8 domains and are rebuilt there. The audit log has an
 * API-side model but no admin endpoint yet, so it reads a table that is empty
 * going forward; `getRecentActivity` below says why.
 */

export { requireAdmin } from '@/lib/api/identity'

/* ------------------------------------------------------------------ */
/*  Cached Supabase Client (same request dedup)                       */
/* ------------------------------------------------------------------ */

const getCachedClient = cache(async () => createClient())

/* ------------------------------------------------------------------ */
/*  Cached Service Factory                                            */
/* ------------------------------------------------------------------ */

/**
 * The raw client, and nothing else.
 *
 * It used to return a `ProductService` built over three Supabase repositories
 * as well. All four are gone with the screens that used them: the catalogue,
 * the taxonomy and inventory are the API's now, and a repository still wired to
 * a table nobody reads is a duplicate waiting to be picked up by mistake.
 *
 * Three callers remain — coupons, reviews and the audit log — and each takes
 * `supabase` directly.
 */
const buildServices = cache(async () => {
  const supabase = await getCachedClient()

  return { supabase }
})

export async function getAdminServices() {
  return buildServices()
}

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
 * ## Revenue is counted at DELIVERY (ADR-ORDER-002)
 *
 * The dashboard aggregate endpoint provides delivered revenue, pipeline value,
 * complete order breakdown, active product counts, low stock items, and customer
 * statistics in a single server-side aggregation.
 */
export async function getDashboardStats(window?: DashboardWindowKey) {
  const result = await tryApi(() => api.dashboardStats(window === undefined ? {} : { window }));

  if (result.ok) {
    const d = result.data.data;
    return {
      productCount: d.products.total,
      customerCount: d.customers.total,
      lowStock: d.products.lowStock.map((p) => ({
        name_en: p.name,
        stock_quantity: p.onHand,
        reserved_quantity: 0,
        low_stock_threshold: p.lowStockThreshold,
        sku: p.sku,
      })),
      /*
       * The window the SERVER applied, not the one that was asked for. They are
       * the same today; they would stop being the same the moment a default
       * moves, and the caption has to follow the numbers rather than the
       * request.
       */
      window: d.window,
      revenue: d.revenue,
      orders: d.orders,
      products: d.products,
      customers: d.customers,
    };
  }

  return {
    productCount: 0,
    customerCount: 0,
    lowStock: [],
    // No window either: a caption for figures that could not be read would be
    // a period label over a row of em dashes.
    window: null,
    revenue: null,
    orders: null,
    products: null,
    customers: null,
  };
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
