export default function Loading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="animate-pulse space-y-4 w-full max-w-md px-4">
        <div className="h-8 bg-gray-200 rounded w-32 mx-auto" />
        <div className="h-10 bg-gray-100 rounded" />
        <div className="h-10 bg-gray-100 rounded" />
        <div className="h-10 bg-gray-200 rounded" />
      </div>
    </div>
  );
}
