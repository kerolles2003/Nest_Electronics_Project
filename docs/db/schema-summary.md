# Database Schema Summary — Live Supabase (Phase 0.5)

**Source:** live production database, project ref `quhllllvwwuizjfrxvdz`, PostgreSQL 17.6.
**Extraction:** 2026-08-29, read-only catalog queries inside `BEGIN TRANSACTION READ ONLY` (always rolled back).
**Companion file:** [`schema.sql`](./schema.sql) — faithful DDL representation.

## Global facts (VERIFIED)

| Property | Value |
|---|---|
| Tables (`public`) | **28** |
| Columns | **232** |
| Foreign keys | **40** |
| Primary keys | 28 |
| Unique constraints | 15 |
| CHECK constraints | **13** |
| PostgreSQL enum types | **0** — every status is `text` + CHECK |
| Views / materialized views | **0 / 0** |
| Indexes | **67** |
| RLS | **enabled on all 28 tables**, 52 public policies |
| Money type | `numeric(10,2)` throughout |
| Non-public schemas | auth, storage, cron, extensions, graphql, realtime, vault, supabase_migrations |

> Phase 0 could only read a generated `database.ts`. Every item above is now verified against the live catalog.

### Corrections / confirmations vs the Phase 0 audit

| Phase 0 claim | Live verification |
|---|---|
| PKs inferred, unique constraints unknown | **Confirmed** — 28 PKs, 15 unique constraints |
| `orders.tracking_number` has no destination column | **CONFIRMED MISSING** — and `update_order_status_v2` writes to it. See functions-analysis.md |
| `categories.updated_at` / `brands.updated_at` do not exist | **CONFIRMED MISSING** |
| `admin_audit_logs.user_agent` does not exist | **CONFIRMED MISSING** |
| `products.avg_rating` / `review_count` do not exist | **CONFIRMED MISSING** |
| `cart_items` has no price column | **CONFIRMED MISSING** |
| `product_tags` / `review_votes` have composite PKs | **CONFIRMED** |
| 39 foreign keys | Actually **40** |

---

## Table catalogue

### `addresses`  ·  1 rows

**Purpose:** Saved shipping addresses.

**Primary key:** `PRIMARY KEY (id)`

**Columns (11):** `id`, `user_id`, `label`, `full_name`, `phone`, `street`, `city`, `governorate`, `postal_code`, `is_default`, `created_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `user_id` NN · `label` NN ='Home' · `full_name` NN · `phone` NN · `street` NN · `city` NN · `governorate` NN · `is_default` =false · `created_at` =now()

**Relationships (1 FK):**
- `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`

**Constraints:** 0 unique · 0 check

**Indexes (1):** `addresses_pkey`

**RLS:** enabled · 1 policy [ALL]

**Application usage (evidence-based):** account/addresses page — browser-direct CRUD only

**Migration importance:** **Low** — embed into users.addresses[]

---

### `admin_audit_logs`  ·  0 rows

**Purpose:** Admin audit trail.

**Primary key:** `PRIMARY KEY (id)`

**Columns (8):** `id`, `admin_id`, `action`, `entity_type`, `entity_id`, `changes`, `ip_address`, `created_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `admin_id` NN · `action` NN · `entity_type` NN · `created_at` =now()

**Relationships (1 FK):**
- `FOREIGN KEY (admin_id) REFERENCES profiles(id)`

**Constraints:** 0 unique · 0 check

**Indexes (3):** `admin_audit_logs_pkey`, `idx_audit_admin`, `idx_audit_entity`

**RLS:** enabled · 2 policies [INSERT, SELECT]

**Application usage (evidence-based):** log-action.ts insert (fails silently); admin audit page

**Migration importance:** **Medium** (0 rows — see data-integrity.md)

---

### `attribute_values`  ·  0 rows

**Purpose:** Allowed values per attribute.

**Primary key:** `PRIMARY KEY (id)`

