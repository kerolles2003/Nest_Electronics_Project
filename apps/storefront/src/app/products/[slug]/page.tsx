import { getCachedProductBySlug } from "@/lib/services"
import { notFound } from "next/navigation"
import { Metadata } from "next"
import { Star, Check, X, Heart } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { AddToCartButton } from "@/components/AddToCartButton"
import { generateProductJsonLd, generateBreadcrumbJsonLd } from "@/lib/json-ld"
import { SITE_URL } from "@nest/config/constants"
import type { Product as CartProduct } from "@/stores/cart-store"

export const dynamic = "force-dynamic"

function formatPrice(price: number) {
  return `EGP ${Math.round(price).toLocaleString()}`
}

export async function generateMetadata(
  props: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const params = await props.params
  const product = await getCachedProductBySlug(params.slug)

  if (!product) {
    return { title: "Product Not Found" }
  }

  const description = product.seo_description || product.description_en || undefined
  const title = product.seo_title || `${product.name_en} | Nest Electronics`
  const primaryImage = product.images?.[0]?.url
  const isActive = product.is_active !== false

  return {
    title,
    description,
    openGraph: {
      title,
      description: description ?? undefined,
      type: "website",
      url: `${SITE_URL}/products/${product.slug}`,
      images: primaryImage
        ? [{ url: primaryImage, width: 600, height: 600, alt: product.name_en }]
        : [],
    },
    alternates: {
      canonical: `${SITE_URL}/products/${product.slug}`,
    },
    robots: {
      index: isActive,
      follow: isActive,
      googleBot: {
        index: isActive,
        follow: isActive,
      },
    },
  }
}

