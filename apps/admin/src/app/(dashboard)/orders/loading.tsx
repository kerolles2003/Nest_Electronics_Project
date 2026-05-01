import { Skeleton } from "@nest/ui";

export default function OrdersLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div>
        <div className="h-8 w-32 bg-muted rounded-lg" />
        <div className="h-4 w-56 bg-muted rounded mt-2" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 h-20" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 h-16" />
        <div className="rounded-xl border border-border bg-card p-4 h-16" />
      </div>
      <div className="rounded-xl border border-border bg-card h-12" />
      <div className="rounded-xl border border-border bg-card h-96" />
    </div>
  );
}
