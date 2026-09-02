'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  addToCartView,
  readCartView,
  removeFromCartView,
  setCartQuantityView,
  type CartViewResult,
} from '@/actions/cart-view.actions';
import { useGuestCartStore } from '@/stores/guest-cart-store';
import type { Cart } from '@/lib/api/types';

/**
 * The one cart the whole storefront reads.
 *
 * ## Two owners, one shape
 *
 * A signed-in customer's cart is the API's. A visitor's basket is their
 * browser's. This component is where that difference stops mattering: both
 * arrive as the API's `Cart`, priced by the API, and every component
 * downstream — the header badge, the drawer, the mobile bar — renders one
 * shape and never asks which it is looking at.
 *
 * The difference that DOES survive is where a write goes. A customer's change
 * is a server action against their cart; a visitor's is a change to the browser
 * store followed by a re-price. Both end with the server's answer replacing
 * local state, never merging into it — the API clamps quantities, so what you
 * asked for and what you have are different questions and only the second one
 * is worth rendering.
 *
 * ## Optimism is deliberately absent
 *
 * Showing a quantity before the server has agreed to it means showing a number
 * that may be wrong — the API clamps to live stock, so "add 40" can legitimately
 * become 12. A brief spinner is better than a total that changes under the
 * customer's eyes a moment after they read it.
 */

interface CartContextValue {
  /** The priced cart. Null only before the first read completes, or after a failure. */
  readonly cart: Cart | null;
  /** True while a read or a write is in flight. */
  readonly busy: boolean;
  /** A message safe to show, or null. */
  readonly error: string | null;
  /** True when the cart is the customer's own rather than a browser basket. */
  readonly signedIn: boolean;
  readonly totalQuantity: number;
  add(productId: string, quantity?: number): Promise<void>;
  setQuantity(productId: string, quantity: number): Promise<void>;
  remove(productId: string): Promise<void>;
  /** Re-reads from the server. Used after a merge, or when a page mutates the cart. */
  refresh(): Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const value = useContext(CartContext);

  if (value === null) {
    throw new Error('useCart must be used inside <CartProvider>');
  }

  return value;
}

export function CartProvider({
  signedIn: signedInFromServer,
  children,
}: {
  /**
   * Whether the request that rendered this page carried a session.
   *
   * Passed from the server layout rather than discovered on the client,
   * because the session cookie is httpOnly and no script can see it — which is
   * the point of storing it that way.
   */
  signedIn: boolean;
  children: ReactNode;
}) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(signedInFromServer);

  const guestItems = useGuestCartStore((state) => state.items);
  const guestAdd = useGuestCartStore((state) => state.add);
  const guestSetQuantity = useGuestCartStore((state) => state.setQuantity);
  const guestRemove = useGuestCartStore((state) => state.remove);

  /**
   * Whether the persisted basket has been read out of `localStorage` yet.
   *
   * Without this the first read prices an EMPTY basket: the store is created
   * during module evaluation, which on a server-rendered page happens before
   * there is a `localStorage` to read, so the initial state is empty and the
   * effect below would fire against it and render "0 items" over a real basket.
   */
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (useGuestCartStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }

    return useGuestCartStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  const apply = useCallback((result: CartViewResult) => {
    setSignedIn(result.signedIn);
    setError(result.error);
    if (result.cart !== null) setCart(result.cart);
  }, []);

  /**
   * The read.
   *
   * `signedIn` is not passed in: the SERVER decides, by looking for a session
   * cookie, and its answer overwrites what this component believed. A session
   * that expired between the page render and this call therefore corrects
   * itself rather than leaving the header showing an account cart nobody is
   * signed into.
   */
  const load = useCallback(async () => {
    setBusy(true);
    try {
      apply(await readCartView(useGuestCartStore.getState().items));
    } catch {
      // A failed read is not worth an error message in a header: the customer
      // did not ask for anything. The cart already on screen stays.
      setError(null);
    } finally {
      setBusy(false);
    }
  }, [apply]);

  /*
   * Re-priced whenever the basket changes, and once after hydration.
   *
   * `guestItems` is the dependency rather than a manual call after each
   * mutation, so a change made anywhere — the drawer, a product card, the merge
   * clearing the basket at sign-in — re-prices without that code having to
   * remember to ask.
   */
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;

    /*
     * The basket is part of the key even when signed in, and that is not
     * redundant. The merge at sign-in EMPTIES the basket once the API has
     * confirmed it, and that emptying is the only signal this component gets
     * that the account cart has just grown. Keying on `'account'` alone would
     * leave the header showing the pre-merge cart until the next navigation.
     */
    const key =
      (signedIn ? 'account|' : 'guest|') +
      guestItems.map((line) => `${line.productId}:${String(line.quantity)}`).join(',');

    if (key === lastKey.current) return;
    lastKey.current = key;

    void load();
  }, [hydrated, signedIn, guestItems, load]);

  const add = useCallback(
    async (productId: string, quantity = 1) => {
      if (!signedIn) {
        // The store change is the mutation; the effect above re-prices it.
        guestAdd(productId, quantity);
        return;
      }

      setBusy(true);
      try {
        apply(await addToCartView(productId, quantity));
      } finally {
        setBusy(false);
      }
    },
    [signedIn, guestAdd, apply],
  );

  const setQuantity = useCallback(
    async (productId: string, quantity: number) => {
      if (!signedIn) {
        if (quantity <= 0) guestRemove(productId);
        else guestSetQuantity(productId, quantity);
        return;
      }

      setBusy(true);
      try {
        apply(await setCartQuantityView(productId, quantity));
      } finally {
        setBusy(false);
      }
    },
    [signedIn, guestRemove, guestSetQuantity, apply],
  );

  const remove = useCallback(
    async (productId: string) => {
      if (!signedIn) {
        guestRemove(productId);
        return;
      }

      setBusy(true);
      try {
        apply(await removeFromCartView(productId));
      } finally {
        setBusy(false);
      }
    },
    [signedIn, guestRemove, apply],
  );

  const refresh = useCallback(async () => {
    lastKey.current = null;
    await load();
  }, [load]);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      busy,
      error,
      signedIn,
      totalQuantity: cart?.totalQuantity ?? 0,
      add,
      setQuantity,
      remove,
      refresh,
    }),
    [cart, busy, error, signedIn, add, setQuantity, remove, refresh],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
