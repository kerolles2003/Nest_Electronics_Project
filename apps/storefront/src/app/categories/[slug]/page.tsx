import { getServices, getCachedCategoryBySlug } from "@/lib/services";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { ProductCard } from "@/components/ProductCard";
import { SITE_NAME, SITE_URL } from "@nest/config/constants";
import Link from "next/link";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const params = await props.params;
  const category = await getCachedCategoryBySlug(params.slug);
  if (!category) return { title: "Category Not Found" };
  return {
    title: `${category.name_en} | ${SITE_NAME}`,
    description: `Browse ${category.name_en} products at ${SITE_NAME}.`,
    openGraph: {
      title: `${category.name_en} | ${SITE_NAME}`,
      description: `Browse ${category.name_en} products at ${SITE_NAME}.`,
      type: 'website',
      siteName: SITE_NAME,
    },
    alternates: {
      canonical: `${SITE_URL}/categories/${category.slug}`,
    },
    robots: {
      index: true,
      follow: true,
    },
  };}

export default async function CategoryPage(
  props: { params: Promise<{ slug: string }> }
) {
  const params = await props.params;
  const { productService } = await getServices();

  const category = await getCachedCategoryBySlug(params.slug);
  if (!category) notFound();

  const [allCategories, result] = await Promise.all([
    productService.getCategoryTree(),
    productService.listProducts(
      { categorySlug: params.slug },
      { page: 1, limit: 24 }
    )
  ]);

  const subcategories = allCategories.find((c) => c.slug === params.slug)?.children ?? [];

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
    availableStock: p.available_stock,
    isFeatured: p.is_featured,
  }));

  return (
    <div className="container-nest py-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-foreground-muted mb-4" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-primary transition-colors">Home</Link>
        <span>/</span>
        <Link href="/categories" className="hover:text-primary transition-colors">Categories</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{category.name_en}</span>
      </nav>

      <div className="mb-4">
        <h1 className="text-xl font-heading font-semibold text-foreground">{category.name_en}</h1>
        <p className="text-xs text-foreground-muted mt-0.5">{result.total} products</p>
      </div>

      {/* Subcategory chips */}
      {subcategories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {subcategories.map((sub) => (
            <Link
              key={sub.id}
              href={`/categories/${sub.slug}`}
              className="inline-flex items-center px-3 py-1.5 bg-surface border border-border rounded-full text-xs font-medium text-foreground-muted hover:text-primary hover:border-primary transition-colors"
            >
              {sub.name_en}
            </Link>
          ))}
        </div>
      )}

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
