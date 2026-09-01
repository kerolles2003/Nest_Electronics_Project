# Index & Performance Forensics — Phase 0.5

**Source:** live production database, project ref `quhllllvwwuizjfrxvdz`, PostgreSQL 17.6.
**Extraction:** 2026-08-29 via `pg_indexes`, `pg_stat_user_indexes`, `pg_stat_user_tables`, read-only.
**Exact definitions:** [`indexes.sql`](./indexes.sql).

> `scans` figures below are cumulative `idx_scan` counters from live production statistics. They reflect real traffic, so they are strong evidence of which access paths are actually exercised — but note the dataset is small (85 products, 10 orders), so the planner often prefers sequential scans regardless of index availability.

---

## 1. Summary

| Metric | Value |
|---|---|
| Total indexes (`public`) | **67** |
| Unique / primary-key indexes | 43 |
| Secondary (non-constraint) indexes | 24 |
| Partial indexes | 5 |
| GIN / full-text indexes | 1 |
| **Indexes never used (`idx_scan = 0`)** | **42 of 67** |
| **Duplicate index pairs** | **4** |
| **Missing indexes on live hot paths** | **4** (see §4) |

---

## 2. Extracted indexes, by table (with live usage)

### High-traffic

| Table | Index | Columns / type | Unique | Scans | Purpose / query pattern | Migration importance |
|---|---|---|---|---|---|---|
| `orders` | `idx_orders_status` | btree(order_status) | no | **35,512** | Almost entirely the `pg_cron` job's `WHERE order_status='pending_payment'` every 5 min — **not** user traffic | **Low** — artefact of a no-op job |
| `orders` | `orders_pkey` | btree(id) | yes | 395 | Order detail | High |
| `orders` | `idx_orders_user` | btree(user_id) | no | 94 | `/account/orders` | High |
| `orders` | `idx_orders_number` | btree(order_number) | no | 3 | Order tracking lookup | Medium |
| `brands` | `brands_pkey` | btree(id) | yes | 6,129 | Product→brand join on every listing | High |
| `categories` | `categories_pkey` | btree(id) | yes | 4,327 | Category tree + product→category join | High |
| `profiles` | `profiles_pkey` | btree(id) | yes | 2,719 | `requireAdmin()` / `useAuth` — the #1 application query | High |
| `products` | `idx_products_featured` | btree(is_featured) **partial** `is_active AND deleted_at IS NULL` | no | 621 | Homepage featured block | High |
| `products` | `products_pkey` | btree(id) | yes | 209 | PDP / admin | High |
| `products` | `idx_products_category` | btree(category_id) **partial** | no | 162 | Category listing | High |
| `products` | `idx_products_brand` | btree(brand_id) **partial** | no | 131 | Brand listing | High |
| `products` | `products_slug_key` | btree(slug) | yes | 84 | PDP by slug | High |
| `products` | `idx_products_slug` | btree(slug) | no | 64 | **Duplicate of the above** | — |
| `product_attribute_values` | `idx_pav_product` | btree(product_id) | no | 60 | PDP attributes | Medium |
| `categories` | `categories_slug_key` | btree(slug) | yes | 361 | Category page | High |
| `brands` | `brands_slug_key` | btree(slug) | yes | 54 | Brand page | High |
| `product_images` | `product_images_pkey` | btree(id) | yes | 20 | — | Low |
| `reviews` | `idx_reviews_product` | btree(product_id) **partial** `moderation_status='approved'` | no | 18 | Approved reviews per product | Medium |
| `carts` | `carts_pkey` / `idx_carts_user` | btree | — | 11 / 4 | Cart sync | Medium |
| `inventory_transactions` | `idx_inv_tx_product` | btree(product_id) | no | 4 | Inventory drawer | Medium |
| `attributes` | `attributes_slug_key` | btree(slug) | yes | 9 | — | Low |
| `cart_items` | `cart_items_cart_id_product_id_variant_id_key` | btree(cart_id, product_id, variant_id) | yes | 2 | Cart merge upsert | Medium |
| `blog_posts` | `blog_posts_pkey`, `blog_posts_slug_key` | btree | yes | 1 / 1 | Blog | Low |

### Never used (`idx_scan = 0`) — 42 indexes

Almost all sit on the **9 empty tables** (`coupons`, `reviews`, `wishlists`, `notifications`, `recently_viewed`, `product_variants`, `product_tags`, `product_compatibility`, `review_images`, `review_votes`, `slug_redirects`, `attribute_values`, `product_attribute_values`, `admin_audit_logs`) — zero usage is expected there and carries no signal.

The ones that **do** carry signal:

