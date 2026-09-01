# Business Rules Specification — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30

The authoritative catalogue of business rules for the new system. Every rule is either derived from verified legacy behaviour (Phase 0.5) or is a deliberate new decision recorded in [`BEHAVIOR-DECISIONS.md`](./BEHAVIOR-DECISIONS.md).

**Origin tags:** `PRESERVED` (legacy behaviour retained) · `FIXED` (legacy intent, defective implementation) · `NEW` (did not exist) · `REDESIGNED` (different model).

**Enforcement rule that governs all others:** every rule below is enforced **server-side, in the service layer**. Client-side validation is a UX affordance only and is never trusted. No rule may be satisfied by frontend logic alone.

---

## Format

Critical rules (§1–§3) are specified in full. Remaining domains use a compact table carrying the same fields.

---

## 1. Orders — creation

### RULE-ORDER-001 — Quantity must be a positive integer within bounds

| | |
|---|---|
| **Domain** | Orders · Cart |
| **Rule** | Every line quantity is an integer where `1 ≤ quantity ≤ 99`. |
| **Trigger** | `POST /cart/items`, `PATCH /cart/items/:id`, `POST /orders` |
| **Validation** | `@IsInt() @Min(1) @Max(99)` in the DTO **and** re-asserted in the service before the stock update |
| **Actors** | Customer |
| **Outcome** | Quantity accepted |
| **Failure** | `400 VALIDATION_ERROR`, field `quantity` |
| **Data** | `cart.items[].quantity`, `order.items[].quantity` |
| **API** | `POST /cart/items`, `POST /orders` |
| **Origin** | **FIXED** — legacy `create_order_v2` had **no quantity check** and `order_items` had no CHECK constraint. A negative quantity passed `stock_quantity >= -5`, **increased** stock via `stock − (−5)`, and produced a negative line total, driving the order total down (F-CRIT-3). |

### RULE-ORDER-002 — Prices are always resolved server-side

| | |
|---|---|
| **Domain** | Orders · Pricing |
| **Rule** | Unit price is read from the product document at the moment of order creation. Any price supplied by a client is ignored — and no DTO accepts one. |
| **Trigger** | `POST /orders`, `POST /checkout/quote` |
| **Validation** | `forbidNonWhitelisted` rejects any price field; `PricingService` is the only code that computes a payable amount |
| **Actors** | System |
| **Outcome** | `order.items[].unitPrice = salePrice ?? basePrice` at creation time |
| **Failure** | `400 UNKNOWN_FIELD` if a price is supplied |
| **API** | `POST /orders` |
| **Origin** | **PRESERVED** — legacy `create_order_v2` correctly ignored client prices. Strengthened: `create_order_v1` (still callable by `anon`) trusted client prices entirely and is removed. |

### RULE-ORDER-003 — Only publicly purchasable products may be ordered

| | |
|---|---|
| **Rule** | Every line's product must satisfy `isActive === true AND deletedAt === null` at order time. |
| **Trigger** | `POST /orders` |
| **Validation** | Included in the conditional update filter, so it is checked atomically with the stock decrement |
| **Failure** | `409 PRODUCT_UNAVAILABLE`, naming the SKU. **Entire order aborted.** |
| **Origin** | **FIXED** — legacy checked **neither** flag; inactive and soft-deleted products were purchasable (F-HIGH-3). |

### RULE-ORDER-004 — Insufficient stock aborts the entire order

| | |
|---|---|
| **Rule** | If any line cannot be fully satisfied, **no** order is created and **no** stock moves. |
| **Trigger** | `POST /orders` |
| **Validation** | Conditional update `{'stock.onHand': {$gte: qty}}`; `matchedCount === 0` aborts the transaction |
| **Outcome** | All-or-nothing |
| **Failure** | `409 OUT_OF_STOCK` with SKU and available quantity |
| **Origin** | **PRESERVED** — legacy plpgsql atomicity was correct. **This is the single most important invariant in the system.** |

### RULE-ORDER-005 — Order ownership is derived from the token

