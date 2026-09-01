import { getServices } from "@/lib/services";
import { SITE_URL } from "@nest/config/constants";

export const dynamic = "force-dynamic";

export default async function sitemap() {
  const { productService } = await getServices();
  const [products, categories, brands] = await Promise.all([
    productService.listProducts({}, { page: 1, limit: 5000 }),
    productService.getCategoryTree(),
    productService.getAllBrands(),
  ]);

  const productEntries = products.data.map((p) => ({
    url: `${SITE_URL}/products/${p.slug}`,
    lastModified: new Date(p.updated_at),
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  const categoryEntries = categories.map((c) => ({
    url: `${SITE_URL}/categories/${c.slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const brandEntries = brands.map((b) => ({
    url: `${SITE_URL}/brands/${b.slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  const staticEntries = [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: "daily" as const, priority: 1.0 },
    { url: `${SITE_URL}/products`, lastModified: new Date(), changeFrequency: "daily" as const, priority: 0.9 },
    { url: `${SITE_URL}/search`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.5 },
    { url: `${SITE_URL}/login`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.5 },
    { url: `${SITE_URL}/register`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.5 },
  ];

  return [...staticEntries, ...categoryEntries, ...brandEntries, ...productEntries];
}
