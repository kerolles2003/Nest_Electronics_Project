# Phase 1 Decision Register (ADRs) — Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30

Every significant architectural decision, with the options considered, the reasoning, the consequences accepted, and the conditions under which it should be revisited.

---

## ADR-MONEY-001 — Integer minor units for all monetary values

| | |
|---|---|
| **Decision** | All money is stored, transmitted and computed as int64 **EGP minor units (piastres)** with an explicit ISO-4217 currency code. Floats are forbidden in the money path. |
| **Context** | Legacy stored `numeric(10,2)` in PostgreSQL but every value crossed into JavaScript as an IEEE-754 double, where cart subtotals were summed in React components. The database's exactness was discarded at the boundary. |
| **Options** | (A) double — rejected, inexact · (B) `Decimal128` — rejected, no native JS decimal so a library is needed anyway and a careless `Number(x)` silently reintroduces error · (C) decimal string — rejected, not arithmetic-capable, breaks range queries and sorting · (D) **integer minor units** |
| **Chosen** | D |
| **Reason** | Exact by construction. Native to BSON, JSON, TypeScript and Dart. Sorts and range-queries correctly. `MAX_SAFE_INTEGER` gives ~90 trillion EGP of headroom against a largest live order of 3,400 EGP. |
| **Consequences** | Every developer must internalise "amounts are piastres" — mitigated by naming, a self-describing API shape and lint rules. Seed data must be written in minor units. |
| **Revisit** | A second currency (add `exponent`); a payment provider with a different convention |

---

## ADR-MONEY-002 — Single currency, with the code carried explicitly

**Decision:** EGP only; no FX, no conversion — but every money value carries `currency`.
**Reason:** Egypt-only market, COD in cash. Carrying the code costs one field and makes a future second currency additive rather than a migration; it also lets a cross-currency sum be *detected* rather than silently producing nonsense.
**Revisit:** international expansion.

---

## ADR-MONEY-003 — Prices are VAT-inclusive

**Decision:** No additive tax term. `grandTotal = itemsSubtotal − discountTotal + shippingFee`. `vatRateBps` is snapshotted per order for invoice derivation.
**Context:** legacy `orders.tax` existed and was **always 0**, while the PDP already told customers *"Price includes VAT"*.
**Consequences:** VAT is derivable but not additive. 🔶 Whether invoices must display a VAT breakdown remains a business input — non-blocking, because the rate is recorded per order.
**Revisit:** accounting or regulatory requirement for itemised VAT.

---

## ADR-CATALOG-001 — No product variants

| | |
|---|---|
| **Decision** | One product = one SKU = one stock number. The variant model is removed. |
| **Context** | `product_variants` had **0 rows**, no admin UI, no API, and no mention in any roadmap document. The legacy variant code path ignored `sale_price` and trusted a client-supplied `productId`. |
| **Options** | (A) keep variants "just in case" · (B) **remove** |
| **Reason** | Electronic components are not optioned goods — an ESP32-S3 is a different product from an ESP32-WROOM-32, not a size of it. Keeping variants means maintaining a second inventory axis, a `variantId` on every cart and order line, and two known bugs, for a feature nothing uses. |
| **Consequences** | A genuinely optioned product would need this reintroduced. The path is additive: an optional `variants[]` plus `variantId` on order lines. |
| **Revisit** | A real product with options at differing prices under one part identity |

---

## ADR-CATALOG-002 — EAV replaced by embedded `specs[]`

**Decision:** The 3-table EAV system becomes a flat embedded `specs[]` array plus a small `specDefinitions` dictionary.
**Context:** `attributes` 9 rows, `attribute_values` **0**, `product_attribute_values` **0**. Faceting was designed but never delivered because `search_products` could not perform the join.
**Reason:** Zero assigned values means zero migration cost and complete design freedom. A multikey index makes faceting a single-collection query.
**Consequences:** Spec values are strings; numeric range filtering needs an optional `numericValue` later (additive).

---

## ADR-CATALOG-003 — Localized `{en, ar?}` value objects, English-only content in MVP

