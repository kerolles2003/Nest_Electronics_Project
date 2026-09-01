# Database Function Forensics — Phase 0.5

**Source:** live production database, project ref `quhllllvwwuizjfrxvdz`, PostgreSQL 17.6.
**Extraction:** 2026-08-29 via `pg_get_functiondef()` + `pg_proc.proacl`, read-only.
**Exact definitions:** [`functions.sql`](./functions.sql) — verbatim, unedited.

Everything in this document is `VERIFIED` from the extracted source unless explicitly marked otherwise.

---

## 0. Inventory

10 custom functions exist in `public` (53 across all schemas; the other 43 are Supabase platform internals in `auth`, `storage`, `realtime`, `extensions`, `vault`, `graphql_public`, `pgbouncer`).

| Function | Returns | SECURITY DEFINER | EXECUTE granted to | App calls it? |
|---|---|---|---|---|
| `create_order_v2` | jsonb | **YES** | `PUBLIC`, anon, authenticated, service_role | Yes — checkout |
| `update_order_status_v2` | jsonb | **YES** | `PUBLIC`, anon, authenticated, service_role | Yes — admin orders |
| `adjust_stock_v2` | jsonb | **YES** | `PUBLIC`, anon, authenticated, service_role | Yes — admin inventory |
| `create_order_v1` | uuid | **YES** | `PUBLIC`, anon, authenticated, service_role | **No — orphaned legacy** |
| `search_products` | TABLE | no | `PUBLIC`, anon, authenticated, service_role | Yes — all catalogue listing |
| `generate_order_number` | text | no | `PUBLIC`, anon, authenticated, service_role | Indirectly (default + v2) |
| `is_admin` | boolean | **YES** | `PUBLIC`, anon, authenticated, service_role | No app calls; **used by 28 RLS policies** |
| `handle_new_user` | trigger | **YES** | postgres, service_role only | Trigger only |
| `handle_updated_at` | trigger | no | postgres, service_role only | Trigger only |
| `release_expired_reservations` | void | **YES** | postgres, service_role only | **pg_cron every 5 min** |

> **`create_order_v1` was not known to Phase 0.** It is a complete, still-callable legacy order path that trusts client-supplied prices.

---

## 🔴 F-CRIT-1 — The four mutation functions are unauthenticated remote procedures

**Severity: CRITICAL. Live, exploitable in production today.**

`create_order_v2`, `create_order_v1`, `update_order_status_v2` and `adjust_stock_v2` are **all** of the following at once:

1. **`SECURITY DEFINER`** — they execute as the function owner (`postgres`) and therefore **bypass every RLS policy**.
2. **`EXECUTE` granted to `anon` and `authenticated`** (and to `PUBLIC` — the `=X/postgres` ACL entry).
3. **Contain no authorization check of any kind.** There is no `auth.uid()` reference, no `is_admin()` call, no comparison of any argument against the caller's identity.

PostgREST exposes every `public` function at `POST /rest/v1/rpc/<name>`. The `anon` key is, by design, published in the browser bundle. Combining these three facts:

> **Any person on the internet holding the public anon key can call these four functions directly, with arbitrary arguments, and the database will execute them with full privileges.**

Concretely, and with no login required:

| Call | Effect |
|---|---|
| `rpc/update_order_status_v2` | Set **any** order to **any** status; forge `order_status_history` rows attributed to **any** `changed_by` UUID |
| `rpc/adjust_stock_v2` | Set **any** product's stock to **any** non-negative value; forge `inventory_transactions` ledger entries attributed to any admin |
| `rpc/create_order_v2` | Create orders **on behalf of any `p_user_id`**, decrementing real stock |
| `rpc/create_order_v1` | Same, **plus** the caller dictates `price`, `name` and `sku` written into `order_items` |

**How this was determined:** entirely from catalog metadata — `pg_proc.prosecdef`, `pg_proc.proacl`, and the function source. **No function was executed and no data was modified during this audit.**

