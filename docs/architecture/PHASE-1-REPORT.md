# PHASE 1 — ARCHITECTURE FREEZE REPORT

**Project:** Nest Electronics · **Date:** 2026-08-30 · **Status:** ✅ **COMPLETE — awaiting architecture review**

| | |
|---|---|
| **Inputs** | Phase 0 repository audit · Phase 0.5 live forensic extraction · `PRODUCT.md` · `.project_plan/` |
| **Output** | 23 architecture documents defining the new system |
| **Scope** | ANALYZE → DECIDE → MODEL → SPECIFY → **FREEZE** |
| **Not done** | No NestJS project, no modules, no controllers, no schemas, no dependencies installed, no data migrated, no Supabase change, no Next.js change, no bug fixed |
| **Context** | Development-stage application · synthetic data · **no production users** · Supabase is now a *legacy reference*, not a contract |

---

## 1. Domains identified

**11 core + 3 supporting domains**, derived from business responsibility rather than from the 28 legacy tables.

| # | Domain | Owns |
|---|---|---|
| D1 | **Identity & Access** | Credentials, tokens, roles |
| D2 | **Users** | Profile, address book |
| D3 | **Catalog** | Products, categories, brands, slugs |
| D4 | **Inventory** | Stock authority + immutable ledger |
| D5 | **Cart** | Draft purchase intent |
| D6 | **Orders** | The transactional core and its lifecycle |
| D7 | **Pricing & Discounts** | The **only** place money is computed |
| D8 | **Fulfilment** | Shipping cost, shipment record |
| D9 | **Reviews** | Feedback + the rating aggregate |
| D10 | **Content** | Blog |
| D11 | **Media** | Cloudinary assets |
| S1–S3 | **Audit · Notifications · Search** | Cross-cutting (two sinks + one read model) |

**Rejected as domains:** Variants, Wishlist, In-app Notifications, Recently Viewed, Comparison, Compatibility, Tags, Payments, EAV Attributes, and — deliberately — **Admin**, which is a role, not a domain.

---

## 2. Legacy behaviours PRESERVED (24)

The survivors are almost entirely *intentions the database expressed correctly*, not code that worked.

| Area | Preserved |
|---|---|
| **Checkout** | Server-side pricing (client prices discarded) · `salePrice ?? basePrice` · **all-or-nothing atomicity** · the conditional `stock >= qty` guard · immutable order-line snapshots · authenticated checkout |
| **Orders** | Append-only status history · orders are never deleted |
| **Inventory** | Ledger concept · signed-delta adjustment with a zero floor and a mandatory reason · per-product `lowStockThreshold` |
| **Catalog** | Soft delete · `isActive` publication · slug/SKU uniqueness · ≤ 8 images with one primary |
| **Authorization** | Order/address/cart ownership rules · `role` not self-settable · approved-only public reviews · edit-only-while-pending · coupons never publicly listable |
| **Media** | `validate-upload.ts` logic · bucket MIME/size limits · `<entityId>/` path convention |
| **Auth** | bcrypt · email verification required |

**The single most important preservation:** insufficient stock aborts the entire order, atomically. PostgreSQL gave this for free; MongoDB requires a replica set and an explicit transaction to reproduce it.

---

## 3. Legacy behaviours FIXED (38)

Right intent, defective implementation. The bulk of the work.

| Severity | Fixed |
|---|---|
| 🔴 **Critical** | Four `SECURITY DEFINER` RPCs callable by `anon` with no authorization · `p_user_id` never checked against the caller · no `quantity > 0` validation (negative quantity *increased* stock and reduced the total) · tracking number broke the entire ship operation · `create_order_v1` let an unauthenticated caller dictate prices |
| 🟠 **High** | No transition validation in the backend · **cancellation never restored stock** · no `isActive`/`deletedAt` check at checkout · audit log recorded **nothing, ever** · password reset threw on submit · sort parameter did not exist · pagination totals wrong by construction · category pages omitted child products · listings had no images/brand/rating · ratings permanently rendered 0 |
| 🟡 **Medium** | TOCTOU on status transitions · forgeable `changed_by` and `p_admin_id` · global order-number counter · no idempotency · four-way duplicated quantity constant · contradictory cart merge strategies · client-only stock caps · N+1 image reorder · non-atomic primary-image flip · duplication sharing storage objects · `updated_at` written to tables lacking the column · raw driver errors returned to clients · no rate limiting anywhere · registration UX dead-end · `fullName` defaulting to the email address |

