# Transaction & Consistency Model — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADR:** ADR-CONSISTENCY-001, 002

---

## 1. Deployment requirement

> ### **MongoDB must run as a REPLICA SET. This is a hard infrastructure requirement, not a preference.**

MongoDB multi-document transactions require a replica set (or a sharded cluster). A standalone `mongod` **cannot** start a session with a transaction — the driver throws `IllegalOperation: Transaction numbers are only allowed on a replica set member or mongos`.

Order placement mutates **three** collections atomically (`orders`, `products`, `inventoryEvents`), plus coupon collections when a coupon is applied. There is no correct single-document alternative.

> **Amended by [`ENVIRONMENT-RATIFICATION.md`](./ENVIRONMENT-RATIFICATION.md) (Phase 2.5.1), which is the authority for the environment model, the CI harness and the gate classification. The *requirement* below — a transaction-capable replica set — is unchanged; the tooling and the staging row are.**

| Environment | Requirement | Provisioning |
|---|---|---|
| **Production** | Replica set — Atlas **M10 or higher** (M0/M2/M5 shared tiers do not support transactions reliably), or a self-hosted 3-node set | **Not provisioned.** Separate Atlas environment, clean database. Verified by the gate at provisioning. See ENVIRONMENT-RATIFICATION §2.5, O-1 |
| **Staging** | Must mirror production — a replica set | **NOT CURRENTLY PROVISIONED.** Binding if and when staging exists; not a present obligation |
| **Development** | Replica set | **MongoDB Atlas development environment.** Tier is not assumed transaction-capable — the gate asks the server |
| **Local development** | Single-node replica set (`mongod --replSet rs0` + `rs.initiate()`) | `docker-compose.dev.yml` |
| **CI** | Replica set, ephemeral, credential-free | **Docker Compose** (`docker-compose.dev.yml`). `mongodb-memory-server` is **not** used — ENVIRONMENT-RATIFICATION §3 |

**Phase 2 gate — reclassified by ENVIRONMENT-RATIFICATION §4.** The transaction *implementation* must be proven once, by executed rollback and commit evidence against a real replica set. Each *environment* must then pass that same gate before it is considered ready — a **provisioning obligation**, discharged when the environment is built, not a permanent block from an environment that does not exist. No environment may be marked verified without executed database-state evidence. Discovering at Phase 6 (commerce core) that transactions do not work would be extremely expensive — this is why it is stated now.

Legacy relied on PostgreSQL, where a `plpgsql` function is implicitly atomic and this was free. That property must be deliberately reconstructed, not assumed.

---

## 2. Operations requiring a transaction

| # | Operation | Transaction? | Collections |
|---|---|---|---|
| 1 | **Order placement** | ✅ **Required** | `orders`, `products`, `inventoryEvents`, `coupons`, `couponRedemptions`, `carts`, `orderCounters` |
| 2 | **Order cancellation / return** | ✅ **Required** | `orders`, `products`, `inventoryEvents`, `coupons`, `couponRedemptions` |
| 3 | **Manual stock adjustment** | ✅ **Required** | `products`, `inventoryEvents` |
| 4 | Order status transition (no stock effect) | ❌ Not required | `orders` only — single document |
| 5 | User registration | ❌ Not required | `users` only |
| 6 | Cart mutation | ❌ Not required | `carts` only |
| 7 | Product CRUD | ❌ Not required | `products` only |
| 8 | Review moderation + rating aggregate | ⚠️ **Recommended** | `reviews`, `products` |
| 9 | Category rename + snapshot refresh | ❌ Not required | Eventually consistent (§6) |
| 10 | Media upload + document write | ❌ Not required | Compensating action (§6) |

---

## 3. Operation specifications

### 3.1 Order placement — the critical path

| | |
|---|---|
| **Why atomic** | Stock is decremented, a financial record is created, a ledger entry is written and a coupon is consumed. Any partial application corrupts inventory or creates an unpaid-for stock movement. |
| **Collections** | `products` (N), `inventoryEvents` (N), `orders` (1), `orderCounters` (1), `carts` (1), `coupons` (0–1), `couponRedemptions` (0–1) |
| **Isolation** | `snapshot` read concern, `majority` write concern |
| **Rollback** | Any failure aborts everything. Stock, counters and coupon usage all revert. **No order exists.** |
| **Idempotency** | `Idempotency-Key` header, unique index on `orders.idempotencyKey` |
| **Concurrency risks** | Oversell · double redemption · duplicate order number · double submit |

