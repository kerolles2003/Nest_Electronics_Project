# Row Level Security Forensics — Phase 0.5

**Source:** live production database, project ref `quhllllvwwuizjfrxvdz`, PostgreSQL 17.6.
**Extraction:** 2026-08-29 via `pg_policies` + `pg_class.relrowsecurity`, read-only.
**Exact definitions:** [`policies.sql`](./policies.sql).

> Phase 0 marked the entire authorization model `UNKNOWN`. **It is now fully recovered.**

---

## 1. Headline findings

| # | Finding | Phase 0 expectation | Verified reality |
|---|---|---|---|
| 1 | RLS enablement | Unknown | **Enabled on all 28 public tables.** None forced. 52 public policies + 6 storage policies. |
| 2 | **H1 — guest order tracking** | "Possible anon SELECT on `orders` → PII breach by order-number enumeration" | **NOT a breach. The feature is simply dead.** `orders_own_read` is `(auth.uid() = user_id) OR is_admin()`; an anonymous caller gets **zero rows**. |
| 3 | **H6 — role self-escalation via `profiles` upsert** | "Possible privilege escalation" | **BLOCKED.** `profiles_update_own` carries `WITH CHECK ((auth.uid() = id) AND (role = 'customer'))`. |
| 4 | **The RLS model is largely sound** | — | The policy set is coherent, consistently `is_admin()`-based, and mostly correct. |
| 5 | **…and it is comprehensively bypassed** | — | **Four `SECURITY DEFINER` RPCs granted to `anon` bypass every policy below.** See [`functions-analysis.md`](./functions-analysis.md) §F-CRIT-1. RLS is not the effective security boundary of this system. |
| 6 | **New: customer profile save is broken** | — | `profiles` has **no INSERT policy** for non-admins, but the app does a browser `upsert`. See §4.1. |
| 7 | **New: `recently_viewed` is world-writable** | — | `USING ((auth.uid() = user_id) OR (session_id IS NOT NULL))` on an `ALL` policy. See §4.2. |

**The single most important structural fact:** authorization hinges entirely on one function, `is_admin()`, referenced by **28 of the 52** public policies. It resolves `auth.uid()` against `profiles.role IN ('admin','super_admin')` and treats those two roles as identical.

---

## 2. Complete policy matrix (VERIFIED)

Legend — **A** = `is_admin()`; **own** = row belongs to `auth.uid()`; **pub** = unrestricted `true`.

