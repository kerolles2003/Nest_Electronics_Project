# Inventory Model — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADRs:** ADR-INVENTORY-001 … 004

---

## 1. Decision summary

> **Model A — available stock only. No reservations.**
> **Current value + immutable event ledger.**
> **Every mutation carries a reason and an actor, and is written in the same transaction as the stock change.**

---

## 2. Reservations: REMOVED

### The legacy model

`available_stock = stock_quantity − reserved_quantity`, with a 30-minute reservation window released by a `pg_cron` job.

### The evidence (Phase 0.5)

| Fact | Value |
|---|---|
| `pg_cron` job `release-expired-reservations` | Active, every 5 minutes |
| Successful executions | **35,309** |
| Rows it has ever affected | **0** |
| Products with `reserved_quantity ≠ 0` | **0 of 85** |
| `inventory_transactions` of type `reservation` / `reservation_release` | **0** |
| Orders that have ever had `order_status = 'pending_payment'` | **0** |

### Why it was structurally dead

The cron job selects orders where `order_status = 'pending_payment'`. Both `create_order_v2` and `create_order_v1` hard-code `'processing'`. **No order could ever reach the state the job was looking for.** Meanwhile no code path ever *incremented* `reserved_quantity` — both order functions decremented `stock_quantity` directly.

So the reservation subsystem had: a column nothing wrote, a ledger event type nothing emitted, and a scheduled job that could never match a row. It ran ~35,000 times to do nothing.

### Why removal is correct, not merely convenient

A reservation exists to hold stock during a **payment gap** — the interval between "customer commits" and "money confirmed", when an order might still fail. That gap is real for card payments and payment redirects.

**Cash on Delivery has no payment gap.** The customer commits at checkout; cash is collected days later at the door. There is nothing to wait for, so there is nothing to reserve. Committing stock immediately at placement is not a shortcut — it is the *correct* model for COD, and it is also what the legacy functions actually did.

The reservation design was inherited wholesale from the prepaid flow in `plan_business_logic.md` §1 (`pending_payment → paid → processing`), a flow the MVP explicitly does not implement (COD only). It was never adapted.

### Consequences

- `products.stock.reserved` does not exist. `available = stock.onHand`.
- The `chk_available_stock` CHECK (`stock_quantity >= reserved_quantity`) becomes meaningless and is dropped.
- No scheduled job in MVP. One fewer moving part, one fewer failure mode.
- The five-way duplication of `available = onHand − reserved` (Phase 0 B1) collapses to a single field read.
- Ledger event types `RESERVATION` / `RESERVATION_RELEASE` are not carried forward.

### Revisit condition (ADR-INVENTORY-001)

Reintroduce reservations **only** when a real payment gap appears:

1. **Paymob or any online payment** is integrated (roadmap: post-MVP). A card flow with a redirect creates a genuine window where stock must be held.
2. A "reserve for pickup" or quotation feature is introduced.

The migration path is additive: add `stock.reserved`, add `RESERVATION`/`RELEASE` events, redefine `available = onHand − reserved`, and add an expiry job — **and, critically, add the `AWAITING_PAYMENT` order status that makes the expiry job's query reachable.** That last step is the one legacy omitted, and it is why the whole subsystem was inert.

---

## 3. Stock representation

```jsonc
// inside the products document
"stock": {
  "onHand": 149,              // int32, >= 0, the authoritative quantity
  "lowStockThreshold": 10     // int32, >= 0, alerting/reporting only
}
```

| Decision | Reasoning |
|---|---|
| **Stock lives inside the product document** | Availability is read on *every* product card, listing and PDP. A separate collection would force a `$lookup` on the highest-traffic query in the system. Single-document updates are atomic in MongoDB without a transaction. |
| **But it is written only by `InventoryModule`** | The one deliberate exception to strict aggregate ownership (ADR-INVENTORY-002). The product update DTO **rejects** `stock`, so a generic admin product edit cannot change it — closing legacy defect M7, where any direct `UPDATE products SET stock_quantity` bypassed the ledger entirely. |
| **`onHand` may never be negative** | Enforced by conditional update, not by a post-hoc check |
| **`lowStockThreshold` is per product** | Live: populated on 85/85 products — a genuinely used field. **PRESERVED.** |

