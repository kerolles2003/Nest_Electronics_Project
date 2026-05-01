'use client';

import Link from 'next/link';
import { ProductCard, ProductCardSkeleton } from '@nest/ui';

interface ProductDTO {
  id: string;
  slug: string;
  sku: string;
  name: string;
  brandName: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  basePrice: number;
  salePrice: number | null;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  isFeatured: boolean;
}

interface FeaturedProductsProps {
  products: ProductDTO[];
}

export function FeaturedProducts({ products }: FeaturedProductsProps) {
  if (!products.length) return null;

  return (
    <section className="container-nest section-gap">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-xl font-heading font-semibold text-foreground">Featured Products</h2>
        <Link href="/products?sort=featured" className="text-sm text-primary hover:text-primary-hover font-medium transition-colors">
          See All
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}

export function FeaturedProductsSkeleton() {
  return (
    <section className="container-nest section-gap">
      <div className="flex justify-between items-center mb-5">
        <div className="h-6 w-40 bg-surface-low animate-pulse rounded" />
        <div className="h-4 w-16 bg-surface-low animate-pulse rounded" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}
