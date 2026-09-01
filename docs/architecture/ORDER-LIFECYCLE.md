# Order Domain & State Machine — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADRs:** ADR-ORDER-001 … 006

> The backend owns **every** state transition. No client, no database function, and no direct write may change an order's status. This is the structural answer to the legacy failure where the transition matrix lived only in admin app code while the underlying RPC was callable by `anon` (F-CRIT-1 / F-HIGH-1).

---

## 1. The core redesign: three status columns → one lifecycle + payment

### What legacy had

| Column | Values |
|---|---|
| `order_status` | `pending_payment`, `paid`, `processing`, `shipped`, `delivered`, `cancelled`, `failed` |
| `payment_status` | `pending`, `authorized`, `paid`, `failed`, `refunded`, `partially_refunded` |
| `fulfillment_status` | `unfulfilled`, `processing`, `shipped`, `delivered`, `returned` |

Three **independent** columns = 7 × 6 × 5 = **210 combinations**, with **no cross-field validation anywhere**. Live data already contained incoherent states:

- 2 orders `shipped` while `payment_status = 'pending'`
- 1 order `delivered` while `fulfillment_status = 'unfulfilled'`

`fulfillment_status` was almost entirely a duplicate of `order_status` (`processing`/`shipped`/`delivered` appear in both).

### Why the legacy vocabulary was structurally wrong

`pending_payment → paid → processing` describes a **prepaid** flow: take money, then fulfil. **The MVP is Cash on Delivery.** There is no payment step before dispatch — cash is collected *at* delivery, at the very end.

This mismatch is not cosmetic; it is the **root cause of the dead reservation subsystem**. `release_expired_reservations()` targeted `order_status = 'pending_payment'`, but both order-creation functions hard-coded `'processing'`. No order could ever reach the state the cron job was looking for, so it ran **35,309 times as a no-op**. The reservation design was inherited from a prepaid flow that was never built.

### What the new system has

> **ONE `status` lifecycle** (fulfilment reality) **+ ONE `payment.status`** (has cash been collected?).
> `fulfillment_status` is **deleted** as redundant.

---

## 2. Order status enumeration

| Status | Meaning | Terminal? | Stock committed? |
|---|---|---|---|
| `PLACED` | Customer submitted; stock already decremented; awaiting admin verification | no | ✅ yes |
| `CONFIRMED` | Admin verified the order (typically a phone confirmation call) | no | ✅ yes |
| `SHIPPED` | Dispatched to the courier; tracking assigned | no | ✅ yes |
| `DELIVERED` | Customer received the goods **and** paid the courier | **yes** | ✅ yes |
| `DELIVERY_FAILED` | Courier attempted and failed (unreachable, refused, wrong address) | no | ✅ yes |
| `CANCELLED` | Cancelled before dispatch; **stock restored** | **yes** | ❌ restored |
| `RETURNED` | Goods came back; **stock restored** | **yes** | ❌ restored |

**Seven statuses, one axis.** Compare to 210 legacy combinations.

### Why `PLACED` and `CONFIRMED` are separate

This is a deliberate COD-specific decision, not ceremony. In the Egyptian COD market, merchants routinely **call the customer to confirm** before dispatching, because unverified COD orders have a material refusal rate. `PLACED → CONFIRMED` models that real business step, gives the admin a work queue, and gives the customer an honest status. It is the one place where the new machine is *more* granular than strictly necessary, and it earns its place.

### Why `DELIVERY_FAILED` exists (new)

Legacy had no way to express a failed delivery attempt — the single most common COD exception. Without it, an admin's only options are to leave the order `shipped` indefinitely or falsely mark it `delivered`. `DELIVERY_FAILED` supports a **retry** (back to `SHIPPED`) or a **return**, and records the attempt count.

### Statuses deliberately removed