| Table | RLS | Policy | Cmd | USING | WITH CHECK | Business meaning |
|---|---|---|---|---|---|---|
| `products` | ✔ | `products_public_read` | SELECT | `is_active AND deleted_at IS NULL` | — | Public catalogue shows only live products |
| | | `products_admin_all` | ALL | `is_admin()` | — | Admin full CRUD |
| `categories` | ✔ | `categories_public_read` | SELECT | `is_active AND deleted_at IS NULL` | — | Public tree |
| | | `categories_admin_all` | ALL | A | — | |
| `brands` | ✔ | `brands_public_read` | SELECT | `is_active AND deleted_at IS NULL` | — | |
| | | `brands_admin_all` | ALL | A | — | |
| `product_images` | ✔ | `product_images_public_read` | SELECT | **`true`** | — | ⚠ images of hidden products are readable |
| | | `product_images_admin_all` | ALL | A | — | |
| `product_variants` | ✔ | `product_variants_public_read` | SELECT | `is_active` | — | |
| | | `product_variants_admin_all` | ALL | A | — | |
| `product_tags` | ✔ | public read `true` / admin ALL | | | | ⚠ unrestricted read |
| `product_compatibility` | ✔ | public read `true` / admin ALL | | | | ⚠ unrestricted read |
| `attributes` | ✔ | public read `true` / admin ALL | | | | ⚠ unrestricted read |
| `attribute_values` | ✔ | public read `true` / admin ALL | | | | ⚠ unrestricted read |
| `product_attribute_values` | ✔ | public read `true` / admin ALL | | | | ⚠ unrestricted read |
| `slug_redirects` | ✔ | public read `true` / admin ALL | | | | Harmless |
| `profiles` | ✔ | `profiles_select_own` | SELECT | `auth.uid()=id OR A` | — | Read own profile |
| | | `profiles_update_own` | UPDATE | `auth.uid()=id` | **`auth.uid()=id AND role='customer'`** | **Blocks self-escalation** |
| | | `profiles_admin_all` | ALL | A | — | Admin full |
| `addresses` | ✔ | `addresses_own` | ALL | `auth.uid()=user_id OR A` | — | Own addresses (+admin) |
| `orders` | ✔ | `orders_own_read` | SELECT | `auth.uid()=user_id OR A` | — | **No anon access** |
| | | `orders_own_insert` | INSERT | — | `auth.uid()=user_id` | Can only create own order |
| | | `orders_admin_update` | UPDATE | A | — | **Only admins may update** |
| `order_items` | ✔ | `order_items_own` | SELECT | parent order own **or** A | — | |
| | | `order_items_insert` | INSERT | — | parent order `user_id=auth.uid()` | |
| `order_status_history` | ✔ | `order_history_own` | SELECT | parent order own **or** A | — | |
| | | `order_history_admin_insert` | INSERT | — | `is_admin()` | |
| `carts` | ✔ | `carts_own` | ALL | `auth.uid()=user_id OR A` | — | |
| `cart_items` | ✔ | `cart_items_own` | ALL | parent cart own **or** A | — | |
| `wishlists` | ✔ | `wishlists_own` | ALL | `auth.uid()=user_id` | — | |
| `notifications` | ✔ | `notifications_own` | ALL | `auth.uid()=user_id` | — | |
| `recently_viewed` | ✔ | `recently_viewed_own` | ALL | **`auth.uid()=user_id OR session_id IS NOT NULL`** | — | ⚠ **broken — see §4.2** |
| `reviews` | ✔ | `reviews_public_read` | SELECT | `moderation_status='approved'` | — | Only approved shown |
| | | `reviews_own_insert` | INSERT | — | `auth.uid()=user_id` | |
| | | `reviews_own_update` | UPDATE | `auth.uid()=user_id AND moderation_status='pending'` | (inherits USING) | Can edit only while pending |
| | | `reviews_admin_all` | ALL | A | — | Moderation |
| `review_images` | ✔ | public read `true`; own INSERT via parent review; admin ALL | | | | |
| `review_votes` | ✔ | `review_votes_own` | ALL | `auth.uid()=user_id` | — | |
| `coupons` | ✔ | `coupons_admin_all` | ALL | A | — | **No public read at all** |
| `inventory_transactions` | ✔ | `inventory_admin_all` | ALL | A | — | Admin only |
| `admin_audit_logs` | ✔ | `audit_logs_admin_read` | SELECT | A | — | |
| | | `audit_logs_admin_insert` | INSERT | — | `is_admin()` | |
| `blog_posts` | ✔ | `blog_public_read` | SELECT | `is_published AND deleted_at IS NULL` | — | |
| | | `blog_admin_all` | ALL | A | — | |

---

## 3. Resolution of the two Phase 0 blocking security questions

### 3.1 H1 — Guest order tracking: **the feature is dead, not leaking**

`apps/storefront/src/stores/orderTrackingStore.ts:46` runs, from the browser, a select on `orders` filtered by `order_number` alone. The governing policy is:

```sql
orders_own_read  SELECT  USING ((auth.uid() = user_id) OR is_admin())
```

For an anonymous visitor `auth.uid()` is NULL and `is_admin()` is false, so **the query returns zero rows every time**. The client-side phone comparison at `orderTrackingStore.ts:57-64` never executes against real data.

| Question | Answer |
|---|---|
| Is production PII currently exposed? | **No.** |
| Is order-number enumeration exploitable here? | **No** — RLS denies before any row is returned. |
| Does guest order tracking work at all? | **No. It is silently broken** — a guest always sees "order not found". |
| Does tracking work for a logged-in customer? | **Yes**, but only for their own orders. |

**Reclassification:** Phase 0 H1 drops from *HIGH (possible active breach)* to **a broken feature** — but it is still a **rewrite** for the migration, and the eventual `POST /orders/track` endpoint must implement the server-side phone check that the current design only pretended to have.

> The genuine order-data risk lies elsewhere: `update_order_status_v2` is callable by `anon` (F-CRIT-1), which permits **tampering** with any order even though **reading** it is properly blocked.

### 3.2 H6 — Role self-escalation: **blocked**

```sql
profiles_update_own  UPDATE
  USING      (auth.uid() = id)
  WITH CHECK ((auth.uid() = id) AND (role = 'customer'))
```

The `WITH CHECK` is evaluated against the **post-update row**, so any attempt to set `role` to `admin`/`super_admin` is rejected. A customer cannot escalate through the browser `upsert`. **Phase 0 H6 is mitigated.**

