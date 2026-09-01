'use client';

import React, { useState } from 'react';
import { ProductCard as UIProductCard, ProductCardProps as UIProductCardProps, useToast } from '@nest/ui';
import { useCartStore } from '@/stores/cart-store';
import { useWishlistStore } from '@/stores/wishlist-store';
import { useUIStore } from '@/stores/ui-store';

export function ProductCard(props: UIProductCardProps) {
  const [mounted, setMounted] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const addItem = useCartStore((state) => state.addItem);
  const openCart = useUIStore((state) => state.openCart);
  const toggleWishlist = useWishlistStore((state) => state.toggleItem);
  const hasWishlist = useWishlistStore((state) => state.hasItem(props.product.id));

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const { addToast } = useToast();

  const handleAddToCart = async () => {
    setIsAdding(true);
    try {
      // Map DTO back to what the store expects (Partial is fine if store is robust)
      const storeProduct: any = {
        id: props.product.id,
        name_en: props.product.name,
        slug: props.product.slug,
        sku: props.product.sku,
        base_price: props.product.basePrice,
        sale_price: props.product.salePrice,
        available_stock: props.product.availableStock,
        is_active: true,
        images: props.product.imageUrl ? [{ url: props.product.imageUrl }] : [],
      };

      const result = addItem(storeProduct, 1);
      if (result.success) {
        addToast(`${props.product.name} added to cart`, "success");
        openCart();
      } else {
        addToast(result.error || 'Failed to add to cart', "error");
      }
    } finally {
      setIsAdding(false);
    }
  };

  const handleWishlist = () => {
    toggleWishlist(props.product.id);
    if (!hasWishlist) {
      addToast(`${props.product.name} added to wishlist`, "success");
    } else {
      addToast(`${props.product.name} removed from wishlist`, "info");
    }
  };

  return (
    <UIProductCard
      {...props}
      onAddToCart={handleAddToCart}
      onWishlist={handleWishlist}
      isWishlisted={mounted && hasWishlist}
      isAddingToCart={isAdding}
    />
  );
}

export { ProductCardSkeleton, ProductListSkeleton } from '@nest/ui';
