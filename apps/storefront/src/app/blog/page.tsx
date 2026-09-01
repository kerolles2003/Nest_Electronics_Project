import { getServices } from "@/lib/services";
import { searchParamsCache } from "./search-params";
import { BlogFilters } from "@nest/types";
import Link from "next/link";
import { Metadata } from "next";
import { BlogHero } from "@/components/blog/BlogHero";
import { CategoryPills } from "@/components/blog/CategoryPills";
import { BlogCard } from "@/components/blog/BlogCard";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Blog | Nest Electronics",
  description:
    "Electronics tutorials, maker guides, project ideas, and component comparisons for engineers, students, and hobbyists.",
  alternates: {
    canonical: "https://nest-electronics.com/blog",
  },
};

function buildUrl(
  base: Record<string, string | number | null | undefined>,
  overrides: Record<string, string | number | null | undefined>
) {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value != null && value !== "") {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return `/blog${qs ? `?${qs}` : ""}`;
}

export default async function BlogPage(
  props: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const parsedParams = searchParamsCache.parse(searchParams);

  const { blogService } = await getServices();

  const filters: BlogFilters = {
    category: parsedParams.category ?? undefined,
    tag: parsedParams.tag ?? undefined,
    search: parsedParams.search ?? undefined,
  };

  const page = parsedParams.page;
  const limit = 9;
  const result = await blogService.listPosts(filters, limit, page);
  const categories = await blogService.getAllCategories();
  const tags = await blogService.getAllTags();

  const totalPages = Math.max(result.totalPages, 1);
  const currentParams: Record<string, string | null | undefined> = {
    category: parsedParams.category ?? undefined,
    tag: parsedParams.tag ?? undefined,
    search: parsedParams.search ?? undefined,
  };

  return (
    <div className="container-nest section-gap">
      <BlogHero />

      {categories.length > 0 && (
        <CategoryPills
          categories={categories}
          activeCategory={parsedParams.category ?? undefined}
          currentParams={currentParams}
        />
      )}

      {/* Results info */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-foreground-muted">
          {result.total} {result.total === 1 ? "post" : "posts"} found
          {parsedParams.category ? ` in "${parsedParams.category}"` : ""}
          {parsedParams.tag ? ` tagged #${parsedParams.tag}` : ""}
          {parsedParams.search ? ` matching "${parsedParams.search}"` : ""}
        </p>
        {(parsedParams.category || parsedParams.tag || parsedParams.search) && (
          <Link
            href="/blog"
            className="text-[13px] text-primary font-medium hover:underline"
          >
            Clear filters
          </Link>
        )}
      </div>

      {/* Active tag / category filters */}
      {(parsedParams.category || parsedParams.tag) && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {parsedParams.category && (
            <Link
              href={buildUrl(currentParams, { category: undefined, page: undefined })}
              className="inline-flex items-center gap-1.5 bg-surface text-foreground text-xs rounded-full border border-border px-3 py-1.5 hover:bg-surface-low hover:border-border-strong transition-colors duration-150"
            >
              {parsedParams.category}
              <svg className="w-3 h-3 text-foreground-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </Link>
          )}
          {parsedParams.tag && (
            <Link
              href={buildUrl(currentParams, { tag: undefined, page: undefined })}
              className="inline-flex items-center gap-1.5 bg-surface text-foreground text-xs rounded-full border border-border px-3 py-1.5 hover:bg-surface-low hover:border-border-strong transition-colors duration-150"
            >
              #{parsedParams.tag}
              <svg className="w-3 h-3 text-foreground-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </Link>
          )}
        </div>
      )}

      {/* Post Grid */}
      {result.data.length === 0 ? (
        <div className="text-center py-20 border border-border rounded-md bg-surface">
          <h3 className="text-lg font-medium text-foreground">No posts found</h3>
          <p className="text-foreground-muted mt-1 text-sm">
            Try adjusting your filters or check back soon.
          </p>
          <Link href="/blog" className="inline-flex items-center mt-4 text-sm text-primary hover:text-primary-hover font-medium">
            View all posts
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {result.data.map((post) => (
              <BlogCard key={post.id} post={post} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 mt-10">
              {parsedParams.page > 1 && (
                <Link
                  href={buildUrl(currentParams, { page: parsedParams.page - 1 })}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-sm text-foreground-muted hover:bg-surface transition-colors"
                >
                  ‹
                </Link>
              )}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .slice(
                  Math.max(0, parsedParams.page - 3),
                  Math.min(totalPages, parsedParams.page + 2)
                )
                .map((p) => (
                  <Link
                    key={p}
                    href={buildUrl(currentParams, { page: p })}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-sm text-xs font-medium transition-colors ${
                      p === parsedParams.page
                        ? "bg-primary text-white"
                        : "text-foreground-muted hover:bg-surface"
                    }`}
                  >
                    {p}
                  </Link>
                ))}
              {parsedParams.page < totalPages && (
                <Link
                  href={buildUrl(currentParams, { page: parsedParams.page + 1 })}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-sm text-foreground-muted hover:bg-surface transition-colors"
                >
                  ›
                </Link>
              )}
            </div>
          )}
        </>
      )}

      {/* Popular Tags Section */}
      {tags.length > 0 && (
        <div className="mt-16 pt-10 border-t border-border/50">
          <h2 className="text-lg font-heading font-bold text-foreground mb-4">
            Popular Tags
          </h2>
          <div className="flex flex-wrap gap-2">
            {tags.slice(0, 20).map((t) => (
              <Link
                key={t}
                href={`/blog?tag=${encodeURIComponent(t)}`}
                className={`text-[12px] font-medium px-3 py-1.5 rounded-full transition-all duration-300 border ${
                  parsedParams.tag === t
                    ? "bg-primary text-white border-primary"
                    : "bg-surface-low text-foreground-muted border-border hover:bg-surface hover:text-foreground hover:border-border-strong"
                }`}
              >
                #{t}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
