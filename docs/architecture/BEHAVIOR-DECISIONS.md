# Behaviour Decision Matrix — Phase 1 Architecture Freeze

**Status:** FROZEN pending review · **Date:** 2026-08-30

Every significant behaviour found in Phase 0 / Phase 0.5 receives exactly one decision.

| Decision | Meaning |
|---|---|
| **PRESERVE** | Correct as-is. Reimplement with the same semantics. |
| **FIX** | Business intent correct, implementation defective (bug, security flaw, or technical fault). |
| **REMOVE** | Should not exist in the new system. |
| **REDESIGN** | The model itself is unsuitable; a different approach is required. |

**Context that licenses aggressive change:** the system is in development, all data is synthetic, there are no production users, and Supabase is now a *legacy reference*, not a contract. Legacy behaviour carries **no** presumption of correctness.

**Totals: 96 behaviours — PRESERVE 24 · FIX 38 · REMOVE 18 · REDESIGN 16.**

---

## 1. Checkout & order creation

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| C1 | Prices resolved server-side; client prices discarded | Works | `create_order_v2` reads price from DB | **PRESERVE** | Pricing service is the sole price authority | The one thing legacy checkout got unambiguously right |
| C2 | Effective price = `sale_price ?? base_price` | Works | functions-analysis §1 | **PRESERVE** | `effectiveUnitPrice = salePrice ?? basePrice` | Correct and consistently applied, including in filters |
| C3 | Whole order aborts on insufficient stock | Works (atomic) | plpgsql, no EXCEPTION block | **PRESERVE** | All-or-nothing inside one Mongo transaction | The single most important invariant in the system |
| C4 | Stock guard `WHERE stock_quantity >= qty` | Race-safe | functions-analysis §1 | **PRESERVE** | Conditional update `{ 'stock.onHand': { $gte: qty } }` | Correct concurrency primitive; port the pattern |
| C5 | Order line stores name/sku/price snapshot | Works | `order_items` insert | **PRESERVE** | Embedded immutable `items[]` | Orders are point-in-time contracts |
| C6 | **`p_user_id` accepted as a parameter, never checked against the caller** | 🔴 Broken | F-CRIT-2 | **FIX** | `userId` derived from the JWT; no such request field exists | Ownership forgery |
| C7 | **Function callable by `anon` with no authz** | 🔴 Broken | F-CRIT-1 | **FIX** | Authenticated + authorized service call only | The defining legacy security failure |
| C8 | **No `quantity > 0` validation** | 🔴 Broken | F-CRIT-3; `order_items` has no CHECK | **FIX** | `quantity` integer, 1 ≤ q ≤ 99, validated in the DTO *and* the service | Negative quantity increased stock and reduced the total |
| C9 | **No `isActive` / `deletedAt` check at checkout** | 🔴 Broken | F-HIGH-3 | **FIX** | Reject any line whose product is not publicly purchasable | Hidden/deleted products were purchasable |
| C10 | Empty item list creates a valid order | Broken | F-MED-1 | **FIX** | Reject with `CART_EMPTY` | Meaningless zero-value orders |
| C11 | `total = subtotal + shipping_fee`; discount and tax always 0 | Incomplete | Live: 10/10 orders have 0 discount/tax/shipping | **REDESIGN** | `total = subtotal − discount + shippingFee` (VAT-inclusive) | Coupons are a roadmap feature with no calculation path; shipping was hardcoded 0 |
| C12 | Shipping fee hardcoded `0` by the caller | Incomplete | `checkout.actions.ts:97` | **REDESIGN** | Server-computed by Fulfilment from governorate + threshold | Client must never influence shipping cost |
| C13 | Tax column exists, always 0; PDP claims "price includes VAT" | Contradictory | data-integrity §9 | **REDESIGN** | Prices are **VAT-inclusive**; no additive tax term | Removes a permanent ambiguity |
| C14 | Order created with placeholder totals then updated | Wasteful | functions-analysis F-LOW-1 | **FIX** | Compute totals first, insert once | Two writes and a spurious trigger per order |
| C15 | `inventory_transactions.created_by` NULL on sale | Broken | F-MED-2 | **FIX** | Every ledger event carries an actor | Ledger could not attribute a sale |
| C16 | No idempotency on checkout | Missing | Phase 0.5 | **FIX** | `Idempotency-Key` header required on `POST /orders` | Double-submit creates duplicate orders and double-decrements stock |
| C17 | Client-supplied `productId` on the variant path never verified | Broken | F-MED-3 | **REMOVE** | Variants removed entirely | Defect disappears with the variant model |
| C18 | Variant price ignores `sale_price` | Broken | F-HIGH-4 | **REMOVE** | — | Variants removed (§5) |
| C19 | `create_order_v1` — client dictates prices and totals | 🔴 Broken | Phase 0.5 §3 | **REMOVE** | Does not exist in the new system | Unauthenticated arbitrary-price order creation |
| C20 | Checkout requires login | Works | `checkout.actions.ts:43` + proxy | **PRESERVE** | Authenticated checkout only | See [`GUEST-CHECKOUT.md`](./GUEST-CHECKOUT.md) |
| C21 | Checkout UI skips the Egyptian phone regex | Broken | Phase 0 §11.4 | **FIX** | Server-side DTO validation is authoritative | Client validation is advisory only |

