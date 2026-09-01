# PHASE 0.5 — SUPABASE LIVE FORENSIC EXTRACTION & BEHAVIOURAL BASELINE

**Project:** Nest Electronics · **Supabase ref:** `quhllllvwwuizjfrxvdz` · **PostgreSQL 17.6** (eu-west-1)
**Extraction date:** 2026-08-29
**Scope:** strictly read-only forensic extraction of the live production environment.

### Method & safety attestation

| | |
|---|---|
| **Access path used** | Direct PostgreSQL connection via the pooler URL already present in `.mcp.json`, plus the public `GET /auth/v1/settings` endpoint using the anon key from `apps/storefront/.env.local` |
| **Read-only enforcement** | Every statement ran inside `BEGIN TRANSACTION READ ONLY` and was always followed by `ROLLBACK`. PostgreSQL itself rejects any INSERT/UPDATE/DELETE/DDL in such a transaction — this is server-side enforcement, not a client-side convention. |
| **Writes performed** | **None.** No row inserted, updated or deleted. No schema object created, altered or dropped. No policy, function, trigger, user, bucket or configuration modified. No file uploaded or deleted. No function was *executed* — all function behaviour was recovered from `pg_get_functiondef()` source. |
| **Credentials** | Only credentials already present in the project environment were used. **No secret value appears anywhere in this report or its companion documents.** |
| **Access failure of note** | The `SUPABASE_ACCESS_TOKEN` documented in `.project_plan/PROJECT_OVERVIEW.md` returns **HTTP 401 — revoked**. The Management API was therefore unavailable; all findings come from the database and the public settings endpoint. |
| **Tooling** | A temporary read-only query runner in the OS temp directory. **No project file, dependency, lockfile or configuration was modified.** |

### Deliverables produced

```
docs/
├── db/  schema.sql · schema-summary.md · functions.sql · functions-analysis.md
│        triggers.sql · triggers-analysis.md · policies.sql · policies-analysis.md
│        indexes.sql · indexes-analysis.md · data-integrity.md
├── storage/inventory.md
├── auth/current-auth.md
├── migration/supabase-to-nest-mapping.md
├── baseline.md · baseline-test-cases.md
└── PHASE-0.5-REPORT.md   (this file)
```

---

## 1. What was successfully verified

Every `UNKNOWN` that Phase 0 identified as a hard blocker has been resolved.

| Area | Result |
|---|---|
| **Schema** | 28 tables, 232 columns, 40 FKs, 28 PKs, 15 unique constraints, 13 CHECK constraints, **0 enum types**, **0 views**, **0 materialized views**, 1 sequence, 67 indexes |
| **Functions** | **53 total; 10 custom in `public`** — all extracted verbatim, including a previously unknown `create_order_v1` |
| **Triggers** | 10 non-internal (6 application-relevant) + 6 platform event triggers |
| **RLS** | **Enabled on all 28 tables**; 52 public + 6 storage policies, all extracted |
| **Indexes** | 67 extracted with live `idx_scan` usage statistics |
| **Scheduled jobs** | `pg_cron` v1.6.4, 1 active job, 35,309 execution records |
| **Storage** | **4 buckets** (not 1), all public, with MIME/size limits; **2 objects, 204 KB total** |
| **Auth** | Provider config, user population, hash format, identity providers, session model |
| **Data** | Row counts, null rates, orphan checks, duplicate checks, reconciliation totals |
| **Realtime / Edge Functions / webhooks** | Determined conclusively — see §7 |

**Corrections to Phase 0:** 40 FKs (not 39); `adjust_product_stock` **does not exist** at all; the storage bucket `images` **does not exist**; `create_order_v1` exists and was unknown; there are **4** storage buckets.

---

## 2. Critical business logic recovered

The complete, verified contract of what the system does today. Full traces: [`db/functions-analysis.md`](./db/functions-analysis.md), [`baseline.md`](./baseline.md).

