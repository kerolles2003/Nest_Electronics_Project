'use client';

import { useEffect, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useCartStore } from '@/stores/cart-store';
import { syncCartToDatabase } from '@/actions/cart.actions';

export function CartSync() {
  const items = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clearCart);
  const syncedRef = useRef(false);

  useEffect(() => {
    const sync = async () => {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );

      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;

      if (user && items.length > 0 && !syncedRef.current) {
        syncedRef.current = true;
        await syncCartToDatabase(
          user.id,
          items.map((item) => ({
            productId: item.product_id,
            quantity: item.quantity,
            name: item.product.name_en,
            price: item.product.sale_price ?? item.product.base_price,
          }))
        );
        // We don't clear the local cart here because the store is persistent and synced.
        // But if we want the server to be the source of truth, we could re-fetch.
      }
    };

    sync();
  }, [items]);

  return null;
}
