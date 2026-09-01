'use client';

import React from 'react';
import { ShoppingCart } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useCartStore } from '@/stores/cart-store';

export function CartButton() {
  const [mounted, setMounted] = React.useState(false);
  const openCart = useUIStore((state) => state.openCart);

  const items = useCartStore((state) => state.items);
  const totalItems = items.reduce((total, item) => total + item.quantity, 0);
  const subtotal = items.reduce(
    (total, item) => total + (item.product.sale_price ?? item.product.base_price) * item.quantity,
    0
  );

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const count = mounted ? totalItems : 0;
  const currentSubtotal = mounted ? subtotal : 0;

  return (
    <button
      onClick={openCart}
      className="group flex items-center gap-2 rounded-sm px-1.5 py-1 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      aria-label={`Open cart, ${count} items`}
    >
      <div className="relative flex items-center justify-center">
        <ShoppingCart className="w-5 h-5" strokeWidth={1.7} />
        {count > 0 && (
          <span className="navbar-badge">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </div>
      <div className="hidden sm:flex flex-col items-start justify-center">
        <p className="text-[10px] font-semibold opacity-70 uppercase tracking-wider leading-none mb-1">Cart</p>
        <p className="text-[13px] font-bold leading-none">EGP {currentSubtotal.toLocaleString()}</p>
      </div>
    </button>
  );
}
