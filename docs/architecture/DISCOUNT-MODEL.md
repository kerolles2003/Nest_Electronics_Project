# Discounts & Coupons — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADRs:** ADR-DISCOUNT-001 … 003

---

## 1. Decision

> ### **REDESIGN — build the missing half.**

| Classification | Rationale |
|---|---|
| Not **PRESERVE** | There is no working implementation to preserve. |
| Not **REMOVE** | Coupons are an explicit roadmap item: *"Coupon System — Schema exists, UI not built"* (`PROJECT_OVERVIEW.md`), and a validation algorithm is already specified in `plan_business_logic.md` §7. |
| **REDESIGN** | The admin half exists; the customer half — validation, application, redemption — does not exist at any layer. |

### Legacy state

| Finding | Evidence |
|---|---|
| Full admin CRUD for coupons | `coupon.actions.ts` |
| **Zero customer-facing redemption code** | `grep "coupon"` in the storefront = **0 hits** (Phase 0 §3.2) |
| `orders.coupon_id` never populated | **0 of 10** live orders |
| `orders.discount` always `0` | All 10 orders |
| No public read policy on `coupons` | Phase 0.5 — a customer could not even read one |
| `create_order_v2` has **no discount term** | `total = subtotal + shipping_fee` |
| **Two contradictory Zod schemas** | `schemas.ts:80` (`value.positive()`, `code.min(3)`) vs `coupon.actions.ts:10` (`value.min(0)`, `code.min(1)`) |
| Coupons in the database | **0** |

An admin could create a coupon that no customer could ever use. Zero live coupons means zero migration constraints — the redesign is unconstrained.

---

## 2. Discount types in the system

Two distinct mechanisms, deliberately kept separate:

| # | Mechanism | Where it lives | Applies to |
|---|---|---|---|
| 1 | **Product-level sale price** | `product.pricing.salePrice` | A single product; already inside `itemsSubtotal` |
| 2 | **Coupon** | `coupons` collection, applied at checkout | The whole order subtotal |

**They compose, they do not conflict.** A product already on sale contributes its discounted price to the subtotal, and a coupon then applies to that subtotal. A customer with a 10% coupon on a sale item gets both — this is intended and standard.

**Not built:** category-wide promotions, buy-X-get-Y, tiered/volume pricing, free-shipping coupons, automatic cart-level promotions. None appears in any requirement document. Each would be additive later.

---

## 3. Coupon model

```jsonc
{
  "_id": ObjectId,
  "code": "MAKER10",              // unique, UPPERCASE-normalised
  "description": "10% off for makers",

  "type": "PERCENTAGE",           // PERCENTAGE | FIXED
  "value": 1000,                  // PERCENTAGE -> basis points (1000 = 10.00%)
                                  // FIXED      -> EGP minor units
  "currency": "EGP",              // FIXED only

  "minOrderAmount":   50000,      // minor units, nullable
  "maxDiscountAmount": 10000,     // minor units, nullable — PERCENTAGE cap

  "usageLimit":   100,            // total redemptions, nullable = unlimited
  "usedCount":    0,              // maintained atomically
  "perUserLimit": 1,              // nullable = unlimited

  "startsAt":  ISODate | null,
  "expiresAt": ISODate | null,
  "isActive":  true,

  "createdBy": ObjectId,
  "createdAt": ISODate,
  "updatedAt": ISODate
}
```

### Key modelling decisions

| Decision | Reason |
|---|---|
| **`value` is discriminated by `type`** | Legacy used one `numeric` column meaning "15" for both 15% and 15.00 EGP. Basis points for percentages, minor units for fixed — no ambiguity. See [`MONEY-MODEL.md`](./MONEY-MODEL.md) §7.3. |
| **`perUserLimit` is new** | Legacy had only a global `usage_limit`. Without a per-user limit, one customer can consume the entire allocation. |
| **`code` is normalised to uppercase** on write and lookup | `maker10` and `MAKER10` must be the same coupon |
| **ONE schema** | Replaces the two contradictory legacy definitions |
| **`couponRedemptions` is a separate collection** | Required to enforce `perUserLimit` and to audit who redeemed what. Unbounded, so it cannot be embedded. |

```jsonc
// couponRedemptions
{ "_id": ObjectId, "couponId": ObjectId, "code": "MAKER10",
  "userId": ObjectId, "orderId": ObjectId,
  "discountApplied": 5000, "redeemedAt": ISODate,
  "releasedAt": null }        // set when the order is cancelled/returned
```

Unique index `{ couponId, orderId }` makes double-redemption structurally impossible.

---

## 4. Validation rules

Ported from `plan_business_logic.md` §7 — **the specification was sound, it was simply never implemented** — with four additions.