```
withTransaction:
  1. reserve order number:  orderCounters.findOneAndUpdate(
                              {date}, {$inc:{seq:1}}, {upsert, returnNew})
  2. per line: products.updateOne(
       { _id, isActive:true, deletedAt:null, 'stock.onHand': {$gte: qty} },
       { $inc: { 'stock.onHand': -qty, salesCount: +qty } })
     matchedCount === 0  ->  throw  ->  ABORT ALL
  3. inventoryEvents.insertMany(SALE events, with actor)
  4. coupon: coupons.updateOne(
       { _id, isActive:true,
         $or:[{usageLimit:null},{$expr:{$lt:['$usedCount','$usageLimit']}}] },
       { $inc:{ usedCount: 1 } })
     matchedCount === 0  ->  throw  ->  ABORT ALL
  5. couponRedemptions.insertOne(...)      // unique {couponId, orderId}
  6. orders.insertOne(final totals, ONE write)
  7. carts.deleteOne({ userId })
commit
```

**The concurrency guarantees live in the update *filters*, not in application logic.** Steps 2 and 4 embed their preconditions in the query predicate, so two concurrent requests cannot both pass. This is the direct port of the legacy `WHERE stock_quantity >= quantity` pattern — the one concurrency primitive the old system got right — and it is what makes overselling impossible.

**Deliberately outside the transaction** (post-commit, failure-tolerant): audit event, order-confirmation email, analytics. An email provider outage must never roll back a paid order.

### 3.2 Order cancellation / return

| | |
|---|---|
| **Why atomic** | Status change, stock restoration, ledger entry and coupon release must all happen or none |
| **Rollback** | Full |
| **Idempotency** | **Two layers.** (a) the guarded status update `{_id, status: <expectedFrom>}` — `matchedCount === 0` means someone already transitioned it; (b) unique index `inventoryEvents {reference.id, productId, type}` makes a double restore structurally impossible |
| **Concurrency risk** | Two admins cancelling simultaneously → one wins, the other gets `409` |

> **This entire operation is new.** Legacy's `update_order_status_v2` touched no stock table at all, so every cancelled order permanently destroyed its stock with no record (F-HIGH-2).

### 3.3 Manual stock adjustment

Transaction over `products` + `inventoryEvents`. The floor is enforced in the filter (`{'stock.onHand': {$gte: -delta}}` for negative deltas), not by a read-then-check. Actor comes from the JWT.

### 3.4 Review moderation → rating aggregate

⚠️ **Recommended, not required.** Approving a review updates `reviews` and recomputes `products.rating`. If the second write fails, the aggregate is briefly stale — a display inaccuracy, not data corruption.

Mitigation: use a transaction when convenient, and provide an idempotent `recomputeRating(productId)` that can be re-run at any time. A periodic reconciliation job can repair drift. **Correctness does not depend on the transaction**, which is why it is recommended rather than mandatory.

---

## 4. Idempotency

| Operation | Mechanism | Window |
|---|---|---|
| Order placement | `Idempotency-Key` header + unique index on `orders.idempotencyKey`; a replay returns the **original order** with `200` | 24 h TTL |
| Stock restoration | Unique index `inventoryEvents {reference.id, productId, type}` | Permanent |
| Coupon redemption | Unique index `couponRedemptions {couponId, orderId}` | Permanent |
| Status transition | Guarded update on the expected `from` status | Inherent |
| Cart mutations | Naturally idempotent (set quantity, not increment) | — |
| Cart merge | `max()` strategy is idempotent by construction | — |
| Email verification / password reset | Single-use tokens | Token TTL |

**`Idempotency-Key` is mandatory on `POST /orders`.** A request without it is rejected with `400`. Legacy had no idempotency anywhere: a double-click created two orders and decremented stock twice.

---

## 5. Concurrency risk register

| # | Risk | Mitigation | Legacy status |
|---|---|---|---|
| 1 | **Overselling** — two orders, one unit | Conditional `$gte` update inside the transaction | ✅ Legacy handled this correctly |
| 2 | **Double order submission** | Idempotency key + unique index | ❌ Unprotected |
| 3 | **Coupon over-redemption** | Usage limit in the update filter | ❌ No redemption existed at all |
| 4 | **Duplicate order number** | Atomic `$inc` on `orderCounters` + unique index | ✅ Sequence was atomic |
| 5 | **Concurrent status transition (TOCTOU)** | Guarded update on the expected `from` state | ❌ Read-then-write across two round trips |
| 6 | **Double stock restore** | Unique ledger index | ❌ No restore existed |
| 7 | **Lost update on profile/product** | Last-write-wins (acceptable) or optimistic `version` on products | ❌ Same |
| 8 | **Stock changed via generic product update** | `stock` rejected by the product DTO | ❌ Any UPDATE could change stock, bypassing the ledger |
| 9 | **Cart mutation during checkout** | Order derives items from the cart **inside** the transaction | ❌ Client supplied the item list |

**Risk 5 in detail.** Legacy's `update_order_status_v2` *did* take a `FOR UPDATE` row lock — but the transition matrix was evaluated in the admin application, in a **previous round trip**, outside that lock. Two admins could both read `processing`, both pass the matrix check, and both issue a transition. The fix is to move the precondition into the write:

```js
orders.updateOne({ _id, status: 'CONFIRMED' }, { $set: { status: 'SHIPPED' }, … })
// matchedCount === 0  ->  409 CONFLICT: order is no longer in the expected state
```

---

## 6. Where eventual consistency is accepted

Deliberate, bounded, and non-corrupting.

| # | Case | Window | Why acceptable | Repair |
|---|---|---|---|---|
| 1 | **Category/brand name snapshot on products** | Until `updateMany` completes | Display label only — never money, stock or identity | The `updateMany` is the repair |
| 2 | **`product.rating` aggregate** | Until recompute | Display only | Idempotent `recomputeRating()` + periodic job |
| 3 | **`product.salesCount`** | Adjusted post-transaction on cancel/return | Sorting hint only | Reconciliation from `orders` |
| 4 | **`user.stats`** | Updated after order commit | Reporting only | Recomputable from `orders` |
| 5 | **`category.productCount`** | Recomputed on product write | Display badge | Periodic recompute |
| 6 | **Media upload vs document write** | Seconds | An orphaned Cloudinary asset costs storage, not correctness | Orphan reconciliation report ([`MEDIA-MODEL.md`](./MEDIA-MODEL.md) §9.3) |
| 7 | **Email dispatch** | Async, retried | Delivery must never block or roll back an order | Delivery log + retry |
| 8 | **Audit log write** | Post-commit | Must not roll back the business operation… | …but failure is **logged loudly** — the legacy defect was silent swallowing, producing 0 audit rows |

**Rule:** eventual consistency is acceptable for **derived display data**. It is never acceptable for money, stock, order state, or authorization.

---

## 7. Read & write concerns

| Setting | Value | Reason |
|---|---|---|
| Write concern (default) | `{ w: 'majority', j: true }` | Durability for commercial data |
| Read concern (transactions) | `snapshot` | Consistent view across the transaction |
| Read concern (normal reads) | `local` | Catalogue reads tolerate marginal staleness |
| Read preference | `primary` | Single-region; avoids replica-lag surprises. Revisit only if read scaling is needed. |
| Transaction timeout | 15 s | Fail fast; order placement should take well under 1 s |
| Retryable writes | Enabled | Driver-level transient-error handling |

**Transactions must be short.** No external HTTP call (Cloudinary, email) may occur inside one. Every such call happens before (upload) or after (notification) the transaction.

---

## 8. Failure handling

| Failure | Behaviour |
|---|---|
| `TransientTransactionError` | Driver retries via `withTransaction` (bounded) |
| `UnknownTransactionCommitResult` | Commit retried; idempotency key prevents duplication |
| Business rule violation (out of stock, coupon expired) | Abort → typed domain error → `409`/`422`. **Not** a 500. |
| Write conflict | Retry, then `409` |
| Transaction timeout | Abort → `503`, logged with the request id |
| Post-commit side effect fails (email, audit) | Order stands; failure logged at `error`; audit failures alert |

**Business rejections and infrastructure faults are distinct.** Legacy's `EXCEPTION WHEN OTHERS` collapsed both into `{success:false, error:<SQLERRM>}`, so a missing column and "insufficient stock" were indistinguishable — which is exactly how the tracking-number defect stayed hidden.

---

## 9. Testing requirements

| Test | Assertion |
|---|---|
| Transaction rollback | Force a failure on the last line item → **no** order, **no** stock change, **no** ledger entry |
| No oversell | 20 concurrent orders for 1 unit → exactly 1 succeeds, `onHand` = 0 |
| Idempotent placement | Same key twice → one order, one stock decrement |
| Idempotent restore | Cancel twice → stock restored once |
| Coupon race | 2 concurrent orders, `usageLimit: 1` → one succeeds |
| Status race | 2 concurrent transitions → one succeeds, one `409` |
| Ledger invariant | After any sequence: `Σ inventoryEvents.quantityDelta == stock.onHand` |
| Order-number uniqueness | 100 concurrent orders → 100 distinct numbers |

These are **P0** in `baseline-test-cases.md` and gate Phase 6.

---

## 10. Summary

| Aspect | Decision |
|---|---|
| **Replica set** | **Mandatory** — Atlas M10+ or a 3-node self-hosted set. Verified in Phase 2, in every environment. |
| Transactions required | Order placement · cancellation/return · stock adjustment |
| Transactions recommended | Review moderation + rating |
| Concurrency primitive | **Preconditions inside update filters**, never read-then-write |
| Idempotency | Header key on orders; unique indexes on ledger and coupon redemption |
| Write concern | `majority` + journal |
| Eventual consistency | Accepted **only** for derived display data |
| External calls in transactions | **Forbidden** |
| Business vs infrastructure errors | Strictly distinguished |
