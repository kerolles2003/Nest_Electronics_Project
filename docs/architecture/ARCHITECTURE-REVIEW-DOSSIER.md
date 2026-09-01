# ARCHITECTURE REVIEW DOSSIER

**Project:** Nest Electronics · **Prepared:** 2026-08-30 · **For:** external architecture review prior to **ARCHITECTURE FREEZE**

| | |
|---|---|
| **Covers** | Phase 1 (Domain & Architecture Freeze, 23 docs) + Phase 1.1 (Code Architecture, 14 docs) |
| **Grounded in** | The 37 written architecture documents in `docs/architecture/`, re-read for this dossier — not prior summaries |
| **Purpose** | Allow approve/reject **without reading the other 37 documents** |
| **Conflicts found** | **3** — all documentation inconsistencies, none a decision reversal. See §0.2 |
| **Superseded by the clean-database correction** | **4 items.** See §0.1 |

---

## 0. Reader's preface — corrections and conflicts

### 0.1 PROJECT CORRECTION: this is a clean rebuild, not a data migration

> **The new system starts with an empty MongoDB database and fresh development data. There is no legacy data migration of any kind — no users, no orders, no products, no images, no Supabase export.**
>
> The existing Next.js + Supabase application is a **behavioural and domain reference only.**

Phase 1 was written when a migration was still assumed possible. Its *architecture* is unaffected — but four specific claims are now void and must not become Phase 2 requirements:

| # | Superseded item | Original statement | Replacement | Reason |
|---|---|---|---|---|
| **S1** | Migration verification tests | `baseline-test-cases.md` §13 defines **MG-01…MG-06**, including a zero-delta reconciliation asserting `users 4 · products 85 · orders 10 · SUM(orders.total) = 7367.00` | **Deleted.** No reconciliation test exists. Replaced by a **seed-integrity test**: `Σ inventoryEvents == stock.onHand` for every seeded product | Nothing is migrated, so there is nothing to reconcile against |
| **S2** | Image migration | `MEDIA-MODEL.md` §1 and `PHASE-1-REPORT.md` §18: *"Migration is 2 files, 204 KB… Phase 0 risk R5 downgraded to Low"* | **Zero files migrated.** The catalogue starts with no images; populating it is a content task | Clean database |
| **S3** | Password portability | Phase 0.5 established legacy hashes are portable bcrypt `$2a$`, closing risk **R3** | **Irrelevant.** No user accounts are carried over. bcrypt cost 12 remains the choice on its own merits | No users to migrate |
| **S4** | Legacy risk downgrades | `supabase-to-nest-mapping.md` §9 tracks **R3 / R5 / R6** (password, image, order-integrity migration risks) | **All three void** | The risks were migration risks |

**Ratified and recorded in** [`ARCHITECTURE-FREEZE-RATIFICATION.md`](./ARCHITECTURE-FREEZE-RATIFICATION.md) §6–§7, which also defines the replacement direction: *legacy migration verification → **seed integrity validation***.

**Explicitly still valid and unaffected:** `INVENTORY-MODEL.md` §9 already described this as *"a seed rather than a migration"*; Phase 1's recommended build order (Phase 2 → 9) never contained a data-migration phase.

**One distinction the reviewer must hold** (§13.2 expands it): *initial rebuild* ≠ *future provider replacement*. There is no media migration **now**. Once the live system accumulates real assets, a later Cloudinary → S3 switch **would** require moving those bytes. That is a future operational cost, not an architectural flaw.

### 0.2 Conflicts found between documents — **ALL THREE RESOLVED**

> **Status: ratified and corrected.** The architecture review approved all three resolutions, and they were applied in the Architecture Freeze Ratification pass. See [`ARCHITECTURE-FREEZE-RATIFICATION.md`](./ARCHITECTURE-FREEZE-RATIFICATION.md). The table below is retained as the record of what was found and how it was settled.

Required disclosure. All three are **documentation inconsistencies within Phase 1.1**, not contradictions of a business decision. Each needs a one-line reviewer ratification.

| # | Conflict | Document A | Document B | Recommended resolution |
|---|---|---|---|---|
| **C1** | **Module tier counts** | `CODEBASE-STRUCTURE.md` §7 table lists **4 Tier-1, 7 Tier-2, 4 Tier-3** (verified by counting all 15 rows) | The same section's prose says *"Six Tier-1, five Tier-2, four Tier-3"* | ✅ **RESOLVED (R1).** The table is authoritative: **4 / 7 / 4, 15 total.** The prose miscounted by treating `brands` and `categories` as standalone Tier-1 modules, when §3 places them *inside* the Tier-2 `catalog` module. All counts corrected; module membership unchanged. |
| **C2** | **Port inventory** | `PORTS-AND-CONTRACTS.md` §3 states definitively: **six ports** — `EmailSenderPort`, `MediaStoragePort`, `TemplateRendererPort`, and repository ports for `orders`, `inventory`, `pricing` | `CODEBASE-STRUCTURE.md` §7 "Ports?" column implies a *different* set: `auth` has a **"Token store port"** (not in the six), `inventory` has **"Ledger + stock ports"** (two, not one), and `pricing` has **"—"** (none, contradicting `CouponRepositoryPort`) | ✅ **RESOLVED (R2).** [`PORTS-AND-CONTRACTS.md`](./PORTS-AND-CONTRACTS.md) is the **single authoritative port inventory (six ports)**. The tier table's Ports column was corrected to match: `auth` → **no port** (a token-store port is *not* part of the approved architecture and would need its own J1/J2 justification), `inventory` → `InventoryRepositoryPort` (one, not two), `pricing` → `CouponRepositoryPort`. No port was added, removed or redesigned. |
| **C3** | **`Money` consumer count** | `CROSS-CUTTING-STANDARDS.md` §A3 table: *"`Money` — used by pricing, orders, cart, catalog"* (**four**) | Same section's prose: *"used by `pricing`, `orders`, `cart`, `catalog`, `users` — **five** modules"* | ✅ **RESOLVED (R3).** Final count is **five**, the fifth consumer being **`users.stats.totalSpent`**. Cosmetic; `Money` clears the "3+ modules" bar either way. No money, currency, rounding or pricing behaviour changed. |

**No conflict was found between Phase 1 and Phase 1.1.** Phase 1.1 explicitly recorded its three clarifications to Phase 1 as an appendix (§10 of `NESTJS-MODULE-MAP.md`) rather than silently rewriting anything — see §2.4.

---

## 1. Executive architecture summary

### What the project is

**Nest Electronics** — a customer-facing e-commerce platform for electronics and embedded-systems components (Arduino, ESP32, sensors, modules) serving students, makers and engineers in **Egypt**. Cash on Delivery only. English-only at launch, Arabic on the roadmap. `PRODUCT.md` states the defining principle: *"Search is the primary shopping path."*

### What is being rebuilt

The existing system is a Next.js 16 + Supabase application where **the backend is the database**: business logic lives in PostgreSQL functions, authorization in RLS policies, and four `SECURITY DEFINER` procedures are callable by anyone holding the public anon key. Phase 0.5 recovered that logic forensically from the live database.

We are replacing the backend entirely with a **NestJS API**, moving to **MongoDB**, and reducing Next.js to a presentation client alongside a future Flutter app built in a separate repository.

> ### **This is a clean rebuild, not a data migration.**
> Fresh MongoDB, fresh development data, no legacy import. The old system is an architecture and behaviour reference.

### Target stack

| Layer | Choice |
|---|---|
| Clients | Next.js web (this repo) · Flutter mobile (separate repo, separate developer) |
| API | **NestJS**, REST, `/api/v1`, OpenAPI-generated clients |
| Database | **MongoDB**, replica set mandatory |
| Media | **Cloudinary** (behind a port) |
| Email | **Resend** (behind a port) |
| Cache / queue | **None** — Redis deliberately deferred |
| Observability | pino + `X-Request-Id` · Sentry · Terminus · minimal Prometheus |

### Architecture style

**Modular monolith** with enforced boundaries, **ports and adapters only where justified**, and **structure proportional to complexity** — three module tiers rather than uniform layering.

### The five principles that decide most arguments

1. **One request pipeline; no privileged bypass.** Every request passes `JwtAuthGuard → RolesGuard → OwnershipGuard → ValidationPipe → Service → Repository`. No client-to-database path exists.
2. **Money is computed in exactly one module.** `PricingModule` is the sole authority; integer minor units; clients never do arithmetic.
3. **One writer per field.** `stock` only by Inventory, `rating` only by Reviews, credentials never leave Auth.
4. **Vendor SDKs live only in `src/providers/`** — lint-enforced, zero exceptions.
5. **Structure follows complexity, never symmetry.** `BrandsModule` is 5 flat files; `OrdersModule` has 4 layers. Both correct.

### What this project is NOT

| Not | Why |
|---|---|
| A data migration | Clean database (§0.1) |
| A port of the legacy system | Of 96 catalogued behaviours, only **24 survive unchanged**; 38 are fixed, 18 removed, 16 redesigned |
| Microservices | One team, ~200 rows of reference data, transactional order placement |
| Multi-tenant / multi-currency / multi-provider | Egypt, EGP, one active provider at a time |
| Database-portable | MongoDB is a deliberate commitment (§7) |
| Event-driven | No fan-out requirement exists |

---

## 2. Architecture evolution

```
Legacy Next.js + Supabase
   │  business logic in PostgreSQL functions; authorization in RLS;
   │  4 SECURITY DEFINER RPCs granted to `anon`
   ▼
Phase 0 — Repository audit
   │  Logic scattered across 5 layers · 4 browser→DB surfaces · zero tests/CI
   ▼
Phase 0.5 — Live forensic extraction  (read-only, production database)
   │  Recovered the 3 undocumented RPCs verbatim · all 52 RLS policies
   │  Proved: reservation cron ran 35,309 times as a NO-OP
   │          audit log had 0 rows, ever
   │          shipping with a tracking number was IMPOSSIBLE (column absent)
   ▼
Phase 1 — Domain redesign  (23 documents)
   │  11 core + 3 supporting domains · 99 business rules · 12 collections
   ▼
Phase 1.1 — Code architecture  (14 documents)
   │  Root structure · 3 module tiers · 6 ports · provider isolation
   ▼
Target: NestJS + MongoDB, clean database
```

### 2.1 Decisions that materially shape the architecture

Only those with structural consequences. Full inventory: `BEHAVIOR-DECISIONS.md` (96 items).

**PRESERVED** — correct intent, carried forward

| Decision | Why it matters architecturally |
|---|---|
| Server-side pricing; client prices discarded | The one thing legacy got unambiguously right. Becomes `PricingModule`. |
| **All-or-nothing stock atomicity** | PostgreSQL gave this free via plpgsql. MongoDB requires a **replica set** — the single hardest Phase 2 prerequisite. |
| Conditional stock guard (`WHERE stock >= qty`) | Ported as a MongoDB conditional `$inc`. The overselling primitive. |
| Immutable order line snapshots | Drives the embedded `orders` document design |
| Soft delete; ownership rules; approved-only reviews | Repository-level filters and guards |

**FIXED** — right intent, defective implementation

| Fixed | Architectural consequence |
|---|---|
| 4 RPCs callable by `anon`, no authorization | **The reason the whole request pipeline exists** |
| `p_user_id` never checked against the caller | `userId` comes from the JWT; **no DTO contains it** |
| No `quantity > 0` check (negative qty *increased* stock) | Validation in DTO **and** re-asserted in the service |
| Cancellation never restored stock | Compensating ledger events, idempotent by unique index |
| Tracking number broke the entire ship operation | `orders.shipment` sub-document; carrier + tracking **required** to ship |
| Audit log recorded nothing, ever | Interceptor-written, **loud on failure** |

**REMOVED** — provisioned but never built, so removal costs nothing

| Removed | Evidence |
|---|---|
| **Product variants** | 0 rows, no UI, no roadmap entry, 2 latent bugs |
| **Inventory reservations + cron** | 35,309 no-op runs; `reserved_quantity = 0` on all 85 products |
| `fulfillment_status` axis | Duplicated `order_status` |
| In-app notifications · recently-viewed · tags · comparison | 0 rows each |
| 5-state refund workflow · Google OAuth | Never built / provider disabled, 0 identities |

**REDESIGNED** — model itself unsuitable

| Redesigned | From → To |
|---|---|
| Order status | 3 independent columns (210 combinations) → **1 axis + payment axis** |
| Status vocabulary | Prepaid (`pending_payment → paid`) → **COD-native** |
| Money | `numeric(10,2)` → **integer minor units** |
| Attributes | 3-table EAV (0 assignments) → **embedded `specs[]`** |
| Cart | Write-only DB cart with no price column → **server-authoritative, re-priced on read** |
| Search | Unusable GIN index → **`$text` + `$facet`** |
| Media identity | Absolute URLs → **`publicId` + `version`** |
| Guest tracking | Full order to browser, phone checked in JS → **server-side query filter, minimal projection** |

