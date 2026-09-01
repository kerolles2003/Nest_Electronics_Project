# Live Data Shape & Integrity Inspection — Phase 0.5

**Source:** live production database, project ref `quhllllvwwuizjfrxvdz`, PostgreSQL 17.6.
**Extraction:** 2026-08-29, aggregate read-only queries only.

> **Privacy:** this document contains **aggregates and counts only**. No customer name, email, phone number, address, password hash or token value was read into or reproduced in this report. Order numbers are included because they are non-personal system identifiers.

---

## 1. Headline: this is a development-scale dataset

| Aspect | Reality |
|---|---|
| Total business rows across all 28 tables | **≈ 200** |
| Real customers | **3** (+1 `super_admin`) |
| Orders ever placed | **10** — 7 via the order functions, 3 seeded directly |
| Real uploaded images | **2 files, 204 KB total** |
| Empty tables | **12 of 28** |
| Data-loss risk in migration | **Very low** — the volume is trivial |
| Confidence that migration testing reflects production | **Low** — there is not enough data to exercise most code paths |

**Implication for the migration plan.** Phase 0 rated data migration a significant risk (R6). Against this dataset it is not: the entire database could be migrated by hand. The genuine risks are **behavioural**, not volumetric — there is almost no production data to validate the new implementation against, so the differential testing proposed in Phase 0 §23 must be driven by **synthesised** scenarios, not by replaying production rows.

---

## 2. Row counts (VERIFIED)

| Table | Rows | Note |
|---|---|---|
| `products` | 85 | |
| `categories` | 27 | 17 roots, 10 children, max depth 2 |
| `brands` | 17 | |
| `product_images` | 22 | only 2 point at real storage — §6 |
| `attributes` | 9 | definitions only |
| `orders` | 10 | |
| `order_status_history` | 8 | |
| `order_items` | 7 | |
| `inventory_transactions` | 7 | all `type='sale'` |
| `blog_posts` | 6 | all published |
| `cart_items` | 4 | |
| `auth.users` / `profiles` | 4 / 4 | 0 orphans either way |
| `carts` | 2 | |
| `addresses` | 1 | |
| **`admin_audit_logs`** | **0** | 🔴 §5 |
| **`attribute_values`** | **0** | EAV never populated |
| **`product_attribute_values`** | **0** | EAV never populated |
| `coupons`, `reviews`, `wishlists`, `notifications`, `recently_viewed`, `product_variants`, `product_tags`, `product_compatibility`, `review_images`, `review_votes`, `slug_redirects` | **0** | 11 further empty tables |

**12 of 28 tables are completely empty.** Phase 0 identified 7 tables as "never touched by code"; the live data confirms those 7 and adds 5 more that code *can* write but never has: `admin_audit_logs`, `coupons`, `wishlists`, `slug_redirects`, `attribute_values`/`product_attribute_values`.

---

## 3. Referential integrity — clean

Every check returned **zero** violations:

| Check | Result |
|---|---|
| `order_items` → `orders` orphans | **0** |
| `order_items` → `products` orphans | **0** |
| `orders` → `profiles` orphans | **0** |
| `profiles` → `auth.users` orphans | **0** |
| `auth.users` without a `profiles` row | **0** — the `handle_new_user` trigger is working |
| `products` → `categories` orphans | **0** |
| `cart_items` → `carts` orphans | **0** |
| Duplicate `products.sku` / `products.slug` | **0 / 0** |
| Duplicate `orders.order_number` | **0** |
| Duplicate `auth.users.email` (case-insensitive) | **0** |
| Products where `sale_price >= base_price` | **0** |
| Products with `base_price <= 0` | **0** |
| `order_items` with `quantity <= 0` or `price < 0` | **0** — the F-CRIT-3 negative-quantity flaw has **not** been exploited |
| Products with `stock_quantity < 0` | **0** |
| Products where `reserved_quantity <> 0` | **0** |
| Users with >1 default address | **0** (only 1 address exists — B24 is untested by data) |
| Status values outside their CHECK vocabulary | **0** |

The 40 foreign keys and 13 CHECK constraints are doing their job. **There is no relational corruption to clean up before migration.**

---

## 4. 🟠 Three orders have totals but no line items

| Order | Status | Subtotal | Total | Items | History rows |
|---|---|---|---|---|---|
| `NE-20260429-0001` | failed / failed | 1250.00 | 1250.00 | **0** | 0 |
| `NE-20260429-0002` | processing / pending | 3400.00 | 3400.00 | **0** | 0 |
| `NE-20260429-0003` | delivered / paid | 850.00 | 850.00 | **0** | 0 |

All three share the identical creation timestamp `2026-04-29 19:57:51.242199+00` — a **seed batch inserted directly**, bypassing `create_order_v2` (which always writes at least the order/item pair it processes).

**Consequences:**

