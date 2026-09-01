# Behavioural Baseline — Phase 0.5

**Purpose.** Record what the system **actually does today**, so that after the NestJS migration a difference in behaviour can be classified as either a deliberate improvement or a regression — and so that pre-existing defects are never misattributed to the migration (Phase 0 risk **R9**).

**Source.** Live production database (`quhllllvwwuizjfrxvdz`, PostgreSQL 17.6) extracted read-only on 2026-08-29, combined with repository code at commit `dc7768b`.

**Evidence tags:**
- **`VERIFIED`** — proven from the live database (function source, catalog, policy, or data)
- **`REPO`** — proven from repository source code
- **`INFERRED`** — reasoned from VERIFIED/REPO facts; not directly executed
- **`UNKNOWN`** — could not be determined

> **No flow was executed against production.** Nothing was written. Traces are reconstructed from extracted function bodies, policies, triggers, configuration and data — which for this system is stronger evidence than black-box probing, because the entire business logic is now in hand.

---

## Flow A — User Registration

```
User submits /register
   │  REPO   Zod registerSchema (min 8 chars, confirm match) — CLIENT-SIDE ONLY
   ▼
REPO      supabase.auth.signUp({email, password, data:{full_name}})   [browser, anon key]
   ▼
VERIFIED  GoTrue creates auth.users;  mailer_autoconfirm = false  ->  NO SESSION ISSUED
   ▼
VERIFIED  Trigger on_auth_user_created  (AFTER INSERT ON auth.users, FOR EACH ROW)
   ▼
VERIFIED  handle_new_user()  [SECURITY DEFINER, search_path=public]
             INSERT profiles (id, full_name, avatar_url)
             full_name := COALESCE(raw_user_meta_data->>'full_name', email)
             avatar_url := raw_user_meta_data->>'avatar_url'
             role       := column DEFAULT 'customer'      <- never written by the trigger
             phone      := NULL                            <- never captured at signup
   ▼
REPO      Form redirects to /account/orders
   ▼
INFERRED  proxy.ts finds no session -> redirect to /login      ** BROKEN UX **
```

| Aspect | Baseline |
|---|---|
| Final user state | `auth.users` row (unconfirmed) + `profiles` row, `role='customer'`, `phone=NULL` |
| Session after signup | **None** — confirmation required `VERIFIED` |
| Can a user self-register as admin? | **No** `VERIFIED` — trigger never writes `role`; `profiles_update_own` has `WITH CHECK (role='customer')` |
| Server-side password validation | **None** — client Zod only `REPO` |
| Live evidence | 4 users, 4 profiles, 0 orphans, all confirmed `VERIFIED` |
| **Known defect** | **B-A1:** registration dead-ends at `/login` with no "check your email" message |
| **Known defect** | **B-A2:** "Continue with Google" is non-functional — provider disabled `VERIFIED` |

---

## Flow B — Login

```
REPO      supabase.auth.signInWithPassword({email,password})   [browser]
   ▼
VERIFIED  GoTrue verifies bcrypt $2a$ hash -> access + refresh JWT in cookies
   ▼
REPO      If local cart non-empty -> syncCartToDatabase()
   ▼
REPO      router.push(redirectTo ?? '/account/orders')
   ▼
          Next request hits proxy.ts:
REPO        storefront -> auth.getSession()   (decodes cookie; NOT server-revalidated)
REPO        admin      -> auth.getUser()      (server-validated)
                          + service-role SELECT profiles.role
                          + require role IN ('admin','super_admin') else /unauthorized
   ▼
VERIFIED  Role resolution = public.profiles.role  (NOT a JWT claim)
```

| Aspect | Baseline |
|---|---|
| Role source | `profiles.role` table lookup on **every** request `VERIFIED` — `profiles_pkey` is the hottest index in the DB (2,719 scans) |
| Role in token | **No** — `raw_app_meta_data` holds only `provider`/`providers` `VERIFIED` |
| `admin` vs `super_admin` | Treated **identically** everywhere `VERIFIED` (`is_admin()`, `requireAdmin()`) |
| Live roles | 3 × customer, 1 × super_admin, **0 × admin** `VERIFIED` |
| Admin login role check | None at login; enforced on the next request `REPO` |
| Live sessions | 16 refresh tokens, 9 revoked `VERIFIED` |
| **Known defect** | **B-B1:** storefront proxy uses `getSession()` not `getUser()` (Phase 0 A2) |