| | |
|---|---|
| **Rule** | `order.userId` is always the authenticated subject. No request may specify it. |
| **Validation** | No DTO contains `userId`; `forbidNonWhitelisted` rejects it |
| **Failure** | `400 UNKNOWN_FIELD` / `401` |
| **Origin** | **FIXED** — legacy `create_order_v2` took `p_user_id` as a parameter and **never compared it to `auth.uid()`**, and the function was executable by `anon` (F-CRIT-1/2). |

### RULE-ORDER-006 — Order placement is idempotent

| | |
|---|---|
| **Rule** | `POST /orders` requires an `Idempotency-Key`. A replay returns the original order. |
| **Validation** | Unique index on `orders.idempotencyKey`; 24 h TTL |
| **Failure** | `400 MISSING_IDEMPOTENCY_KEY` |
| **Origin** | **NEW** — a double-click created two orders and decremented stock twice. |

### RULE-ORDER-007 — Cart must not be empty

`422 CART_EMPTY`. **FIXED** — legacy accepted an empty item array and created a valid order with `total = shipping_fee` (F-MED-1).

### RULE-ORDER-008 — Order number format and daily sequence

| | |
|---|---|
| **Rule** | `NE-YYYYMMDD-NNNN`, where `NNNN` is a **counter that resets daily**. |
| **Validation** | Atomic `$inc` on `orderCounters` keyed by date, inside the transaction; unique index on `orderNumber` |
| **Origin** | **FIXED** — format PRESERVED, counter FIXED. Legacy used a single **global** sequence, so `NE-20260503-0006` meant "the 6th order ever placed" — a date-prefixed format implying a daily reset that never happened, leaking total order volume to anyone holding one order number. |

### RULE-ORDER-009 — Initial order state

New orders are `status: PLACED`, `payment.status: PENDING`. **REDESIGNED** — legacy created orders as `processing`/`pending`/`unfulfilled` across three independent status columns, and the `pending_payment` value its reservation cron depended on was unreachable.

---

## 2. Orders — lifecycle

### RULE-ORDER-010 — Transitions are server-owned and validated

| | |
|---|---|
| **Rule** | Status may change only through `OrdersService.transition()`, and only along an edge in the transition matrix ([`ORDER-LIFECYCLE.md`](./ORDER-LIFECYCLE.md) §5). |
| **Validation** | Matrix lookup **plus** a guarded update `{_id, status: <expectedFrom>}`; `matchedCount === 0` → conflict |
| **Actors** | Customer (cancel only, pre-dispatch) · Admin (all) |
| **Failure** | `409 INVALID_STATE_TRANSITION` or `409 CONCURRENT_MODIFICATION` |
| **Origin** | **FIXED** — the matrix lived **only** in admin app code while the underlying RPC was callable by `anon` and validated nothing. Live data already contained incoherent states (2 orders `shipped` with `payment pending`, 1 `delivered` with `unfulfilled`). |

### RULE-ORDER-011 — Cancellation and return restore stock

| | |
|---|---|
| **Rule** | `→ CANCELLED` or `→ RETURNED` restores every line's quantity and writes a compensating ledger event. |
| **Validation** | Idempotent via unique index `inventoryEvents {reference.id, productId, type}` |
| **Failure** | Transaction aborts; status unchanged |
| **Origin** | **FIXED** — legacy `update_order_status_v2` touched **no stock table at all**. Every cancelled order permanently destroyed its stock with no record (F-HIGH-2). |

### RULE-ORDER-012 — Shipping requires carrier and tracking number

| | |
|---|---|
| **Rule** | `→ SHIPPED` requires both `carrier` and `trackingNumber`, persisted to `order.shipment`. |
| **Failure** | `422 TRACKING_REQUIRED` |
| **Origin** | **FIXED** — `orders.tracking_number` **did not exist**, so any call supplying one raised, was swallowed by `EXCEPTION WHEN OTHERS`, and rolled back the status change *and* the history row. **Shipping with tracking was impossible** (F-CRIT-4). |

### RULE-ORDER-013 — Delivery implies payment collected

`→ DELIVERED` atomically sets `payment.status = PAID` and `payment.collectedAt`. **NEW** — makes "delivered but unpaid" structurally impossible under COD.

### RULE-ORDER-014 — Customer may cancel before dispatch

Allowed while `PLACED` or `CONFIRMED`, own order only. `422 ORDER_NOT_CANCELLABLE` otherwise. **NEW** — legacy had no customer cancellation path.

