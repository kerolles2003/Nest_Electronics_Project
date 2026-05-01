'use server';

import { createClient } from '@/lib/supabase';

export async function toggleWishlistItem(userId: string, productId: string) {
  try {
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from('wishlists')
      .select('id')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .single();

    if (existing) {
      await supabase
        .from('wishlists')
        .delete()
        .eq('id', existing.id);

      return { success: true, isInWishlist: false };
    } else {
      await supabase
        .from('wishlists')
        .insert({ user_id: userId, product_id: productId });

      return { success: true, isInWishlist: true };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to toggle wishlist' };
  }
}

export async function getWishlist(userId: string) {
  try {
    const supabase = await createClient();

    const { data } = await supabase
      .from('wishlists')
      .select('product_id')
      .eq('user_id', userId);

    return (data ?? []).map((item) => item.product_id);
  } catch {
    return [];
  }
}
