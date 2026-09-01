'use server';

import { createClient } from '@/lib/supabase';
import { CartService } from '@nest/services';
import { SupabaseCartProvider } from '@nest/providers';
import { logCartSyncFailure } from '@/lib/logger';
import { revalidatePath } from 'next/cache';
import { cartSyncSchema } from '@nest/types';

export async function syncCartToDatabase(
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
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const parsed = cartSyncSchema.safeParse(items);
    if (!parsed.success) {
      return { success: false, error: 'Invalid cart items' };
    }

    const cartRepo = new SupabaseCartProvider(supabase);
    const cartService = new CartService(cartRepo);

    if (items.length > 0) {
      await cartService.mergeGuestCart(user.id, items);
    }

    revalidatePath('/cart', 'page');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sync cart';
    logCartSyncFailure({ userId: user.id, itemsCount: items.length, error: message });
    return { success: false, error: message };
  }
}

export async function getCart() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  try {
    const cartRepo = new SupabaseCartProvider(supabase);
    const cartService = new CartService(cartRepo);

    return cartService.getCart(user.id);
  } catch {
    return null;
  }
}
