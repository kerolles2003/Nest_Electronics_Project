# MongoDB Document Design — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADRs:** ADR-DB-001 … 005

> **28 legacy tables → 12 collections.** Design is driven by observed access patterns and by the Phase 0.5 index-usage statistics, not by mechanical table translation.

---

## 1. Global decisions

| # | Decision | Reasoning |
|---|---|---|
| 1 | **`_id` is a MongoDB `ObjectId`** | Phase 0 recommended preserving legacy UUIDs to avoid an id map. Phase 0.5 established there is **no production data** — so there is nothing to preserve. ObjectIds are 12 bytes vs 36, carry a creation timestamp, and are idiomatic. |
| 2 | **Money is int64 minor units** | [`MONEY-MODEL.md`](./MONEY-MODEL.md) |
| 3 | **Timestamps everywhere**: `createdAt`, `updatedAt` | Legacy had `updated_at` on only **5 of 28** tables, and code wrote it to two tables that did not have the column — silent write failures. Mongoose `timestamps: true` applied uniformly. |
| 4 | **Soft delete via `deletedAt`** on catalogue entities only | Orders, events and audit logs are never deleted. Carts are hard-deleted (ephemeral). |
| 5 | **`strict: 'throw'`** on every schema | An unknown field raises instead of being silently dropped — the direct structural fix for the legacy type-drift class of bug (`updated_at`, `user_agent`). |
| 6 | **Localized text as `{ en, ar? }`** | [`CATALOG-MODEL.md`](./CATALOG-MODEL.md) §3 |
| 7 | **Replica set required** | Multi-document transactions for order placement. [`CONSISTENCY-MODEL.md`](./CONSISTENCY-MODEL.md) |

### Embed vs reference heuristic

| Embed when | Reference when |
|---|---|
| Bounded cardinality (< ~100, ideally < 20) | Unbounded growth |
| Always loaded with the parent | Independently queried |
| Not queried independently | Shared across parents |
| Lifecycle tied to the parent | Independent lifecycle |

**Third option used deliberately: reference + denormalised snapshot** — an id for truth, plus a small copy of display fields to avoid a `$lookup` on hot reads.

---

## 2. Collection overview

| # | Collection | From legacy | Est. size | Growth |
|---|---|---|---|---|
| 1 | `users` | `auth.users` + `profiles` + `addresses` | Small | Linear, slow |
| 2 | `products` | `products` + 6 child tables | Small–medium | Bounded by catalogue |
| 3 | `categories` | `categories` | Tiny (27) | Static |
| 4 | `brands` | `brands` | Tiny (17) | Static |
| 5 | `carts` | `carts` + `cart_items` | Small | TTL-bounded |
| 6 | `orders` | `orders` + `order_items` + `order_status_history` | Medium | **Unbounded** |
| 7 | `inventoryEvents` | `inventory_transactions` | Medium | **Unbounded, append-only** |
| 8 | `coupons` | `coupons` | Tiny | Slow |
| 9 | `couponRedemptions` | *(new)* | Small | Linear with orders |
| 10 | `reviews` | `reviews` + images + votes | Small | Linear |
| 11 | `blogPosts` | `blog_posts` | Tiny (6) | Slow |
| 12 | `auditLogs` | `admin_audit_logs` | Medium | **Unbounded, TTL** |

**Supporting (small, config-like):** `slugRedirects`, `specDefinitions`, `shippingRates`, `refreshTokens`, `mediaAssets`, `orderCounters`, `idempotencyKeys`.

### Collections deliberately NOT created

| Legacy table | Rows | Reason |
|---|---|---|
| `addresses` | 1 | Embedded in `users` |
| `product_images` | 22 | Embedded in `products` |
| `product_attribute_values`, `attributes`, `attribute_values` | 0, 9, 0 | Flattened into `products.specs[]` + `specDefinitions` |
| `product_variants` | 0 | **Variants removed** ([`CATALOG-MODEL.md`](./CATALOG-MODEL.md) §1) |
| `product_tags`, `product_compatibility` | 0, 0 | Feature removed / deferred |
| `cart_items` | 4 | Embedded in `carts` |
| `order_items`, `order_status_history` | 7, 8 | Embedded in `orders` |
| `review_images`, `review_votes` | 0, 0 | Embedded / deferred |
| `wishlists` | 0 | Client-side for MVP |
| `notifications` | 0 | In-app notifications removed |
| `recently_viewed` | 0 | Feature removed (and its RLS policy was world-writable) |

