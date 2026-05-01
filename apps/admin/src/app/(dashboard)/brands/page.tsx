import { requireAdmin, getCachedBrands } from '@/lib/services';
import { BrandsManager } from '@/components/brands/BrandsManager';
import type { Brand } from '@nest/types';

export default async function BrandsPage() {
  await requireAdmin();
  const brands = await getCachedBrands();

  const stats = {
    total: brands.length,
    active: brands.filter((b: Brand) => b.is_active && !b.deleted_at).length,
    inactive: brands.filter((b: Brand) => !b.is_active && !b.deleted_at).length,
    deleted: brands.filter((b: Brand) => !!b.deleted_at).length,
    withLogo: brands.filter((b: Brand) => !!b.logo_url && !b.deleted_at).length,
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Brands</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage product brands and manufacturers.</p>
      </div>
      <BrandsManager initialBrands={brands} stats={stats} />
    </div>
  );
}