---

## Flow C — Product Discovery

```
REPO      /products, /search, /categories/[slug], /brands/[slug]
             -> ProductService -> supabase.rpc('search_products', {...})
   ▼
VERIFIED  search_products(search_query, category_slug, brand_slug,
                          min_price, max_price, in_stock_only, result_limit, result_offset)
             WHERE is_active = true AND deleted_at IS NULL
               AND ( query empty
                     OR to_tsvector(name_en||' '||description_en) @@ plainto_tsquery(q)
                     OR sku ILIKE '%q%'  OR name_en ILIKE '%q%' )
               AND (category_slug IS NULL OR c.slug = category_slug)     <- EXACT match, no subtree
               AND (brand_slug    IS NULL OR b.slug = brand_slug)
               AND price filters applied to COALESCE(sale_price, base_price)
               AND (NOT in_stock_only OR (stock_quantity - reserved_quantity) > 0)
             ORDER BY rank DESC, is_featured DESC, created_at DESC     <- HARD-CODED
             LIMIT result_limit OFFSET result_offset
   ▼
VERIFIED  Returns 12 scalar columns: id, sku, name_en, slug, base_price, sale_price,
          stock_quantity, reserved_quantity, is_featured, category_id, brand_id, rank
          -> NO images, NO brand name, NO category name, NO rating, NO total count
```

| Aspect | Baseline |
|---|---|
| Sorting | **Cannot be controlled.** No sort parameter exists `VERIFIED` — the UI's 5 sort options are inert |
| Pagination totals | **Wrong by construction** `VERIFIED` — no total returned; app applies `count:'exact'` to an already-paginated result |
| Category pages | **Exclude subcategories** `VERIFIED` — exact slug match only, on a 2-level tree with 10 child categories |
| Images / brand / rating in listings | **Never returned** `VERIFIED` — root cause of imageless grids |
| Index usage | `idx_products_search` (GIN) **never used** `VERIFIED` (0 scans) — the `ILIKE` OR-branches force a seq scan |
| Ratings | `products.avg_rating` / `review_count` **do not exist**; 0 reviews `VERIFIED` — always renders 0 |
| Live catalogue | 85 products, all active, 0 soft-deleted; 63 (74%) have no image `VERIFIED` |

---

## Flow D — Cart

```
REPO      Guest cart:  Zustand `cart-store` in localStorage. THIS IS THE CART OF RECORD.
             max qty 99; qty capped at available_stock; merge strategy = Math.max
   ▼
REPO      On login: syncCartToDatabase(items) -> CartService.mergeGuestCart
             -> carts / cart_items  (merge strategy = existing + incoming)   ** CONTRADICTS store **
   ▼
VERIFIED  cart_items has NO price column
   ▼
REPO      Nothing ever reads the server cart back  (getCart() has 0 call sites)
```

| Aspect | Baseline |
|---|---|
| Cart of record | **localStorage** `REPO` |
| Server cart | **Write-only** `REPO` |
| Price source | Client-side `sale_price ?? base_price`; **the server cart cannot compute a subtotal at all** (no price column) `VERIFIED` |
| Stock validation | Client-side only; the authoritative check happens at checkout inside `create_order_v2` `VERIFIED` |
| Merge strategy | **Two contradictory implementations** — `Math.max` (store) vs `existing + incoming` (provider) `REPO` |
| Live data | 2 carts, both user-bound; **0 guest carts**; `session_id` NULL on both `VERIFIED` |
| **Known defect** | **B-D1:** guest-cart merge branch has never run against real data |

---

## Flow E — Checkout / Order Creation ⭐ HIGHEST PRIORITY