---

## 3. `users`

**Purpose:** identity, profile and address book in one document.
**Identity:** `_id` ObjectId; `email` is the natural key.

```jsonc
{
  "_id": ObjectId,
  "email": "maker@example.com",        // unique, lowercase
  "passwordHash": "$2b$12$…",          // NEVER leaves AuthModule
  "emailVerifiedAt": ISODate | null,
  "tokenVersion": 1,                   // bumped to invalidate access tokens

  "fullName": "…",
  "phone": "01012345678" | null,
  "avatar": { publicId, version, … } | null,

  "role": "CUSTOMER",                  // CUSTOMER | ADMIN | SUPER_ADMIN

  "addresses": [                       // EMBEDDED
    { "_id": ObjectId, "label": "Home", "fullName": "…", "phone": "…",
      "street": "…", "city": "…", "governorate": "Cairo",
      "postalCode": null, "isDefault": true }
  ],

  "stats": { "orderCount": 3, "totalSpent": 240000, "lastOrderAt": ISODate },

  "lastLoginAt": ISODate | null,
  "createdAt": …, "updatedAt": …, "deletedAt": null
}
```

| Relationship | Decision | Why |
|---|---|---|
| `auth.users` + `profiles` | **MERGE** | A 1:1 split that required a database trigger just to stay in sync. Merging deletes the trigger, the orphan risk and a join. |
| `addresses` | **EMBED** | Bounded (~1–10; live: 1), only ever read for one user, never queried globally. Legacy `addresses` had **no index on `user_id`** and served 18 sequential scans — embedding removes the need for the index entirely. |

**Read patterns:** by `email` (login) · by `_id` (JWT subject — the hottest query in the legacy system at 2,719 index scans) · by `role` + `createdAt` (admin list) · text on name/phone.
**Write patterns:** registration · profile update · address CRUD · `stats` increment on order events.

**Indexes**

| Index | Type | Purpose |
|---|---|---|
| `{ email: 1 }` | unique | Login, duplicate prevention |
| `{ role: 1, createdAt: -1 }` | | Admin customer list |
| `{ phone: 1 }` | sparse | Support lookup |
| `{ fullName: "text", email: "text" }` | text | Admin search |

**Growth risk:** none. `addresses` is bounded by UX (a "max 10 addresses" rule is applied).
**Invariant:** at most one address with `isDefault: true` — maintained in a **single atomic update** (legacy set the new default without unsetting siblings, permitting multiple defaults).

---

## 4. `products`

**Purpose:** the catalogue core and the system's largest read surface.
**Identity:** `_id`; `sku` and `slug` unique.

Full shape in [`CATALOG-MODEL.md`](./CATALOG-MODEL.md) §4.

| Relationship | Decision | Why |
|---|---|---|
| `product_images` | **EMBED** | ≤ 8, always loaded with the product. Legacy `product_images` had **no index on `product_id`** and showed **51,128 sequential scans** — the highest in the database. Embedding eliminates the join *and* the missing index. |
| EAV attributes (3 tables) | **EMBED as `specs[]`** | 0 assignments live, so no migration constraint. A multikey index makes faceting a single-collection query — something the legacy 3-table join made impossible. |
| `categories` | **REFERENCE + SNAPSHOT** | Every product card renders the category name. Pure reference forces `$lookup` on the hottest query. |
| `brands` | **REFERENCE + SNAPSHOT** | Same. Legacy search returned bare `brand_id`, which is precisely why grids rendered brand-less. |
| `reviews` | **REFERENCE (aggregate only)** | Unbounded per product. Only `rating {average, count, distribution}` is embedded. |
| `inventoryEvents` | **REFERENCE** | Unbounded, append-only. Only current `stock` is embedded. |
| `product_variants` | **REMOVED** | |

**Snapshot staleness:** renaming a category or brand triggers `updateMany({'category.id': X}, …)`. A rare admin operation over a bounded set; the stale window affects a **display label only** — never money, stock or identity.

**Read patterns:** by `slug` (PDP) · faceted list (category subtree, brand, price range, stock, specs) × 5 sorts · `$text` search · featured · newest · admin list · sitemap bulk.
**Write patterns:** admin CRUD · `stock` (Inventory only) · `rating` (Reviews only) · `salesCount` (Orders only) · snapshot refresh.