| Index | Why it is unused | Verdict |
|---|---|---|
| `idx_products_search` (GIN, full-text) | **The query cannot use it.** `search_products` ORs the `tsvector` match with `sku ILIKE '%q%'` and `name_en ILIKE '%q%'`, which have no index; the planner therefore falls back to a sequential scan for the whole predicate. | 🔴 **Real design defect** — see §3 |
| `idx_products_sku` | Duplicate of `products_sku_key`; and SKU lookup is not on any hot path | Drop the duplicate |
| `orders_order_number_key` | Superseded by `idx_orders_number` for lookups (the unique constraint still enforces uniqueness) | Keep constraint, drop the redundant plain index |
| `order_items_pkey`, `order_status_history_pkey` | Both tables are **only ever accessed by `order_id`**, which has **no index** | 🔴 See §4 |
| `addresses_pkey` | Table only accessed by `user_id`, which has **no index** | 🔴 See §4 |
| `idx_audit_admin`, `idx_audit_entity` | `admin_audit_logs` is empty because audit writes fail | See [`data-integrity.md`](./data-integrity.md) |

---

## 3. 🔴 The full-text index cannot be used by the only query that would use it

`idx_products_search` is defined **correctly** — expression and partial predicate both match `search_products` exactly:

```sql
CREATE INDEX idx_products_search ON public.products
  USING gin (to_tsvector('english', name_en || ' ' || COALESCE(description_en,'')))
  WHERE is_active = true AND deleted_at IS NULL;
```

But `search_products` evaluates:

```sql
search_query IS NULL OR search_query = ''
  OR to_tsvector(...) @@ plainto_tsquery(...)   -- indexable
  OR p.sku     ILIKE '%' || search_query || '%' -- NOT indexable (leading wildcard)
  OR p.name_en ILIKE '%' || search_query || '%' -- NOT indexable
```

A disjunction is only index-accessible if **every** branch is. Two branches use leading-wildcard `ILIKE` with no trigram index, so PostgreSQL must scan every row regardless. Live confirmation: **`idx_products_search` scans = 0**, while `products` shows 1,282 sequential scans.

At 85 products this is invisible. It is a hard scaling wall, and it means the project is **paying the write cost of a GIN index it can never read**.

**Recommendation (for `SearchModule`, Phase 5):** MongoDB Atlas Search or a `$text` index, with prefix/fuzzy matching handled by the search engine rather than bolted on as `ILIKE` fallbacks. Do not reproduce the OR-chain.

---

## 4. 🔴 Missing indexes on live hot paths

These are **extracted facts**, not speculation — each is a foreign key that is queried constantly and has no supporting index.

| # | Missing index | Evidence | Impact |
|---|---|---|---|
| 1 | **`product_images(product_id)`** | `product_images`: **51,128 sequential scans** vs 20 index scans, on 22 rows. Highest seq-scan count in the database. | Every product listing and PDP joins `product_images` by `product_id` and scans the whole table. At 85 products × N images this is cheap; at 10k products it is catastrophic. |
| 2 | **`order_items(order_id)`** | `order_items`: 307 seq scans, **0 index scans** | Every order detail, account order list and dashboard rollup scans the full table |
| 3 | **`order_status_history(order_id)`** | 99 seq scans, **0 index scans** | Every order-detail render scans the table |
| 4 | **`addresses(user_id)`** | 18 seq scans, **0 index scans** | The only query this table ever receives is by `user_id` |

**Why this matters for the migration:** all four are *exactly* the relationships that Phase 0 proposed to **embed** in MongoDB (`products.images[]`, `orders.items[]`, `orders.statusHistory[]`, `users.addresses[]`). Embedding removes the need for these indexes entirely — so this finding **independently validates the proposed document model** rather than adding work to it.

---

## 5. 🟡 Duplicate indexes (4 pairs)

Each pair indexes identical columns, doubling write amplification for no read benefit.

| Table | Constraint index | Redundant plain index | Action |
|---|---|---|---|
| `products` | `products_slug_key` UNIQUE(slug) | `idx_products_slug` (slug) | Drop `idx_products_slug` |
| `products` | `products_sku_key` UNIQUE(sku) | `idx_products_sku` (sku) | Drop `idx_products_sku` |
| `orders` | `orders_order_number_key` UNIQUE(order_number) | `idx_orders_number` (order_number) | Drop `idx_orders_number` |
| `slug_redirects` | `slug_redirects_entity_type_old_slug_key` UNIQUE(entity_type, old_slug) | `idx_slug_redirect` (entity_type, old_slug) | Drop `idx_slug_redirect` |

Also near-redundant: `product_attribute_values_product_id_attribute_id_key` UNIQUE(product_id, attribute_id) already covers a `product_id` prefix lookup, making `idx_pav_product` largely superfluous.