**Decision:** User-facing catalogue text is `{en, ar?}`. MVP populates `en`; the API resolves to a flat string.
**Context:** all `*_ar` columns were **100% NULL across 85 products**, and the roadmap states *"Arabic (i18n) — planned post-MVP"*.
**Options:** (A) flat strings, add i18n later — rejected, requires rewriting every document, DTO and index · (B) full i18n framework — rejected, overengineering · (C) **`{en, ar?}` now, one locale in use**
**Consequences:** one nesting level; text indexes on `en` only until Arabic content exists.
**Revisit:** Arabic launch → add an Arabic analyzer and index.

---

## ADR-CATALOG-004 — Materialised category `path[]`

**Decision:** Categories carry `parentId` plus a materialised ancestor array.
**Reason:** MongoDB has no recursive CTE, and `$graphLookup` is too expensive for a tree rendered on every page. `path[]` turns subtree queries into one indexed `$in` — fixing the legacy defect where parent-category pages omitted every child category's products.
**Consequences:** reparenting rewrites the subtree; cycle detection required. Live tree is depth 2; max depth 3 is enforced.

---

## ADR-CATALOG-005 — Slug redirects are read

**Decision:** `slugRedirects` is consulted on product resolution and answered with HTTP 301.
**Context:** legacy wrote redirect rows that **nothing ever read**, so every product rename produced a permanent 404.

---

## ADR-ORDER-001 — One status axis plus a separate payment status

| | |
|---|---|
| **Decision** | Replace three independent status columns with one `status` lifecycle (7 values) plus `payment.status` (3 values). `fulfillment_status` is deleted. |
| **Context** | 7 × 6 × 5 = **210** legacy combinations with **no cross-field validation**. Live data already held `shipped + payment pending` (×2) and `delivered + unfulfilled` (×1). `fulfillment_status` largely duplicated `order_status`. |
| **Reason** | Fulfilment progress is one dimension. Payment is genuinely orthogonal under COD (cash is collected at the end), so it stays separate — but only as three values. |
| **Consequences** | Admin UI simplifies. Any legacy report keyed on `fulfillment_status` must be rewritten (none exist). |

---

## ADR-ORDER-002 — COD-native vocabulary; `DELIVERED` implies `PAID`

**Decision:** Statuses are `PLACED → CONFIRMED → SHIPPED → DELIVERED` with `DELIVERY_FAILED`, `CANCELLED`, `RETURNED`. `pending_payment` and `paid` (as order statuses) are removed. `→ DELIVERED` atomically sets `payment.status = PAID`.
**Context:** the legacy vocabulary described a **prepaid** flow. The MVP is COD-only. **This mismatch is the root cause of the dead reservation subsystem** — the cron job targeted `pending_payment`, which no order function ever produced.
**Reason:** under COD, delivery *is* the payment event. Modelling them separately permitted the incoherent "delivered but unpaid" state that legacy data actually contained.
**Revisit:** online payment integration reintroduces a genuine `AWAITING_PAYMENT` state.

---

## ADR-ORDER-003 — Transitions enforced by guarded atomic update

**Decision:** Every transition validates the matrix **and** applies a filtered update `{_id, status: <expectedFrom>}`. `matchedCount === 0` → `409`.
**Context:** legacy's matrix lived only in admin app code; the RPC validated nothing and was callable by `anon`. It *did* take a `FOR UPDATE` lock, but the check happened in a previous round trip, outside it.
**Reason:** the precondition must live inside the write, or it is not a precondition.

---

## ADR-ORDER-004 — No `PaymentsModule` in MVP

**Decision:** COD only. Payment is a field on the order, not a domain. No refund workflow — only a recorded outcome.
**Context:** `payment_provider_id` exists and is unused; Paymob is "not started"; the legacy 5-state refund lifecycle was never built and, with no provider, models nothing real.
**Revisit:** Paymob integration → introduce `PaymentsModule`, an `AWAITING_PAYMENT` status, webhook idempotency, and reconsider reservations.

---

## ADR-ORDER-005 — Order number resets daily

**Decision:** Per-day counter, atomic `$inc` inside the transaction.
**Context:** legacy used a **global** sequence, so a date-prefixed number leaked total order volume.