```
REPO      CheckoutStepper (3 steps) -> createOrderAction (Server Action)
             getUser() null-check  -> login required
             Ad-hoc length validation (does NOT re-apply the Egyptian phone regex)
             p_shipping_fee hard-coded 0
   ▼
VERIFIED  supabase.rpc('create_order_v2', {p_user_id, p_items, p_shipping_address,
                                           p_payment_method, p_shipping_fee: 0})
   │        SECURITY DEFINER — bypasses ALL RLS
   │        NO authorization check; p_user_id never compared to auth.uid()
   ▼
VERIFIED  1. v_order_number := generate_order_number()
             = 'NE-' || YYYYMMDD || '-' || lpad(nextval('order_number_seq'),4,'0')
             ** sequence is GLOBAL, never reset per day **
   ▼
VERIFIED  2. INSERT orders  subtotal=0, total=0, shipping_fee=p_shipping_fee
             order_status='processing'  payment_status='pending'  fulfillment_status='unfulfilled'
             discount=0 (default)  tax=0 (default)  coupon_id=NULL  billing_address=NULL
   ▼
VERIFIED  3. FOR EACH item (product_id, variant_id, quantity):
               price := COALESCE(sale_price, base_price)          [simple product]
                     OR base_price + COALESCE(price_modifier,0)   [variant — IGNORES sale_price]
               IF price IS NULL -> RAISE 'Product not found' / 'Variant not found'
               UPDATE products SET stock_quantity = stock_quantity - quantity
                 WHERE id=? AND stock_quantity >= quantity
               IF NOT FOUND -> RAISE 'Insufficient stock for product <sku>'
               v_subtotal += price * quantity
               INSERT order_items (name, sku, price from DB — client prices IGNORED)
               INSERT inventory_transactions (type='sale', quantity=-qty,
                                              reference_type='order', created_by=NULL)
   ▼
VERIFIED  4. UPDATE orders SET subtotal=v_subtotal, total = v_subtotal + p_shipping_fee
             -> fires set_updated_at_orders trigger
   ▼
VERIFIED  RETURN {id, order_number}
   ▼
REPO      Read-back sanity SELECT on orders; RPC errors mapped via /insufficient stock/i
```

### Verified contract

| Rule | Baseline behaviour |
|---|---|
| **Authentication** | Required by the Server Action `REPO` — **but not by the RPC itself** `VERIFIED` |
| **Guest checkout** | Not supported `REPO` |
| **Pricing authority** | **Server-side.** Client prices discarded `VERIFIED` ✅ |
| **Coupon validation** | **Does not exist anywhere** `VERIFIED` — 0 coupons, no redemption code, no public read policy |
| **Discount** | Always `0` `VERIFIED` |
| **Tax** | Always `0` `VERIFIED` |
| **Shipping fee** | Always `0` `VERIFIED` (hard-coded by the caller) |
| **Total formula** | `total = subtotal + shipping_fee` `VERIFIED` — **no discount, no tax term** |
| **Stock model** | `stock_quantity` decremented **directly**; `reserved_quantity` never touched `VERIFIED` |
| **Stock guard** | Predicate inside the UPDATE — race-safe `VERIFIED` |
| **Active/deleted check** | **NONE** — inactive and soft-deleted products are purchasable `VERIFIED` |
| **Quantity floor** | **NONE** — no `quantity > 0` check, and `order_items` has no CHECK constraint `VERIFIED` |
| **Atomicity** | Full — no EXCEPTION handler, any RAISE rolls back the whole order `VERIFIED` ✅ |
| **Ledger** | One `type='sale'` row per line, `created_by` NULL `VERIFIED` |
| **Order number** | `NE-YYYYMMDD-NNNN`, **globally** sequential `VERIFIED` (live seq last_value = 10) |
| **Initial status** | `processing` / `pending` / `unfulfilled` `VERIFIED` — **never `pending_payment`** |
| Live evidence | 10 orders, 7 with items; `total = subtotal` on all 10; 0 discounts/tax/shipping ever `VERIFIED` |

### Known defects in this flow

