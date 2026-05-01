'use client';

import React from 'react';
import { ShoppingCart } from 'lucide-react';
import { Button } from '@nest/ui';
import { useCartStore, Product } from '@/stores/cart-store';
import { useUIStore } from '@/stores/ui-store';

interface AddToCartButtonProps {
  product: Product;
  quantity?: number;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  fullWidth?: boolean;
  className?: string;
}

export function AddToCartButton({ 
  product, 
  quantity = 1, 
  variant = 'default',
  size = 'default',
  fullWidth = false,
  className = ''
}: AddToCartButtonProps) {
  const addItem = useCartStore((state) => state.addItem);
  const openCart = useUIStore((state) => state.openCart);

  const handleAddToCart = () => {
    addItem(product, quantity);
    openCart(); // Open cart drawer after adding
  };

  const isOutOfStock = product.available_stock <= 0;

  return (
    <Button 
      variant={variant} 
      size={size}
      className={fullWidth ? `w-full ${className}` : className}
      onClick={handleAddToCart}
      disabled={isOutOfStock}
    >
      <ShoppingCart className="w-4 h-4 mr-2" />
      {isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
    </Button>
  );
}
