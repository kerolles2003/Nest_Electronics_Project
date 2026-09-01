import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { ApiErrorNotice } from '@/components/shop/ApiErrorNotice';
import { AddToCartForm } from '@/components/shop/AddToCartForm';

export const dynamic = 'force-dynamic';

/**
 * Product detail, served by the API.
 *
 * `PRODUCT_NOT_FOUND` becomes a real 404 rather than an error banner: a slug
 * that does not exist is a missing page, not a failed request, and rendering it
 * as an error would keep a dead URL returning 200.
 */
export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await tryApi(() => api.getProduct(slug));

  if (!result.ok) {
    if (result.error.kind === 'not_found') notFound();
    return <ApiErrorNotice title="Could not load product" message={customerMessage(result.error)} />;
  }

  const product = result.data.data;
  const outOfStock = product.availability === 'OUT_OF_STOCK';

  return (
    <article>
      <Link href="/shop" className="text-sm hover:underline">
        &larr; All products
      </Link>

      <h1 className="mt-4 text-3xl font-black tracking-tight">{product.name}</h1>
      <p className="mt-1 text-sm text-black/50">
        {product.sku} · {product.category.name}
        {product.brand ? ` · ${product.brand.name}` : ''}
      </p>

      {product.shortDescription ? (
        <p className="mt-4 max-w-prose text-sm text-black/70">{product.shortDescription}</p>
      ) : null}

      <p className="mt-6 text-3xl font-black">{product.pricing.effectivePrice.formatted}</p>
      {product.pricing.salePrice ? (
        <p className="text-sm text-black/50 line-through">{product.pricing.basePrice.formatted}</p>
      ) : null}

      <p className="mt-2 text-sm">
        {outOfStock ? (
          <span className="text-red-600">Out of stock</span>
        ) : (
          <span className="text-green-700">In stock</span>
        )}
      </p>

      {outOfStock ? null : <AddToCartForm productId={product.id} />}

      {product.specs.length > 0 ? (
        <table className="mt-8 w-full max-w-lg text-sm">
          <tbody>
            {product.specs.map((spec) => (
              <tr key={spec.key} className="border-b border-black/10">
                <th scope="row" className="py-2 text-left font-medium text-black/60">
                  {spec.label}
                </th>
                <td className="py-2">{spec.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </article>
  );
}