| ID | Sev | Defect |
|---|---|---|
| **B-E1** | 🔴 | `create_order_v2` is `SECURITY DEFINER` with `EXECUTE` granted to **`anon`** and no authz check — callable by anyone with the public key, for any `p_user_id` |
| **B-E2** | 🔴 | Negative `quantity` **increases** stock and produces a negative line total, driving the order total down |
| **B-E3** | 🟠 | No `is_active`/`deleted_at` check — hidden products can be ordered |
| **B-E4** | 🟠 | Variant pricing ignores `sale_price` (no live impact: 0 variants) |
| **B-E5** | 🟡 | Empty `p_items` creates a valid 0.00 order |
| **B-E6** | 🟡 | `inventory_transactions.created_by` is NULL for every sale |
| **B-E7** | 🟡 | Checkout UI skips the Egyptian phone regex that the schema defines |

---

## Flow F — Order Status Update

```
REPO      Admin action (confirm / ship / deliver / cancel)
             requireAdmin()
             READ current order  -> check transition matrix (order.actions.ts:35-51)
             ** matrix lives ONLY in app code **
   ▼
VERIFIED  supabase.rpc('update_order_status_v2', {p_order_id, p_field, p_new_value,
                                                  p_admin_id, p_notes, p_tracking_number})
   │        SECURITY DEFINER — bypasses RLS.  NO authorization check.
   │        p_admin_id is RECORDED, never VERIFIED.
   ▼
VERIFIED  1. SELECT * FROM orders WHERE id=? FOR UPDATE        (row lock)
             IF NOT FOUND -> {success:false, error:'Order not found'}
   ▼
VERIFIED  2. CASE p_field IN ('order_status','payment_status','fulfillment_status')
             ELSE -> {success:false, error:'Invalid field'}      (whitelist; injection-safe)
   ▼
VERIFIED  3. EXECUTE 'UPDATE orders SET <field>=$1, updated_at=NOW()
                       [, tracking_number=$3 if p_tracking_number IS NOT NULL]
                       WHERE id=$2'
             ** orders.tracking_number DOES NOT EXIST **
   ▼
VERIFIED  4. INSERT order_status_history (order_id, field, from_value, to_value,
                                          changed_by=p_admin_id, notes)
   ▼
VERIFIED  RETURN {success:true}   |   EXCEPTION WHEN OTHERS -> {success:false, error:SQLERRM}
```

| Aspect | Baseline |
|---|---|
| **Transition validation in DB** | **NONE** `VERIFIED` — any CHECK-valid value, any order. `delivered → pending_payment` is accepted. |
| **Inventory effect** | **NONE** `VERIFIED` — cancelling or failing an order **never restores stock** |
| **Ledger effect** | **NONE** `VERIFIED` |
| **Notifications** | **NONE** `VERIFIED` — `notifications` table empty, no code writes it |
| **Audit effect** | `order_status_history` row written `VERIFIED`; `admin_audit_logs` **fails silently** `VERIFIED` |
| **Tracking number** | 🔴 **Any call supplying one fails entirely** — status unchanged, no history row `VERIFIED` |
| **Concurrency** | Function takes `FOR UPDATE`, but the app's matrix check happens in a prior round trip → TOCTOU window remains `REPO` |
| Live evidence | 8 history rows across 4 transition types; **none with a tracking number** `VERIFIED` |
| Live anomaly | 2 orders `shipped` while `payment_status='pending'`; 1 `delivered` while `fulfillment_status='unfulfilled'` `VERIFIED` — direct consequence of no cross-field validation |

### Known defects

| ID | Sev | Defect |
|---|---|---|
| **B-F1** | 🔴 | Callable by `anon`; `p_admin_id` unverified → forgeable audit trail |
| **B-F2** | 🔴 | Supplying a tracking number **always fails** (column absent) — shipping with tracking is impossible |
| **B-F3** | 🟠 | No transition validation in the DB; the app-side matrix is not an enforcement boundary |
| **B-F4** | 🟠 | Cancellation never restores stock |
| **B-F5** | 🟡 | `EXCEPTION WHEN OTHERS` masks real faults as soft business failures |

---

## Flow G — Stock Adjustment