### 2.2 The single most instructive finding

Legacy's reservation subsystem was **structurally unreachable**: the cron job selected orders with `order_status = 'pending_payment'`, but both order-creation functions hard-coded `'processing'`. No order could ever match. It ran every 5 minutes for months, reported success every time, and did nothing.

**Root cause:** reservations exist to hold stock during a *payment gap*. **COD has no payment gap.** The design was inherited wholesale from a prepaid flow the MVP never implemented.

This shaped two decisions: reservations are removed (§6.6), and the order lifecycle was rebuilt around COD reality rather than a card-payment template (§5).

### 2.3 Phase 0 recommendations deliberately overturned

Phase 0 was written without live database access. Five recommendations are superseded by Phase 0.5 evidence — recorded so the reversals are traceable:

| Phase 0 said | Now | Reason |
|---|---|---|
| Keep legacy UUIDs as `_id` | **ObjectId** | No production data to preserve |
| Adopt Redis at Phase 6 | **Deferred** | ~200 rows; refresh tokens need durability; reservations gone |
| Use CASL policy guards | **3 roles, no permissions** | 4 users, 3 actor classes |
| RFC 7807 errors | **Custom envelope** | Symmetry with the success envelope; cleaner generated clients |
| Port the reservation lifecycle | **Removed** | Structurally dead |

### 2.4 Phase 1.1's clarifications to Phase 1 (no decision changed)

Appended as §10 of `NESTJS-MODULE-MAP.md`:

1. **Capabilities stay with modules; vendor SDKs move to `src/providers/`.** Phase 1 described `MediaModule` as performing "Cloudinary upload/destroy" — written before code placement existed.
2. **Consumers call business methods, not ports.** `Orders → Notifications` (an existing Phase 1 edge), never `Orders → EmailSenderPort`.
3. **Templates live at `src/templates/email/`**, outside both `modules/` and `providers/`.

Plus one naming refinement: the `MediaStoragePort` uses `assetId`/`version` rather than Cloudinary's `publicId` vocabulary. **The persisted field names in `MEDIA-MODEL.md` are unchanged**; mapping is one line in the media repository.

---

## 3. Final architecture at a glance

```
┌──────────────────────┐          ┌──────────────────────┐
│   Next.js Web        │          │  Flutter Mobile      │
│   (this repo)        │          │  (separate repo)     │
│   httpOnly cookies   │          │  Bearer tokens       │
└──────────┬───────────┘          └──────────┬───────────┘
           │        REST /api/v1 · JSON      │
           └────────────────┬────────────────┘
                            ▼
╔═══════════════════════════════════════════════════════════════╗
║                       NestJS API                              ║
║                                                               ║
║  GLOBAL PIPELINE (no bypass)                                  ║
║  RequestId → Logging → Throttler → JwtAuth → Roles            ║
║           → Ownership → Validation → Controller               ║
║                                                               ║
║  ┌──────────────── PRESENTATION ────────────────┐             ║
║  │ controllers · request/response DTOs          │             ║
║  └──────────────────────┬───────────────────────┘             ║
║                         ▼                                     ║
║  ┌──────────────── APPLICATION ─────────────────┐             ║
║  │ use cases · commands · results · PORTS       │             ║
║  └──────────────────────┬───────────────────────┘             ║
║                         ▼                                     ║
║  ┌──────────────── DOMAIN ──────────────────────┐             ║
║  │ entities · value objects · business rules    │             ║
║  │ IMPORTS NOTHING FRAMEWORK-SHAPED             │             ║
║  └──────────────────────▲───────────────────────┘             ║
║                         │ implements                          ║
║  ┌──────────────── INFRASTRUCTURE ──────────────┐             ║
║  │ repositories · Mongoose schemas              │             ║
║  └──────────────────────┬───────────────────────┘             ║
╚═════════════════════════╪═════════════════════════════════════╝
                          │
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
  ┌───────────┐   ┌───────────────┐  ┌───────────────┐
  │  MongoDB  │   │ providers/    │  │ providers/    │
  │ replica   │   │ email/resend  │  │storage/cloud… │
  │ set       │   │  ↑ ONLY place │  │  ↑ ONLY place │
  │           │   │  SDKs appear  │  │  SDKs appear  │
  └───────────┘   └───────────────┘  └───────────────┘
```

### The real dependency direction

Infrastructure sits *below* domain in the diagram but points **upward** — it implements contracts the application declares. That inversion is what keeps business rules free of Mongoose and vendor SDKs.

**The architecture is tiered, and the diagram above shows only the Tier 3 case.** Tier 1 modules have no layer directories at all — a controller and a service, with the service using the Mongoose model directly. Presenting four layers as universal would misrepresent the design (§8, §10).

---

## 4. Final business decisions

### 4.1 Money

| Decision | Why | Main alternative rejected |
|---|---|---|
| **int64 EGP minor units (piastres)** | Exact by construction; native to BSON, JSON, TS and Dart; sorts and range-queries correctly | **`Decimal128`** — exact, but JS has no native decimal, so a careless `Number(x)` silently reintroduces float error at the boundary |
| **Single currency (EGP)**, code carried explicitly | Egypt-only, COD in cash. One field makes a second currency additive rather than a migration | Multi-currency with FX — no requirement |
| **Basis points** for percentages | `1500` = 15.00%. Removes the legacy ambiguity where one `numeric` column meant both "15%" and "15.00 EGP" | Float percentages |
| **HALF_UP, exactly once per order** | Only percentage discounts round; line totals are integer × integer = exact | Banker's rounding — not the retail expectation in Egypt |
| **VAT-inclusive; no additive tax term** | Legacy `tax` was always 0 while the PDP already said *"Price includes VAT"*. `vatRateBps` (default 1400) is snapshotted per order so VAT is derivable for invoices | Additive VAT — contradicts displayed prices |
| **`total = itemsSubtotal − discountTotal + shippingFee`** | Single canonical formula, asserted before persistence | Legacy had **no discount term at all** |
| **Clients never compute money** | The cart endpoint returns computed totals so the UI has nothing to add up | Legacy summed the cart independently in two React components |

### 4.2 Catalog

| Decision | Why | Main alternative rejected |
|---|---|---|
| **No product variants** | 0 rows, no UI, never in any roadmap. An ESP32-S3 is a *different product* from an ESP32-WROOM-32, not a size of it | Keeping variants "just in case" — a second inventory axis, `variantId` on every line, and 2 latent bugs, for a feature nothing uses |
| **EAV → embedded `specs[]`** | 0 assignments existed, so zero migration cost and full design freedom. A multikey index makes faceting a single-collection query | 3-table EAV — the join `search_products` could not perform, which is why faceting was never delivered |
| **Localized `{en, ar?}`, English only at launch** | Arabic is explicitly on the roadmap; retrofitting would rewrite every document, DTO and index | Flat strings (costly retrofit) or a full i18n framework (overengineering) |
| **Category `path[]` materialised** | MongoDB has no recursive CTE; turns subtree queries into one indexed `$in` | `$graphLookup` — too expensive for a tree rendered on every page |
| **Category/brand: reference + snapshot** | Every product card renders the brand name; a pure reference forces `$lookup` on the hottest query | Pure reference — the exact cause of legacy's brand-less grids |
| **Soft delete, re-validated at checkout** | Orders reference products; SKUs must not silently become reusable | Hard delete |

### 4.3 Cart & guest access

| Decision | Why | Main alternative rejected |
|---|---|---|
| **Server cart authoritative for authenticated users; localStorage for guests** | Cross-device continuity needs a server cart; anonymous server carts are unjustified storage and an abuse vector | Server-side guest carts with a cookie token |
| **Cart is never a price or stock authority** — re-priced on every read | Prevents a stale snapshot ever becoming payable | Storing prices in the cart (creates a second price authority) |
| **Merge strategy: `max`, then clamp** | Matches documented intent; idempotent; a customer who added 2 on two devices wants 2, not 4 | `sum` — legacy had both implementations simultaneously |
| **Checkout sends no items and no prices** | The server derives everything from the cart | Client-supplied item list — how the negative-quantity flaw was reachable |
| **Guest checkout REMOVED** | It never existed (`user_id` NOT NULL, checkout auth-gated). COD ships real goods on trust; a verified account is the primary fraud lever | Guest checkout — would need OTP identity, a claim flow and its own abuse controls |
| **Guest tracking KEPT, redesigned** | COD parcels are often received by someone else. Order number **+ phone both in the query filter**, generic 404, 10/hour/IP, minimal projection | Legacy design (full order to browser, phone compared in JS) or dropping the feature |

### 4.4 Pricing & discounts

| Decision | Why | Main alternative rejected |
|---|---|---|
| **Coupons redesigned and completed** | Explicit roadmap item with a sound written spec that was never implemented; 0 coupons exist, so no constraints | Dropping coupons; or preserving the admin-only half-feature |
| **`value` discriminated by `type`** | bps for percentage, minor units for fixed | One ambiguous numeric column |
| **`perUserLimit` + `couponRedemptions`** | Without it, one customer drains a global limit | Global limit only (legacy) |
| **Coupon snapshotted onto the order** | A later coupon edit must not rewrite what a past order appears to have paid | Foreign-key reference (legacy design) |
| **No stacking — one coupon per order** | No requirement; stacking multiplies abuse surface and test combinations | Multiple coupons |
| **Discount clamped to `[0, subtotal]`; never applies to shipping** | `grandTotal ≥ 0` always | Unclamped discount |

### 4.5 Inventory

| Decision | Why | Main alternative rejected |
|---|---|---|
| **Model A — available stock only, no reservations** | COD has no payment gap. The legacy subsystem was structurally unreachable (§2.2) | Fixing the reservation model — would preserve a concept COD does not need |
| **Current value + immutable ledger** | Stock is inventory value; "why is this at 7 units?" must be answerable | Current value only — legacy's ledger was decorative (4 of 85 products, none reconciling) |
| **`OPENING_BALANCE` event per product** | Makes `Σ events == onHand` an assertable invariant for the first time | No opening balances (legacy) — reconciliation impossible |
| **Stock in the product document, written only by Inventory** | Availability is read on every card; a separate collection forces `$lookup` on the hottest query | Separate stock collection |

### 4.6 Order lifecycle & payment — see §5 for the full model

| Decision | Why | Main alternative rejected |
|---|---|---|
| **One status axis + separate payment status** | 3 independent columns produced 210 unvalidated combinations, and live data already held incoherent states | Keeping three axes |
| **COD-native vocabulary** | `pending_payment`/`paid` describe a prepaid flow the MVP does not implement | Legacy vocabulary — the mismatch that killed the reservation cron |
| **`DELIVERED` ⇒ `PAID`, atomically** | Under COD, delivery *is* the payment event | Independent payment status — permits "delivered but unpaid" |
| **`DELIVERY_FAILED` added** | The most common COD exception was unrepresentable | Leaving orders `shipped` indefinitely |
| **Customer self-cancellation pre-dispatch** | Basic COD expectation; reduces support load | Admin-only cancellation (legacy had no customer path) |
| **No refund workflow — outcome only** | No payment provider exists; refunds are a manual bank transfer | 5-state refund lifecycle (planned, never built) |

---

## 5. Order lifecycle — detailed review section

### 5.1 Why the legacy three-axis model was removed

Legacy had `order_status` (7 values) × `payment_status` (6) × `fulfillment_status` (5) = **210 combinations, with no cross-field validation anywhere.** Live production data already contained:

- 2 orders `shipped` while `payment_status = 'pending'`
- 1 order `delivered` while `fulfillment_status = 'unfulfilled'`

`fulfillment_status` largely duplicated `order_status` (`processing`/`shipped`/`delivered` appear in both). It is **deleted**.

The vocabulary was also wrong for the business: `pending_payment → paid → processing` describes a **prepaid** flow. The MVP is COD, where cash arrives days later at the door. This mismatch is the documented root cause of the dead reservation subsystem (§2.2).

### 5.2 Final status enumeration

| Status | Meaning | Terminal? | Stock committed? |
|---|---|---|---|
| `PLACED` | Customer submitted; stock already decremented; awaiting admin verification | no | ✅ |
| `CONFIRMED` | Admin verified (typically a phone confirmation call) | no | ✅ |
| `SHIPPED` | Dispatched to courier; tracking assigned | no | ✅ |
| `DELIVERED` | Customer received goods **and** paid the courier | **yes** | ✅ |
| `DELIVERY_FAILED` | Courier attempted and failed (unreachable, refused, wrong address) | no | ✅ |
| `CANCELLED` | Cancelled before dispatch; **stock restored** | **yes** | ❌ restored |
| `RETURNED` | Goods came back; **stock restored** | **yes** | ❌ restored |