| # | Rule | Verified behaviour |
|---|---|---|
| 1 | Order pricing | `COALESCE(sale_price, base_price)`, read **server-side**; client prices discarded ✅ |
| 2 | Variant pricing | `base_price + price_modifier` — **ignores `sale_price`** |
| 3 | **Order total** | **`total = subtotal + shipping_fee`.** No discount term. No tax term. No coupon logic exists anywhere. |
| 4 | Order number | `NE-YYYYMMDD-NNNN` from a **global** sequence, never reset per day (live `last_value = 10`) |
| 5 | Initial statuses | `processing` / `pending` / `unfulfilled` — **never `pending_payment`** |
| 6 | Stock on checkout | **`stock_quantity` decremented directly. `reserved_quantity` is never touched by any code path.** |
| 7 | Stock guard | `WHERE stock_quantity >= quantity` inside the UPDATE — race-safe ✅ |
| 8 | Checkout atomicity | Full — any error rolls back the entire order ✅ |
| 9 | Active/deleted check at checkout | **None.** Inactive and soft-deleted products are purchasable. |
| 10 | Quantity floor at checkout | **None.** `order_items` has no `quantity > 0` constraint. |
| 11 | Status transitions | **Not validated in the database.** The matrix exists only in app code. |
| 12 | Stock on cancellation | **Never restored.** No compensating ledger entry. |
| 13 | Tracking number | **Cannot be stored — `orders.tracking_number` does not exist.** |
| 14 | Stock adjustment | Signed delta, floor 0, ledger `type='adjustment'`, `created_by` populated |
| 15 | Profile provisioning | Trigger; `role` defaults to `customer`; `full_name` falls back to the email address |
| 16 | `updated_at` | Trigger on **5 of 28** tables — the only 5 that have the column |
| 17 | Admin check | `is_admin()`; `admin` and `super_admin` treated **identically** |
| 18 | Search sort | Hard-coded `rank, is_featured, created_at` — **no sort parameter exists** |
| 19 | Category filter | **Exact slug match — no subtree.** Parent-category pages omit child products. |
| 20 | Reservation expiry | Scheduled and running, but **structurally unreachable** |

---

## 3. Database functions recovered

| Function | SECURITY DEFINER | EXECUTE granted to | Status |
|---|---|---|---|
| `create_order_v2` | **YES** | **`PUBLIC`, anon, authenticated** | Live checkout path — fully recovered |
| `update_order_status_v2` | **YES** | **`PUBLIC`, anon, authenticated** | Live admin path — fully recovered |
| `adjust_stock_v2` | **YES** | **`PUBLIC`, anon, authenticated** | Live but **never successfully executed in production** |
| `create_order_v1` | **YES** | **`PUBLIC`, anon, authenticated** | **Unknown to Phase 0.** Orphaned legacy; trusts client-supplied prices |
| `search_products` | no | public | All catalogue listing |
| `generate_order_number` | no | public | Column default + v2 |
| `is_admin` | **YES** | public | Backs **28 RLS policies**; never called by app code |
| `handle_new_user` | **YES** | postgres/service_role | Trigger — profile provisioning |
| `handle_updated_at` | no | postgres/service_role | Trigger — timestamps |
| `release_expired_reservations` | **YES** | postgres/service_role | Cron — **no-op** |

`adjust_product_stock`, listed by Phase 0 as a dead RPC, **does not exist**; the call at `product.provider.ts:121` would fail outright.

---

## 4. Hidden trigger behaviour

**Far less hidden logic than expected — one item only.**

- **`on_auth_user_created` → `handle_new_user()`** is the sole business trigger. It creates the `profiles` row, defaults `role` to `customer`, and falls back `full_name` to the email address. Live integrity is perfect: 4 users ↔ 4 profiles, 0 orphans.
- **`handle_updated_at`** on 5 tables — and **23 tables have no `updated_at` column at all**, which is the root cause of the Phase 0 "type drift" writes to `categories`/`brands` failing silently.

**Verified absences that matter more than the presences:** there is **no** rating-rollup trigger, **no** inventory/ledger consistency trigger, **no** order-total recalculation, **no** audit trigger, **no** status-history trigger, and **no** stock restoration. Every one of those invariants is maintained only by cooperating function code — so any write that bypasses those functions bypasses the invariant.

---

## 5. RLS / authorization model

**Fully recovered — and the headline is nuanced.**

**The policy layer is largely well built.** RLS is enabled on all 28 tables with 52 coherent, consistently `is_admin()`-based policies. Both of Phase 0's flagged security unknowns resolve **in the system's favour**:

