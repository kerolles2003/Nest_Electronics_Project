export default function Loading() {
  return (
    <div className="container-nest py-6">
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-surface-low rounded w-32" />
        <div className="h-8 bg-surface-low rounded w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="bg-surface-low rounded-md aspect-[3/4]" />
          ))}
        </div>
      </div>
    </div>
  );
}