**Why the RLS work does not help:** §4 shows the RLS policy set is basically sound. It is irrelevant here. `SECURITY DEFINER` bypasses RLS by definition, so these four functions are a complete, parallel write path around the entire policy model.

**Remediation is out of scope for Phase 0.5** (this phase is read-only), but the fix is small and should be scheduled immediately rather than deferred to the NestJS migration:
`REVOKE EXECUTE ... FROM anon, authenticated, PUBLIC` on all four, plus an internal `auth.uid()`/`is_admin()` check in each. See [`../PHASE-0.5-REPORT.md`](../PHASE-0.5-REPORT.md) §12.

---

## 1. `create_order_v2` — the checkout transaction

```
public.create_order_v2(
  p_user_id         uuid,
  p_items           jsonb,     -- [{product_id, variant_id, quantity}]
  p_shipping_address jsonb,
  p_payment_method  text,
  p_shipping_fee    numeric DEFAULT 0
) RETURNS jsonb                -- {id, order_number}
```

| Property | Value |
|---|---|
| Schema | `public` |
| Language | plpgsql |
| Security context | **SECURITY DEFINER**, owner `postgres`, **no `search_path` pinned** |
| Transaction | Implicit — a plpgsql function is one atomic statement. No `EXCEPTION` block, so **any error aborts and rolls back the whole order**. This part is correct. |
| Tables read | `products`, `product_variants` |
| Tables written | `orders` (INSERT + UPDATE), `order_items` (INSERT), `inventory_transactions` (INSERT), `product_variants`/`products` (UPDATE stock) |
| Functions called | `generate_order_number()` → `nextval('order_number_seq')` |
| Triggers fired | `set_updated_at_orders` (BEFORE UPDATE on `orders`, from step 3) |
| Authorization | **NONE** |
| Caller identity | **`p_user_id` is a plain argument. It is never compared to `auth.uid()`.** |

### Verified step-by-step trace

```
INPUT  p_user_id, p_items[], p_shipping_address, p_payment_method, p_shipping_fee

1  ORDER NUMBER
   v_order_number := generate_order_number()
                   = 'NE-' || to_char(now(),'YYYYMMDD') || lpad(nextval('order_number_seq'),4,'0')
   -> sequence is GLOBAL, never reset per day (live last_value = 10)

2  INSERT orders
   subtotal=0, total=0, shipping_fee=p_shipping_fee   <- placeholder totals
   order_status       = 'processing'      <-- NOT 'pending_payment'
   payment_status     = 'pending'
   fulfillment_status = 'unfulfilled'
   discount / tax     = column DEFAULT 0  (never written)
   coupon_id          = NULL              (never written)
   billing_address    = NULL              (never written)
   RETURNING id -> v_order_id

3  FOR EACH item IN jsonb_to_recordset(p_items) AS (product_id uuid, variant_id uuid, quantity int)

   3a  IF variant_id IS NOT NULL:
         SELECT p.base_price + COALESCE(pv.price_modifier,0), p.name_en, pv.sku
           FROM products p JOIN product_variants pv ON pv.product_id=p.id
          WHERE pv.id = variant_id
         IF price IS NULL -> RAISE 'Variant not found'
         UPDATE product_variants SET stock_quantity = stock_quantity - quantity
          WHERE id=variant_id AND stock_quantity >= quantity
         IF NOT FOUND -> RAISE 'Insufficient stock for variant %'

       ELSE:
         SELECT COALESCE(sale_price, base_price), name_en, sku
           FROM products WHERE id = product_id
         IF price IS NULL -> RAISE 'Product not found'
         UPDATE products SET stock_quantity = stock_quantity - quantity
          WHERE id=product_id AND stock_quantity >= quantity
         IF NOT FOUND -> RAISE 'Insufficient stock for product %'

   3b  v_subtotal := v_subtotal + (price * quantity)

   3c  INSERT order_items (order_id, product_id, variant_id, name, sku, price, quantity, total)
       -> price and name/sku come from the DATABASE, not from the client   [CORRECT]

   3d  INSERT inventory_transactions
       type='sale', quantity = -quantity, reference_type='order',
       reference_id=v_order_id, notes='Order checkout'
       created_by = NULL          <-- never set

4  UPDATE orders SET subtotal=v_subtotal, total = v_subtotal + p_shipping_fee
   -> fires set_updated_at_orders trigger

RETURN {'id': v_order_id, 'order_number': v_order_number}
```

