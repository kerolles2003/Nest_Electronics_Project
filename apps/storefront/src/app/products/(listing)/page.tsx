import * as api from "@/lib/api/endpoints"
import type { ProductQuery } from "@/lib/api/endpoints"
import { toLegacyBrand, toLegacyCategory, toProductCard } from "@/lib/api/view-model"
import { searchParamsCache } from "../search-params"
import { ProductCard } from "@/components/ProductCard"
import { FilterSidebar } from "@/components/FilterSidebar"
import { MobileFilterToggle } from "@/components/MobileFilterToggle"
import Link from "next/link"

export const dynamic = "force-dynamic"

/**
 * The discovery page, on the API.
 *
 * ## Three reads become one round trip plus two cached ones
 *
 * `GET /products` returns the page, the TRUE total and the server-computed
 * facets together. The category and brand lists are separate, but both are
 * public and cached for five minutes, so a filter change costs one uncached
 * call rather than three.
 *
 * ## Prices in the URL are MAJOR units; the API speaks minor
 *
 * `?min_price=100` means 100.00 EGP because that is what the sidebar puts
 * there and what the active-filter chip prints. The conversion happens here,
 * at the boundary, and nowhere else.
 *
 * ## The price slider's bounds are now the TRUE range
 *
 * The old page computed them from the products on the current page, so page 2
 * of a filtered result offered a different range from page 1 and neither was
 * the range of the actual result set. `facets.priceRange` is computed across
 * every match. That is a behaviour change in the direction of correctness, and
 * it is the reason the facets are worth fetching at all.
 */

/**
 * The legacy sort row offers "Featured"; the API has no such sort.
 *
 * `SEARCH-MODEL.md` §5 froze six sorts and `featured` is not among them — the
 * API instead offers `featured` as a FILTER. So this option is mapped to that
 * filter, ordered by `newest`, which is the closest honest behaviour available:
 * a customer who clicks "Featured" wants to see featured products.
 *
 * It is a small semantic change — a sort became a filter — and it is FLAGGED
 * rather than hidden. The alternative that preserves it exactly is a new
 * `featured` value in the API's frozen sort enum, which is a contract change
 * and an owner decision, not something to slip into a read migration.
 */
const FEATURED_SORT = 'featured'

const API_SORTS = new Set(['relevance', 'newest', 'price_asc', 'price_desc', 'rating', 'name_asc'])

function buildUrl(
  base: Record<string, string | number | boolean | null | undefined>,
  overrides: Record<string, string | number | null | undefined>
) {
  const merged = { ...base, ...overrides }
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(merged)) {
    if (value != null && value !== "" && value !== false) {
      params.set(key, String(value))
    }
  }
  const qs = params.toString()
  return `/products${qs ? `?${qs}` : ""}`
}

function buildUrlExcluding(
  base: Record<string, string | number | boolean | null | undefined>,
  excludeKeys: string[]
) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(base)) {
    if (!excludeKeys.includes(key) && value != null && value !== "" && value !== false) {
      params.set(key, String(value))
    }
  }
  const qs = params.toString()
  return `/products${qs ? `?${qs}` : ""}`
}

const sortOptions = [
  { value: "newest", label: "Newest" },
  { value: "featured", label: "Featured" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "rating", label: "Top Rated" },
  { value: "name_asc", label: "Name: A-Z" },
]