export default async function ProductDetailPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params

  const productRaw = await getCachedProductBySlug(params.slug)

  if (!productRaw) {
    notFound()
  }

  const product = {
    id: productRaw.id,
    slug: productRaw.slug,
    sku: productRaw.sku,
    name: productRaw.name_en,
    description: productRaw.description_en,
    brand: productRaw.brand ? {
      id: productRaw.brand.id,
      name_en: productRaw.brand.name_en,
      slug: productRaw.brand.slug,
      logo_url: productRaw.brand.logo_url
    } : null,
    category: productRaw.category ? {
      id: productRaw.category.id,
      name_en: productRaw.category.name_en,
      slug: productRaw.category.slug
    } : null,
    images: (productRaw.images || []).map(img => ({
      id: img.id,
      url: img.url,
      altText: img.alt_text,
      isPrimary: img.is_primary
    })).sort((a) => a.isPrimary ? -1 : 1),
    basePrice: productRaw.base_price,
    salePrice: productRaw.sale_price,
    stockQuantity: productRaw.stock_quantity,
    availableStock: productRaw.available_stock,
    rating: productRaw.avg_rating || 0,
    reviewCount: productRaw.review_count || 0,
    attributes: (productRaw.attributes || []).map(attr => ({
      id: attr.id,
      name: attr.attribute?.name_en || "Unknown",
      value: attr.custom_value || attr.value?.value_en || "Unknown"
    }))
  }

  const hasStock = product.availableStock > 0
  const primaryImage = product.images[0]?.url || null
  const jsonLd = generateProductJsonLd({
    name: product.name,
    description: product.description,
    sku: product.sku,
    images: product.images,
    brand: product.brand,
    basePrice: product.basePrice,
    salePrice: product.salePrice,
    availableStock: product.availableStock,
    rating: product.rating,
    reviewCount: product.reviewCount,
  })

  const breadcrumbItems = [
    { name: "Home", url: SITE_URL },
    ...(product.category ? [{ name: product.category.name_en, url: `${SITE_URL}/categories/${product.category.slug}` }] : []),
    { name: product.name, url: `${SITE_URL}/products/${product.slug}` },
  ]
  const breadcrumbJsonLd = generateBreadcrumbJsonLd(breadcrumbItems)

  return (
    <div className="container-nest py-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-foreground-muted mb-6" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-primary transition-colors">Home</Link>
        <span className="text-border-strong">/</span>
        {product.category && (
          <>
            <Link href={`/categories/${product.category.slug}`} className="hover:text-primary transition-colors">
              {product.category.name_en}
            </Link>
            <span className="text-border-strong">/</span>
          </>
        )}
        <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        {/* Left: Images */}
        <div>
          <div className="aspect-square bg-surface rounded-lg flex items-center justify-center p-8 border border-border relative overflow-hidden">
            {primaryImage ? (
              <Image
                src={primaryImage}
                alt={product.images[0]?.altText || product.name}
                fill
                className="object-contain p-4"
                priority
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full bg-surface-low rounded-md">
                <span className="text-4xl font-heading font-bold text-foreground-subtle">{product.name.charAt(0)}</span>
              </div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1 scrollbar-thin">
              {product.images.map(img => (
                <div
                  key={img.id}
                  className={`w-16 h-16 flex-shrink-0 border rounded-md overflow-hidden cursor-pointer transition-colors relative ${
                    img.isPrimary ? "border-primary ring-1 ring-primary" : "border-border hover:border-border-strong"
                  }`}
                >
                  <Image src={img.url} alt={img.altText || ""} fill className="object-cover" sizes="64px" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Info */}
        <div className="flex flex-col gap-5">
          {product.brand && (
            <p className="text-xs font-bold text-primary uppercase tracking-widest mb-1">
              {product.brand.name_en}
            </p>
          )}

          <h1 className="text-2xl font-heading font-semibold text-foreground">{product.name}</h1>

          <div className="flex items-center gap-2">
            <div className="flex">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`w-4 h-4 ${
                    star <= Math.round(product.rating)
                      ? "fill-amber-400 text-amber-400"
                      : "fill-gray-200 text-gray-200"
                  }`}
                />
              ))}
            </div>
            <span className="text-sm font-medium text-foreground">{product.rating.toFixed(1)}</span>
            <span className="text-sm text-foreground-muted">({product.reviewCount} reviews)</span>
          </div>

          <p className="text-xs text-foreground-muted font-mono">SKU: {product.sku}</p>

          <div className="border-y border-border py-4">
            {product.salePrice ? (
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-bold text-primary font-heading">
                  {formatPrice(product.salePrice)}
                </span>
                <span className="text-base text-foreground-muted line-through">
                  {formatPrice(product.basePrice)}
                </span>
                <span className="text-sm font-bold text-danger">
                  -{Math.round(((product.basePrice - product.salePrice) / product.basePrice) * 100)}%
                </span>
              </div>
            ) : (
              <span className="text-3xl font-bold text-primary font-heading">
                {formatPrice(product.basePrice)}
              </span>
            )}
            <div className="flex items-center gap-1.5 mt-2">
              {hasStock ? (
                <>
                  <Check className="w-4 h-4 text-success" />
                  <span className="text-sm text-success font-medium">In Stock</span>
                  <span className="text-xs text-foreground-muted">({product.availableStock} available)</span>
                </>
              ) : (
                <>
                  <X className="w-4 h-4 text-danger" />
                  <span className="text-sm text-danger font-medium">Out of Stock</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <AddToCartButton product={productRaw as unknown as CartProduct} className="flex-1" size="lg" />
          </div>

          <button
            type="button"
            className="flex items-center gap-1.5 text-sm text-foreground-muted hover:text-danger transition-colors w-fit"
          >
            <Heart className="w-4 h-4" />
            Add to Wishlist
          </button>

          {/* Tabs */}
          <div className="mt-4">
            <div className="border-b border-border">
              <div className="flex gap-6">
                <button className="border-b-2 border-primary pb-3 text-sm font-medium text-primary">
                  Description
                </button>
                <button className="pb-3 text-sm text-foreground-muted hover:text-foreground transition-colors">
                  Specifications
                </button>
                <button className="pb-3 text-sm text-foreground-muted hover:text-foreground transition-colors">
                  Reviews
                </button>
              </div>
            </div>
            <div className="py-6">
              {product.description ? (
                <p className="text-foreground-muted leading-relaxed">{product.description}</p>
              ) : (
                <p className="text-foreground-muted italic">No description available.</p>
              )}

              {product.attributes.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-foreground mb-3">Specifications</h3>
                  <table className="w-full text-sm border-collapse">
                    <tbody>
                      {product.attributes.map((attr, i) => (
                        <tr key={attr.id} className={i % 2 === 0 ? 'bg-surface' : 'bg-white'}>
                          <td className="py-2 px-3 text-foreground-muted font-medium w-1/3">{attr.name}</td>
                          <td className="py-2 px-3 text-foreground font-mono">{attr.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