---

## 4. Legacy behaviours REMOVED (18)

Speculative, dangerous, or provisioned-but-never-built — which is why removal costs nothing.

| Removed | Live evidence |
|---|---|
| **Product variants** | 0 rows, no UI, no roadmap entry, 2 known bugs |
| **Inventory reservations + the cron job** | 35,309 no-op runs; `reserved_quantity = 0` on all 85 products |
| **`create_order_v1`** | Orphaned, unauthenticated, client-priced |
| **`fulfillment_status` axis** | Duplicated `order_status` |
| **In-app notifications** | 0 rows; UI rendered mock data |
| **Recently viewed** | 0 rows; RLS policy was world-writable |
| **Product tags / compatibility / comparison** | 0 rows, unspecified |
| **5-state refund workflow** | Never built; models a payment provider that does not exist |
| **Google OAuth** | Provider disabled; 0 identities ever |
| **Wishlist server persistence** | 0 rows; two disconnected half-implementations |
| **`dangerouslyAllowSVG`** | Stored-XSS vector |
| **Dead `StorageService`** | Targets a bucket that does not exist |
| **Client-side "rate limit"** | In-memory, reset by page reload |
| **Realtime / Edge Functions / webhooks** | Confirmed unused |

---

## 5. Legacy behaviours REDESIGNED (16)

| # | Redesign | Why the old model was unsuitable |
|---|---|---|
| 1 | **Three status columns → one lifecycle + payment status** | 210 unvalidated combinations; live data already incoherent |
| 2 | **Prepaid vocabulary → COD-native lifecycle** | The mismatch that made the reservation cron permanently unreachable |
| 3 | **`numeric` → integer minor units** | Exactness was lost the moment a value entered JavaScript |
| 4 | **EAV (3 tables) → embedded `specs[]`** | A join `search_products` could not perform; 0 assignments |
| 5 | **Cart → server-authoritative, re-priced on read** | The stored cart could not compute a subtotal at all |
| 6 | **Search → `$text` + `$facet`** | The GIN index was unusable by the only query that would use it |
| 7 | **Media → `publicId`, not URLs** | Deletion worked by string-splitting a URL |
| 8 | **Coupons → complete the loop** | Admin CRUD with zero customer-facing code |
| 9 | **Guest tracking → server-side, minimal projection** | Full order fetched to the browser before the phone was checked |
| 10 | **Category tree → materialised `path[]`** | No recursive CTE; queried on every page render |
| 11 | **Response shapes → one envelope** | At least ten different shapes |
| 12 | **`{en, ar?}` localized text** | 100% NULL Arabic columns; Arabic is on the roadmap |
| 13 | **Auth → server-side, role in JWT** | Browser-side identity calls; hottest query in the database |
| 14 | **Audit → interceptor-written, loud on failure** | Silent swallow produced 0 rows |
| 15 | **Ledger → opening balances + before/after** | Reconciliation was impossible |
| 16 | **VAT-inclusive pricing** | `tax` column always 0 while the PDP claimed VAT was included |

---

## 6. Core business rules

**99 rules** in [`BUSINESS-RULES.md`](./BUSINESS-RULES.md) — 17 preserved, 38 fixed, 32 new, 12 redesigned. All enforced **server-side**; the nine frontend-only rules Phase 0 catalogued are relocated to the service layer.

The ten that matter most:

1. Quantity is an integer, 1–99 — *validated in the DTO and re-asserted before the stock update*
2. Prices are always server-resolved; no DTO accepts a price
3. Only `isActive && !deletedAt` products may be ordered
4. Insufficient stock aborts the **entire** order
5. `userId` always comes from the token; ownership is a query filter
6. Every stock mutation writes a ledger event **in the same transaction**
7. `Σ inventoryEvents == stock.onHand` — an assertable invariant
8. Status transitions follow a server-owned matrix, applied by guarded atomic update
9. Cancellation and return **restore stock**, idempotently
10. `grandTotal = itemsSubtotal − discountTotal + shippingFee`, clamped to ≥ 0

---

## 7. Money model

| | |
|---|---|
| Representation | **int64 EGP minor units (piastres)** + ISO code |
| Currency | **Single (EGP)**, code carried explicitly |
| Percentages | **Basis points** (integer) |
| Rounding | **HALF_UP, exactly once per order**, on percentage discounts only |
| Tax | **VAT-inclusive** — no additive term; `vatRateBps` snapshotted |
| Formula | `itemsSubtotal − discountTotal + shippingFee` |
| Negative totals | Impossible — discount clamped to `[0, itemsSubtotal]` |
| Client arithmetic | **Forbidden.** All totals server-computed. |
| Historical orders | **Immutable.** Never recomputed. |

---

## 8. Product model

**No variants** (0 rows, never in scope, 2 known bugs). One product = one SKU = one stock number.

`ObjectId` `_id`; unique `sku` + `slug`; **slug redirects are read → 301**; localized `{en, ar?}`; category/brand **reference + snapshot**; embedded `images[]` (`publicId`, dimensions captured); **EAV → embedded `specs[]`**; maintained `pricing.effectivePrice`; `rating` written only by Reviews; `stock` written only by Inventory; soft delete re-validated at checkout; explicit order-snapshot contract.

---

## 9. Order lifecycle

```
PLACED → CONFIRMED → SHIPPED → DELIVERED (payment: PAID, atomically)
   ↓         ↓          ↓
CANCELLED CANCELLED  DELIVERY_FAILED ⇄ SHIPPED
(stock ⟲) (stock ⟲)        ↓
                        RETURNED (stock ⟲)
```

7 statuses on one axis + `payment.status` (`PENDING | PAID | REFUNDED`). Transitions enforced by matrix **and** guarded atomic update. Customer may cancel while `PLACED`/`CONFIRMED`. Shipping **requires** carrier + tracking number (`orders.shipment` — the column that did not exist). Order number resets daily. Orders are immutable and undeletable.

---

## 10. Inventory model

**Model A — available stock only. No reservations.** `available = stock.onHand`.

Current value **+ immutable ledger**, with an `OPENING_BALANCE` per product and `balanceBefore`/`balanceAfter` on every event, making `Σ events == onHand` assertable for the first time. Stock lives in the product document but is written **only** by `InventoryModule` (the product DTO rejects `stock`). Overselling is prevented by a conditional `$gte` update — the one concurrency primitive legacy got right.

---

## 11. Authentication model

Email + password owned by NestJS. bcrypt cost 12; server-side policy ≥ 10 chars. Email verification required, and registration now *says so*. JWT access **15 min** + rotating opaque refresh **30 days**, stored hashed in MongoDB with a TTL (not Redis — durability is required). **`role` is a JWT claim** with a `tokenVersion` escape hatch, removing the hottest query in the legacy database. Working password reset that revokes all sessions. Cookies for web, bearer for Flutter. **Google OAuth removed** from v1.

---

## 12. Authorization model

**One pipeline, no privileged bypass:**
`JwtAuthGuard → RolesGuard → OwnershipGuard → ValidationPipe → Service → Repository`

Three roles (`CUSTOMER`, `ADMIN`, `SUPER_ADMIN`) — no permission system (4 users, 3 actor classes; CASL rejected as overengineering). **Real `SUPER_ADMIN` separation** for role management, user deletion and hard deletes — a distinction legacy declared in three places and enforced in none. `userId` always from the token; ownership is a **query filter**; foreign resources return **404**, never 403. Auth is **global by default**, `@Public()` opts out. `forbidNonWhitelisted` structurally rejects `role`/`stock`/`userId`/`price` injection. All 28 `is_admin()`-backed RLS policies are translated with a Phase 2 traceability matrix.

