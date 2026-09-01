import { Suspense } from "react";
import * as api from "@/lib/api/endpoints";
import { flattenCategoryTree, toLegacyBrand, toProductCard } from "@/lib/api/view-model";
import { HeroBanner } from "@/components/home/HeroBanner";
import { TrustBar } from "@/components/home/TrustBar";
import { CategoryGrid } from "@/components/home/CategoryGrid";
import { FeaturedProducts, FeaturedProductsSkeleton } from "@/components/home/FeaturedProducts";
import { NewArrivals } from "@/components/home/NewArrivals";
import { BrandsStrip } from "@/components/home/BrandsStrip";
import type { Category } from "@nest/types";

export const revalidate = 3600;

/**
 * The home page, on the API.
 *
 * ## The rails stay in Suspense, and that still matters
 *
 * Featured products, new arrivals and the brand strip each stream in behind
 * their own boundary, so the hero and the category grid paint immediately
 * rather than waiting on three catalogue reads. The structure is unchanged —
 * only the calls behind each boundary moved — and it is worth more now than it
 * was: the API is a network hop, where the Supabase client was too.
 *
 * ## Featured and new arrivals are one endpoint with two queries
 *
 * `?featured=true` and `?sort=newest` against `GET /products`. The old service
 * had a bespoke method for each; the API expresses both as filters over one
 * discovery endpoint, which is why there is nothing to add server-side when a
 * fourth rail is wanted.
 *
 * ## The category artwork
 *
 * `CategoryGrid` renders `/images/categories/<slug>.png` and falls back to an
 * icon on error. Those files were named for the LEGACY category slugs, none of
 * which the API uses, so every tile would have fallen back to a generic icon —
 * a visible regression, plus a failed image request per tile. The same design
 * artwork now also exists under the six API root slugs. No new images were
 * drawn and none were deleted; the legacy names stay until Phase 9 removes what
 * still uses them.
 */

async function FeaturedProductsSection() {
  const featured = await api.listProducts({ featured: true, limit: 10, sort: 'newest' });

  return <FeaturedProducts products={featured.data.map(toProductCard)} />;
}

async function NewArrivalsSection() {
  const arrivals = await api.listProducts({ limit: 10, sort: 'newest' });

  return <NewArrivals products={arrivals.data.map(toProductCard)} />;
}

async function BrandsSection() {
  const brands = await api.listBrands();

  return <BrandsStrip brands={brands.data.map(toLegacyBrand)} />;
}

function CategorySection({ categories }: { categories: Category[] }) {
  return <CategoryGrid categories={categories} />;
}

export default async function HomePage() {
  // FLAT, because `HeroBanner` and `CategoryGrid` both select roots themselves
  // with `filter(c => !c.parent_id)` — which is a no-op on a nested tree and
  // would have quietly shown every category as a root.
  const tree = await api.getCategoryTree();
  const categories = flattenCategoryTree(tree.data);

  return (
    <>
      <HeroBanner categories={categories} />
      <TrustBar />

      <Suspense fallback={<FeaturedProductsSkeleton />}>
        <FeaturedProductsSection />
      </Suspense>

      <Suspense fallback={<div className="container-nest section-gap"><div className="h-6 w-40 bg-[var(--color-border)] animate-pulse rounded mb-5" /><div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">{Array.from({length:5}).map((_,i)=>(<div key={i} className="aspect-[3/4] bg-[var(--color-border)] animate-pulse rounded-md" />))}</div></div>}>
        <NewArrivalsSection />
      </Suspense>

      <Suspense fallback={<div className="border-y border-[var(--color-border)] bg-[var(--color-surface)] py-6"><div className="container-nest flex gap-3 overflow-hidden">{Array.from({length:6}).map((_,i)=>(<div key={i} className="h-10 w-28 bg-[var(--color-border-strong)] animate-pulse rounded-md flex-shrink-0" />))}</div></div>}>
        <BrandsSection />
      </Suspense>

      <CategorySection categories={categories} />
    </>
  );
}
