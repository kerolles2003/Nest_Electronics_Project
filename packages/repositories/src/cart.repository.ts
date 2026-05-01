import type { CartItem } from '@nest/types';

export interface DbCartItem extends CartItem {
  id: string;
  cart_id: string;
}

export interface DbCart {
  id: string;
  user_id: string | null;
  session_id: string | null;
  items: DbCartItem[];
  created_at: string;
  updated_at: string;
}

export interface ICartRepository {
  getOrCreateCart(userId: string): Promise<DbCart>;
  getCartBySession(sessionId: string): Promise<DbCart | null>;
  addItem(cartId: string, item: CartItem): Promise<DbCartItem>;
  updateItemQuantity(itemId: string, quantity: number): Promise<DbCartItem>;
  removeItem(itemId: string): Promise<void>;
  clearCart(cartId: string): Promise<void>;
  mergeGuestCart(userId: string, guestItems: CartItem[]): Promise<void>;
}
