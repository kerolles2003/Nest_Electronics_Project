'use client';

import { useEffect, useState } from 'react';
import {
  ProductCard as UIProductCard,
  type ProductCardProps as UIProductCardProps,
  useToast,
} from '@nest/ui';
import { useCart } from '@/components/cart/CartProvider';
import { useWishlistStore } from '@/stores/wishlist-store';
import { useUIStore } from '@/stores/ui-store';

/**
 * A catalogue card, wired to the real cart.
 *
 * It used to build a fake product object out of the card's props — name,
 * prices, stock, images — and push it into a client store, so the cart's idea
 * of a price came from whatever the grid happened to be rendering. Now it sends
 * an id and a quantity, and the server answers with what that costs.
 *
 * The wishlist is still a browser store. Server-side wishlists arrive in Phase
 * 8; until then it is a private list of ids with nothing to get wrong.
 */
export function ProductCard(props: UIProductCardProps) {
  const [isAdding, setIsAdding] = useState(false);

  /*
   * The wishlist is persisted in the browser, so the server renders "not
   * wishlisted" and the client may know better. Rendering the client's answer
   * on the first pass is a hydration mismatch; this defers it to after mount,
   * which is the one legitimate use of a mounted flag.
   */
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { add } = useCart();
  const openCart = useUIStore((state) => state.openCart);
  const toggleWishlist = useWishlistStore((state) => state.toggleItem);
  const hasWishlist = useWishlistStore((state) => state.hasItem(props.product.id));

  const { addToast } = useToast();

  const handleAddToCart = async (): Promise<void> => {
    setIsAdding(true);
    try {
      await add(props.product.id, 1);
      addToast(`${props.product.name} added to cart`, 'success');
      openCart();
    } finally {
      setIsAdding(false);
    }
  };

  const handleWishlist = (): void => {
    toggleWishlist(props.product.id);
    addToast(
      hasWishlist
        ? `${props.product.name} removed from wishlist`
        : `${props.product.name} added to wishlist`,
      hasWishlist ? 'info' : 'success',
    );
  };

  return (
    <UIProductCard
      {...props}
      onAddToCart={() => void handleAddToCart()}
      onWishlist={handleWishlist}
      isWishlisted={mounted && hasWishlist}
      isAddingToCart={isAdding}
    />
  );
}

export { ProductCardSkeleton, ProductListSkeleton } from '@nest/ui';
