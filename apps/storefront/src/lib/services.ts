import { cache } from 'react';
import { createClient } from './supabase';
import { ProductService } from '@nest/services';
import { SupabaseProductProvider, SupabaseCategoryProvider, SupabaseBrandProvider, PostgresSearchProvider } from '@nest/providers';
import { SearchService } from '@nest/services';
import { CartService } from '@nest/services';
import { BlogService } from '@nest/services';
import { SupabaseCartProvider } from '@nest/providers';

// Helper to get all initialized services for Server Components
export async function getServices() {
  const supabase = await createClient();

  const productRepo = new SupabaseProductProvider(supabase);
  const categoryRepo = new SupabaseCategoryProvider(supabase);
  const brandRepo = new SupabaseBrandProvider(supabase);
  const searchRepo = new PostgresSearchProvider(supabase);
  const cartRepo = new SupabaseCartProvider(supabase);

  const productService = new ProductService(productRepo, categoryRepo, brandRepo);
  const searchService = new SearchService(searchRepo);
  const cartService = new CartService(cartRepo);
  const blogService = new BlogService(supabase);

  return {
    productService,
    searchService,
    cartService,
    blogService,
  };
}

// Cached lookups to prevent duplicate queries between generateMetadata and page components
export const getCachedCategoryBySlug = cache(async (slug: string) => {
  const { productService } = await getServices();
  return productService.getCategoryBySlug(slug);
});

export const getCachedBrandBySlug = cache(async (slug: string) => {
  const { productService } = await getServices();
  return productService.getBrandBySlug(slug);
});

export const getCachedProductBySlug = cache(async (slug: string) => {
  const { productService } = await getServices();
  return productService.getProductPage(slug);
});

export const getCachedBlogPostBySlug = cache(async (slug: string) => {
  const { blogService } = await getServices();
  return blogService.getPostBySlug(slug);
});