| Legacy value | Disposition | Reason |
|---|---|---|
| `pending_payment` | **REMOVED** | No pre-dispatch payment exists under COD. This value is what made the reservation cron unreachable. |
| `paid` (as an *order* status) | **REMOVED** | Payment is a separate axis, not a fulfilment stage. Retained as `payment.status = PAID`. |
| `processing` | **RENAMED → `CONFIRMED`** | "Processing" is vague; `CONFIRMED` names the actual business event. |
| `failed` | **REPLACED by `DELIVERY_FAILED` / `CANCELLED`** | Legacy `failed` conflated payment failure with delivery failure. |
| entire `fulfillment_status` axis | **REMOVED** | Redundant with `status`. |
| `authorized`, `partially_refunded` | **REMOVED** | Artefacts of a card-payment provider that does not exist. |

---

## 3. Payment status (COD)

| Status | Meaning | Set by |
|---|---|---|
| `PENDING` | Cash not yet collected — the state of every COD order until delivery | System, at placement |
| `PAID` | Courier collected the cash | System, automatically on `→ DELIVERED` |
| `REFUNDED` | Money returned to the customer (manual, out-of-band) | Admin, explicitly |

**Rule (ADR-ORDER-002): `DELIVERED` implies `PAID`.** Under COD, delivery *is* the payment event — the courier does not hand over goods without collecting. If cash was not collected, the order was not delivered; it is `DELIVERY_FAILED`. The transition to `DELIVERED` therefore sets `payment.status = PAID` and `payment.collectedAt` **in the same atomic operation**.

This makes the incoherent live combination *"shipped + payment pending"* representable (correctly — goods are in transit, cash not yet collected) while making *"delivered + payment pending"* **structurally impossible**.

`REFUNDED` is only reachable from `PAID`, and only on a `DELIVERED` or `RETURNED` order.

**No refund workflow.** The legacy plan specified a 5-state refund lifecycle (`requested → approved → processed → completed/failed`). It was never built, and with no payment provider it would model nothing real — refunds are a bank transfer or wallet payment made by hand. MVP records the *outcome* (`REFUNDED` + `refundedAmount` + `refundNote`), not a workflow. **REMOVED** per BEHAVIOR-DECISIONS O13.

---

## 4. State machine

```
                        ┌──────────┐
      customer places   │  PLACED  │  stock committed, ledger written
      ─────────────────▶│          │  payment: PENDING
                        └────┬─────┘
                   admin     │      customer/admin cancels
                  confirms   │      ┌──────────────────────┐
                             ▼      ▼                      │
                        ┌───────────┐                 ┌────┴──────┐
                        │ CONFIRMED │────cancel──────▶│ CANCELLED │ (terminal)
                        └────┬──────┘                 │ stock ⟲   │
                    admin    │                        └───────────┘
                    ships    │  requires carrier + trackingNumber
                             ▼
                        ┌───────────┐
              ┌────────▶│  SHIPPED  │
              │         └────┬──────┘
              │              │
       retry  │       ┌──────┴───────┐
     dispatch │       │              │
              │       ▼              ▼
        ┌─────┴──────────┐    ┌─────────────┐
        │ DELIVERY_FAILED│    │  DELIVERED  │ (terminal)
        │ attempts++     │    │ payment:PAID│
        └─────┬──────────┘    └──────┬──────┘
              │                      │
              │ give up              │ customer returns
              ▼                      ▼
        ┌───────────────────────────────┐
        │           RETURNED            │ (terminal)
        │      stock ⟲ · refund?        │
        └───────────────────────────────┘
```

---

## 5. Transition matrix (authoritative)

`C` = Customer (owner) · `A` = Admin/Super Admin · `S` = System

