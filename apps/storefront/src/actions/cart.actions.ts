'use server';

import { createClient } from '@/lib/supabase';
import { CartService } from '@nest/services';
import { SupabaseCartProvider } from '@nest/providers';
import { logCartSyncFailure } from '@/lib/logger';

export async function syncCartToDatabase(
  userId: string,
  items: Array<{
    productId: string;
    variantId?: string | null;
    quantity: number;
    name?: string;
    price?: number;
    imageUrl?: string;
    slug?: string;
    sku?: string;
    maxStock?: number;
  }>
) {
  try {
    const supabase = await createClient();
    const cartRepo = new SupabaseCartProvider(supabase);
    const cartService = new CartService(cartRepo);

    if (items.length > 0) {
      await cartService.mergeGuestCart(userId, items);
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sync cart';
    logCartSyncFailure({ userId, itemsCount: items.length, error: message });
    return { success: false, error: message };
  }
}

export async function getCart(userId: string) {
  try {
    const supabase = await createClient();
    const cartRepo = new SupabaseCartProvider(supabase);
    const cartService = new CartService(cartRepo);

    return cartService.getCart(userId);
  } catch {
    return null;
  }
}