**Availability semantics**

```
available   = stock.onHand
inStock     = stock.onHand > 0
lowStock    = 0 < stock.onHand <= stock.lowStockThreshold
outOfStock  = stock.onHand === 0
```

Computed in **one** place (`InventoryService` / a shared derived-field helper) and returned by the API. The client never recomputes it — closing the five-way duplication (B1).

---

## 4. The inventory ledger

> **DECISION: current value **plus** immutable history. Both are required.**

### Why history is not optional

| Reason | Detail |
|---|---|
| **Money is involved** | Stock is inventory value. "Why is this product at 7 units?" must be answerable. |
| **Legacy proved the failure mode** | 4 of 85 products had any ledger rows, none reconciled, and no opening balances existed — so the ledger was decorative. Phase 0.5 could not explain a single stock number. |
| **Multiple mutation sources** | Orders (sale), cancellations, returns, admin corrections, restocking. Without a ledger, these are indistinguishable. |
| **Cost is trivial** | Append-only, ~1 document per line item per event. Live volume: 7 events total. |
| **Debugging** | Overselling or a stock discrepancy is otherwise unattributable. |

**Legacy already had this concept and got it partly right** (7 `sale` events with correct references). It failed on completeness, not on design. **PRESERVE the concept, FIX the completeness.**

### `inventoryEvents` document

```jsonc
{
  "_id": ObjectId,
  "productId": ObjectId,
  "sku": "ESP32-DEVKIT-V1",          // snapshot, so the ledger reads standalone
  "type": "SALE",
  "quantityDelta": -2,                // SIGNED. negative = stock leaves
  "balanceBefore": 151,               // NEW — legacy had neither
  "balanceAfter": 149,
  "reason": "Order NE-20260830-0001",
  "reference": { "type": "ORDER", "id": ObjectId } | null,
  "actor": { "id": ObjectId, "role": "CUSTOMER", "name": "…" } | null,
  "createdAt": ISODate
}
```

`balanceBefore` / `balanceAfter` are **new**. They make the ledger self-verifying: any entry can be checked without replaying the whole history, and a gap between one event's `balanceAfter` and the next event's `balanceBefore` proves an out-of-band mutation occurred.

### Event types

| Type | Sign | Trigger | Actor |
|---|---|---|---|
| `OPENING_BALANCE` | + | Product creation / initial seed | Admin |
| `SALE` | − | Order placed | Customer (via the order) |
| `CANCELLATION` | + | Order cancelled pre-dispatch | Customer or Admin |
| `RETURN` | + | Order returned | Admin |
| `RESTOCK` | + | Purchase received from supplier | Admin |
| `ADJUSTMENT` | ± | Manual correction (recount, discrepancy) | Admin |
| `DAMAGE` | − | Written off | Admin |

Legacy had `purchase`, `sale`, `return`, `adjustment`, `reservation`, `reservation_release`, `damaged`. The two reservation types are dropped; `purchase → RESTOCK`; `OPENING_BALANCE` and `CANCELLATION` are added.

**`OPENING_BALANCE` is what makes the ledger complete.** Legacy seeded stock by direct INSERT with no ledger row, so `Σ(ledger) ≠ onHand` for every product and reconciliation was impossible. Every product now begins with an explicit opening event.

### The core invariant

```
For every product:   Σ inventoryEvents.quantityDelta  ==  product.stock.onHand
```

Assertable at any time, in CI and in a periodic reconciliation report. It is the single check that proves inventory is trustworthy. It was **unachievable** in the legacy system.

---

## 5. Operation specifications

### 5.1 Order placement — stock decrease

```
Precondition   status transition (none) → PLACED
Actor          Customer (own order)
Validation     quantity integer, 1 ≤ q ≤ 99          [fixes F-CRIT-3]
               product isActive && !deletedAt         [fixes F-HIGH-3]
               stock.onHand >= quantity
```

