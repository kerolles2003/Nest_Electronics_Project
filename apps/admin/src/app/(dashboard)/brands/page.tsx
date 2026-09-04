import { requireAdmin } from '@/lib/services';
import { BrandsManager } from '@/components/brands/BrandsManager';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { AlertTriangle } from 'lucide-react';

/**
 * Brands, from the API.
 *
 * `includeDeleted=true` for the same reason as categories: a deleted brand
 * keeps its slug reserved, so hiding it would leave an operator unable to work
 * out why the name they want is refused.
 */
export default async function BrandsPage() {
  await requireAdmin();

  const res = await tryApi(() => api.listAdminBrands({ includeDeleted: true }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Brands</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional on a product. Deleting one un-brands its products rather than refusing.
        </p>
      </div>

      {res.ok ? (
        <BrandsManager brands={res.data.data} />
      ) : (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive/70" />
          <h2 className="text-base font-bold text-foreground">Brands could not be loaded</h2>
          <p className="mt-1 text-sm text-muted-foreground">{operatorMessage(res.error)}</p>
        </div>
      )}
    </div>
  );
}