---

## ADR-ORDER-006 — Idempotency key required on order placement

**Decision:** `POST /orders` requires `Idempotency-Key`; a replay returns the original order.
**Context:** legacy had no idempotency; a double-click created two orders and decremented stock twice.

---

## ADR-INVENTORY-001 — No reservations (Model A)

| | |
|---|---|
| **Decision** | `available = stock.onHand`. Stock is committed at order placement. `reserved_quantity` is removed. |
| **Context** | The cron job ran **35,309 times, affecting 0 rows**; `reserved_quantity = 0` on all 85 products; **0** reservation ledger events; **0** orders ever in `pending_payment`. Nothing ever incremented the reserved field. |
| **Options** | (A) fix the reservation model · (B) **remove it** |
| **Reason** | A reservation holds stock during a **payment gap**. COD has no payment gap — the customer commits at checkout and cash arrives days later at the door. The design was inherited wholesale from a prepaid flow the MVP does not implement. Removing it also collapses a formula duplicated in 5 places. |
| **Consequences** | Simpler model, one fewer scheduled job. Reintroduction requires **also** adding the order status that makes the expiry query reachable — the step legacy omitted. |
| **Revisit** | Online payment integration; reserve-for-pickup |

---

## ADR-INVENTORY-002 — Stock lives in the product document but is written only by Inventory

**Decision:** `products.stock` is embedded (availability is read on every card and listing), but `InventoryModule` is its sole writer. The product update DTO **rejects** `stock`.
**Reason:** a deliberate exception to strict aggregate ownership, taken for read performance. Legacy allowed any `UPDATE products SET stock_quantity`, which bypassed the ledger entirely.
**Consequences:** the boundary is enforced by the DTO and by module discipline, not by the database. Covered by a test.

---

## ADR-INVENTORY-003 — Current value plus an immutable ledger, with opening balances

**Decision:** Keep both. Every product is created with an `OPENING_BALANCE` event; every event records `balanceBefore`/`balanceAfter`.
**Context:** legacy's ledger was decorative — 4 of 85 products had any events, none reconciled, and no opening balances existed.
**Reason:** makes `Σ events == onHand` an assertable invariant for the first time, and makes each entry self-verifying.

---

## ADR-CART-001 — Server cart authoritative for authenticated users; localStorage for guests

**Decision:** No server-side guest carts.
**Context:** legacy's DB cart was **write-only** (`getCart()` had 0 call sites) and could not compute a subtotal (no price column).
**Reason:** cross-device continuity requires a server cart for account holders; creating documents for anonymous visitors is unjustified storage and an abuse vector — especially as guests cannot check out.

---

## ADR-CART-002 — Merge strategy is `max`, then clamp

**Decision:** `max(guestQty, serverQty)`, clamped to available stock.
**Context:** legacy had **two contradictory implementations** — `Math.max` in the store, `existing + incoming` in the provider — and the path was never exercised (0 guest carts).
**Reason:** matches the documented intent; `sum` surprises a user who added the same item on two devices; `max` is idempotent.

---

## ADR-CART-003 — Cart snapshots are display-only

**Decision:** Persist `{productId, quantity}`; a snapshot is refreshed on every read and never trusted for money.
**Reason:** legacy stored *no* price and could not display a subtotal; the naive fix (store a price) creates a second, stale price authority. Refresh-on-read gives display performance without a second source of truth.

---

## ADR-AUTH-001 — Email/password owned by NestJS; no third-party IdP in MVP

**Decision:** `AuthModule` owns credentials. The client never calls an identity provider.
**Reason:** removes the last direct client→backend-service path. Google OAuth was advertised in the UI but **disabled in the provider**, with 0 identities ever created — it is unbuilt work, not a migration.

---

## ADR-AUTH-002 — JWT access (15 min) + rotating opaque refresh (30 d), stored in MongoDB

**Decision:** Refresh tokens are hashed in a TTL-indexed collection, not Redis.
**Reason:** revocation and logout-everywhere require a durable store; refresh tokens are low-volume and must survive a restart. Supersedes the Phase 0 Redis-denylist recommendation.

