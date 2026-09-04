import { requireAdmin } from '@/lib/services';
import { ProductForm } from '@/components/products/ProductForm';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

/**
 * One product.
 *
 * A soft-deleted product resolves here and is NOT a 404 — the restore action is
 * reached from the catalogue's Deleted tab, and an operator who follows a link
 * to a deleted product needs to be told that is what it is rather than that it
 * never existed. The form renders it read-only-ish with a banner saying so.
 *
 * A genuine 404 from the API is a genuine 404 here. Anything else — the API
 * being unreachable, a 500 — is stated as a failure, because "this product does
 * not exist" is a claim, and making it because a fetch failed is how somebody
 * concludes their catalogue has lost a row.
 */
export default async function EditProductPage(props: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await props.params;

  const [productRes, categoriesRes, brandsRes] = await Promise.all([
    tryApi(() => api.getAdminProduct(id)),
    tryApi(() => api.listAdminCategories()),
    tryApi(() => api.listAdminBrands()),
  ]);

  if (!productRes.ok) {
    if (productRes.error.status === 404) notFound();

    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-bold text-foreground">Product</h1>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive/70" />
          <h2 className="text-base font-bold text-foreground">This product could not be loaded</h2>
          <p className="mt-1 text-sm text-muted-foreground">{operatorMessage(productRes.error)}</p>
          <Link
            href="/products"
            className="mt-4 inline-flex items-center justify-center rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Back to catalogue
          </Link>
        </div>
      </div>
    );
  }

  const product = productRes.data.data;

  const categories = categoriesRes.ok
    ? categoriesRes.data.data.filter(
        // A soft-deleted category is excluded from the picker but kept if it is
        // the one this product is already in: dropping it would make the select
        // fall back to the first option and silently re-file the product on the
        // next save.
        (category) => category.deletedAt === null || category.id === product.category.id,
      )
    : [];
  const brands = brandsRes.ok
    ? brandsRes.data.data.filter(
        (brand) => brand.deletedAt === null || brand.id === product.brand?.id,
      )
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">{product.name.en}</h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{product.sku}</p>
      </div>
      <ProductForm mode="edit" categories={categories} brands={brands} product={product} />
    </div>
  );
}
