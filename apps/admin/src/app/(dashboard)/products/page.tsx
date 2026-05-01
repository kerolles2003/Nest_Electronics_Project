import { requireAdmin, getAdminServices, getCachedCategories, getCachedBrands, getProductStats } from '@/lib/services';
import Link from 'next/link';
import { Suspense } from 'react';
import { ProductTable } from '@/components/products/ProductTable';
import { Plus } from 'lucide-react';
import type { Product } from '@nest/types';

function mapAdminProduct(raw: any): Product {
  const stock = (raw.stock_quantity ?? 0) as number;
  const reserved = (raw.reserved_quantity ?? 0) as number;
  return {
    ...raw,
    available_stock: stock - reserved,
    images: raw.images ?? [],
    category: raw.category ?? null,
    brand: raw.brand ?? null,
  } as Product;
}

function ProductsSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 h-20" />
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card h-12" />
      <div className="rounded-xl border border-border bg-card h-96" />
    </div>
  );
}

export default async function ProductsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { supabase } = await getAdminServices();
  const sp = await props.searchParams;

  const page = Number(sp.page) || 1;
  const search = (sp.search as string) || '';
  const categorySlug = (sp.category as string) || '';
  const brandSlug = (sp.brand as string) || '';
  const statusFilter = (sp.status as string) || '';
  const stockFilter = (sp.stock as string) || '';
  const limit = 20;

  const [categories, brands, stats] = await Promise.all([
    getCachedCategories(),
    getCachedBrands(),
    getProductStats(),
  ]);

  let dbQuery = supabase
    .from('products')
    .select(
      `*, images:product_images(*), category:categories(name_en, slug), brand:brands(name_en, slug)`,
      { count: 'exact' }
    )
    .is('deleted_at', null);

  if (search) {
    dbQuery = dbQuery.or(`name_en.ilike.%${search}%,sku.ilike.%${search}%`);
  }
  if (categorySlug) {
    dbQuery = dbQuery.eq('category.slug', categorySlug);
  }
  if (brandSlug) {
    dbQuery = dbQuery.eq('brand.slug', brandSlug);
  }
  if (statusFilter === 'active') {
    dbQuery = dbQuery.eq('is_active', true);
  } else if (statusFilter === 'inactive') {
    dbQuery = dbQuery.eq('is_active', false);
  }
  if (stockFilter === 'in_stock') {
    dbQuery = dbQuery.gt('stock_quantity', 0);
  } else if (stockFilter === 'out_of_stock') {
    dbQuery = dbQuery.eq('stock_quantity', 0);
  } else if (stockFilter === 'low_stock') {
    dbQuery = dbQuery.lte('stock_quantity', 5).gt('stock_quantity', 0);
  }

  const { data, count } = await dbQuery
    .range((page - 1) * limit, page * limit - 1)
    .order('created_at', { ascending: false });

  const products = (data ?? []).map(mapAdminProduct);
  const total = count ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your marketplace inventory and products.</p>
        </div>
        <Link href="/products/new" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-all shrink-0">
          <Plus className="h-4 w-4" /> Add Product
        </Link>
      </div>

      <Suspense fallback={<ProductsSkeleton />}>
        <ProductTable
          initialProducts={products}
          categories={categories}
          brands={brands}
          currentPage={page}
          totalPages={totalPages}
          total={total}
          stats={stats}
        />
      </Suspense>
    </div>
  );
}