**Payment axis (separate, 3 values):** `PENDING` → `PAID` (set automatically by `→ DELIVERED`) → `REFUNDED` (admin, manual, out-of-band).

> **`PLACED` and `CONFIRMED` are separate deliberately.** In the Egyptian COD market merchants routinely call to confirm before dispatch, because unverified COD orders have a material refusal rate. This models a real business step and gives the admin a work queue.

### 5.3 State machine

```
      customer places
      ────────────────▶ PLACED ──────admin confirms──────▶ CONFIRMED
                          │                                    │
                    cancel│(C or A)                      cancel │(C or A)
                          ▼                                    ▼
                      CANCELLED ◀──────────────────────── CANCELLED
                      (terminal, stock ⟲)                       │
                                                    ships (requires
                                                  carrier + tracking)
                                                                ▼
                                    ┌──────retry dispatch────  SHIPPED
                                    │                          │      │
                                    │                          │      │
                            DELIVERY_FAILED ◀──────────────────┘      │
                                    │  attempts++                     ▼
                                    │                            DELIVERED
                                    │ give up                    (terminal)
                                    │                          payment: PAID
                                    ▼                                 │
                                 RETURNED ◀───customer returns────────┘
                             (terminal, stock ⟲)
```

### 5.4 Complete transition matrix (authoritative — reproduced in full)

`C` = Customer (owner) · `A` = Admin/Super Admin

| # | From | To | Allowed | Actor | Required input | Side effects |
|---|---|---|---|---|---|---|
| **T0** | *(none)* | `PLACED` | ✅ | C | address, optional coupon, `Idempotency-Key` | **Decrement stock** · ledger `SALE` per line · `salesCount++` · redeem coupon · snapshot pricing · history · email |
| **T1** | `PLACED` | `CONFIRMED` | ✅ | A | optional note | history · email |
| **T2** | `PLACED` | `CANCELLED` | ✅ | **C** or A | reason | **Restore stock** · ledger `CANCELLATION` · `salesCount--` · release coupon · history · email |
| **T3** | `CONFIRMED` | `SHIPPED` | ✅ | A | **`carrier` + `trackingNumber` (REQUIRED)** | set `shipment` · `shippedAt` · history · email with tracking |
| **T4** | `CONFIRMED` | `CANCELLED` | ✅ | **C** or A | reason | as T2 |
| **T5** | `SHIPPED` | `DELIVERED` | ✅ | A | optional note | **`payment.status = PAID`** · `payment.collectedAt` · `deliveredAt` · `user.stats` update · history · email |
| **T6** | `SHIPPED` | `DELIVERY_FAILED` | ✅ | A | failure reason | `deliveryAttempts++` · attempt appended · history · email |
| **T7** | `DELIVERY_FAILED` | `SHIPPED` | ✅ | A | optional new tracking | re-dispatch · history |
| **T8** | `DELIVERY_FAILED` | `RETURNED` | ✅ | A | reason | **Restore stock** · ledger `RETURN` · `salesCount--` · release coupon · history |
| **T9** | `DELIVERED` | `RETURNED` | ✅ | A | reason | **Restore stock** · ledger `RETURN` · `salesCount--` · flag for manual refund · history |
| **T10** | `SHIPPED` | `CANCELLED` | ❌ | — | — | Goods are with the courier; correct path is `DELIVERY_FAILED → RETURNED` |
| **T11** | `DELIVERED` | `CANCELLED` | ❌ | — | — | Use `RETURNED` |
| **T12** | any | *(same state)* | ❌ | — | — | No-op transitions rejected |
| **T13** | `CANCELLED` / `RETURNED` | anything | ❌ | — | — | **Terminal. No resurrection.** |
| **T14** | any backwards move | — | ❌ | — | — | e.g. `DELIVERED → PLACED` — the exact class legacy permitted |

**Payment transition (independent, admin-only):**

| From | To | Actor | Condition |
|---|---|---|---|
| `PAID` | `REFUNDED` | A | Order is `DELIVERED` or `RETURNED`; requires `refundedAmount` + `refundNote` |

### 5.5 How impossible states are prevented

Three mechanisms, in order of strength:

1. **One axis instead of three.** Most legacy incoherent combinations are now unrepresentable, not merely invalid.
2. **Server-owned matrix, enforced by a guarded atomic update.** The transition is applied as `updateOne({ _id, status: <expectedFrom> }, …)`. If `matchedCount === 0`, another actor changed the status first → `409 CONFLICT`.
3. **Terminal states.** `CANCELLED` and `RETURNED` accept no outbound transition.

> **Why the guarded update matters.** Legacy's RPC *did* take a `FOR UPDATE` row lock — but the matrix was evaluated in the **admin application, in a previous round trip, outside that lock**. Two admins could both read `processing`, both pass the check, and both transition. Moving the precondition *into the write* is what closes the TOCTOU window.

### 5.6 How `DELIVERED` affects payment state

Under COD, the courier does not hand over goods without collecting cash. Therefore **delivery is the payment event**. `→ DELIVERED` sets `payment.status = PAID` and `payment.collectedAt` **in the same atomic operation**.

This makes *"shipped + payment pending"* correctly representable (goods in transit, cash not yet collected) while making *"delivered + payment pending"* **structurally impossible** — a combination that existed in live legacy data.

If cash was not collected, the order was not delivered: it is `DELIVERY_FAILED`.

### 5.7 How cancellation works

- **Who:** the customer (own order only) or an admin.
- **When:** only while `PLACED` or `CONFIRMED` — before goods leave the warehouse. `SHIPPED → CANCELLED` is forbidden.
- **Effects:** stock restored per line, `CANCELLATION` ledger event written, `salesCount` decremented, coupon redemption released, history appended, email sent — **all in one transaction**.
- **Idempotent:** a unique index on `inventoryEvents {reference.id, productId, type}` makes a double restore structurally impossible.
- **One code path.** Customer and admin cancellation differ only in the actor recorded.

> Legacy `update_order_status_v2` touched **no stock table at all**, so every cancelled order permanently destroyed its stock with no record.

### 5.8 How `DELIVERY_FAILED` works

Entered from `SHIPPED` when a courier attempt fails. Increments `deliveryAttempts` and appends `{at, outcome, reason, recordedBy}`. Two exits: **retry** (`→ SHIPPED`, optionally with new tracking) or **give up** (`→ RETURNED`, restoring stock).

Stock stays committed while in this state — the goods are physically out with the courier.

### 5.9 Tracking data model

Legacy wrote `tracking_number` to a column that **does not exist**. The error was swallowed by `EXCEPTION WHEN OTHERS`, rolling back the status change *and* the history row. **Shipping an order with a tracking number was impossible** — proven by 8 live history rows, none carrying tracking.

```jsonc
"shipment": {
  "carrier": "Bosta",                 // REQUIRED to enter SHIPPED
  "trackingNumber": "BST-123456789",  // REQUIRED to enter SHIPPED
  "trackingUrl": null,
  "shippedAt": ISODate,
  "estimatedDeliveryAt": ISODate | null,
  "deliveredAt": ISODate | null,
  "deliveryAttempts": 0,
  "attempts": [{ at, outcome, reason, recordedBy }]
} | null
```

`trackingNumber` is visible to the order owner and admins; **never** returned by the public tracking endpoint.

---

## 6. Inventory & transaction integrity

### 6.1 Stock source of truth

`products.stock.onHand` (int32, ≥ 0) — embedded in the product document because availability is read on **every** product card, listing and PDP. A separate collection would force a `$lookup` on the highest-traffic query in the system.

**Written only by `InventoryModule`.** The product update DTO **rejects** `stock`, closing the legacy path where any admin `UPDATE products SET stock_quantity` bypassed the ledger.

`available = stock.onHand`. No `reserved` term.

### 6.2 Atomic decrement & overselling protection

```js
updateOne(
  { _id: productId, 'stock.onHand': { $gte: quantity },
    isActive: true, deletedAt: null },
  { $inc: { 'stock.onHand': -quantity, salesCount: +quantity } }
)
// matchedCount === 0  →  abort the ENTIRE transaction, 409 OUT_OF_STOCK
```

**The precondition lives inside the write.** Two concurrent checkouts for the last unit: one matches, one gets `matchedCount === 0` and aborts. No application lock, no read-then-write.

This is a direct port of legacy's `WHERE stock_quantity >= quantity` — the one concurrency primitive the old system got right.

### 6.3 Ledger requirements

Every mutation writes an `inventoryEvent` **in the same transaction**:

```jsonc
{ productId, sku, type, quantityDelta,        // SIGNED
  balanceBefore, balanceAfter,                 // NEW — self-verifying
  reason, reference: {type, id}, actor, createdAt }
```

**Types:** `OPENING_BALANCE` · `SALE` · `CANCELLATION` · `RETURN` · `RESTOCK` · `ADJUSTMENT` · `DAMAGE`.

**Core invariant:** `Σ inventoryEvents.quantityDelta == product.stock.onHand`, for every product, assertable at any time. `OPENING_BALANCE` at seed time is what makes it achievable — legacy seeded stock with no ledger row, so it never reconciled for any product.

`balanceBefore`/`balanceAfter` make each entry independently verifiable and expose any out-of-band mutation as a gap between consecutive events.

### 6.4 Operations requiring a MongoDB transaction

| # | Operation | Transaction | Collections |
|---|---|---|---|
| 1 | **Order placement** | ✅ **Required** | `orders`, `products`, `inventoryEvents`, `coupons`, `couponRedemptions`, `carts`, `orderCounters` |
| 2 | **Order cancellation / return** | ✅ **Required** | `orders`, `products`, `inventoryEvents`, `coupons`, `couponRedemptions` |
| 3 | **Manual stock adjustment** | ✅ **Required** | `products`, `inventoryEvents` |
| 4 | Status transition (no stock effect) | ❌ Not required | `orders` only — single document |
| 5 | User registration | ❌ | `users` only |
| 6 | Cart mutation | ❌ | `carts` only |
| 7 | Product CRUD | ❌ | `products` only |
| 8 | Review moderation + rating aggregate | ⚠️ **Recommended** | `reviews`, `products` — staleness is a display inaccuracy, not corruption |
| 9 | Category rename + snapshot refresh | ❌ | Eventually consistent |
| 10 | Media upload + document write | ❌ | Compensating action |

### 6.5 Operations relying on conditional atomic updates (no transaction)

| Operation | Mechanism |
|---|---|
| Stock decrement | `{'stock.onHand': {$gte: qty}}` in the filter |
| Coupon redemption | `{$expr: {$lt: ['$usedCount','$usageLimit']}}` in the filter |
| Status transition | `{_id, status: <expectedFrom>}` in the filter |
| Order-number reservation | `findOneAndUpdate` with `$inc` and upsert |

These run *inside* transactions 1–3 where applicable, but the guarantee comes from the predicate, not the transaction.

**Rollback:** any failure aborts everything — no order, no stock change, no ledger entry. Post-commit side effects (email, audit) are **outside** the transaction and failure-tolerant: an email outage must never roll back a delivered order.

**Idempotency:** `Idempotency-Key` header on `POST /orders` + unique index; unique indexes on ledger restoration `{reference.id, productId, type}` and coupon redemption `{couponId, orderId}`.

### 6.6 Why reservations were removed

| Evidence | Value |
|---|---|
| Cron `release-expired-reservations` | Active, every 5 min, **35,309 successful runs** |
| Rows it ever affected | **0** |
| Products with `reserved_quantity ≠ 0` | **0 of 85** |
| Reservation ledger events | **0** |
| Orders ever in `pending_payment` | **0** |

The cron targeted a status no order function ever produced. More fundamentally: **a reservation holds stock during a payment gap, and COD has none.** The customer commits at checkout; cash arrives days later. Committing stock immediately is the *correct* model.

**Revisit trigger:** online payment integration (Paymob) creates a genuine payment gap. Reintroduction requires **also** adding the `AWAITING_PAYMENT` status that makes an expiry query reachable — the step legacy omitted.

### 6.7 ⚠️ Phase 2 infrastructure prerequisite — REPLICA SET

> **MongoDB must run as a replica set in EVERY environment: production, staging, CI, and local development.**

A standalone `mongod` cannot start a transaction — the driver throws `IllegalOperation: Transaction numbers are only allowed on a replica set member or mongos`. Order placement mutates three collections atomically; there is no correct single-document alternative.