**Columns (5):** `id`, `attribute_id`, `value_en`, `value_ar`, `sort_order`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `attribute_id` NN · `value_en` NN · `sort_order` =0

**Relationships (1 FK):**
- `FOREIGN KEY (attribute_id) REFERENCES attributes(id) ON DELETE CASCADE`

**Constraints:** 0 unique · 0 check

**Indexes (1):** `attribute_values_pkey`

**RLS:** enabled · 2 policies [ALL, SELECT]

**Application usage (evidence-based):** Joined by /api/attributes

**Migration importance:** **Low** — embed (0 rows)

---

### `attributes`  ·  9 rows

**Purpose:** EAV attribute definitions.

**Primary key:** `PRIMARY KEY (id)`

**Columns (10):** `id`, `name_en`, `name_ar`, `slug`, `type`, `unit`, `is_filterable`, `is_comparable`, `sort_order`, `category_ids`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `name_en` NN · `slug` NN · `type` NN · `is_filterable` =false · `is_comparable` =true · `sort_order` =0

**Relationships (0 FK):** none

**Constraints:** 1 unique (`attributes_slug_key`) · 1 check
  - `CHECK ((type = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'select'::text, 'multi_select'::text])))`

**Indexes (2):** `attributes_pkey`, `attributes_slug_key`

**RLS:** enabled · 2 policies [ALL, SELECT]

**Application usage (evidence-based):** GET /admin/api/attributes

**Migration importance:** **Medium** — embed values

---

### `blog_posts`  ·  6 rows

**Purpose:** CMS posts.

**Primary key:** `PRIMARY KEY (id)`

**Columns (16):** `id`, `author_id`, `title_en`, `title_ar`, `slug`, `content_en`, `content_ar`, `excerpt`, `cover_image`, `category`, `tags`, `is_published`, `published_at`, `deleted_at`, `created_at`, `updated_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `author_id` NN · `title_en` NN · `slug` NN · `is_published` =false · `created_at` =now() · `updated_at` =now()

**Relationships (1 FK):**
- `FOREIGN KEY (author_id) REFERENCES profiles(id)`

**Constraints:** 1 unique (`blog_posts_slug_key`) · 0 check

**Indexes (2):** `blog_posts_pkey`, `blog_posts_slug_key`

**RLS:** enabled · 2 policies [ALL, SELECT]

**Application usage (evidence-based):** Public blog read; no authoring UI

**Migration importance:** **Low**

---

### `brands`  ·  17 rows

**Purpose:** Manufacturers.

**Primary key:** `PRIMARY KEY (id)`

**Columns (8):** `id`, `name_en`, `name_ar`, `slug`, `logo_url`, `is_active`, `deleted_at`, `created_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `name_en` NN · `slug` NN · `is_active` =true · `created_at` =now()

**Relationships (0 FK):** none

**Constraints:** 1 unique (`brands_slug_key`) · 0 check

**Indexes (2):** `brands_pkey`, `brands_slug_key`

**RLS:** enabled · 2 policies [ALL, SELECT]

**Application usage (evidence-based):** Catalogue, admin brands

**Migration importance:** **Low**

---

### `cart_items`  ·  4 rows

**Purpose:** Cart lines. **No price column.**

**Primary key:** `PRIMARY KEY (id)`

**Columns (5):** `id`, `cart_id`, `product_id`, `variant_id`, `quantity`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `cart_id` NN · `product_id` NN · `quantity` NN =1

**Relationships (3 FK):**
- `FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE`
- `FOREIGN KEY (product_id) REFERENCES products(id)`
- `FOREIGN KEY (variant_id) REFERENCES product_variants(id)`

**Constraints:** 1 unique (`cart_items_cart_id_product_id_variant_id_key`) · 1 check
  - `CHECK ((quantity > 0))`

**Indexes (2):** `cart_items_cart_id_product_id_variant_id_key`, `cart_items_pkey`

**RLS:** enabled · 1 policy [ALL]

