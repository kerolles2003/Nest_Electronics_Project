'use server';

import { revalidatePath } from 'next/cache';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { readSession } from '@/lib/api/session';
import { normaliseGuestLines } from '@/lib/cart/guest-cart';
import type { Cart } from '@/lib/api/types';

/**
 * One cart, whoever is asking.
 *
 * ## The problem this solves
 *
 * The basket in the header has to work for two different people. A signed-in
 * customer's cart lives in the API — clamped to live stock, priced from the
 * catalogue, and the same object checkout will read. A visitor's basket lives
 * in their browser and holds `{productId, quantity}` and nothing else, because
 * a price that round-trips through `localStorage` is a price the customer can
 * edit.
 *
 * Rendering those two from two different code paths is how a basket ends up
 * showing one total before sign-in and another after. So both go through here
 * and both come back as the API's `Cart`: same fields, same money, same status
 * ladder, same clamping. The component that draws it does not know or care
 * which it got.
 *
 * ## Why the guest lines are a parameter
 *
 * They live in the browser, so the server cannot read them. The client sends
 * what it holds and gets back what those ids are actually worth. Nothing is
 * stored; `POST /cart/preview` writes nothing at all.
 */

export interface CartViewResult {
  /** True when the cart came from the customer's account rather than the basket. */
  readonly signedIn: boolean;
  /** The priced cart, or null when it could not be read. */
  readonly cart: Cart | null;
  /** A message already safe to show, or null. */
  readonly error: string | null;
}

/**
 * The empty answer, used when there is nothing to price.
 *
 * Built here rather than requested: asking the API to price zero lines is a
 * round trip whose answer is known, and the header renders on every page.
 */
function emptyCart(): Cart {
  return {
    items: [],
    itemCount: 0,
    totalQuantity: 0,
    itemsSubtotal: { amount: 0, currency: 'EGP', formatted: '0.00 EGP' },
    currency: 'EGP',
    hasBlockingIssues: false,
    updatedAt: null,
    expiresAt: null,
  };
}

export async function readCartView(guestItems: readonly unknown[]): Promise<CartViewResult> {
  const signedIn = (await readSession()) !== null;

  if (signedIn) {
    const result = await tryApi(() => api.getCart());

    if (!result.ok) {
      /*
       * An expired session is not an error worth shouting about in a header:
       * the customer simply is not signed in any more, and the next guarded
       * page they open will say so properly. Their basket is empty from this
       * component's point of view, which is the truth.
       */
      if (result.error.kind === 'unauthenticated') {
        return { signedIn: false, cart: emptyCart(), error: null };
      }

      return { signedIn: true, cart: null, error: customerMessage(result.error) };
    }

    return { signedIn: true, cart: result.data.data, error: null };
  }

  // Normalised here as well as in the store, because this is a server boundary
  // and what arrives at one is never trusted for being well-formed.
  const items = normaliseGuestLines(guestItems);

  if (items.length === 0) {
    return { signedIn: false, cart: emptyCart(), error: null };
  }

  const result = await tryApi(() => api.previewGuestCart(items));

  if (!result.ok) {
    return { signedIn: false, cart: null, error: customerMessage(result.error) };
  }

  return { signedIn: false, cart: result.data.data, error: null };
}

/**
 * Adds to the SIGNED-IN customer's cart and returns the whole cart back.
 *
 * Returning the cart rather than a status is deliberate: every cart route
 * answers with the complete, re-priced cart, so the caller replaces its state
 * instead of merging a delta and slowly drifting out of agreement with the
 * server. A guest never reaches this — their basket is a browser store, and
 * `readCartView` prices it.
 */
export async function addToCartView(
  productId: string,
  quantity: number,
): Promise<CartViewResult> {
  const result = await tryApi(() => api.addCartItem(productId, quantity));

  if (!result.ok) {
    if (result.error.kind === 'unauthenticated') {
      return { signedIn: false, cart: null, error: null };
    }

    return { signedIn: true, cart: null, error: customerMessage(result.error) };
  }

  revalidatePath('/cart');
  revalidatePath('/checkout');

  return { signedIn: true, cart: result.data.data, error: null };
}

/** Sets a line to an exact quantity. Absolute, so repeating it is a no-op. */
export async function setCartQuantityView(
  productId: string,
  quantity: number,
): Promise<CartViewResult> {
  const result = await tryApi(() =>
    quantity <= 0 ? api.removeCartItem(productId) : api.updateCartItem(productId, quantity),
  );

  if (!result.ok) {
    if (result.error.kind === 'unauthenticated') {
      return { signedIn: false, cart: null, error: null };
    }

    return { signedIn: true, cart: null, error: customerMessage(result.error) };
  }

  revalidatePath('/cart');
  revalidatePath('/checkout');

  return { signedIn: true, cart: result.data.data, error: null };
}

export async function removeFromCartView(productId: string): Promise<CartViewResult> {
  return setCartQuantityView(productId, 0);
}
