import * as api from "@/lib/api/endpoints"
import { ApiError } from "@/lib/api/errors"
import { imageUrl } from "@/lib/images"
import { toProductCard } from "@/lib/api/view-model"
import { notFound } from "next/navigation"
import { Metadata } from "next"
import { Star, Check, X, Heart } from "lucide-react"
import { ProductCard } from "@/components/ProductCard"
import Image from "next/image"
import Link from "next/link"
import { AddToCartButton } from "@/components/AddToCartButton"
import { WishlistButton } from "@/components/WishlistButton"
import { generateProductJsonLd, generateBreadcrumbJsonLd } from "@/lib/json-ld"
import { SITE_URL } from "@nest/config/constants"
import type { ProductDetail } from "@/lib/api/types"

export const dynamic = "force-dynamic"

/**
 * One product, on the API.
 *
 * ## Reads moved; markup untouched
 *
 * The gallery, the badges, the price block, the tabs and the specification
 * table are all as they were. What HAS changed is the cart: `AddToCartButton`
 * now takes an id and a stock number instead of a fabricated product object
 * carrying prices, because the cart is the API's and the client no longer holds
 * a price for anything.
 *
 * ## Specifications come from `specs`, not from Supabase `attributes`
 *
 * The legacy shape was a join table of attribute rows. The API returns
 * `specs: [{ key, label, value, unit, filterable }]` on the detail response —
 * the same information, already resolved, and with the UNIT the legacy shape
 * had nowhere to put. The table renders `value unit` where a unit exists, which
 * is why the seed's `240 MHz` and `±1 %` now read as they should.
 *
 * ## The gallery is finally reachable
 *
 * `images.length > 1` was dead code as far as the seed was concerned — no
 * product had any image at all. Step 0 extended the seed with single-image and
 * three-image products precisely so this branch, and the primary-image border,
 * can be exercised. The bytes still do not resolve without a Cloudinary
 * account; the LAYOUT is driven by real counts and real dimensions either way.
 */

function formatPrice(price: number) {
  return `EGP ${Math.round(price).toLocaleString()}`
}

/**
 * The product, or `null` when the API says there is no such slug.
 *
 * Only `PRODUCT_NOT_FOUND` becomes `null`; an outage is rethrown, so a broken
 * API renders an error rather than a convincing "this product does not exist".
 * Inactive and soft-deleted products answer 404 too — identical to a slug that
 * never existed, so an id can never become an existence oracle.
 */
async function findProduct(slug: string): Promise<ProductDetail | null> {
  try {
    return (await api.getProduct(slug)).data
  } catch (error) {
    if (error instanceof ApiError && error.code === 'PRODUCT_NOT_FOUND') return null
    throw error
  }
}