- `subtotal` cannot be reconciled against `order_items` for 3 of 10 orders (30%).
- The dashboard's "top products" rollup silently under-counts, because it aggregates `order_items`.
- `NE-20260429-0001` is almost certainly the one artefact of the `release_expired_reservations` cron job actually firing: it is the only `failed`/`failed` order, it has **no status-history row** (the cron writes none), and the cron is the only code path that sets that exact status pair. That makes it the sole evidence that the reservation job's code path can execute at all — see [`functions-analysis.md`](./functions-analysis.md) §10.

**Migration handling:** migrate these three **verbatim**. Orders are historical fact; do not recompute totals to "fix" them (Phase 0 §22.3 already mandates this). Flag them in `docs/baseline.md` so post-migration reconciliation does not treat the mismatch as a migration defect.

---

## 5. 🔴 The admin audit trail is completely empty

`admin_audit_logs`: **0 rows** — despite 10 orders, 8 status transitions, 85 products and an active `super_admin`.

This is live confirmation of Phase 0 **M9 / B32**, and the root cause is now verified:

1. `apps/admin/src/lib/audit/log-action.ts` inserts a `user_agent` column.
2. **`admin_audit_logs` has no `user_agent` column** (verified against `information_schema.columns`).
3. PostgREST *returns* the error in the response object rather than throwing, so the surrounding `try/catch` never fires and nothing is logged.
4. RLS is **not** the cause — `audit_logs_admin_insert WITH CHECK (is_admin())` would have permitted the write.

The `/admin/audit-log` page therefore renders an empty table that looks like "no admin activity yet" rather than a broken subsystem. `admin_audit_logs` also shows **61 sequential scans** — the page is being viewed, and it has never had anything to show.

**Migration handling:** there is no audit history to migrate. Start fresh in `AuditModule`, and make audit-write failure a **loud** error (Phase 0 §18).

---

## 6. 🟠 The catalogue is largely image-less, and 91% of images are placeholders

| Metric | Value |
|---|---|
| Products | 85 |
| **Products with zero images** | **63 (74%)** |
| Max images on any product | **1** |
| `product_images` rows | 22 |
| Rows pointing at real Supabase Storage | **2** |
| Rows pointing at `placehold.co` | **20 (91%)** |
| Actual files in Storage | **2 objects, 204 KB** |
| Products with no primary image | 0 |
| Products with >1 primary image | 0 |

**Migration handling:** the "image migration" work item (Phase 0 R5, rated High/Medium) is in reality **two files**. The 20 `placehold.co` URLs are external placeholders that should **not** be copied into Cloudinary — they should be dropped and the products left image-less, or replaced with real assets as a content task. This substantially de-risks Phase 5.

The `is_primary` invariant is clean, so Phase 0 B25 (non-atomic primary flip) has not caused damage — it simply has not been exercised.

---

## 7. Field population / null rates (85 products)

| Field | Populated | Reading |
|---|---|---|
| `description_en` | 85/85 (100%) | |
| **`name_ar`** | **0/85 (0%)** | 🔵 **Arabic is entirely unused** |
| **`description_ar`** | **0/85 (0%)** | 🔵 same |
| `seo_title` | 0/85 (0%) | SEO fields never filled |
| `category_id` | 85/85 (100%) | |
| `brand_id` | 32/85 (38%) | 53 products have no brand |
| `cost_price` | 2/85 (2%) | margin reporting impossible |
| `weight` | 2/85 (2%) | shipping-by-weight impossible |
| `dimensions` | 2/85 (2%) | |
| `sale_price` | 10/85 (12%) | 10 products on sale, all correctly cheaper than base |
| `low_stock_threshold` | 85/85 (100%) | |

### 🔵 This answers Phase 0 open question 15 (Arabic fields)

Every `*_ar` column across `products` is **NULL in 100% of rows**. Combined with Phase 0's observation that no UI renders them, the evidence is unambiguous: **the bilingual schema is aspirational and carries zero data.**

**Recommendation for Phase 1:** either commit to i18n as a product decision and design it properly (locale-keyed sub-documents), or **drop the `*_ar` columns from the MongoDB model entirely**. Carrying 100%-null duplicated fields into the new schema would be pure cost. This is now a decision that can be made on evidence rather than speculation.

---

## 8. Inventory ledger reconciliation — the ledger is not a complete audit

Only **4 of 85 products** have any ledger history. For those four:

| SKU | Current `stock_quantity` | Ledger net | Reconciles? |
|---|---|---|---|
| `KY012` | 7 | −4 | ✗ |
| `NEST-DIGITAL--330` | 22 | −2 | ✗ |
| `NEST-HC-SR04--599` | 59 | −4 | ✗ |
| `RPI-PICO-W` | 149 | −1 | ✗ |

**This is expected, not corruption.** Opening stock was seeded by direct `INSERT`/`UPDATE` with no corresponding ledger entry, so `stock_quantity ≠ Σ(ledger)`. The ledger records *only* the 7 sales that flowed through `create_order_v2`.