| # | Rule | Failure code |
|---|---|---|
| V1 | Coupon exists (case-insensitive) | `COUPON_NOT_FOUND` |
| V2 | `isActive === true` | `COUPON_INACTIVE` |
| V3 | `startsAt` is null or `<= now` | `COUPON_NOT_STARTED` |
| V4 | `expiresAt` is null or `>= now` | `COUPON_EXPIRED` |
| V5 | `usageLimit` is null or `usedCount < usageLimit` | `COUPON_USAGE_EXCEEDED` |
| V6 | `minOrderAmount` is null or `itemsSubtotal >= minOrderAmount` | `COUPON_BELOW_MINIMUM` |
| **V7** | *(new)* `perUserLimit` is null or the user's redemption count `< perUserLimit` | `COUPON_USER_LIMIT_REACHED` |
| **V8** | *(new)* Requires an authenticated user | `UNAUTHENTICATED` |
| **V9** | *(new)* Cart is non-empty | `CART_EMPTY` |
| **V10** | *(new)* Computed discount `> 0` | `COUPON_NO_EFFECT` |

**Failure responses are specific**, because the customer needs to act on them ("this coupon expired" vs "spend 200 EGP more"). Coupon codes are shared marketing assets, not secrets, so this is not an enumeration concern — the rate limit on `/coupons/validate` handles brute-force code discovery.

---

## 5. Discount calculation

```
PERCENTAGE:
    raw      = round_half_up(itemsSubtotal × value / 10000)
    capped   = maxDiscountAmount ? min(raw, maxDiscountAmount) : raw
    discount = min(capped, itemsSubtotal)

FIXED:
    discount = min(value, itemsSubtotal)
```

**Invariants:**

- `0 <= discount <= itemsSubtotal`
- The discount **never applies to shipping** — it reduces goods value only
- `grandTotal >= 0` always
- Exactly **one** rounding operation per order, `HALF_UP`, on the percentage branch ([`MONEY-MODEL.md`](./MONEY-MODEL.md) §7.2)

### Worked example

```
Cart:            2 × 32,500  +  1 × 15,000        = 80,000 piastres (800.00 EGP)
Coupon MAKER10:  PERCENTAGE, value 1000 (10%), maxDiscountAmount 5,000

raw      = round(80,000 × 1000 / 10000)  = 8,000
capped   = min(8,000, 5,000)             = 5,000      <- cap applied
discount = min(5,000, 80,000)            = 5,000

itemsSubtotal  80,000
discountTotal  -5,000
shippingFee    +5,000
────────────────────────
grandTotal     80,000   (800.00 EGP)
```

---

## 6. Order calculation sequence (canonical)

```
1  Load authoritative products from the catalogue        [never from the cart]
2  effectiveUnitPrice(i) = salePrice ?? basePrice        [product-level discount]
3  lineTotal(i)          = effectiveUnitPrice × quantity
4  itemsSubtotal         = Σ lineTotal(i)
5  Validate the coupon against itemsSubtotal             [V1–V10]
6  discountTotal         = clamp(couponDiscount, 0, itemsSubtotal)
7  shippingFee           = FulfilmentService.quote(governorate,
                                                   itemsSubtotal - discountTotal)
8  grandTotal            = itemsSubtotal - discountTotal + shippingFee
9  assert grandTotal >= 0
```

**Two ordering decisions worth stating explicitly:**

- **Product discounts before coupons** (steps 2 → 5). The coupon applies to the already-discounted subtotal, which is the customer-favourable and conventional reading.
- **Shipping after discount** (step 7). The free-shipping threshold is evaluated against the **post-discount** amount. This is the stricter interpretation — a coupon can drop an order below the free-shipping threshold. It is stated here so the behaviour is deliberate rather than emergent, and it is a one-line change if the business prefers otherwise.

**No tax term** — prices are VAT-inclusive ([`MONEY-MODEL.md`](./MONEY-MODEL.md) §7.4).

---

## 7. Redemption lifecycle

### Validation (no side effects)

```
POST /api/v1/coupons/validate      [authenticated, rate-limited 20/hour]
{ "code": "MAKER10" }
→ { valid, discountAmount, itemsSubtotal, grandTotal }  |  { valid: false, reason }
```

Uses the caller's current cart. **Idempotent and free of side effects** — validating never consumes a coupon. The checkout UI calls this to preview the discount.

### Redemption (inside the order transaction)

Applied atomically at order placement:

```js
// 1. Atomic increment with the limit as a filter predicate
updateOne(
  { _id: couponId, isActive: true,
    $or: [ { usageLimit: null },
           { $expr: { $lt: ['$usedCount', '$usageLimit'] } } ] },
  { $inc: { usedCount: 1 } }
)
// matchedCount === 0  ->  abort the entire order, 409 COUPON_USAGE_EXCEEDED

// 2. Insert the redemption record (unique on {couponId, orderId})
// 3. Snapshot the coupon onto the order
```