### Business rules VERIFIED

| Rule | Actual implementation |
|---|---|
| Pricing authority | **Server-side.** Client-sent prices are ignored entirely — only `product_id`/`variant_id`/`quantity` are read from `p_items`. |
| Effective price (simple product) | `COALESCE(sale_price, base_price)` |
| Effective price (variant) | `base_price + COALESCE(price_modifier,0)` — **`sale_price` is ignored on the variant path** |
| Total formula | `total = subtotal + shipping_fee`. **No discount. No tax. No coupon.** |
| Stock model | Decrements **`stock_quantity` directly**. `reserved_quantity` is **never touched**. |
| Stock guard | Predicate `AND stock_quantity >= quantity` inside the UPDATE — race-safe (row lock via UPDATE) |
| Order status on creation | `processing` / `pending` / `unfulfilled` |
| Ledger | One `inventory_transactions` row per line, `type='sale'`, negative quantity |
| Atomicity | Full — no EXCEPTION handler, so any RAISE aborts the entire order |

### Defects VERIFIED

| ID | Sev | Defect |
|---|---|---|
| **F-CRIT-2** | Critical | `p_user_id` is never validated against `auth.uid()`. Combined with F-CRIT-1, orders can be created for arbitrary users. |
| **F-CRIT-3** | Critical | **No `quantity > 0` check.** `order_items` has no CHECK constraint on quantity (unlike `cart_items`, which has `quantity > 0`). A negative quantity passes `stock_quantity >= -5`, *increases* stock via `stock - (-5)`, and adds a **negative** line total, reducing the order total. A mixed cart can be driven to an arbitrarily low or negative `total`. |
| **F-HIGH-3** | High | **No `is_active` / `deleted_at` filter.** Soft-deleted and deactivated products can be purchased. |
| **F-HIGH-4** | High | Variant pricing ignores `sale_price`, so a discounted product sold by variant charges full `base_price`. (No live impact today: `product_variants` has 0 rows.) |
| **F-MED-1** | Medium | Empty `p_items` array creates a valid order with `subtotal=0`, `total=shipping_fee`. No minimum-order check. |
| **F-MED-2** | Medium | `inventory_transactions.created_by` is never populated on the sale path — the ledger cannot attribute a sale to a user. |
| **F-MED-3** | Medium | The variant branch writes `v_item.product_id` into `order_items`/`inventory_transactions` **as supplied by the client**, without verifying it matches the variant's real parent product. |
| **F-MED-4** | Medium | No `search_path` is pinned on this SECURITY DEFINER function (`handle_new_user`, `is_admin` etc. do pin it). Hardening gap. |
| **F-LOW-1** | Low | Order is INSERTed with placeholder `0` totals then UPDATEd — a second write and a spurious trigger fire per order. |

### Error conditions (exact strings the API surface will see)

| Condition | Raised message |
|---|---|
| Variant row missing | `Variant not found` |
| Product row missing / id not found | `Product not found` |
| Insufficient variant stock | `Insufficient stock for variant <sku>` |
| Insufficient product stock | `Insufficient stock for product <sku>` |
| `stock_quantity` would drop below `reserved_quantity` | CHECK `chk_available_stock` violation (unreachable today — `reserved_quantity` is 0 everywhere) |

> `apps/storefront/src/actions/checkout.actions.ts:7-14` matches `/insufficient stock/i` against these strings. The mapping is consistent with the real messages.

---

## 2. `update_order_status_v2` — order state changes

```
public.update_order_status_v2(
  p_order_id uuid, p_field text, p_new_value text,
  p_admin_id uuid, p_notes text DEFAULT NULL, p_tracking_number text DEFAULT NULL
) RETURNS jsonb   -- {success:bool, error?:text}
```

