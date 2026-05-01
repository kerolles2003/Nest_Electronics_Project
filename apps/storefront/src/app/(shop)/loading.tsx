export default function Loading() {
  return (
    <div className="container-marketplace py-6">
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-gray-200 rounded w-32" />
        <div className="h-8 bg-gray-200 rounded w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-sm aspect-[3/4]" />
          ))}
        </div>
      </div>
    </div>
  );
}