---

## 2. Order status & lifecycle

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| O1 | **Three independent status columns** (`order_status`, `payment_status`, `fulfillment_status`) | Incoherent | Live: `shipped`+`payment pending` ×2; `delivered`+`unfulfilled` ×1 | **REDESIGN** | **One** `status` lifecycle + a separate `payment.status` | 7×6×5 = 210 combinations, none validated. `fulfillment_status` duplicated `order_status`. |
| O2 | Status vocabulary designed for a prepaid flow (`pending_payment → paid`) | Mismatched | plan_business_logic §1 vs COD-only MVP | **REDESIGN** | COD-native lifecycle: `PLACED → CONFIRMED → SHIPPED → DELIVERED` | There is no pre-dispatch payment step under COD. This mismatch is the root cause of the dead reservation subsystem. |
| O3 | **No transition validation in the backend** | 🔴 Broken | F-HIGH-1 | **FIX** | Server-owned transition matrix, enforced atomically | The matrix existed only in admin app code, and the RPC was callable by `anon` |
| O4 | **Cancellation never restores stock** | 🔴 Broken | F-HIGH-2 | **FIX** | Cancellation/return restores stock + writes a compensating ledger event | Permanent silent stock loss |
| O5 | **Tracking number breaks the entire call** | 🔴 Broken | F-CRIT-4 — `orders.tracking_number` does not exist | **FIX** | `orders.shipment { carrier, trackingNumber, shippedAt }` | Shipping with tracking is impossible today |
| O6 | Status history append-only | Works | 8 live rows | **PRESERVE** | Embedded `statusHistory[]`, append-only | Sound design |
| O7 | `changed_by` accepted unverified | Broken | F-MED-5 | **FIX** | Actor from the JWT | Forgeable audit trail |
| O8 | `EXCEPTION WHEN OTHERS` masks faults as `{success:false}` | Broken | F-MED-6 | **FIX** | Typed domain errors; infrastructure faults propagate as 5xx | Business rejections and real faults were indistinguishable |
| O9 | Read-then-write TOCTOU between app check and RPC | Broken | Phase 0 M8 | **FIX** | Read, validate and write inside one transaction with a guarded update | Two admins could drive an invalid state |
| O10 | Order number `NE-YYYYMMDD-NNNN` | Works, but global counter | seq `last_value=10`; format implies daily reset | **FIX** | Keep the format; **reset the counter daily** | A global counter leaks total order volume through a date-prefixed number |
| O11 | Customer cannot cancel their own order | Missing | No such path | **FIX** | Customer may cancel while `PLACED` or `CONFIRMED` | Basic COD expectation; reduces support load |
| O12 | No delivery-failure state | Missing | — | **REDESIGN** | `DELIVERY_FAILED` with retry or return | Failed COD delivery is common in Egypt and must be modelled |
| O13 | Refund lifecycle (5 states) | Planned, never built | plan_business_logic §6 | **REMOVE from MVP** | `payment.status = REFUNDED` set manually by an admin | No payment provider exists; a 5-state refund workflow models nothing real |

