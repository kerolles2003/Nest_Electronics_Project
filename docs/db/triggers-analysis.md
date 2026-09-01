# Trigger & Database Automation Forensics — Phase 0.5

**Source:** live production database, project ref `quhllllvwwuizjfrxvdz`, PostgreSQL 17.6.
**Extraction:** 2026-08-29 via `pg_trigger` + `pg_get_triggerdef()`, read-only.
**Exact definitions:** [`triggers.sql`](./triggers.sql).

---

## 1. Complete trigger inventory (VERIFIED)

**10 non-internal triggers exist** across `public`, `auth` and `storage`. Only **6** are application-relevant; the other 4 are Supabase Storage platform internals.

| # | Schema.Table | Trigger | Event | Timing | Function | Enabled | Purpose |
|---|---|---|---|---|---|---|---|
| 1 | `auth.users` | `on_auth_user_created` | INSERT | **AFTER** | `public.handle_new_user()` | O (enabled) | Provision the `public.profiles` row for a new account |
| 2 | `public.products` | `set_updated_at_products` | UPDATE | BEFORE | `public.handle_updated_at()` | O | Maintain `updated_at` |
| 3 | `public.orders` | `set_updated_at_orders` | UPDATE | BEFORE | `public.handle_updated_at()` | O | Maintain `updated_at` |
| 4 | `public.profiles` | `set_updated_at_profiles` | UPDATE | BEFORE | `public.handle_updated_at()` | O | Maintain `updated_at` |
| 5 | `public.carts` | `set_updated_at_carts` | UPDATE | BEFORE | `public.handle_updated_at()` | O | Maintain `updated_at` |
| 6 | `public.blog_posts` | `set_updated_at_blog_posts` | UPDATE | BEFORE | `public.handle_updated_at()` | O | Maintain `updated_at` |
| 7 | `storage.buckets` | `enforce_bucket_name_length_trigger` | INSERT | BEFORE | `storage.enforce_bucket_name_length()` | O | Platform internal |
| 8 | `storage.buckets` | `protect_buckets_delete` | DELETE | BEFORE | `storage.protect_delete()` | O | Platform internal |
| 9 | `storage.objects` | `protect_objects_delete` | DELETE | BEFORE | `storage.protect_delete()` | O | Platform internal |
| 10 | `storage.objects` | `update_objects_updated_at` | UPDATE | BEFORE | `storage.update_updated_at_column()` | O | Platform internal |

There are also 6 **event triggers** (`issue_graphql_placeholder`, `pgrst_ddl_watch`, `pgrst_drop_watch`, `issue_pg_cron_access`, `issue_pg_net_access`, `issue_pg_graphql_access`) — all Supabase platform DDL plumbing, no business meaning.

---

## 2. Hidden business behaviour implemented via triggers

### 2.1 `on_auth_user_created` → `handle_new_user()` — the only real business trigger

**This is the single piece of hidden business logic in the trigger layer, and it confirms the Phase 0 inference.**

```
INSERT INTO auth.users (by GoTrue on signup)
        │
        ▼  AFTER INSERT FOR EACH ROW
handle_new_user()   [SECURITY DEFINER, search_path=public]
        │
        ▼
INSERT INTO public.profiles (id, full_name, avatar_url)
VALUES (NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        NEW.raw_user_meta_data->>'avatar_url')
```

**Business impact:**

| Aspect | Verified behaviour |
|---|---|
| Profile creation | Automatic and unconditional on every `auth.users` insert |
| `role` | **Not written** — takes the column DEFAULT `'customer'`. Signup can never create an admin. |
| `full_name` | `raw_user_meta_data.full_name`, falling back to **the email address**. This is what satisfies the `NOT NULL` when the client omits the name. |
| `avatar_url` | From metadata; NULL for email signups (live: 0 of 4 profiles have one) |
| `phone` | **Never populated at signup.** Phone only ever arrives via the shipping address at checkout or a later profile edit. |
| Failure mode | No `ON CONFLICT`. A duplicate id would raise and **abort the whole signup transaction** — the `auth.users` row would not be created either. |
| Live integrity | 4 `auth.users` ↔ 4 `profiles`, **0 orphans in either direction**. The trigger is working correctly. |

**Migration requirement:** NestJS must perform this explicitly inside the registration transaction — create the user *and* its profile fields atomically. In the MongoDB model these merge into a single `users` document (§19 of Phase 0), which removes the need for this trigger entirely. The `full_name → email` fallback and the `role = 'customer'` default must be reproduced deliberately.

### 2.2 `handle_updated_at()` — partial and inconsistent coverage

Attached to exactly **5** tables: `products`, `orders`, `profiles`, `carts`, `blog_posts`.

**VERIFIED:** these are precisely the only 5 tables in the schema that *have* an `updated_at` column.

| Has `updated_at` (5) | `blog_posts`, `carts`, `orders`, `products`, `profiles` |
|---|---|
| **No `updated_at` (23)** | `addresses`, `admin_audit_logs`, `attribute_values`, `attributes`, `brands`, `cart_items`, `categories`, `coupons`, `inventory_transactions`, `notifications`, `order_items`, `order_status_history`, `product_attribute_values`, `product_compatibility`, `product_images`, `product_tags`, `product_variants`, `recently_viewed`, `review_images`, `review_votes`, `reviews`, `slug_redirects`, `wishlists` |

