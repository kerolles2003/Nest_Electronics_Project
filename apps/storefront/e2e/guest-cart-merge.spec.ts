import { expect, test } from '@playwright/test';
import {
  MAX_GUEST_LINES,
  MAX_LINE_QUANTITY,
  describeMergeNotices,
  normaliseGuestLines,
  planMerge,
  summariseMerge,
  type GuestLine,
  type ServerLine,
} from '../src/lib/cart/guest-cart';

/**
 * The guest-cart merge rules, tested as the pure functions they are.
 *
 * No browser, no server, no database — these cases run in Playwright's node
 * worker. The storefront has no unit-test runner, and adding one for a single
 * module would be more infrastructure than the module deserves; putting the
 * rules in pure functions and calling them here is the same coverage with none
 * of it.
 *
 * The end-to-end half — that these rules actually reach the API cart, and that
 * an interrupted merge does not double anything — is
 * `guest-cart-journey.spec.ts`, in a real browser against the real API.
 */

const A = '68b000000000000000000001';
const B = '68b000000000000000000002';
const C = '68b000000000000000000003';

const guest = (productId: string, quantity: number): GuestLine => ({ productId, quantity });
const server = (productId: string, quantity: number): ServerLine => ({ productId, quantity });

test.describe('planMerge — the four rules', () => {
  test('guest items + an EMPTY server cart: everything moves', async () => {
    expect(planMerge([guest(A, 2), guest(B, 1)], [])).toEqual([guest(A, 2), guest(B, 1)]);
  });

  test('guest items + DIFFERENT server items: union, and the server lines are untouched', async () => {
    /*
     * The server's own lines are deliberately absent from the plan. A plan that
     * restated them would be a plan that could get them wrong — and the merge
     * would start rewriting quantities nobody asked it to touch.
     */
    const plan = planMerge([guest(A, 2)], [server(B, 5)]);

    expect(plan).toEqual([guest(A, 2)]);
    expect(plan.map((line) => line.productId)).not.toContain(B);
  });

  test('the SAME product in both: the quantities SUM', async () => {
    // The product decision. A customer with two in their account and two in
    // their guest basket wants four, not two.
    expect(planMerge([guest(A, 2)], [server(A, 3)])).toEqual([guest(A, 5)]);
  });

  test('summing past the per-line cap is capped, not rejected', async () => {
    expect(planMerge([guest(A, 60)], [server(A, 60)])).toEqual([guest(A, MAX_LINE_QUANTITY)]);
  });

  test('does NOT consult stock — that is the API\'s to clamp', async () => {
    /*
     * Deliberate. The client does not know live stock, and a plan that guessed
     * would disagree with the API the moment somebody else bought the last one.
     * The API clamps every write to `min(99, onHand)`, so the plan may ask for
     * more than exists and the answer is still correct.
     */
    expect(planMerge([guest(A, 40)], [server(A, 40)])).toEqual([guest(A, 80)]);
  });

  test('produces ABSOLUTE quantities, which is what makes applying it repeatable', async () => {
    /*
     * The property the whole idempotency argument rests on. `planMerge` says
     * what the cart should CONTAIN. Converging a line to 5 twice leaves 5;
     * adding 2 twice does not.
     */
    const first = planMerge([guest(A, 2)], [server(A, 3)]);

    // Re-applying the plan's own output as the server state must be a no-op...
    expect(planMerge(first, first)).not.toEqual(first);
    // ...which is precisely why the caller must NOT re-plan on retry. It
    // re-applies. This assertion documents the trap rather than hiding it.
    expect(planMerge(first, first)).toEqual([guest(A, 10)]);
  });
});