---

## 3. Inventory

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| I1 | `available = stock_quantity − reserved_quantity` | Duplicated 5× | Phase 0 B1 | **REDESIGN** | `available = stock.onHand` — reservations removed | See I2 |
| I2 | **Reservation model** (`reserved_quantity`, 30-min expiry, cron) | 🔴 Structurally dead | 35,309 no-op cron runs; `reserved_quantity = 0` on all 85 products; 0 reservation ledger rows | **REMOVE** | No reservation concept. Stock is decremented at order placement. | Reservations exist to hold stock during a *payment gap*. COD has no payment gap — the order is committed immediately. The design was inherited from a prepaid flow that was never built. |
| I3 | Ledger written for sales | Works | 7 `sale` rows | **PRESERVE** | Every mutation writes an `inventoryEvent` | Correct intent |
| I4 | **No trigger/constraint enforces ledger ↔ stock consistency** | Broken | triggers-analysis §3 | **FIX** | Inventory service is the **only** writer of stock; ledger write is in the same transaction | A direct update changed stock with no ledger row |
| I5 | Ledger does not reconcile to stock (no opening balances) | Broken | data-integrity §8 — 4/85 products, none reconciling | **FIX** | Seed an `OPENING_BALANCE` event per product; `Σ events = onHand` becomes an assertable invariant | Ledger was not a usable audit |
| I6 | `adjust_stock_v2` signed delta, floor 0, actor recorded | Correct, never executed | 0 `adjustment` rows | **PRESERVE** | Same semantics via `InventoryService.adjust()` | Good design that was never reachable |
| I7 | Adjustment ignores `reserved_quantity`, hits a CHECK constraint | Broken | F-MED-8 | **REMOVE** | Moot — reservations removed | |
| I8 | Stock adjustment callable by `anon` | 🔴 Broken | F-CRIT-1 | **FIX** | `@Roles('ADMIN')` + service-only writes | |
| I9 | `low_stock_threshold` per product | Populated 85/85 | schema | **PRESERVE** | Drives low-stock reporting and alerts | Already in use |
| I10 | Stock restored on return | Planned only | plan §6 step 5 | **FIX** | `RETURNED` transition restores stock + ledger event | Never implemented |

---

## 4. Pricing, coupons & discounts

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| P1 | Money as `numeric(10,2)` | Works in PG | schema | **REDESIGN** | **Integer minor units (piastres) + ISO code `EGP`** | JS has no decimal type; `numeric` cannot survive the boundary safely. See [`MONEY-MODEL.md`](./MONEY-MODEL.md) |
| P2 | Effective price computed in 4 frontend places | Duplicated | Phase 0 B2 | **FIX** | Computed once, server-side; API returns resolved prices | Frontend must never derive money |
| P3 | Cart subtotal computed client-side | Frontend-only | Phase 0 B3 | **FIX** | Server-computed cart totals | |
| P4 | Server cart subtotal always 0 | Broken | `cart_items` has no price column | **REDESIGN** | Cart re-prices from live catalog on every read | The stored cart could not compute money at all |
| P5 | **Coupons: full admin CRUD, zero redemption path** | Half-built | 0 coupons; no public read policy; no code | **REDESIGN** | Complete the loop: validate + redeem, server-side only | Explicitly on the roadmap ("Schema exists, UI not built") |
| P6 | Coupon algorithm specified but unimplemented | Spec only | plan §7 | **PRESERVE (the spec) / FIX (implement)** | Implement as specified, in minor units, with an atomic redemption counter | The spec is sound; it was simply never built |
| P7 | Two contradictory coupon Zod schemas | Duplicated | Phase 0 B19 | **FIX** | One schema, one module | |
| P8 | `orders.coupon_id` never populated | Dead | 0 orders with a coupon | **REDESIGN** | Embed a `coupon` **snapshot** on the order | A reference would let a later coupon edit rewrite order history |
| P9 | No per-user coupon limit | Missing | — | **FIX** | `perUserLimit` enforced via `couponRedemptions` | Standard abuse control |
| P10 | Discount never validated against subtotal | Missing | — | **FIX** | Discount clamped to `[0, subtotal]`; total never negative | |