**Application usage (evidence-based):** syncCartToDatabase only

**Migration importance:** **Medium** — needs price snapshot

---

### `carts`  ·  2 rows

**Purpose:** Cart header.

**Primary key:** `PRIMARY KEY (id)`

**Columns (5):** `id`, `user_id`, `session_id`, `created_at`, `updated_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `created_at` =now() · `updated_at` =now()

**Relationships (1 FK):**
- `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`

**Constraints:** 0 unique · 0 check

**Indexes (3):** `carts_pkey`, `idx_carts_session`, `idx_carts_user`

**RLS:** enabled · 1 policy [ALL]

**Application usage (evidence-based):** syncCartToDatabase only (write-only)

**Migration importance:** **Medium** — rebuild server-side

---

### `categories`  ·  27 rows

**Purpose:** Self-referencing category tree.

**Primary key:** `PRIMARY KEY (id)`

**Columns (10):** `id`, `name_en`, `name_ar`, `slug`, `parent_id`, `image_url`, `sort_order`, `is_active`, `deleted_at`, `created_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `name_en` NN · `slug` NN · `sort_order` =0 · `is_active` =true · `created_at` =now()

**Relationships (1 FK):**
- `FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL`

**Constraints:** 1 unique (`categories_slug_key`) · 0 check

**Indexes (2):** `categories_pkey`, `categories_slug_key`

**RLS:** enabled · 2 policies [ALL, SELECT]

**Application usage (evidence-based):** Catalogue nav (every page render), admin categories

**Migration importance:** **Medium** — needs materialised path[]

---

### `coupons`  ·  0 rows

**Purpose:** Discount definitions.

**Primary key:** `PRIMARY KEY (id)`

**Columns (11):** `id`, `code`, `type`, `value`, `min_order`, `max_discount`, `usage_limit`, `used_count`, `starts_at`, `expires_at`, `is_active`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `code` NN · `type` NN · `value` NN · `used_count` =0 · `is_active` =true

**Relationships (0 FK):** none

**Constraints:** 1 unique (`coupons_code_key`) · 1 check
  - `CHECK ((type = ANY (ARRAY['percentage'::text, 'fixed'::text])))`

**Indexes (2):** `coupons_code_key`, `coupons_pkey`

**RLS:** enabled · 1 policy [ALL]

**Application usage (evidence-based):** Admin CRUD only; no redemption path exists anywhere

**Migration importance:** **Low** (0 rows)

---

### `inventory_transactions`  ·  7 rows

**Purpose:** Stock ledger, written by create_order_v*/adjust_stock_v2/release_expired_reservations.

**Primary key:** `PRIMARY KEY (id)`

**Columns (10):** `id`, `product_id`, `variant_id`, `type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_by`, `created_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `product_id` NN · `type` NN · `quantity` NN · `created_at` =now()

**Relationships (3 FK):**
- `FOREIGN KEY (created_by) REFERENCES profiles(id)`
- `FOREIGN KEY (product_id) REFERENCES products(id)`
- `FOREIGN KEY (variant_id) REFERENCES product_variants(id)`

**Constraints:** 0 unique · 1 check
  - `CHECK ((type = ANY (ARRAY['purchase'::text, 'sale'::text, 'return'::text, 'adjustment'::text, 'reservation'::text, 'reservation_release'::text, 'damaged'::text])))`

**Indexes (3):** `idx_inv_tx_product`, `idx_inv_tx_reference`, `inventory_transactions_pkey`

**RLS:** enabled · 1 policy [ALL]

**Application usage (evidence-based):** Admin inventory drawer

**Migration importance:** **Medium**

---

### `notifications`  ·  0 rows

**Purpose:** In-app notifications.

**Primary key:** `PRIMARY KEY (id)`

**Columns (8):** `id`, `user_id`, `type`, `title`, `message`, `data`, `is_read`, `created_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `user_id` NN · `type` NN · `title` NN · `is_read` =false · `created_at` =now()