- **H1 (guest order data exposure): NOT a breach.** `orders_own_read USING ((auth.uid() = user_id) OR is_admin())` returns **zero rows** to anonymous callers. Guest order tracking is **silently broken**, not leaking. Order-number enumeration is not exploitable through this path.
- **H6 (role self-escalation): BLOCKED.** `profiles_update_own WITH CHECK ((auth.uid() = id) AND (role = 'customer'))` prevents a customer from promoting themselves.

**But the policy layer is not the system's effective security boundary** — see §12.

New policy-layer defects found: `profiles` has **no INSERT policy** for non-admins while the app performs a browser `upsert` (customer profile save fails); `recently_viewed_own` is effectively world-writable; and 7 catalogue child tables use `SELECT USING (true)`, exposing images and attributes of hidden products.

---

## 6. Data integrity findings

**No blocking integrity issue exists.** Every orphan, duplicate and constraint check returned zero violations.

| | |
|---|---|
| **Scale** | ≈200 business rows total; **12 of 28 tables completely empty** |
| Users | 4 (3 customer + 1 super_admin; **no `admin`-role user has ever existed**) |
| Products | 85 · Categories 27 · Brands 17 |
| Orders | 10 · Σ total **7,367.00** · Σ discount/shipping/tax **0.00** |
| Order items | 7 · Σ 1,867.00 · Σ quantity 11 |
| **`admin_audit_logs`** | **0 rows** — the audit trail has never recorded anything |
| **`product_images`** | 22 rows, of which **20 are `placehold.co` placeholders**; 74% of products have no image |
| **`*_ar` fields** | **100% NULL across all 85 products** — the bilingual schema carries zero data |
| EAV tables | `attribute_values` and `product_attribute_values` both **empty** |
| Anomaly | **3 of 10 orders have totals but no line items** (seed batch, inserted directly) |
| Ledger | Does not reconcile to stock — no opening-balance entries exist |

---

## 7. Realtime / Edge Functions / other services

Determined conclusively, not assumed:

| Service | Exists? | Used by the application? | Migration requirement |
|---|---|---|---|
| **Realtime** | Publication `supabase_realtime` exists | **No — zero tables published** | **None** |
| **Edge Functions** | **Not detected** — no `supabase_functions` schema, no `supabase/functions/` directory | No | **None** |
| **Database webhooks** | **Not detected** — `pg_net`/`http` extensions not installed | No | **None** |
| **Scheduled jobs** | **Yes** — `pg_cron` v1.6.4, one job every 5 min | Yes, but a verified **no-op** | Do not port as-is |
| `pg_graphql`, `supabase_vault`, `pg_stat_statements`, `pgcrypto`, `uuid-ossp` | Installed (platform defaults) | No | None |

---

## 8. Auth findings

| | |
|---|---|
| **Providers** | Email/password **only**. **Google OAuth is DISABLED** (`external.google = false`); 0 Google identities have ever existed — the "Continue with Google" button is non-functional |
| **Email confirmation** | **Required** (`mailer_autoconfirm = false`) — and registration redirects into a guarded route without a session, so the flow dead-ends at `/login` |
| **Signup** | Open (`disable_signup = false`) |
| **🟢 Password hashes** | **bcrypt `$2a$`, 60 chars, on all 4 users — directly portable.** Verified by format only; no hash value was read |
| **Roles** | Stored in `profiles.role`, **not** in JWT claims → a DB lookup on every request (`profiles_pkey` is the hottest index at 2,719 scans) |
| **MFA / SSO / passkeys** | None enrolled, none enabled |
| **Sessions** | 16 refresh tokens, 9 revoked. **Token TTLs UNKNOWN** (project-level setting; not blocking) |
| **Password reset** | Broken in code; `auth.flow_state` empty — has never completed for any user |

**This closes migration risk R3.** Migration can be **transparent**: copy the hashes, verify with `bcrypt.compare`. No forced password reset, no customer churn at cutover.

---

## 9. Critical unknowns

**No technical unknown remains that blocks implementation.** What remains is either non-blocking or is a product decision.

### Non-blocking technical unknowns

| Unknown | Why it does not block | How to obtain safely |
|---|---|---|
| Access/refresh token TTLs, GoTrue password minimum, email templates, GoTrue rate limits | NestJS defines its own | Supabase Dashboard, or Management API with a **new** PAT (the documented one is revoked) |
| Whether the customer profile-save failure reproduces at runtime | Inferred with high confidence from the policy set; the fix (remove browser DB access) is required regardless | Sign in as a test **customer** (not the super_admin) and save the profile form |