---

## 5. Catalog & products

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| K1 | Soft delete via `deleted_at` | Works | 0 deleted live | **PRESERVE** | `deletedAt` + all public reads filter it | Correct for a catalogue |
| K2 | `isActive` publication flag | Works | 85/85 active | **PRESERVE** | | |
| K3 | Slug uniqueness | Enforced by unique index | schema | **PRESERVE** | Unique index retained | |
| K4 | Slug redirect written on rename | Write-only | 0 rows; nothing reads it | **FIX** | `slugRedirects` is **read** by product resolution → HTTP 301 | Half-implemented SEO feature |
| K5 | **`avg_rating` / `review_count` read by 6 UI mappers, columns do not exist** | 🔴 Broken | schema + 0 reviews | **FIX** | `product.rating {average, count, distribution}` maintained by Reviews | Ratings render 0 permanently |
| K6 | **EAV attributes across 3 tables** | Unusable | `attributes` 9 rows, values 0, assignments 0 | **REDESIGN** | Flat embedded `specs[{key,label,value,unit,filterable}]` | An EAV join the search function could not traverse; zero data means zero migration cost |
| K7 | **Product variants** | Speculative | 0 rows, never in scope | **REMOVE** | Distinct components are distinct SKUs | Not a requirement for a components store |
| K8 | Product images embedded, ≤8, one primary | Invariant clean | 0 violations | **PRESERVE** | Embedded `images[]`, exactly one `isPrimary` | |
| K9 | Reorder = one UPDATE per image | N+1 | Phase 0 P8 | **FIX** | One atomic array `$set` | |
| K10 | Set-primary = two non-atomic updates | Broken | Phase 0 B25 | **FIX** | One atomic update | |
| K11 | Product duplication copies image **URLs** — two products share one asset | Broken | Phase 0 W4 | **FIX** | Reference-counted assets, or copy the asset | Deleting from one product breaks the other |
| K12 | Duplication SKU/slug suffix = 4-char base-36 timestamp | Collision-prone | Phase 0 B26 | **FIX** | Deterministic `-copy-N` with a uniqueness check | |
| K13 | `updated_at` written to `categories`/`brands` — **columns do not exist** | Broken (silent) | schema | **FIX** | Uniform `createdAt`/`updatedAt` on every collection | Writes failed silently |
| K14 | Category tree built in JS on every page render | Inefficient | 1,664 seq scans; P1 | **REDESIGN** | Materialised `path[]`/`ancestors[]` + a cached tree endpoint | No recursive CTE in MongoDB |
| K15 | `name_ar` / `description_ar` — **100% NULL** | Unused | 85/85 NULL | **REDESIGN** | Localized value object `{en, ar?}`; MVP populates `en` only | Arabic is explicitly post-MVP roadmap; a `{en,ar}` shape now avoids rewriting every document later |
| K16 | `cost_price` populated on 2/85 | Barely used | data-integrity §7 | **PRESERVE** | Optional admin-only field, never exposed publicly | Needed for margin reporting later; must never leak |
| K17 | `weight` / `dimensions` on 2/85 | Barely used | | **PRESERVE (optional)** | Optional; not used for shipping in MVP | Flat-rate shipping does not need weight |
| K18 | `seo_title` etc. 0/85 | Unused | | **PRESERVE (optional)** | Optional overrides; fall back to name/description | Cheap, real SEO value |

---

