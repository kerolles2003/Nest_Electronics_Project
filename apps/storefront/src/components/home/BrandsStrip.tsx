'use client';

import Link from 'next/link';

interface Brand {
  id: string;
  name_en: string;
  slug: string;
}

interface BrandsStripProps {
  brands: Brand[];
}

export function BrandsStrip({ brands }: BrandsStripProps) {
  if (!brands.length) return null;

  return (
    <section className="bg-surface-low border-y border-border py-6">
      <div className="container-nest">
        <div className="flex items-center gap-3 overflow-x-auto scrollbar-none pb-1">
          {brands.map((brand) => (
            <Link
              key={brand.id}
              href={`/brands/${brand.slug}`}
              className="flex-shrink-0 px-5 py-2.5 bg-white border border-border rounded-md text-sm font-semibold text-foreground-muted hover:text-primary hover:border-primary hover:shadow-card transition-all"
            >
              {brand.name_en}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
