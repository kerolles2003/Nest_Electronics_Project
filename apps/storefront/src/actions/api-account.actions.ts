'use server';

import { revalidatePath } from 'next/cache';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { emptyActionState, type ActionState } from '@/lib/api/action-state';

/**
 * The two things a customer can change about their own account, and the one
 * thing they can do to their own order.
 *
 * Both are thin adapters, like every other action file here: the API owns the
 * phone format, the name length, whether an order may still be cancelled and
 * what happens to its stock when it is. Nothing in this file decides any of it.
 */

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

/**
 * Updates the signed-in customer's name and phone.
 *
 * ## Empty phone means REMOVE it, and that is a deliberate reading
 *
 * The form always submits a `phone` field, so "absent" never arrives from a
 * browser — an empty box is the customer clearing the number, and `null` is how
 * the API spells that. Omitting the key instead would make the field
 * unclearable through the only UI that exists for it.
 *
 * ## Email is not here
 *
 * Changing an address is a re-verification flow, not a field edit, and the API
 * has no route for it. The profile page shows the address read-only rather than
 * offering an input that would fail.
 */
export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fullName = String(formData.get('fullName') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();

  const result = await tryApi(() =>
    api.updateProfile({ fullName, phone: phone === '' ? null : phone }),
  );

  if (!result.ok) return failure(result.error);

  revalidatePath('/account/profile');

  return { ...emptyActionState, message: 'Your details have been saved.' };
}

/**
 * Cancels one of the customer's own orders.
 *
 * ## The 409 is the answer, not an error to hide
 *
 * The page decides whether to OFFER this from a status it read when it
 * rendered, which may be minutes old and may since have become `SHIPPED`. When
 * that happens the API answers `409 ORDER_NOT_CANCELLABLE` and the customer is
 * told exactly that — the button was honest when it was drawn, and the server
 * is the authority now. Re-reading the status here first would not close the
 * gap; it would only make it shorter and hide it better.
 *
 * A second submission answers 409 as well rather than cancelling twice, and the
 * stock is restored exactly once however many requests arrive together, so
 * there is no idempotency key to send and none is accepted.
 *
 * ## The reason is required, and is not defaulted here
 *
 * The API takes 3 to 500 characters of free text and stores it verbatim on the
 * permanent record. Supplying "Cancelled by customer" on the customer's behalf
 * when they left the box empty would put words nobody typed onto a record that
 * is shown back to them, so an empty box is refused here with the message the
 * form can act on.
 */
export async function cancelOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const orderId = String(formData.get('orderId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  if (orderId === '') {
    return { error: 'That order could not be identified.', fieldErrors: {} };
  }

  if (reason.length < 3) {
    return {
      error: null,
      fieldErrors: { reason: 'Tell us why in a few words — at least three characters.' },
    };
  }

  const result = await tryApi(() => api.cancelOrder(orderId, reason));

  if (!result.ok) return failure(result.error);

  revalidatePath('/account/orders');
  revalidatePath(`/account/orders/${orderId}`);

  return { ...emptyActionState, message: 'Your order has been cancelled.' };
}
