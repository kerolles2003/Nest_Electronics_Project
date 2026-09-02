import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MAX_LINE_QUANTITY, MAX_GUEST_LINES, type GuestLine } from '@/lib/cart/guest-cart';

/**
 * The anonymous basket: product identifiers and quantities, nothing else.
 *
 * Authority: PLAN.md §8.
 *
 * ## What this replaces, and why it is smaller
 *
 * `cart-store.ts` persisted a whole denormalised product per line — name, base
 * price, sale price, stock, images — and `syncCartToDatabase` sent those values
 * to the server at login. A price that round-trips through `localStorage` is a
 * price the customer can edit, and nothing downstream re-derived it.
 *
 * Everything a cart page needs to DISPLAY is fetched from the API at render.
 * Everything it needs to REMEMBER is here. Those are different questions, and
 * the legacy store answered both with the same object.
 *
 * ## The pending merge is persisted on purpose
 *
 * `pendingMerge` holds the absolute quantities a login worked out before it
 * started writing them. It survives a reload because the case it exists for is
 * a merge that did not finish — a dropped connection, a closed tab — and a
 * retry that recomputed the plan would read a cart already holding some of the
 * guest quantities and add them a second time.
 *
 * Frozen targets plus absolute writes is the whole idempotency argument, and
 * neither half works alone.
 */

interface GuestCartState {
  /** One entry per product. Never contains prices, names or images. */
  items: GuestLine[];
  /**
   * Absolute target quantities for a merge that has begun and not been
   * confirmed. `null` at rest.
   */
  pendingMerge: GuestLine[] | null;

  /** Adds to an existing line, or creates one. Capped, never rejected. */
  add: (productId: string, quantity?: number) => void;
  /** Sets a line to an exact quantity. `0` or less removes it. */
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;

  /** Records the plan before any of it is applied. */
  beginMerge: (targets: GuestLine[]) => void;
  /** Clears the basket and the plan. Called ONLY after the API confirmed. */
  completeMerge: () => void;
  /** Abandons the plan without touching the basket, so a later login re-plans. */
  abandonMerge: () => void;

  totalQuantity: () => number;
}

const clampQuantity = (quantity: number): number =>
  Math.min(Math.max(1, Math.trunc(quantity)), MAX_LINE_QUANTITY);

export const useGuestCartStore = create<GuestCartState>()(
  persist(
    (set, get) => ({
      items: [],
      pendingMerge: null,

      add: (productId, quantity = 1) => {
        set((state) => {
          const existing = state.items.find((line) => line.productId === productId);

          if (existing !== undefined) {
            return {
              items: state.items.map((line) =>
                line.productId === productId
                  ? { productId, quantity: clampQuantity(line.quantity + quantity) }
                  : line,
              ),
            };
          }

          // Silently ignored past the cap rather than throwing: a basket is not
          // a place to surface a limit nobody can reach through the UI.
          if (state.items.length >= MAX_GUEST_LINES) return state;

          return { items: [...state.items, { productId, quantity: clampQuantity(quantity) }] };
        });
      },

      setQuantity: (productId, quantity) => {
        if (quantity < 1) {
          get().remove(productId);
          return;
        }

        set((state) => ({
          items: state.items.map((line) =>
            line.productId === productId ? { productId, quantity: clampQuantity(quantity) } : line,
          ),
        }));
      },

      remove: (productId) => {
        set((state) => ({ items: state.items.filter((line) => line.productId !== productId) }));
      },

      clear: () => set({ items: [], pendingMerge: null }),

      beginMerge: (targets) => set({ pendingMerge: targets }),

      /*
       * The basket is emptied HERE and nowhere else — after the API has
       * confirmed what it holds. Clearing optimistically, before or during the
       * write, loses a customer's basket to a dropped connection.
       */
      completeMerge: () => set({ items: [], pendingMerge: null }),

      abandonMerge: () => set({ pendingMerge: null }),

      totalQuantity: () => get().items.reduce((total, line) => total + line.quantity, 0),
    }),
    {
      /*
       * A NEW key. The old `nest-cart-storage` holds denormalised products in a
       * shape this store cannot read, and silently reinterpreting one as the
       * other would produce lines with `productId: undefined`. A fresh key
       * means an existing guest basket is not migrated — accepted, because the
       * legacy lines reference Supabase product ids that the API does not know,
       * so there is nothing in them worth carrying across.
       */
      name: 'nest-guest-cart',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items, pendingMerge: state.pendingMerge }),

      /**
       * Sanitises the persisted value as it is read, and NOT in
       * `onRehydrateStorage`.
       *
       * That distinction cost an afternoon. The obvious shape —
       * `onRehydrateStorage: () => (state) => useGuestCartStore.setState(...)` —
       * references the store binding from inside `create()`, before the `const`
       * is initialised. The resulting `ReferenceError` is swallowed by the
       * persist middleware, so hydration silently never completes:
       * `hasHydrated()` stays false for ever, the basket reads as empty, and
       * nothing appears in the console. Measured exactly that way — a basket
       * sitting in `localStorage`, a signed-in customer, and a merge that never
       * fired.
       *
       * `merge` runs during hydration, receives the persisted value, and
       * RETURNS the state to use. It touches no outer binding, so there is
       * nothing to be uninitialised.
       *
       * What it guards against is real: `localStorage` is editable by hand and
       * survives deploys, so this is parsing untrusted input rather than
       * reading our own data back. A malformed line is dropped and the rest
       * survive — one bad entry must not cost a customer their basket.
       */
      merge: (persisted, current) => {
        const isLine = (value: unknown): value is GuestLine =>
          typeof value === 'object' &&
          value !== null &&
          typeof (value as GuestLine).productId === 'string' &&
          Number.isInteger((value as GuestLine).quantity) &&
          (value as GuestLine).quantity > 0;

        const stored = (persisted ?? {}) as Partial<{
          items: unknown;
          pendingMerge: unknown;
        }>;

        const items = Array.isArray(stored.items) ? stored.items.filter(isLine) : [];
        const pending = Array.isArray(stored.pendingMerge)
          ? stored.pendingMerge.filter(isLine)
          : [];

        return {
          ...current,
          items: items.slice(0, MAX_GUEST_LINES),
          pendingMerge: pending.length > 0 ? pending : null,
        };
      },
    },
  ),
);