### Product decisions that gate Phase 1

These are unchanged from Phase 0 — but several can now be decided **on evidence**:

| # | Decision | New evidence from Phase 0.5 |
|---|---|---|
| 1 | **Money representation** — integer minor units vs Decimal128 | Live type is `numeric(10,2)`. **Blocks schema authoring.** |
| 2 | **Shipping model** | Always `0` in every order ever placed |
| 3 | **VAT / tax** | Always `0`; the PDP already claims "Price includes VAT" |
| 4 | **Coupons — build or drop?** | 0 coupons, no redemption code, no public read policy |
| 5 | **Reviews — build or drop?** | 0 reviews; ratings render 0 because the columns don't exist |
| 6 | **Notifications — build or drop?** | Table empty; UI shows mock data |
| 7 | **Product variants — real or speculative?** | 0 variants; the variant pricing path has a `sale_price` bug |
| 8 | **Arabic / i18n — commit or drop?** | **100% NULL on all 85 products** — decidable now |
| 9 | **Inventory reservations — implement or drop?** | Never functioned; cron has run 35,309 no-op times |
| 10 | **Order numbers — per-day reset? enumerable?** | Sequence is global, not per-day |
| 11 | **Cart merge strategy — max or sum?** | Never exercised; 0 guest carts exist |
| 12 | **Cancellation — restock always, or only pre-shipment?** | Today: never restocks |

---

## 10. Migration risks — updated

| Risk | Phase 0 | **Now** | Basis |
|---|---|---|---|
| **R1** undocumented RPCs | 🔴 Critical / High | 🔴 **Critical, probability much reduced** | Fully recovered and specified; risk is now correct *reimplementation*, mitigated by differential tests |
| **R2** RLS → guards | 🔴 Critical / High | 🟠 **High** | All 52 policies extracted and translated |
| **R3** password migration | 🟠 High | 🔵 **Low — RESOLVED** | bcrypt hashes are portable |
| **R5** image migration | 🟠 High | 🔵 **Low** | 2 files, 204 KB |
| **R6** order/stock integrity | 🔴 Critical | 🔵 **Low** | 10 orders, zero corruption, reconciliation figures captured |
| **R8** 4 client-side rewrites | 🟠 High | 🟠 **High (unchanged)** | Still rewrites |
| **R9** defects misattributed | 🟡 Medium | 🔵 **Low** | 20 known-broken features documented |
| **R11** MongoDB replica set | 🟠 High | 🟠 **High (unchanged)** | Checkout is genuinely transactional |
| **R14** exposed secrets | 🟠 High | 🔴 **Critical** | The documented PAT is **already revoked** — proof that credential exposure has had real consequences. The DB password and service-role key remain live. |
| **R15** zero tests | 🟠 High | 🟠 **High (unchanged)** | 103 cases specified, none implemented |
| **NEW** unauthenticated RPCs | — | 🔴 **Critical** | §12 |

---

## 11. Required architecture changes

Beyond the Phase 0 plan, the live evidence mandates:

1. **Order creation must add what the database never did** — quantity floor, active/deleted check, caller-identity binding, idempotency. It is not a straight port.
2. **The order status machine must move into the server.** The DB validates nothing; the app-side matrix is not an enforcement boundary while the RPC is callable by `anon`.
3. **Cancellation must restore stock** — a genuinely new behaviour with a compensating ledger entry.
4. **`trackingNumber` must exist** as a real field.
5. **Search must be rebuilt, not ported** — sort, correct totals, subtree categories, images/brand/rating, facets.
6. **Ledger must gain opening balances** so `Σ ledger = onHand` becomes assertable.
7. **Role belongs in the JWT** — removes the hottest query in the system.
8. **Real `super_admin` separation** — the distinction has never existed in practice.
9. **Child resources must inherit parent visibility** — fixes the `USING (true)` leak on 7 tables.
10. **Audit must be system-written and loud on failure** — it has produced zero records to date.
11. **Embed the four unindexed relationships** (`order_items`, `order_status_history`, `product_images`, `addresses`) — this independently validates the proposed document model and fixes real sequential scans.
12. **Reservations: implement deliberately or delete the concept** — including the `reserved_quantity` columns and the cron job.

---

