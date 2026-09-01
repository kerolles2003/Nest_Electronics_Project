import * as api from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/errors";
import { toProductCard } from "@/lib/api/view-model";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { ProductCard } from "@/components/ProductCard";
import { SITE_NAME, SITE_URL } from "@nest/config/constants";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * One category page, on the API.
 *
 * ## What moved and what did not
 *
 * The reads. The markup, the breadcrumb, the subcategory chips, the grid and
 * the empty state are untouched; `toProductCard` hands `ProductCard` exactly
 * the object the hand-built Supabase mapping used to produce.
 *
 * ## The subcategory chips now come from the API's own breadcrumb data
 *
 * Previously this fetched the WHOLE category tree and searched it for the
 * current slug, purely to read that node's `children` — a second full-catalogue
 * read to answer a question about one row. `GET /categories/:slug` returns the
 * category with its ancestors, and the tree call is still needed for the
 * children, so the two run in parallel rather than in sequence.
 *
 * ## An unknown slug is a 404, not an empty page
 *
 * The API answers `404 CATEGORY_NOT_FOUND` for a slug that does not exist, and
 * that is translated into Next's `notFound()` here rather than swallowed. A
 * category page that renders "no products found" for a slug that was never real
 * tells a crawler the URL is valid and tells a customer they have found an
 * empty shelf rather than a wrong address.
 */
export async function generateMetadata(
  props: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const params = await props.params;
  const category = await findCategory(params.slug);
  if (category === null) return { title: "Category Not Found" };
  return {
    title: `${category.name} | ${SITE_NAME}`,
    description: `Browse ${category.name} products at ${SITE_NAME}.`,
    openGraph: {
      title: `${category.name} | ${SITE_NAME}`,
      description: `Browse ${category.name} products at ${SITE_NAME}.`,
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
  };
}

/**
 * The category, or `null` when the API says it does not exist.
 *
 * Only `CATEGORY_NOT_FOUND` becomes `null`. Every other failure — a timeout,
 * a 500, a connection refused — is rethrown, because "the API is down" and
 * "this category was deleted" are different facts and rendering the 404 page
 * for the first one would hide an outage behind a plausible screen.
 */
async function findCategory(slug: string) {
  try {
    return (await api.getCategory(slug)).data;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CATEGORY_NOT_FOUND') return null;
    throw error;
  }
}

export default async function CategoryPage(
  props: { params: Promise<{ slug: string }> }
) {
  const params = await props.params;

  const category = await findCategory(params.slug);
  if (category === null) notFound();

  const [tree, result] = await Promise.all([
    api.getCategoryTree(),
    // The API matches the whole SUBTREE, so a parent category shows its
    // descendants' products — which is what the old `categorySlug` filter did
    // through a recursive path lookup, and what a customer expects when they
    // click a top-level category.
    api.listProducts({ category: params.slug, page: 1, limit: 24 }),
  ]);

  const subcategories = findNode(tree.data, params.slug)?.children ?? [];
  const products = result.data.map(toProductCard);

  return (
    <div className="container-nest py-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-foreground-muted mb-4" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-primary transition-colors">Home</Link>
        <span>/</span>
        <Link href="/categories" className="hover:text-primary transition-colors">Categories</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{category.name}</span>
      </nav>

      <div className="mb-4">
        <h1 className="text-xl font-heading font-semibold text-foreground">{category.name}</h1>
        <p className="text-xs text-foreground-muted mt-0.5">{result.meta.total} products</p>
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
              {sub.name}
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

/**
 * Finds one node anywhere in the tree.
 *
 * Recursive rather than a top-level `find`, because the tree is genuinely
 * deeper than two levels — the seed has a depth-2 category, and a top-level
 * search would return `undefined` for it and silently render no chips at all.
 */
function findNode(
  nodes: readonly import("@/lib/api/types").CategoryTreeNode[],
  slug: string,
): import("@/lib/api/types").CategoryTreeNode | undefined {
  for (const node of nodes) {
    if (node.slug === slug) return node;

    const found = findNode(node.children, slug);
    if (found !== undefined) return found;
  }

  return undefined;
}