**Relationships (1 FK):**
- `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`

**Constraints:** 0 unique · 0 check

**Indexes (1):** `notifications_pkey`

**RLS:** enabled · 1 policy [ALL]

**Application usage (evidence-based):** None; AdminHeader renders mock data

**Migration importance:** **Low** — dead

---

### `order_items`  ·  7 rows

**Purpose:** Immutable order lines, written only by create_order_v1/v2.

**Primary key:** `PRIMARY KEY (id)`

**Columns (9):** `id`, `order_id`, `product_id`, `variant_id`, `name`, `sku`, `price`, `quantity`, `total`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `order_id` NN · `product_id` NN · `name` NN · `sku` NN · `price` NN · `quantity` NN · `total` NN

**Relationships (3 FK):**
- `FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE`
- `FOREIGN KEY (product_id) REFERENCES products(id)`
- `FOREIGN KEY (variant_id) REFERENCES product_variants(id)`

**Constraints:** 0 unique · 0 check

**Indexes (1):** `order_items_pkey`

**RLS:** enabled · 2 policies [INSERT, SELECT]

**Application usage (evidence-based):** Order views, dashboard rollups

**Migration importance:** **Low** — embed into orders.items[]

---

### `order_status_history`  ·  8 rows

**Purpose:** Append-only status audit, written only by update_order_status_v2.

**Primary key:** `PRIMARY KEY (id)`

**Columns (8):** `id`, `order_id`, `field`, `from_value`, `to_value`, `changed_by`, `notes`, `created_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `order_id` NN · `field` NN · `to_value` NN · `created_at` =now()

**Relationships (2 FK):**
- `FOREIGN KEY (changed_by) REFERENCES profiles(id)`
- `FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE`

**Constraints:** 0 unique · 0 check

**Indexes (1):** `order_status_history_pkey`

**RLS:** enabled · 2 policies [INSERT, SELECT]

**Application usage (evidence-based):** Order detail, activity feed

**Migration importance:** **Low** — embed

---

### `orders`  ·  10 rows

**Purpose:** Order header. Tri-status.

**Primary key:** `PRIMARY KEY (id)`

**Columns (19):** `id`, `user_id`, `order_number`, `order_status`, `payment_status`, `fulfillment_status`, `subtotal`, `discount`, `shipping_fee`, `tax`, `total`, `coupon_id`, `shipping_address`, `billing_address`, `payment_method`, `payment_provider_id`, `notes`, `created_at`, `updated_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `user_id` NN · `order_number` NN =generate_order_number() · `order_status` NN ='pending_payment' · `payment_status` NN ='pending' · `fulfillment_status` NN ='unfulfilled' · `subtotal` NN · `discount` =0 · `shipping_fee` =0 · `tax` =0 · `total` NN · `shipping_address` NN · `payment_method` ='cod' · `created_at` =now() · `updated_at` =now()

**Relationships (2 FK):**
- `FOREIGN KEY (coupon_id) REFERENCES coupons(id)`
- `FOREIGN KEY (user_id) REFERENCES profiles(id)`

**Constraints:** 1 unique (`orders_order_number_key`) · 3 check
  - `CHECK ((fulfillment_status = ANY (ARRAY['unfulfilled'::text, 'processing'::text, 'shipped'::text, 'delivered'::text, 'returned'::text])))`
  - `CHECK ((order_status = ANY (ARRAY['pending_payment'::text, 'paid'::text, 'processing'::text, 'shipped'::text, 'delivered'::text, 'cancelled'::text, 'failed'::text])))`
  - `CHECK ((payment_status = ANY (ARRAY['pending'::text, 'authorized'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'partially_refunded'::text])))`

**Indexes (5):** `idx_orders_number`, `idx_orders_status`, `idx_orders_user`, `orders_order_number_key`, `orders_pkey`

**RLS:** enabled · 3 policies [UPDATE, INSERT, SELECT]

**Application usage (evidence-based):** checkout, account/orders, admin/orders, order-tracking (browser)

