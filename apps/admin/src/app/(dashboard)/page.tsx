import { requireAdmin, getDashboardStats, getRecentActivity } from '@/lib/services';
import Link from 'next/link';
import { Suspense } from 'react';
import {
  Package, ShoppingBag, AlertTriangle, Users, Clock,
  ArrowUpRight, Eye, Activity, Box, TrendingUp,
} from 'lucide-react';
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

function formatCurrency(value: number) {
  if (value >= 1_000_000) return `EGP ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `EGP ${(value / 1_000).toFixed(1)}K`;
  return `EGP ${value.toLocaleString('en-EG')}`;
}

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
              <div key={activity.id} className="flex items-start gap-3 px-5 py-2.5 hover:bg-surface-high/30 transition-colors">
                <div className={`mt-0.5 rounded-full p-1.5 shrink-0 ${activity.type === 'order' ? 'bg-primary/10' : 'bg-purple/10'}`}>
                  {activity.type === 'order' ? (
                    <Box className="h-3 w-3 text-primary" />
                  ) : (
                    <Activity className="h-3 w-3 text-purple" />
                  )}
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
  const stats = await getDashboardStats();

  const now = new Date();
  const currentDate = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const statItems = [
    {
      label: 'Total Revenue',
      value: stats.totalRevenue,
      format: 'currency' as const,
      icon: TrendingUp,
      color: 'success' as const,
      sub: 'Paid orders',
    },
    {
      label: 'Total Orders',
      value: stats.orderCount,
      format: 'number' as const,
      icon: ShoppingBag,
      color: 'primary' as const,
      sub: `${stats.orderStatusBreakdown['pending_payment'] ?? 0} pending · ${stats.orderStatusBreakdown['processing'] ?? 0} processing · ${stats.orderStatusBreakdown['shipped'] ?? 0} shipped`,
    },
    {
      label: 'Products',
      value: stats.productCount,
      format: 'number' as const,
      icon: Package,
      color: 'purple' as const,
      sub: stats.lowStock.length > 0 ? `${stats.lowStock.length} low stock` : 'All stocked',
    },
    {
      label: 'Customers',
      value: stats.customerCount,
      format: 'number' as const,
      icon: Users,
      color: 'warning' as const,
      sub: 'Registered accounts',
    },
    {
      label: 'Pending',
      value: stats.pendingOrderCount,
      format: 'number' as const,
      icon: Clock,
      color: 'warning' as const,
      sub: 'Need attention',
    },
    {
      label: 'Low Stock',
      value: stats.lowStock.length,
      format: 'number' as const,
      icon: AlertTriangle,
      color: 'destructive' as const,
      sub: 'Items to reorder',
    },
  ];

  const colorMap: Record<string, { bg: string; icon: string; border: string }> = {
    success: { bg: 'bg-success/10', icon: 'text-success', border: 'border-success/20' },
    primary: { bg: 'bg-primary/10', icon: 'text-primary', border: 'border-primary/20' },
    purple: { bg: 'bg-purple/10', icon: 'text-purple', border: 'border-purple/20' },
    warning: { bg: 'bg-warning/10', icon: 'text-warning', border: 'border-warning/20' },
    destructive: { bg: 'bg-destructive/10', icon: 'text-destructive', border: 'border-destructive/20' },
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
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {statItems.map((stat) => {
          const Icon = stat.icon;
          const colors = colorMap[stat.color];
          const displayValue = stat.format === 'currency' ? formatCurrency(stat.value) : formatNumber(stat.value);
          return (
            <div key={stat.label} className={`rounded-lg border ${colors.border} bg-card p-4 transition-colors hover:border-border-strong`}>
              <div className="flex items-center justify-between mb-2">
                <div className={`rounded-md p-1.5 ${colors.bg}`}>
                  <Icon className={`h-4 w-4 ${colors.icon}`} />
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                <p className="text-xl font-bold tracking-tight text-foreground mt-0.5 font-heading">{displayValue}</p>
                <p className="text-[10px] text-foreground-subtle mt-0.5 truncate">{stat.sub}</p>
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
                    <TableHead>Customer</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.recentOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-[11px] font-bold text-primary">#{order.order_number}</span>
                          <span className="text-[10px] text-muted-foreground">{formatRelativeTime(order.created_at)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-foreground">
                          {(() => {
                            const addr = order.shipping_address as { full_name?: string } | null;
                            return addr?.full_name ?? '—';
                          })()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-bold text-foreground text-xs tabular-nums font-mono">
                          {order.total.toLocaleString('en-EG')}
                          <span className="text-[10px] font-normal text-muted-foreground ml-1">EGP</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge status={order.order_status} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/orders/${order.id}`} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold bg-surface-high text-foreground hover:bg-primary hover:text-primary-foreground transition-colors">
                          <Eye className="h-3 w-3" /> View
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                  {stats.recentOrders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-12 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <Package className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-sm font-medium text-muted-foreground">No orders found yet</p>
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
                      <div key={item.sku} className="flex items-center justify-between px-5 py-2.5 hover:bg-surface-high/30 transition-colors group">
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

          {/* Top Products */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Top Products
              </CardTitle>
            </CardHeader>
            <div>
              {stats.topProducts.length > 0 ? (
                <div className="divide-y divide-border">
                  {stats.topProducts.map((product, index) => (
                    <div key={product.name} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-high/30 transition-colors">
                      <span className="text-[10px] font-bold text-foreground-subtle w-4 text-center">{index + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{product.name}</p>
                      </div>
                      <span className="text-xs font-bold text-foreground tabular-nums font-mono">{product.units}</span>
                      <span className="text-[10px] text-muted-foreground">sold</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center px-5">
                  <ShoppingBag className="h-6 w-6 text-muted-foreground/40 mb-2" />
                  <p className="text-xs font-medium text-muted-foreground">No sales data yet</p>
                </div>
              )}
            </div>
          </Card>

          {/* Recent Activity — streamed via Suspense */}
          <Suspense fallback={<ActivitySkeleton />}>
            <ActivityFeed />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
