'use client';

import { useActionState } from 'react';
import {
  removeCartItemAction,
  updateCartQuantityAction,
} from '@/actions/api-shop.actions';
import { emptyActionState } from '@/lib/api/action-state';

/** Quantity and removal for one cart line. Both write through the API. */
export function CartLineControls({
  productId,
  quantity,
}: {
  productId: string;
  quantity: number;
}) {
  const [updateState, updateAction, updating] = useActionState(
    updateCartQuantityAction,
    emptyActionState,
  );
  const [removeState, removeAction, removing] = useActionState(
    removeCartItemAction,
    emptyActionState,
  );

  const error = updateState.error ?? removeState.error;

  return (
    <div className="mt-3 flex items-center gap-3">
      <form action={updateAction} className="flex items-center gap-2">
        <input type="hidden" name="productId" value={productId} />
        <label className="text-xs text-black/60">
          Qty
          <input
            type="number"
            name="quantity"
            defaultValue={quantity}
            min={1}
            className="ml-2 w-20 rounded border border-black/20 px-2 py-1 text-sm"
          />
        </label>
        <button type="submit" disabled={updating} className="text-xs underline disabled:opacity-50">
          {updating ? 'Updating…' : 'Update'}
        </button>
      </form>

      <form action={removeAction}>
        <input type="hidden" name="productId" value={productId} />
        <button type="submit" disabled={removing} className="text-xs text-red-700 underline disabled:opacity-50">
          {removing ? 'Removing…' : 'Remove'}
        </button>
      </form>

      {error ? (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      ) : null}
    </div>
  );
}
