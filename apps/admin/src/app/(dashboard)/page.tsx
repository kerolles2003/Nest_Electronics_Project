import { requireAdmin, getDashboardStats, getRecentActivity } from '@/lib/services';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { orderStatusCounts } from '@/lib/api/order-stats';
import Link from 'next/link';
import { Suspense } from 'react';
import {
  Package, ShoppingBag, AlertTriangle, Users, Clock,
  ArrowUpRight, Eye, Activity, CheckCircle2, Banknote,
} from 'lucide-react';

/**
 * The dashboard.
 *
 * ## Its order numbers come from the API. All of them.
 *
 * Every order figure here used to be a Supabase query over the LEGACY tables —
 * total orders, pending orders, revenue, top products by units sold, the eight
 * most recent orders, and a status breakdown. The storefront has placed orders
 * through the API since T2, so those rows are discarded (D-6): the numbers were
 * stale or zero, and every row in "Recent Orders" linked to
 * `/orders/<supabase-uuid>`, which the API-backed detail page refuses because
 * it is not a 24-character hex id. It was a legacy-orders view in the most
 * literal sense — a table of orders nobody can act on.
 *
 * ## Two panels were removed rather than repointed
 *
 * **Total Revenue.** No API endpoint aggregates it, and the alternatives print
 * a number that is wrong. Replaced by "Awaiting confirmation", which is a real
 * count and is also the thing an operator opening this page actually needs.
 *
 * **Top Products by units sold.** Its only source was a join through
 * `order_items`, which is discarded, and the API has no sales-ranking endpoint.
 * A panel that can only be filled from a table nobody trusts is better absent
 * than plausible.
 */