| # | From | To | Allowed | Actor | Required input | Side effects |
|---|---|---|---|---|---|---|
| T0 | *(none)* | `PLACED` | ✅ | C | address, items, optional coupon, `Idempotency-Key` | **Decrement stock** · ledger `SALE` per line · `salesCount++` · redeem coupon · snapshot pricing · history · **email: order received** |
| T1 | `PLACED` | `CONFIRMED` | ✅ | A | optional note | history · **email: order confirmed** |
| T2 | `PLACED` | `CANCELLED` | ✅ | **C** or A | reason | **Restore stock** · ledger `CANCELLATION` · `salesCount--` · release coupon redemption · history · email |
| T3 | `CONFIRMED` | `SHIPPED` | ✅ | A | **`carrier` + `trackingNumber` (required)** | set `shipment` · `shippedAt` · history · **email: shipped + tracking** |
| T4 | `CONFIRMED` | `CANCELLED` | ✅ | **C** or A | reason | as T2 |
| T5 | `SHIPPED` | `DELIVERED` | ✅ | A | optional note | **`payment.status = PAID`** · `payment.collectedAt` · `deliveredAt` · `user.stats` update · history · **email: delivered** |
| T6 | `SHIPPED` | `DELIVERY_FAILED` | ✅ | A | failure reason | `deliveryAttempts++` · history · email |
| T7 | `DELIVERY_FAILED` | `SHIPPED` | ✅ | A | optional new tracking | re-dispatch · history |
| T8 | `DELIVERY_FAILED` | `RETURNED` | ✅ | A | reason | **Restore stock** · ledger `RETURN` · `salesCount--` · release coupon · history |
| T9 | `DELIVERED` | `RETURNED` | ✅ | A | reason | **Restore stock** · ledger `RETURN` · `salesCount--` · flag for manual refund · history |
| T10 | `SHIPPED` | `CANCELLED` | ❌ | — | — | Goods are with the courier; the correct path is `DELIVERY_FAILED → RETURNED` |
| T11 | `DELIVERED` | `CANCELLED` | ❌ | — | — | Use `RETURNED` |
| T12 | any | *(same state)* | ❌ | — | — | No-op transitions are rejected |
| T13 | `CANCELLED` / `RETURNED` | anything | ❌ | — | — | **Terminal.** No resurrection. |
| T14 | any backwards move | — | ❌ | — | — | e.g. `DELIVERED → PLACED` — the exact class of transition legacy permitted |

**Payment transitions (independent, admin-only):**

| From | To | Actor | Condition |
|---|---|---|---|
| `PAID` | `REFUNDED` | A | Order is `DELIVERED` or `RETURNED`; requires `refundedAmount` + `refundNote` |

### Customer-initiated cancellation (new capability)

Legacy had **no** customer cancellation path. Added because it is a basic COD expectation and materially reduces support load.

- Permitted **only** while `PLACED` or `CONFIRMED` — i.e. before the goods leave the warehouse.
- Subject to `OwnershipGuard`: a customer may cancel only their own order.
- Produces exactly the same side effects as an admin cancellation. There is one code path; only the actor recorded in history differs.

---

## 6. Enforcement

Every transition passes through **one** service method. There is no other way to change an order's status.

```
PATCH /api/v1/orders/:id/cancel              (customer, own order)
PATCH /api/v1/admin/orders/:id/status        (admin)
                    │
                    ▼
        JwtAuthGuard → RolesGuard → OwnershipGuard
                    ▼
        OrdersService.transition(orderId, toStatus, actor, input)
                    ▼
   ┌───────────────── MongoDB transaction ─────────────────┐
   │ 1. Load order (inside the transaction)                │
   │ 2. Assert TRANSITIONS[from] includes to  ──▶ 409      │
   │ 3. Assert actor is permitted for this edge ──▶ 403    │
   │ 4. Validate required input (e.g. trackingNumber)──▶400│
   │ 5. Guarded update: { _id, status: <from> }            │
   │      matchedCount === 0  ──▶ 409 CONFLICT             │
   │ 6. Apply side effects (stock, coupon, counters)       │
   │ 7. Append statusHistory entry                         │
   └───────────────────────────────────────────────────────┘
                    ▼
        Commit → emit audit + notification events
```

**Step 5 is what closes the legacy TOCTOU race (M8/O9).** Legacy read the current status in the application, checked the matrix, then issued a separate RPC — two admins acting simultaneously could both pass the check. The guarded update makes the read-check-write atomic: if another actor changed the status in between, `matchedCount === 0` and the transition is rejected with `409`.

Legacy's `update_order_status_v2` *did* take a `FOR UPDATE` row lock, but the lock was useless because the validation happened in a previous round trip, outside it.

