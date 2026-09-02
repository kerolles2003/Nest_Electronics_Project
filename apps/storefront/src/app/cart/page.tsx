import type { Metadata } from 'next';
import { CartView } from '@/components/cart/CartView';

/**
 * The cart, as a page.
 *
 * ## Why it exists, when there is a drawer
 *
 * The drawer is for the moment after adding something. A page is what a
 * customer returns to, links to, opens on a phone, and reviews before checking
 * out — and it is where `/shop/cart` sends anyone still holding that URL.
 *
 * ## It works signed out
 *
 * The `/shop` cart page it replaces redirected an anonymous visitor to sign in,
 * because the only cart it knew about was the API's. This one renders whichever
 * cart the visitor has: an anonymous basket is priced by `POST /cart/preview`,
 * a customer's by `GET /cart`, and the component cannot tell which it is
 * showing. Making somebody sign in to look at their own basket is a good way to
 * lose the basket.
 */
export const metadata: Metadata = {
  title: 'Your cart — Nest Electronics',
  // A per-visitor page. There is nothing here for a crawler and nothing that
  // should ever appear in a result.
  robots: { index: false, follow: false },
};

export default function CartPage() {
  return (
    <div className="container-marketplace py-10">
      <CartView />
    </div>
  );
}
