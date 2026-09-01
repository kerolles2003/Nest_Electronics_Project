import Link from "next/link";

interface CategoryPillsProps {
  categories: string[];
  activeCategory?: string;
  currentParams: Record<string, string | null | undefined>;
}

export function CategoryPills({ categories, activeCategory, currentParams }: CategoryPillsProps) {
  return (
    <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2 scrollbar-none">
      <Link
        href="/blog"
        className={`flex-shrink-0 px-4 py-2 rounded-full text-[13px] font-semibold transition-all duration-300 border ${
          !activeCategory
            ? "bg-primary text-white border-primary"
            : "bg-surface-low text-foreground-muted border-border hover:bg-surface hover:text-foreground"
        }`}
      >
        All
      </Link>
      {categories.map((cat) => (
        <Link
          key={cat}
          href={buildPillUrl(currentParams, cat)}
          className={`flex-shrink-0 px-4 py-2 rounded-full text-[13px] font-semibold transition-all duration-300 border ${
            activeCategory === cat
              ? "bg-primary text-white border-primary"
              : "bg-surface-low text-foreground-muted border-border hover:bg-surface hover:text-foreground"
          }`}
        >
          {cat}
        </Link>
      ))}
    </div>
  );
}

function buildPillUrl(
  currentParams: Record<string, string | null | undefined>,
  category: string,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(currentParams)) {
    if (key !== "category" && key !== "tag" && value != null && value !== "") {
      params.set(key, String(value));
    }
  }
  params.set("category", category);
  return `/blog?${params.toString()}`;
}
