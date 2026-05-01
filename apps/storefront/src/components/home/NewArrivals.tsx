'use client';

import Link from 'next/link';
import { ProductCard } from '@nest/ui';

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

interface NewArrivalsProps {
  products: ProductDTO[];
}

export function NewArrivals({ products }: NewArrivalsProps) {
  if (!products.length) return null;

  return (
    <section className="container-nest section-gap">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-xl font-heading font-semibold text-foreground">New Arrivals</h2>
        <Link href="/products?sort=newest" className="text-sm text-primary hover:text-primary-hover font-medium transition-colors">
          View All
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
