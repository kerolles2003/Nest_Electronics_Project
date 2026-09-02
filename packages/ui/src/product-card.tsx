"use client"

import * as React from "react"
import { Heart, Star, ShoppingCart, Loader2 } from "lucide-react"
import { type ProductCardDTO } from "@nest/types"
import { cn } from "./utils"

export interface ProductCardProps extends React.HTMLAttributes<HTMLDivElement> {
  product: ProductCardDTO
  variant?: "grid" | "list"
  onAddToCart?: (product: ProductCardDTO) => void
  onWishlist?: (product: ProductCardDTO) => void
  isWishlisted?: boolean
  isAddingToCart?: boolean
}

function formatPrice(price: number) {
  return Math.round(price).toLocaleString()
}

function StarRating({ rating, count }: { rating: number; count: number }) {
  if (!rating && !count) return null

  const fullStars = Math.floor(rating)
  const hasHalf = rating - fullStars >= 0.5

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              "w-[13px] h-[13px] transition-colors duration-150",
              star <= fullStars
                ? "fill-[#EABE12] text-[#EABE12]"
                : star === fullStars + 1 && hasHalf
                  ? "fill-[#EABE12] text-[#EABE12] opacity-60"
                  : "fill-[var(--color-foreground-disabled)] text-[var(--color-foreground-disabled)]"
            )}
          />
        ))}
      </div>
      {count > 0 && (
        <span className="text-[10px] text-foreground-muted font-semibold leading-none opacity-80">
          {count}
        </span>
      )}
    </div>
  )
}