| Property | Value |
|---|---|
| Security context | **SECURITY DEFINER**, no pinned `search_path` |
| Tables read | `orders` (`SELECT ... FOR UPDATE` — real row lock) |
| Tables written | `orders` (dynamic UPDATE), `order_status_history` (INSERT) |
| Triggers fired | `set_updated_at_orders` |
| Transaction | Wrapped in `EXCEPTION WHEN OTHERS` → **all errors are swallowed and returned as `{success:false, error:SQLERRM}`**; the block's writes roll back |
| Authorization | **NONE.** `p_admin_id` is *recorded*, never *verified*. |

### Verified step-by-step trace

```
1  SELECT * FROM orders WHERE id=p_order_id FOR UPDATE     -- row lock acquired
   IF NOT FOUND -> return {success:false, error:'Order not found'}

2  CASE p_field
     'order_status'       -> v_old_value := current order_status
     'payment_status'     -> v_old_value := current payment_status
     'fulfillment_status' -> v_old_value := current fulfillment_status
     ELSE -> return {success:false, error:'Invalid field'}      -- whitelist, injection-safe

3  EXECUTE format('UPDATE orders SET %I = $1, updated_at = NOW() %s WHERE id = $2',
                  p_field,
                  CASE WHEN p_tracking_number IS NOT NULL
                       THEN ', tracking_number = $3' ELSE '' END)
   USING p_new_value, p_order_id, p_tracking_number

4  INSERT order_status_history (order_id, field, from_value, to_value, changed_by, notes)

5  return {success:true}
```

### 🔴 F-CRIT-4 — supplying a tracking number always fails

`orders.tracking_number` **does not exist**. Verified against `information_schema.columns`: the `orders` table has 19 columns and none is `tracking_number`.

Therefore whenever `p_tracking_number IS NOT NULL`, step 3 builds
`UPDATE orders SET fulfillment_status = $1, updated_at = NOW(), tracking_number = $3 WHERE id = $2`
which raises `column "tracking_number" of relation "orders" does not exist`. The `EXCEPTION WHEN OTHERS` handler catches it, **rolls back the status change and the history insert**, and returns `{success:false, error:'column "tracking_number" ... does not exist'}`.

> **Live consequence: it is impossible to ship an order with a tracking number.** The admin action fails wholesale — status unchanged, no history row — and the UI surfaces a raw Postgres error string. This is a production defect, not a migration risk.

The no-tracking path is **VERIFIED working**: `order_status_history` holds 8 rows (4 × `processing→shipped`, 2 × `pending→paid`, 1 × `shipped→delivered`, 1 × `unfulfilled→processing`), which can only be written by this function. Passing 3 `USING` values to a 2-placeholder statement is tolerated in this PostgreSQL version — proven empirically by those rows existing.

### Other defects VERIFIED

| ID | Sev | Defect |
|---|---|---|
| **F-HIGH-1** | High | **No transition validation whatsoever.** The state machine exists *only* in `apps/admin/src/actions/order.actions.ts:35-51`. The database accepts any CHECK-valid value in any order — `delivered → pending_payment` is permitted. Because the function is callable by `anon` (F-CRIT-1), the app-side matrix is not an enforcement boundary at all. |
| **F-HIGH-2** | High | **Cancelling or failing an order does not restore stock.** This function touches no product, variant or ledger table. Phase 0 inferred it would "release/commit stock" — **it does not**. Every cancellation permanently loses the stock decremented at checkout, with no ledger entry. |
| **F-MED-5** | Medium | `p_admin_id` is written to `order_status_history.changed_by` unverified, so the audit trail is forgeable. |
| **F-MED-6** | Medium | `EXCEPTION WHEN OTHERS` converts every failure — including CHECK violations and the tracking-number bug — into a soft `{success:false}`. Real faults are indistinguishable from business rejections. |
| **F-MED-7** | Medium | No validation that `p_new_value` is legal for the field; relies entirely on the table CHECK constraint, whose violation is then swallowed by the handler. |

