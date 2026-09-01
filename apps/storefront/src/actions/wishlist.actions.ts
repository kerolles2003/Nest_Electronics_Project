'use server';

import { createClient } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { revalidateTag } from 'next/cache';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function toggleWishlistItem(productId: string) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    if (!UUID_REGEX.test(productId)) {
      return { success: false, error: 'Invalid product ID' };
    }

    const { data: existing } = await supabase
      .from('wishlists')
      .select('id')
      .eq('user_id', user.id)
      .eq('product_id', productId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('wishlists')
        .delete()
        .eq('id', existing.id);

      revalidatePath('/wishlist', 'page');
      revalidateTag('wishlist', 'default');
      return { success: true, isInWishlist: false };
    }

    await supabase
      .from('wishlists')
      .insert({ user_id: user.id, product_id: productId });

    revalidatePath('/wishlist', 'page');
    revalidateTag('wishlist', 'default');
    return { success: true, isInWishlist: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to toggle wishlist' };
  }
}

export async function getWishlist() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return [];
  }

  try {
    const { data } = await supabase
      .from('wishlists')
      .select('product_id')
      .eq('user_id', user.id);

    return (data ?? []).map((item) => item.product_id);
  } catch {
    return [];
  }
}