---

## 13. Guest checkout decision

> **REMOVE guest checkout. KEEP guest order tracking, fully redesigned.**

Guest checkout **never existed** (`user_id` NOT NULL, checkout auth-gated, roadmap-documented) — this formalises the requirement. COD ships real goods on trust, so a verified account is the primary fraud lever, and order history is core value for repeat-buying makers.

Tracking is kept because COD parcels are frequently received by someone else. Redesigned: order number **+ phone both in the query filter**, generic 404, **10/hour/IP server-side**, and a **minimal projection** — status, timestamps, item *count*, carrier. **No PII, no items, no money, no tracking number.** Roughly 5% of the surface legacy would have exposed.

---

## 14. MongoDB design summary

**28 tables → 12 collections + 7 supporting.**

`users` (⊂ addresses) · `products` (⊂ images, specs) · `categories` (`path[]`) · `brands` · `carts` (⊂ items) · `orders` (⊂ items, statusHistory, shipment, snapshots) · `inventoryEvents` · `coupons` · `couponRedemptions` · `reviews` · `blogPosts` · `auditLogs`.
Supporting: `slugRedirects`, `specDefinitions`, `shippingRates`, `refreshTokens`, `mediaAssets`, `orderCounters`, `idempotencyKeys`.

**The four explicit relationship decisions:** order items → **snapshot, embedded** · product images → **embedded** · addresses → **embedded in user** · order history → **embedded**.

Notably, those four embeddings correspond exactly to the four legacy foreign keys **with no index**, which together served 51,000+ sequential scans. Embedding fixes a real performance defect rather than relocating it.

`strict: 'throw'` on every schema — the structural fix for the type-drift class of bug that silently produced an empty audit log.

---

## 15. Transaction requirements

> **MongoDB must run as a REPLICA SET in every environment, including local development and CI.**

| Transaction required | Order placement · cancellation/return · stock adjustment |
|---|---|
| Recommended | Review moderation + rating aggregate |
| Not required | Status transitions without stock effects, cart, product CRUD, registration |

Concurrency is handled by **preconditions inside update filters**, never read-then-write. Idempotency: `Idempotency-Key` on orders; unique indexes on ledger restoration and coupon redemption. Eventual consistency is accepted **only** for derived display data — never for money, stock, order state or authorization.

**Phase 2 gate:** a transaction-rollback test must pass in every environment before work proceeds.

---

## 16. NestJS module map

**15 modules**, acyclic, 4 layers + 2 sinks.

```
CommonModule (@Global)
Layer 1: AuthModule → UsersModule
Layer 2: CatalogModule ← SearchModule, MediaModule
Layer 3: CartModule · InventoryModule · PricingModule · FulfilmentModule
Layer 4: OrdersModule (composition root — 6 dependencies, 0 dependents)
Sinks:   AuditModule · NotificationsModule  (called by all, call none)
Other:   ContentModule · HealthModule
```

**No `AdminModule`** — admin controllers live inside each domain behind `@Roles()`. `PricingModule` and `FulfilmentModule` are promoted to first-class, because pricing scattered across five layers was the single largest source of duplication in the audit.

---

## 17. API contract summary

`/api/v1`, URI-versioned, additive-only within v1. One envelope `{data, meta?}` / `{error}`. ISO 8601 UTC dates, ObjectId hex ids, money as `{amount, currency, formatted}`. Offset pagination with **true totals**. JWT — cookies for web, bearer for Flutter. Auth global by default. Stable machine-readable `error.code`; **no driver text ever crosses the boundary**. OpenAPI generated from the same decorators that perform runtime validation, so documentation cannot drift from behaviour. TypeScript and Dart clients generated from it.

---

## 18. Cloudinary architecture