export async function generateMetadata(
  props: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const params = await props.params
  const product = await findProduct(params.slug)

  if (product === null) {
    return { title: "Product Not Found" }
  }

  const description = product.shortDescription ?? product.description ?? undefined
  const title = `${product.name} | Nest Electronics`
  const primaryImage = imageUrl(product.primaryImage, 'detail')
  // The API only ever returns products that are live: inactive and soft-deleted
  // ones answer 404. Reaching this line therefore means indexable.
  const isActive = true

  return {
    title,
    description,
    openGraph: {
      title,
      description: description ?? undefined,
      type: "website",
      url: `${SITE_URL}/products/${product.slug}`,
      images: primaryImage
        ? [{
            url: primaryImage,
            width: product.primaryImage?.width ?? 600,
            height: product.primaryImage?.height ?? 600,
            alt: product.primaryImage?.alt ?? product.name,
          }]
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

  const detail = await findProduct(params.slug)

  if (detail === null) {
    notFound()
  }

  const product = {
    id: detail.id,
    slug: detail.slug,
    sku: detail.sku,
    name: detail.name,
    description: detail.description,
    brand: detail.brand
      ? { id: detail.brand.id, name_en: detail.brand.name, slug: detail.brand.slug, logo_url: null }
      : null,
    category: { id: detail.category.id, name_en: detail.category.name, slug: detail.category.slug },

    /*
     * Already ordered by the server, with exactly one primary.
     *
     * The old code re-sorted with `.sort((a) => a.isPrimary ? -1 : 1)`, which is
     * not a valid comparator — it ignores its second argument, so the result
     * depends on the engine's sort implementation rather than on the data. The
     * API guarantees the ordering instead (MEDIA-MODEL.md §9.2: one atomic
     * write maintains `sortOrder` and exactly one `isPrimary`), so there is
     * nothing left to sort.
     */
    images: detail.images.map((image, index) => ({
      id: image.publicId,
      url: imageUrl(image, index === 0 ? 'detail' : 'gallery'),
      altText: image.alt,
      isPrimary: index === 0,
      width: image.width,
      height: image.height,
    })),

    basePrice: detail.pricing.basePrice.amount / 100,
    salePrice: detail.pricing.salePrice === null ? null : detail.pricing.salePrice.amount / 100,
    stockOnHand: detail.stockOnHand,
    availableStock: detail.stockOnHand,
    rating: detail.rating.average / 100,
    reviewCount: detail.rating.count,

    // `specs` carries a unit the legacy attribute join had nowhere to put.
    attributes: detail.specs.map((spec) => ({
      id: spec.key,
      name: spec.label,
      value: spec.unit === null ? spec.value : `${spec.value} ${spec.unit}`,
    })),
  }

  // From `availability`, not from the raw count: the API decides what "in
  // stock" means, and a page that made that judgement itself would eventually
  // disagree with the badge on the card that linked to it.
  const hasStock = detail.availability !== 'OUT_OF_STOCK'
  const primaryImage = product.images[0]?.url ?? null
  const jsonLd = generateProductJsonLd({
    name: product.name,
    description: product.description,
    sku: product.sku,
    // Only images that RESOLVE. With no CDN configured `imageUrl` returns null,
    // and structured data naming an image with no URL is worse than structured
    // data with no image — a crawler reports it as invalid.
    images: product.images.filter((image): image is typeof image & { url: string } => image.url !== null),
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
      <nav className="flex items-center gap-2 text-[13px] font-medium text-foreground-muted mb-8 bg-surface-low px-4 py-2.5 rounded-full inline-flex border border-border/50" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-primary transition-colors duration-300 flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          Home
        </Link>
        <span className="w-1 h-1 rounded-full bg-border-strong mx-1" />
        {product.category && (
          <>
            <Link href={`/categories/${product.category.slug}`} className="hover:text-primary transition-colors duration-300">
              {product.category.name_en}
            </Link>
            <span className="w-1 h-1 rounded-full bg-border-strong mx-1" />
          </>
        )}
        <span className="text-foreground truncate max-w-[200px] md:max-w-md">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 mb-16">
        {/* Left: Images */}
        <div className="lg:col-span-5">
          <div className="aspect-[4/5] bg-card rounded-3xl flex items-center justify-center p-8 border border-border/50 relative overflow-hidden group shadow-sm">
            {/* Badges inside Image */}
            <div className="absolute left-5 top-5 z-10 flex flex-col gap-2">
              {product.salePrice && product.basePrice > product.salePrice && (
                <div className="bg-danger text-white text-[12px] font-black px-2.5 py-1 rounded-sm shadow-sm flex items-center gap-1 tracking-wide">
                  -{Math.round(((product.basePrice - product.salePrice) / product.basePrice) * 100)}%
                </div>
              )}
              {hasStock ? (
                <div className="bg-success/10 text-success text-[12px] font-bold px-2.5 py-1 rounded-sm border border-success/20 tracking-wide">
                  IN STOCK
                </div>
              ) : (
                <div className="bg-foreground-disabled/20 text-foreground text-[12px] font-bold px-2.5 py-1 rounded-sm tracking-wide">
                  OUT OF STOCK
                </div>
              )}
            </div>

            {primaryImage ? (
              <Image
                src={primaryImage}
                alt={product.images[0]?.altText ?? product.name}
                fill
                className="object-contain p-8 transition-transform duration-700 ease-out group-hover:scale-110"
                priority
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full">
                <span className="text-6xl font-black text-foreground-disabled/20 uppercase tracking-tighter select-none">{product.name.charAt(0)}</span>
              </div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="flex gap-3 mt-4 overflow-x-auto pb-2 scrollbar-none">
              {product.images.map(img => (
                <div
                  key={img.id}
                  className={`w-20 h-20 flex-shrink-0 rounded-xl overflow-hidden cursor-pointer transition-all duration-300 relative ${
                    img.isPrimary 
                      ? "border-2 border-primary shadow-sm scale-100" 
                      : "border border-border opacity-70 hover:opacity-100 hover:border-border-strong hover:shadow-sm scale-95 hover:scale-100"
                  }`}
                >
                  {img.url !== null && (
                    <Image src={img.url} alt={img.altText ?? ""} fill className="object-cover" sizes="80px" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Info */}
        <div className="lg:col-span-7 flex flex-col pl-0 lg:pl-6">
          {product.brand && (
            <Link href={`/brands/${product.brand.slug}`} className="inline-block text-[13px] font-bold text-primary uppercase tracking-widest mb-2 hover:underline">
              {product.brand.name_en}
            </Link>
          )}

          <h1 className="text-3xl lg:text-4xl font-black text-foreground leading-[1.2] mb-4 tracking-tight">{product.name}</h1>

          <div className="flex items-center gap-4 mb-6">
            <div className="flex items-center gap-1 bg-surface-low px-2.5 py-1 rounded-md border border-border/50">
              <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
              <span className="text-sm font-bold text-foreground">{product.rating.toFixed(1)}</span>
            </div>
            <span className="text-sm text-foreground-muted hover:text-primary transition-colors cursor-pointer border-b border-border hover:border-primary">
              {product.reviewCount} verified reviews
            </span>
            <div className="w-px h-4 bg-border"></div>
            <p className="text-sm text-foreground-muted">SKU: <span className="font-mono text-foreground font-medium">{product.sku}</span></p>
          </div>

          <div className="py-6 border-y border-border/50 mb-8">
            {product.salePrice ? (
              <div className="flex items-end gap-3 flex-wrap">
                <span className="text-4xl lg:text-5xl font-black text-primary leading-none tracking-tight">
                  {formatPrice(product.salePrice)} <span className="text-xl font-bold">EGP</span>
                </span>
                <span className="text-lg font-medium text-foreground-subtle line-through leading-relaxed mb-1">
                  {formatPrice(product.basePrice)} EGP
                </span>
              </div>
            ) : (
              <span className="text-4xl lg:text-5xl font-black text-foreground leading-none tracking-tight">
                {formatPrice(product.basePrice)} <span className="text-xl font-bold">EGP</span>
              </span>
            )}
            
            <p className="text-[13px] text-foreground-muted mt-3 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              Price includes VAT.
            </p>
          </div>

          {/* Action Row */}
          <div className="flex items-center gap-4 mb-8">
            {/*
              * `stockOnHand` is the real count — the detail endpoint returns it
              * for exactly this reason — but it only decides whether the button
              * is disabled. The API re-clamps on every write, because a number
              * read at render time is already out of date by the time somebody
              * clicks it.
              */}
            <AddToCartButton
              productId={detail.id}
              availableStock={detail.stockOnHand}
              className="flex-1 max-w-[300px] h-14 rounded-2xl font-bold text-base tracking-wide"
              size="lg"
            />
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl border border-border hover:border-primary transition-colors cursor-pointer text-foreground-muted hover:text-primary">
              <WishlistButton />
            </div>
          </div>

          {/* Features / Trust Badges */}
          <div className="grid grid-cols-2 gap-4 py-6 bg-surface-low/50 rounded-2xl border border-border/50 px-6 mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </div>
              <div className="flex flex-col">
                <span className="text-[13px] font-bold text-foreground">Fast Delivery</span>
                <span className="text-[11px] text-foreground-muted">2-3 business days</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              </div>
              <div className="flex flex-col">
                <span className="text-[13px] font-bold text-foreground">Secure Payment</span>
                <span className="text-[11px] text-foreground-muted">100% safe checkout</span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-4">
            <div className="flex gap-6 border-b border-border/50">
              <button className="relative pb-4 text-[15px] font-bold text-foreground after:content-[''] after:absolute after:bottom-[-1px] after:left-0 after:w-full after:h-[2px] after:bg-primary transition-colors">
                Description
              </button>
              <button className="relative pb-4 text-[15px] font-semibold text-foreground-muted hover:text-foreground transition-colors duration-300">
                Specifications
              </button>
              <button className="relative pb-4 text-[15px] font-semibold text-foreground-muted hover:text-foreground transition-colors duration-300 flex items-center gap-2">
                Reviews
                <span className="bg-surface-low text-foreground-subtle text-[11px] font-bold px-1.5 py-0.5 rounded-sm">{product.reviewCount}</span>
              </button>
            </div>
            
            <div className="py-8 prose prose-sm max-w-none text-foreground-muted">
              {product.description ? (
                <div className="leading-relaxed whitespace-pre-line text-[15px]">{product.description}</div>
              ) : (
                <p className="italic">No description available.</p>
              )}

              {product.attributes.length > 0 && (
                <div className="mt-10">
                  <h3 className="text-lg font-bold text-foreground mb-4">Specifications</h3>
                  <div className="rounded-2xl border border-border/50 overflow-hidden">
                    <table className="w-full text-[14px] border-collapse">
                      <tbody>
                        {product.attributes.map((attr, idx) => (
                          <tr key={attr.id} className={idx % 2 === 0 ? "bg-surface-low/30" : "bg-transparent"}>
                            <td className="py-3 px-5 text-foreground-muted font-semibold w-1/3 border-b border-border/30">{attr.name}</td>
                            <td className="py-3 px-5 text-foreground font-medium border-b border-border/30">{attr.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Related Products Section */}
      <RelatedProducts slug={product.slug} />
    </div>
  )
}

/**
 * Related products, from the endpoint that exists for it.
 *
 * `GET /products/:slug/related` returns up to 8 in the same category, ordered
 * by sales, WITH THIS PRODUCT ALREADY EXCLUDED. The old code asked for the
 * category's first five and filtered the current product out client-side, which
 * meant asking for one more than it needed and getting four or five depending
 * on where the product happened to sort — a row that silently changed length.
 */
async function RelatedProducts({ slug }: { slug: string }) {
  const related = await api.getRelatedProducts(slug);
  const products = related.data.slice(0, 4).map(toProductCard);

  if (products.length === 0) return null;

  return (
    <div className="mt-16 border-t border-border pt-12">
      <h2 className="text-xl font-heading font-semibold text-foreground mb-6">Related Products</h2>
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {products.map(product => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}