**Migration importance:** **Very High**

---

### `product_attribute_values`  ·  0 rows

**Purpose:** EAV assignment.

**Primary key:** `PRIMARY KEY (id)`

**Columns (5):** `id`, `product_id`, `attribute_id`, `attribute_value_id`, `custom_value`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `product_id` NN · `attribute_id` NN

**Relationships (3 FK):**
- `FOREIGN KEY (attribute_id) REFERENCES attributes(id) ON DELETE CASCADE`
- `FOREIGN KEY (attribute_value_id) REFERENCES attribute_values(id)`
- `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE`

**Constraints:** 1 unique (`product_attribute_values_product_id_attribute_id_key`) · 0 check

**Indexes (5):** `idx_pav_attribute`, `idx_pav_product`, `idx_pav_value`, `product_attribute_values_pkey`, `product_attribute_values_product_id_attribute_id_key`

**RLS:** enabled · 2 policies [ALL, SELECT]

**Application usage (evidence-based):** PDP attribute display, admin product form

**Migration importance:** **Medium** — flatten into products.attributes[] (0 rows)

---

### `product_compatibility`  ·  0 rows

**Purpose:** "Works with" graph.

**Primary key:** `PRIMARY KEY (id)`

**Columns (5):** `id`, `product_id`, `compatible_product_id`, `compatibility_type`, `notes`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `product_id` NN · `compatible_product_id` NN · `compatibility_type` NN

**Relationships (2 FK):**
- `FOREIGN KEY (compatible_product_id) REFERENCES products(id) ON DELETE CASCADE`
- `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE`

**Constraints:** 1 unique (`product_compatibility_product_id_compatible_product_id_comp_key`) · 1 check
  - `CHECK ((compatibility_type = ANY (ARRAY['works_with'::text, 'requires'::text, 'replaces'::text, 'accessory_for'::text])))`

**Indexes (2):** `product_compatibility_pkey`, `product_compatibility_product_id_compatible_product_id_comp_key`

**RLS:** enabled · 2 policies [ALL, SELECT]

**Application usage (evidence-based):** None

**Migration importance:** **Low** — dead

---

### `product_images`  ·  22 rows

**Purpose:** Product gallery.

**Primary key:** `PRIMARY KEY (id)`

**Columns (6):** `id`, `product_id`, `url`, `alt_text`, `sort_order`, `is_primary`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `product_id` NN · `url` NN · `sort_order` =0 · `is_primary` =false

**Relationships (1 FK):**
- `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE`

**Constraints:** 0 unique · 0 check

**Indexes (1):** `product_images_pkey`

**RLS:** enabled · 2 policies [ALL, SELECT]

**Application usage (evidence-based):** PDP, admin upload

**Migration importance:** **Low** — embed into products.images[]

---

### `product_tags`  ·  0 rows

**Purpose:** Tag junction (composite PK).

**Primary key:** `PRIMARY KEY (product_id, tag)`

**Columns (2):** `product_id`, `tag`

**Not-null / defaulted:** `product_id` NN · `tag` NN

**Relationships (1 FK):**
- `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE`

**Constraints:** 0 unique · 0 check

**Indexes (1):** `product_tags_pkey`

**RLS:** enabled · 2 policies [ALL, SELECT]

**Application usage (evidence-based):** None

**Migration importance:** **Low** — dead

---

### `product_variants`  ·  0 rows

**Purpose:** Product variants. Referenced by the create_order_v2 variant branch.

**Primary key:** `PRIMARY KEY (id)`

**Columns (9):** `id`, `product_id`, `name`, `sku`, `price_modifier`, `stock_quantity`, `reserved_quantity`, `attributes`, `is_active`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `product_id` NN · `name` NN · `sku` NN · `price_modifier` =0 · `stock_quantity` NN =0 · `reserved_quantity` NN =0 · `is_active` =true

**Relationships (1 FK):**
- `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE`

