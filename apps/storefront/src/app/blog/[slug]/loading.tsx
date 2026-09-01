export default function BlogPostLoading() {
  return (
    <div className="container-nest py-10 animate-pulse">
      <div className="h-7 w-64 bg-[var(--color-border)] rounded-full mb-10" />

      <div className="aspect-[21/9] w-full bg-[var(--color-border)] rounded-2xl mb-10" />

      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <div className="h-5 w-20 bg-[var(--color-border)] rounded-full" />
          <div className="h-5 w-28 bg-[var(--color-border)] rounded-full" />
          <div className="h-5 w-24 bg-[var(--color-border)] rounded-full" />
        </div>

        <div className="h-10 w-full bg-[var(--color-border)] rounded-md mb-3" />
        <div className="h-10 w-3/4 bg-[var(--color-border)] rounded-md mb-8" />

        <div className="space-y-3 mb-8">
          <div className="h-4 w-full bg-[var(--color-border)] rounded" />
          <div className="h-4 w-full bg-[var(--color-border)] rounded" />
          <div className="h-4 w-5/6 bg-[var(--color-border)] rounded" />
          <div className="h-4 w-full bg-[var(--color-border)] rounded" />
          <div className="h-4 w-2/3 bg-[var(--color-border)] rounded" />
        </div>

        <div className="h-8 w-48 bg-[var(--color-border)] rounded-full mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="aspect-[16/10] bg-[var(--color-border)] rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