---

## 7. Order creation

```
POST /api/v1/orders            (authenticated; Idempotency-Key required)
```

```
1  VALIDATE
   · userId from JWT — never from the body            [fixes F-CRIT-2]
   · cart non-empty                                    [fixes F-MED-1]
   · each quantity: integer, 1 ≤ q ≤ 99                [fixes F-CRIT-3]
   · address complete; Egyptian phone format, server-side
   · idempotency key unused (else return the prior order)

2  LOAD AUTHORITATIVE DATA (never trust the cart)
   · re-read every product by id
   · assert isActive && !deletedAt                     [fixes F-HIGH-3]
   · assert stock.onHand >= quantity
   · read the CURRENT effectiveUnitPrice = salePrice ?? basePrice

3  PRICE  (PricingService — the sole money authority)
   · lineTotal = unitPrice × quantity
   · itemsSubtotal = Σ lineTotal
   · validate + apply coupon → discountTotal (clamped to [0, itemsSubtotal])
   · shippingFee = FulfilmentService.quote(governorate, subtotal - discount)
   · grandTotal = itemsSubtotal - discountTotal + shippingFee     (assert ≥ 0)

4  TRANSACTION  ─────────────────────────────────────────────
   · conditional stock decrement per line:
       updateOne({_id, 'stock.onHand': {$gte: qty}}, {$inc: {'stock.onHand': -qty}})
       matchedCount === 0  ──▶ abort entire transaction, 409 OUT_OF_STOCK
   · insert inventoryEvent per line (SALE, negative, actor, orderId)
   · $inc salesCount per product
   · atomic coupon redemption ($inc usedCount with a usage-limit guard)
   · insert couponRedemption (userId, couponId, orderId)
   · reserve the order number (daily counter)
   · INSERT the order with final totals — ONE write, no placeholder pass
   · clear the user's cart
   ─────────────────────────────────────────────────────────

5  POST-COMMIT (outside the transaction, failure-tolerant)
   · audit event · order-received email
```

Steps 2–3 are the enforcement of the rule that **the cart is never the source of price or stock truth** — the cart supplies only `{productId, quantity}`.

### Order number

**Format `NE-YYYYMMDD-NNNN` — PRESERVED.** Counter behaviour **FIXED**.

Legacy used a single global sequence, so `NE-20260503-0006` really meant "the 6th order ever placed" — a date-prefixed format implying a daily reset that never happened, leaking total order volume to anyone holding an order number.

New: a per-day counter (`orderCounters` document keyed by date, `$inc` with upsert inside the transaction). `NE-20260830-0001` is genuinely the first order of that day. Cross-day volume is not inferable.

Enumeration is further mitigated because order lookup requires **order number + matching phone** and is rate-limited — see [`GUEST-CHECKOUT.md`](./GUEST-CHECKOUT.md).

---

## 8. Tracking data model — resolving the Phase 0.5 defect

**The defect:** `update_order_status_v2` wrote `tracking_number`, but **`orders.tracking_number` does not exist**. Any call supplying a tracking number raised `column ... does not exist`, which the function's `EXCEPTION WHEN OTHERS` swallowed into `{success:false}` — rolling back the status change *and* the history row. **Shipping an order with a tracking number was impossible**, and the failure surfaced as a raw Postgres string. Live proof: 8 status-history rows, **none** with tracking.

**The fix** — a first-class `shipment` sub-document:

```jsonc
"shipment": {
  "carrier": "Bosta",                  // required to enter SHIPPED
  "trackingNumber": "BST-123456789",   // required to enter SHIPPED
  "trackingUrl": "https://…",          // optional, derived from carrier
  "shippedAt": ISODate,
  "estimatedDeliveryAt": ISODate,      // optional
  "deliveredAt": ISODate | null,
  "deliveryAttempts": 0,
  "attempts": [
    { "at": ISODate, "outcome": "FAILED",
      "reason": "Customer unreachable", "recordedBy": ObjectId }
  ]
} | null
```