---

## ADR-AUTH-003 — `role` as a JWT claim, with a `tokenVersion` escape hatch

**Decision:** Role travels in the token. `tokenVersion` invalidates issued tokens immediately when needed.
**Context:** legacy looked up `profiles.role` on **every request** — `profiles_pkey` was the hottest index in the entire database (2,719 scans).
**Consequences:** a role change takes effect within 15 minutes, or immediately via `tokenVersion` for security-critical changes.

---

## ADR-AUTH-004 — Three roles, no permission system

**Decision:** `CUSTOMER`, `ADMIN`, `SUPER_ADMIN`. No CASL, no permission collection.
**Context:** 4 live users; **no `ADMIN`-role user has ever existed**; the store is small and single-tenant.
**Options:** (A) CASL/permissions as Phase 0 proposed — rejected as overengineering · (B) **roles only**
**Consequences:** a genuine staff-role split later requires a migration — additive, since `@Roles()` can become `@RequirePermission()` with roles as bundles.
**Revisit:** staff responsibilities genuinely diverge (content editor vs fulfilment operator).

---

## ADR-AUTH-005 — Google OAuth removed from v1

**Decision:** Remove the button and the code path.
**Reason:** the provider is disabled; the button is non-functional; there are zero Google identities. It is new work, not a port, and should be scheduled as a real feature with tests.

---

## ADR-AUTH-006 — Guest checkout removed; guest tracking kept and redesigned

| | |
|---|---|
| **Decision** | Checkout requires an account. Order tracking by order number + phone remains, redesigned securely. |
| **Context** | Guest checkout **never existed** — `orders.user_id` is NOT NULL, checkout required auth, and the roadmap listed `/checkout` as protected. Guest *tracking* existed but was both broken (RLS returned 0 rows to anon) and unsafely designed (full order fetched, phone compared in the browser). |
| **Reason** | COD ships real goods on trust; a verified account is the primary fraud lever, and order history is core value for repeat-buying makers. Tracking is retained because COD parcels are often received by someone else, and the secure design is cheap. |
| **Consequences** | Registration friction at purchase — mitigated by a 3-field signup and cart merge. |
| **Revisit** | Measured checkout abandonment at the auth step → build guest checkout deliberately (OTP-verified identity + claim flow), **never** by making `userId` nullable. |

---

## ADR-DISCOUNT-001 — Coupons redesigned and completed

**Decision:** Build customer-facing validation and redemption. One coupon per order, no stacking.
**Context:** full admin CRUD existed with **zero** customer-facing code, no public read policy, no discount term in the total, 0 coupons, and **two contradictory Zod schemas**.
**Reason:** an explicit roadmap item with a sound written specification that was simply never implemented.

---

## ADR-DISCOUNT-002 — Percentages as basis points; `value` discriminated by `type`

**Decision:** `PERCENTAGE` → bps; `FIXED` → minor units.
**Context:** one legacy `numeric` column meant "15" for both 15% and 15.00 EGP.

---

## ADR-DISCOUNT-003 — Coupon snapshotted onto the order

**Decision:** Embed `{couponId, code, type, value, discountApplied}`.
**Reason:** a live reference would let a later coupon edit silently rewrite what a past order appears to have paid.

---

## ADR-SEARCH-001 — MongoDB `$text`, not Atlas Search

**Decision:** Native `$text` + `$facet`. Engine isolated behind `SearchService`.
**Context:** 85 products. Legacy's GIN index had **0 scans** because `ILIKE` OR-branches forced a sequential scan.
**Options:** regex (rejected — reproduces the legacy failure) · **`$text`** · Atlas Search (deferred — binds to Atlas, cannot run locally in CI) · Elasticsearch (rejected — a cluster for 85 products)
**Revisit:** > 20k products · fuzzy matching required · autocomplete latency · **Arabic launch** (needs a proper analyzer).

---

## ADR-SEARCH-002 — Maintained `pricing.effectivePrice`

**Decision:** Store the resolved price as a field.
**Reason:** `$expr` with `$ifNull` cannot use an index, forcing a collection scan on the hottest query. Redundancy is accepted for an indexable, sortable price; the invariant is asserted in tests.