**The structural finding:** there is **no trigger** enforcing ledger/stock consistency ([`triggers-analysis.md`](./triggers-analysis.md) §3), so any direct `UPDATE products SET stock_quantity` — which `orders_admin_update`-style RLS permits for admins via PostgREST — changes stock with no ledger row. **The ledger cannot be trusted as an audit of stock**, and no opening-balance row exists to anchor it.

Also confirmed: **zero `type='adjustment'` rows**, so `adjust_stock_v2` has never successfully completed in production; and **zero `reservation`/`reservation_release` rows**, confirming the reservation subsystem has never run.

**Migration handling:** when building `inventoryTransactions`, write a synthetic **opening-balance entry per product** so that `Σ(ledger) = onHand` becomes an invariant that can actually be asserted. Do not attempt to reconstruct `before`/`after` for the 7 historical rows (Phase 0 §22.3 already says leave them null).

---

## 9. Order & status distribution

| order_status | n | | payment_status | n | | fulfillment_status | n |
|---|---|---|---|---|---|---|---|
| processing | 4 | | pending | 6 | | unfulfilled | 9 |
| shipped | 3 | | paid | 3 | | processing | 1 |
| delivered | 2 | | failed | 1 | | | |
| failed | 1 | | | | | | |

**All values are within their CHECK vocabulary.** Notably absent: **no order has ever had `order_status = 'pending_payment'`, `'paid'`, or `'cancelled'`** — direct confirmation that `create_order_v2` starts at `'processing'` and that the cron job's target status is unreachable.

Observed combinations include states the app's own transition matrix would consider inconsistent, e.g. `shipped` + `payment_status='pending'` (2 orders) and `delivered` + `fulfillment_status='unfulfilled'` (1 order). This is the direct, visible consequence of **F-HIGH-1**: the three status fields are independent columns with no cross-field validation anywhere in the database.

`order_status_history` (8 rows) contains only 4 distinct transitions: `processing→shipped` (4), `pending→paid` (2), `shipped→delivered` (1), `unfulfilled→processing` (1). Every one is consistent with the app-side matrix, and **none carries a tracking number** — consistent with F-CRIT-4, since any such call would have failed and written no history at all.

---

## 10. Users & carts

| Metric | Value |
|---|---|
| `auth.users` | 4 |
| Email confirmed | 4/4 |
| Has password hash | 4/4 (`$2a$`, 60 chars — bcrypt) |
| Provider `email` | 4 |
| **Provider `google`** | **0** |
| SSO / banned / soft-deleted | 0 / 0 / 0 |
| `profiles.role` | 3 × `customer`, 1 × `super_admin` |
| **`role = 'admin'`** | **0** — only `super_admin` exists |
| Refresh tokens | 16 (9 revoked) |
| Carts | 2, both bound to a `user_id`; **0 guest carts**; `session_id` NULL on both |

Two consequences worth carrying forward:

- **No `admin`-role user has ever existed** — only `super_admin`. Every admin code path in production has been exercised by a `super_admin`, and since `is_admin()` and `requireAdmin()` treat the two identically, the distinction has never been tested. Notably, the `super_admin` account would **not** hit the broken customer profile-save path (§4.1 of [`policies-analysis.md`](./policies-analysis.md)), which plausibly explains why that defect went unnoticed.
- **`carts.session_id` is NULL on every row**, so the guest-cart branch of `CartService.mergeGuestCart` has never run against real data.

---

## 11. Consolidated integrity issues

| ID | Sev | Finding | Migration action |
|---|---|---|---|
| **D1** | 🔴 | `admin_audit_logs` empty — audit has never worked (§5) | Nothing to migrate; make failures loud in `AuditModule` |
| **D2** | 🟠 | 3 of 10 orders have totals but no line items (§4) | Migrate verbatim; record in baseline |
| **D3** | 🟠 | Ledger does not reconcile to stock; no opening balances (§8) | Write synthetic opening-balance entries |
| **D4** | 🟠 | 74% of products have no image; 91% of image rows are `placehold.co` (§6) | Migrate **2** real files; drop placeholder URLs |
| **D5** | 🔵 | All `*_ar` fields 100% NULL (§7) | **Product decision:** commit to i18n or drop the fields |
| **D6** | 🔵 | EAV tables empty (`attribute_values`, `product_attribute_values`) despite 9 attribute definitions (§2) | Attribute faceting has no data; redesign freely |
| **D7** | 🔵 | 12 of 28 tables empty | Do not create the corresponding collections speculatively |
| **D8** | 🔵 | Cross-field status combinations are inconsistent (§9) | Migrate as-is; enforce coherently going forward |
| **D9** | 🔵 | No `admin`-role user has ever existed (§10) | Exercise both roles in the Phase 4 authorization matrix |
| **D10** | 🔵 | Dataset too small to validate behaviour | Differential testing must use **synthesised** scenarios |

**No blocking data-integrity issue exists.** The database is small, clean and internally consistent apart from the seeded-order artefact. Nothing here blocks the migration.