## 12. 🔴 CRITICAL SECURITY FINDING — requires action independent of the migration

**This was not visible to Phase 0 and outranks every migration concern.**

`create_order_v2`, `create_order_v1`, `update_order_status_v2` and `adjust_stock_v2` are simultaneously:

1. **`SECURITY DEFINER`** — they run as the owner and **bypass every RLS policy**;
2. granted **`EXECUTE` to `anon`, `authenticated` and `PUBLIC`**;
3. **completely devoid of authorization checks** — no `auth.uid()`, no `is_admin()`, no argument-to-caller comparison.

PostgREST exposes every `public` function at `POST /rest/v1/rpc/<name>`, and the anon key is published in the browser bundle by design. Therefore **any unauthenticated party can**:

| Call | Effect |
|---|---|
| `update_order_status_v2` | Set **any** order to **any** status; forge `order_status_history` entries attributed to any admin |
| `adjust_stock_v2` | Set **any** product's stock to any non-negative value; forge ledger entries |
| `create_order_v2` | Create orders for **any** `user_id`, decrementing real stock |
| `create_order_v1` | The same, **plus** dictate the price, name and SKU written to `order_items` — e.g. a 0.00 order |

**Established entirely from catalog metadata** (`prosecdef`, `proacl`, function source). **No function was executed and no data was modified.**

The excellent RLS work is irrelevant to this: `SECURITY DEFINER` bypasses RLS by definition, so these four functions constitute a complete parallel write path around the entire policy model.

**Remediation is out of scope for this read-only phase**, but it is small and should not wait for the migration:

```
-- Illustrative only. NOT executed. Review before running.
REVOKE EXECUTE ON FUNCTION public.create_order_v2(uuid,jsonb,jsonb,text,numeric)        FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_order_status_v2(uuid,text,text,uuid,text,text)  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_stock_v2(uuid,integer,text,uuid,text)           FROM anon, authenticated, PUBLIC;
DROP FUNCTION IF EXISTS public.create_order_v1(uuid,jsonb,jsonb,text,numeric,numeric,numeric);
```

⚠ **`create_order_v2` is on the live checkout path.** Revoking it from `authenticated` breaks checkout unless the Server Action is first moved to the service-role client. Sequence the change deliberately; do not apply it blind.

**Also outstanding from Phase 0 §13/§14, and now more urgent:** the committed Anthropic key, the database password in `.mcp.json`, and the service-role key shipped with the storefront all still require rotation. The Supabase PAT being **already revoked** is direct evidence that exposure here has had consequences.

---

## 13. HARD GATE DECISION

### Gate criteria

| # | Required | Status | Evidence |
|---|---|---|---|
| 1 | Critical **order creation** behaviour understood | ✅ **YES** | `create_order_v2` recovered verbatim; full step trace; 7 defects catalogued |
| 2 | Critical **order status** behaviour understood | ✅ **YES** | `update_order_status_v2` recovered; no transition validation, no stock restoration, tracking-number bug |
| 3 | Critical **inventory** behaviour understood | ✅ **YES** | `adjust_stock_v2` recovered; reservation subsystem proven inoperative |
| 4 | Important **authorization / RLS** behaviour understood | ✅ **YES** | All 52 policies extracted; H1 and H6 resolved; the RPC bypass identified |
| 5 | **Schema and relationships** sufficiently known | ✅ **YES** | 28 tables, 232 columns, 40 FKs, 13 CHECKs, 67 indexes, 0 enums/views |
| 6 | Critical **storage** behaviour understood | ✅ **YES** | 4 buckets, policies, 2 objects, path convention, URL provenance |

**All six gate criteria are satisfied by direct evidence.**

### Verdict

```
READY FOR NESTJS
```

**Qualified by three conditions**, none of which reopens the gate:

1. **Condition A — security remediation runs in parallel, starting now.** §12 is a live production vulnerability, not a migration task. It must not be scheduled behind Phase 6.
2. **Condition B — the money-representation decision (§9.1) must be made before any schema is authored.** It does not block Phase 2 (NestJS foundation), but it blocks Phase 3.
3. **Condition C — scope decisions §9.4–9.9 must be settled before Phase 1 completes**, to prevent the scope creep Phase 0 flagged as R16. Each can now be decided on evidence rather than speculation.