Two second-order notes:
- An existing admin cannot use this policy on their own row (their `role` is not `'customer'`); they pass via `profiles_admin_all` instead. No functional gap.
- The protection is a *policy*, not a constraint or trigger. Any `SECURITY DEFINER` function, the service-role key, or a direct SQL connection can still set `role` freely. Role assignment has no defence in depth.

---

## 4. New defects discovered in the policy layer

### 4.1 🟠 `profiles` has no INSERT policy — the customer profile page cannot save

`profiles` policies: `profiles_select_own` (SELECT), `profiles_update_own` (UPDATE), `profiles_admin_all` (ALL, admin-gated). **There is no INSERT policy for a normal authenticated user.**

`apps/storefront/src/app/account/profile/page.tsx:79` performs a browser `upsert` on `profiles`. PostgREST compiles `.upsert()` to `INSERT ... ON CONFLICT DO UPDATE`, and PostgreSQL evaluates the **INSERT** policy for such a statement. With RLS enabled and no applicable INSERT policy, the statement is rejected:

```
new row violates row-level security policy for table "profiles"
```

| Claim | Confidence |
|---|---|
| The policy set contains no non-admin INSERT policy on `profiles` | **VERIFIED** (catalog) |
| PostgREST `.upsert()` emits `INSERT ... ON CONFLICT DO UPDATE` | **VERIFIED** (documented PostgREST behaviour) |
| Therefore a customer's profile save fails | **INFERRED — high confidence.** Not executed, because this phase performs no writes. |

**Cheap confirmation** (Phase 1, non-destructive): sign in as a test customer and save the profile form; expect a `42501`-class RLS error. The one `super_admin` account would *not* reproduce it — `profiles_admin_all` covers them — which plausibly explains why this was never noticed.

### 4.2 🟠 `recently_viewed` is effectively world-readable and world-writable

```sql
recently_viewed_own  ALL  USING ((auth.uid() = user_id) OR (session_id IS NOT NULL))
```

The second disjunct is a property of **the row**, not of the caller. Any row with a non-NULL `session_id` therefore satisfies the predicate for **every** caller, including `anon` — and because this is an `ALL` policy with no separate `WITH CHECK`, that covers SELECT, INSERT, UPDATE **and DELETE**.

Live impact today is nil (0 rows, feature never built), but this is a latent hole that must not be carried forward. It is also a useful illustration for the NestJS review: *a policy predicate must constrain the subject, not merely describe the object.*

### 4.3 🟡 Unrestricted `SELECT USING (true)` on 7 catalogue tables

`product_images`, `product_tags`, `product_compatibility`, `attributes`, `attribute_values`, `product_attribute_values`, `slug_redirects` are readable by anyone.

Mostly benign, but inconsistent with the sibling `products`/`categories`/`brands` policies which correctly filter `is_active AND deleted_at IS NULL`. Consequence: **the images and attributes of unpublished, deactivated or soft-deleted products remain publicly readable**, leaking unreleased-product information. The NestJS equivalent must apply the parent's visibility rule to child resources.

### 4.4 🟡 Admin writes depend on RLS, and failure is silent

Every admin mutation uses the **user-scoped anon-key client**, not the service role, so it passes through `*_admin_all` policies. This is a defensible design, but it has the failure mode Phase 0 predicted (P4): if an admin policy were dropped, admin pages would render **empty** and writes would fail quietly rather than erroring loudly. Confirmed as the live architecture.

### 4.5 🟡 No DELETE policy on `orders`, and no admin INSERT

`orders` has SELECT/INSERT/UPDATE only. Orders can never be deleted by any role through PostgREST, and admins cannot create orders — both are reasonable, and worth preserving deliberately in NestJS rather than by accident.

---

## 5. Storage policies

6 policies on `storage.objects`. See [`../storage/inventory.md`](../storage/inventory.md) for the full bucket analysis.

| Policy | Cmd | Roles | Expression |
|---|---|---|---|
| `Public Read Access` | SELECT | public | `bucket_id = 'products'` |
| `Admin Insert Products` | INSERT | public | `bucket_id='products' AND is_admin()` |
| `Admin Insert Blog` | INSERT | public | `bucket_id='blog' AND is_admin()` |
| `Users Insert Avatars` | INSERT | public | `bucket_id='avatars' AND auth.uid()::text = (storage.foldername(name))[1]` |
| `Users Insert Reviews` | INSERT | public | `bucket_id='reviews' AND auth.uid()::text = (storage.foldername(name))[1]` |
| `Admin CRUD Access` | ALL | authenticated | `bucket_id='products' AND EXISTS(profiles WHERE id=auth.uid() AND role IN ('admin','super_admin'))` |

