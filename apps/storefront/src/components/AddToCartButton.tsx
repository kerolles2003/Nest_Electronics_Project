'use client';

import { ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@nest/ui';
import { useCart } from '@/components/cart/CartProvider';
import { useUIStore } from '@/stores/ui-store';

/**
 * Adds one product to whichever cart the visitor has.
 *
 * It takes an ID and a stock number, and nothing else. It used to take a whole
 * product object — name, prices, images — and push it into a client store,
 * which is how a price the customer could edit ended up being sent to a server
 * action that trusted it. The server owns every figure now; this button states
 * an intent.
 *
 * `availableStock` is only for the disabled state. The API is what actually
 * refuses an unbuyable product, and it re-reads stock at the moment of the
 * write, so a number rendered seconds ago is a hint and never the guard.
 */
export function AddToCartButton({
  productId,
  availableStock,
  quantity = 1,
  variant = 'default',
  size = 'default',
  fullWidth = false,
  className = '',
}: {
  productId: string;
  availableStock: number;
  quantity?: number;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  fullWidth?: boolean;
  className?: string;
}) {
  const { add } = useCart();
  const openCart = useUIStore((state) => state.openCart);
  const [adding, setAdding] = useState(false);

  const outOfStock = availableStock <= 0;

  const handleAddToCart = async (): Promise<void> => {
    setAdding(true);
    try {
      await add(productId, quantity);
      openCart();
    } finally {
      setAdding(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={fullWidth ? `w-full ${className}` : className}
      onClick={() => void handleAddToCart()}
      disabled={outOfStock || adding}
    >
      <ShoppingCart className="w-4 h-4 mr-2" />
      {outOfStock ? 'Out of Stock' : adding ? 'Adding…' : 'Add to Cart'}
    </Button>
  );
}