> Not to be fixed now — this phase is read-only. Recorded so the MongoDB index design does not inherit the duplication.

---

## 6. Sequential-scan profile (live)

| Table | Seq scans | Index scans | Live rows | Reading |
|---|---|---|---|---|
| `product_images` | **51,128** | 20 | 22 | Missing FK index (§4.1) |
| `categories` | 1,664 | 4,688 | 27 | Category tree built in JS on every page render (Phase 0 P1) |
| `products` | 1,282 | 1,271 | 85 | Search always scans (§3) |
| `brands` | 852 | 6,183 | 17 | Brand list per page render |
| `orders` | 409 | 36,004 | 10 | Index scans dominated by the cron no-op |
| `order_items` | 307 | 0 | 7 | Missing FK index (§4.2) |
| `order_status_history` | 99 | 0 | 8 | Missing FK index (§4.3) |
| `admin_audit_logs` | 61 | 0 | 0 | Admin audit page querying an empty table |

The `categories`/`brands` numbers are direct live confirmation of Phase 0 **P1**: the root layout renders `<Navbar/>`, which fetches the category tree on *every* storefront page, uncached.

---

## 7. Index requirements carried into MongoDB

Derived from the access patterns that the live statistics prove are real:

| Collection | Index | Justified by |
|---|---|---|
| `users` | `{email:1}` unique | Login |
| `users` | `{_id}` (default) | `profiles_pkey` — 2,719 scans, hottest query in the system |
| `users` | `{role:1, createdAt:-1}` | Admin customer list |
| `products` | `{slug:1}` unique | `products_slug_key` — 84 scans |
| `products` | `{sku:1}` unique | Uniqueness only; not a hot read |
| `products` | `{isActive:1, deletedAt:1, 'category.id':1}` | `idx_products_category` — 162 scans (mirror the **partial** predicate as a compound prefix) |
| `products` | `{isActive:1, deletedAt:1, 'brand.id':1}` | `idx_products_brand` — 131 scans |
| `products` | `{isActive:1, isFeatured:1}` | `idx_products_featured` — 621 scans, the single hottest product index |
| `products` | Atlas Search / `$text` on name+description | Replaces the unusable `idx_products_search` (§3) |
| `products` | `{'attributes.slug':1, 'attributes.value':1}` multikey | Enables the faceting the EAV schema never delivered |
| `categories` | `{slug:1}` unique, `{path:1}` | `categories_slug_key` — 361 scans; `path[]` replaces the JS tree build |
| `brands` | `{slug:1}` unique | `brands_slug_key` — 54 scans |
| `orders` | `{orderNumber:1}` unique | Tracking lookup |
| `orders` | `{userId:1, placedAt:-1}` | `idx_orders_user` — 94 scans |
| `orders` | `{'status.order':1, placedAt:-1}` | Admin order filtering |
| `orders` | `{'shippingAddress.phone':1}` | Required by the **new** server-side `POST /orders/track` |
| `inventoryTransactions` | `{productId:1, createdAt:-1}` | `idx_inv_tx_product` — 4 scans |
| `reviews` | `{productId:1, status:1, createdAt:-1}` | Mirrors the partial `idx_reviews_product` |
| `reviews` | `{userId:1, productId:1}` unique | One review per user per product |
| `auditLogs` | `{createdAt:-1}`, `{'entity.type':1,'entity.id':1}`, `{'actor.id':1}` | Mirrors `idx_audit_entity` / `idx_audit_admin` |
| `coupons` | `{code:1}` unique | `coupons_code_key` |

**Indexes deliberately NOT carried over:** `order_items(order_id)`, `order_status_history(order_id)`, `product_images(product_id)`, `addresses(user_id)` — all four become embedded arrays and need no index. `idx_orders_status` is an artefact of the no-op cron job and should not be reproduced on that basis (a status index is still justified by admin filtering).

---

## 8. Caveat on interpreting these statistics

The counters are cumulative since the last statistics reset and reflect a **development-scale dataset with synthetic traffic**: 85 products, 10 orders, 4 users. Two consequences:

1. **Zero scans does not prove an index is useless** — on tables this small the planner reasonably prefers a sequential scan even when a perfectly good index exists.
2. **The absolute numbers are dominated by the cron job**, which accounts for ~35,500 of the 36,000 `orders` index scans and inflates the apparent importance of `idx_orders_status`.

What *is* robust: the **relative** signal (which relationships are queried at all), the **structural** findings (missing FK indexes, duplicate pairs, the unusable GIN index), and the fact that `search_products` never once used the full-text index it was built for.