```js
// Inside the order transaction, per line:
updateOne(
  { _id: productId, 'stock.onHand': { $gte: quantity },
    isActive: true, deletedAt: null },
  { $inc: { 'stock.onHand': -quantity, salesCount: quantity } }
)
// matchedCount === 0  ->  abort the ENTIRE transaction, 409 OUT_OF_STOCK
```

The `$gte` predicate in the filter is the **overselling guard**. It is a direct port of the legacy `WHERE stock_quantity >= quantity` pattern — the one concurrency primitive legacy got right — and is **PRESERVED**.

**All-or-nothing:** if any line fails, the whole order aborts and no stock moves. **PRESERVED** from legacy plpgsql atomicity, which was correct.

A ledger event is written **in the same transaction**, with `actor` populated — fixing F-MED-2, where `created_by` was NULL on every sale and the ledger could not attribute a sale to anyone.

### 5.2 Cancellation / return — stock increase

```
Trigger   → CANCELLED  or  → RETURNED
Actor     Customer (own, pre-dispatch) or Admin
```

```js
updateOne({ _id: productId }, { $inc: { 'stock.onHand': +quantity,
                                        salesCount: -quantity } })
// + inventoryEvent { type: CANCELLATION | RETURN, quantityDelta: +qty }
```

**This capability did not exist in legacy.** `update_order_status_v2` touched no stock table whatsoever, so every cancelled order permanently destroyed its stock with no record (F-HIGH-2).

**Idempotency:** a unique index on `inventoryEvents { reference.id, productId, type }` makes a double restore impossible — a retried or duplicated cancellation fails the unique constraint rather than inflating stock.

### 5.3 Manual adjustment

```
POST /api/v1/admin/inventory/:productId/adjust
{ "delta": -3, "reason": "Damaged in storage", "type": "DAMAGE" }
```

| Rule | Specification |
|---|---|
| `delta` | Non-zero signed integer. **A signed delta, not an absolute value** — PRESERVED from `adjust_stock_v2`, whose semantics were correct. |
| `reason` | Required, ≥ 3 characters — PRESERVED from the legacy Zod rule (which the database never enforced) |
| Floor | Resulting `onHand` must be ≥ 0, enforced by a conditional update |
| Actor | From the JWT — **never** a request parameter (fixes the legacy `p_admin_id` forgery vector) |
| Authorization | `@Roles('ADMIN','SUPER_ADMIN')` — legacy granted `EXECUTE` to `anon` (F-CRIT-1) |
| Ledger | Always, in the same transaction |

`delta = 0` is rejected (legacy F-MED-9 permitted a meaningless ledger row).

> Live evidence: **zero `adjustment` events exist**, so `adjust_stock_v2` never once completed successfully in production. The semantics are preserved because they were well designed; the execution path is rebuilt because it never worked.

### 5.4 Restock

Same mechanism as adjustment with `type: RESTOCK` and a positive delta, optionally referencing a supplier purchase. Modelled as a distinct type because "we received 100 units" and "the count was wrong" are different business events that should be distinguishable in reporting.

### 5.5 Failure cases

| Case | Behaviour |
|---|---|
| `quantity <= 0` at checkout | **400** `VALIDATION_ERROR`. Legacy accepted negatives, which *increased* stock and produced a negative line total (F-CRIT-3). |
| `quantity` non-integer | 400 |
| `quantity > 99` | 400 |
| Insufficient stock | **409** `OUT_OF_STOCK` with the offending SKU and available quantity; entire order aborted |
| Product inactive / deleted | **409** `PRODUCT_UNAVAILABLE`. Legacy checked neither flag. |
| Adjustment would go below 0 | **422** `INSUFFICIENT_STOCK` |
| Concurrent decrement | Loser gets 409; no oversell |
| Stock changed by a generic product update | **Impossible** — `stock` is rejected by the product DTO |

---

## 6. Concurrency & overselling

**Guarantee: the system cannot oversell.**

```
Two customers, one unit in stock, simultaneous checkout:

  A: updateOne({_id, 'stock.onHand': {$gte:1}}, {$inc:{'stock.onHand':-1}})
     → matched, onHand 1 → 0
  B: updateOne({_id, 'stock.onHand': {$gte:1}}, {$inc:{'stock.onHand':-1}})
     → matchedCount 0 → abort transaction → 409 OUT_OF_STOCK

  Final: onHand = 0, exactly one order created.
```

