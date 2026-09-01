import type { Product, Category, Brand, ProductAttributeValue, FacetCount } from './domain';

export interface ProductCardDTO {
  id: string;
  slug: string;
  sku: string;
  name: string;
  brandName?: string | null;
  categoryName?: string | null;
  imageUrl?: string | null;
  basePrice: number;
  salePrice?: number | null;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  availableStock: number;
  isFeatured: boolean;
}

export interface ProductListDTO {
  products: ProductCardDTO[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  facets?: Record<string, FacetCount[]>;
}

export interface ProductDetailDTO {
  id: string;
  slug: string;
  sku: string;
  name: string;
  description?: string | null;
  brand?: Pick<Brand, 'id' | 'name_en' | 'slug' | 'logo_url'> | null;
  category?: Pick<Category, 'id' | 'name_en' | 'slug'> | null;
  images: { id: string; url: string; altText: string | null; isPrimary: boolean }[];
  basePrice: number;
  salePrice?: number | null;
  stockQuantity: number;
  availableStock: number;
  rating: number;
  reviewCount: number;
  attributes: {
    id: string;
    name: string;
    value: string;
  }[];
  seoTitle?: string | null;
  seoDescription?: string | null;
}