`Client → NestJS → Cloudinary` (not signed direct upload — the server must see every byte). Store **`publicId` + `version`, never a URL**. Capture width/height at upload (first time this exists). Magic-byte sniffing, EXIF stripping, **SVG rejected**. `nest/<entity>/<entityId>/` folders with `nanoid`. Named transformation presets (`t_thumb`, `t_card`, `t_detail`). **Reference-counted deletion.** Orphan reconciliation **reports**, never auto-deletes.

**There is NO media migration** — the system starts with a fresh database and an empty media store (Architecture Freeze Ratification, C1). Phase 0 risk R5 is **void**. A *future* provider replacement, after real assets accumulate, is a separate concern and remains documented in [`REPLACEMENT-TESTS.md`](./REPLACEMENT-TESTS.md) §2.

---

## 19. Redis decision

> **NOT required in Phase 2.** Deferred with explicit triggers.

Rate limiting → `@nestjs/throttler` in-memory (correct for one instance). Caching → in-process TTL for 27 categories and 17 brands. Refresh tokens and idempotency keys → **MongoDB with TTL** (durability required). Queues → no background work exists. Reservation TTLs → **not applicable, reservations removed**.

**Primary trigger: more than one API instance.** In-memory counters become per-instance, silently multiplying every rate limit by N — a correctness failure in a security control. This is `OPEN-006` and **must be verified before launch**.

---

## 20. Critical decisions

The eight that most shape the system:

| # | Decision | Consequence |
|---|---|---|
| 1 | **Integer minor units** | Rounding bugs structurally impossible outside one discount step |
| 2 | **No variants** | Removes a dead axis and two bugs |
| 3 | **No reservations** | Removes a subsystem with 35,309 no-op runs; correct for COD |
| 4 | **One status axis + payment status** | 210 combinations → 7 |
| 5 | **Guest checkout removed, tracking redesigned** | Fraud control + a genuinely safe public endpoint |
| 6 | **Three roles, no permissions** | Avoids overengineering for 4 users |
| 7 | **Redis deferred** | One less service; explicit trigger recorded |
| 8 | **Replica set mandatory** | Hard infrastructure requirement, verified in Phase 2 |

Five Phase 0 recommendations are **superseded** by Phase 0.5 evidence — legacy UUIDs, Redis at Phase 6, CASL, RFC 7807, and porting the reservation lifecycle. Each is recorded in [`PHASE-1-DECISIONS.md`](./PHASE-1-DECISIONS.md).

---

## 21. Open decisions / blockers

**No technical blockers. No open decision prevents Phase 2 from starting.**

| ID | Question | Blocks | Default |
|---|---|---|---|
| OPEN-001 | Shipping rates per governorate | Phase 6 | Flat rate; mechanism specified |
| OPEN-002 | VAT breakdown on invoices | Nothing | VAT-inclusive, 1400 bps snapshotted |
| OPEN-003 | Blog launching? | Content scope | Build last; independent |
| OPEN-004 | Email provider | Phase 4 | Provider-agnostic interface |
| OPEN-005 | Carrier list | Phase 6 | Free text + URL template |
| **OPEN-006** | **More than one API instance?** | **Redis** | **Single instance — verify before launch** |
| OPEN-007 | Reviews: require verified purchase? | Phase 7 | Anyone reviews; flag computed |
| OPEN-008 | Wishlist server persistence | Post-MVP | Client-side |

### Carried from Phase 0.5 — outside this phase, still outstanding

| Item | Status |
|---|---|
| 🔴 **Four `SECURITY DEFINER` RPCs callable by `anon`** | **Still live in the Supabase project.** Not a migration task. Should be remediated in parallel. |
| 🔴 **Credential rotation** (Anthropic key in git history, DB password, service-role key) | Still outstanding. The Supabase PAT is already revoked — evidence that exposure here has had consequences. |

---

## 22. Phase 2 implementation prerequisites

**Must be true before Phase 2 starts:**

1. ✅ This freeze is reviewed and approved
2. ⬜ **MongoDB replica set available** in local, CI and staging — the single hardest infrastructure prerequisite
3. ⬜ Cloudinary account provisioned (credentials server-side only)
4. ⬜ `OPEN-006` answered — instance count determines whether Redis enters Phase 2
5. ⬜ Hosting target chosen for the containerised API