This works because a single-document update in MongoDB is atomic and the predicate is evaluated as part of the update. It requires no application-level lock and no read-then-write.

**Why not `findOneAndUpdate` with a read first?** That is precisely the legacy TOCTOU pattern — validate in the app, then mutate in a second round trip. The condition must live *inside* the write.

**Transaction requirement:** because a single order touches multiple products plus `inventoryEvents` plus `orders`, a multi-document transaction is required — which mandates a **replica set**. See [`CONSISTENCY-MODEL.md`](./CONSISTENCY-MODEL.md).

---

## 7. Reporting

| Report | Query | Replaces |
|---|---|---|
| Low stock | `{ $expr: { $lte: ['$stock.onHand', '$stock.lowStockThreshold'] }, isActive: true }` | Legacy loaded **all** products and filtered in JS (Phase 0 P3) |
| Out of stock | `{ 'stock.onHand': 0, isActive: true, deletedAt: null }` | — |
| Movement history | `inventoryEvents` by `productId`, sorted `createdAt` desc | Legacy inventory drawer |
| Reconciliation | Per product: `Σ quantityDelta` vs `stock.onHand` — must be 0 | **New.** Impossible in legacy. |
| Stock value | `Σ (onHand × costPrice)` — admin only | New; `costPrice` populated on only 2/85 products today |

**Low-stock alerting** is a Notifications concern, triggered when a `SALE` event crosses the threshold. Not a scheduled scan.

---

## 8. What Inventory does *not* do

| Excluded | Reason |
|---|---|
| Reservations | §2 |
| Multi-warehouse / locations | Single fulfilment point; no requirement |
| Batch / lot / serial tracking | Not needed for commodity components |
| Stock transfers | No second location |
| Backorders / pre-orders | Not a requirement; `onHand` ≥ 0 is a hard floor |
| Supplier / purchase orders | Out of scope; `RESTOCK` records the outcome, not the procurement workflow |
| Automatic reordering | No requirement |
| Variant-level stock | Variants removed ([`CATALOG-MODEL.md`](./CATALOG-MODEL.md) §1) |

Each is a plausible e-commerce feature and each is **deliberately excluded** as unjustified by this application.

---

## 9. Initial data — seed, not migration

**There is no legacy data migration** (Architecture Freeze Ratification, C1). The system starts with a fresh database; this is purely a **seed**.

1. Set each product's `stock.onHand` to its intended starting quantity.
2. Write one `OPENING_BALANCE` event per product with `balanceBefore: 0`, `balanceAfter: onHand`, actor = the seeding admin.
3. Assert the invariant `Σ events == onHand` for all products. This assertion is part of the seed script and must pass.

The 7 legacy `sale` events are **not** migrated — their orders are development data being discarded.

---

## 10. Summary of decisions

| # | Decision | Fixes / removes |
|---|---|---|
| 1 | **Model A — no reservations** | Removes a subsystem with 35,309 no-op runs and a permanently unreachable query |
| 2 | `available = stock.onHand` | Collapses a 5-way duplicated formula |
| 3 | **Current value + immutable ledger** | Ledger was decorative in legacy |
| 4 | `OPENING_BALANCE` per product | Makes `Σ events == onHand` assertable for the first time |
| 5 | `balanceBefore`/`balanceAfter` on every event | Self-verifying ledger; detects out-of-band mutation |
| 6 | Stock **inside** the product, **written only** by Inventory | Fixes M7 — generic updates bypassing the ledger |
| 7 | Conditional `$gte` decrement | Preserves the one concurrency primitive legacy got right |
| 8 | **Stock restored** on cancel/return | Fixes F-HIGH-2 — permanent silent stock loss |
| 9 | Restoration **idempotent** via unique index | Prevents double-restore inflation |
| 10 | Actor from the JWT on every event | Fixes F-MED-2 (NULL actor) and the `p_admin_id` forgery vector |
| 11 | Ledger write in the **same transaction** as the stock change | Fixes I4 — no trigger enforced this |
| 12 | `delta = 0` rejected | Fixes F-MED-9 |
