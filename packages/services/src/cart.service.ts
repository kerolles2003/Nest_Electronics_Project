import type { ICartRepository } from '@nest/repositories';
import type { CartItem, Cart } from '@nest/types';
import { MAX_CART_ITEM_QUANTITY } from '@nest/config/constants';

export class CartService {
  constructor(private repo: ICartRepository) {}

  async getCart(userId: string): Promise<Cart> {
    const dbCart = await this.repo.getOrCreateCart(userId);
    return this.mapToCart(dbCart);
  }

  async addItem(userId: string, item: CartItem): Promise<Cart> {
    const dbCart = await this.repo.getOrCreateCart(userId);
    const existing = dbCart.items.find(
      i => i.productId === item.productId && i.variantId === item.variantId
    );
    if (existing) {
      const newQty = Math.min(existing.quantity + item.quantity, MAX_CART_ITEM_QUANTITY);
      await this.repo.updateItemQuantity(existing.id, newQty);
    } else {
      await this.repo.addItem(dbCart.id, item);
    }
    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<Cart> {
    await this.repo.removeItem(itemId);
    return this.getCart(userId);
  }

  async updateQuantity(userId: string, itemId: string, quantity: number): Promise<Cart> {
    if (quantity <= 0) {
      await this.repo.removeItem(itemId);
    } else {
      await this.repo.updateItemQuantity(itemId, Math.min(quantity, MAX_CART_ITEM_QUANTITY));
    }
    return this.getCart(userId);
  }

  async clearCart(userId: string): Promise<void> {
    const dbCart = await this.repo.getOrCreateCart(userId);
    await this.repo.clearCart(dbCart.id);
  }

  // Called on login — merges guest (localStorage) cart into DB cart
  async mergeGuestCart(userId: string, guestItems: CartItem[]): Promise<void> {
    if (!guestItems.length) return;
    await this.repo.mergeGuestCart(userId, guestItems);
  }

  private mapToCart(dbCart: Awaited<ReturnType<ICartRepository['getOrCreateCart']>>): Cart {
    const items = dbCart.items;
    const subtotal = items.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0);
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    return { id: dbCart.id, items, subtotal, itemCount };
  }
}