test.describe('normaliseGuestLines — untrusted input', () => {
  test('keeps well-formed lines', async () => {
    expect(normaliseGuestLines([{ productId: A, quantity: 2 }])).toEqual([guest(A, 2)]);
  });

  test('drops a malformed line and keeps the rest', async () => {
    /*
     * `localStorage` is editable by hand and survives deploys. One bad entry
     * must not stop a customer signing in with the rest of their basket, so
     * bad lines are dropped rather than the whole input rejected.
     */
    const lines = normaliseGuestLines([
      { productId: A, quantity: 2 },
      { productId: 'not-an-object-id', quantity: 1 },
      { productId: B },
      { quantity: 3 },
      null,
      'nonsense',
      { productId: C, quantity: 0 },
      { productId: C, quantity: -5 },
      { productId: C, quantity: 1.5 },
    ]);

    expect(lines).toEqual([guest(A, 2)]);
  });

  test('sums duplicates rather than letting one win', async () => {
    expect(normaliseGuestLines([
      { productId: A, quantity: 2 },
      { productId: A, quantity: 3 },
    ])).toEqual([guest(A, 5)]);
  });

  test('caps the number of lines a single request can ask it to process', async () => {
    // The store cannot exceed this through the UI. The cap is for the other
    // caller: a hand-crafted POST that would otherwise make the storefront
    // issue thousands of API calls on its behalf.
    const many = Array.from({ length: MAX_GUEST_LINES + 20 }, (_, index) => ({
      productId: `68b0000000000000000${String(index).padStart(5, '0')}`,
      quantity: 1,
    }));

    expect(normaliseGuestLines(many)).toHaveLength(MAX_GUEST_LINES);
  });
});

test.describe('summariseMerge — telling the customer what changed', () => {
  test('says nothing when everything landed as planned', async () => {
    expect(summariseMerge([guest(A, 5)], [server(A, 5)])).toEqual([]);
  });

  test('reports a line the API clamped to available stock', async () => {
    expect(summariseMerge([guest(A, 10)], [server(A, 4)])).toEqual([
      { productId: A, kind: 'clamped', requested: 10, applied: 4 },
    ]);
  });

  test('reports a line that never arrived as unavailable', async () => {
    // Delisted, deleted or sold out entirely: the API refused the write, so the
    // product is simply absent from the cart it returned.
    expect(summariseMerge([guest(A, 3)], [])).toEqual([
      { productId: A, kind: 'unavailable', requested: 3, applied: 0 },
    ]);
  });

  test('reports each line independently, and never invents one', async () => {
    const notices = summariseMerge(
      [guest(A, 10), guest(B, 2), guest(C, 1)],
      [server(A, 4), server(B, 2)],
    );

    expect(notices).toEqual([
      { productId: A, kind: 'clamped', requested: 10, applied: 4 },
      { productId: C, kind: 'unavailable', requested: 1, applied: 0 },
    ]);
  });

  test('a line that ended up LARGER is not a notice', async () => {
    // Another tab added to the same cart between the plan and the read. The
    // customer has more than they asked for, which is not something to warn
    // about — and reporting it would be reporting on somebody else's action.
    expect(summariseMerge([guest(A, 2)], [server(A, 7)])).toEqual([]);
  });
});

test.describe('describeMergeNotices — the sentence', () => {
  test('is null when nothing changed, so nothing is rendered', async () => {
    expect(describeMergeNotices([])).toBeNull();
  });

  test('names both kinds in one sentence', async () => {
    const message = describeMergeNotices([
      { productId: A, kind: 'clamped', requested: 10, applied: 4 },
      { productId: B, kind: 'unavailable', requested: 1, applied: 0 },
    ]);

    expect(message).toContain('reduced to the quantity we have in stock');
    expect(message).toContain('no longer available');
  });

  test('never names a product, because the store holds no names', async () => {
    /*
     * The price of not trusting the client with product data, and the right
     * trade: the cart page beneath this message lists every line, priced by the
     * API, so the detail is one glance away.
     */
    const message = describeMergeNotices([
      { productId: A, kind: 'clamped', requested: 10, applied: 4 },
    ]);

    expect(message).not.toContain(A);
  });

  test('agrees in number', async () => {
    const one = describeMergeNotices([
      { productId: A, kind: 'unavailable', requested: 1, applied: 0 },
    ]);
    const two = describeMergeNotices([
      { productId: A, kind: 'unavailable', requested: 1, applied: 0 },
      { productId: B, kind: 'unavailable', requested: 1, applied: 0 },
    ]);

    expect(one).toContain('one item is no longer available');
    expect(two).toContain('2 items are no longer available');
  });
});
