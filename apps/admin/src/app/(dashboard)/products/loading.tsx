import { Skeleton } from "@nest/ui";

export default function ProductsLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="h-8 w-40 bg-muted rounded-lg" />
          <div className="h-4 w-64 bg-muted rounded mt-2" />
        </div>
        <div className="h-10 w-32 bg-muted rounded-lg" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 h-20" />
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card h-12" />
      <div className="rounded-xl border border-border bg-card h-96" />
    </div>
  );
}