## 6. Search & discovery

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| S1 | **No sort parameter exists**; UI advertises 5 | 🔴 Broken | `search_products` hardcodes ORDER BY | **FIX** | `sort` = `relevance\|price_asc\|price_desc\|newest\|rating\|name_asc` | UI promises what the backend cannot do |
| S2 | **No total count**; `count:'exact'` applied to a paginated RPC | 🔴 Broken | F-HIGH-7 | **FIX** | Response returns a true `total` | Pagination is wrong by construction |
| S3 | **Category filter matches one level only** | Broken | F-MED-10; 10 child categories exist | **FIX** | Subtree match via `category.path` | Parent category pages omit child products |
| S4 | Listing returns no images/brand/rating | 🔴 Broken | 12 scalar columns | **FIX** | Listing DTO includes primary image, brand name, rating | Root cause of imageless grids |
| S5 | Visibility filter `is_active AND deleted_at IS NULL` | Works | | **PRESERVE** | | |
| S6 | Price filter uses effective price | Works | | **PRESERVE** | Consistent with checkout | |
| S7 | GIN full-text index **never used** — `ILIKE` OR-branches force a seq scan | Broken | 0 scans, 1,282 seq scans | **REDESIGN** | MongoDB `$text` index; no leading-wildcard fallback | Paying write cost for an unreadable index |
| S8 | Attribute faceting never built despite EAV schema | Missing | 0 assignments | **REDESIGN** | Facets over embedded `specs[]` | Now cheap because specs are embedded |
| S9 | `/products` and `/search` duplicate the same logic | Duplicated | Phase 0 §10.4 | **FIX** | One endpoint, one service | |
| S10 | Price-range filter bounds derived from the current page | Broken | Phase 0 P23 | **FIX** | Server-computed facet bounds | |
| S11 | `findBestSelling` orders by non-existent `avg_rating` | Broken | Phase 0 F1 | **FIX** | `salesCount` maintained on order placement | |

---

## 7. Cart

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| T1 | localStorage is the cart of record | By accident | `getCart()` has 0 call sites | **REDESIGN** | Server cart is authoritative for authenticated users; guests keep a client cart until login | The DB cart was write-only |
| T2 | **Two contradictory merge strategies** (`max` in store, `sum` in provider) | Broken | Phase 0 B15 | **FIX** | **One** strategy: `max(guestQty, serverQty)`, capped at available stock | Matches the documented intent in plan §5 |
| T3 | Max quantity 99 defined in 4 places | Duplicated | Phase 0 B13 | **FIX** | One constant, server-enforced | |
| T4 | Quantity capped at available stock client-side only | Frontend-only | Phase 0 B14 | **FIX** | Server-enforced; client cap is a UX affordance | |
| T5 | `cart_items` has no price column | Broken | schema | **REDESIGN** | Store a **display snapshot**; re-price from catalog on every read | Prevents a stale price ever becoming payable |
| T6 | No cart expiry | Missing | | **FIX** | TTL index, 30 days | Unbounded growth |
| T7 | Guest cart merge never exercised (0 guest carts) | Untested | | **FIX** | Explicit, tested merge on login | |
| T8 | Cart lines for unavailable products | Unhandled | | **FIX** | Line flagged `unavailable`, excluded from totals, never blocks cart viewing | Checkout rejects; browsing should not |

---