**Phase 2 deliverables:**

- `apps/api` in the existing Turborepo
- `CommonModule`: config validation (fail-fast — the legacy `env.ts` implemented this and **was never imported**), pino + requestId, global pipes/filters/interceptors, throttler
- Swagger at `/api/v1/docs`; Terminus health with a **replica-set assertion**
- Dockerfile
- **CI pipeline — the project's first**: lint → type-check (**all** workspaces; `apps/storefront` currently has no `type-check` script) → test → build
- **Transaction-rollback test proving atomicity in every environment** ← the gate

**Recommended order:** Phase 2 foundation → Phase 3 MongoDB schemas + indexes + seed with `OPENING_BALANCE` events → Phase 4 Auth + the authorization traceability matrix → Phase 5 Catalog/Search/Media → **Phase 6 commerce core (highest risk)** → Phase 7 Reviews/Content/Audit → Phase 8 contract freeze → Phase 9 Next.js migration.

---

## 23. Implementation readiness check

| Area | Question | Status |
|---|---|---|
| **Domain** | All core domains identified? | ✅ 11 core + 3 supporting |
| | Boundaries clear? | ✅ One writer per field; acyclic graph |
| **Business rules** | Critical rules explicit? | ✅ 99 rules |
| | Legacy bugs intentionally handled? | ✅ 96 behaviours classified; 38 fixed, 18 removed |
| **Orders** | Lifecycle defined? | ✅ 7 statuses, one axis |
| | Transitions explicit? | ✅ Full matrix with actors and side effects |
| **Inventory** | Stock semantics defined? | ✅ Model A, no reservations |
| | Cancellation behaviour defined? | ✅ Restores stock, idempotently |
| **Money** | Representation explicit? | ✅ int64 EGP minor units |
| | Calculations defined? | ✅ Canonical sequence + rounding |
| **Authorization** | Roles and ownership explicit? | ✅ 3 roles; ownership as a query filter |
| **MongoDB** | Embed/reference decisions explicit? | ✅ All four required cases decided |
| | Indexes conceptually defined? | ✅ ~40, each justified by an access pattern |
| **API** | Consumable by Web **and** Flutter? | ✅ Bearer + cookie, stable shapes, generated Dart client |
| **NestJS** | Module responsibilities clear? | ✅ 15 modules, acyclic, dependency risks assessed |

**All readiness criteria met. Open items are business inputs with recorded defaults, not architectural gaps.**

---

## ARCHITECT HANDOFF

### FINAL DOMAIN LIST
Identity & Access · Users · Catalog · Inventory · Cart · Orders · Pricing & Discounts · Fulfilment · Reviews · Content · Media · **+ Audit · Notifications · Search** (supporting).
**Not domains:** Admin (a role), Payments (COD), Variants, Wishlist, In-app Notifications, Recently Viewed, EAV Attributes.

### FINAL BUSINESS RULES
99 rules — 17 preserved, 38 fixed, 32 new, 12 redesigned. **All enforced server-side.** The load-bearing ten: positive integer quantity · server-resolved prices · active-and-not-deleted products only · all-or-nothing stock · `userId` from the token · ledger event per stock mutation · `Σ events == onHand` · server-owned transition matrix · stock restored on cancel/return · `grandTotal ≥ 0`.

### FINAL MONEY REPRESENTATION
**int64 EGP minor units (piastres)** + ISO code. Percentages in **basis points**. **HALF_UP, once per order.** **VAT-inclusive** — no additive tax. `total = itemsSubtotal − discountTotal + shippingFee`. **No floats. No client arithmetic. Historical orders immutable.**

### FINAL ORDER STATE MACHINE
`PLACED → CONFIRMED → SHIPPED → DELIVERED` · `DELIVERY_FAILED ⇄ SHIPPED` · `→ RETURNED` · `CANCELLED` from `PLACED`/`CONFIRMED` only.
Payment: `PENDING → PAID` (set atomically by `→ DELIVERED`) `→ REFUNDED`.
Enforced by matrix **+ guarded atomic update**. Shipping **requires** carrier + tracking. Customer may cancel pre-dispatch. Orders are immutable and undeletable.