**Rules:**
- `shipment` is `null` until `→ SHIPPED`.
- `carrier` **and** `trackingNumber` are **required** to enter `SHIPPED` (400 otherwise). Legacy treated tracking as an afterthought; here it is a precondition of the state.
- `deliveryAttempts` increments on every `→ DELIVERY_FAILED`; each attempt is appended with its reason.
- `trackingNumber` is visible to the order owner and to admins; it is **never** returned by the public tracking endpoint (see [`GUEST-CHECKOUT.md`](./GUEST-CHECKOUT.md)).
- 🔶 **OPEN (non-blocking):** the carrier list (Bosta / Aramex / Mylerz / in-house) is a business input. Modelled as free text with an optional `trackingUrl` template per carrier, so adding one is configuration.

---

## 9. Status history

**PRESERVED** from legacy — an append-only trail — with three fixes.

```jsonc
"statusHistory": [
  { "from": null, "to": "PLACED",
    "actor": { "id": ObjectId, "role": "CUSTOMER", "name": "…" },
    "note": null, "at": ISODate }
]
```

| Legacy problem | Fix |
|---|---|
| `changed_by` accepted from the caller, unverified → forgeable | **Actor derived from the JWT.** No request field can set it. |
| Only written by the RPC; a direct `UPDATE orders` (permitted to admins by RLS) changed status with **no history row** | Status is only mutable through `OrdersService.transition()`; the history append is in the same transaction |
| Recorded a `field` name because there were three status columns | One axis → `from`/`to` only. Payment changes are recorded as their own entries. |

Embedded, not a separate collection: bounded by workflow length (realistically < 15 entries), always read with the order, never queried independently.

**This is *business* history**, distinct from the security audit log — see [`AUDIT-MODEL.md`](./AUDIT-MODEL.md).

---

## 10. Order document (conceptual)

```jsonc
{
  "_id": ObjectId,
  "orderNumber": "NE-20260830-0001",        // unique
  "status": "CONFIRMED",
  "userId": ObjectId,                        // always present — no guest checkout
  "customer": { "fullName": "…", "email": "…", "phone": "…" },   // snapshot

  "items": [ { "productId": ObjectId, "sku": "…", "name": "…", "slug": "…",
               "unitPrice": 32500, "quantity": 2, "lineTotal": 65000,
               "imagePublicId": "…", "brandName": "Espressif" } ],

  "currency": "EGP",
  "pricing": { "itemsSubtotal": 65000, "discountTotal": 5000,
               "shippingFee": 5000, "grandTotal": 65000,
               "vatInclusive": true, "vatRateBps": 1400 },

  "coupon": { "couponId": ObjectId, "code": "MAKER10",
              "type": "PERCENTAGE", "value": 1000,
              "discountApplied": 5000 } | null,     // snapshot, not a reference

  "payment": { "method": "COD", "status": "PENDING",
               "collectedAt": null,
               "refundedAmount": null, "refundNote": null },

  "shippingAddress": { "fullName": "…", "phone": "…", "street": "…",
                       "city": "…", "governorate": "Cairo", "postalCode": null },

  "shipment": null,
  "statusHistory": [ … ],
  "customerNote": null,
  "adminNote": null,                                 // never exposed to the customer
  "cancellation": { "reason": "…", "by": "CUSTOMER", "at": ISODate } | null,
  "idempotencyKey": "…",                             // unique, sparse

  "placedAt": ISODate, "updatedAt": ISODate
}
```

Everything is embedded because **an order is a point-in-time contract**. See [`MONGODB-DESIGN.md`](./MONGODB-DESIGN.md).

---

## 11. Inventory effects — summary

| Transition | Stock | Ledger event | `salesCount` |
|---|---|---|---|
| `→ PLACED` | **−qty** | `SALE` (negative) | +qty |
| `→ CANCELLED` | **+qty** | `CANCELLATION` (positive) | −qty |
| `→ RETURNED` | **+qty** | `RETURN` (positive) | −qty |
| `CONFIRMED`, `SHIPPED`, `DELIVERED`, `DELIVERY_FAILED` | unchanged | none | unchanged |

