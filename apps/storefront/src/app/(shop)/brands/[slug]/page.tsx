import { getServices, getCachedBrandBySlug } from "@/lib/services";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { ProductCard } from "@nest/ui";
import { SITE_NAME } from "@nest/config/constants";
import Link from "next/link";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const params = await props.params;
  const brand = await getCachedBrandBySlug(params.slug);
  if (!brand) return { title: "Brand Not Found" };
  return {
    title: `${brand.name_en} | ${SITE_NAME}`,
    description: `Browse ${brand.name_en} products at ${SITE_NAME}.`,
  };
}

export default async function BrandPage(
  props: { params: Promise<{ slug: string }> }
) {
  const params = await props.params;
  const { productService } = await getServices();

  const brand = await getCachedBrandBySlug(params.slug);
  if (!brand) notFound();

  const result = await productService.listProducts(
    { brandSlug: params.slug },
    { page: 1, limit: 24 }
  );

  const products = result.data.map((p) => ({
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
  }));

  return (
    <div className="container-nest py-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-foreground-muted mb-4" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-primary transition-colors">Home</Link>
        <span>/</span>
        <Link href="/products" className="hover:text-primary transition-colors">Products</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{brand.name_en}</span>
      </nav>

      <div className="flex items-center gap-3 mb-4">
        {brand.logo_url && (
          <div className="w-12 h-12 bg-surface border border-border rounded-md flex items-center justify-center overflow-hidden flex-shrink-0">
            <img src={brand.logo_url} alt={brand.name_en} className="max-w-full max-h-full object-contain p-1" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-heading font-semibold text-foreground">{brand.name_en}</h1>
          <p className="text-xs text-foreground-muted mt-0.5">{result.total} products</p>
        </div>
      </div>

      {products.length === 0 ? (
        <div className="text-center py-20 border border-border rounded-md bg-surface">
          <h3 className="text-lg font-medium text-foreground">No products found</h3>
          <p className="text-foreground-muted mt-1 text-sm">Check back later for new arrivals.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
