'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ProductCard, ProductListSkeleton } from '@/components/ProductCard';
import type { ProductCardDTO } from '@nest/types';

interface NewArrivalsProps {
  products: ProductCardDTO[];
}

export function NewArrivals({ products }: NewArrivalsProps) {
  if (!products.length) return null;

  return (
    <section className="border-y border-[var(--color-border)] bg-surface-low">
      <div className="container-nest section-gap">
        <div className="section-heading animate-impeccable-reveal">
          <div>
            <p className="section-kicker">Recently Restocked</p>
            <h2 className="section-title">New arrivals</h2>
          </div>
          <Link href="/products?sort=newest" className="section-link group/btn">
            View All
            <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
          </Link>
        </div>

        <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
          {products.slice(0, 8).map((product, index) => (
            /*
             * `min-w-0` is load-bearing.
             *
             * A grid item's default `min-width: auto` means the track cannot be
             * narrower than the item's min-content width. The list card inside
             * is a flex row — 80px thumbnail, an info column, a 40px button —
             * whose min-content came to 439px, so on a 390px phone the whole
             * PAGE scrolled sideways by 68px. Nothing looked broken; the body
             * was simply wider than the screen, which also stretched the fixed
             * bottom navigation past the edge.
             */
            <div
              key={product.id}
              className="animate-impeccable-reveal min-w-0"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <ProductCard
                product={product}
                variant="list"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function NewArrivalsSkeleton() {
  return (
    <section className="border-y border-[var(--color-border)] bg-surface-low">
      <div className="container-nest section-gap">
        <div className="flex justify-between items-center mb-5">
          <div className="h-6 w-32 bg-[var(--color-border)] animate-pulse rounded" />
          <div className="h-4 w-16 bg-[var(--color-border)] animate-pulse rounded" />
        </div>
        <div className="grid gap-x-8 gap-y-2 md:grid-cols-2 [&>*]:min-w-0">
          {Array.from({ length: 8 }).map((_, i) => (
            <ProductListSkeleton key={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