**Stock is committed at placement, not at confirmation.** Under COD the order is a real commitment the moment it is placed; holding stock uncommitted would oversell. This is also what legacy did (`create_order_v2` decremented immediately) — **PRESERVED**, and now with the restoration path that legacy entirely lacked (F-HIGH-2: *cancellation never restored stock*).

Restoration is **idempotent per order**: an `inventoryEvents` unique index on `{orderId, productId, type}` makes a double restore impossible.

---

## 12. Notifications

| Event | Recipient | Content |
|---|---|---|
| `→ PLACED` | Customer | Order received, number, items, total, COD amount due |
| `→ CONFIRMED` | Customer | Confirmed, expected dispatch |
| `→ SHIPPED` | Customer | Carrier + tracking number |
| `→ DELIVERY_FAILED` | Customer | Attempt failed, next step |
| `→ DELIVERED` | Customer | Receipt |
| `→ CANCELLED` / `→ RETURNED` | Customer | Confirmation + refund note if applicable |
| `→ PLACED` | Admin | New order alert |

Notifications are dispatched **after** the transaction commits and are **failure-tolerant**: an email provider outage must never roll back a delivered order. Delivery attempts are logged. See [`NESTJS-MODULE-MAP.md`](./NESTJS-MODULE-MAP.md).

---

## 13. Access rules

| Operation | Guest | Customer (owner) | Customer (other) | Admin | Super Admin |
|---|---|---|---|---|---|
| Place order | ❌ | ✅ | — | ❌ | ❌ |
| View own order | ❌ | ✅ | ❌ **404** | ✅ | ✅ |
| List own orders | ❌ | ✅ | — | — | — |
| Cancel (`PLACED`/`CONFIRMED`) | ❌ | ✅ | ❌ | ✅ | ✅ |
| Confirm / ship / deliver / return | ❌ | ❌ | ❌ | ✅ | ✅ |
| Mark refunded | ❌ | ❌ | ❌ | ✅ | ✅ |
| View any order | ❌ | ❌ | ❌ | ✅ | ✅ |
| Track by number + phone | ✅ (rate-limited, minimal projection) | ✅ | ✅ | ✅ | ✅ |
| Delete an order | ❌ | ❌ | ❌ | ❌ | ❌ **Nobody** |

**Cross-customer access returns `404`, not `403`** — a `403` confirms the order exists.

**Orders are never deleted.** They are financial records. Legacy had no DELETE policy on `orders`, which was correct; here it is deliberate.

---

## 14. Summary of decisions

| # | Decision | Fixes |
|---|---|---|
| 1 | **One `status` axis + separate `payment.status`**; `fulfillment_status` deleted | 210 unvalidated combinations; live incoherent data |
| 2 | **COD-native vocabulary**; `pending_payment` removed | The mismatch that made the reservation cron a permanent no-op |
| 3 | **Server-owned transition matrix**, enforced in a guarded atomic update | F-HIGH-1 (no validation) + M8 (TOCTOU) |
| 4 | **`DELIVERED` ⇒ `PAID`** atomically | Impossible incoherent delivery state |
| 5 | **`DELIVERY_FAILED`** with retry / return | The most common COD exception was unrepresentable |
| 6 | **Customer self-cancellation** while pre-dispatch | Capability legacy lacked entirely |
| 7 | **Stock restored** on cancel/return, idempotently | F-HIGH-2 — permanent silent stock loss |
| 8 | **`shipment` sub-document**; carrier + tracking required to ship | F-CRIT-4 — shipping with tracking was impossible |
| 9 | **Actor from the JWT** in history | F-MED-5 — forgeable audit trail |
| 10 | **Order number resets daily** | Global counter leaked total order volume |
| 11 | **Idempotency key** on placement | Double-submit created duplicate orders |
| 12 | **Coupon snapshot**, not a reference | Editing a coupon would rewrite order history |
| 13 | **Refund workflow removed**; outcome recorded | Modelled a payment provider that does not exist |
| 14 | **Orders are immutable and undeletable** | Financial record integrity |