export function ProductCard({
  product,
  variant = "grid",
  className,
  onAddToCart,
  onWishlist,
  isWishlisted = false,
  isAddingToCart = false,
  ...props
}: ProductCardProps) {
  /**
   * The image fades in once it has loaded — and "has loaded" must be asked of
   * the DOM, not waited for.
   *
   * This card is server-rendered, so the browser starts fetching the `<img>`
   * as soon as the HTML arrives and very often finishes BEFORE React hydrates.
   * The `load` event has then already fired by the time `onLoad` is attached,
   * the state never flips, and the image sits at `opacity-0` for the life of
   * the page: bytes fetched, decoded, laid out, and invisible.
   *
   * That is what the storefront was doing. Every product image in every grid,
   * rail and search result was blank — and it was blank in precisely the
   * conditions that matter most, because the faster the image arrives the more
   * certainly the event is missed. A slow first load looked fine; a reload from
   * cache showed nothing.
   *
   * `img.complete` is the authoritative answer to "did this already load", so
   * the effect asks it once on mount. `onLoad` still handles the ordinary case
   * where the fetch is still in flight.
   */
  const imgRef = React.useRef<HTMLImageElement | null>(null)
  const [imgLoaded, setImgLoaded] = React.useState(false)

  React.useEffect(() => {
    // `naturalWidth` distinguishes "loaded" from "failed": a broken image is
    // also `complete`, and fading one in would replace the letter placeholder
    // with nothing at all.
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) setImgLoaded(true)
  }, [product.imageUrl])

  const outOfStock = !product.inStock
  const onSale = product.salePrice != null && product.salePrice < product.basePrice
  const discount = onSale ? Math.round(((product.basePrice - product.salePrice!) / product.basePrice) * 100) : 0

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!outOfStock && !isAddingToCart) {
      onAddToCart?.(product)
    }
  }

  const handleWishlist = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onWishlist?.(product)
  }

  if (variant === "list") {
    return (
      <div
        className={cn(
          "group flex items-center gap-4 py-2.5 px-2 rounded-sm transition-colors duration-150 hover:bg-card border border-transparent hover:border-[var(--color-border)]",
          className
        )}
        {...props}
      >
        {/* Thumbnail */}
        <a href={`/products/${product.slug}`} className="w-20 h-24 shrink-0 bg-surface-low rounded-sm overflow-hidden p-2 flex items-center justify-center relative group/img focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {product.imageUrl ? (
            <img
              ref={imgRef}
              src={product.imageUrl}
              alt={product.name}
              className={cn(
                "h-full w-full object-contain transition-opacity duration-150",
                imgLoaded ? "opacity-100" : "opacity-0"
              )}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-surface-low">
              <span className="text-xl font-black text-foreground-disabled/50 uppercase">{product.name.charAt(0)}</span>
            </div>
          )}
          {onSale && (
            <div className="absolute top-0 left-0 bg-primary text-white text-[9px] font-black px-1.5 py-0.5 rounded-br-sm z-10">
              SALE
            </div>
          )}
        </a>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <a href={`/products/${product.slug}`} className="block">
            <h3 className="text-[14px] font-bold text-foreground leading-[1.2] line-clamp-2 hover:text-primary transition-colors">
              {product.name}
            </h3>
          </a>

          <div className="mt-2 flex items-center gap-3">
            {onSale ? (
              <div className="flex items-baseline gap-2">
                <span className="text-[14px] font-black text-primary">
                  {formatPrice(product.salePrice!)} EGP
                </span>
                <span className="text-[11px] text-foreground-subtle line-through">
                  {formatPrice(product.basePrice)}
                </span>
              </div>
            ) : (
              <span className="text-[14px] font-black text-foreground">
                {formatPrice(product.basePrice)} EGP
              </span>
            )}
          </div>
          <div className="mt-1.5 flex min-h-[15px] items-center gap-2">
            <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
              {product.categoryName || product.brandName || "Component"}
            </span>
            <StarRating rating={product.rating} count={product.reviewCount} />
          </div>
        </div>

        {/* Action */}
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={outOfStock || isAddingToCart}
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-sm transition-colors duration-150 flex-shrink-0",
            outOfStock
              ? "bg-[var(--color-border)] text-foreground-subtle cursor-not-allowed"
              : "bg-primary text-white hover:bg-primary-hover"
          )}
          title={outOfStock ? "Out of Stock" : "Add to Cart"}
          aria-label={outOfStock ? `${product.name} is out of stock` : `Add ${product.name} to cart`}
        >
          {isAddingToCart ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" strokeWidth={2.5} />}
        </button>
      </div>
    )
  }

  /* Grid variant */
  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-none h-full border-b border-[var(--color-border)] pb-4 transition-colors duration-150 hover:bg-[#F9F9F9]",
        className
      )}
      {...props}
    >
      {/* Image Container */}
      <div className="relative aspect-[4/5] bg-surface-low overflow-hidden p-4 flex items-center justify-center">
        <a href={`/products/${product.slug}`} className="relative z-0 block h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {product.imageUrl ? (
            <img
              ref={imgRef}
              src={product.imageUrl}
              alt={product.name}
              className={cn(
                "h-full w-full object-contain transition-transform duration-200 ease-out group-hover:scale-[1.03]",
                imgLoaded ? "opacity-100" : "opacity-0"
              )}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-sm">
              <span className="text-5xl font-black text-foreground-disabled/20 uppercase tracking-tighter select-none">{product.name.charAt(0)}</span>
            </div>
          )}
        </a>

        <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5">
          {onSale && discount > 0 && (
            <div className="bg-[#E14A5C] text-white text-[12px] font-normal px-2 py-1 rounded-[4px] flex items-center gap-1 tracking-wide uppercase">
              -{discount}%
            </div>
          )}
        </div>

        {onWishlist && (
          <button
            type="button"
            onClick={handleWishlist}
            className={cn(
              "absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-sm border border-[var(--color-border)] bg-white text-foreground-muted transition-colors duration-150 hover:border-primary/40 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              isWishlisted && "border-primary/40 bg-primary-light text-primary"
            )}
            title={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
            aria-label={isWishlisted ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
            aria-pressed={isWishlisted}
          >
            <Heart className={cn("h-[17px] w-[17px]", isWishlisted && "fill-current")} />
          </button>
        )}

      </div>

      <div className="pt-3 flex flex-col flex-1 relative z-10">
        <div className="flex flex-col flex-1">
          <a href={`/products/${product.slug}`} className="block group/title focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <h3 className="text-[14px] font-bold text-foreground leading-[1.32] line-clamp-2 min-h-[38px] group-hover/title:text-primary transition-colors duration-150">
              {product.name}
            </h3>
          </a>

          <div className="mt-3 flex items-baseline gap-2">
            {onSale ? (
              <>
                <span className="text-[18px] font-black text-primary leading-none">
                  {formatPrice(product.salePrice!)} <span className="text-[12px] font-bold">EGP</span>
                </span>
                <span className="text-[13px] font-medium text-foreground-subtle line-through leading-none">
                  {formatPrice(product.basePrice)} EGP
                </span>
              </>
            ) : (
              <span className="text-[18px] font-black text-foreground leading-none">
                {formatPrice(product.basePrice)} <span className="text-[12px] font-bold">EGP</span>
              </span>
            )}
          </div>

          <div className="mt-2 flex min-h-[16px] items-center justify-between gap-2">
            <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
              {product.categoryName || product.brandName || "Component"}
            </span>
            <StarRating rating={product.rating} count={product.reviewCount} />
          </div>
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={outOfStock || isAddingToCart}
            className={cn(
              "w-full min-h-[44px] rounded-[35px] font-semibold text-[13px] tracking-wide flex items-center justify-center gap-2 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              outOfStock
                ? "bg-[var(--color-border)] text-foreground-subtle cursor-not-allowed"
                : "bg-primary text-white hover:bg-primary-hover"
            )}
            aria-label={outOfStock ? `${product.name} is sold out` : `Add ${product.name} to cart`}
          >
            {isAddingToCart ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <ShoppingCart className="w-4 h-4" strokeWidth={2.5} />
                {outOfStock ? "Sold Out" : "Add to Cart"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ProductCardSkeleton() {
  return (
    <div className="rounded-none flex flex-col border-b border-[var(--color-border)] pb-[15px] h-full animate-pulse">
      <div className="aspect-[4/5] bg-surface" />
      <div className="pt-3 flex flex-col flex-1 gap-3">
        <div className="flex justify-between">
          <div className="h-2 bg-surface w-1/4 rounded-full" />
          <div className="h-2 bg-surface w-1/5 rounded-full" />
        </div>
        <div className="space-y-2 mt-2">
          <div className="h-3 bg-surface w-full rounded-full" />
          <div className="h-3 bg-surface w-2/3 rounded-full" />
        </div>
        <div className="mt-auto pt-4 border-t border-[var(--color-border)] flex justify-between items-center">
          <div className="h-5 bg-surface w-24 rounded-full" />
        </div>
      </div>
    </div>
  )
}

export function ProductListSkeleton() {
  return (
    <div className="flex items-center gap-4 py-4 px-3 border border-transparent animate-pulse">
      <div className="w-20 h-24 bg-surface rounded-sm flex-shrink-0" />
      <div className="flex-1 space-y-3">
        <div className="h-2 bg-surface w-1/4 rounded-full" />
        <div className="space-y-2">
          <div className="h-4 bg-surface w-3/4 rounded-full" />
          <div className="h-4 bg-surface w-1/2 rounded-full" />
        </div>
        <div className="h-5 bg-surface w-20 rounded-full mt-2" />
      </div>
      <div className="w-10 h-10 bg-surface rounded-sm flex-shrink-0" />
    </div>
  )
}
