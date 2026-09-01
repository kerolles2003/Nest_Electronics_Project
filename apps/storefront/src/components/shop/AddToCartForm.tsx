'use client';

import { useActionState } from 'react';
import { addToCartAction } from '@/actions/api-shop.actions';
import { emptyActionState } from '@/lib/api/action-state';

/**
 * Add-to-cart.
 *
 * The cart is SERVER state: this posts to the API and the cart page re-reads
 * it. Nothing is written to a client store or to localStorage, because a second
 * copy would immediately disagree with the API's clamping, re-pricing and line
 * statuses.
 *
 * `useActionState` gives the pending flag and the server's own error message
 * without a bespoke fetch, and the disabled button during submit is a UX
 * nicety — the real duplicate guard for the ORDER is the API's idempotency key.
 */
export function AddToCartForm({ productId }: { productId: string }) {
  const [state, formAction, pending] = useActionState(addToCartAction, emptyActionState);

  return (
    <form action={formAction} className="mt-6 flex items-end gap-3">
      <input type="hidden" name="productId" value={productId} />

      <label className="text-sm">
        <span className="block text-black/60">Quantity</span>
        <input
          type="number"
          name="quantity"
          defaultValue={1}
          min={1}
          className="mt-1 w-24 rounded border border-black/20 px-3 py-2"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-black px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add to cart'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
