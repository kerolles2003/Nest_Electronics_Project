import { requireAdmin, getAdminServices } from '@/lib/services';
import { ProductForm } from '@/components/products/ProductForm';
import { UnwiredScreenWarning } from '@/components/system/UnwiredScreenWarning';
import { notFound } from 'next/navigation';

export default async function EditProductPage(props: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await props.params;
  const { productService } = await getAdminServices();
  const [product, categories, brands] = await Promise.all([
    productService.getProductByIdAdmin(id),
    productService.getCategoryTree(),
    productService.getAllBrands(),
  ]);
  if (!product) notFound();
  return (
    <div className="space-y-6">
      <UnwiredScreenWarning screen="products" />

      <h1 className="text-2xl font-bold text-foreground font-heading">Edit Product</h1>
      <ProductForm mode="edit" categories={categories} brands={brands} initialData={product} />
    </div>
  );
}