**Note on Phase 0 M8 (non-atomic transitions / TOCTOU):** the *function* does take `FOR UPDATE`. The race is in the application, which reads the order in `order.actions.ts` and then calls the RPC in a separate round trip. The DB-side lock does not close that window because the app's matrix check happens outside it.

---

## 3. `adjust_stock_v2` — manual inventory adjustment

```
public.adjust_stock_v2(
  p_product_id uuid, p_quantity integer, p_reason text,
  p_admin_id uuid, p_reference_type text DEFAULT 'manual'
) RETURNS jsonb   -- {success:bool, newStock?:int, error?:text}
```

| Property | Value |
|---|---|
| Security context | **SECURITY DEFINER**, no pinned `search_path` |
| Tables read | `products` (`SELECT stock_quantity ... FOR UPDATE`) |
| Tables written | `products` (UPDATE), `inventory_transactions` (INSERT) |
| Triggers fired | `set_updated_at_products` |
| Transaction | `EXCEPTION WHEN OTHERS` → soft failure |
| Authorization | **NONE.** `p_admin_id` is recorded only. |

### Verified step-by-step trace

```
1  SELECT stock_quantity INTO v_current FROM products WHERE id=p_product_id FOR UPDATE
   IF NOT FOUND -> {success:false, error:'Product not found'}

2  v_new_stock := v_current + p_quantity          -- p_quantity is a signed DELTA

3  IF v_new_stock < 0 -> {success:false, error:'Stock cannot go below 0'}

4  UPDATE products SET stock_quantity=v_new_stock, updated_at=NOW() WHERE id=p_product_id

5  INSERT inventory_transactions
     (product_id, type='adjustment', quantity=p_quantity,
      notes=p_reason, created_by=p_admin_id, reference_type=p_reference_type)

6  return {success:true, newStock:v_new_stock}
```

### Business rules VERIFIED

- `p_quantity` is a **signed delta**, not an absolute value.
- Floor is **0**, checked before the write.
- Ledger `quantity` stores the signed delta (unlike the sale path, which stores `-quantity`).
- `created_by` **is** populated here (unlike `create_order_v2`).
- Row is locked `FOR UPDATE` before read-modify-write — concurrency-safe.

### Defects VERIFIED

| ID | Sev | Defect |
|---|---|---|
| **F-CRIT-1** | Critical | Callable by `anon`; `p_admin_id` unverified (see §F-CRIT-1) |
| **F-MED-8** | Medium | **Ignores `reserved_quantity`.** The floor check is `new_stock >= 0`, but the table CHECK is `stock_quantity >= reserved_quantity`. Reducing stock below the reserved amount raises a CHECK violation that the handler converts into `{success:false, error:'new row for relation "products" violates check constraint "chk_available_stock"'}` — a raw constraint name shown to an admin. Unreachable today (`reserved_quantity` is 0 for all 85 products). |
| **F-MED-9** | Medium | No `p_quantity <> 0` check — a zero adjustment writes a meaningless ledger row. |
| **F-LOW-2** | Low | `p_reference_type` is free text, not constrained to the ledger's `type` CHECK vocabulary. |

**Live evidence:** `inventory_transactions` contains **only** `type='sale'` rows (7). There is not one `type='adjustment'` row, so this function has **never completed successfully in production**.

---

## 4. `create_order_v1` — orphaned legacy path (NOT known to Phase 0)

```
public.create_order_v1(p_user_id, p_items, p_shipping_address, p_payment_method,
                       p_subtotal numeric, p_shipping_fee numeric, p_total numeric)
RETURNS uuid
```

Still present, still `SECURITY DEFINER`, still granted to `anon` and `authenticated`. No application code calls it.

**Why it matters more than a dead function normally would:** unlike v2, v1 takes `p_subtotal`, `p_total`, and per-item `price`, `name`, `sku` **from the caller** and writes them verbatim into `orders` and `order_items`. It performs no price lookup at all.