**Constraints:** 1 unique (`product_variants_sku_key`) · 1 check
  - `CHECK ((stock_quantity >= reserved_quantity))`

**Indexes (2):** `product_variants_pkey`, `product_variants_sku_key`

**RLS:** enabled · 2 policies [ALL, SELECT]

**Application usage (evidence-based):** No application code path populates it (0 rows)

**Migration importance:** **Low** — embed; currently dead

---

### `products`  ·  85 rows

**Purpose:** Catalogue core.

**Primary key:** `PRIMARY KEY (id)`

**Columns (24):** `id`, `sku`, `name_en`, `name_ar`, `slug`, `description_en`, `description_ar`, `category_id`, `brand_id`, `base_price`, `sale_price`, `cost_price`, `stock_quantity`, `reserved_quantity`, `low_stock_threshold`, `weight`, `dimensions`, `is_active`, `is_featured`, `seo_title`, `seo_description`, `deleted_at`, `created_at`, `updated_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `sku` NN · `name_en` NN · `slug` NN · `base_price` NN · `stock_quantity` NN =0 · `reserved_quantity` NN =0 · `low_stock_threshold` =5 · `is_active` =true · `is_featured` =false · `created_at` =now() · `updated_at` =now()

**Relationships (2 FK):**
- `FOREIGN KEY (brand_id) REFERENCES brands(id)`
- `FOREIGN KEY (category_id) REFERENCES categories(id)`

**Constraints:** 2 unique (`products_sku_key`, `products_slug_key`) · 1 check
  - `CHECK ((stock_quantity >= reserved_quantity))`

**Indexes (9):** `idx_products_brand`, `idx_products_category`, `idx_products_featured`, `idx_products_search`, `idx_products_sku`, `idx_products_slug`, `products_pkey`, `products_sku_key`, `products_slug_key`

**RLS:** enabled · 2 policies [ALL, SELECT]

**Application usage (evidence-based):** Everywhere: search_products, PDP, admin products/inventory

**Migration importance:** **High** — central document

---

### `profiles`  ·  4 rows

**Purpose:** User profile, 1:1 with auth.users. Created automatically by the `on_auth_user_created` trigger.

**Primary key:** `PRIMARY KEY (id)`

**Columns (7):** `id`, `full_name`, `phone`, `avatar_url`, `role`, `created_at`, `updated_at`

**Not-null / defaulted:** `id` NN · `full_name` NN · `role` NN ='customer' · `created_at` =now() · `updated_at` =now()

**Relationships (1 FK):**
- `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`

**Constraints:** 0 unique · 1 check
  - `CHECK ((role = ANY (ARRAY['customer'::text, 'admin'::text, 'super_admin'::text])))`

**Indexes (1):** `profiles_pkey`

**RLS:** enabled · 3 policies [ALL, SELECT, UPDATE]

**Application usage (evidence-based):** requireAdmin(), admin proxy.ts, useAuth (browser), account/profile (browser upsert), admin/customers

**Migration importance:** **High** — merges with auth.users into MongoDB `users`

---

### `recently_viewed`  ·  0 rows

**Purpose:** View history.

**Primary key:** `PRIMARY KEY (id)`

**Columns (5):** `id`, `user_id`, `session_id`, `product_id`, `viewed_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `product_id` NN · `viewed_at` =now()

**Relationships (2 FK):**
- `FOREIGN KEY (product_id) REFERENCES products(id)`
- `FOREIGN KEY (user_id) REFERENCES profiles(id)`

**Constraints:** 0 unique · 0 check

**Indexes (3):** `idx_recently_viewed_session`, `idx_recently_viewed_user`, `recently_viewed_pkey`

**RLS:** enabled · 1 policy [ALL]

**Application usage (evidence-based):** None

**Migration importance:** **Low** — dead

---

### `review_images`  ·  0 rows

**Purpose:** Review photos.

**Primary key:** `PRIMARY KEY (id)`

