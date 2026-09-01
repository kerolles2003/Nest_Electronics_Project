import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Database } from '@nest/types';

export const MAX_CART_ITEM_QUANTITY = 99;

export type Product = Database['public']['Tables']['products']['Row'] & {
  available_stock: number;
  images?: { url: string }[] | null;
  sale_price?: number | null;
};
export type CartItem = {
  id: string;
  product_id: string;
  quantity: number;
  product: Product;
};

export type AddItemResult = { success: boolean; error?: string };
export type UpdateQuantityResult = { success: boolean; error?: string };

interface CartStore {
  items: CartItem[];
  cartVersion: number;
  addItem: (product: Product, quantity?: number) => AddItemResult;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => UpdateQuantityResult;
  clearCart: () => void;
  setItems: (items: CartItem[]) => void;
  validateCart: () => number;
  mergeCart: (incomingItems: CartItem[]) => void;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      cartVersion: 1,
      addItem: (product, quantity = 1) => {
        if (quantity < 1) {
          return { success: false, error: 'Quantity must be at least 1' };
        }
        if (product.is_active === false) {
          return { success: false, error: 'Product is not available' };
        }
        if (product.available_stock <= 0) {
          return { success: false, error: 'Product is out of stock' };
        }

        const cappedQuantity = Math.min(quantity, MAX_CART_ITEM_QUANTITY);

        set((state) => {
          const existingItemIndex = state.items.findIndex(
            (item) => item.product_id === product.id
          );

          if (existingItemIndex >= 0) {
            const newItems = [...state.items];
            newItems[existingItemIndex] = {
              ...newItems[existingItemIndex],
              quantity: Math.min(
                newItems[existingItemIndex].quantity + cappedQuantity,
                MAX_CART_ITEM_QUANTITY
              ),
              product,
            };
            return { items: newItems };
          }

          return {
            items: [
              ...state.items,
              {
                id: crypto.randomUUID(),
                product_id: product.id,
                quantity: cappedQuantity,
                product,
              },
            ],
          };
        });

        return { success: true };
      },
      removeItem: (itemId) => {
        set((state) => ({
          items: state.items.filter((item) => item.id !== itemId),
        }));
      },
      updateQuantity: (itemId, quantity) => {
        const state = get();
        const existingItem = state.items.find((item) => item.id === itemId);

        if (!existingItem) {
          return { success: false, error: 'Item not found in cart' };
        }

        const cappedQuantity = Math.min(
          Math.max(1, quantity),
          MAX_CART_ITEM_QUANTITY,
          existingItem.product.available_stock
        );

        set((state) => ({
          items: state.items.map((item) =>
            item.id === itemId ? { ...item, quantity: cappedQuantity } : item
          ),
        }));

        return { success: true };
      },
      clearCart: () => set({ items: [] }),
      setItems: (items) => set({ items }),
      validateCart: () => {
        const state = get();
        let removedCount = 0;

        const validItems = state.items.filter((item) => {
          if (!item.product || item.product.available_stock <= 0) {
            removedCount++;
            return false;
          }
          return true;
        });

        const cappedItems = validItems.map((item) => ({
          ...item,
          quantity: Math.min(item.quantity, item.product.available_stock),
        }));

        set({ items: cappedItems });
        return removedCount;
      },
      mergeCart: (incomingItems) => {
        set((state) => {
          const merged = new Map<string, CartItem>();

          for (const item of state.items) {
            merged.set(item.product_id, item);
          }

          for (const item of incomingItems) {
            const existing = merged.get(item.product_id);
            if (existing) {
              merged.set(item.product_id, {
                ...existing,
                quantity: Math.max(existing.quantity, item.quantity),
                product: item.product,
              });
            } else {
              merged.set(item.product_id, item);
            }
          }

          return {
            items: Array.from(merged.values()),
            cartVersion: state.cartVersion + 1,
          };
        });
      },
    }),
    {
      name: 'nest-cart-storage',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => {
        return (rehydratedState, error) => {
          if (error || !rehydratedState) {
            useCartStore.setState({ items: [], cartVersion: 1 });
            return;
          }

          const state = rehydratedState as Partial<CartStore>;

          if (!Array.isArray(state.items)) {
            useCartStore.setState({ items: [], cartVersion: 1 });
            return;
          }

          const validItems = state.items.filter(
            (item): item is CartItem =>
              !!item &&
              typeof item.id === 'string' &&
              typeof item.product_id === 'string' &&
              typeof item.quantity === 'number' &&
              item.quantity > 0 &&
              !!item.product
          );

          if (typeof state.cartVersion !== 'number') {
            state.cartVersion = 1;
          }

          useCartStore.setState({
            ...state,
            items: validItems,
            cartVersion: state.cartVersion,
          } as CartStore);
        };
      },
    }
  )
);
