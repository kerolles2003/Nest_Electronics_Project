import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * The local wishlist. It keeps SLUGS, not ids.
 *
 * It used to keep product ids, and `/wishlist` then linked each one to
 * `/products/<id>`. Products resolve by slug only — `GET /products/:slug` with
 * an ObjectId is a 404 — so **every link on the wishlist page was dead**, and
 * the page had nothing else to show either, because an id is not a name.
 *
 * A slug is the same one token, is what the route wants, and is already on
 * every `ProductCardDTO`, so this costs no request and adds no feature. The
 * server-side wishlist is still Phase 8; this is a private list in one browser
 * and nothing here pretends otherwise.
 *
 * The storage key is versioned. Entries saved under the old key are ids, and
 * silently reinterpreting an id as a slug would turn a stale wishlist into a
 * page of 404s — exactly the bug being fixed. Bumping the key drops them.
 */
interface WishlistStore {
  /** Product slugs, in the order they were saved. */
  items: string[];
  addItem: (slug: string) => void;
  removeItem: (slug: string) => void;
  toggleItem: (slug: string) => void;
  clearWishlist: () => void;
  hasItem: (slug: string) => boolean;
}

export const useWishlistStore = create<WishlistStore>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (slug) => {
        set((state) => ({
          items: state.items.includes(slug) ? state.items : [...state.items, slug],
        }));
      },
      removeItem: (slug) => {
        set((state) => ({
          items: state.items.filter((saved) => saved !== slug),
        }));
      },
      toggleItem: (slug) => {
        set((state) => {
          if (state.items.includes(slug)) {
            return { items: state.items.filter((saved) => saved !== slug) };
          }
          return { items: [...state.items, slug] };
        });
      },
      clearWishlist: () => set({ items: [] }),
      hasItem: (slug) => get().items.includes(slug),
    }),
    {
      name: 'nest-wishlist-storage-v2',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
