'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ProductCard, ProductCardSkeleton } from '@/components/ProductCard';
import type { ProductCardDTO } from '@nest/types';

interface FeaturedProductsProps {
  products: ProductCardDTO[];
}

export function FeaturedProducts({ products }: FeaturedProductsProps) {
  if (!products.length) return null;

  return (
    <section className="container-nest section-gap">
      <div className="section-heading animate-impeccable-reveal">
        <div>
          <p className="section-kicker">Popular for Robotics & Graduation Projects</p>
          <h2 className="section-title">Featured components</h2>
        </div>
        <Link href="/products?sort=featured" className="section-link group/btn">
          Shop more
          <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-8">
        {products.map((product, index) => (
          <div 
            key={product.id} 
            className="animate-impeccable-reveal" 
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <ProductCard
              product={product}
              variant="grid"
              className="h-full"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function FeaturedProductsSkeleton() {
  return (
    <section className="container-nest section-gap">
      <div className="flex justify-between items-center mb-5">
        <div className="h-6 w-40 bg-[var(--color-border)] animate-pulse rounded" />
        <div className="h-4 w-16 bg-[var(--color-border)] animate-pulse rounded" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-8">
        {Array.from({ length: 10 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}