> Combined with F-CRIT-1, `create_order_v1` lets an unauthenticated caller create a fully-formed order for any user at any price they choose — e.g. a 0.00 EGP order — while still decrementing real stock and writing a real ledger entry.

It is otherwise identical in shape to v2 (same `'processing'/'pending'/'unfulfilled'` statuses, same direct `stock_quantity` decrement, same `'sale'` ledger row).

**Recommendation (not executed):** drop or revoke it. It should not be carried into the NestJS design in any form.

---

## 5. `search_products` — catalogue listing and search

```
public.search_products(search_query text, category_slug text, brand_slug text,
                       min_price numeric, max_price numeric, in_stock_only boolean,
                       result_limit int DEFAULT 24, result_offset int DEFAULT 0)
RETURNS TABLE(id, sku, name_en, slug, base_price, sale_price, stock_quantity,
              reserved_quantity, is_featured, category_id, brand_id, rank)
```

`SECURITY INVOKER` (respects RLS), `SET search_path = public`. Reads `products`, `categories`, `brands`.

### Verified behaviour

| Aspect | Actual |
|---|---|
| Visibility filter | `is_active = true AND deleted_at IS NULL` |
| Text matching | `to_tsvector('english', name_en \|\| ' ' \|\| COALESCE(description_en,'')) @@ plainto_tsquery(...)` **OR** `sku ILIKE '%q%'` **OR** `name_en ILIKE '%q%'` |
| Empty query | `search_query IS NULL OR = ''` short-circuits to "match all" |
| Category filter | **Exact slug equality only** — `c.slug = category_slug`. **No subtree/descendant matching.** |
| Brand filter | Exact slug equality |
| Price filter | Applied to `COALESCE(sale_price, base_price)` — consistent with the checkout price rule |
| Stock filter | `(stock_quantity - reserved_quantity) > 0` |
| Sort | **Hard-coded** `ORDER BY rank DESC, is_featured DESC, created_at DESC`. **There is no sort parameter.** |
| Pagination | `LIMIT result_limit OFFSET result_offset` — **no total count is returned** |

### Defects VERIFIED — these confirm Phase 0 findings with root causes

| ID | Sev | Defect |
|---|---|---|
| **F-HIGH-5** | High | **Returns 12 scalar columns with no images, brand name, category name or rating.** This is the root cause of the imageless, brand-less product grids Phase 0 observed. |
| **F-HIGH-6** | High | **No sort argument exists.** The UI advertises 5 sort orders (`products/page.tsx:40-47`); none can be honoured. |
| **F-HIGH-7** | High | **No total count.** The app applies PostgREST `count:'exact'` to an already-paginated result set, so pagination totals are wrong by construction. |
| **F-MED-10** | Medium | **Category pages exclude subcategories.** `c.slug = category_slug` matches one level only, so a parent-category page shows only products assigned directly to that parent. With a 27-row, multi-level `categories` tree this is a visible catalogue defect. |
| **F-MED-11** | Medium | The `OR ... ILIKE '%q%'` branches make the query **unindexable**. `idx_products_search` (GIN, matching expression and partial predicate) exists but shows **0 scans** — every search is a sequential scan. Fine at 85 products; a hard wall at scale. |
| **F-LOW-3** | Low | `ts_rank` is computed over an expression, not a stored `tsvector`; recomputed per row per query. |
| **F-LOW-4** | Low | Joins `categories`/`brands` but returns only their ids — the join exists purely for slug filtering. |

---

## 6. `generate_order_number`

```sql
SELECT 'NE-' || to_char(now(),'YYYYMMDD') || '-' || lpad(nextval('order_number_seq')::text, 4, '0')
```

`SECURITY INVOKER`, `SET search_path = public`. Used both as the `orders.order_number` column DEFAULT and explicitly by `create_order_v2`.