### RULE-ORDER-015 — Every transition appends history

`{from, to, actor, note, at}` appended in the same transaction; actor from the JWT. **FIXED** — legacy accepted `changed_by` from the caller unverified, and a direct `UPDATE orders` (permitted to admins by RLS) changed status with no history row.

### RULE-ORDER-016 — Orders are immutable and undeletable

No API deletes an order; items and pricing are never modified after placement. **PRESERVED** — legacy had no DELETE policy on `orders`, which was correct.

---

## 3. Inventory

| Rule ID | Rule | Trigger | Validation | Actors | Failure | Origin |
|---|---|---|---|---|---|---|
| **RULE-INV-001** | `stock.onHand` may never be negative | Any mutation | Conditional update predicate | System, Admin | `422 INSUFFICIENT_STOCK` | **PRESERVED** |
| **RULE-INV-002** | **Every** stock mutation writes a ledger event in the **same transaction** | Any mutation | Transaction | System, Admin | Abort | **FIXED** — nothing enforced this; a direct `UPDATE products SET stock_quantity` changed stock with no ledger row |
| **RULE-INV-003** | `Σ inventoryEvents.quantityDelta == stock.onHand` for every product | Weekly job + CI | Reconciliation | System | Alert | **NEW** — impossible in legacy (no opening balances; 4 of 85 products had any events, none reconciling) |
| **RULE-INV-004** | Every product is created with an `OPENING_BALANCE` event | Product creation | Transaction | Admin | Abort | **NEW** — what makes RULE-INV-003 achievable |
| **RULE-INV-005** | Stock is writable **only** by `InventoryModule` | Product update | `stock` rejected by the product DTO | — | `400 UNKNOWN_FIELD` | **FIXED** — legacy admins could change stock via a generic update, bypassing the ledger |
| **RULE-INV-006** | Adjustment is a **signed delta** with a reason of ≥ 3 characters | `POST /admin/inventory/:id/adjust` | DTO + service | Admin | `400` | **PRESERVED** — `adjust_stock_v2` semantics were correct (though it never once succeeded in production) |
| **RULE-INV-007** | `delta = 0` is rejected | Adjustment | DTO | Admin | `400` | **FIXED** — legacy permitted a meaningless ledger row |
| **RULE-INV-008** | Actor on every event comes from the JWT | Any mutation | Interceptor | — | — | **FIXED** — `created_by` was NULL on every sale; `p_admin_id` was caller-supplied and forgeable |
| **RULE-INV-009** | **No reservations.** `available = stock.onHand` | — | — | — | — | **REDESIGNED** — the reservation subsystem was structurally dead (35,309 no-op cron runs; `reserved_quantity = 0` on all 85 products) because COD has no payment gap |
| **RULE-INV-010** | Stock restoration is idempotent | Cancel/return | Unique index | System | Silently no-op | **NEW** |

---

## 4. Pricing, money & discounts

| Rule ID | Rule | Validation | Failure | Origin |
|---|---|---|---|---|
| **RULE-PRICE-001** | All money is int64 **EGP minor units**; floats forbidden in the money path | Type system + lint | — | **REDESIGNED** |
| **RULE-PRICE-002** | Effective unit price = `salePrice ?? basePrice` | `PricingService` — one implementation | — | **PRESERVED** (was duplicated in 4 frontend places) |
| **RULE-PRICE-003** | `salePrice`, when set, satisfies `0 < salePrice < basePrice` | DTO + service | `400` | **NEW** |
| **RULE-PRICE-004** | `grandTotal = itemsSubtotal − discountTotal + shippingFee` | Asserted before persistence | `500` if violated | **REDESIGNED** — legacy had no discount term (`total = subtotal + shipping`) |
| **RULE-PRICE-005** | `0 ≤ discountTotal ≤ itemsSubtotal`; `grandTotal ≥ 0` | Clamp + assert | `500` if violated | **NEW** |
| **RULE-PRICE-006** | Prices are **VAT-inclusive**; no additive tax term | Model | — | **REDESIGNED** — `tax` existed and was always 0 while the PDP claimed "price includes VAT" |
| **RULE-PRICE-007** | Percentage discounts round **HALF_UP**, exactly once per order | `PricingService` | — | **NEW** |
| **RULE-PRICE-008** | Only `PricingModule` may compute a payable amount | Module boundary | — | **NEW** |
| **RULE-PRICE-009** | Shipping fee is **always server-computed** from governorate + post-discount subtotal | `FulfilmentService` | — | **FIXED** — legacy hardcoded `p_shipping_fee: 0` at the call site |