> **Amended by [`ENVIRONMENT-RATIFICATION.md`](./ENVIRONMENT-RATIFICATION.md) (Phase 2.5.1) — the authority for this table.**

| Environment | Requirement | Provisioning |
|---|---|---|
| Production | Atlas **M10+** (shared tiers do not reliably support transactions) or a 3-node self-hosted set | Not provisioned — separate Atlas environment, clean database |
| Staging | Must mirror production | **NOT CURRENTLY PROVISIONED** — binding only if introduced |
| Development | Replica set | **MongoDB Atlas development environment** |
| Local | Single-node replica set (`--replSet rs0` + `rs.initiate()`) | `docker-compose.dev.yml` |
| CI | Replica set, ephemeral, credential-free | **Docker Compose** — `mongodb-memory-server` is not used |

**This is the single hardest Phase 2 prerequisite.** PostgreSQL gave atomicity free via plpgsql; it must be deliberately reconstructed. **Gate (reclassified, ENVIRONMENT-RATIFICATION §4): the transaction implementation must be proven once by executed rollback and commit evidence, and each environment must pass that same gate before it is considered ready.** Environment verification is a provisioning obligation, not a block imposed by an environment that does not exist.

---

## 7. MongoDB architecture

### 7.1 Collections — 12 core

| # | Collection | Notes |
|---|---|---|
| 1 | `users` | Merges legacy `auth.users` + `profiles` + `addresses` |
| 2 | `products` | Embeds images, specs |
| 3 | `categories` | Materialised `path[]` |
| 4 | `brands` | Flat |
| 5 | `carts` | TTL 30 days |
| 6 | `orders` | Embeds items, statusHistory, shipment, snapshots. **Unbounded** |
| 7 | `inventoryEvents` | Append-only. **Unbounded** |
| 8 | `coupons` | |
| 9 | `couponRedemptions` | Enforces `perUserLimit` |
| 10 | `reviews` | |
| 11 | `blogPosts` | |
| 12 | `auditLogs` | TTL 2 years. **Unbounded** |

**Supporting (7, small/config):** `slugRedirects`, `specDefinitions`, `shippingRates`, `refreshTokens`, `mediaAssets`, `orderCounters`, `idempotencyKeys`.

**28 legacy tables → 12 collections.** Twelve legacy tables become embedded documents; five are removed entirely (variants, tags, compatibility, notifications, recently-viewed).

### 7.2 Ownership boundaries

**One module owns each collection.** Two documented exceptions, both for read performance:

| Exception | Detail |
|---|---|
| `InventoryModule` writes `products.stock` | Product DTO rejects `stock`; Inventory owns a focused repository method, not general product access |
| `ReviewsModule` writes `products.rating` | Product DTO rejects `rating` |

### 7.3 Embedding decisions — the four explicit cases

| Relationship | Decision | Why |
|---|---|---|
| **Order items** | **Embedded snapshot** | An order is a point-in-time contract. A renamed or repriced product must not alter a past order. `productId` retained for traceability only. |
| **Product images** | **Embedded** | Bounded at 8, always loaded with the product. Legacy kept them separate *and forgot the `product_id` index*, producing **51,128 sequential scans** on a 22-row table. |
| **Addresses** | **Embedded in `users`** | ~1–10 per user, only ever read for one user. Also makes the "exactly one default" invariant enforceable in a single atomic update. |
| **Order history** | **Embedded** | Append-only, bounded by workflow length (<15), always read with the order. Distinct from the security audit log, which **is** separate because it spans entities. |

> **Notable:** those four embeddings correspond exactly to the four legacy foreign keys **with no index**. Embedding fixes a real performance defect rather than relocating it.

### 7.4 Referencing & snapshot decisions

| Pattern | Used for |
|---|---|
| **Reference only** | user→orders, product→reviews, product→inventoryEvents, coupon→redemptions (all unbounded) |
| **Reference + denormalised snapshot** | product→category/brand, order→customer, review→author/product |

Snapshot staleness affects a **display label only** — never money, stock or identity. Renaming a category triggers a targeted `updateMany` over a bounded set.

### 7.5 Indexing philosophy

~40 indexes, each justified by an observed access pattern. Highlights: weighted `$text` index with **`sku` weighted 8 of 10** (part numbers are primary search terms for makers); compound `{isActive, deletedAt, category.path, effectivePrice}`; multikey `{specs.key, specs.value}` for facets; `{shippingAddress.phone}` for guest tracking.

**Deliberately not reproduced from legacy:** 4 duplicate index pairs; `idx_orders_status` (35,512 scans, almost entirely the no-op cron); and the four missing-FK indexes now made unnecessary by embedding.

**Validation gate:** `explain()` must show `IXSCAN`, never `COLLSCAN`, for the top 10 queries. Legacy had a GIN full-text index with **0 scans** because the query could not use it.

### 7.6 Concurrency patterns

Preconditions inside update filters (§6.5). `strict: 'throw'` on every schema — an unknown field raises rather than being silently dropped, the structural fix for the legacy type-drift class that produced an empty audit log.

### 7.7 MongoDB is an intentional commitment, not an abstraction

> **MongoDB is an intentional architectural commitment and is NOT abstracted as a portable database.**

**Why a generic `DatabasePort` was rejected:**

The data model is MongoDB-specific by design — embedded order items and status history, materialised category `path[]`, multikey `specs[]` indexes, `$facet` aggregation, conditional `$inc` as the overselling guard, multi-document transactions. **None of that transfers to a relational store without redesigning the model.**

A port promising database portability would be **dishonest abstraction**: it would impose ceremony on every query while delivering none of the implied portability, and would push code toward a lowest-common-denominator query surface — losing exactly the constructs the design depends on.

**The three repository ports that do exist (§12) are for *testability*, not portability.** That distinction is deliberate and should be restated whenever "should we abstract the database?" arises in review. A MongoDB → PostgreSQL move is honestly documented as a rewrite (§23).

---

## 8. Final module architecture

**15 modules.** Tier assignment per `CODEBASE-STRUCTURE.md` §7 (the authoritative table — see conflict **C1** in §0.2, where the surrounding prose miscounts).

### 8.1 Complete module list with tier

| Module | **Tier** | Responsibility | Why this tier |
|---|---|---|---|
| `auth` | **3** | Credentials, tokens, guards, verification, reset | **Security boundary.** Credentials must never leak; token logic needs isolated tests |
| `orders` | **3** | Checkout, state machine, tracking, shipment | **State machine + money + transactions.** Highest-risk module |
| `inventory` | **3** | Stock authority, immutable ledger | **Stock authority + ledger invariant** must be testable without a database |
| `pricing` | **3** | All monetary calculation, coupons | **Computes money.** Legacy scattered this across 5 layers |
| `users` | 2 | Profile, address book, admin customer views | Several invariants (one default address) but no rich domain model |
| `catalog` | 2 | Products, categories, brands, slugs, specs | Complex query surface (products) but simple rules. Contains `categories`/`brands` as flat sub-areas |
| `search` | 2 | Faceted search, sorting, suggestions | Non-trivial queries, no domain rules |
| `cart` | 2 | Draft intent, re-pricing, merge | Several rules, no state machine |
| `reviews` | 2 | Submission, moderation, rating aggregate | Moderate rules |
| `media` | 2 | Validation, metadata, refcounting | Owns `MediaStoragePort`; validation is a security rule |
| `notifications` | 2 | Template selection, email dispatch | Owns `EmailSenderPort` + `TemplateRendererPort` |
| `fulfilment` | 1 | Shipping cost policy, shipment record | Small config-driven policy |
| `content` | 1 | Blog CRUD | Pure CRUD |
| `audit` | 1 | Immutable admin action log | Append + query only |
| `health` | 1 | Liveness / readiness | Trivial |

**Totals: 4 Tier-1 · 7 Tier-2 · 4 Tier-3.**

### 8.2 Most complex modules

**`orders`, `inventory`, `auth`, `pricing`** — confirmed against the final documents. Each owns something Phase 0.5 proved dangerous when scattered:

| Module | Owns | Legacy failure it guards against |
|---|---|---|
| `orders` | Transition matrix | Lived only in admin app code while the RPC validated nothing |
| `inventory` | Stock + ledger invariant | Any direct UPDATE bypassed the ledger |
| `auth` | Credentials, tokens | 4 `SECURITY DEFINER` RPCs callable by `anon` |
| `pricing` | All money | Effective-price rule duplicated across 4 frontend components |

### 8.3 Promotion & demotion criteria

**Tier 1 → 2** (any two): service exceeds ~200 lines · more than 3 distinct query shapes · aggregation pipelines appear · more than one controller.

**Tier 2 → 3** (any two): owns a **state machine** · **computes money** · owns a **security boundary** · requires **multi-collection transactions** · a rule needs unit testing **without a database**.

**Demotion is explicitly permitted and expected.** If a Tier 3 `domain/` folder ends up holding only enums, the module was mis-tiered — flatten it. This is the honest test of the discipline.

> Starting at Tier 1 and never being promoted is a **success, not debt**. `content`, `audit` and `health` are expected to stay flat permanently.

---

## 9. Root folder structure

```
apps/api/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   ├── common/
│   ├── database/          ← refinement 1
│   ├── modules/
│   ├── providers/         ← refinement 2 (scope narrowed)
│   └── templates/email/
├── test/
├── Dockerfile
└── tsconfig.json
```

### Directory contract

| Directory | Purpose | MUST contain | MUST NOT contain |
|---|---|---|---|
| `main.ts` | Bootstrap | Nest factory, global wiring, Swagger, shutdown hooks | Any business logic |
| `app.module.ts` | Composition root — the only file knowing the full module list | Module imports, `APP_GUARD`/`APP_FILTER`/`APP_INTERCEPTOR` | Controllers, services, logic |
| `config/` | Typed validated configuration | Env schema, config factories, typed accessors | `process.env` reads outside the schema; secrets; business rules |
| `common/` | Used by **3+ modules**, no domain meaning | Decorators, guards, interceptors, filters, pipes, base errors, `Money`, pagination DTOs | Domain-specific code; anything with 1–2 consumers; a `utils/misc.ts` dumping ground |
| `database/` | Connection lifecycle + transaction plumbing | `DatabaseModule`, `TransactionService`, index-sync, seed scripts | **Any collection schema** (module-local); any query |
| `modules/` | One directory per domain | Business code, module-local persistence | **Vendor SDK imports**; cross-module reach-in |
| `providers/` | Replaceable vendor adapters | **Vendor SDK imports — the only place they may appear**, port implementations, vendor mapping | Business rules; domain types; **email templates**; Mongoose schemas |
| `templates/` | Email content assets | `.hbs` layouts, partials, per-domain templates | Provider-specific markup; TypeScript logic; business rules |

### The two refinements to the proposed structure

1. **`database/` added.** `TransactionService` is used by `orders` and `inventory` and belongs to neither; index sync spans every collection. Putting them in `common/` would blur it into "infrastructure plus utilities".
2. **`providers/` narrowed** — *a directory belongs there if and only if it imports a third-party vendor SDK for a realistically swappable capability.* Persistence stays module-local. This preserves the property that makes `providers/` valuable: **grep it and you see every vendor coupling in the system.**

### Deliberately not at root

`interfaces/` (orphaned contracts rot) · `services/` · `dto/` · `entities/` · `utils/` · `shared/` · `core/`.

---

## 10. Module internal structure

### Tier 1 — flat (~5 files)

```
modules/content/
├── content.module.ts
├── content.controller.ts          # public read
├── admin-content.controller.ts    # @Roles('ADMIN')
├── content.service.ts             # queries + rules (both trivial)
├── dto/
└── schemas/
    └── blog-post.schema.ts
```

**No layer directories. No repository — the service uses the Mongoose model directly.** No port, no command, no domain entity. A repository here would be a one-line wrapper.

### Tier 2 — three layers

```
modules/catalog/
├── catalog.module.ts
├── presentation/
│   ├── products.controller.ts
│   ├── admin-products.controller.ts
│   ├── categories.controller.ts
│   └── dto/
├── application/
│   ├── products.service.ts
│   ├── categories.service.ts
│   └── brands.service.ts
└── infrastructure/
    ├── schemas/
    └── repositories/
        └── product.repository.ts   # concrete class, NO interface
```

**No `domain/`** — rules are simple enough for the service. A repository exists for products (faceted search, subtree filters) but **not** for categories or brands.

### Tier 3 — full four layers

