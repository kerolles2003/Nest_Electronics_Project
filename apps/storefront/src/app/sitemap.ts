import * as api from "@/lib/api/endpoints";
import { SITE_URL } from "@nest/config/constants";
import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

/**
 * The sitemap, from the API.
 *
 * ## Why this pages, when the old version did not
 *
 * The old version asked Supabase for `limit: 5000` in one call, which that
 * client allowed. **The API caps `limit` at 100** (`MAX_LIMIT` in
 * `PaginationQueryDto`, checked rather than assumed), and sending more is a
 * `400 VALIDATION_ERROR` — so the same call transplanted onto the API would
 * have produced an empty sitemap and an error nobody watches. Paging is not an
 * optimisation here; it is the only way to list more than 100 products.
 *
 * ## Why there is a ceiling at all
 *
 * A sitemap file may hold 50,000 URLs, and Next generates it in one response.
 * `MAX_PRODUCTS` keeps a catalogue that grows past that from turning this route
 * into a timeout; reaching it is the signal to split the sitemap with
 * `generateSitemaps`, not to raise the number.
 *
 * ## The FLAT category list, not the tree
 *
 * `GET /categories` returns every category including the nested ones, which is
 * what a sitemap wants. The tree endpoint returns roots with their children
 * nested, and a `.map` over that would have silently omitted all seven
 * subcategories — the kind of omission a sitemap never reports.
 */

/** The API's maximum. Larger is a 400, not a bigger page. */
const PAGE_SIZE = 100;

/**
 * Stop here. Not a guess about catalogue size — a guard against this route
 * becoming a slow full-table scan the day the real catalogue lands.
 */
const MAX_PRODUCTS = 10_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categories, brands, products] = await Promise.all([
    api.listCategories(),
    api.listBrands(),
    allProducts(),
  ]);

  const productEntries = products.map((product) => ({
    url: `${SITE_URL}/products/${product.slug}`,
    // The API does not return `updatedAt` on a LIST item — only on the detail
    // response — and fetching every product's detail to fill this field would
    // be thousands of requests for a hint. `changeFrequency` carries the same
    // information at a fraction of the cost.
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  const categoryEntries = categories.data.map((category) => ({
    url: `${SITE_URL}/categories/${category.slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const brandEntries = brands.data.map((brand) => ({
    url: `${SITE_URL}/brands/${brand.slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  const staticEntries = [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: "daily" as const, priority: 1.0 },
    { url: `${SITE_URL}/products`, lastModified: new Date(), changeFrequency: "daily" as const, priority: 0.9 },
    { url: `${SITE_URL}/categories`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.8 },
    { url: `${SITE_URL}/search`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.5 },
    { url: `${SITE_URL}/login`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.5 },
    { url: `${SITE_URL}/register`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.5 },
  ];

  return [...staticEntries, ...categoryEntries, ...brandEntries, ...productEntries];
}

/** Every product slug, one page at a time, bounded. */
async function allProducts(): Promise<{ slug: string }[]> {
  const slugs: { slug: string }[] = [];

  for (let page = 1; slugs.length < MAX_PRODUCTS; page += 1) {
    const result = await api.listProducts({ page, limit: PAGE_SIZE, sort: 'newest' });

    slugs.push(...result.data.map((product) => ({ slug: product.slug })));

    if (!result.meta.hasNext) break;
  }

  return slugs;
}
