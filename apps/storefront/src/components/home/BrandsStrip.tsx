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
  const loopedBrands = [...brands, ...brands];

  return (
    <section className="overflow-hidden border-y border-[var(--color-border)] bg-surface-low py-7">
      <div className="container-nest mb-4 flex items-end justify-between gap-4 animate-impeccable-reveal">
        <div>
          <p className="section-kicker">Trusted Suppliers</p>
          <h2 className="mt-1 font-heading text-2xl font-black text-foreground">Supplier lines currently stocked</h2>
        </div>
        <p className="hidden max-w-sm text-sm text-foreground-muted md:block">Boards, modules, and accessories available through the local catalog.</p>
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-surface-low to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-surface-low to-transparent" />
        <div className="marquee-track flex w-max items-center gap-3 px-4 hover:[animation-play-state:paused]">
          {loopedBrands.map((brand, index) => (
            <Link
              key={`${brand.id}-${index}`}
              href={`/brands/${brand.slug}`}
              className="flex-shrink-0 rounded-sm border border-[var(--color-border)] bg-card px-4 py-2 text-[13px] font-bold text-foreground-muted transition-colors hover:border-primary/40 hover:bg-accent hover:text-primary"
            >
              {brand.name_en}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