```
modules/orders/
├── orders.module.ts
├── presentation/
│   ├── orders.controller.ts
│   ├── admin-orders.controller.ts
│   ├── order-tracking.controller.ts
│   └── dto/
├── application/
│   ├── commands/          place-order.command.ts, transition-order.command.ts
│   ├── services/          order-placement.service.ts, order-lifecycle.service.ts
│   └── ports/             order.repository.port.ts
├── domain/
│   ├── order-status.enum.ts
│   ├── order-state-machine.ts     # the transition matrix — PURE, no Nest
│   ├── order-number.ts
│   └── errors/
└── infrastructure/
    ├── schemas/
    └── repositories/      mongo-order.repository.ts
```

### Layer responsibilities & dependency rules

| Layer | Owns | **Allowed imports** | **Forbidden imports** |
|---|---|---|---|
| **Presentation** | Controllers, request/response DTOs, serialisation | own layer · application · domain types · `common` · `config` | repositories · schemas · `mongoose` · vendor SDKs |
| **Application** | Use cases, commands, results, **ports**, transaction orchestration | own layer · domain · `common` · `config` · other modules' **public API** | `infrastructure/` · **vendor SDKs** · `HttpException` |
| **Domain** | Entities, value objects, business rules, domain errors | own layer · `Money` from `common` **only** | **`@nestjs/*`** · **`mongoose`** · vendor SDKs · infrastructure · other modules |
| **Infrastructure** | Repositories, Mongoose schemas, port implementations | own layer · application ports + types · domain · `common` · `config` · `mongoose` | vendor service SDKs (those live in `providers/`) · other modules |

`domain/` importing nothing framework-shaped is what makes the transition matrix a pure function testable in under 5 ms.

---

## 11. DTO & API boundary strategy

### 11.1 Why HTTP DTO ≠ domain model

The API is consumed by two **independently-shipped** clients — Next.js and a Flutter app in a separate repository, whose older versions stay installed on real devices. A field renamed in a Mongoose schema must not break a shipped Flutter build; a Flutter feature request must not reshape the order aggregate.

> **A DTO is never a Mongoose document, and a Mongoose document is never a response.**

### 11.2 The tiered pipeline

```
Tier 1/2:   Request DTO → Service → Response DTO
Tier 3:     Request DTO → Command → Service → Result → Response DTO
```

**A Command is mandatory when any of these holds:**

| # | Condition | Example |
|---|---|---|
| 1 | Input includes data **not in the HTTP request** | `userId` from the JWT, `Idempotency-Key` from a header |
| 2 | Transactional across collections | Order placement, cancellation |
| 3 | More than one caller | Cancellation: customer route + admin route, different guards |
| 4 | Money or stock is computed | Every pricing path |

**Condition 1 is load-bearing.** Legacy `create_order_v2` accepted `p_user_id` and never compared it to the caller. A Command makes provenance structural:

```
PlaceOrderDto      { addressId?, shippingAddress?, couponCode?, customerNote? }
                     ← NO userId, NO items, NO prices, NO totals
PlaceOrderCommand  { userId ← JWT, idempotencyKey ← header, address, couponCode }
```

A reviewer sees the entire trust boundary in fifteen lines.

**A Result is required** when the service returns a *computed view* rather than the stored entity — `PlacedOrderResult`, `CartResult`, `CouponValidationResult`, `ProductSearchResult`. If the return is simply the thing that was stored, no Result object.

### 11.3 When mapping is mandatory vs unnecessary ceremony

| Mandatory | Unnecessary ceremony |
|---|---|
| Audience differs (public vs admin) | Response DTO mirroring the schema 1:1 with no audience or naming difference |
| Input includes non-HTTP data | Command object for trivial CRUD |
| Persisted, domain and wire shapes genuinely differ | `Document → Entity → DomainModel → Result → DTO` for a brand list |
| Money or dates need formatting | — |

### 11.4 Validation & serialisation

**Location:** DTO (shape/type/range) → service (state-dependent invariants) → database (unique indexes, `strict:'throw'`). Layered, not duplicated.

```ts
new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
                     transform: true,
                     transformOptions: { enableImplicitConversion: false } })
```

**`forbidNonWhitelisted` is a security control.** It makes these structurally impossible: `role` in a profile update, `stock` in a product update, `userId` in an order body, `price` at checkout — each returns `400 UNKNOWN_FIELD` and is logged at `warn`.

`enableImplicitConversion: false` prevents `"quantity": "-5"` becoming a number silently.

**Library: `class-validator`** — because `@nestjs/swagger` generates the OpenAPI document (and therefore the Flutter client) from the same decorated classes that validate at runtime, so documentation cannot drift from behaviour.

**Audience separation is structural, not conditional.** `ProductResponseDto` vs `ProductAdminResponseDto` are separate classes so `costPrice` **cannot** leak — the guarantee depends on the field not existing, not on a decorator being remembered. Same for `OrderTrackingResponseDto`, which has no `items`, no `pricing`, no `customer`, no `shippingAddress`.

**Construction:** explicit static factories (`ProductResponseDto.from(product)`), never `plainToInstance` over a document. Greppable, type-checked, fails at compile time on a rename.

### 11.5 Pagination & filtering

**Offset pagination**, uniform envelope:

```jsonc
{ "data": [...], "meta": { page, limit, total, totalPages, hasNext, hasPrev } }
```

`meta.total` is the **true match count** — legacy applied `count:'exact'` to an already-paginated RPC, making totals wrong by construction.

**Shared in `common/dto/`:** `PaginationQueryDto`, `PaginatedResponseDto<T>`, `MoneyDto`, `IdParamDto`, `SlugParamDto`. Nothing else.

**Filtering is module-local, named and typed.** Each module declares its own `sort` allow-list; unlisted values yield `400 UNSUPPORTED_SORT`.

> **Explicitly forbidden: a generic filter DTO accepting arbitrary field/operator pairs.** Legacy interpolated user input into PostgREST `.or()`/`.ilike()` filter strings in six places, letting a caller restructure the filter tree.

---

## 12. Ports, contracts & interfaces

### 12.1 When to create a port — and when not

> **A contract exists where an implementation can realistically change, or where inverting the dependency makes a business rule testable without infrastructure.**
> **Not:** *"every class needs an interface."*

A port requires **at least one** justification:

| | Justification | Test |
|---|---|---|
| **J1** | Vendor replaceability | Can I name the likely replacement? |
| **J2** | A business rule needs testing without a database or network | Is the rule non-trivial enough to want a fast test? |
| **J3** | Genuine simultaneous polymorphism | Do two implementations actually run at once? |

**J3 applies nowhere in this system.** One active provider at a time, by design.

### 12.2 The complete port inventory — six

*(Authoritative per `PORTS-AND-CONTRACTS.md` §3. See conflict **C2** in §0.2 — the tier table in `CODEBASE-STRUCTURE.md` implies a different set and should be corrected.)*

| # | Port | Owner module | Justification | Implementations |
|---|---|---|---|---|
| 1 | `EmailSenderPort` | `notifications` | **J1** — Resend today; Zoho/SES/SMTP plausible | `ResendEmailSender` · `ConsoleEmailSender` (dev) · `FakeEmailSender` (test) |
| 2 | `MediaStoragePort` | `media` | **J1** — Cloudinary today; S3/R2 plausible | `CloudinaryMediaStorage` · `InMemoryMediaStorage` (test) |
| 3 | `TemplateRendererPort` | `notifications` | **J1 (weak) + J2** | `HandlebarsTemplateRenderer` · `FakeTemplateRenderer` |
| 4 | `OrderRepositoryPort` | `orders` | **J2** — state machine testable without MongoDB | `MongoOrderRepository` · `InMemoryOrderRepository` |
| 5 | `InventoryRepositoryPort` | `inventory` | **J2** — ledger invariant + stock guard | `MongoInventoryRepository` · `InMemoryInventoryRepository` |
| 6 | `CouponRepositoryPort` | `pricing` | **J2** — validation + atomic redemption | `MongoCouponRepository` · `InMemoryCouponRepository` |

**Ports 4–6 exist for one concrete reason:** these three modules own the rules Phase 0.5 proved most dangerous when unverifiable. Concurrency and transaction assertions still run against real MongoDB; the *rule* assertions run in milliseconds against fakes, so developers run them constantly.

### 12.3 Notable rejections

| No port for | Why |
|---|---|
| `BrandsService`, `ContentService`, `UsersService`, `CartService`, `ReviewsService` | One implementation, forever. Tested through the module with a test database. |
| **`SearchService`** | Despite a planned `$text` → Atlas Search migration. The change is contained **inside one service** — signatures, result types and callers stay identical; both engines never coexist; and the service itself must be tested against real MongoDB to verify index usage. The seam that matters (the service boundary) already exists. |
| `PricingService` | It is the single money authority; a second implementation would be a bug |
| **MongoDB itself** | §7.7 |
| `CachePort` | `@nestjs/cache-manager` **is** the abstraction; wrapping it is a wrapper over a wrapper |
| `PaymentPort`, `SmsPort`, `PushPort` | **Deferred.** A port designed against zero implementations encodes guesses the first integration contradicts. Design the port *with* its first implementation. |

### 12.4 Interface vs abstract class

> **Ports are declared as `abstract class`. Pure data shapes are `interface`/`type`.**

TypeScript interfaces do not exist at runtime, so a NestJS provider cannot be keyed on one. Options were: interface + `Symbol` token (two artifacts, `@Inject()` everywhere, token can drift), interface + string token (same, stringly-typed), or **abstract class** — one artifact serving as both type and DI token.

```ts
export abstract class EmailSenderPort {
  abstract send(message: OutboundEmail): Promise<EmailSendResult>;
}
// registration
{ provide: EmailSenderPort, useClass: ResendEmailSender }
// consumption — plain constructor injection, no @Inject
constructor(private readonly email: EmailSenderPort) {}
```

**Trade-off accepted:** an abstract class is nominally a class, which purists dislike in a domain-adjacent layer. In exchange: one file per port, ordinary DI, no token registry, and no "token not found" runtime errors.

### 12.5 Placement, naming, registration

**Placement:** `modules/<module>/application/ports/<capability>.port.ts` — **inside the module that owns the capability.** Never a global `interfaces/`.

**Naming:** `<Capability>Port` / `<Entity>RepositoryPort` · vendor impl `<Vendor><Capability>` · persistence impl `Mongo<Entity>Repository` · test double `Fake<Capability>` / `InMemory<Entity>Repository`.

**Registration:** vendor ports bound in `ProvidersModule` by config; repository ports bound in their own module (no config switch — one production implementation).

### 12.6 Contract design rules

