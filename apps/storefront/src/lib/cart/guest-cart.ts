/**
 * The guest cart, and the rules for merging it into a customer's server cart.
 *
 * Authority: PLAN.md §8 — "a thin store holding `{productId, qty}` only, priced
 * by the API at render, merged into the API cart at login".
 *
 * ## Why the store holds no prices
 *
 * The legacy sync sent `price`, `name`, `imageUrl` and `maxStock` FROM THE
 * CLIENT to a server action that trusted them (`cart.actions.ts`
 * `syncCartToDatabase`). A cart line whose price came from `localStorage` is a
 * price the customer can edit. Nothing downstream re-checked it.
 *
 * So the guest store holds an identifier and a number, and everything else —
 * the price, the name, the image, whether the thing can be bought at all — is
 * answered by the API at render time. There is nothing here worth tampering
 * with, which is a stronger property than validating the tampering.
 *
 * ## Everything in this file is pure
 *
 * No React, no Next, no network. That is deliberate: the merge is the one piece
 * of real logic in the storefront, and the storefront has no unit-test runner —
 * so the rules live in functions that `e2e/guest-cart-merge.spec.ts` can call
 * directly, and the server action becomes a thin wiring layer with nothing to
 * test but its plumbing.
 */

/** The hard per-line cap. Matches the API's `MAX_QUANTITY_PER_LINE`. */
export const MAX_LINE_QUANTITY = 99;

/**
 * The most guest lines a merge will process.
 *
 * The store cannot exceed this through the UI, so the cap exists for the other
 * caller: a hand-crafted POST to the server action. Without it, one request
 * could ask the storefront to make ten thousand API calls on its behalf.
 */
export const MAX_GUEST_LINES = 50;

export interface GuestLine {
  readonly productId: string;
  readonly quantity: number;
}

/** What the API's cart currently holds, reduced to what the merge needs. */
export interface ServerLine {
  readonly productId: string;
  readonly quantity: number;
}

export type MergeNoticeKind = 'clamped' | 'unavailable';

export interface MergeNotice {
  readonly productId: string;
  readonly kind: MergeNoticeKind;
  /** What the merge asked for. */
  readonly requested: number;
  /** What the cart ended up with. `0` when the line could not be added at all. */
  readonly applied: number;
}

/** A 24-character hex ObjectId, which is the only shape the API accepts. */
const PRODUCT_ID = /^[0-9a-f]{24}$/;

/**
 * Keeps only lines that could possibly be valid, and sums any duplicates.
 *
 * The store maintains one line per product, so duplicates should not occur —
 * but this also parses input that arrived over the wire from a client, where
 * "should not" is not a guarantee. A malformed line is dropped rather than
 * rejected outright: one bad entry in `localStorage` must not stop a customer
 * signing in with the rest of their basket.
 */
export function normaliseGuestLines(input: readonly unknown[]): GuestLine[] {
  const byProduct = new Map<string, number>();

  for (const raw of input.slice(0, MAX_GUEST_LINES)) {
    if (typeof raw !== 'object' || raw === null) continue;

    const { productId, quantity } = raw as { productId?: unknown; quantity?: unknown };

    if (typeof productId !== 'string' || !PRODUCT_ID.test(productId)) continue;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) continue;

    byProduct.set(productId, (byProduct.get(productId) ?? 0) + quantity);
  }

  return [...byProduct].map(([productId, quantity]) => ({
    productId,
    quantity: Math.min(quantity, MAX_LINE_QUANTITY),
  }));
}

/**
 * The absolute quantity each guest line should end up at.
 *
 * ## The rules, all four of them
 *
 * | Guest | Server | Result |
 * |---|---|---|
 * | 3 | absent | 3 — the line moves |
 * | 3 | a DIFFERENT product | both survive; the server line is not in the plan at all |
 * | 3 | 2 of the same product | **5 — the quantities SUM** |
 * | 60 | 60 of the same product | 99 — capped, and the API clamps again to stock |
 *
 * **Summing is a product decision, not an implementation detail.** A customer
 * who put two of something in their basket while logged out, having already
 * left two in their account, wants four. The alternatives were considered and
 * are worse: `max()` silently discards the smaller intent, and "server wins"
 * throws away the basket they just built.
 *
 * Stock is deliberately NOT consulted here. The API clamps every write to
 * `min(99, onHand)` and is the only thing that knows the live number; a client
 * that clamped first would be guessing, and would disagree the moment stock
 * moved between the plan and the write.
 *
 * ## Why the result is ABSOLUTE, and why that is the whole idempotency story
 *
 * The returned quantities are what the cart should CONTAIN, not what to add.
 * Applying them is therefore repeatable: converging a line to 5 twice leaves 5.
 *
 * That only holds if the plan is computed once. Recomputing after a partial
 * merge would read a server cart that already contains the guest quantity and
 * add it again — so the caller freezes this result before applying any of it,
 * and a retry re-applies the SAME targets rather than making a new plan.
 */
export function planMerge(
  guest: readonly GuestLine[],
  server: readonly ServerLine[],
): GuestLine[] {
  const serverQuantities = new Map(server.map((line) => [line.productId, line.quantity]));

  return guest.map((line) => ({
    productId: line.productId,
    quantity: Math.min(line.quantity + (serverQuantities.get(line.productId) ?? 0), MAX_LINE_QUANTITY),
  }));
}

/**
 * What the customer needs to be told, by comparing the plan to what happened.
 *
 * Derived from the cart the API actually returned rather than from what the
 * writes claimed, because the API clamps to live stock and is the only
 * authority on the outcome. A line that vanished entirely is `unavailable`; one
 * that arrived smaller than asked is `clamped`.
 *
 * Silence is the failure mode this exists to prevent. A basket that quietly
 * loses two of something between signing in and checking out is a customer who
 * finds out at the payment screen, or worse, when the parcel arrives.
 */
export function summariseMerge(
  targets: readonly GuestLine[],
  resulting: readonly ServerLine[],
): MergeNotice[] {
  const actual = new Map(resulting.map((line) => [line.productId, line.quantity]));
  const notices: MergeNotice[] = [];

  for (const target of targets) {
    const applied = actual.get(target.productId) ?? 0;

    if (applied === 0) {
      notices.push({ productId: target.productId, kind: 'unavailable', requested: target.quantity, applied: 0 });
      continue;
    }

    if (applied < target.quantity) {
      notices.push({ productId: target.productId, kind: 'clamped', requested: target.quantity, applied });
    }
  }

  return notices;
}

/**
 * One sentence a customer can act on, or `null` when nothing changed.
 *
 * Names counts rather than products because the guest store holds no names —
 * that is the price of not trusting the client with them, and it is the right
 * trade: the cart page beneath this message shows every line, priced by the
 * API, so the detail is one glance away.
 */
export function describeMergeNotices(notices: readonly MergeNotice[]): string | null {
  if (notices.length === 0) return null;

  const unavailable = notices.filter((notice) => notice.kind === 'unavailable').length;
  const clamped = notices.length - unavailable;

  const parts: string[] = [];

  if (clamped > 0) {
    parts.push(
      clamped === 1
        ? 'one item was reduced to the quantity we have in stock'
        : `${String(clamped)} items were reduced to the quantities we have in stock`,
    );
  }

  if (unavailable > 0) {
    parts.push(
      unavailable === 1
        ? 'one item is no longer available and was not added'
        : `${String(unavailable)} items are no longer available and were not added`,
    );
  }

  return `Your basket was merged with your account, but ${parts.join(' and ')}.`;
}