The usage limit is enforced **inside the update filter**, so two simultaneous checkouts on the last remaining redemption cannot both succeed. Revalidation happens inside the transaction — a coupon that expires between quote and submit is caught.

### Release (on cancellation or return)

```
Order → CANCELLED or RETURNED:
    $inc coupon.usedCount by -1  (floored at 0)
    set redemption.releasedAt
```

The redemption record is **kept**, not deleted, so the history of who used what survives. Idempotent via the unique index — a repeated cancellation cannot decrement twice.

---

## 8. The order snapshot

The order embeds a **copy** of the coupon, never a live reference:

```jsonc
"coupon": {
  "couponId": ObjectId,      // traceability only
  "code": "MAKER10",
  "type": "PERCENTAGE",
  "value": 1000,
  "discountApplied": 5000
}
```

**Why a snapshot.** Legacy stored `orders.coupon_id` as a foreign key. Had it ever been populated, editing or deleting a coupon would have silently rewritten what past orders appeared to have paid. An order is a point-in-time contract ([`MONEY-MODEL.md`](./MONEY-MODEL.md) §9).

---

## 9. Stacking

> **DECISION: exactly one coupon per order. No stacking.**

| Reason | Detail |
|---|---|
| No requirement for multiple coupons | Nothing in the roadmap or product docs |
| Stacking multiplies complexity | Ordering rules, interaction caps, combinatorial test surface |
| Abuse surface | Stacked percentage coupons can drive an order to near-zero |
| Product discount + coupon already compose | Customers still get two layers of benefit |

`applyCoupon` **replaces** any previously applied code rather than adding to it.

---

## 10. Administration

| Operation | Endpoint | Role |
|---|---|---|
| List / create / update coupons | `GET|POST|PATCH /api/v1/admin/coupons` | ADMIN |
| Deactivate | `PATCH /admin/coupons/:id` (`isActive: false`) | ADMIN |
| Delete | `DELETE /admin/coupons/:id` | ADMIN — **only if `usedCount === 0`** |
| Redemption report | `GET /admin/coupons/:id/redemptions` | ADMIN |

**A used coupon can never be deleted**, only deactivated — deleting it would orphan redemption records and break reporting. Orders are unaffected either way because they carry a snapshot.

**Validation on create/update:** `code` 3–32 chars, alphanumeric + `-_`, uppercase-normalised, unique · `PERCENTAGE` requires `1 <= value <= 10000` bps · `FIXED` requires `value >= 1` minor unit · `maxDiscountAmount` valid only with `PERCENTAGE` · `expiresAt > startsAt` · `usageLimit >= 1` · `perUserLimit >= 1`.

**One schema, in `@nest/types`, shared by DTO and persistence** — resolving the two contradictory legacy definitions.

---

## 11. Security rules

| Rule | Enforcement |
|---|---|
| The coupon collection is **never publicly listable** | No public GET; only `POST /coupons/validate` by exact code |
| Discount is **always server-computed** | No client-supplied discount field exists in any DTO |
| Validation is **re-run inside the order transaction** | A quote is advisory; the transaction is authoritative |
| Usage limits enforced **in the update filter** | Not by a read-then-check |
| `/coupons/validate` is **rate-limited and authenticated** | Prevents brute-force code discovery |
| A coupon can never make `grandTotal` negative | Clamped to `[0, itemsSubtotal]` |
| Redemption is **idempotent** | Unique index `{couponId, orderId}` |

---

## 12. Summary of decisions

| # | Decision | Fixes |
|---|---|---|
| 1 | **REDESIGN** — build customer-facing validation and redemption | Admin-only half-feature |
| 2 | `value` discriminated by `type`: bps vs minor units | One ambiguous `numeric` column |
| 3 | **One** coupon schema | Two contradictory Zod schemas |
| 4 | `perUserLimit` + `couponRedemptions` collection | One user could drain a global limit |
| 5 | Validation is side-effect-free; redemption is transactional | — |
| 6 | Usage limit enforced **in the update filter** | Concurrent over-redemption |
| 7 | Discount **clamped** to `[0, itemsSubtotal]`; never applies to shipping | Negative totals |
| 8 | **Coupon snapshot** on the order | Editing a coupon would rewrite order history |
| 9 | **No stacking** — one coupon per order | Abuse and combinatorial complexity |
| 10 | Release on cancel/return, idempotently | Coupons permanently consumed by cancelled orders |
| 11 | Canonical sequence: product discount → coupon → shipping | Total formula had no discount term at all |
