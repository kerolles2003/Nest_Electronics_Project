# Cart Model — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADR:** ADR-CART-001 … 003

---

## 1. The governing principle

> **The cart is a draft intent to purchase. It is never a source of truth for price, stock, or availability.**

The cart records **what** the customer wants (`productId`, `quantity`) and nothing else that matters. Every figure it displays is derived, server-side, from live catalogue data at the moment of the request.

```
Cart request                       Checkout
  ↓                                  ↓
NestJS                             NestJS
  ↓                                  ↓
Load authoritative products        Load authoritative products
  ↓                                  ↓
Re-price + re-check stock          Validate stock + active/deleted
  ↓                                  ↓
Return computed totals             Compute authoritative totals
(display only)                       ↓
                                   Create order
```

The cart contributes `{productId, quantity}` to checkout. Nothing else it holds is trusted.

---

## 2. Legacy state and why it is discarded

| Finding | Evidence |
|---|---|
| **localStorage was the real cart** — the DB cart was write-only | `getCart()` had **0 call sites**; `syncCartToDatabase` only ever wrote |
| **The server cart could not compute money at all** | `cart_items` has **no price column**; `CartService.mapToCart` summed `item.price`, which is always `undefined` → subtotal permanently 0 |
| **Two contradictory merge strategies** | `Math.max` in `cart-store.ts:147` vs `existing + incoming` in `cart.provider.ts:118` |
| **Max quantity 99 defined four times** | `cart-store.ts:5`, `constants.ts:11`, `CartService`, `cartItemSchema` |
| Stock cap enforced **client-side only** | `cart-store.ts:98-102` |
| Subtotal computed in **two** components independently | `CheckoutStepper.tsx:44`, `CartDrawer.tsx:14` |
| Guest-cart merge **never exercised** | Live: 2 carts, both user-bound; **0 guest carts**, `session_id` NULL on both |

**Decision: REDESIGN.** The intent (a persistent cart that merges on login) is right; the implementation is unusable.

---

## 3. Source of truth

| Actor | Cart location | Authoritative? |
|---|---|---|
| **Guest** (unauthenticated) | Browser `localStorage` | Yes — for the guest only. Never sent to the server except at merge. |
| **Authenticated customer** | **Server** (`carts` collection) | **Yes** |

**Decision (ADR-CART-001): the server cart is authoritative once a user is authenticated.**

Rationale:
- Cross-device continuity is the whole point of an account cart. A localStorage-only cart cannot deliver it, and legacy's write-only DB cart delivered the storage cost with none of the benefit.
- Checkout must operate on server state anyway; keeping a second client-side truth is what produced the two divergent subtotal computations.
- Guests get a client cart because creating a server document for every anonymous visitor is unjustified storage and a trivial abuse vector.

**No guest cart token.** A server-side guest cart keyed by an opaque cookie was considered and rejected: it adds a collection, a cookie, an expiry policy and an abuse surface to serve visitors who, per the [`GUEST-CHECKOUT.md`](./GUEST-CHECKOUT.md) decision, must log in to buy anyway. localStorage is sufficient and simpler. Revisit if guest checkout is ever introduced.

---

## 4. Cart document

```jsonc
{
  "_id": ObjectId,
  "userId": ObjectId,              // unique — exactly one cart per user
  "items": [
    {
      "productId": ObjectId,
      "quantity": 2,
      "addedAt": ISODate,
      // display snapshot — refreshed on every read, NEVER trusted
      "snapshot": {
        "name": "ESP32 DevKit V1",
        "sku": "ESP32-DEVKIT-V1",
        "slug": "esp32-devkit-v1",
        "unitPrice": 32500,
        "imagePublicId": "nest/products/…"
      }
    }
  ],
  "updatedAt": ISODate,
  "expiresAt": ISODate            // TTL index, updatedAt + 30 days
}
```

**Only `productId` and `quantity` are persisted intent.** `snapshot` exists so the cart badge and drawer can render without a join, and it is **overwritten on every authoritative read**. It is explicitly marked as display-only in the code, and no checkout path reads it.

> This is the structural fix for the legacy failure: legacy stored *no* price and therefore could not display a subtotal; the naive fix would be to store a price and let it go stale. Storing a snapshot that is *always refreshed and never trusted* gives display performance without creating a second price authority.

---

## 5. Read behaviour — always re-priced

`GET /api/v1/cart` never returns stored numbers.

```
1. Load the cart document
2. Batch-load all referenced products (one query, $in)
3. For each line, recompute:
     unitPrice   = salePrice ?? basePrice          (live)
     lineTotal   = unitPrice × quantity
     available   = stock.onHand                     (live)
     status      = OK | PRICE_CHANGED | REDUCED_STOCK | OUT_OF_STOCK | UNAVAILABLE
4. Refresh each snapshot
5. Compute totals via PricingService (the sole money authority)
6. Return lines + totals + per-line status flags
```

### Line statuses

| Status | Condition | Cart behaviour | Checkout behaviour |
|---|---|---|---|
| `OK` | Available, price unchanged | Included in totals | Proceeds |
| `PRICE_CHANGED` | Live price ≠ last shown | Included at the **new** price, flagged | Proceeds at the new price |
| `REDUCED_STOCK` | `0 < onHand < quantity` | Quantity **clamped** to `onHand`, flagged | Proceeds at the clamped quantity |
| `OUT_OF_STOCK` | `onHand === 0` | Retained, **excluded from totals** | **Blocks** checkout |
| `UNAVAILABLE` | `!isActive` or `deletedAt` | Retained, **excluded from totals** | **Blocks** checkout |

