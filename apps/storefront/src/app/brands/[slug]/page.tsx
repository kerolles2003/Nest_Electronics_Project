import * as api from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/errors";
import { toLegacyBrand, toProductCard } from "@/lib/api/view-model";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import Image from "next/image";
import { ProductCard } from "@/components/ProductCard";
import { SITE_NAME, SITE_URL } from "@nest/config/constants";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * One brand page, on the API.
 *
 * Reads moved; markup untouched.
 *
 * ## The empty-brand state is now reachable, and that is why the seed has one
 *
 * `sparkfun` stocks nothing. Before the seed was extended for Phase 4 every
 * brand had at least one product, so the "No products found" branch below was
 * unreachable from real data and could have been broken by this migration
 * without anyone noticing. A brand record created before its first delivery is
 * an ordinary thing, not an edge case.
 *
 * ## `logo_url` is null until Phase 7
 *
 * The API models a brand logo as a managed asset (`logo`), and no brand has one
 * — MEDIA-MODEL.md §10 records that the legacy column was populated 0 times out
 * of 17. `toLegacyBrand` derives a URL when one exists and null otherwise, and
 * the markup already guards on it.
 */
export async function generateMetadata(
  props: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const params = await props.params;
  const brand = await findBrand(params.slug);
  if (brand === null) return { title: "Brand Not Found" };
  return {
    title: `${brand.name} | ${SITE_NAME}`,
    description: `Browse ${brand.name} products at ${SITE_NAME}.`,
    openGraph: {
      title: `${brand.name} | ${SITE_NAME}`,
      description: `Browse ${brand.name} products at ${SITE_NAME}.`,
      type: 'website',
      siteName: SITE_NAME,
    },
    alternates: {
      canonical: `${SITE_URL}/brands/${brand.slug}`,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

/**
 * The brand, or `null` when the API says it does not exist.
 *
 * Only `BRAND_NOT_FOUND` becomes `null`; every other failure is rethrown, so an
 * outage renders an error rather than a convincing "this brand does not exist".
 */
async function findBrand(slug: string) {
  try {
    return (await api.getBrand(slug)).data;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'BRAND_NOT_FOUND') return null;
    throw error;
  }
}

export default async function BrandPage(
  props: { params: Promise<{ slug: string }> }
) {
  const params = await props.params;

  const [apiBrand, result] = await Promise.all([
    findBrand(params.slug),
    // `brand` is REPEATABLE on the API and ORs within itself, so it takes an
    // array even for one value. Sending a bare string would work today and
    // break silently the first time a page passed two.
    api.listProducts({ brand: [params.slug], page: 1, limit: 24 }),
  ]);

  if (apiBrand === null) notFound();

  const brand = toLegacyBrand(apiBrand);
  const products = result.data.map(toProductCard);

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
          <div className="relative w-12 h-12 bg-surface border border-border rounded-md flex items-center justify-center overflow-hidden flex-shrink-0">
              <Image src={brand.logo_url} alt={brand.name_en} fill sizes="48px" className="object-contain p-1" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-heading font-semibold text-foreground">{brand.name_en}</h1>
          <p className="text-xs text-foreground-muted mt-0.5">{result.meta.total} products</p>
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
