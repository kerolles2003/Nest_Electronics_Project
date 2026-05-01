import { CURRENCY_SYMBOL, SITE_NAME, SITE_URL } from "@nest/config/constants";

export function generateProductJsonLd(product: {
  name: string;
  description?: string | null;
  sku: string;
  images: { url: string; altText?: string | null }[];
  brand?: { name_en: string } | null;
  basePrice: number;
  salePrice?: number | null;
  availableStock: number;
  rating: number;
  reviewCount: number;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    sku: product.sku,
    image: product.images.map((i) => i.url),
    brand: product.brand
      ? { "@type": "Brand", name: product.brand.name_en }
      : undefined,
    offers: {
      "@type": "Offer",
      price: product.salePrice ?? product.basePrice,
      priceCurrency: CURRENCY_SYMBOL,
      availability:
        product.availableStock > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: SITE_NAME },
    },
    aggregateRating:
      product.reviewCount > 0
        ? {
            "@type": "AggregateRating",
            ratingValue: product.rating,
            reviewCount: product.reviewCount,
          }
        : undefined,
  };
}

export function generateOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    description:
      "Egypt's premier electronics & embedded systems store for engineers, students, and makers.",
  };
}

export function generateBreadcrumbJsonLd(
  items: { name: string; url: string }[]
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