**Why this is `YES` and not `BLOCKED`:** Phase 0 could not specify the system because its load-bearing logic was invisible. That is no longer true — the three `_v2` functions are recovered verbatim, the authorization model is fully extracted, and the behavioural baseline is documented. The remaining uncertainty is *product intent*, not *system behaviour*, and product intent is decided rather than discovered.

**The one caveat worth stating plainly:** roughly **as many behaviours need fixing as need preserving** (38 vs 37 in the 103 catalogued cases). This is **not a port**. Any plan that assumes "reproduce the current behaviour" will faithfully reproduce a large set of defects. [`baseline-test-cases.md`](./baseline-test-cases.md), not the existing code, is the specification.

---

## 14. ARCHITECT HANDOFF

### VERIFIED CORE FLOWS

- **Registration** — browser `signUp` → GoTrue (confirmation **required**, no session issued) → `on_auth_user_created` → `handle_new_user()` → `profiles` row with `role='customer'`, `full_name` falling back to email, `phone` NULL. UI then redirects into a guarded route and bounces to `/login`. **Broken UX.**
- **Login** — browser `signInWithPassword` → bcrypt verify → JWT cookies. Role resolved by a `profiles` **table lookup on every request**, not from the token.
- **Discovery** — `search_products` RPC: fixed sort, no total count, exact category slug (no subtree), returns 12 scalars with no images/brand/rating. Its GIN index is **never used** because `ILIKE` OR-branches force a sequential scan.
- **Cart** — localStorage is the cart of record. The server cart is **write-only** and **cannot compute a subtotal** (`cart_items` has no price column). Two contradictory merge strategies exist; neither has ever run (0 guest carts).
- **Checkout** — `create_order_v2`: server-side pricing ✅, atomic ✅, direct `stock_quantity` decrement, `total = subtotal + shipping`, no discount/tax/coupon, no active-or-deleted check, no quantity floor, no caller-identity binding.
- **Order status** — `update_order_status_v2`: row-locks ✅, writes history ✅, **validates no transition**, **restores no stock**, and **fails entirely if a tracking number is supplied**.
- **Stock adjustment** — `adjust_stock_v2`: signed delta, floor 0, ledger with actor. **Has never successfully completed in production.**
- **Guest tracking** — RLS returns **zero rows** to anonymous callers. **Dead feature, not a leak.**

### CRITICAL BUSINESS RULES

1. Price = `COALESCE(sale_price, base_price)`; variants use `base_price + price_modifier` and **ignore `sale_price`**
2. **`total = subtotal + shipping_fee`** — discount and tax are always 0; **no coupon logic exists**
3. Order number `NE-YYYYMMDD-NNNN` from a **global** sequence
4. Orders start `processing` / `pending` / `unfulfilled`
5. Checkout decrements **`stock_quantity`**; `reserved_quantity` is never used
6. Insufficient stock aborts the **entire** order (full rollback) — **the most important invariant to preserve**
7. Order line prices/names/SKUs are immutable snapshots
8. Status transitions are validated **only in app code**
9. Cancellation **never** restores stock
10. `role` defaults to `customer` and cannot be self-elevated (RLS `WITH CHECK`)
11. `is_admin()` treats `admin` and `super_admin` identically
12. Every stock change *should* write a ledger row — **nothing enforces it**

### ORDER CREATION CONTRACT

```
IN   userId (from JWT — never the body), items[{productId, variantId?, quantity}],
     shippingAddress, paymentMethod, shippingFee
DO   validate quantity > 0                       [NEW — missing today]
     validate product isActive && !deletedAt     [NEW — missing today]
     price server-side: sale ?? base             [PRESERVE]
     apply coupon                                [NEW — never existed]
     subtotal - discount + shipping + tax        [EXTEND: today subtotal + shipping]
     generate NE-YYYYMMDD-NNNN                   [PRESERVE format; decide reset semantics]
     conditional stock decrement (no oversell)   [PRESERVE]
     insert order + items (price snapshots)      [PRESERVE]
     write ledger row per line, WITH actor       [PRESERVE + FIX created_by]
     ALL INSIDE ONE TRANSACTION                  [PRESERVE — non-negotiable]
OUT  {id, orderNumber}
ERR  "Insufficient stock for product <sku>" · "Product not available" · "Cart is empty"
```

### ORDER STATUS CONTRACT