**Indexes**

| Index | Purpose |
|---|---|
| `{ slug: 1 }` unique · `{ sku: 1 }` unique | Direct lookup |
| `product_text_search` weighted text | Free-text search ([`SEARCH-MODEL.md`](./SEARCH-MODEL.md) §3) |
| `{ isActive:1, deletedAt:1, 'category.path':1, 'pricing.effectivePrice':1 }` | Category browse + price sort |
| `{ isActive:1, deletedAt:1, 'brand.id':1 }` | Brand pages |
| `{ isActive:1, isFeatured:1 }` | Homepage (legacy's hottest product index) |
| `{ isActive:1, createdAt:-1 }` | Newest |
| `{ isActive:1, 'rating.average':-1 }` | Rating sort |
| `{ 'specs.key':1, 'specs.value':1 }` multikey | Facets |

**Growth risk:** `images[]` capped at 8; `specs[]` realistically < 30. Document size stays far below 16 MB.

---

## 5. `categories` & `brands`

```jsonc
// categories
{ "_id", "slug" (unique), "name": {en, ar?},
  "parentId": ObjectId | null,
  "path": [ObjectId, …],        // ancestors, root-first — THE key decision
  "depth": 1,
  "image": {…} | null, "sortOrder": 0,
  "isActive": true, "productCount": 42, "deletedAt": null }
```

**Why `path[]`:** MongoDB has no recursive CTE. A materialised ancestor array turns "all products in this subtree" into one indexed `$in` — fixing the legacy defect where a parent-category page omitted every child category's products. `$graphLookup` was rejected: too expensive for a tree rendered on **every page**.

Live tree: 27 categories, 17 roots, **max depth 2**. Max depth 3 is enforced; reparenting rewrites `path[]` for the subtree and runs cycle detection.

**Separate collections, not embedded:** referenced by every product, independently queried, and the nav tree is read on every page.

**Indexes:** `{slug:1}` unique · `{parentId:1, sortOrder:1}` · `{path:1}` · `{isActive:1, deletedAt:1}`.
`brands` is a flat list: `{slug:1}` unique · `{isActive:1, deletedAt:1}`. **53 of 85 products have no brand** — `brand` is nullable and every listing must render without one.

---

## 6. `carts`

Full model in [`CART-MODEL.md`](./CART-MODEL.md).

```jsonc
{ "_id", "userId" (unique), "items": [ { productId, quantity, addedAt,
    snapshot: { name, sku, slug, unitPrice, imagePublicId } } ],
  "updatedAt", "expiresAt" }
```

`cart_items` is **embedded** (bounded, always loaded together). `snapshot` is **display-only and refreshed on every read** — never trusted for money.

**Indexes:** `{userId:1}` unique · `{expiresAt:1}` **TTL 30 days**.
**Growth risk:** bounded by TTL. Legacy had no expiry.

---

## 7. `orders`

**The strongest embedding case in the system.** Full shape in [`ORDER-LIFECYCLE.md`](./ORDER-LIFECYCLE.md) §10.

| Relationship | Decision | Why |
|---|---|---|
| `order_items` | **EMBED as an immutable snapshot** | An order is a point-in-time contract. Prices must not move when the catalogue changes. Legacy `order_items` had **no index on `order_id`** (307 seq scans, 0 index scans) — embedding removes the need. |
| `order_status_history` | **EMBED** | Append-only, bounded by workflow length (< 15). Same missing-index situation (99 seq scans). |
| `shippingAddress` | **EMBED (copy)** | Editing a saved address must never rewrite where a past order was shipped. |
| `customer` | **EMBED (snapshot)** | Admin order lists need name/phone with **zero joins**. Legacy's customer page ran a 6-query rollup. |
| `coupon` | **EMBED (snapshot)** | Editing a coupon must not rewrite order history. |
| `userId` | **REFERENCE** | The user has an independent lifecycle. |
| `items[].productId` | **REFERENCE (id only)** | For traceability and reorder; display data is snapshotted. |

**Read patterns:** by `_id` + `userId` (customer detail) · by `userId` sorted `placedAt` (account list) · by `orderNumber` + phone (tracking) · by `status` + `placedAt` (admin queue) · aggregations for dashboard revenue and top products.
**Write patterns:** insert once at placement · status transitions (guarded update + history push) · shipment write.

**Indexes**

| Index | Purpose |
|---|---|
| `{ orderNumber: 1 }` unique | Tracking, support |
| `{ userId: 1, placedAt: -1 }` | Account order list |
| `{ status: 1, placedAt: -1 }` | Admin work queue |
| `{ 'shippingAddress.phone': 1 }` | **Guest tracking** — required by the new secure endpoint |
| `{ placedAt: -1 }` | Dashboard/reports |
| `{ 'items.productId': 1 }` | Sales rollups, verified-purchase checks |
| `{ idempotencyKey: 1 }` unique sparse | Duplicate submission prevention |

**Growth risk:** unbounded collection, but each **document** is bounded (items realistically < 50, history < 15). Documents are never updated in a way that grows them unboundedly. Archival is not needed at this scale; if it becomes so, orders older than N years move to a cold collection.

---

## 8. `inventoryEvents`

Append-only ledger. Full model in [`INVENTORY-MODEL.md`](./INVENTORY-MODEL.md) §4.

**Separate collection, not embedded in `products`:** unbounded growth (one document per line item per event, forever) would eventually breach the 16 MB document limit and would make every product read carry the entire stock history.

**Indexes**

| Index | Purpose |
|---|---|
| `{ productId: 1, createdAt: -1 }` | Movement history |
| `{ 'reference.type': 1, 'reference.id': 1 }` | All events for an order |
| `{ 'reference.id': 1, productId: 1, type: 1 }` **unique sparse** | **Idempotent stock restoration** — makes a double cancel/return structurally impossible |
| `{ createdAt: -1 }` | Recent activity |

**Never updated, never deleted.** Immutability is the point.

---

## 9. `coupons` & `couponRedemptions`

Full model in [`DISCOUNT-MODEL.md`](./DISCOUNT-MODEL.md) §3.

`couponRedemptions` is a **separate collection**, not embedded in the coupon: unbounded (a coupon may have thousands of redemptions), and it must be queried by `userId` to enforce `perUserLimit`.

**Indexes:** `coupons {code:1}` unique · `{isActive:1, expiresAt:1}`.
`couponRedemptions {couponId:1, userId:1}` · `{couponId:1, orderId:1}` **unique** (prevents double redemption) · `{userId:1}`.

---

## 10. `reviews`

```jsonc
{ "_id", "productId", "product": { slug, name },      // snapshot
  "userId", "author": { fullName, avatarPublicId },   // snapshot
  "rating": 5, "title", "comment",
  "isVerifiedPurchase": true, "orderId": ObjectId | null,
  "status": "APPROVED",                                // PENDING|APPROVED|REJECTED
  "moderatedBy", "moderatedAt",
  "images": [ … ],                                     // embedded, deferred
  "helpful": { "count": 3, "userIds": [ … ] },         // embedded for MVP
  "createdAt", "updatedAt" }
```

**Separate collection:** unbounded per product.
**Author and product snapshots embedded:** the moderation queue and PDP list render with zero joins.
**`helpful.userIds` embedded for MVP:** bounded in practice at this scale. Promote to its own collection if a review can plausibly exceed a few thousand votes.

**Indexes:** `{productId:1, status:1, createdAt:-1}` · `{userId:1, productId:1}` **unique** (one review per user per product) · `{status:1, createdAt:-1}` (moderation queue) · `{isVerifiedPurchase:1}`.

---

## 11. `blogPosts`, `auditLogs` and supporting collections

```jsonc
// blogPosts
{ _id, slug (unique), title:{en,ar?}, excerpt, content:{en,ar?},
  coverImage, category, tags:[], author:{id, fullName},
  isPublished, publishedAt, createdAt, updatedAt, deletedAt }
```
Indexes: `{slug:1}` unique · `{isPublished:1, publishedAt:-1}` · `{tags:1}` · text on title/excerpt.

```jsonc
// auditLogs  — see AUDIT-MODEL.md
{ _id, actor:{id,role,name}, action, entity:{type,id},
  changes:{before,after}, ip, userAgent, requestId, createdAt }
```
Indexes: `{createdAt:-1}` · `{'entity.type':1,'entity.id':1}` · `{'actor.id':1, createdAt:-1}` · `{action:1}` · **TTL 2 years**.

> Legacy `admin_audit_logs` had **0 rows** because the insert targeted a `user_agent` column that did not exist and PostgREST *returned* the error rather than throwing. `userAgent` is a real field here, and audit-write failure is logged loudly.

**Supporting collections**

| Collection | Purpose | Key index |
|---|---|---|
| `slugRedirects` | `{entityType, oldSlug, newSlug}` — **must be read**, 301 | `{entityType:1, oldSlug:1}` unique |
| `specDefinitions` | Canonical `key → label/unit/filterable` dictionary | `{key:1}` unique |
| `shippingRates` | Governorate → fee, free-shipping threshold | `{governorate:1}` unique |
| `refreshTokens` | `{tokenHash, userId, expiresAt, revokedAt}` | `{tokenHash:1}` unique · `{userId:1}` · `{expiresAt:1}` TTL |
| `mediaAssets` | Reference counting for Cloudinary assets | `{publicId:1}` unique |
| `orderCounters` | `{date, seq}` — daily order-number counter | `{date:1}` unique |
| `idempotencyKeys` | `{key, userId, orderId, createdAt}` | `{key:1}` unique · TTL 24 h |

---

## 12. The four explicit relationship decisions

The brief asks these to be decided explicitly.

### 12.1 Order items — snapshot or live reference?

> **SNAPSHOT, embedded.** An order is an immutable commercial record. A renamed, repriced or deleted product must not alter what a past order says. `productId` is retained purely for traceability and reorder. This is **PRESERVED** from legacy — one of the few things the old design got right.

### 12.2 Product images — embedded or separate?

> **EMBEDDED.** Bounded at 8, always loaded with the product, never queried independently. Legacy kept them separate *and forgot the `product_id` index*, producing 51,128 sequential scans on a 22-row table. Embedding removes both the join and the index.

### 12.3 Addresses — embedded in user or separate?

> **EMBEDDED.** ~1–10 per user, only ever read for one user, never queried globally. Legacy kept them separate and also had no `user_id` index. The single-document embed additionally makes the "exactly one default" invariant enforceable in one atomic update — the legacy defect where setting a new default never unset the previous one.

### 12.4 Order history — embedded or separate?

> **EMBEDDED.** Append-only, bounded by workflow length (< 15 entries), always displayed with the order, never queried across orders. It is *business* history, distinct from the security audit log, which **is** a separate collection because it spans entities and is queried independently.

---

## 13. Index summary & validation

**~40 indexes across 12 collections**, every one justified by an access pattern in [`SEARCH-MODEL.md`](./SEARCH-MODEL.md), [`ORDER-LIFECYCLE.md`](./ORDER-LIFECYCLE.md) or the Phase 0.5 usage statistics.

**Legacy indexes deliberately NOT reproduced:**

| Legacy index | Why not |
|---|---|
| `idx_orders_status` (35,512 scans) | Almost entirely the no-op reservation cron. A status index still exists — justified by the admin queue, not by that job. |
| 4 duplicate pairs (`idx_products_slug`/`products_slug_key`, `idx_products_sku`/`products_sku_key`, `idx_orders_number`/`orders_order_number_key`, `idx_slug_redirect`/unique) | Pure write amplification |
| `product_images(product_id)`, `order_items(order_id)`, `order_status_history(order_id)`, `addresses(user_id)` | **All four now embedded** — the indexes are unnecessary. Notably these were the four *missing* indexes causing sequential scans, so embedding fixes a real defect rather than relocating it. |

**Phase 2 validation:** `explain()` must confirm `IXSCAN` (never `COLLSCAN`) for the top 10 queries — product list, product by slug, search, order by user, order by number, cart by user, review by product, low stock, admin order queue, user by email.

---

## 14. Summary

| Aspect | Decision |
|---|---|
| Collections | **12 core + 7 supporting** (from 28 tables) |
| Embedded | addresses, images, specs, cart items, order items, status history, review images/votes |
| Referenced | user→orders, product→reviews, product→inventoryEvents, coupon→redemptions |
| Reference + snapshot | product→category, product→brand, review→author/product, order→customer |
| Immutable snapshots | order items, order pricing, order address, order coupon |
| Never deleted | orders, inventoryEvents, auditLogs |
| TTL | carts (30 d), refreshTokens, auditLogs (2 y), idempotencyKeys (24 h) |
| Transactions | Required for order placement — **replica set mandatory** |
| Schema strictness | `strict: 'throw'` — fixes the legacy silent-write-failure class |
