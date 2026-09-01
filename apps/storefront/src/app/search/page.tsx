import * as api from "@/lib/api/endpoints"
import { toProductCard } from "@/lib/api/view-model"
import { ProductCard } from "@/components/ProductCard"
import { SearchBar } from "@/components/SearchBar"
import Link from "next/link"
import { Search } from "lucide-react"

export const dynamic = "force-dynamic"

/**
 * Search, on the API.
 *
 * ## The search itself is now the server's, not a `LIKE` over a column
 *
 * `GET /products?q=` runs the frozen search model (`SEARCH-MODEL.md`): a
 * weighted text index over name, SKU, brand and both descriptions, ordered by
 * relevance. Makers search by part number, so SKU is a first-class match rather
 * than an afterthought — which is the difference between `esp32-s3` finding the
 * board and finding nothing.
 *
 * `sort` is left unset deliberately. The API defaults to `relevance` when `q`
 * is present, and naming a sort here would override the ranking the search
 * exists to produce.
 *
 * ## An empty query still renders the prompt, without asking the API anything
 *
 * The early return is unchanged. A search page with no term has nothing to
 * search for, and issuing a request for every product to then render "enter a
 * search term" would be a full catalogue read to display a placeholder.
 */

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function SearchPage(props: SearchPageProps) {
  const searchParams = await props.searchParams
  const query = typeof searchParams.q === "string" ? searchParams.q : ""
  const page = typeof searchParams.page === "string" ? parseInt(searchParams.page, 10) || 1 : 1

  if (!query) {
    return (
      <div className="container-nest py-6">
        <h1 className="text-xl font-heading font-semibold text-foreground mb-4">Search Products</h1>
        <SearchBar />
        <div className="text-center py-16 border border-border rounded-md bg-surface mt-6">
          <Search className="w-10 h-10 text-foreground-subtle mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-foreground mb-1">Search for products</h2>
          <p className="text-foreground-muted text-sm">Enter a search term to find products across our catalog.</p>
        </div>
      </div>
    )
  }

  const result = await api.listProducts({ q: query, page, limit: 24 })

  const products = result.data.map(toProductCard)
  const totalPages = result.meta.totalPages || 1

  return (
    <div className="container-nest py-6">
      <nav className="flex items-center gap-1.5 text-xs text-foreground-muted mb-4" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-primary transition-colors">Home</Link>
        <span>/</span>
        <span className="text-foreground font-medium">Search: {query}</span>
      </nav>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-heading font-semibold text-foreground">Search Results</h1>
          <p className="text-xs text-foreground-muted mt-0.5">{result.meta.total} results for &lsquo;{query}&rsquo;</p>
        </div>
      </div>

      <SearchBar initialQuery={query} />

      <div className="mt-6">
        {products.length === 0 ? (
          <div className="text-center py-16 border border-border rounded-md bg-surface">
            <Search className="w-10 h-10 text-foreground-subtle mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-foreground mb-1">No results for &lsquo;{query}&rsquo;</h2>
            <ul className="text-sm text-foreground-muted space-y-1 mb-5">
              <li>Check your spelling and try again</li>
              <li>Try more general search terms</li>
            </ul>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 btn-primary text-sm px-5 py-2"
            >
              Browse All Products
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1 mt-8">
                {page > 1 && (
                  <Link
                    href={`/search?q=${encodeURIComponent(query)}&page=${page - 1}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-sm text-foreground-muted hover:bg-surface transition-colors"
                  >
                    ‹
                  </Link>
                )}
                {Array.from({ length: totalPages }, (_, i) => i + 1).slice(
                  Math.max(0, page - 3),
                  Math.min(totalPages, page + 2)
                ).map(p => (
                  <Link
                    key={p}
                    href={`/search?q=${encodeURIComponent(query)}&page=${p}`}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-sm text-xs font-medium transition-colors ${
                      p === page
                        ? "bg-primary text-white"
                        : "text-foreground-muted hover:bg-surface"
                    }`}
                  >
                    {p}
                  </Link>
                ))}
                {page < totalPages && (
                  <Link
                    href={`/search?q=${encodeURIComponent(query)}&page=${page + 1}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-sm text-foreground-muted hover:bg-surface transition-colors"
                  >
                    ›
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
