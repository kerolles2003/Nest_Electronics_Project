import Link from 'next/link';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { ApiErrorNotice } from '@/components/shop/ApiErrorNotice';

export const dynamic = 'force-dynamic';

/**
 * The catalogue, served by the API.
 *
 * Prices are RENDERED, never computed: `pricing.effectivePrice.formatted` is
 * the server's own display string, and `availability` is the server's own
 * decision. This page does no money arithmetic and applies no stock rule of its
 * own — doing either would create a second pricing authority that can disagree
 * with what checkout actually charges.
 */
export default async function ShopHomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? '1') || 1;

  const result = await tryApi(() =>
    api.listProducts({ page, limit: 12, ...(params.q ? { q: params.q } : {}) }),
  );

  if (!result.ok) {
    return <ApiErrorNotice title="Could not load products" message={customerMessage(result.error)} />;
  }

  const { data: products, meta } = result.data;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-black tracking-tight">Products</h1>

      <form className="mb-6 flex gap-2" action="/shop">
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Search products"
          className="w-full max-w-sm rounded border border-black/20 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded bg-black px-4 py-2 text-sm font-semibold text-white">
          Search
        </button>
      </form>

      {products.length === 0 ? (
        <p className="text-sm text-black/60">No products matched.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <li key={product.id} className="rounded-lg border border-black/10 p-4">
              <Link href={`/shop/${product.slug}`} className="block">
                <h2 className="font-semibold">{product.name}</h2>
                <p className="mt-1 text-xs text-black/50">{product.sku}</p>
                <p className="mt-3 text-lg font-black">
                  {product.pricing.effectivePrice.formatted}
                </p>
                <p className="mt-1 text-xs">
                  {product.availability === 'OUT_OF_STOCK' ? (
                    <span className="text-red-600">Out of stock</span>
                  ) : product.availability === 'LOW_STOCK' ? (
                    <span className="text-amber-600">Low stock</span>
                  ) : (
                    <span className="text-green-700">In stock</span>
                  )}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <nav className="mt-8 flex items-center gap-4 text-sm">
        {meta.hasPrev && (
          <Link href={`/shop?page=${meta.page - 1}`} className="hover:underline">
            Previous
          </Link>
        )}
        <span className="text-black/50">
          Page {meta.page} of {meta.totalPages} · {meta.total} products
        </span>
        {meta.hasNext && (
          <Link href={`/shop?page=${meta.page + 1}`} className="hover:underline">
            Next
          </Link>
        )}
      </nav>
    </div>
  );
}