### Coupons

| Rule ID | Rule | Failure code | Origin |
|---|---|---|---|
| **RULE-COUPON-001** | Coupon must exist, be active, and be within its date window | `COUPON_NOT_FOUND` / `COUPON_INACTIVE` / `COUPON_EXPIRED` / `COUPON_NOT_STARTED` | **REDESIGNED** (spec existed, never implemented) |
| **RULE-COUPON-002** | Global `usageLimit` enforced **inside the update filter** | `409 COUPON_USAGE_EXCEEDED` | **NEW** |
| **RULE-COUPON-003** | `perUserLimit` enforced via `couponRedemptions` | `422 COUPON_USER_LIMIT_REACHED` | **NEW** — legacy had no per-user limit |
| **RULE-COUPON-004** | `minOrderAmount` checked against `itemsSubtotal` | `422 COUPON_BELOW_MINIMUM` | **REDESIGNED** |
| **RULE-COUPON-005** | `PERCENTAGE` discount capped by `maxDiscountAmount` | — | **REDESIGNED** |
| **RULE-COUPON-006** | **One coupon per order** — no stacking | — | **NEW** |
| **RULE-COUPON-007** | The coupon is **snapshotted** onto the order, never referenced | — | **REDESIGNED** — a reference would let a later coupon edit rewrite order history |
| **RULE-COUPON-008** | Redemption released on cancellation/return, idempotently | — | **NEW** |
| **RULE-COUPON-009** | Validation is side-effect-free; redemption happens only inside the order transaction | — | **NEW** |
| **RULE-COUPON-010** | Discount never applies to shipping | — | **NEW** |

---

## 5. Catalog

| Rule ID | Rule | Actors | Failure | Origin |
|---|---|---|---|---|
| **RULE-CAT-001** | `sku` and `slug` are unique; `sku` is immutable after creation | Admin | `409 DUPLICATE_*` | **PRESERVED** |
| **RULE-CAT-002** | Renaming a slug emits a `slugRedirect`, **and product resolution reads it** → `301` | Admin | — | **FIXED** — legacy wrote redirects that nothing ever read, so every rename produced a permanent 404 |
| **RULE-CAT-003** | Public reads always filter `isActive && !deletedAt`, enforced in the repository | — | `404` | **PRESERVED** |
| **RULE-CAT-004** | Child resources (images, specs) inherit the parent's visibility | — | `404` | **FIXED** — 7 legacy child tables carried `SELECT USING (true)`, leaking images and specs of unreleased products |
| **RULE-CAT-005** | Exactly one `isPrimary` image when `images` is non-empty; set in **one atomic update** | Admin | `400` | **FIXED** — legacy used two sequential non-atomic updates |
| **RULE-CAT-006** | Maximum 8 images per product, enforced **server-side** | Admin | `422` | **FIXED** — legacy enforced this only in the React component |
| **RULE-CAT-007** | `costPrice` is never present in a public DTO | — | — | **NEW** |
| **RULE-CAT-008** | `rating` is writable only by `ReviewsModule`; `stock` only by `InventoryModule` | — | `400 UNKNOWN_FIELD` | **NEW** |
| **RULE-CAT-009** | Category tree depth ≤ 3; reparenting rewrites `path[]` and runs cycle detection | Admin | `422` | **NEW** |
| **RULE-CAT-010** | Product duplication copies asset **references with refcounting** | Admin | — | **FIXED** — legacy copied URL strings, so two products shared one object and deleting from either broke the other |
| **RULE-CAT-011** | Soft delete is the default; hard delete requires `SUPER_ADMIN` and no order references | Super Admin | `409` | **PRESERVED + NEW** |

---

## 6. Cart