**Unavailable lines are kept, not silently deleted.** The customer must see *why* their total changed. Legacy's plan said "skip + notify"; deleting a line without explanation is a poor experience and hides a real event.

**A price increase does not block checkout**, but the client must display the change so the customer is never charged a price they did not see. The authoritative total always comes from the server.

---

## 6. Write operations

| Operation | Endpoint | Rules |
|---|---|---|
| Add item | `POST /cart/items` | `quantity` integer 1–99; product must be active and not deleted; clamped to `onHand`; **merges** with an existing line for the same product |
| Update quantity | `PATCH /cart/items/:productId` | Same validation; `quantity: 0` is rejected — use DELETE |
| Remove item | `DELETE /cart/items/:productId` | Idempotent |
| Clear cart | `DELETE /cart` | Idempotent |
| Merge guest cart | `POST /cart/merge` | §7 — called once at login |

All are `@Roles('CUSTOMER')` + owner-scoped. `userId` always comes from the JWT; there is no `userId` field in any cart DTO.

### Quantity rules (fixing the four-way duplication)

```
MIN_QUANTITY = 1
MAX_QUANTITY_PER_LINE = 99          // ONE constant, server-side, single source
effectiveMax = min(MAX_QUANTITY_PER_LINE, product.stock.onHand)
```

Server-enforced. The client may cap for UX, but that is an affordance, not a control — legacy's cap existed **only** on the client (B14).

---

## 7. Merge on login

> **DECISION (ADR-CART-002): `max(guestQuantity, serverQuantity)`, then clamp to available stock.**

Legacy had two contradictory implementations. `max` is chosen because it matches the documented intent (`plan_business_logic.md` §5: *"Take the higher quantity (user intent preservation)"*), and because `sum` produces a surprising result — a customer who added 2 on their phone and 2 on their laptop wants 2, not 4.

```
POST /cart/merge   { items: [{ productId, quantity }] }   // called once, right after login

for each guest line:
    if product is unavailable        -> skip, report as `skipped`
    if line exists on the server     -> quantity = max(guest, server)
    else                             -> append
    quantity = min(quantity, MAX_QUANTITY_PER_LINE, product.stock.onHand)

return the merged cart + a report of skipped lines
```

- **Idempotent.** Re-sending the same payload produces the same cart (a property `sum` would not have).
- Skipped lines are **reported**, so the UI can say "2 items are no longer available" rather than silently dropping them.
- The client clears localStorage only **after** a successful merge response.
- This path is **untested in legacy** (0 guest carts ever existed), so it requires explicit integration tests.

---

## 8. Expiry

| Rule | Value |
|---|---|
| TTL | **30 days** from `updatedAt` |
| Mechanism | MongoDB TTL index on `expiresAt` |
| Refresh | Any cart write pushes `expiresAt` forward |
| Guest cart | Persists in localStorage until cleared by the browser |

Legacy had no expiry, so carts would accumulate forever. 30 days is long enough that a returning customer finds their cart and short enough to bound growth.

---

## 9. Cart → order handoff

**The cart is not passed to order creation.** The checkout request references the cart, and the server re-derives everything:

```
POST /api/v1/orders
{
  "addressId": "…"  |  "shippingAddress": { … },
  "couponCode": "MAKER10",          // optional
  "customerNote": "…"                // optional
}
Header: Idempotency-Key: <uuid>
```

Note what is **absent**: no items, no prices, no totals, no `userId`. The server loads the user's cart, then performs the full validation and pricing sequence in [`ORDER-LIFECYCLE.md`](./ORDER-LIFECYCLE.md) §7.

**This is the structural guarantee that a client cannot influence what it pays.** Legacy already discarded client prices inside `create_order_v2` (correct), but the client still supplied the item list — and with no `quantity > 0` check, a negative quantity could reduce the order total (F-CRIT-3). Deriving the item list from the server cart, with validation, closes that class of attack entirely.

**On success** the cart is cleared inside the order transaction. If the order fails, the cart is untouched.

A separate `POST /checkout/quote` returns the same computed totals **without** creating an order, so the checkout UI can show shipping and discount before submission — using server-computed values, never its own arithmetic.

---

## 10. What the cart does *not* do

| Excluded | Reason |
|---|---|
| Store authoritative prices | The defining rule of this document |
| Reserve stock | No reservations ([`INVENTORY-MODEL.md`](./INVENTORY-MODEL.md) §2) |
| Hold coupons | A coupon is applied at quote/checkout, validated live. Storing it on the cart would let an expired coupon look valid. |
| Multiple named carts / saved lists | No requirement; wishlist is a separate deferred concern |
| Guest server carts | §3 |
| Compute totals on the client | Forbidden — the legacy defect being fixed |

---

## 11. Summary of decisions

| # | Decision | Fixes |
|---|---|---|
| 1 | Server cart authoritative for authenticated users; localStorage for guests | Write-only DB cart |
| 2 | Persist only `{productId, quantity}` + a refresh-on-read display snapshot | No price column → permanently-0 subtotal |
| 3 | **Every read re-prices and re-checks stock** from live catalogue | Stale prices; client-side subtotals |
| 4 | Per-line status flags; unavailable lines retained but excluded | Silent line deletion |
| 5 | **One** merge strategy: `max`, then clamp | Two contradictory implementations |
| 6 | **One** `MAX_QUANTITY_PER_LINE` constant, server-enforced | Defined in four places, client-enforced |
| 7 | 30-day TTL | Unbounded growth |
| 8 | Checkout sends **no items and no prices** | Client influence over payable amounts |
| 9 | Separate `/checkout/quote` for pre-submission totals | Client-side total arithmetic |