**This confirms the Phase 0 type-drift finding with its root cause.** `apps/admin/src/actions/category-brand.actions.ts` writes `updated_at` to `categories` and `brands`; neither table has the column, so **those UPDATE statements fail**. PostgREST returns the error rather than throwing, so the failure is silent in code that does not inspect the returned error object.

Note also: `create_order_v2` and `update_order_status_v2` and `adjust_stock_v2` all set `updated_at = NOW()` *explicitly* in their own SQL, so the trigger is redundant on the paths that matter — but harmless.

---

## 3. Behaviour that is NOT implemented by triggers (verified absences)

This section exists because Phase 0 could not rule these out, and their absence is load-bearing for the migration plan.

| Expected automation | Present? | Consequence |
|---|---|---|
| **Rating rollup** (`reviews` → `products.avg_rating` / `review_count`) | **NO trigger, and no such columns exist** | The six UI mappers that read `avg_rating`/`review_count` render 0 permanently. Confirms Phase 0 B31. |
| **Inventory automation** (stock ↔ ledger consistency) | **NO trigger** | Ledger entries are written only by explicit function code. Any direct `UPDATE products SET stock_quantity` — including via PostgREST by an admin — changes stock with **no ledger row**. The ledger is therefore not a reliable audit of stock. |
| **Order total recalculation** | **NO trigger** | Totals are whatever `create_order_v2` wrote. A direct UPDATE to `order_items` will not reprice the order. |
| **Audit logging** (`admin_audit_logs`) | **NO trigger** | Audit depends entirely on the application remembering to call `logAdminAction()`. It currently fails silently — see [`data-integrity.md`](./data-integrity.md). |
| **Order status history** | **NO trigger** | Written only inside `update_order_status_v2`. A direct `UPDATE orders SET order_status=...` (permitted for admins by `orders_admin_update` RLS) changes status with **no history row**. |
| **Stock restoration on cancellation** | **NO trigger** | Confirms `update_order_status_v2` does not restore stock; nothing else does either. |
| **`coupons.used_count` increment** | **NO trigger** | No coupon consumption exists anywhere in the system. |
| **Soft-delete cascade** | **NO trigger** | Soft-deleting a category does not deactivate its products. |
| **`profiles.role` change protection** | **NO trigger** | Protection is provided by the `profiles_update_own` RLS `WITH CHECK` instead — see [`policies-analysis.md`](./policies-analysis.md). |

---

## 4. Scheduled automation — `pg_cron`

`pg_cron` **v1.6.4 is installed and active.** One job exists:

| jobid | jobname | schedule | command | active | database | owner |
|---|---|---|---|---|---|---|
| 1 | `release-expired-reservations` | `*/5 * * * *` | `SELECT release_expired_reservations()` | **true** | postgres | postgres |

**Execution history (VERIFIED from `cron.job_run_details`):** **35,309 runs, all `succeeded`**, mean 6.99 ms, most recent at extraction time (2026-08-29 15:30 UTC).

### 🟠 It is a guaranteed no-op — see [`functions-analysis.md`](./functions-analysis.md) §10

The job runs correctly and does nothing, because it only targets `order_status = 'pending_payment'` and no order function ever produces that status (both hard-code `'processing'`). Live proof: `reserved_quantity = 0` on all 85 products, and **zero** `reservation`/`reservation_release` rows in `inventory_transactions`.

**Migration requirement:** do not port this as existing behaviour. Inventory reservation is an *unimplemented specification*, not a working feature.

---

## 5. Storage triggers (platform, but migration-relevant)

`storage.protect_delete()` fires BEFORE DELETE on both `storage.buckets` and `storage.objects`:

```sql
IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
    RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
        USING ERRCODE = '42501';
END IF;
```

**Migration relevance:** storage objects cannot be removed by SQL — only through the Storage API. Any data-migration or cleanup script that tries to tidy `storage.objects` directly will fail. Deletion must go through the Storage HTTP API (or, post-migration, the Cloudinary SDK).

---

## 6. Summary for the NestJS architect

**Trigger logic to reimplement explicitly (only one item):**

1. `handle_new_user` → user+profile provisioning inside the registration flow, preserving the `full_name → email` fallback and the `role='customer'` default.

**Trigger logic to drop:**

2. `handle_updated_at` → replaced by Mongoose `timestamps: true`, applied **uniformly** (fixing the current 5-of-28 inconsistency).

**Scheduled job to NOT port as-is:**

3. `release-expired-reservations` → the reservation lifecycle must be designed from scratch if wanted, or explicitly dropped.

**The critical takeaway:** the trigger layer contains far less hidden logic than a system of this shape usually does. Almost all real business behaviour lives in the four `SECURITY DEFINER` RPC functions instead. That is good news for the migration — but it also means **no trigger is silently protecting any invariant**: stock, order totals, status history and the audit trail are all maintained only by cooperating application/function code, and any write that bypasses those functions bypasses the invariant.