---

## ADR-MEDIA-001 — Uploads flow through NestJS, not signed direct upload

**Decision:** `Client → NestJS → Cloudinary`.
**Reason:** the server must see every byte to guarantee magic-byte validation, EXIF stripping and dimension capture. Signed direct upload forces the client to *report* metadata — the exact anti-pattern being removed. Files are ≤ 5 MB and admin-only, so the bandwidth cost is negligible.
**Revisit:** customer review images at volume, or video.

---

## ADR-MEDIA-002 — Store `publicId` + `version`, never a URL

**Decision:** URLs are derived at read time.
**Context:** legacy persisted absolute Supabase URLs and **derived the delete path by string-splitting them**. The project reference was baked into 22 rows and into `next.config.ts`.

---

## ADR-MEDIA-003 — SVG rejected; `dangerouslyAllowSVG` removed

**Reason:** SVG is executable markup; served from a whitelisted image host it is a stored-XSS vector.

---

## ADR-MEDIA-004 — Reference-counted asset deletion

**Reason:** legacy product duplication copied URL strings, so two products shared one object and deleting from either broke the other.

---

## ADR-DB-001 — MongoDB `ObjectId` as `_id`

**Decision:** Do not preserve legacy UUIDs.
**Context:** Phase 0 recommended keeping UUIDs to avoid an id map. Phase 0.5 established there is **no production data** — so there is nothing to preserve. Superseded.

---

## ADR-DB-002 — Embed bounded child data; reference + snapshot for hot display fields

**Decision:** Embed addresses, images, specs, cart items, order items, status history. Reference categories/brands with a denormalised name snapshot.
**Reason:** the four legacy relationships now embedded — `product_images`, `order_items`, `order_status_history`, `addresses` — were **exactly the four foreign keys with no index**, serving 51,128 sequential scans on `product_images` alone. Embedding removes both the join and the missing index.

---

## ADR-DB-003 — `strict: 'throw'` on every schema

**Reason:** an unknown field raises rather than being silently dropped — the structural fix for the legacy type-drift class (`updated_at` written to tables without the column; `user_agent` written to `admin_audit_logs`, silently producing **0 audit rows**).

---

## ADR-DB-004 — Uniform timestamps

**Reason:** legacy had `updated_at` on only **5 of 28** tables and wrote it to two that lacked it.

---

## ADR-CONSISTENCY-001 — Replica set is mandatory

**Decision:** MongoDB must run as a replica set in **every** environment including local and CI. Verified in Phase 2 by a rollback test.
**Reason:** order placement mutates three collections atomically; a standalone `mongod` cannot start a transaction. PostgreSQL gave this for free via plpgsql atomicity — it must be deliberately reconstructed.
**Consequences:** Atlas M10+ or a 3-node self-hosted set. **Phase 2 stops if transactions do not work everywhere** — discovering this at Phase 6 would be extremely expensive.

---

## ADR-CONSISTENCY-002 — Preconditions live inside update filters

**Decision:** Stock guards, coupon limits and status transitions embed their precondition in the query predicate; never read-then-write.
**Reason:** ports the one concurrency primitive legacy got right (`WHERE stock_quantity >= quantity`) and fixes the one it got wrong (matrix check in a prior round trip).

---

## ADR-MODULE-001 — No `AdminModule`

**Decision:** Admin controllers live inside each domain module behind `@Roles()`.
**Reason:** admin is a role, not a domain. A monolithic admin module would duplicate every service and become a dependency hub.

---

## ADR-MODULE-002 — `PricingModule` and `FulfilmentModule` are first-class

**Decision:** Promote both out of Orders.
**Reason:** legacy scattered pricing across a database function, four frontend components and a dead service — the single largest source of duplication in the audit. One module with one entry point is the structural fix. Shipping policy changes on a different cadence than order logic.

---

## ADR-API-001 — `/api/v1` URI versioning

**Reason:** a Flutter client ships independently and older versions stay installed on real devices. URI versioning is visible in logs, curl and base URLs. Legacy had **no versioning at all**.

