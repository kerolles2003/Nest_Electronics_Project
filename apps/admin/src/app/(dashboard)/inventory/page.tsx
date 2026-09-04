import { requireAdmin, getAdminServices, getCachedCategories, getCachedBrands, getInventoryStats, getInventoryTransactions } from '@/lib/services';
import { Suspense } from 'react';
import { InventoryTable } from '@/components/inventory/InventoryTable';
import { UnwiredScreenWarning } from '@/components/system/UnwiredScreenWarning';
import type { Product } from '@nest/types';

function mapInventoryProduct(raw: any): Product {
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

function InventorySkeleton() {
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

export default async function InventoryPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { supabase } = await getAdminServices();
  const sp = await props.searchParams;

  const page = Number(sp.page) || 1;
  const search = (sp.search as string) || '';
  const categorySlug = (sp.category as string) || '';
  const brandSlug = (sp.brand as string) || '';
  const stockFilter = (sp.stock as string) || '';
  const limit = 25;

  const [categories, brands, stats, recentActivity] = await Promise.all([
    getCachedCategories(),
    getCachedBrands(),
    getInventoryStats(),
    getInventoryTransactions(10),
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
  if (stockFilter === 'in_stock') {
    dbQuery = dbQuery.gt('stock_quantity', 0);
  } else if (stockFilter === 'out_of_stock') {
    dbQuery = dbQuery.eq('stock_quantity', 0);
  } else if (stockFilter === 'low_stock') {
    // Low stock: available > 0 and available <= threshold
    // We approximate with stock_quantity <= 15 to capture most low-stock items,
    // then filter client-side by available_stock for accuracy
    dbQuery = dbQuery.lte('stock_quantity', 15).gt('stock_quantity', 0);
  } else if (stockFilter === 'reserved') {
    dbQuery = dbQuery.gt('reserved_quantity', 0);
  }

  const { data, count } = await dbQuery
    .range((page - 1) * limit, page * limit - 1)
    .order('stock_quantity', { ascending: true });

  let products = (data ?? []).map(mapInventoryProduct);

  // Client-side refine for low_stock filter using available_stock logic
  if (stockFilter === 'low_stock') {
    products = products.filter((p: Product) => {
      const available = p.available_stock;
      return available > 0 && available <= (p.low_stock_threshold ?? 5);
    });
  }

  const total = count ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-5">
      <UnwiredScreenWarning screen="inventory" />

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Inventory</h1>
        <p className="text-sm text-muted-foreground mt-1">Monitor and manage marketplace stock levels.</p>
      </div>

      <Suspense fallback={<InventorySkeleton />}>
        <InventoryTable
          initialProducts={products}
          categories={categories}
          brands={brands}
          currentPage={page}
          totalPages={totalPages}
          total={total}
          stats={stats}
          recentActivity={recentActivity}
        />
      </Suspense>
    </div>
  );
}