| Rule ID | Rule | Failure | Origin |
|---|---|---|---|
| **RULE-CART-001** | The cart is **never** authoritative for price or stock; every read re-prices from the live catalogue | — | **REDESIGNED** — the legacy server cart had no price column and its subtotal was permanently 0 |
| **RULE-CART-002** | Checkout sends **no items, no prices, no userId** — items are derived from the server cart | `400 UNKNOWN_FIELD` | **NEW** |
| **RULE-CART-003** | Merge on login uses `max(guestQty, serverQty)`, then clamps to available stock | — | **FIXED** — two contradictory implementations (`max` in the store, `sum` in the provider) |
| **RULE-CART-004** | One `MAX_QUANTITY_PER_LINE` constant (99), server-enforced | `400` | **FIXED** — defined in four places, enforced only on the client |
| **RULE-CART-005** | Unavailable lines are retained, flagged, and excluded from totals; they block checkout | `409` at checkout | **NEW** |
| **RULE-CART-006** | Carts expire after 30 days (TTL) | — | **NEW** |
| **RULE-CART-007** | Cart is cleared inside the order transaction | — | **NEW** |

---

## 7. Authentication & authorization

| Rule ID | Rule | Failure | Origin |
|---|---|---|---|
| **RULE-AUTH-001** | Passwords hashed with bcrypt cost 12; the hash never leaves `AuthModule` | — | **PRESERVED** |
| **RULE-AUTH-002** | Server-side password policy: ≥ 10 characters, common-password blocklist | `400` | **FIXED** — client-only `min(8)` |
| **RULE-AUTH-003** | Email verification required before login | `403 EMAIL_NOT_VERIFIED` | **FIXED** — required, but registration ignored it and dead-ended at `/login` |
| **RULE-AUTH-004** | `fullName` is required at registration | `400` | **FIXED** — legacy fell back to the **email address** as a display name |
| **RULE-AUTH-005** | `role` is server-assigned (`CUSTOMER`) and absent from every self-service DTO | `400 UNKNOWN_FIELD` | **PRESERVED (strengthened)** — legacy relied on an RLS `WITH CHECK`; a whitelist is stronger |
| **RULE-AUTH-006** | Access token 15 min; refresh token 30 days, **rotating**; reuse revokes the family | `401 REFRESH_TOKEN_REUSED` | **NEW** — no revocation existed |
| **RULE-AUTH-007** | Password reset works end to end and revokes all sessions | — | **FIXED** — the form threw a `TypeError`; reset never worked for any user |
| **RULE-AUTH-008** | Forgot-password always returns 200 (no account enumeration) | — | **NEW** |
| **RULE-AUTH-009** | `userId` is always taken from the JWT; ownership is a **query filter**, not a post-fetch check | `404` | **FIXED** |
| **RULE-AUTH-010** | A resource owned by another user returns **404**, never 403 | `404` | **NEW** |
| **RULE-AUTH-011** | Only `SUPER_ADMIN` may change roles or delete users; the last super-admin cannot remove itself | `403` | **FIXED** — `admin` and `super_admin` were declared but treated identically everywhere |
| **RULE-AUTH-012** | Authentication is global by default; public routes opt out with `@Public()` | `401` | **FIXED** — legacy admin `/api/*` relied on a route matcher with no in-handler check |
| **RULE-AUTH-013** | Rate limits enforced server-side on all sensitive endpoints | `429` | **NEW** — none existed |
| **RULE-AUTH-014** | **No client may reach the database directly, and no privileged function is callable without authorization** | — | **FIXED** — the defining legacy failure (F-CRIT-1) |

---

## 8. Guest access

| Rule ID | Rule | Failure | Origin |
|---|---|---|---|
| **RULE-GUEST-001** | Checkout requires an authenticated, verified account | `401` | **PRESERVED** (formalised) |
| **RULE-GUEST-002** | Order tracking requires order number **+ matching phone**, both in the **query filter** | `404` (generic) | **REDESIGNED** — legacy fetched the full order then compared the phone in the browser |
| **RULE-GUEST-003** | Tracking returns a minimal projection — no PII, no items, no money, no tracking number | — | **NEW** |
| **RULE-GUEST-004** | Tracking is rate-limited to 10/hour/IP, server-side, applied before database access | `429` | **FIXED** — legacy's limiter was in-memory client state reset by a page reload |

---

## 9. Reviews