## 8. Authentication

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| A1 | Browser-side auth calls with the anon key | Architectural | 6 call sites | **REDESIGN** | All auth through the NestJS API | Client must not talk to the identity provider directly |
| A2 | bcrypt `$2a$` password hashes | Works | 4/4 users | **PRESERVE** | bcrypt (cost ≥ 12) or argon2id | Standard and portable — though with no production users, migration is moot |
| A3 | **Google OAuth offered in UI, disabled in provider** | 🔴 Broken | `external.google=false`, 0 identities | **REMOVE from MVP** | Remove the button | Non-functional; not required. Revisit as a real feature. |
| A4 | Email confirmation required, registration ignores it | Broken UX | `mailer_autoconfirm=false` | **FIX** | Registration returns "verify your email"; no session until verified | Flow dead-ends at `/login` today |
| A5 | **Password reset throws on submit** | 🔴 Broken | `ROUTES.auth.callback` undefined | **FIX** | Full reset flow + set-password page | Never worked for any user |
| A6 | Password policy `min(8)` client-side only | Weak | schemas.ts | **FIX** | Server-enforced: ≥ 10 chars; reject common passwords | Client validation is bypassable |
| A7 | Role stored in `profiles.role`, looked up per request | Costly | `profiles_pkey` = 2,719 scans, hottest in DB | **REDESIGN** | `role` as a JWT claim | Removes the single hottest query in the system |
| A8 | No refresh-token revocation / logout-everywhere | Missing | | **FIX** | Rotating refresh tokens with a server-side store | |
| A9 | Storefront proxy uses `getSession()` not `getUser()` | Weaker | Phase 0 A2 | **REMOVE** | Moot — guard-based auth replaces the proxy | |
| A10 | No rate limiting on any auth endpoint | Missing | | **FIX** | Throttle login, register, reset, tracking | |
| A11 | Three separate client logout implementations, one escapes the basePath | Broken | Phase 0 §4.3 | **FIX** | One logout endpoint that revokes the refresh token | |
| A12 | `handle_new_user` trigger provisions the profile | Works | 4/4, 0 orphans | **REDESIGN** | Single `users` document created in the registration transaction | Trigger disappears with the 1:1 merge |
| A13 | `full_name` falls back to the email address | Works | | **FIX** | `fullName` is required at registration | Using an email as a display name is a data-quality bug, not a feature |

---

## 9. Authorization

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| Z1 | **4 `SECURITY DEFINER` RPCs granted to `anon`, no authz** | 🔴 Broken | F-CRIT-1 | **REMOVE** | No privileged path is reachable without authentication and authorization | The defining legacy failure; must never be reproduced |
| Z2 | Order ownership `auth.uid() = user_id` | Correct | `orders_own_read` | **PRESERVE** | `OwnershipGuard` / `findForUser` | RLS intent was right |
| Z3 | Role self-escalation blocked by `WITH CHECK (role='customer')` | Correct | | **PRESERVE** | `role` absent from every self-service DTO | |
| Z4 | `admin` ≡ `super_admin` everywhere | No separation | 0 `admin` users ever | **FIX** | `SUPER_ADMIN` alone may manage roles and delete users | The distinction was declared but never enforced |
| Z5 | Admin `/api/*` routes protected by matcher only | Weak | Phase 0 M6 | **FIX** | Guard on every handler; no reliance on path matching | |
| Z6 | **7 child tables `SELECT USING (true)`** — images/specs of hidden products readable | Leak | policies-analysis §4.3 | **FIX** | Child visibility inherits the parent's | Leaks unreleased products |
| Z7 | `recently_viewed` policy world-writable | Broken | policies-analysis §4.2 | **REMOVE** | Feature removed | |
| Z8 | **No INSERT policy on `profiles`** → customer profile save fails | Broken | policies-analysis §4.1 | **FIX** | `PATCH /users/me` | Disappears once browser DB access is removed |
| Z9 | Audit written with the caller's own credentials | Broken | Phase 0 M12 | **FIX** | Written by a system-privileged interceptor | An audited principal must not be able to suppress their audit |
| Z10 | Admin reads use the anon-key client; a dropped policy renders empty | Fragile | Phase 0 P4 | **REMOVE** | Moot — one service identity | |

---

