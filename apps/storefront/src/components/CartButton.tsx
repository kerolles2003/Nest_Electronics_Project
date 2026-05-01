'use client';

import React from 'react';
import { ShoppingCart } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useCartStore } from '@/stores/cart-store';
import { Badge } from '@nest/ui';

export function CartButton() {
  const openCart = useUIStore((state) => state.openCart);
  const totalItems = useCartStore((state) => state.totalItems);

  return (
    <button
      onClick={openCart}
      className="relative p-2 text-muted-foreground hover:text-primary transition-colors"
      aria-label="Open cart"
    >
      <ShoppingCart className="w-6 h-6" />
      {totalItems > 0 && (
        <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {totalItems}
        </span>
      )}
    </button>
  );
}
