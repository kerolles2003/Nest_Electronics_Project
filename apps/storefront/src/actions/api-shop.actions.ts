'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { emptyActionState, type ActionState } from '@/lib/api/action-state';

/**
 * Cart, address and checkout mutations, all of them thin adapters over the API.
 *
 * There is no business logic in this file, and that is the point. Quantities
 * are clamped by the API, the default-address invariant is enforced by the API,
 * every amount is computed by the API, and stock is decided inside the API's
 * placement transaction. What lives here is form-decoding, cache invalidation
 * and navigation.
 */

/**
 * Every surface that renders the cart.
 *
 * A mutation has to invalidate all of them, or the one the customer is NOT
 * looking at serves a stale page the moment they navigate to it. Listed once
 * here rather than repeated at six call sites — which is what made removing the
 * `/shop` duplicates a single edit.
 */
function revalidateCart(): void {
  revalidatePath('/cart');
  revalidatePath('/checkout');
}

/** Likewise for the address book, which checkout also reads. */
function revalidateAddresses(): void {
  revalidatePath('/account/addresses');
  revalidatePath('/checkout');
}

function failure(error: {
  details: readonly { field: string; message: string }[];
  message: string;
  kind: string;
}): ActionState {
  const fieldErrors: Record<string, string> = {};

  for (const d of error.details) {
    if (!(d.field in fieldErrors)) fieldErrors[d.field] = d.message;
  }

  return {
    error: customerMessage(error as Parameters<typeof customerMessage>[0]),
    fieldErrors,
  };
}

// --- cart -------------------------------------------------------------------

export async function addToCartAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const quantity = Number(formData.get('quantity') ?? 1);

  const result = await tryApi(() =>
    api.addCartItem(String(formData.get('productId') ?? ''), Number.isFinite(quantity) ? quantity : 1),
  );

  if (!result.ok) return failure(result.error);

  revalidateCart();
  return emptyActionState;
}

export async function updateCartQuantityAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await tryApi(() =>
    api.updateCartItem(
      String(formData.get('productId') ?? ''),
      Number(formData.get('quantity') ?? 1),
    ),
  );

  if (!result.ok) return failure(result.error);

  revalidateCart();
  return emptyActionState;
}

export async function removeCartItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await tryApi(() => api.removeCartItem(String(formData.get('productId') ?? '')));

  if (!result.ok) return failure(result.error);

  revalidateCart();
  return emptyActionState;
}

// --- addresses --------------------------------------------------------------

export async function createAddressAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const postalCode = String(formData.get('postalCode') ?? '').trim();

  const result = await tryApi(() =>
    api.createAddress({
      label: String(formData.get('label') ?? '').trim(),
      fullName: String(formData.get('fullName') ?? '').trim(),
      phone: String(formData.get('phone') ?? '').trim(),
      street: String(formData.get('street') ?? '').trim(),
      city: String(formData.get('city') ?? '').trim(),
      governorate: String(formData.get('governorate') ?? '').trim(),
      // The API normalises an empty string to null, but sending null outright
      // is the honest expression of "the customer left it blank".
      postalCode: postalCode === '' ? null : postalCode,
      isDefault: formData.get('isDefault') === 'on',
    }),
  );

  if (!result.ok) return failure(result.error);

  revalidateAddresses();
  return emptyActionState;
}

export async function updateAddressAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const postalCode = String(formData.get('postalCode') ?? '').trim();

  const result = await tryApi(() =>
    api.updateAddress(String(formData.get('addressId') ?? ''), {
      label: String(formData.get('label') ?? '').trim(),
      fullName: String(formData.get('fullName') ?? '').trim(),
      phone: String(formData.get('phone') ?? '').trim(),
      street: String(formData.get('street') ?? '').trim(),
      city: String(formData.get('city') ?? '').trim(),
      governorate: String(formData.get('governorate') ?? '').trim(),
      postalCode: postalCode === '' ? null : postalCode,
    }),
  );

  if (!result.ok) return failure(result.error);

  revalidateAddresses();
  return emptyActionState;
}

/**
 * Delete and set-default both return the WHOLE address book, because either can
 * move the default to an address the caller did not name. Nothing here merges a
 * single entry back into a local list — the pages re-read the server's list.
 */
export async function deleteAddressAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await tryApi(() => api.deleteAddress(String(formData.get('addressId') ?? '')));

  if (!result.ok) return failure(result.error);

  revalidateAddresses();
  return emptyActionState;
}

export async function setDefaultAddressAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await tryApi(() => api.setDefaultAddress(String(formData.get('addressId') ?? '')));

  if (!result.ok) return failure(result.error);

  revalidateAddresses();
  return emptyActionState;
}

// --- checkout ---------------------------------------------------------------

/**
 * Places the order and sends the customer to the confirmation screen.
 *
 * ## Duplicate submission
 *
 * The `Idempotency-Key` is generated HERE, once per submission, and the API is
 * the sole guard: a retry with the same key returns the original order (200)
 * instead of creating a second one, and two concurrent submissions with one key
 * produce exactly one order. No client-side "disable the button" flag is
 * treated as the defence — that is a UX nicety, not a guarantee, and building a
 * second frontend idempotency scheme would only give two systems that can
 * disagree.
 *
 * A key per submission (not per session) is the correct granularity: it means
 * "this attempt", so a genuine second order later gets its own key.
 */
export async function placeOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const addressId = String(formData.get('addressId') ?? '').trim();
  const customerNote = String(formData.get('customerNote') ?? '').trim();
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();

  if (addressId === '') {
    return { error: 'Choose a delivery address first.', fieldErrors: { addressId: 'Required' } };
  }

  const result = await tryApi(() =>
    api.placeOrder({ addressId, customerNote, idempotencyKey }),
  );

  if (!result.ok) return failure(result.error);

  revalidateCart();
  revalidatePath('/account/orders');

  // Redirect must happen OUTSIDE the try/catch above: Next implements it by
  // throwing, and catching it would swallow the navigation.
  redirect(`/account/orders/${result.data.data.id}?placed=1`);
}