```
REPO      Admin inventory page -> requireAdmin() -> Zod (reason >= 3 chars)
   ▼
VERIFIED  supabase.rpc('adjust_stock_v2', {p_product_id, p_quantity, p_reason,
                                           p_admin_id, p_reference_type='manual'})
   │        SECURITY DEFINER, no authz check
   ▼
VERIFIED  1. SELECT stock_quantity FROM products WHERE id=? FOR UPDATE
             IF NOT FOUND -> {success:false, error:'Product not found'}
   ▼
VERIFIED  2. v_new_stock := v_current + p_quantity        (SIGNED DELTA)
   ▼
VERIFIED  3. IF v_new_stock < 0 -> {success:false, error:'Stock cannot go below 0'}
             ** does NOT consider reserved_quantity; CHECK chk_available_stock may still fire **
   ▼
VERIFIED  4. UPDATE products SET stock_quantity=v_new_stock, updated_at=NOW()
   ▼
VERIFIED  5. INSERT inventory_transactions (type='adjustment', quantity=p_quantity,
                                            notes=p_reason, created_by=p_admin_id,
                                            reference_type=p_reference_type)
   ▼
VERIFIED  RETURN {success:true, newStock}
```

| Aspect | Baseline |
|---|---|
| Semantics | `p_quantity` is a **signed delta**, not an absolute value `VERIFIED` |
| Floor | 0, checked before write `VERIFIED` |
| Concurrency | `FOR UPDATE` — safe `VERIFIED` |
| `created_by` | **Populated** here (unlike the sale path) `VERIFIED` |
| Reserved stock | Ignored by the floor check `VERIFIED` |
| **Live evidence** | **Zero `type='adjustment'` rows exist — this function has never successfully completed in production** `VERIFIED` |

---

## Flow H — Inventory Reservation Expiry (scheduled)

```
VERIFIED  pg_cron job 1 "release-expired-reservations", */5 * * * *, ACTIVE
             35,309 successful runs, mean 6.99 ms, latest at extraction time
   ▼
VERIFIED  SELECT release_expired_reservations()
             FOR orders WHERE order_status='pending_payment'
                          AND created_at < now() - interval '30 minutes'
   ▼
          ** NO ORDER EVER HAS order_status='pending_payment' **
             create_order_v2 and create_order_v1 both hard-code 'processing'
   ▼
VERIFIED  Result: no-op on every run
```

| Evidence | Value |
|---|---|
| `reserved_quantity` across all 85 products | **0** `VERIFIED` |
| `inventory_transactions` of type `reservation` / `reservation_release` | **0** `VERIFIED` |
| Orders ever in `pending_payment` | **0** `VERIFIED` |

**Baseline: the inventory reservation subsystem does not function.** Treat it as an unimplemented specification, not as behaviour to preserve.

---

## Flow I — Guest Order Tracking

```
REPO      /order-tracking -> orderTrackingStore.fetchOrder(orderNumber, phone)
             Browser SELECT on orders (+ nested order_items, order_status_history)
             filtered by order_number ONLY
   ▼
VERIFIED  RLS policy orders_own_read:
             USING ((auth.uid() = user_id) OR is_admin())
   ▼
VERIFIED  Anonymous caller: auth.uid() IS NULL, is_admin() = false  ->  ZERO ROWS
   ▼
REPO      Client-side phone comparison never runs against real data
   ▼
          User always sees "order not found"
```

| Aspect | Baseline |
|---|---|
| Does guest tracking work? | **No — silently broken for every guest** `VERIFIED` |
| Is production PII exposed? | **No** `VERIFIED` — RLS denies before any row is returned |
| Does it work for a signed-in customer? | **Yes**, for their own orders only `VERIFIED` |
| Client "rate limit" | In-memory, reset on reload `REPO` — moot, since no data is ever returned |

> **This reclassifies Phase 0 finding H1** from "possible active PII breach" to **"dead feature"**. The order-data risk is real but sits in Flow F (`update_order_status_v2` callable by `anon`), which permits **tampering** even though **reading** is correctly blocked.

---

## Known-broken features at baseline

Anything on this list is **already broken today**. If it is still broken after migration, that is not a regression; if it works, that is an improvement.

