'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mergeGuestCartOnLogin } from '@/lib/cart/merge-guest-cart';
import { useGuestCartStore } from '@/stores/guest-cart-store';

/**
 * Merges the anonymous basket into the customer's cart, once they are signed in.
 *
 * ## Why this is mounted on an authenticated layout rather than run by the login form
 *
 * "Merge at login" is the intent, and the first authenticated render is a
 * strictly better trigger than the login submit handler:
 *
 *   · `loginAction` ends in `redirect()`, which throws, so the form never
 *     observes its own success and has nowhere to put this;
 *   · the guest basket lives in `localStorage`, which a server action cannot
 *     read, so the merge has to begin on the client whatever triggers it;
 *   · a session can arrive without passing through that form — another tab, a
 *     restored cookie, a verification link followed after registering;
 *   · and **an interrupted merge retries by itself here.** The next
 *     authenticated page load picks up the frozen plan and re-applies it,
 *     rather than waiting for the customer to happen to sign in again.
 *
 * ## It renders a message and nothing else
 *
 * The merge never blocks, never redirects and never throws. If it fails, the
 * basket is untouched and the customer is not told — there is nothing for them
 * to do, and the next page view tries again. They are told only when something
 * about their basket actually CHANGED: a line clamped to available stock, or a
 * product that can no longer be bought.
 */
export function GuestCartMerge() {
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  /**
   * Whether the persisted basket has been read out of `localStorage` yet.
   *
   * **This is not defensive; without it the merge never runs.** The store is
   * created during module evaluation, which on a server-rendered page happens
   * before there is a `localStorage` to read — so `getState()` in a mount
   * effect returns the EMPTY initial state, the merge finds nothing to do, and
   * the `started` guard below makes sure it never looks again.
   *
   * Measured exactly that way: the basket sat in `localStorage`, the customer
   * was signed in, and the cart stayed empty with no error anywhere.
   */
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (useGuestCartStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }

    return useGuestCartStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  /*
   * React runs effects twice in development Strict Mode. The merge is
   * idempotent, so a second run is harmless by construction — but it would
   * still fire a second round of API calls, so the ref keeps it to one per
   * mount. The idempotency is the guarantee; this is only politeness.
   */
  const started = useRef(false);

  useEffect(() => {
    if (!hydrated || started.current) return;
    started.current = true;

    const state = useGuestCartStore.getState();

    // Nothing to do, and nothing to retry. Costs no request.
    if (state.items.length === 0 && state.pendingMerge === null) return;

    void mergeGuestCartOnLogin().then((outcome) => {
      if (outcome.message !== null) setMessage(outcome.message);

      /*
       * The cart badge and any cart page rendered from server data are stale the
       * moment the merge lands, because both were rendered before it ran.
       */
      if (outcome.merged) router.refresh();
    });
  }, [hydrated, router]);

  if (message === null) return null;

  return (
    <div
      role="status"
      data-testid="guest-cart-merge-notice"
      className="mx-auto mb-4 max-w-5xl rounded-lg border border-black/10 bg-black/[0.03] px-4 py-3 text-sm"
    >
      {message}
    </div>
  );
}
