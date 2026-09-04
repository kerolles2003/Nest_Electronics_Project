import { requireAdmin } from '@/lib/services';
import { ProductForm } from '@/components/products/ProductForm';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { AlertTriangle } from 'lucide-react';

/**
 * A new product.
 *
 * The category list is a HARD requirement, not a convenience: `categoryId` is
 * required by the API and there is no free-text fallback, so a form rendered
 * without categories is a form that cannot be submitted. It says so instead of
 * offering an empty dropdown and a validation error on save.
 */
export default async function NewProductPage() {
  await requireAdmin();

  const [categoriesRes, brandsRes] = await Promise.all([
    tryApi(() => api.listAdminCategories()),
    tryApi(() => api.listAdminBrands()),
  ]);

  const categories = categoriesRes.ok
    ? categoriesRes.data.data.filter((category) => category.deletedAt === null)
    : [];
  const brands = brandsRes.ok ? brandsRes.data.data.filter((brand) => brand.deletedAt === null) : [];

  if (!categoriesRes.ok || categories.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-bold text-foreground">New product</h1>
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-warning/80" />
          <h2 className="text-base font-bold text-foreground">
            {categoriesRes.ok ? 'There are no categories yet' : 'Categories could not be loaded'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {categoriesRes.ok
              ? 'Every product belongs to a category, so one has to exist before a product can be created.'
              : operatorMessage(categoriesRes.error)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">New product</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Saved as a draft. Images and stock come next, then publish.
        </p>
      </div>
      <ProductForm mode="create" categories={categories} brands={brands} />
    </div>
  );
}