**Observations:**
- Only the `products` bucket has a SELECT policy. `avatars`, `blog`, `reviews` have **INSERT policies but no SELECT policy** — reads of those buckets work only because the buckets are marked `public = true` and are served through the public CDN path, which does not consult RLS.
- `Admin CRUD Access` re-implements `is_admin()` inline rather than calling it — a duplicated definition of "who is an admin", and a maintenance hazard.
- **No DELETE policy targets `blog`, `avatars` or `reviews`** — objects in those buckets can be created but never removed through the API by their owners.

---

## 6. Translation to the future NestJS model

**Do not implement yet** — this is the specification Phase 4 must satisfy.

```
CURRENT (Supabase)                       FUTURE (NestJS)
──────────────────                       ───────────────
anon/authenticated JWT                   JwtAuthGuard (global) + @Public()
   ↓                                        ↓
PostgREST applies RLS per row            Controller → Guard → Service
   ↓                                        ↓
USING (auth.uid() = user_id)             OwnershipGuard / findForUser(userId, id)
USING (is_admin())                       @Roles('admin','super_admin')
WITH CHECK (role = 'customer')           DTO whitelisting: `role` not in UpdateProfileDto
```

| # | RLS policy | NestJS responsibility | Notes |
|---|---|---|---|
| 1 | `products/categories/brands_public_read` | Repository always applies `{isActive:true, deletedAt:null}` on public routes | Separate admin route returns everything |
| 2 | `*_public_read USING (true)` on 7 child tables | **Tighten:** child visibility must inherit the parent's | Fixes §4.3 |
| 3 | `profiles_select_own` | `GET /users/me`; userId from JWT, never from the request | |
| 4 | `profiles_update_own` + `role='customer'` check | `PATCH /users/me` with a whitelisted DTO excluding `role`; role only via `PATCH /admin/users/:id/role` under `@Roles('super_admin')` | Preserves §3.2, and adds the privilege separation the DB never had |
| 5 | `addresses_own` | `/users/me/addresses/*` sub-resource | Fixes §4.1 by removing browser DB access entirely |
| 6 | `orders_own_read` | `OrdersService.findForUser(userId, id)` | Never accept `userId` from the body |
| 7 | `orders_own_insert` | `POST /orders` derives userId from the JWT | **Closes F-CRIT-2** |
| 8 | `orders_admin_update` | `@Roles('admin')` on `/admin/orders/:id/*` **plus** a server-side transition matrix | **Closes F-HIGH-1** |
| 9 | (no policy) guest order tracking | `POST /orders/track` — server-side phone compare, generic 404, rate-limited | Builds the feature that never worked |
| 10 | `order_history_admin_insert` | Written by `OrdersService` only, never from a controller DTO | |
| 11 | `reviews_public_read/own_insert/own_update` | Public list filters `approved`; submission requires auth + verified purchase; edit only while `pending` | Preserves the state rule |
| 12 | `coupons_admin_all` (no public read) | `POST /coupons/validate` — server-side validation, never expose the coupon table | |
| 13 | `inventory_admin_all` | `@Roles('admin')`; writes only from `InventoryService` | |
| 14 | `audit_logs_admin_*` | Written by an interceptor with system privilege, **never** by the audited principal | Fixes Phase 0 M12 |
| 15 | `carts_own` / `cart_items_own` | `/cart` bound to the JWT subject or a signed guest-cart cookie | |
| 16 | `recently_viewed_own` | **Do not port the predicate.** Redesign or drop. | Fixes §4.2 |
| 17 | Storage policies | `UploadsModule` guards + Cloudinary; parent-visibility-aware reads | |
| 18 | `is_admin()` | `RolesGuard`, with `admin` and `super_admin` finally distinguished | |

`RECOMMENDATION` Build a **policy → guard traceability table** as a Phase 4 deliverable, one row per policy above, each with a passing authorization test. That table is the only credible evidence that R2 (RLS→guard translation) has been discharged.

---

## 7. The critical caveat

Everything in this document describes a policy layer that is **substantially well built** — and **not the system's actual security boundary**.

`create_order_v2`, `create_order_v1`, `update_order_status_v2` and `adjust_stock_v2` are `SECURITY DEFINER` and carry `EXECUTE` for `anon`. They bypass every policy above and contain no authorization logic of their own. Any assessment of this database's security that stops at `pg_policies` will be wrong.

See [`functions-analysis.md`](./functions-analysis.md) §F-CRIT-1 and [`../PHASE-0.5-REPORT.md`](../PHASE-0.5-REPORT.md) §12.