### FINAL INVENTORY MODEL
**Model A — no reservations.** `available = stock.onHand`. Current value **+ immutable ledger** with `OPENING_BALANCE` and `balanceBefore/After`. Stock embedded in the product, **written only by `InventoryModule`**. Overselling prevented by conditional `$gte` update. Restoration idempotent via unique index.

### FINAL AUTHORIZATION MODEL
`JwtAuthGuard → RolesGuard → OwnershipGuard → ValidationPipe → Service`.
3 roles · `role` in the JWT + `tokenVersion` · **real `SUPER_ADMIN` separation** · `userId` always from the token · ownership as a **query filter** · foreign resource → **404** · auth **global by default** · `forbidNonWhitelisted` blocks field injection · rate limits everywhere.
**No client→DB path. No privileged function without authorization.**

### FINAL MONGODB COLLECTIONS
`users` · `products` · `categories` · `brands` · `carts` · `orders` · `inventoryEvents` · `coupons` · `couponRedemptions` · `reviews` · `blogPosts` · `auditLogs`
**+** `slugRedirects` · `specDefinitions` · `shippingRates` · `refreshTokens` · `mediaAssets` · `orderCounters` · `idempotencyKeys`

### FINAL EMBED / REFERENCE DECISIONS
**Embed:** addresses → user · images + specs → product · items → cart · **items, statusHistory, shipment, address + coupon snapshots → order** · review images/votes.
**Reference:** user → orders · product → reviews · product → inventoryEvents · coupon → redemptions.
**Reference + snapshot:** product → category/brand · order → customer · review → author/product.
**Never embed:** inventoryEvents, reviews, auditLogs, couponRedemptions (all unbounded).

### FINAL NESTJS MODULE MAP
`CommonModule(@Global)` · `AuthModule` · `UsersModule` · `CatalogModule` · `SearchModule` · `MediaModule` · `CartModule` · `InventoryModule` · `PricingModule` · `FulfilmentModule` · **`OrdersModule`** · `ReviewsModule` · `ContentModule` · `AuditModule` · `NotificationsModule` · `HealthModule`.
Acyclic. **No `AdminModule`.** Orders is the composition root (6 deps, 0 dependents). Audit and Notifications are sinks.

### FINAL API PRINCIPLES
`/api/v1` · one envelope · ISO 8601 UTC · ObjectId hex · money as `{amount, currency, formatted}` · offset pagination with **true totals** · stable `error.code`, **no driver text** · auth global by default · bearer **and** cookie · OpenAPI generated from DTOs · additive-only within v1.

### OPEN BLOCKERS
**Architectural: none.**
Business inputs with defaults: shipping rates · VAT display · blog scope · email provider · carrier list · reviews policy · wishlist.
⚠️ **OPEN-006 — instance count — must be answered before launch** (determines Redis).
🔴 **Outside this phase, still live:** the four `anon`-executable Supabase RPCs and the outstanding credential rotation.

### PHASE 2 RECOMMENDED STARTING POINT
1. **Provision a MongoDB replica set** in local, CI and staging — this is the hardest prerequisite and the one that must not slip.
2. Scaffold `apps/api` in the existing Turborepo with `CommonModule` — config validation, pino + requestId, global pipes/filters/interceptors, throttler.
3. **Stand up CI — the project's first** — lint, type-check across *all* workspaces, test, build.
4. **Write the transaction-rollback test before any domain code.** It proves the replica set works everywhere and is the gate for Phase 2 completion.
5. Health checks with a replica-set assertion, Swagger, Dockerfile, staging deploy.

**Do not begin domain modules until step 4 passes.**

---

## HARD STOP

Phase 1 is complete. **No NestJS project was created, no module or controller or schema written, no dependency installed, no data migrated, no Supabase object modified, no Next.js file changed, and no bug fixed.**

Awaiting architecture review and approval before implementation begins.
