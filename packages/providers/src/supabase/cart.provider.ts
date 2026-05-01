import type { SupabaseClient } from '@supabase/supabase-js';
import type { ICartRepository, DbCart, DbCartItem } from '@nest/repositories';
import type { CartItem } from '@nest/types';

export class SupabaseCartProvider implements ICartRepository {
  constructor(private client: SupabaseClient) {}

  async getOrCreateCart(userId: string): Promise<DbCart> {
    // First try to get existing cart
    let { data, error } = await this.client
      .from('carts')
      .select('*, items:cart_items(*)')
      .eq('user_id', userId)
      .single();

    if (error && error.code === 'PGRST116') {
      // Not found, create one
      const { data: newCart, error: createError } = await this.client
        .from('carts')
        .insert({ user_id: userId })
        .select()
        .single();
        
      if (createError) throw new Error(createError.message);
      return { ...newCart, items: [] } as DbCart;
    }
    
    if (error) throw new Error(error.message);
    return {
      ...data,
      items: data.items.map((i: any) => ({
        ...i,
        productId: i.product_id,
        variantId: i.variant_id
      }))
    } as DbCart;
  }

  async getCartBySession(sessionId: string): Promise<DbCart | null> {
    const { data } = await this.client
      .from('carts')
      .select('*, items:cart_items(*)')
      .eq('session_id', sessionId)
      .single();
    if (!data) return null;
    return {
      ...data,
      items: data.items.map((i: any) => ({
        ...i,
        productId: i.product_id,
        variantId: i.variant_id
      }))
    } as DbCart;
  }

  async addItem(cartId: string, item: CartItem): Promise<DbCartItem> {
    const { data, error } = await this.client
      .from('cart_items')
      .insert({
        cart_id: cartId,
        product_id: item.productId,
        variant_id: item.variantId || null,
        quantity: item.quantity,
      })
      .select()
      .single();
      
    if (error) throw new Error(error.message);
    return {
      ...data,
      productId: data.product_id,
      variantId: data.variant_id
    } as DbCartItem;
  }

  async updateItemQuantity(itemId: string, quantity: number): Promise<DbCartItem> {
    const { data, error } = await this.client
      .from('cart_items')
      .update({ quantity })
      .eq('id', itemId)
      .select()
      .single();
      
    if (error) throw new Error(error.message);
    return {
      ...data,
      productId: data.product_id,
      variantId: data.variant_id
    } as DbCartItem;
  }

  async removeItem(itemId: string): Promise<void> {
    const { error } = await this.client
      .from('cart_items')
      .delete()
      .eq('id', itemId);
      
    if (error) throw new Error(error.message);
  }

  async clearCart(cartId: string): Promise<void> {
    const { error } = await this.client
      .from('cart_items')
      .delete()
      .eq('cart_id', cartId);
      
    if (error) throw new Error(error.message);
  }

  async mergeGuestCart(userId: string, guestItems: CartItem[]): Promise<void> {
    const dbCart = await this.getOrCreateCart(userId);
    // Simple implementation: just add missing items
    for (const item of guestItems) {
      const existing = dbCart.items.find(
        i => i.productId === item.productId && i.variantId === item.variantId
      );
      if (existing) {
        await this.updateItemQuantity(existing.id, existing.quantity + item.quantity);
      } else {
        await this.addItem(dbCart.id, item);
      }
    }
  }
}
