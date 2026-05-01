export default function Loading() {
  return (
    <div className="container-nest py-6">
      <div className="animate-pulse">
        <div className="h-4 bg-surface-low rounded w-48 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="aspect-square bg-surface-low rounded-md" />
          <div className="space-y-4">
            <div className="h-6 bg-surface-low rounded w-3/4" />
            <div className="h-4 bg-surface-low rounded w-1/2" />
            <div className="h-8 bg-surface-low rounded w-1/3" />
            <div className="h-10 bg-surface-low rounded w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