- **The sequence is global and never reset per day.** Live `order_number_seq.last_value = 10`. Verified distribution: `NE-20260429-0001..0003`, `NE-20260501-0004`, `NE-20260502-0005`, `NE-20260503-0006..0010`.
- Consequence: the numeric suffix is a **global order counter**, so an order number leaks total order volume and is trivially enumerable — the format implies a daily reset that does not happen.
- Zero-padded to 4 digits; **rolls over past 9999** into a 5-digit suffix rather than failing.

---

## 7. `is_admin` — the authorization primitive

```sql
SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
```

`STABLE SECURITY DEFINER`, `SET search_path = public`. **Never called from application code — but referenced by 28 of the 52 public RLS policies.** It is the single hinge of the entire database authorization model.

- Treats `admin` and `super_admin` **identically** — confirming Phase 0: there is no privilege separation anywhere in the system, database included.
- Returns `false` for anonymous callers (`auth.uid()` is NULL).
- `SECURITY DEFINER` is required here so the policy can read `profiles` without recursing into `profiles`' own RLS.

---

## 8. `handle_new_user` — profile provisioning

```sql
INSERT INTO public.profiles (id, full_name, avatar_url)
VALUES (NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        NEW.raw_user_meta_data->>'avatar_url');
```

`SECURITY DEFINER`, `SET search_path = public`. Fired by `on_auth_user_created` — `AFTER INSERT ON auth.users FOR EACH ROW`.

**This confirms the Phase 0 inference.** Verified properties:

- `role` is **not** written — it comes from the column default `'customer'`. A user therefore cannot be created as an admin through signup.
- `full_name` falls back to the **email address** when `raw_user_meta_data.full_name` is absent (satisfying the `NOT NULL`).
- `phone` is **never** populated at signup, even though registration collects one in some flows.
- No `ON CONFLICT` clause: a duplicate `auth.users` id would abort the signup transaction.
- Live integrity: 4 `auth.users`, 4 `profiles`, **0 orphans in either direction** — the trigger is working.

---

## 9. `handle_updated_at`

```sql
NEW.updated_at = now(); RETURN NEW;
```

`SECURITY INVOKER`, `SET search_path = public`. Attached to exactly **5** tables: `blog_posts`, `carts`, `orders`, `products`, `profiles`.

**Not attached to** `categories`, `brands`, `addresses`, `reviews`, `coupons`, `attributes`, `cart_items`, `order_items`, or any other table — because most of those **have no `updated_at` column at all**. See [`triggers-analysis.md`](./triggers-analysis.md).

---

## 10. `release_expired_reservations` — scheduled, running, and a guaranteed no-op

```
FOR each order WHERE order_status = 'pending_payment' AND created_at < now() - interval '30 minutes'
  UPDATE products SET reserved_quantity = GREATEST(0, reserved_quantity - <summed order qty>)
  INSERT inventory_transactions (type='reservation_release', ...)
  UPDATE orders SET order_status='failed', payment_status='failed'
```

`SECURITY DEFINER`, `SET search_path = public`. **Scheduled via `pg_cron` job 1, `*/5 * * * *`, active, owner `postgres`.**

### 🟠 F-HIGH-8 — the reservation subsystem is structurally dead

Verified chain of facts:

1. The cron job **is** running and **is** succeeding — `cron.job_run_details` shows **35,309 successful executions**, most recent at extraction time, mean 6.99 ms.
2. It only ever selects orders with `order_status = 'pending_payment'`.
3. **No order ever has that status.** `create_order_v2` and `create_order_v1` both hard-code `'processing'`. The `'pending_payment'` value is only reachable via the column DEFAULT, i.e. a direct INSERT that omits `order_status`.
4. It releases `reserved_quantity`, which **no code path ever increments** — both order functions decrement `stock_quantity` directly.
5. Live confirmation: `reserved_quantity = 0` for **all 85 products**; `inventory_transactions` contains **zero** rows of type `reservation_release` or `reservation`.

**Conclusion:** the 30-minute reservation lifecycle described in `plan_business_logic.md` §4 was implemented in the database but is unreachable from the application. The job has burned ~35k no-op executions. There is exactly one order with `order_status='failed'` (0 items, 0 history rows, created in the 2026-04-29 seed batch) — consistent with a seeded `pending_payment` row that this job later failed, which is the only evidence the code path can fire at all.