export default async function ProductsPage(
  props: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
  }
) {
  const searchParams = await props.searchParams
  const parsedParams = searchParamsCache.parse(searchParams)

  const wantsFeatured = parsedParams.sort === FEATURED_SORT

  const query: ProductQuery = {
    page: parsedParams.page,
    limit: 16,
    ...(parsedParams.q ? { q: parsedParams.q } : {}),
    ...(parsedParams.category ? { category: parsedParams.category } : {}),
    // Repeatable on the wire and ORed within itself, so an array even for one.
    ...(parsedParams.brand ? { brand: [parsedParams.brand] } : {}),
    // Major units in the URL, minor units on the wire. One conversion, here.
    ...(parsedParams.min_price ? { minPrice: parsedParams.min_price * 100 } : {}),
    ...(parsedParams.max_price ? { maxPrice: parsedParams.max_price * 100 } : {}),
    ...(parsedParams.in_stock ? { inStock: true } : {}),
    ...(wantsFeatured ? { featured: true } : {}),
    // An unrecognised `?sort=` in the URL would be a 400 UNSUPPORTED_SORT, and
    // a hand-edited address bar should not produce an error page.
    sort: (API_SORTS.has(parsedParams.sort)
      ? parsedParams.sort
      : 'newest') as ProductQuery['sort'],
  }

  const [categoryList, brandList, result] = await Promise.all([
    api.listCategories(),
    api.listBrands(),
    api.listProducts(query),
  ])

  const categories = categoryList.data.map(toLegacyCategory)
  const brands = brandList.data.map(toLegacyBrand)
  const products = result.data.map(toProductCard)

  const currentParams = {
    q: parsedParams.q || undefined,
    category: parsedParams.category || undefined,
    brand: parsedParams.brand || undefined,
    min_price: parsedParams.min_price || undefined,
    max_price: parsedParams.max_price || undefined,
    in_stock: parsedParams.in_stock || undefined,
    sort: parsedParams.sort || undefined,
  }

  const activeFilters: { key: string; label: string; removeUrl: string }[] = []
  if (parsedParams.category) {
    const cat = categories.find(c => c.slug === parsedParams.category)
    activeFilters.push({ key: "category", label: cat?.name_en || parsedParams.category, removeUrl: buildUrlExcluding(currentParams, ["category"]) })
  }
  if (parsedParams.brand) {
    const brand = brands.find(b => b.slug === parsedParams.brand)
    activeFilters.push({ key: "brand", label: brand?.name_en || parsedParams.brand, removeUrl: buildUrlExcluding(currentParams, ["brand"]) })
  }
  if (parsedParams.min_price || parsedParams.max_price) {
    const label = [parsedParams.min_price ? `EGP ${parsedParams.min_price}` : "", parsedParams.max_price ? `EGP ${parsedParams.max_price}` : ""].filter(Boolean).join(" – ")
    activeFilters.push({ key: "price", label, removeUrl: buildUrlExcluding(currentParams, ["min_price", "max_price"]) })
  }
  if (parsedParams.in_stock) {
    activeFilters.push({ key: "in_stock", label: "In Stock", removeUrl: buildUrlExcluding(currentParams, ["in_stock"]) })
  }

  const totalPages = result.meta.totalPages || 1
  const activeSort = parsedParams.sort || "newest"

  // From the FACET, which spans every match, not just this page. Converted to
  // major units because that is what the slider and the URL use.
  const priceRange = result.facets.priceRange === null
    ? { min: 0, max: 10000 }
    : {
        min: Math.floor(result.facets.priceRange.min.amount / 100),
        max: Math.ceil(result.facets.priceRange.max.amount / 100),
      }

  const activeFilterCount = activeFilters.length

  return (
    <div className="container-nest section-gap">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-xs text-foreground-muted mb-4" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-primary transition-colors">Home</Link>
        <svg className="w-3 h-3 text-foreground-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        <span className="text-foreground font-medium">All Products</span>
      </nav>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-foreground-muted">{result.meta.total} products found</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground-muted hidden sm:inline">Sort:</span>
          <div className="flex items-center gap-0.5">
            {sortOptions.map((opt) => (
              <Link
                key={opt.value}
                href={buildUrl(currentParams, { sort: opt.value, page: undefined })}
                className={`px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
                  activeSort === opt.value
                    ? "bg-foreground text-white rounded-full"
                    : "text-foreground-muted hover:text-foreground hover:bg-surface rounded-md"
                }`}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Desktop Sidebar */}
        <div className="w-60 shrink-0 hidden lg:block space-y-3">
          <FilterSidebar categories={categories} brands={brands} priceRange={priceRange} totalResults={result.meta.total} />
        </div>

        {/* Mobile Filter Sidebar (hidden on desktop, shows drawer on mobile) */}
        <div className="lg:hidden">
          <FilterSidebar categories={categories} brands={brands} priceRange={priceRange} totalResults={result.meta.total} />
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Active Filters */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <MobileFilterToggle activeFilterCount={activeFilterCount} />
            {activeFilters.length > 0 && (
              <>
                {activeFilters.map((f) => (
                  <Link
                    key={f.key}
                    href={f.removeUrl}
                    className="inline-flex items-center gap-1.5 bg-surface text-foreground text-xs rounded-full border border-border px-3 py-1.5 hover:bg-surface-low hover:border-border-strong transition-colors duration-150"
                  >
                    {f.label}
                    <svg className="w-3 h-3 text-foreground-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </Link>
                ))}
                {activeFilters.length > 1 && (
                  <Link href="/products" className="text-xs text-danger hover:underline">
                    Clear All
                  </Link>
                )}
              </>
            )}
          </div>

          {/* Product Grid */}
          {products.length === 0 ? (
            <div className="text-center py-20 border border-border rounded-md bg-surface">
              <h3 className="text-lg font-medium text-foreground">No products found</h3>
              <p className="text-foreground-muted mt-1 text-sm">Try adjusting your filters or search query.</p>
              <Link href="/products" className="inline-flex items-center mt-4 text-sm text-primary hover:text-primary-hover font-medium">
                View All Products
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {products.map(product => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-1 mt-8">
                  {parsedParams.page > 1 && (
                    <Link
                      href={buildUrl(currentParams, { page: parsedParams.page - 1 })}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-sm text-foreground-muted hover:bg-surface transition-colors"
                    >
                      ‹
                    </Link>
                  )}
                  {Array.from({ length: totalPages }, (_, i) => i + 1).slice(
                    Math.max(0, parsedParams.page - 3),
                    Math.min(totalPages, parsedParams.page + 2)
                  ).map(page => (
                    <Link
                      key={page}
                      href={buildUrl(currentParams, { page })}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-sm text-xs font-medium transition-colors ${
                        page === parsedParams.page
                          ? "bg-primary text-white"
                          : "text-foreground-muted hover:bg-surface"
                      }`}
                    >
                      {page}
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
        </div>
      </div>
    </div>
  )
}
