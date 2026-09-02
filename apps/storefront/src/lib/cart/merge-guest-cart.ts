import { applyGuestCartMerge, planGuestCartMerge } from '@/actions/guest-cart.actions';
import { describeMergeNotices, type GuestLine } from '@/lib/cart/guest-cart';
import { useGuestCartStore } from '@/stores/guest-cart-store';

/**
 * Runs a guest-cart merge, in the one order that survives being interrupted.
 *
 *   1. plan          read-only; nothing has changed if it fails
 *   2. FREEZE        the plan is persisted before a single write happens
 *   3. apply         absolute quantities, so re-applying changes nothing
 *   4. confirm       the basket is emptied only now
 *
 * Step 2 is the one that is easy to leave out and the one the whole guarantee
 * rests on. Without it, a retry re-plans against a cart that already holds some
 * of the guest quantities and adds them a second time.
 *
 * ## Never throws, never blocks sign-in
 *
 * A merge is a convenience attached to logging in, not part of logging in. A
 * failure here leaves the basket exactly as it was — the customer keeps it, and
 * the next sign-in tries again — and returns a message rather than raising.
 * Nothing a delisted product does may stop somebody reaching their account.
 */
export interface MergeOutcome {
  /** True when the API confirmed the cart; the basket has been emptied. */
  readonly merged: boolean;
  /** A sentence for the customer, or `null` when everything moved cleanly. */
  readonly message: string | null;
}

const NOTHING_TO_DO: MergeOutcome = { merged: false, message: null };

export async function mergeGuestCartOnLogin(): Promise<MergeOutcome> {
  const store = useGuestCartStore.getState();

  /*
   * A plan already on disk means a previous attempt was interrupted after it
   * was frozen. Re-applying those targets is the retry, and it is safe
   * precisely because they are the ORIGINAL numbers rather than a new sum.
   */
  const pending = store.pendingMerge;

  if (pending !== null && pending.length > 0) {
    return apply(pending);
  }

  if (store.items.length === 0) return NOTHING_TO_DO;

  const plan = await planGuestCartMerge(store.items).catch(() => null);

  if (plan === null || !plan.ok) {
    // Nothing was written, so there is nothing to unwind. The basket survives.
    return { merged: false, message: null };
  }

  if (plan.targets.length === 0) {
    useGuestCartStore.getState().clear();
    return { merged: true, message: null };
  }

  // FREEZE. Every write below is now repeatable.
  useGuestCartStore.getState().beginMerge(plan.targets);

  return apply(plan.targets);
}

async function apply(targets: GuestLine[]): Promise<MergeOutcome> {
  const applied = await applyGuestCartMerge(targets).catch(() => null);

  if (applied === null || !applied.ok) {
    /*
     * The plan stays on disk. The basket stays on disk. The next sign-in
     * re-applies the same targets, which is why an interrupted merge cannot
     * double anything.
     */
    return { merged: false, message: null };
  }

  /*
   * The basket is cleared as ONE unit, not line by line.
   *
   * If three lines merge and the fourth fails, all four stay in the basket and
   * the retry re-applies all four. That is safe because the targets are
   * absolute — re-applying a line that already landed sets it to the number it
   * already holds — so the only cost is a stale badge for the customer: the
   * basket still shows items that are already in their account, until the next
   * authenticated page load re-applies and clears.
   *
   * Clearing per line would close that window, and it was considered and
   * rejected. It means mutating the frozen plan as the writes land, and the
   * plan is the one thing in this flow that must not change: it is what makes a
   * retry produce the same answer however far the first attempt got. A
   * mutating plan has to be written back after every line, which is another
   * partial-failure surface in the exact place partial failure is being
   * defended against. One frozen plan beats a mutating one, and the window it
   * costs is a single page load.
   */
  useGuestCartStore.getState().completeMerge();

  return { merged: true, message: describeMergeNotices(applied.notices) };
}
