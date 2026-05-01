import { Suspense } from "react";
import { getServices } from "@/lib/services";
import { HeroBanner } from "@/components/home/HeroBanner";
import { TrustBar } from "@/components/home/TrustBar";
import { CategoryGrid } from "@/components/home/CategoryGrid";
import { FeaturedProducts, FeaturedProductsSkeleton } from "@/components/home/FeaturedProducts";
import { NewArrivals } from "@/components/home/NewArrivals";
import { BrandsStrip } from "@/components/home/BrandsStrip";

export const revalidate = 3600;

function toDTO(p: {
  id: string;
  slug: string;
  sku: string;
  name_en: string;
  brand?: { name_en: string } | null;
  category?: { name_en: string } | null;
  images?: { url: string }[];
  base_price: number;
  sale_price: number | null;
  avg_rating?: number;
  review_count?: number;
  available_stock: number;
  is_featured: boolean;
}) {
  return {
    id: p.id,
    slug: p.slug,
    sku: p.sku,
    name: p.name_en,
    brandName: p.brand?.name_en || null,
    categoryName: p.category?.name_en || null,
    imageUrl: p.images?.[0]?.url || null,
    basePrice: p.base_price,
    salePrice: p.sale_price,
    rating: p.avg_rating || 0,
    reviewCount: p.review_count || 0,
    inStock: p.available_stock > 0,
    isFeatured: p.is_featured,
  };
}

async function FeaturedProductsSection() {
  const { productService } = await getServices();
  const featuredRaw = await productService.getFeaturedProducts(10);
  return <FeaturedProducts products={featuredRaw.map(toDTO)} />;
}

async function NewArrivalsSection() {
  const { productService } = await getServices();
  const newArrivalsRaw = await productService.getNewArrivals(10);
  return <NewArrivals products={newArrivalsRaw.map(toDTO)} />;
}

async function BrandsSection() {
  const { productService } = await getServices();
  const brands = await productService.getAllBrands();
  return <BrandsStrip brands={brands} />;
}

async function CategorySection() {
  const { productService } = await getServices();
  const categories = await productService.getCategoryTree();
  return <CategoryGrid categories={categories} />;
}

export default async function HomePage() {
  const { productService } = await getServices();
  const categories = await productService.getCategoryTree();

  return (
    <>
      <HeroBanner categories={categories} />
      <TrustBar />

      <Suspense fallback={<FeaturedProductsSkeleton />}>
        <FeaturedProductsSection />
      </Suspense>

      <Suspense fallback={<div className="container-nest section-gap"><div className="h-6 w-40 bg-surface-low animate-pulse rounded mb-5" /><div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">{Array.from({length:5}).map((_,i)=>(<div key={i} className="aspect-[3/4] bg-surface-low animate-pulse rounded-md" />))}</div></div>}>
        <NewArrivalsSection />
      </Suspense>

      <Suspense fallback={<div className="bg-surface-low border-y border-border py-6"><div className="container-nest flex gap-3 overflow-hidden">{Array.from({length:6}).map((_,i)=>(<div key={i} className="h-10 w-28 bg-white animate-pulse rounded-md flex-shrink-0" />))}</div></div>}>
        <BrandsSection />
      </Suspense>

      <Suspense fallback={<div className="container-nest section-gap"><div className="h-6 w-40 bg-surface-low animate-pulse rounded mb-5" /><div className="grid grid-cols-8 gap-3">{Array.from({length:8}).map((_,i)=>(<div key={i} className="aspect-square bg-surface-low animate-pulse rounded-md" />))}</div></div>}>
        <CategorySection />
      </Suspense>
    </>
  );
}
