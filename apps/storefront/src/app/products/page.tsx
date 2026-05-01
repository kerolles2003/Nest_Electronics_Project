import { getServices } from "@/lib/services"
import { searchParamsCache } from "./search-params"
import { ProductCard } from "@nest/ui"
import { ProductFilters } from "@nest/types"
import { FilterSidebar } from "@/components/FilterSidebar"
import { MobileFilterToggle } from "@/components/MobileFilterToggle"
import Link from "next/link"

export const dynamic = "force-dynamic"

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

  const { productService } = await getServices()
  const [categories, brands] = await Promise.all([
    productService.getCategoryTree(),
    productService.getAllBrands()
  ])

  const filters: ProductFilters = {
    search: parsedParams.q || undefined,
    categorySlug: parsedParams.category || undefined,
    brandSlug: parsedParams.brand || undefined,
    minPrice: parsedParams.min_price || undefined,
    maxPrice: parsedParams.max_price || undefined,
    inStockOnly: parsedParams.in_stock || false,
    sort: (parsedParams.sort as ProductFilters['sort']) || "newest"
  }

  const pagination = { page: parsedParams.page, limit: 16 }

  const result = await productService.listProducts(filters, pagination)

  const products = result.data.map(p => ({
    id: p.id,
    slug: p.slug,
    sku: p.sku,
    name: p.name_en,
    brandName: p.brand?.name_en || null,
    categoryName: p.category?.name_en || null,
    imageUrl: p.images?.[0]?.url || null,
    basePrice: p.base_price,
    salePrice: p.sale_price,
    rating: p.avg_rating || 0,
    reviewCount: p.review_count || 0,
    inStock: p.available_stock > 0,
    isFeatured: p.is_featured,
  }))

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

  const totalPages = result.totalPages || 1
  const activeSort = parsedParams.sort || "newest"

  return (
    <div className="container-nest section-gap">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-xs text-foreground-muted mb-4" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-primary transition-colors">Home</Link>
        <span>/</span>
        <span className="text-foreground font-medium">All Products</span>
      </nav>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-foreground-muted">{result.total} products found</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground-muted hidden sm:inline">Sort:</span>
          <div className="flex items-center gap-0.5">
            {sortOptions.map((opt) => (
              <Link
                key={opt.value}
                href={buildUrl(currentParams, { sort: opt.value, page: undefined })}
                className={`px-2 py-1 text-xs rounded-sm transition-colors ${
                  activeSort === opt.value
                    ? "bg-foreground text-white font-medium"
                    : "text-foreground-muted hover:text-foreground hover:bg-surface"
                }`}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-60 shrink-0 hidden lg:block space-y-3">
          <FilterSidebar categories={categories} brands={brands} />
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Active Filters */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <MobileFilterToggle />
            {activeFilters.length > 0 && (
              <>
                {activeFilters.map((f) => (
                  <Link
                    key={f.key}
                    href={f.removeUrl}
                    className="inline-flex items-center gap-1 bg-primary-light text-primary text-xs rounded-full border border-primary/20 px-2.5 py-1 hover:bg-primary/10 transition-colors"
                  >
                    {f.label}
                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
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
