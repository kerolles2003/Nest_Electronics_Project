'use client';

import React from 'react';
import { Heart } from 'lucide-react';
import { useWishlistStore } from '@/stores/wishlist-store';

interface WishlistButtonProps {
  productId: string;
}

export function WishlistButton({ productId }: WishlistButtonProps) {
  const hasItem = useWishlistStore((state) => state.hasItem);
  const toggleItem = useWishlistStore((state) => state.toggleItem);
  const isInWishlist = hasItem(productId);

  return (
    <button
      onClick={() => toggleItem(productId)}
      className="p-2 rounded-full hover:bg-muted transition-colors"
      aria-label={isInWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
    >
      <Heart
        className={`w-5 h-5 transition-colors ${
          isInWishlist
            ? 'text-destructive fill-destructive'
            : 'text-muted-foreground'
        }`}
      />
    </button>
  );
}
