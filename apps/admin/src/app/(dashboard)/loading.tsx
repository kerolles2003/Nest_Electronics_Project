import { Card, CardHeader, Skeleton } from '@nest/ui';

export default function DashboardLoading() {
  return (
    <div className="space-y-5">
      {/* Header skeleton */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>

      {/* Stats grid skeleton */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <Skeleton className="h-8 w-8 rounded-md mb-2" />
            <Skeleton className="h-3 w-20 mb-2" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>

      {/* Main grid skeleton */}
      <div className="grid gap-5 lg:grid-cols-12">
        {/* Left: Recent Orders table */}
        <div className="lg:col-span-8">
          <Card>
            <CardHeader className="py-3">
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <div className="px-5 pb-5">
              <div className="space-y-3">
                {/* Table header */}
                <div className="flex gap-4 pb-2 border-b border-border">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-12 ml-auto" />
                </div>
                {/* Table rows */}
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex gap-4 items-center py-2">
                    <div className="w-16 space-y-1">
                      <Skeleton className="h-3 w-14" />
                      <Skeleton className="h-2.5 w-10" />
                    </div>
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-6 w-14 rounded-md ml-auto" />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Right: Side panels */}
        <div className="lg:col-span-4 space-y-5">
          {/* Low stock */}
          <Card>
            <CardHeader className="py-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-8 rounded-full" />
              </div>
            </CardHeader>
            <div className="px-5 pb-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-2.5 w-20" />
                  </div>
                  <Skeleton className="h-5 w-8" />
                </div>
              ))}
            </div>
          </Card>

          {/* Top products */}
          <Card>
            <CardHeader className="py-3">
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <div className="px-5 pb-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-8" />
                </div>
              ))}
            </div>
          </Card>

          {/* Activity */}
          <Card>
            <CardHeader className="py-3">
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <div className="px-5 pb-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="h-6 w-6 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