## 10. Guest flows

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| G1 | Guest checkout | **Never existed** — `user_id` is NOT NULL, checkout requires login | schema + `checkout.actions.ts:43` | **REMOVE (confirm)** | Authenticated checkout only | Matches the stated requirement; COD fraud control needs an identity |
| G2 | **Guest order tracking** — browser reads full order by order number, phone checked in JS | 🔴 Dead + unsafe design | RLS returns 0 rows to anon | **REDESIGN** | `POST /orders/track` — server-side phone match, minimal projection, rate-limited, generic 404 | Feature intent is valid; implementation was both broken and unsafe |
| G3 | Client-side "rate limit" (in-memory, reset on reload) | Fake | `orderTrackingStore.ts:29` | **REMOVE** | Server-side throttling | |
| G4 | Order numbers sequential and globally incrementing | Enumerable | seq | **FIX** | Daily reset + tracking requires the phone + throttling | Reduces enumeration value |
| G5 | Guest cart in localStorage | Works | | **PRESERVE** | Client cart until login, then merged | Correct for a guest |

---

## 11. Admin operations

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| M1 | `requireAdmin()` → Zod → mutate → audit | Good pattern | 15 actions | **PRESERVE** | Guard → DTO → service → audit interceptor | Coherent; reproduce structurally |
| M2 | **Audit trail completely empty** (writes a non-existent `user_agent` column, error swallowed) | 🔴 Broken | 0 rows | **FIX** | Audit writes are validated and failures are logged loudly | Every admin action to date is unaudited |
| M3 | Dashboard aggregates in JS over 500 rows | Won't scale | Phase 0 P3 | **REDESIGN** | One aggregation pipeline endpoint | |
| M4 | 11 admin actions accept unvalidated string ids | Inconsistent | Phase 0 §10.4 | **FIX** | ObjectId/UUID validation on every id param | |
| M5 | `deleteProductImageAction` takes a caller-supplied `revalidatePath` | Unsafe | Phase 0 L4 | **REMOVE** | Cache invalidation is server-decided | |
| M6 | Raw database errors returned to clients (~20 sites) | Leak | Phase 0 M5 | **FIX** | Global exception filter; no driver text ever reaches a client | |
| M7 | Admin can edit stock through generic product update | Bypass | products PATCH | **FIX** | `stock` rejected by the product DTO; only `/inventory/adjust` may change it | Preserves the ledger invariant |
| M8 | Settings page stub | Not built | | **REMOVE from MVP** | | No requirement |
| M9 | Customer list rollups = 6 queries + JS | Inefficient | Phase 0 P5 | **FIX** | Maintained `user.stats` counters | |

---

## 12. Reviews

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| R1 | **Admin moderation exists; no submission or display** | Half-built | 0 reviews | **REDESIGN** | Complete the loop: submit → moderate → display → aggregate | PDP reviews are on the roadmap |
| R2 | Only approved reviews public | Correct | RLS | **PRESERVE** | | |
| R3 | Edit allowed only while `pending` | Correct | RLS | **PRESERVE** | | |
| R4 | One review per user per product | Unique index | | **PRESERVE** | | |
| R5 | `is_verified_purchase` column, never computed | Missing | | **FIX** | Derived from a `DELIVERED` order containing the product | |
| R6 | Rating aggregate never maintained | Missing | | **FIX** | Recomputed on every status change | Fixes K5 |
| R7 | Review images / helpfulness votes | Tables exist, 0 rows | | **DEFER** | Not in MVP | Not required for launch |

---

## 13. Media

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| E1 | Server-side upload validation (MIME, 5 MB, extension, filename) | Good | `validate-upload.ts` | **PRESERVE** | Port verbatim | Solid |
| E2 | Bucket-level MIME allow-list + size limit | Good | 4 buckets | **PRESERVE** | Enforced in `MediaModule` config | Second layer worth keeping |
| E3 | No magic-byte sniffing | Gap | | **FIX** | `file-type` check; never trust the declared MIME | |
| E4 | **Absolute URLs persisted into the document** | Fragile | 22 rows | **REDESIGN** | Store `publicId` + `version`; derive URLs at read time | Makes CDN migration a config change |
| E5 | Delete path derived by splitting the stored URL | Brittle | Phase 0 W2 | **FIX** | Delete by `publicId` | |
| E6 | **No width/height stored** | Missing | metadata has size+mimetype only | **FIX** | Capture dimensions at upload | Fixes layout shift |
| E7 | No transformations; full-size originals served to 96px thumbnails | Missing | | **FIX** | Named transformation presets | |
| E8 | `dangerouslyAllowSVG: true` in both apps | Risk | Phase 0 M3 | **REMOVE** | SVG rejected; flag removed | |
| E9 | Dead `StorageService` targets a bucket that does not exist | Dead | bucket `images` absent | **REMOVE** | | |
| E10 | 3 of 4 buckets have no DELETE policy | Gap | storage §S1 | **FIX** | Every asset type has a delete path | |
| E11 | 20 of 22 image rows are `placehold.co` | Content gap | | **REMOVE** | Placeholders are not migrated | Content task, not a migration task |

