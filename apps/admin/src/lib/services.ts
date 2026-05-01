import { createClient } from '@/lib/supabase'
import { SupabaseCategoryProvider, SupabaseBrandProvider, SupabaseProductProvider, SupabaseOrderProvider } from '@nest/providers'
import { ProductService, OrderService } from '@nest/services'
import { redirect } from 'next/navigation'
import { cache } from 'react'

/* ------------------------------------------------------------------ */
/*  Cached Supabase Client (same request dedup)                       */
/* ------------------------------------------------------------------ */

const getCachedClient = cache(async () => createClient())

/* ------------------------------------------------------------------ */
/*  Fast Admin Auth – single round trip via RPC                       */
/* ------------------------------------------------------------------ */

export async function requireAdmin() {
  const supabase = await getCachedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile, error } = await (supabase as any)
    .from('profiles')
    .select('id, role, full_name, email, avatar_url, phone')
    .eq('id', user.id)
    .single()

  if (error || !profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
    redirect('/unauthorized')
  }

  return { user, profile }
}

/* ------------------------------------------------------------------ */
/*  Cached Service Factory                                            */
/* ------------------------------------------------------------------ */

const buildServices = cache(async () => {
  const supabase = await getCachedClient()
  const categoryRepo = new SupabaseCategoryProvider(supabase as any)
  const brandRepo = new SupabaseBrandProvider(supabase as any)
  const productRepo = new SupabaseProductProvider(supabase as any)
  const orderRepo = new SupabaseOrderProvider(supabase as any)
  const productService = new ProductService(productRepo, categoryRepo, brandRepo)
  const orderService = new OrderService(orderRepo)
  return { supabase, categoryRepo, brandRepo, productRepo, productService, orderService }
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

export async function getDashboardStats() {
  const { supabase } = await getAdminServices()

  const [
    { count: activeProductCount, data: productsForStock },
    { count: totalOrderCount },
    { count: customerCount },
    { count: pendingOrderCount },
    { data: recentOrders },
    { data: revenueData },
    { data: topProductsData },
    { data: orderStatusBreakdown },
  ] = await Promise.all([
    /* 1. Products for stock analysis */
    supabase
      .from('products')
      .select('name_en, stock_quantity, reserved_quantity, low_stock_threshold, sku', { count: 'exact' })
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('stock_quantity', { ascending: true })
      .limit(100),

    /* 2. Total orders count */
    supabase
      .from('orders')
      .select('*', { count: 'exact', head: true }),

    /* 3. Customer count */
    supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'customer'),

    /* 4. Pending / processing orders */
    supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .in('order_status', ['pending_payment', 'processing']),

    /* 5. Recent orders */
    supabase
      .from('orders')
      .select('id, order_number, total, order_status, payment_status, fulfillment_status, created_at, shipping_address')
      .order('created_at', { ascending: false })
      .limit(8),

    /* 6. Total revenue (paid orders only) */
    supabase
      .from('orders')
      .select('total')
      .eq('payment_status', 'paid')
      .not('order_status', 'in', '(cancelled,failed)'),

    /* 7. Top products by units sold */
    (supabase as any)
      .from('order_items')
      .select('quantity, product:products!inner(name_en), order:orders!inner(order_status, payment_status)')
      .not('order.order_status', 'in', '(cancelled,failed)')
      .not('order.payment_status', 'in', '(refunded,partially_refunded)')
      .limit(500),

    /* 8. Order status breakdown */
    (supabase as any)
      .from('orders')
      .select('order_status'),
  ])

  /* ------------------------------------------------------------------ */
  /*  Compute derived values                                            */
  /* ------------------------------------------------------------------ */

  const totalRevenue = (revenueData ?? []).reduce((sum: number, o: any) => sum + (o.total ?? 0), 0)

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

  /* Top products: aggregate in JS */
  const productSales: Record<string, { name: string; units: number }> = {}
  for (const row of topProductsData ?? []) {
    const name = row.product?.name_en
    if (!name) continue
    if (!productSales[name]) productSales[name] = { name, units: 0 }
    productSales[name].units += row.quantity ?? 0
  }
  const topProducts = Object.values(productSales)
    .sort((a, b) => b.units - a.units)
    .slice(0, 5)

  /* Order status breakdown */
  const statusCounts: Record<string, number> = {}
  for (const row of orderStatusBreakdown ?? []) {
    const status = row.order_status as string
    statusCounts[status] = (statusCounts[status] ?? 0) + 1
  }

  return {
    productCount: activeProductCount ?? 0,
    orderCount: totalOrderCount ?? 0,
    customerCount: customerCount ?? 0,
    pendingOrderCount: pendingOrderCount ?? 0,
    totalRevenue,
    lowStock: lowStock as Array<{
      name_en: string
      stock_quantity: number
      reserved_quantity: number
      low_stock_threshold: number | null
      sku: string
    }>,
    recentOrders: (recentOrders ?? []) as Array<{
      id: string
      order_number: string
      total: number
      order_status: string
      payment_status: string
      fulfillment_status: string
      created_at: string
      shipping_address: { full_name?: string } | null
    }>,
    topProducts,
    orderStatusBreakdown: statusCounts,
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

export async function getOrderStats() {
  const { supabase } = await getAdminServices()

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const startOfWeek = new Date(now.getTime() - 7 * 86400000).toISOString()

  const [
    { count: total },
    { count: pendingPayment },
    { count: paid },
    { count: processing },
    { count: shipped },
    { count: delivered },
    { count: cancelled },
    { data: todayRows },
    { data: weekRows },
  ] = await Promise.all([
    supabase.from('orders').select('*', { count: 'exact', head: true }),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('order_status', 'pending_payment'),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('order_status', 'paid'),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('order_status', 'processing'),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('order_status', 'shipped'),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('order_status', 'delivered'),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('order_status', 'cancelled'),
    supabase.from('orders').select('total').gte('created_at', startOfToday),
    supabase.from('orders').select('total').gte('created_at', startOfWeek),
  ])

  const todayRevenue = (todayRows ?? []).reduce((sum: number, r: any) => sum + (r.total ?? 0), 0)
  const weekRevenue = (weekRows ?? []).reduce((sum: number, r: any) => sum + (r.total ?? 0), 0)

  return {
    total: total ?? 0,
    pendingPayment: pendingPayment ?? 0,
    paid: paid ?? 0,
    processing: processing ?? 0,
    shipped: shipped ?? 0,
    delivered: delivered ?? 0,
    cancelled: cancelled ?? 0,
    todayRevenue,
    weekRevenue,
  }
}

export async function getRecentActivity(limit = 8) {
  const { supabase } = await getAdminServices()
  const [{ data: recentOrderHistory }, { data: recentAuditLogs }] = await Promise.all([
    supabase.from('order_status_history').select('id, order_id, field, from_value, to_value, created_at').order('created_at', { ascending: false }).limit(limit),
    supabase.from('admin_audit_logs').select('id, action, entity_type, entity_id, created_at').order('created_at', { ascending: false }).limit(limit),
  ])

  const activities = [
    ...(recentOrderHistory ?? []).map((h: any) => ({
      id: h.id as string,
      type: 'order' as const,
      title: `Order ${(h.field as string)?.replace(/_/g, ' ') ?? 'status'} updated`,
      description: `From "${(h.from_value as string) ?? 'N/A'}" to "${h.to_value as string}"`,
      time: h.created_at as string,
    })),
    ...(recentAuditLogs ?? []).map((a: any) => ({
      id: a.id as string,
      type: 'audit' as const,
      title: `${(a.entity_type as string)?.replace(/_/g, ' ') ?? 'Item'} ${a.action as string}`,
      description: a.entity_id ? `Ref: ${(a.entity_id as string).slice(0, 8)}…` : 'System action',
      time: a.created_at as string,
    })),
  ]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, limit)

  return activities
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
