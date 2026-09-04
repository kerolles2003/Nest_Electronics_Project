import { requireAdmin, getAdminServices } from '@/lib/services';
import { ProductForm } from '@/components/products/ProductForm';
import { UnwiredScreenWarning } from '@/components/system/UnwiredScreenWarning';

export default async function NewProductPage() {
  await requireAdmin();
  const { productService } = await getAdminServices();
  const [categories, brands] = await Promise.all([
    productService.getCategoryTree(),
    productService.getAllBrands(),
  ]);
  return (
    <div className="space-y-6">
      <UnwiredScreenWarning screen="products" />

      <h1 className="text-2xl font-bold text-foreground font-heading">New Product</h1>
      <ProductForm mode="create" categories={categories} brands={brands} />
    </div>
  );
}