import { StatusBadge, Card, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nest/ui';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
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

/*
 * `formatCurrency` was here. It abbreviated a summed revenue figure to "EGP
 * 1.2M" — and nothing computes revenue any more, because no API endpoint
 * aggregates it and the Supabase sum was over discarded rows.
 *
 * It is deleted rather than left for later. Every money value this console
 * shows now comes pre-formatted from the server (`Money.formatted`), which is
 * the only way the console and the invoice cannot disagree about rounding.
 */
function formatNumber(value: number) {
  return value.toLocaleString('en-EG');
}

/* ------------------------------------------------------------------ */
/*  Async Components (streamed via Suspense)                          */
/* ------------------------------------------------------------------ */

async function ActivityFeed() {
  const activities = await getRecentActivity(8);

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <div className="px-0">
        {activities.length > 0 ? (
          <div className="divide-y divide-border">
            {activities.map((activity) => (
              <div key={activity.id} className="flex items-start gap-3 px-5 py-2.5 hover:bg-surface-high/30 transition-colors duration-150">
                <div className="mt-0.5 rounded-full p-1.5 shrink-0 bg-purple/10">
                  <Activity className="h-3 w-3 text-purple" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{activity.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{activity.description}</p>
                  <p className="text-[10px] text-foreground-subtle mt-0.5">{formatRelativeTime(activity.time)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center px-5">
            <Clock className="h-6 w-6 text-muted-foreground/40 mb-2" />
            <p className="text-xs font-medium text-muted-foreground">No recent activity</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function ActivitySkeleton() {
  return (
    <Card>
      <CardHeader className="py-3">
        <div className="h-4 w-32 bg-muted rounded animate-pulse" />
      </CardHeader>
      <div className="px-5 pb-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="h-6 w-6 rounded-full bg-muted shrink-0 animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-3/4 bg-muted rounded animate-pulse" />
              <div className="h-2.5 w-1/2 bg-muted rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default async function AdminPage() {
  await requireAdmin();

  const [stats, orderCounts, recentOrders] = await Promise.all([
    getDashboardStats(),
    orderStatusCounts(),
    tryApi(() => api.listOrders({ limit: 8 })),
  ]);

  const now = new Date();
  const currentDate = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  /*
   * `null` renders as an em dash, never as 0. A dashboard that says "0 orders"
   * because a request failed is worse than one that admits it does not know.
   */
  const show = (value: number | null) => (value === null ? '—' : formatNumber(value));

  const statItems = [
    {
      label: 'Delivered Revenue',
      display: stats.revenue ? stats.revenue.delivered.formatted : '—',
      icon: Banknote,
      color: 'success' as const,
      sub: stats.revenue
        ? `${stats.revenue.deliveredCount} paid · ${stats.revenue.pipeline.formatted} pipeline`
        : 'Counted at delivery',
    },
    {
      label: 'Total Orders',
      display: show(orderCounts.total),
      icon: ShoppingBag,
      color: 'primary' as const,
      sub: 'Across every status',
    },
    {
      label: 'Awaiting confirmation',
      display: show(orderCounts.counts['PLACED'] ?? null),
      icon: Clock,
      color: 'warning' as const,
      sub: 'Call the customer to confirm',
    },
    {
      label: 'Ready to ship',
      display: show(orderCounts.counts['CONFIRMED'] ?? null),
      icon: CheckCircle2,
      color: 'success' as const,
      sub: 'Confirmed, not yet dispatched',
    },
    {
      label: 'Delivery failed',
      display: show(orderCounts.counts['DELIVERY_FAILED'] ?? null),
      icon: AlertTriangle,
      color: 'destructive' as const,
      sub: 'Re-dispatch or return',
    },
    {
      label: 'Products',
      display: formatNumber(stats.productCount),
      icon: Package,
      color: 'purple' as const,
      sub: stats.lowStock.length > 0 ? `${stats.lowStock.length} low stock` : 'All stocked',
    },
    {
      label: 'Customers',
      display: formatNumber(stats.customerCount),
      icon: Users,
      color: 'warning' as const,
      sub: 'Registered accounts',
    },
  ];

  const colorMap: Record<string, { bg: string; icon: string; border: string; glow: string; hoverBorder: string }> = {
    success: { bg: 'bg-success/10', icon: 'text-success', border: 'border-success/20', glow: 'bg-success/20', hoverBorder: 'hover:border-success/50' },
    primary: { bg: 'bg-primary/10', icon: 'text-primary', border: 'border-primary/20', glow: 'bg-primary/20', hoverBorder: 'hover:border-primary/50' },
    purple: { bg: 'bg-purple/10', icon: 'text-purple', border: 'border-purple/20', glow: 'bg-purple/20', hoverBorder: 'hover:border-purple/50' },
    warning: { bg: 'bg-warning/10', icon: 'text-warning', border: 'border-warning/20', glow: 'bg-warning/20', hoverBorder: 'hover:border-warning/50' },
    destructive: { bg: 'bg-destructive/10', icon: 'text-destructive', border: 'border-destructive/20', glow: 'bg-destructive/20', hoverBorder: 'hover:border-destructive/50' },
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">{currentDate}</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-heading">{getGreeting()}, Admin</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Here&apos;s what&apos;s happening with Nest Electronics today.</p>
        </div>
        <Link href="/orders" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover transition-colors shrink-0">
          <ShoppingBag className="h-4 w-4" />
          Manage Orders
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-7">
        {statItems.map((stat) => {
          const Icon = stat.icon;
          const colors = colorMap[stat.color];
          const displayValue = stat.display;
          return (
            <div key={stat.label} className={`group relative overflow-hidden rounded-xl border ${colors.border} bg-card/40 backdrop-blur-md p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated ${colors.hoverBorder}`}>
              {/* Glow effect */}
              <div className={`absolute -right-6 -top-6 h-24 w-24 rounded-full ${colors.glow} blur-2xl transition-all duration-500 group-hover:scale-150 group-hover:opacity-100 opacity-40`} />
              
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                  <div className={`rounded-xl p-2 ${colors.bg} ring-1 ring-inset ${colors.border}`}>
                    <Icon className={`h-4 w-4 ${colors.icon}`} />
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{stat.label}</p>
                  <p className="text-2xl font-bold tracking-tight text-foreground mt-1 font-heading">{displayValue}</p>
                  <p className="text-[11px] text-foreground-subtle mt-1 truncate font-medium">{stat.sub}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Grid */}
      <div className="grid gap-5 lg:grid-cols-12">
        {/* Left Column */}
        <div className="lg:col-span-8 space-y-5">
          {/* Recent Orders */}
          <Card>
            <CardHeader className="py-3 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Recent Orders
              </CardTitle>
              <Link href="/orders" className="text-xs font-semibold text-primary hover:text-primary-hover transition-colors flex items-center gap-1">
                View all <ArrowUpRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentOrders.ok &&
                    recentOrders.data.data.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-[11px] font-bold text-primary">
                              {order.orderNumber}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {formatRelativeTime(order.placedAt)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-foreground">
                            {order.itemCount} line{order.itemCount === 1 ? '' : 's'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {/* The SERVER's formatted string. Never re-derived here. */}
                          <span className="font-bold text-foreground text-xs tabular-nums font-mono">
                            {order.pricing.grandTotal.formatted}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <StatusBadge status={order.status} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/orders/${order.id}`} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold bg-surface-high text-foreground hover:bg-primary hover:text-primary-foreground transition-colors">
                            <Eye className="h-3 w-3" /> View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  {!recentOrders.ok && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-12 text-center">
                        {/*
                          NOT "no orders". The queue could not be read, and
                          saying the shop has no orders because a request failed
                          is the most expensive lie this console could tell.
                        */}
                        <div className="flex flex-col items-center gap-2">
                          <AlertTriangle className="h-8 w-8 text-destructive/60" />
                          <p className="text-sm font-medium text-foreground">
                            Recent orders could not be loaded
                          </p>
                          <p className="text-xs text-muted-foreground">{recentOrders.error.message}</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {recentOrders.ok && recentOrders.data.data.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-12 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <Package className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-sm font-medium text-muted-foreground">No orders yet</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-4 space-y-5">
          {/* Low Stock Alerts */}
          <Card>
            <CardHeader className="py-3 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Low Stock
              </CardTitle>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">
                {stats.lowStock.length}
              </span>
            </CardHeader>
            <div>
              {stats.lowStock.length > 0 ? (
                <div className="divide-y divide-border">
                  {stats.lowStock.map((item) => {
                    const available = item.stock_quantity - (item.reserved_quantity ?? 0);
                    return (
                      <div key={item.sku} className="flex items-center justify-between px-5 py-2.5 hover:bg-surface-high/30 transition-colors duration-150 group">
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-semibold text-foreground truncate group-hover:text-warning transition-colors">{item.name_en}</span>
                          <span className="text-[10px] text-foreground-subtle font-mono">{item.sku}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="flex flex-col items-end">
                            <span className="text-sm font-bold text-destructive tabular-nums font-mono">{available}</span>
                            <span className="text-[9px] text-muted-foreground uppercase">available</span>
                          </div>
                          <Link href="/inventory" className="p-1 rounded-md hover:bg-surface-high transition-colors opacity-0 group-hover:opacity-100" title="Manage inventory">
                            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center px-5">
                  <Package className="h-6 w-6 text-success/60 mb-2" />
                  <p className="text-xs font-medium text-muted-foreground">Stock levels are healthy</p>
                </div>
              )}
            </div>
            {stats.lowStock.length > 0 && (
              <div className="px-5 py-2.5 border-t border-border">
                <Link href="/inventory" className="w-full inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-high transition-colors">
                  Manage Inventory
                </Link>
              </div>
            )}
          </Card>

          {/*
            "Top Products" was HERE and is deliberately gone.

            Its only source was a join through `order_items` — legacy order
            rows, discarded by D-6 — and the API has no sales-ranking endpoint.
            The choice was between a panel filled from a table nobody trusts and
            no panel; a plausible ranking of products by sales that never
            happened is worse than an absence somebody notices.
          */}

          {/* Recent Activity — streamed via Suspense */}
          <Suspense fallback={<ActivitySkeleton />}>
            <ActivityFeed />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