---

## 14. Audit & history

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| U1 | Order status history | Works | 8 rows | **PRESERVE** | Embedded, append-only — **business history** | |
| U2 | Inventory ledger | Works for sales | 7 rows | **PRESERVE + FIX** | Every mutation, with actor and opening balances | |
| U3 | Admin audit log | **Never recorded anything** | 0 rows | **FIX** | Interceptor-written, loud on failure — **security audit** | |
| U4 | Audit indexes on an empty table | Unused | | **PRESERVE** | Correct index design; the table was simply never written | |
| U5 | Audit everything | Not attempted | | **REMOVE (as a goal)** | Audit only privileged/security-relevant actions | Auditing reads would drown the signal |

---

## 15. Cross-cutting / infrastructure

| # | Behaviour | Current state | Evidence | Decision | New rule | Reason |
|---|---|---|---|---|---|---|
| X1 | Inconsistent response shapes (10+ variants) | Chaotic | Phase 0 §10.4 | **REDESIGN** | One envelope; RFC 7807-style errors | Required for a shared Flutter/Web contract |
| X2 | No API versioning | Missing | | **FIX** | `/api/v1` from day one | Flutter ships independently |
| X3 | No pagination convention | Missing | | **FIX** | One convention everywhere | |
| X4 | No correlation IDs | Missing | | **FIX** | `x-request-id` in, out and in every log line | |
| X5 | 3 uncalled Server Actions remain remotely invocable | Risk | Phase 0 M10 | **REMOVE** | | |
| X6 | No tests, no CI | Missing | | **FIX** | CI from Phase 2; tests gate each phase | |
| X7 | `pg_cron` reservation job | No-op | 35,309 runs | **REMOVE** | No scheduled job in MVP | |
| X8 | Realtime / Edge Functions / webhooks | Not used | Phase 0.5 §7 | **REMOVE** | Not reproduced | Confirmed unused |
| X9 | Contact form is a fake `setTimeout` | Fake | | **FIX** | Real endpoint → email | Advertised feature that does nothing |
| X10 | Dead nav links (`/cart`, `/compare`, `/vendors`, `/about`, `/faq`) | 404s | Phase 0 | **FIX** | Remove or build; no link may 404 | |

---

## 16. Decision summary

| Decision | Count | Character of the change |
|---|---|---|
| **PRESERVE** | 24 | Mostly correct *intent* — atomic checkout, server-side pricing, snapshots, soft delete, ownership rules, upload validation |
| **FIX** | 38 | Right idea, defective execution — the bulk of the work |
| **REMOVE** | 18 | Speculative or dangerous — variants, reservations, `create_order_v1`, in-app notifications, recently-viewed, refund workflow, OAuth-in-name-only |
| **REDESIGN** | 16 | Structurally unsuitable — status model, EAV, cart, money, search, media identity, response format |

**Read this way:** only 24 of 96 behaviours survive unchanged. The Phase 0.5 warning holds — **this is not a port.** The legacy system is a source of *requirements*, not of *implementation*.

The behaviours that survive are almost all **intentions the database expressed correctly** (atomicity, snapshots, ownership) rather than code that worked. The behaviours being removed are almost all **features provisioned but never built** — which is why removing them costs nothing.