| Rule ID | Rule | Failure | Origin |
|---|---|---|---|
| **RULE-REVIEW-001** | One review per user per product | `409 REVIEW_ALREADY_EXISTS` | **PRESERVED** |
| **RULE-REVIEW-002** | Rating is an integer 1–5 | `400` | **PRESERVED** |
| **RULE-REVIEW-003** | New reviews default to `PENDING`; only `APPROVED` is public | — | **PRESERVED** |
| **RULE-REVIEW-004** | A customer may edit only while `PENDING` | `422` | **PRESERVED** |
| **RULE-REVIEW-005** | `isVerifiedPurchase` is **computed** from a `DELIVERED` order containing the product | `400 UNKNOWN_FIELD` if supplied | **FIXED** — the column existed and was never computed |
| **RULE-REVIEW-006** | `product.rating` is recomputed on every status change | — | **FIXED** — six UI mappers read `avg_rating`/`review_count` columns **that never existed**, so ratings rendered 0 permanently |

---

## 10. Media

| Rule ID | Rule | Failure | Origin |
|---|---|---|---|
| **RULE-MEDIA-001** | Allowed types: JPEG, PNG, WebP. **SVG rejected.** | `422 INVALID_FILE_TYPE` | **FIXED** |
| **RULE-MEDIA-002** | Declared MIME is verified by **magic-byte inspection** | `422` | **NEW** |
| **RULE-MEDIA-003** | Size limits: 5 MB (2 MB avatars) | `422 FILE_TOO_LARGE` | **PRESERVED** (from bucket-level config) |
| **RULE-MEDIA-004** | The server authors all metadata; the client supplies only `alt` | — | **NEW** |
| **RULE-MEDIA-005** | Store `publicId` + `version`, never a URL | — | **REDESIGNED** |
| **RULE-MEDIA-006** | EXIF stripped on upload | — | **NEW** |
| **RULE-MEDIA-007** | Deletion is refcount-aware | — | **FIXED** |

---

## 11. Audit

| Rule ID | Rule | Origin |
|---|---|---|
| **RULE-AUDIT-001** | Privileged actions are audited; reads and routine customer actions are not | **NEW** |
| **RULE-AUDIT-002** | Audit records are written by a **system-privileged interceptor**, never by the acting principal | **FIXED** |
| **RULE-AUDIT-003** | Audit write failure is logged at `error` and alerted — **never swallowed** | **FIXED** — silent swallowing produced **0 audit rows** across the system's entire history |
| **RULE-AUDIT-004** | Audit records are immutable; no update or delete API exists | **NEW** |
| **RULE-AUDIT-005** | Business history (order status, inventory ledger) is separate from the security audit log | **NEW** |

---

## 12. Rule coverage

| Domain | Rules | Preserved | Fixed | New | Redesigned |
|---|---|---|---|---|---|
| Orders — creation | 9 | 2 | 5 | 1 | 1 |
| Orders — lifecycle | 7 | 1 | 4 | 2 | 0 |
| Inventory | 10 | 2 | 4 | 3 | 1 |
| Pricing & money | 9 | 1 | 2 | 3 | 3 |
| Coupons | 10 | 0 | 0 | 6 | 4 |
| Catalog | 11 | 3 | 6 | 2 | 0 |
| Cart | 7 | 0 | 2 | 4 | 1 |
| Auth & authz | 14 | 2 | 8 | 4 | 0 |
| Guest access | 4 | 1 | 1 | 1 | 1 |
| Reviews | 6 | 4 | 2 | 0 | 0 |
| Media | 7 | 1 | 2 | 3 | 1 |
| Audit | 5 | 0 | 2 | 3 | 0 |
| **Total** | **99** | **17** | **38** | **32** | **12** |

**Only 17 of 99 rules are straight preservations.** The rest are corrections, additions or redesigns — consistent with the Phase 0.5 conclusion that this is **not a port**. Notably, the preserved rules are concentrated in *intentions the database expressed correctly* (atomicity, snapshots, uniqueness, ownership) rather than in code that worked.

**Every rule is enforced server-side.** The nine frontend-only rules Phase 0 catalogued (effective price, cart caps, stock capping, default address, guest phone check, client rate limiting) are all relocated to the service layer here.
