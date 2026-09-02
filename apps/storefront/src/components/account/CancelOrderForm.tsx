'use client';

import { useActionState, useState } from 'react';
import { XCircle } from 'lucide-react';
import { cancelOrderAction } from '@/actions/api-account.actions';
import { emptyActionState } from '@/lib/api/action-state';

/**
 * Cancels an order the customer placed. Surfaced for the first time in T2 —
 * the endpoint existed and no UI reached it.
 *
 * ## Two steps, not one click
 *
 * Cancelling is irreversible and returns the stock to the catalogue. The
 * confirmation step is not a modal or a `window.confirm`: it is a small form
 * that appears in place of the button, so it needs no dialog, works without
 * JavaScript having to trap focus, and cannot be dismissed by a stray Escape
 * that the customer reads as "cancelled".
 *
 * ## The reason is required, because the API requires it
 *
 * 3 to 500 characters of free text, stored verbatim on the permanent record and
 * shown back on the order. It is not defaulted on the customer's behalf: a
 * reason nobody typed reads like something they said.
 *
 * ## The 409 is shown, not swallowed
 *
 * This form is drawn from a status the page read when it rendered. The shop may
 * have dispatched the order since, in which case the API answers
 * `409 ORDER_NOT_CANCELLABLE` and that message is what appears here. Hiding it
 * would leave the customer clicking a button that silently does nothing;
 * re-reading the status first would only narrow the window and disguise it.
 */
export function CancelOrderForm({ orderId }: { orderId: string }) {
  const [state, formAction, pending] = useActionState(cancelOrderAction, emptyActionState);
  const [confirming, setConfirming] = useState(false);

  /*
   * Usually unreachable, and kept anyway.
   *
   * The action revalidates this route, so a successful cancellation re-renders
   * the page with `cancellation` populated — and the page replaces this whole
   * component with the record of what happened, which is the better answer.
   * This is the fallback for the case where that re-render has not landed yet,
   * so the customer is never left looking at a button that appears to have
   * done nothing.
   */
  if (state.message !== undefined) {
    return (
      <p role="status" className="text-sm font-medium text-foreground-muted">
        {state.message}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {state.error !== null && (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      )}

      {confirming ? (
        <form action={formAction} className="max-w-lg space-y-3">
          <input type="hidden" name="orderId" value={orderId} />

          <label className="block text-sm">
            <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-foreground-muted">
              Why are you cancelling?
            </span>
            <textarea
              name="reason"
              rows={2}
              required
              minLength={3}
              maxLength={500}
              aria-invalid={state.fieldErrors['reason'] === undefined ? undefined : true}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[15px] focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/5"
            />
            {state.fieldErrors['reason'] !== undefined && (
              <span className="mt-1 block text-[13px] font-medium text-danger">
                {state.fieldErrors['reason']}
              </span>
            )}
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-sm bg-danger px-5 py-2.5 text-[12px] font-black uppercase tracking-widest text-white transition-all hover:opacity-90 disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
              {pending ? 'Cancelling…' : 'Yes, cancel this order'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
              }}
              disabled={pending}
              className="text-[12px] font-bold uppercase tracking-widest text-foreground-muted hover:text-foreground disabled:opacity-50"
            >
              Keep it
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
          }}
          className="inline-flex items-center gap-2 rounded-sm border border-[var(--color-border)] px-5 py-2.5 text-[12px] font-black uppercase tracking-widest text-foreground-muted transition-all hover:border-danger hover:text-danger"
        >
          <XCircle className="h-4 w-4" />
          Cancel order
        </button>
      )}

      <p className="text-xs text-foreground-muted">
        You can cancel until the order is dispatched. The items go straight back into stock.
      </p>
    </div>
  );
}