1. Speak the application's language, not the vendor's
2. **No vendor type in any signature**
3. Own the input and output types
4. Return application-meaningful results
5. Throw the module's own errors — adapters translate vendor exceptions
6. Model the intersection, not the union
7. Keep it small — `EmailSenderPort` has **one** method
8. No lifecycle leakage (`connect()`/`disconnect()` are the adapter's business)

---

## 13. External provider architecture

### 13.1 Business module vs provider

| | **Business module** | **Provider** |
|---|---|---|
| Is | A business capability | A replaceable external implementation |
| Lives in | `src/modules/` | `src/providers/` |
| Contains | Domain rules, orchestration, persistence | Vendor SDK calls, mapping, error translation |
| Replaceable? | No — it *is* the product | **Yes, by design** |
| May import a vendor SDK? | **Never** | **Only here** |

### The dependency flow (final)

```
Business module            OrdersModule / AuthModule
   │                       calls a BUSINESS METHOD
   ▼
Capability module          NotificationsService.sendOrderConfirmation(order)
   │                       owns templates, recipients, business meaning
   ▼
Port                       EmailSenderPort.send(message)
   │                       application vocabulary, no vendor types
   ▼
Provider adapter           ResendEmailSender      ← ONLY place the SDK appears
   ▼
Vendor SDK                 resend
```

> **Note the two-step separation.** `OrdersModule` does **not** inject `EmailSenderPort` — it injects `NotificationsService`. The port sits one module deeper.
>
> **Why this matters:** if Orders injected the port, it would own subjects, recipients and templates, so a change in email *semantics* (a provider requiring pre-registered template ids) would ripple into order logic. Keeping the port inside its capability module means the blast radius of any email change is **exactly one module**. The same applies to media: `CatalogModule` calls `MediaService.uploadProductImage(...)`, never `MediaStoragePort`.

### Directory layout

```
src/providers/
├── providers.module.ts              # @Global — the ONLY composition point
├── email/
│   ├── resend/    resend-email-sender.ts · resend.mapper.ts · resend.config.ts
│   └── console/   console-email-sender.ts        # dev: logs, sends nothing
└── storage/
    ├── cloudinary/  cloudinary-media-storage.ts · cloudinary-url.builder.ts · …
    └── in-memory/   in-memory-media-storage.ts   # tests
```

**Composition is one conditional `useClass` in one file.** That file is the only place in the codebase naming both a port and a vendor.

**Explicitly rejected:** provider registry (`Map<string, Provider>`), factory class, simultaneous multi-provider routing, failover chains, runtime switching. *The requirement is replaceability, not simultaneity.*

### 13.1 Email provider replacement test — Resend → Zoho

**Files ADDED (3):**
```
src/providers/email/zoho/
├── zoho-email-sender.ts     # implements EmailSenderPort
├── zoho.mapper.ts
└── zoho.config.ts
```

**Files MODIFIED (3, ~10 lines total):**

| File | Change |
|---|---|
| `src/config/env.schema.ts` | Add `ZOHO_*`, conditionally required when `EMAIL_PROVIDER=zoho` |
| `src/config/email.config.ts` | Extend the union: `'resend'\|'console'` → `+'zoho'` |
| `src/providers/providers.module.ts` | One branch in the `useClass` conditional |

**Files DELETED (after verification):** the 3 Resend files + its config entry.

**What does NOT change:**

| Untouched | Confirmation |
|---|---|
| **Every business module in `src/modules/`** | **Auth: NO change. Orders: NO change.** Neither imports a vendor; neither even sees `EmailSenderPort` |
| `NotificationsService` | Depends on the abstract port it never resolves |
| `EmailSenderPort` | The fixed point |
| **All 14 email templates + layouts + partials** | **NO change** — rendering completes before the port |
| `HandlebarsTemplateRenderer`, all template data contracts | — |
| `common/`, `database/`, every DTO, controller, schema, repository | — |
| **Every business test** | Fakes implement the port, not the vendor |

**Configuration change required:** `EMAIL_PROVIDER=zoho` plus the `ZOHO_*` credentials. Nothing else.

**Guarantee level: STRONG.** 3 files added, 3 modified, **0 business modules, 0 templates, 0 business tests.**

**What makes it hold:** application-owned `OutboundEmail`/`EmailSendResult` types · rendering before the port · `from` supplied by the adapter from config · `providerMessageId` treated as **opaque** (logged and stored, never parsed) · vendor errors translated at the boundary.

**Acceptance test:** the shared **port conformance suite** runs unchanged against `ZohoEmailSender`. **If the suite must be edited to accommodate Zoho, the port was vendor-shaped and the design has failed** — that is precisely what the suite detects.

### 13.2 Media provider replacement test — Cloudinary → S3

**Files ADDED (4):** `s3-media-storage.ts`, `s3-derivative.generator.ts`, `s3-url.builder.ts`, `s3.config.ts`.
**Files MODIFIED (3):** identical in shape to email — env schema, `media.config.ts`, one branch in `providers.module.ts`.

**What does NOT change:** `MediaService` (**all validation lives here**) · `MediaStoragePort` · reference counting and `mediaAssets` · **`CatalogModule`, `ContentModule`, `ReviewsModule`** · product/blog schemas (which store `assetId` + `version` as **opaque strings**) · every Response DTO · every business test.

**The hard part, handled honestly.** Cloudinary produces `t_card` by URL transformation; S3 cannot. The port asks for **intent**:

```ts
abstract getUrl(asset: StoredAsset, preset: ImagePreset): string;
export type ImagePreset = 'thumb' | 'card' | 'detail' | 'zoom' | 'original';
```

Cloudinary composes a transformation URL; an S3 adapter returns a CloudFront key for a **pre-generated derivative** created at upload. `S3MediaStorage.upload()` therefore does more work — but **entirely inside the adapter**. `ImagePreset` is a **closed application-owned union**, not a passthrough for vendor transformation strings.

**Validation deliberately stays in `MediaService`:** MIME allow-list, magic-byte sniffing, size limits, dimension caps, EXIF stripping, SVG rejection. These are Phase 1 *security rules* and must survive a provider change. If they lived in the Cloudinary adapter, switching to S3 would silently drop them.

#### ⚠️ Initial rebuild ≠ future provider replacement

| | **Now (initial rebuild)** | **Later (provider swap after assets accumulate)** |
|---|---|---|
| Data migration | **NONE.** Clean database, zero assets, nothing to move | **Yes — a real operational task** |
| What must happen | Nothing | 1. Copy every asset to the new provider, generating derivatives 2. Rewrite `assetId` (and null `version`) on every referencing document 3. Run both adapters during transition, or accept a maintenance window 4. Verify every image resolves before deleting from the old provider |
| Code impact | — | **0 business modules** — one adapter + 3 modified files |

**This is a data migration, not an architecture failure.** No abstraction makes stored bytes move for free. What the architecture guarantees is that the migration touches **data and one adapter, never business logic**.

**Guarantee level: STRONG for code, with an honest data caveat that grows with asset volume.** The boundary is worth establishing now precisely because it will not stay trivial.

---

## 14. Email & template architecture

> **Templates are application content. They belong to the application, never to a provider.**

```
❌ providers/email/resend/templates/   — lost on a provider switch
❌ Resend dashboard                    — un-versioned, un-reviewable, un-testable
✅ src/templates/email/                — versioned with the code that uses it
```

**Explicit confirmation: templates do NOT belong to Resend or any vendor.**

### Structure

```
src/templates/email/
├── layouts/     base.hbs
├── partials/    button.hbs · order-items-table.hbs · address-block.hbs · price-summary.hbs
├── auth/        verify-email · password-reset · password-changed
├── orders/      order-placed · order-confirmed · order-shipped · order-delivered
│                order-delivery-failed · order-cancelled · order-returned
├── admin/       new-order-alert · low-stock-alert
└── contact/     contact-received
```

**14 templates**, each matching a real business event from the Phase 1 notification table. No speculative marketing templates.

**Why root, not `modules/notifications/templates/`:** templates are **content** most likely to be edited by someone not touching business logic; they are **cross-domain** (order emails span Orders and Fulfilment); and they are **build assets** needing an explicit copy step, which one root path makes a one-line rule. Template *selection* and data contracts stay in `NotificationsModule`.

### Rendering boundary

```
NotificationsService.sendOrderShipped(order)
   ├─ selects template          'orders/order-shipped'
   ├─ builds typed data         OrderShippedData
   ├─ TemplateRendererPort.render(...)  →  { subject, html, text }
   └─ EmailSenderPort.send({ to, subject, html, text })
```

**Rendering completes before the port.** `OutboundEmail.html` is already-rendered HTML. This single decision is what makes "0 templates change on a provider swap" true.

### Template data contracts

**Every template has a typed contract; templates never receive a domain entity or Mongoose document.** Money and dates arrive **pre-formatted as strings** — templates never compute. One contract per template, colocated with selection logic, so a renamed field is a compile error rather than a silently blank email.

### Missing-variable behaviour

> **A missing required variable throws — in production too. Never send a partially-rendered email.**

Handlebars silently renders `{{missing}}` as empty, which would send *"Your order  has shipped"*. A missed order-confirmation email is recoverable; a garbled one sent to every customer is not. Templates are **compiled at boot**, so a broken template is a startup failure.

### Engine decision — CLOSED, with a recorded revisit trigger

> **Handlebars is chosen. This is a closed decision. `OPEN-1.1-A` records the *revisit condition*, not an unresolved choice.**

**Why Handlebars:**
- **Logic-less by design** — a developer *cannot* write "if total > X show free-shipping copy" into a template, so that decision must move into a service where it is testable. Given Phase 0.5 found business rules scattered across five layers *including presentation components*, an engine that cannot hold logic is a structural guard, not a preference.
- Editable by anyone who knows HTML; layouts and partials are native; no build step; mature and tiny.

**Limitations accepted:**
- No compile-time type checking of the template body against its data contract (mitigated by a data-contract test asserting every placeholder exists in the TypeScript contract, plus a template-inventory test).
- Weaker cross-email-client CSS handling than MJML — accepted because ~14 transactional emails on one well-tested table layout is proportional.
- Allowed helpers are a **closed set** (`#if`, `#each`, `formatMoney`, `formatDate`, `t`); **no custom helper may contain a business rule.**

**MJML deferred**, revisit trigger: measured cross-client rendering defects. A format change would rewrite all 14 templates (bounded, but real work — §23).

### Localisation readiness

Locale directories with `en` fallback; the renderer **already accepts `locale`**; no user-facing string is hard-coded in a service; the base layout reserves `dir="{{textDirection}}"`. **Arabic is structured, not built** — deliberately avoiding the legacy mistake of provisioning `name_ar` columns that were 100% NULL.

### Testing

Render · missing-variable (asserts a throw) · snapshot · data-contract · template-inventory · delivery-order. **No test touches a real email provider.**

---

## 15. Configuration architecture

> **`process.env` is read in exactly one place: `config/env.schema.ts`. Everywhere else, configuration arrives through typed injection.**

**The legacy precedent:** `packages/config/src/env.ts` implemented exactly this fail-fast validation — and was **imported nowhere**, so it never ran, while `NEXT_PUBLIC_SUPABASE_URL` was read directly in five files. *A validation module that nothing imports is worse than none, because it creates the appearance of safety.*

| Concern | Decision |
|---|---|
| **Validation** | **Zod**, at boot, fail-fast, reporting **every** error at once |
| **Why Zod here but `class-validator` for DTOs** | Config needs type inference; DTOs need OpenAPI generation. Two libraries in two clearly-bounded roles. |
| **Access** | Injected typed namespaces (`@Inject(authConfig.KEY)`); never global lookup. A module injects only the namespaces it needs. |
| **Environment separation** | **One schema across all environments** — differences are values, not shapes. Code must not branch on `NODE_ENV` for business behaviour. |
| **Secrets** | **No defaults ever** (`?? 'dev-secret'` is forbidden) · never logged (pino redaction) · never in a response · platform secret store in production · `JWT_SECRET` ≥ 32 chars enforced at boot |
| **Startup logging** | Configuration **shape**, never values: `emailProvider=resend mediaProvider=cloudinary mongo=connected(replicaSet)` |
| **Business constants** | **Code constants, not env vars** — max quantity 99, bcrypt rounds, TTLs, max 8 images. Changing a business rule should require review and tests. |
| **Feature flags** | **None.** Only boot-time infrastructure switches (`EMAIL_PROVIDER`, `SWAGGER_ENABLED`, `THROTTLE_ENABLED`). |

### Provider selection boundary

```
config/email.config.ts                    ← APPLICATION level (provider-agnostic)
    provider: 'resend' | 'console'
    fromAddress, fromName, replyTo

providers/email/resend/resend.config.ts   ← VENDOR level
    apiKey                                ← read ONLY by ResendEmailSender
```

**Selection happens in `ProvidersModule` only.** `RESEND_API_KEY` appearing anywhere outside `providers/email/resend/` is a lint error. Vendor credentials are **conditionally required** — selecting `console` in development must not demand a Resend key.

> **No business code branches on `EMAIL_PROVIDER`.** An `if (config.email.provider === 'resend')` inside a service is a red flag meaning provider-specific behaviour has leaked upward.

---

## 16. Database access & repository strategy

| Artifact | Location |
|---|---|
| Mongoose schema + document type | `modules/<m>/infrastructure/schemas/` (Tier 2/3) or `modules/<m>/schemas/` (Tier 1). **One module owns each collection.** |
| Queries | Tier 1: the service · Tier 2/3: a repository. **Never a controller.** |
| Repository implementation | `modules/<m>/infrastructure/repositories/` |
| Repository **port** | `modules/<m>/application/ports/` — **Tier 3 only** |
| Connection, transactions, index sync | `database/` |

### When a repository is justified

| Situation | Verdict |
|---|---|
| Tier 1, basic CRUD | ❌ **No repository.** The service uses the model directly — a wrapper here is a one-line forwarder |
| Tier 2 with a complex query surface | ✅ **Concrete class, no interface** |
| Tier 3 with rules needing tests without a database | ✅ **Port + implementation** |
| *"For consistency with other modules"* | ❌ **Never a reason** |

**Absolutely forbidden: a generic `BaseRepository<T>`.** Every real query here is specific — `findActiveBySlugWithRedirect`, `decrementStockIfAvailable`, `findForUser`, `transitionIfInStatus`. A generic base provides none of them, encourages leaking Mongoose filter objects across boundaries, and **hides concurrency semantics**: `update(id, data)` gives no hint that overselling protection depends on a conditional `$gte` predicate.

> **Naming enforces this.** Repository methods are specific and intention-revealing. `decrementStockIfAvailable` *names the concurrency guarantee*; `update(id, data)` hides it.

### The critical distinction

| **Repository abstraction for testability** | **Database abstraction for portability** |
|---|---|
| ✅ **Adopted** — 3 ports (`orders`, `inventory`, `pricing`) | ❌ **Rejected** — no `DatabasePort` |
| Purpose: run the transition matrix, stock guard and coupon ladder against in-memory fakes in milliseconds | Purpose would be: swap MongoDB for another database |
| Honest: the fakes really do let those rules be tested without Mongo | Dishonest: the model is MongoDB-specific; the abstraction would deliver ceremony, not portability |

**The architecture treats these as different things, deliberately.** Concurrency and transaction assertions still run against a real replica set.

### Preventing document leakage

`Mongoose Document → plain object/domain type → Response DTO`. Repositories return `.lean()` results, so `.save()` is not callable from a service. **A Mongoose document must never cross a module boundary.**

Concretely: this is what makes "`costPrice` never reaches a public consumer" a structural guarantee rather than a field-stripping habit.

---

## 17. Cross-cutting concerns — `src/common/`

> **Admission rule: used by 3+ modules AND carrying no domain meaning. Both conditions.**

Fewer than three consumers → premature generalisation. Domain meaning → `common/` becomes a second, unowned domain layer.

### Final contents

```
src/common/
├── decorators/    public · roles · current-user · idempotency-key
├── guards/        jwt-auth · roles
├── interceptors/  transform (envelope) · request-id · logging
├── filters/       all-exceptions          ← the ONLY error→HTTP translator
├── pipes/         parse-object-id
├── errors/        app-error · error-code.enum · common-errors
├── dto/           pagination-query · paginated-response · money · id-param
├── money/         money.ts (+ spec)
└── types/         authenticated-user · locale
```

**There is no `utils/`.** A `utils/` directory is a naming failure, not a category — every function has a real home (`slugify` → catalog; `generateOrderNumber` → orders/domain; `formatMoney` → a `Money` method). A genuinely generic helper gets a **named** directory (`common/text/`), never `utils/`.

### The one documented exception

**`Money`** is domain-meaningful, which by the rule should exclude it. Admitted anyway because it is used by five modules (`pricing`, `orders`, `cart`, `catalog`, `users` — the fifth being `users.stats.totalSpent`) and placing it in any one would force the other four to import a module they otherwise do not depend on — creating edges absent from the Phase 1 graph (`catalog → pricing`). It is a **primitive** (integer + currency + arithmetic); the *rules* that use money stay in `PricingModule`.

*Recorded explicitly so it does not become a precedent — `OrderStatus`, `CouponType` and `StockLevel` stay in their modules.*

### Module-local by design

| Component | Owner | Why not `common/` |
|---|---|---|
| `OrderOwnershipGuard` | `orders` | Needs `OrderRepositoryPort` — a `common/` guard depending on a module inverts the dependency |
| `AuditInterceptor` | `audit` | Domain-specific |
| `IdempotencyInterceptor` | `orders` | Only order placement needs it |

**`common/` may never import from `modules/`.** That constraint alone decides most placement questions.

---

## 18. Error architecture

```
Domain / Application       throws  InvalidOrderTransitionError  (extends AppError, has ErrorCode)
        ↓
Infrastructure             throws  EmailTransportError, TransactionFailedError
        ↓
AllExceptionsFilter        maps    AppError → HTTP status + envelope
        ↓                          unknown  → 500 INTERNAL_ERROR (generic)
HTTP Response                      { error: { code, message, details?, requestId, timestamp } }
```

### Taxonomy

```
AppError (abstract)
├── DomainError            InvalidOrderTransitionError · InsufficientStockError
│                          ProductUnavailableError · CouponNotApplicableError · CartEmptyError
├── ApplicationError       ResourceNotFoundError · ConflictError · ForbiddenError · ValidationError
└── InfrastructureError    EmailTransportError · MediaStorageError
                           TransactionFailedError · DatabaseUnavailableError
```

### How HTTP coupling is prevented from leaking downward

> **`HttpException` and its subclasses are forbidden outside `presentation/` — lint-enforced (rule F13).**

A service throwing `NotFoundException` has coupled a business rule to HTTP and cannot then be called from a job, another service, or a test without dragging transport semantics along. Phase 1 requires order cancellation callable from **both** a customer route and an admin route with different guards — the same domain error must serve both.

**Translation happens at boundaries:** a Mongo duplicate-key error becomes `ConflictError` **in the repository**; a Resend failure becomes `EmailTransportError` **in the adapter**. No driver or vendor error type escapes its layer.

### Two properties this delivers

**1. Business rejections are not errors.** `OUT_OF_STOCK` → 409, logged `info`, **not** sent to Sentry. Infrastructure faults → 5xx, logged `error`, **sent** to Sentry.

> This is the direct lesson of the tracking-number defect: legacy's `EXCEPTION WHEN OTHERS` collapsed a genuine fault (a missing column) into the same `{success:false}` shape as a business rejection, so a real bug hid inside a stream of soft failures for months.

**2. Nothing internal escapes.** No driver message, stack trace, collection name or index name reaches a client — legacy leaked raw PostgREST text in ~20 places. The `requestId` links a client's screenshot to full server-side detail.

`error.code` is a **stable enum** the Flutter client switches on; `error.message` is human-facing and may change.

---

## 19. Testing architecture

> **A test that needs a real vendor account is not a test that runs on every commit.**

| Level | Scope | MongoDB? | Vendor? | Target | Run |
|---|---|---|---|---|---|
| **1 Unit** | Pure functions, domain rules | ❌ | ❌ | <5 ms | Every save |
| **2 Application** | Use case with fake ports | ❌ | ❌ | <20 ms | Every save |
| **3 Infrastructure** | Repositories, transactions, concurrency | ✅ **replica set** | ❌ | <200 ms | Pre-push, CI |
| **4 Integration** | Module wired end to end | ✅ | 🎭 fakes | <500 ms | CI |
| **5 E2E** | HTTP in → HTTP out | ✅ | 🎭 fakes | <2 s | CI |
| **6 Contract** | Every port implementation | ❌ | ⚠️ **opt-in only** | varies | Nightly / pre-swap |

### Highest-value suites

| Suite | Level | Guards against |
|---|---|---|
| **Order transition matrix** | Unit | The rule legacy left in app code while the RPC validated nothing. Pure function → exhaustive coverage |
| **No-oversell under concurrency** | Infrastructure | 20 concurrent orders for 1 unit → exactly 1 succeeds |
| **Ledger invariant** | Infrastructure | `Σ inventoryEvents == stock.onHand` after any sequence |
| **Authorization matrix** | E2E | **anonymous × customer_a × customer_b × admin × super_admin × expired × tampered** — the direct replacement for RLS |
| **Port conformance** | Contract | The acceptance test for any provider swap |

The authorization matrix includes: `customer_b` reads `customer_a`'s order → **404** (not 403 — a 403 confirms existence) · `role` in a profile update → 400 `UNKNOWN_FIELD` · `stock` in a product update → 400 · a price at checkout → 400.

### Test doubles

`FakeEmailSender` · `ConsoleEmailSender` · `InMemoryMediaStorage` · `FakeTemplateRenderer` · `InMemoryOrderRepository` · `InMemoryInventoryRepository` · `InMemoryCouponRepository`. Located in `test/doubles/`, **not** `src/`, so production code cannot import a fake.

> **A fake must honour its port's semantics** — `InMemoryInventoryRepository` must reject a decrement below zero exactly as Mongo does. Verified by running the **same contract suite** against both fakes and real adapters. A permissive fake produces green tests and a broken deployment.

### What must never require a real vendor

**Nothing in levels 1–5.** Enforced structurally: **vendor credentials are absent in CI**, so a test needing one fails rather than silently reaching the network. Never touched: Resend, Cloudinary, Sentry, real SMTP, any live Supabase resource.

**Time is injected**, not globally mocked — coupon windows, token expiry and daily order-number resets stay deterministic without `jest.useFakeTimers()` leaking across files.

### Coverage

90% for `orders`, `inventory`, `pricing`, `auth`; 70% elsewhere. *Coverage is a floor, not a goal — a module at 95% with no concurrency test is worse tested than one at 75% that proves it cannot oversell.*

**CI gates:** lint → type-check (**all** workspaces) → unit+application → infrastructure → integration → e2e → build. Plus architecture lint, template inventory, and `explain()` index-usage assertions.

---

## 20. Anti-overengineering rules

**20 named anti-patterns.** Each is legitimate *somewhere*; none is legitimate *here, now*.

| # | Prohibited | Why here | Would be justified when |
|---|---|---|---|
| 1 | **Interface for every class** | Doubles files, breaks "go to definition", creates the *illusion* of decoupling | J1 (second implementation) or J2 (isolated testability) |
| 2 | **Generic repository (`BaseRepository<T>`)** | Provides none of the real queries; leaks Mongoose filters across boundaries; **hides concurrency semantics** | **Never in this shape** |
| 3 | **Factory without multiple strategies** | A one-branch `create()` is a constructor with extra steps | Construction genuinely varies per call |
| 4 | **Provider registry** | Implies runtime selection that never happens; defers a compile-time error to a runtime lookup | Two providers must run simultaneously |
| 5 | **Failover chains** | Needs health checks, retry budgets, duplicate-send protection — a distributed subsystem for a small store | Email becomes revenue-critical with an SLA |
| 6 | **Event-driven architecture** | Makes control flow invisible; ordering and transactional boundaries become implicit — dangerous where placement must be atomic | Real fan-out: 3+ independent consumers. Use `EventEmitter2` first, **not** a broker |
| 7 | **Microservices** | Would turn local transactions into distributed sagas, making Phase 1's atomicity requirement *harder* | Divergent scaling **and** a team large enough for deployment coupling to matter |
| 8 | **Redis** | Rate limiting works in-memory on one instance; refresh tokens need **durability**; reservations no longer exist | **More than one API instance** (§22 OPEN-006) |
| 9 | **CQRS buses** | Four files and an untraceable indirection for a three-line method | Read/write models genuinely diverge |
| 10 | **Excessive DTO duplication** | A field addition becomes a five-file change | Audience, security boundary or shape genuinely differ |
| 11 | **Excessive mapping layers** | Four mappings for a brand list; each hop can drop a field | Persisted, domain and wire shapes genuinely differ |
| 12 | **Empty layers/folders** | Teaches that structure is decorative; once one is ceremonial, all become suspect | Never — **demote the module instead** |
| 13 | **One-line wrapper services** | A file, a test and an injection with no behaviour | The method adds authorization, a rule, caching or composition |
| 14 | **Database abstraction** | Dishonest — ceremony without portability (§7.7) | **Never** |
| 15 | Premature caching | Adds an invalidation problem; cached wrong data is worse than slow correct data | Profiling shows a hot path (as it did for the category tree) |
| 16 | Speculative ports | Encodes guesses the first real integration contradicts | Design the port **with** its first implementation |
| 17 | Over-configuration | Every knob is a combination to test | The value genuinely differs per environment |
| 18 | Test abstraction layers | Indirect failures, slower onboarding | A genuinely repeated multi-step setup |
| 19 | Barrels everywhere | Import cycles; defeats tree-shaking | One barrel per module, public API only |
| 20 | Over-documenting the obvious | Trains readers to skip comments | — |

### The five-question test

1. Does a second implementation exist or is one concretely planned?
2. Does it enable a test that is currently impossible?
3. Can I name the specific problem it solves?
4. What does it cost every reader, every day?
5. What is the cost of adding it later? *(usually low)*

**If 1 and 2 are both no, the answer is no.**

### The counterweight

This document argues consistently for *less*, but the same audit motivates the abstractions that **do** exist: four Tier 3 modules, six ports, CI-enforced boundaries, 90% coverage on money-handling modules.

> **Under-engineering the order transition matrix would be exactly as costly as over-engineering the brands module.**

---

## 21. Architectural red flags for Phase 2

Practical review checklist, classified by severity.

### 🔴 CRITICAL — reject the PR

| Red flag | Why critical |
|---|---|
| **Vendor SDK imported inside a business module** (`import { Resend }` outside `providers/email/resend/`) | Breaks the core boundary; a provider swap stops being contained |
| **A vendor type in a port signature** | The port *is* the SDK; replaceability is fictional |
| **Business logic reachable without authorization** — any endpoint or service bypassing the guard pipeline | The exact legacy failure (4 RPCs callable by `anon`) |
| **`userId` / `role` / `price` / `stock` accepted from a request body** | Ownership forgery and privilege escalation (F-CRIT-2 class) |
| **Stock written outside `InventoryModule`** | Breaks the ledger invariant silently |
| **Money computed outside `PricingModule`** | Recreates the 5-layer scatter Phase 0 found |
| **A transaction missing on order placement / cancellation / stock adjustment** | Partial writes corrupt inventory |
| **Read-then-write instead of a guarded update** on stock, coupons or status | Reintroduces overselling and the TOCTOU race |
| **Second API instance added without shared rate limiting** | **Silent security regression** — in-memory counters multiply every limit by N |

### 🟠 MAJOR — fix before merge

| Red flag | Why |
|---|---|
| **`process.env` inside a business service** | Untyped, unvalidated, untestable — the legacy pattern |
| **Mongoose query inside a controller** | Bypasses every business rule |
| **A Mongoose document returned from a controller** | `costPrice` / `adminNote` / `__v` leak |
| **HTTP DTO used as a domain model** | The API contract becomes the domain model |
| **`throw new NotFoundException()` in a service** | Couples business logic to HTTP |
| **Cloudinary vocabulary stored as a domain concept** (`publicId` in a port or domain type) | Vendor language at the boundary — use `assetId` |
| **Business logic inside an email template** | Untestable; the reason Handlebars was chosen |
| **`common/` importing from `modules/`** | Inverts the dependency |
| **A business module injecting `EmailSenderPort` / `MediaStoragePort`** | Port leaked past its capability module |
| **A `domain/` file importing `@nestjs/*` or `mongoose`** | Destroys fast unit testability |
| **Validation moved into a provider adapter** | Security rules would not survive a provider swap |

### 🟡 MINOR — flag, discuss, usually fix

| Red flag | Why |
|---|---|
| **Unjustified new interface** | Ask which of J1/J2/J3 applies |
| **Simple CRUD module forced into four layers** | Structure ≠ symmetry |
| **A `domain/` folder holding only enums** | Module mis-tiered — **demote it** |
| **`update(id, data)` on a repository** | Generic surface; hides concurrency semantics |
| **A service method that only forwards** | One-line wrapper |
| **A new env var for a business rule** | Should be a code constant |
| **`BaseRepository` / `AbstractService` / `I`-prefixed interface** | Over-abstraction |
| **A directory with one file** | Premature structure |
| **"For consistency with the other modules"** | **Never a reason** |

---

## 22. Open decisions

### Blocking before Phase 2

**NONE.** No open decision prevents Phase 2 from starting.

### Blocking before production

| ID | Question | Current default | Why unresolved | Trigger / deadline |
|---|---|---|---|---|
| **OPEN-006** | **Will production run more than one API instance?** | Single instance assumed | Deployment target not yet chosen | ⚠️ **Must be answered before launch.** If >1, **Redis is required before go-live** — in-memory rate-limit counters become per-instance and silently multiply every limit by N. A correctness failure in a security control. |
| **OPEN-001** | Shipping rate table — EGP per governorate, free-shipping threshold | Flat rate, configurable in `shippingRates`; mechanism fully specified | Business input not yet supplied | Before commerce-core completion |
| **OPEN-004** | Transactional email provider (Resend / SES / SMTP / Zoho) | Provider-agnostic port; Resend assumed | Commercial choice not made | Before the auth phase ships verification email |
| **OPEN-005** | Carrier list and tracking-URL templates | Free-text carrier + optional URL template | Business input | Before shipping goes live |

### Non-blocking

| ID | Question | Current default | Why unresolved |
|---|---|---|---|
| **OPEN-002** | Must invoices display a VAT breakdown, at what rate? | VAT-inclusive; `vatRateBps = 1400` snapshotted per order | Accounting input. Snapshotting per order means the answer can change without rewriting history |
| **OPEN-003** | Is the blog launching, or is `ContentModule` deferred? | Build last; fully independent | Product scope |
| **OPEN-007** | Should reviews require a verified purchase, or merely flag it? | Anyone may review; `isVerifiedPurchase` computed and displayed | Product decision |
| **OPEN-008** | Wishlist server-side persistence | Client-side localStorage | Post-MVP scope |
| **OPEN-1.1-A** | Handlebars vs MJML | **Handlebars (closed choice)** | Revisit trigger only: measured cross-client rendering defects |
| **OPEN-1.1-B** | Port for `SearchModule` when Atlas Search arrives | No port | Revisit only if both engines must coexist |
| **OPEN-1.1-C** | Does `CatalogModule` split into products/taxonomy? | One module | Split above ~15 files |
| **OPEN-1.1-D** | `EventEmitter2` for `Reviews → Orders` | Direct read-only call | Only if the edge must reverse |
| **OPEN-1.1-E** | Formal `ClockPort` vs injected `now()` | Injected function | Ceremony not yet warranted |

### Documentation corrections required (from §0.2)

| ID | Item | Status |
|---|---|---|
| **C1** | Tier count prose says 6/5/4; table says **4/7/4** | Needs one-line ratification; table is correct |
| **C2** | Port inventory differs between `PORTS-AND-CONTRACTS.md` (six) and the tier table's Ports column | Needs ratification that **six** is correct, and that an `auth` token-store port would need its own J1/J2 justification |
| **C3** | `Money` consumer count 4 vs 5 | Cosmetic |

---

## 23. Architecture risks & honest limitations

Stated plainly. None is presented as a failure.

| # | Limitation | Honest assessment |
|---|---|---|
| **L1** | **MongoDB is not portable by design** | The model is MongoDB-specific. A move to PostgreSQL is a **rewrite** of all persistence, not a configuration change. Deliberate — a `DatabasePort` would deliver ceremony without portability. Tier 3 `domain/` layers *would* survive, which is testability paying off. |
| **L2** | **Media provider replacement requires data migration once assets exist** | **Zero cost now** (clean database). After the catalogue is populated, a Cloudinary → S3 switch means copying assets, generating derivatives and rewriting `assetId` on every referencing document. Code impact stays at 0 business modules. |
| **L3** | **Template engine limitations** | Handlebars has no compile-time type checking of template bodies (mitigated by contract and inventory tests) and weaker cross-client CSS handling than MJML. A format change would rewrite all 14 templates. |
| **L4** | **In-memory rate limiting is safe only under the single-instance assumption** | The load-bearing premise of the Redis deferral. **Adding a second instance without Redis is a silent security regression.** Tracked as OPEN-006 and listed as a critical red flag. |
| **L5** | **The `domain/` layer's value depends on discipline** | Nothing physically stops a developer putting a business rule in a service instead. Lint enforces *imports*, not *placement of logic*. Mitigated by code review and the tier criteria. |
| **L6** | **Snapshot denormalisation can go stale** | Category/brand names on products are refreshed by `updateMany`. A crash mid-update leaves stale **display labels** — never money, stock or identity. Repairable by re-running. |
| **L7** | **Two validation libraries** | `class-validator` for DTOs, Zod for config. A small cognitive cost accepted for OpenAPI fidelity and config type inference. |
| **L8** | **Abstract-class ports are nominally classes** | Purists object to a class in a domain-adjacent layer. Accepted for one-artifact DI without a token registry. |
| **L9** | **Tier boundaries require judgement** | Promotion criteria are written, but "more than 3 distinct query shapes" needs a human. Demotion is explicitly permitted as the corrective. |
| **L10** | **No provider failover** | If Resend is down, transactional email is delayed. Deliberate: dispatch is post-commit and failure-tolerant, logged and alerted. Orders are never blocked. |
| **L11** | **A provider with fundamentally different semantics is not a zero-thought swap** | E.g. one requiring server-side pre-registered template ids would need a rendering-strategy decision inside `NotificationsModule`. Still **one module** — which is the guarantee that matters. |

---

## 24. Final architecture freeze candidate

### READY FOR ARCHITECTURE FREEZE?

> # **YES — WITH OPEN NON-BLOCKING DECISIONS**

The architecture is internally coherent, evidence-based, and proportional. Every major decision is traceable to a documented finding rather than a preference. Nothing prevents Phase 2 from starting.

### Blocking issues

**NONE for Phase 2.**

**Three documentation corrections require reviewer ratification** (not decision changes — §0.2): the tier count (**4/7/4**, table correct), the port inventory (**six**, `PORTS-AND-CONTRACTS.md` authoritative), and the cosmetic `Money` consumer count.

**One item blocking production, not Phase 2:** **OPEN-006** — instance count. If production runs more than one API instance, **Redis is required before go-live.**

### Non-blocking open items

13 total (§22): 4 business inputs with recorded defaults and safe fallbacks (shipping rates, VAT display, email provider, carriers), 4 product-scope questions (blog, reviews policy, wishlist, VAT), and 5 code-architecture revisit triggers.

**None has an unsafe default.** Each records what happens if it is never answered.

### Phase 2 prerequisites

| # | Prerequisite | Status |
|---|---|---|
| 1 | Architecture freeze approved | ⬜ This review |
| 2 | **MongoDB replica set available in local, CI and staging** | ⬜ **Hardest prerequisite — must not slip** |
| 3 | Cloudinary account provisioned (credentials server-side only) | ⬜ |
| 4 | Email provider chosen (OPEN-004) — or start with `ConsoleEmailSender` | ⬜ |
| 5 | OPEN-006 answered — determines whether Redis enters Phase 2 | ⬜ |
| 6 | Hosting target chosen for the containerised API | ⬜ |

**Phase 2 deliverables:** `apps/api` in the existing Turborepo · `CommonModule` (config validation, pino + requestId, global pipes/filters/interceptors, throttler) · Swagger · Terminus health **with a replica-set assertion** · Dockerfile · **CI — the project's first** (lint → type-check across *all* workspaces → test → build).

> **The gate: a transaction-rollback test proving atomicity in every environment, written before any domain module.** Discovering at commerce-core time that transactions do not work in CI would be extremely expensive.

### Phase 2 must NOT do yet

- ❌ Build domain modules before the transaction-rollback gate passes
- ❌ Introduce Redis (unless OPEN-006 resolves to multi-instance)
- ❌ Build coupons, reviews, blog or notifications before their scope decisions
- ❌ Create a `PaymentPort`, `SmsPort` or any speculative port
- ❌ Add a provider registry, factory or failover
- ❌ Create a generic `BaseRepository` or a `DatabasePort`
- ❌ Force Tier 1 modules into four layers
- ❌ Migrate any legacy data — **there is none to migrate**

### Recommended review focus

If review time is limited, the four highest-leverage sections:

1. **§5 — Order lifecycle.** The most consequential redesign; a wrong transition matrix is expensive to change later.
2. **§6 — Inventory & transactions**, particularly the **replica-set prerequisite** — the one thing that must be right before Phase 2.
3. **§13 — Provider architecture and replacement tests.** The core sustainability claim; verify the guarantees hold.
4. **§0.2 — Conflicts.** Three one-line ratifications.

---

## Appendix — source documents

This dossier synthesises 37 documents, re-read for this purpose:

**Phase 1 (23):** `DOMAIN-MODEL` · `BEHAVIOR-DECISIONS` · `BUSINESS-RULES` · `MONEY-MODEL` · `CATALOG-MODEL` · `ORDER-LIFECYCLE` · `INVENTORY-MODEL` · `CART-MODEL` · `AUTHORIZATION-MODEL` · `GUEST-CHECKOUT` · `DISCOUNT-MODEL` · `SEARCH-MODEL` · `MEDIA-MODEL` · `MONGODB-DESIGN` · `CONSISTENCY-MODEL` · `NESTJS-MODULE-MAP` · `API-CONTRACT` · `API-STANDARDS` · `AUDIT-MODEL` · `REDIS-DECISION` · `OBSERVABILITY` · `PHASE-1-DECISIONS` · `PHASE-1-REPORT`

**Phase 1.1 (14):** `CODEBASE-STRUCTURE` · `DTO-STRATEGY` · `PORTS-AND-CONTRACTS` · `PROVIDER-ARCHITECTURE` · `TEMPLATE-ARCHITECTURE` · `CONFIGURATION-ARCHITECTURE` · `CROSS-CUTTING-STANDARDS` · `DEPENDENCY-RULES` · `TESTING-ARCHITECTURE` · `CODE-STANDARDS` · `ANTI-OVERENGINEERING` · `REPLACEMENT-TESTS` · `PHASE-1.1-DECISIONS` · `PHASE-1.1-REPORT`

**Upstream evidence:** `docs/audit/phase-0-audit.md` · `docs/PHASE-0.5-REPORT.md` · `docs/db/**` · `docs/baseline.md` · `docs/baseline-test-cases.md`

**Requirements:** `PRODUCT.md` · `.project_plan/PROJECT_OVERVIEW.md` · `.project_plan/plan_business_logic.md`

---

**END OF DOSSIER** — awaiting architecture review. No Phase 2 work has begun; no implementation code, dependency, schema or configuration file has been created.
