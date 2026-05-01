export default function Loading() {
  return (
    <div className="container-marketplace py-6">
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-gray-200 rounded w-48" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-sm" />
          ))}
        </div>
      </div>
    </div>
  );
}