**Columns (4):** `id`, `review_id`, `url`, `sort_order`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `review_id` NN · `url` NN · `sort_order` =0

**Relationships (1 FK):**
- `FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE`

**Constraints:** 0 unique · 0 check

**Indexes (1):** `review_images_pkey`

**RLS:** enabled · 3 policies [ALL, INSERT, SELECT]

**Application usage (evidence-based):** None

**Migration importance:** **Low** — dead

---

### `review_votes`  ·  0 rows

**Purpose:** Review helpfulness (composite PK).

**Primary key:** `PRIMARY KEY (user_id, review_id)`

**Columns (3):** `user_id`, `review_id`, `is_helpful`

**Not-null / defaulted:** `user_id` NN · `review_id` NN · `is_helpful` NN

**Relationships (2 FK):**
- `FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE`
- `FOREIGN KEY (user_id) REFERENCES profiles(id)`

**Constraints:** 0 unique · 0 check

**Indexes (1):** `review_votes_pkey`

**RLS:** enabled · 1 policy [ALL]

**Application usage (evidence-based):** None

**Migration importance:** **Low** — dead

---

### `reviews`  ·  0 rows

**Purpose:** Product reviews.

**Primary key:** `PRIMARY KEY (id)`

**Columns (10):** `id`, `user_id`, `product_id`, `rating`, `title`, `comment`, `is_verified_purchase`, `moderation_status`, `helpful_count`, `created_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `user_id` NN · `product_id` NN · `rating` NN · `is_verified_purchase` =false · `moderation_status` ='pending' · `helpful_count` =0 · `created_at` =now()

**Relationships (2 FK):**
- `FOREIGN KEY (product_id) REFERENCES products(id)`
- `FOREIGN KEY (user_id) REFERENCES profiles(id)`

**Constraints:** 1 unique (`reviews_user_id_product_id_key`) · 2 check
  - `CHECK ((moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))`
  - `CHECK (((rating >= 1) AND (rating <= 5)))`

**Indexes (4):** `idx_reviews_product`, `idx_reviews_user`, `reviews_pkey`, `reviews_user_id_product_id_key`

**RLS:** enabled · 4 policies [ALL, INSERT, UPDATE, SELECT]

**Application usage (evidence-based):** Admin moderation only; no storefront submit/display

**Migration importance:** **Medium** (0 rows)

---

### `slug_redirects`  ·  0 rows

**Purpose:** SEO 301 mappings.

**Primary key:** `PRIMARY KEY (id)`

**Columns (5):** `id`, `entity_type`, `old_slug`, `new_slug`, `created_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `entity_type` NN · `old_slug` NN · `new_slug` NN · `created_at` =now()

**Relationships (0 FK):** none

**Constraints:** 1 unique (`slug_redirects_entity_type_old_slug_key`) · 0 check

**Indexes (3):** `idx_slug_redirect`, `slug_redirects_entity_type_old_slug_key`, `slug_redirects_pkey`

**RLS:** enabled · 2 policies [ALL, SELECT]

**Application usage (evidence-based):** Written on product rename; never read

**Migration importance:** **Low** (0 rows)

---

### `wishlists`  ·  0 rows

**Purpose:** Saved products.

**Primary key:** `PRIMARY KEY (id)`

**Columns (4):** `id`, `user_id`, `product_id`, `created_at`

**Not-null / defaulted:** `id` NN =gen_random_uuid() · `user_id` NN · `product_id` NN · `created_at` =now()

**Relationships (2 FK):**
- `FOREIGN KEY (product_id) REFERENCES products(id)`
- `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`

**Constraints:** 1 unique (`wishlists_user_id_product_id_key`) · 0 check

**Indexes (3):** `idx_wishlists_user`, `wishlists_pkey`, `wishlists_user_id_product_id_key`

**RLS:** enabled · 1 policy [ALL]

**Application usage (evidence-based):** Dead Server Actions only; storefront uses localStorage

**Migration importance:** **Low** (0 rows)

---

