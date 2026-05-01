import * as React from "react"
import { Heart, Star, ShoppingCart } from "lucide-react"
import { type ProductCardDTO } from "@nest/types"
import { cn } from "./utils"

export interface ProductCardProps extends React.HTMLAttributes<HTMLDivElement> {
  product: ProductCardDTO
  onAddToCart?: (product: ProductCardDTO) => void
  onWishlist?: (product: ProductCardDTO) => void
}

function formatPrice(price: number) {
  return Math.round(price).toLocaleString()
}

function StarRating({ rating, count }: { rating: number; count: number }) {
  if (!rating && !count) return null
  return (
    <div className="flex items-center gap-0.5">
      <div className="flex">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              "w-2.5 h-2.5",
              star <= Math.round(rating)
                ? "fill-amber-400 text-amber-400"
                : "fill-gray-200 text-gray-200"
            )}
          />
        ))}
      </div>
      {count > 0 && (
        <span className="text-[11px] text-foreground-muted ml-0.5">({count})</span>
      )}
    </div>
  )
}

export function ProductCard({ product, className, onAddToCart, onWishlist, ...props }: ProductCardProps) {
  const outOfStock = !product.inStock
  const onSale = product.salePrice != null && product.salePrice < product.basePrice
  const discount = onSale ? Math.round(((product.basePrice - product.salePrice!) / product.basePrice) * 100) : 0

  return (
    <div
      className={cn(
        "group relative bg-white border border-border rounded-md overflow-hidden hover:shadow-card-hover hover:border-border-strong transition-all duration-200 cursor-pointer flex flex-col",
        className
      )}
      {...props}
    >
      {/* Image Area */}
      <div className="relative aspect-square bg-surface p-4">
        <a href={`/products/${product.slug}`} className="block h-full w-full">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="object-contain w-full h-full group-hover:scale-[1.03] transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-surface-low rounded-md">
              <span className="text-2xl font-heading font-bold text-foreground-subtle">{product.name.charAt(0)}</span>
            </div>
          )}
        </a>

        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {onSale && discount > 0 && (
            <span className="badge bg-danger-light text-danger border border-danger/20">Sale</span>
          )}
          {product.isFeatured && (
            <span className="badge bg-amber-50 text-amber-700 border border-amber-200">Featured</span>
          )}
        </div>

        {/* Wishlist button */}
        <button
          onClick={() => onWishlist?.(product)}
          className="absolute top-2 right-2 p-1.5 rounded-full bg-white/80 hover:bg-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity text-foreground-muted hover:text-danger"
          aria-label="Add to wishlist"
        >
          <Heart className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col flex-1">
        {product.brandName && (
          <span className="text-[11px] text-primary font-semibold uppercase tracking-wide mb-1">
            {product.brandName}
          </span>
        )}
        <a href={`/products/${product.slug}`} className="block">
          <h3 className="text-[13px] text-foreground font-medium line-clamp-2 leading-snug mb-2 flex-1 hover:text-primary transition-colors">
            {product.name}
          </h3>
        </a>

        <div className="mb-2">
          <StarRating rating={product.rating} count={product.reviewCount} />
        </div>

        <div className="flex items-baseline gap-2 mt-auto">
          {product.salePrice ? (
            <>
              <span className="text-base font-semibold text-primary font-heading">
                {formatPrice(product.salePrice)} EGP
              </span>
              <span className="text-xs text-foreground-muted line-through">
                {formatPrice(product.basePrice)} EGP
              </span>
              <span className="text-[11px] font-bold text-danger">-{discount}%</span>
            </>
          ) : (
            <span className="text-base font-semibold text-primary font-heading">
              {formatPrice(product.basePrice)} EGP
            </span>
          )}
        </div>

        <button
          onClick={() => onAddToCart?.(product)}
          disabled={outOfStock}
          className="mt-3 w-full btn-primary text-xs py-1.5 rounded flex items-center justify-center gap-1.5 disabled:bg-foreground-disabled disabled:text-foreground-subtle disabled:cursor-not-allowed"
        >
          <ShoppingCart className="w-3.5 h-3.5" />
          {outOfStock ? "Out of Stock" : "Add to Cart"}
        </button>
      </div>
    </div>
  )
}

export function ProductCardSkeleton() {
  return (
    <div className="bg-white border border-border rounded-md overflow-hidden">
      <div className="aspect-square bg-surface animate-pulse" />
      <div className="p-3 space-y-2">
        <div className="h-2 bg-surface-low animate-pulse w-1/3 rounded" />
        <div className="h-3 bg-surface-low animate-pulse w-full rounded" />
        <div className="h-3 bg-surface-low animate-pulse w-2/3 rounded" />
        <div className="h-5 bg-surface-low animate-pulse w-1/2 rounded mt-1" />
        <div className="h-7 bg-surface-low animate-pulse w-full rounded-sm mt-2" />
      </div>
    </div>
  )
}
