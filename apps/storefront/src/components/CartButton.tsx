'use client';

import { ShoppingCart } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useCart } from '@/components/cart/CartProvider';

/**
 * The header basket.
 *
 * Both numbers come from the server — the count and the subtotal are the API's
 * arithmetic, for a signed-in customer and a visitor alike. It used to sum
 * client-held prices, which meant the header could disagree with checkout.
 *
 * Before the first read lands there is deliberately no badge and no total,
 * rather than a zero: "0" is a claim about an empty basket, and at that moment
 * nothing is known.
 */
export function CartButton() {
  const { cart, totalQuantity } = useCart();
  const openCart = useUIStore((state) => state.openCart);

  const known = cart !== null;
  const subtotal = cart?.itemsSubtotal.formatted ?? null;

  return (
    <button
      onClick={openCart}
      // `min-h-11 min-w-11` — DESIGN.md 8 asks for a 44x44 tap area and this
      // was 32x28 on a phone, where the label beside the icon is hidden.
      className="group flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-sm px-1.5 py-1 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      aria-label={known ? `Open cart, ${String(totalQuantity)} items` : 'Open cart'}
    >
      <div className="relative flex items-center justify-center">
        <ShoppingCart className="w-5 h-5" strokeWidth={1.7} />
        {totalQuantity > 0 && (
          <span className="navbar-badge" data-testid="cart-count">
            {totalQuantity > 99 ? '99+' : totalQuantity}
          </span>
        )}
      </div>
      <div className="hidden sm:flex flex-col items-start justify-center">
        <p className="text-[10px] font-semibold opacity-70 uppercase tracking-wider leading-none mb-1">
          Cart
        </p>
        <p className="text-[13px] font-bold leading-none" data-testid="cart-subtotal">
          {subtotal ?? '—'}
        </p>
      </div>
    </button>
  );
}