**Migration implication:** do **not** port this as an existing behaviour. Treat inventory reservation as an *unimplemented requirement* to be designed deliberately in `InventoryModule`, or dropped.

---

## 11. Consolidated business-rule contract (for the NestJS rewrite)

What the database **actually** does today — the behaviour the NestJS implementation must consciously reproduce or consciously change:

| # | Rule | Verified behaviour |
|---|---|---|
| 1 | Order pricing | `price = COALESCE(sale_price, base_price)`, read server-side; client prices ignored (v2) |
| 2 | Variant pricing | `base_price + price_modifier`; **ignores `sale_price`** |
| 3 | Order total | `total = subtotal + shipping_fee`. **discount, tax always 0. No coupon logic exists.** |
| 4 | Order number | `NE-YYYYMMDD-NNNN`, **global** sequence, not per-day |
| 5 | Initial statuses | `processing` / `pending` / `unfulfilled` |
| 6 | Stock on checkout | `stock_quantity` decremented directly; `reserved_quantity` untouched |
| 7 | Stock guard | `WHERE stock_quantity >= quantity`; failure aborts the whole order |
| 8 | Active/deleted check at checkout | **None** |
| 9 | Quantity floor at checkout | **None** — negative quantities accepted |
| 10 | Ledger on sale | `type='sale'`, `quantity = -qty`, `reference_type='order'`, `created_by=NULL` |
| 11 | Status transitions | **Unvalidated in the DB**; app-side matrix only |
| 12 | Stock on cancel/fail | **Never restored** |
| 13 | Tracking number | **Cannot be stored — column does not exist** |
| 14 | Stock adjustment | Signed delta, floor 0, ledger `type='adjustment'`, `created_by` set |
| 15 | Profile creation | Trigger; `role` defaults to `customer`; `full_name` falls back to email |
| 16 | `updated_at` | Trigger on 5 tables only |
| 17 | Admin check | `is_admin()` — `admin` and `super_admin` are equivalent |
| 18 | Search sort | Fixed `rank, is_featured, created_at` — not parameterised |
| 19 | Category filter | Exact slug; **no subtree** |
| 20 | Reservation expiry | Scheduled but unreachable; effectively absent |

---

## 12. Traceability — Phase 0 assumptions vs verified reality

| Phase 0 assumption | Verdict |
|---|---|
| `create_order_v2` validates product active + stock | **PARTLY WRONG** — validates stock, **not** active/deleted |
| `create_order_v2` prices server-side | **CORRECT** |
| `create_order_v2` computes subtotal/discount/total | **PARTLY WRONG** — no discount, no tax; `total = subtotal + shipping` |
| `create_order_v2` adjusts `reserved_quantity` | **WRONG** — decrements `stock_quantity` |
| `create_order_v2` is one transaction | **CORRECT** |
| `update_order_status_v2` "likely releases/commits stock" | **WRONG** — touches no stock at all |
| `update_order_status_v2` writes history | **CORRECT** |
| `p_tracking_number` has no destination column | **CORRECT — and it breaks the call entirely** |
| `adjust_stock_v2` updates stock + ledger | **CORRECT** |
| `adjust_product_stock` is dead | **Function does not exist at all** — it was never created; the `product.provider.ts:121` call would 404 |
| `generate_order_number` is sequential/enumerable | **CORRECT**, and worse: global, not per-day |
| `is_admin()` exists but unused by app | **CORRECT** — but it backs 28 RLS policies |
| `release_expired_reservations` may be cron-driven | **CORRECT that cron runs it; WRONG that it does anything** |
| RLS is the only thing protecting the data | **WRONG** — four SECURITY DEFINER RPCs bypass RLS entirely and are granted to `anon` |

> Note on `adjust_product_stock`: Phase 0 listed it as a dead RPC. It is not merely uncalled — **no such function exists in the database**. Any call to it would fail.