---

## ADR-API-002 — One response envelope

**Decision:** `{data, meta?}` / `{error}`.
**Context:** legacy returned at least **ten** different shapes — unusable for a generated client.

---

## ADR-API-003 — Custom error envelope, not RFC 7807

**Decision:** `{error: {code, message, details?, requestId, timestamp}}`.
**Reason:** symmetric with the success envelope; cleaner generated Dart/TS models; no `type` URI hosting obligation. Consistency beats standards compliance for a two-client private API.

---

## ADR-AUDIT-001 — Business history and security audit are separate mechanisms

**Reason:** legacy conflated them; the embedded business history worked while the audit log silently produced **0 rows** for the system's entire lifetime.

---

## ADR-AUDIT-002 — Audit written by a system-privileged interceptor; failures are loud

**Reason:** legacy wrote audit rows with the caller's own credentials (an audited principal could suppress their trail) and swallowed failures, so an empty table read as "no activity".

---

## ADR-REDIS-001 — Redis deferred

**Decision:** Not required in Phase 2. In-memory throttler and cache; MongoDB TTL for tokens and idempotency keys.
**Context:** ~200 rows total; reservations removed; refresh tokens need durability.
**Reason:** every candidate need is met more simply. Supersedes Phase 0's recommendation to adopt at Phase 6.
**Revisit — primary trigger:** **more than one API instance.** In-memory rate-limit counters become per-instance, silently multiplying every limit by N. This is a correctness failure in a security control.

---

## ADR-OBS-001 — Minimal observability, correlation-first

**Decision:** pino + `X-Request-Id` + Sentry + Terminus + a small Prometheus set. No tracing, no APM, no log cluster.
**Reason:** the three defects that hid longest in legacy (empty audit log, tracking-number failure, no-op cron) were invisible because nothing was watching — not because tooling was insufficient. Correlation and a handful of specific alerts address them directly.

---

## Open decisions

Recorded rather than hidden. **None blocks Phase 2.**

| ID | Question | Blocks | Default until answered |
|---|---|---|---|
| **OPEN-001** | Shipping rate table — EGP per governorate, free-shipping threshold | Phase 6 pricing | Flat rate, configurable in `shippingRates`; mechanism is specified |
| **OPEN-002** | Must invoices display a VAT breakdown, and at what rate? | Nothing | VAT-inclusive; `vatRateBps = 1400` snapshotted per order |
| **OPEN-003** | Is the blog launching, or is `ContentModule` deferred? | Content scope only | Build last; it is fully independent |
| **OPEN-004** | Transactional email provider (Resend / SES / SMTP) | Phase 4 (verification email) | Provider-agnostic interface in `NotificationsModule` |
| **OPEN-005** | Carrier list and tracking-URL templates | Phase 6 | Free-text carrier + optional URL template |
| **OPEN-006** | Will production run more than one API instance? | **Redis decision** | Single instance assumed — **must be verified before launch** |
| **OPEN-007** | Should reviews require a verified purchase, or merely flag it? | Phase 7 | Anyone may review; `isVerifiedPurchase` is computed and displayed |
| **OPEN-008** | Wishlist server-side persistence | Post-MVP | Client-side localStorage |

---

## Decisions explicitly superseding Phase 0 recommendations

Phase 0 was written without live database access. Five of its recommendations are overturned by Phase 0.5 evidence — recorded here so the change is traceable rather than accidental.

| Phase 0 recommendation | Superseded by | Reason |
|---|---|---|
| Keep legacy UUIDs as `_id` | **ADR-DB-001** | No production data exists to preserve |
| Adopt Redis at Phase 6 (rate limit, cache, token denylist) | **ADR-REDIS-001** | ~200 rows; refresh tokens need durability; reservations removed |
| CASL policy guards | **ADR-AUTH-004** | 4 users, 3 actor classes; overengineering |
| RFC 7807 error format | **ADR-API-003** | Envelope symmetry and cleaner generated clients |
| Port the reservation lifecycle | **ADR-INVENTORY-001** | Structurally dead; COD has no payment gap |