```
order_status:       pending_payment -> paid|cancelled|failed ; paid -> processing|cancelled
                    processing -> shipped ; shipped -> delivered
payment_status:     pending -> paid|failed ; paid -> refunded
fulfillment_status: unfulfilled -> processing -> shipped -> delivered|returned

ENFORCE the matrix server-side and atomically      [NEW]
ALWAYS append statusHistory{field, from, to, actor, notes, at}   [PRESERVE]
PERSIST trackingNumber                              [NEW — column doesn't exist today]
RESTORE stock on cancellation + compensating ledger [NEW — decide: always, or pre-shipment only]
actor from JWT, never from the request body         [FIX]
```

### INVENTORY CONTRACT

```
adjust(productId, delta: signed, reason: min 3 chars, actor from JWT)
  -> onHand + delta, floor 0 (and never below reserved)
  -> ALWAYS write a ledger row {type, quantity: delta, before, after, actor, reference}
INVARIANT: sum(ledger.quantity) == onHand   [NEW — needs synthetic opening balances at migration]
RESERVATIONS: do not port. Implement deliberately or delete the concept.
```

### AUTHORIZATION MODEL

```
TODAY:  JWT -> profiles.role lookup (every request) -> RLS via is_admin()
        ...and 4 SECURITY DEFINER RPCs granted to anon bypass ALL of it.

TARGET: JWT (role as a claim) -> JwtAuthGuard -> RolesGuard -> OwnershipGuard -> Service
        - admin vs super_admin genuinely separated
        - userId always from the token, never from the body
        - child resources inherit parent visibility
        - audit written by an interceptor, never by the audited principal
```

### DATA MODEL FINDINGS

- **≈200 business rows; 12 of 28 tables empty.** Migration volume is trivial.
- **EAV tables are empty** — the attribute redesign is unconstrained by data.
- **All `*_ar` fields are 100% NULL** — i18n is a live product decision, not a data-migration problem.
- **Zero referential corruption.** 40 FKs and 13 CHECKs are holding.
- **3 of 10 orders have totals but no line items** (seed artefact) — migrate verbatim.
- **`admin_audit_logs` is empty** — nothing to migrate.
- **2 real image files**; 20 of 22 image rows are `placehold.co` placeholders.
- **4 unindexed hot relationships** (`order_items`, `order_status_history`, `product_images`, `addresses`) are exactly the ones the document model embeds.
- Money is `numeric(10,2)`; UUID PKs should be preserved as `_id` strings.

### MIGRATION BLOCKERS

**Technical blockers: NONE remaining.** All six hard-gate criteria are satisfied.

**Outstanding conditions:**

| # | Item | Blocks |
|---|---|---|
| 1 | 🔴 Unauthenticated `SECURITY DEFINER` RPCs (§12) | **Nothing — but fix immediately, in parallel** |
| 2 | 🔴 Credential rotation (Anthropic key, DB password, service-role key) | Nothing — but overdue; the PAT is already revoked |
| 3 | Money representation decision | **Phase 3** (schema authoring) |
| 4 | Scope decisions: coupons, reviews, notifications, variants, i18n, reservations | **Phase 1** completion |
| 5 | MongoDB replica set / Atlas M10+ approval | **Phase 3** — hard infrastructure requirement |
| 6 | Shipping and VAT models | **Phase 6** (order pricing) |

### RECOMMENDED NEXT IMPLEMENTATION STEP

1. **Immediately, outside the migration:** remediate §12 (revoke the four RPC grants, drop `create_order_v1`, add internal authz checks — sequencing `create_order_v2` carefully because it is on the live checkout path), and rotate the exposed credentials.
2. **Then Phase 1 — Domain Modelling & Contract Design**, which can now be written against verified behaviour rather than assumptions:
   - `docs/business-rules.md` seeded directly from §2 and [`baseline-test-cases.md`](./baseline-test-cases.md), with each of the 103 cases marked PRESERVE / FIX / DECIDE
   - `openapi.yaml` for the surface in Phase 0 §10.5
   - the 12 product decisions in §9 resolved and recorded
3. **Then Phase 2 (NestJS foundation + the project's first CI)** — no blocking dependency on the decisions above.

**Phase 0.5 is complete. No NestJS code was written, no MongoDB introduced, no Cloudinary configured, no Next.js file touched, no Supabase object modified, and no discovered bug fixed.**