| # | Feature | Status | Root cause | Evidence |
|---|---|---|---|---|
| 1 | **Guest order tracking** | Dead for guests | RLS `orders_own_read` excludes anon | `VERIFIED` |
| 2 | **Shipping an order with a tracking number** | Always fails | `orders.tracking_number` does not exist | `VERIFIED` |
| 3 | **Admin audit logging** | Never records anything | Insert targets non-existent `user_agent` column | `VERIFIED` (0 rows) |
| 4 | **Password reset** | Throws on submit | `ROUTES.auth.callback` undefined | `REPO` |
| 5 | **Google sign-in** | Non-functional | Provider disabled in GoTrue | `VERIFIED` |
| 6 | **Registration UX** | Dead-ends at `/login` | Email confirmation required; no session after signup | `VERIFIED` |
| 7 | **Customer profile save** | Fails for customers | No INSERT policy on `profiles`; app uses `upsert` | `INFERRED` (high confidence) |
| 8 | **Inventory reservation / expiry** | No-op | Cron targets an unreachable status | `VERIFIED` |
| 9 | **Manual stock adjustment** | Never succeeded in production | 0 `adjustment` ledger rows | `VERIFIED` |
| 10 | **Product sort options** | Inert | `search_products` has no sort parameter | `VERIFIED` |
| 11 | **Pagination totals** | Wrong | No total count returned by the RPC | `VERIFIED` |
| 12 | **Category pages** | Omit subcategory products | Exact slug match only | `VERIFIED` |
| 13 | **Product ratings** | Always 0 | `avg_rating`/`review_count` columns do not exist | `VERIFIED` |
| 14 | **Coupons** | No customer-facing path | No redemption code; no public read policy | `VERIFIED` |
| 15 | **Reviews** | No submission or display | Admin moderation only; 0 rows | `VERIFIED` |
| 16 | **Wishlist** | localStorage only | Server actions never called | `REPO` |
| 17 | **`updated_at` on categories/brands** | Writes fail silently | Columns do not exist | `VERIFIED` |
| 18 | **Contact form** | Fake | `setTimeout(1000)`, no network call | `REPO` |
| 19 | **Slug redirects** | Written, never read | No redirect handler | `REPO` |
| 20 | **Notifications** | Feature absent | Table empty; UI shows mock data | `VERIFIED` |

---

## Baseline metrics to reconcile after migration

| Metric | Baseline value |
|---|---|
| `auth.users` / `profiles` | 4 / 4 |
| Products | 85 (85 active, 0 deleted) |
| Categories / brands | 27 / 17 |
| Orders | 10 |
| Σ `orders.total` | **7,367.00** |
| Σ `orders.subtotal` | **7,367.00** (identical — no discount/shipping/tax has ever been applied) |
| Σ `orders.discount` / `shipping_fee` / `tax` | **0.00 / 0.00 / 0.00** |
| Order items | 7 · Σ `order_items.total` = **1,867.00** · Σ quantity = **11** |
| Σ items ≠ Σ orders | Expected — 3 seeded orders carry totals but no line items (see [`db/data-integrity.md`](./db/data-integrity.md) §4) |
| Order status history | 8 |
| Inventory transactions | 7 (all `sale`, net **−11**, matching Σ item quantity) |
| Σ `products.stock_quantity` | **58,503** · Σ `reserved_quantity` = **0** |
| Product images | 22 rows (**2** real files, 20 placeholders) |
| Blog posts | 6 (all published) |
| Addresses / carts / cart items | 1 / 2 / 4 |
| Empty tables | 12 of 28 |
| `order_number_seq.last_value` | 10 |

---

## Flows with residual uncertainty

| Flow | Uncertainty | Why it is acceptable |
|---|---|---|
| Customer profile save (#7 above) | `INFERRED` — not executed, because this phase performs no writes | Confirm in Phase 1 with a test customer account; the `super_admin` will not reproduce it |
| Access/refresh token TTLs | `UNKNOWN` — project-level GoTrue setting | NestJS defines its own; not a constraint |
| Whether any user has ever completed email confirmation from the UI | `UNKNOWN` | All 4 users are confirmed, but the confirmation route is not observable |
| Guest cart merge (`existing + incoming`) | Never exercised — 0 guest carts | Must be decided deliberately in Phase 1, not reverse-engineered |
