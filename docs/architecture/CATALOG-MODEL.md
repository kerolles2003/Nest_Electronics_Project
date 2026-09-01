# Product & Catalog Model — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADRs:** ADR-CATALOG-001 … 005

---

## 1. The variant decision

> ### **DECISION: Products have NO variants. One product = one SKU = one stock number.**

| Evidence | Finding |
|---|---|
| Legacy `product_variants` rows | **0** (Phase 0.5) |
| Legacy code writing variants | **None** — no admin UI, no API |
| Roadmap mention | **None** in `PROJECT_OVERVIEW.md` "Remaining Work" or `PRODUCT.md` |
| Legacy variant code quality | `create_order_v2`'s variant branch **ignored `sale_price`** and trusted a client-supplied `productId` without verifying it matched the variant's parent (F-HIGH-4, F-MED-3) |
| Domain fit | An ESP32-WROOM-32 and an ESP32-S3 are **different products** with different datasheets, prices and stock — not variants of one another. The same holds for resistor values, sensor models and cable lengths. |

**Reasoning.** Variants exist to model a single sellable concept with interchangeable options (a T-shirt in S/M/L). Electronic components do not work that way: a maker searching for "HC-SR04" wants that exact part, and a 10 kΩ resistor is not a "size" of a 1 kΩ resistor. Modelling them as distinct SKUs is both more accurate and more searchable.

**What this removes:** the `variants[]` array, `variantId` from cart and order lines, the variant branch of order creation (and its two bugs), and variant stock as a second inventory axis.

**Revisit condition (ADR-CATALOG-001):** if the store begins selling something genuinely optioned — a development board offered in 2 MB vs 4 MB flash at different prices under one part identity — revisit. The migration path is additive: an optional `variants[]` array plus a `variantId` on order lines. Until such a product exists, variants are speculative complexity.

---

## 2. Product identity

| Concern | Decision |
|---|---|
| **Primary key** | MongoDB `ObjectId` (`_id`). No production data exists to preserve, so the Phase 0 recommendation to keep legacy UUIDs is **obsolete** — there is nothing to keep. |
| **SKU** | Required, unique, uppercase-normalised, immutable after creation. The human/warehouse identifier. |
| **Slug** | Required, unique, lowercase kebab-case. The **public** URL identifier. |
| **Public URL** | `/products/{slug}` |
| **API addressing** | Public reads by `slug`; admin operations by `_id` |

**Why slug is not the `_id`:** slugs change when a product is renamed; primary keys must not. This is exactly what makes `slugRedirects` necessary.

### Slug behaviour (fixes legacy K4)

1. Generated from `name.en`, lowercased, non-alphanumerics → `-`, collapsed, trimmed.
2. Collision → numeric suffix (`esp32-devkit-2`), assigned under a uniqueness check.
3. **On rename, the old slug is written to `slugRedirects`** — as legacy did.
4. **New:** product resolution *reads* `slugRedirects`. An unknown slug is looked up there and answered with **HTTP 301** to the current slug. Legacy wrote redirects that nothing ever read, so every rename produced a permanent 404.
5. Redirect chains are collapsed at write time (A→B then B→C rewrites A→C), so resolution is always one hop.
6. Slug is admin-editable; a manual edit follows the same redirect rule.

---

## 3. Localisation

> **DECISION: user-facing catalogue text is a localized value object `{ en, ar? }`. MVP populates `en` only.**

```jsonc
"name": { "en": "ESP32 DevKit V1", "ar": null }
```

| Evidence | Finding |
|---|---|
| Legacy `name_ar` / `description_ar` | **100% NULL across all 85 products** |
| Roadmap | *"Arabic (i18n) — Planned post-MVP"* (`PROJECT_OVERVIEW.md`) |
| MVP scope | *"MVP: English-only, Arabic planned post-launch"* |

**Why not flat strings.** Arabic is an explicit, funded roadmap item. Retrofitting localisation into a document store means rewriting every product document, every DTO and every index. A `{en, ar?}` object costs one nesting level today and makes Arabic purely additive later.

**Why not a full i18n framework.** No locale negotiation, no fallback chains, no translation workflow, no per-locale slugs in MVP. That would be overengineering.

**Rules:**
- `en` is required; `ar` is optional and omitted when absent.
- API resolves to a flat string using `Accept-Language`, defaulting to `en` and falling back to `en` when `ar` is missing. Clients receive `"name": "ESP32 DevKit V1"`, not the object.
- **Text indexes are built on `en` only** in MVP. An Arabic index is added when Arabic content exists (Arabic needs its own analyzer; indexing empty fields is waste).
- Applies to: `product.name`, `product.description`, `product.shortDescription`, `category.name`, `brand.name`, `blogPost.title/excerpt/content`. **Not** to SKU, slug, or spec values.

---

## 4. Product document shape (conceptual)

```jsonc
{
  "_id": ObjectId,
  "sku": "ESP32-DEVKIT-V1",             // unique, immutable, uppercase
  "slug": "esp32-devkit-v1",            // unique, public identifier

  "name":        { "en": "…", "ar": null },
  "shortDescription": { "en": "…" },     // listing/card copy
  "description": { "en": "…", "ar": null },

  // --- references + denormalised snapshot (see §6) ---
  "category": { "id": ObjectId, "slug": "microcontrollers",
                "name": { "en": "Microcontrollers" },
                "path": [ObjectId, ObjectId] },   // ancestors, for subtree queries
  "brand":    { "id": ObjectId, "slug": "espressif",
                "name": { "en": "Espressif" } } | null,

  // --- money: integer minor units (see MONEY-MODEL.md) ---
  "pricing": {
    "basePrice": 32500,
    "salePrice": 28000,          // nullable; must be < basePrice
    "costPrice": 21000           // ADMIN ONLY — never in a public DTO
  },
  "currency": "EGP",

  // --- stock: written ONLY by InventoryModule ---
  "stock": {
    "onHand": 149,
    "lowStockThreshold": 10
  },

  // --- media: publicId, never a URL (see MEDIA-MODEL.md) ---
  "images": [
    { "publicId": "nest/products/<id>/main-a1b2",
      "version": 1712345678, "format": "webp",
      "width": 1200, "height": 1200, "bytes": 84213,
      "alt": "ESP32 DevKit V1 front view",
      "sortOrder": 0, "isPrimary": true }
  ],

  // --- flattened specs, replacing the 3-table EAV (see §7) ---
  "specs": [
    { "key": "operating-voltage", "label": "Operating Voltage",
      "value": "3.3", "unit": "V", "filterable": true, "sortOrder": 0 },
    { "key": "connectivity", "label": "Connectivity",
      "value": "Wi-Fi + Bluetooth", "unit": null, "filterable": true, "sortOrder": 1 }
  ],

  // --- aggregates: written ONLY by their owning domain ---
  "rating": { "average": 430, "count": 12,          // average in hundredths (4.30)
              "distribution": { "1":0,"2":1,"3":1,"4":3,"5":7 } },
  "salesCount": 37,

  // --- state ---
  "isActive": true,
  "isFeatured": false,
  "deletedAt": null,

  // --- optional ---
  "seo": { "title": null, "description": null },
  "weight": null,                     // grams
  "dimensions": null,                 // { l, w, h } mm

  "createdAt": ISODate, "updatedAt": ISODate
}
```

### Field-ownership rules (enforced in Phase 2)

| Field | Sole writer | Rationale |
|---|---|---|
| `stock.*` | **InventoryModule** | Every mutation must produce a ledger event. The product DTO **rejects** `stock`, closing legacy defect M7 where an admin could change stock through a generic product update with no ledger entry. |
| `rating.*` | **ReviewsModule** | Recomputed on moderation changes |
| `salesCount` | **OrdersModule** | Incremented on order placement |
| `category`/`brand` snapshot | **CatalogModule** | Refreshed by a targeted `updateMany` when the parent is renamed |
| everything else | **CatalogModule** | |

`rating.average` is stored in **hundredths** (430 = 4.30) — an integer, consistent with the no-floats rule in [`MONEY-MODEL.md`](./MONEY-MODEL.md) §7.5, and it sorts correctly.

---

## 5. Pricing & discount behaviour

| Rule | Specification |
|---|---|
| Effective unit price | `salePrice ?? basePrice` — **PRESERVED** from legacy, which applied it consistently in checkout *and* price filters |
| Validity | `basePrice > 0`; if `salePrice` is set then `0 < salePrice < basePrice` (rejected otherwise) |
| Display | API returns `basePrice`, `salePrice`, `effectivePrice`, and `discountPercentBps` so the client never computes money |
| Sale scheduling | ❌ **Not in MVP.** No `saleStartsAt`/`saleEndsAt`. An admin sets and clears `salePrice`. Adding a schedule later is additive. |
| Product-level vs coupon discount | A `salePrice` is a **product-level** discount, already inside `itemsSubtotal`. Coupons apply **on top**, to the subtotal. See [`DISCOUNT-MODEL.md`](./DISCOUNT-MODEL.md). |
| `costPrice` | Optional, **admin-only**. Must never appear in a public DTO — enforced by separate `ProductPublicDto` / `ProductAdminDto` types, not by field-stripping at runtime. |

---

## 6. Category & brand relationships

**Decision: reference by id + carry a denormalised snapshot.**

```jsonc
"category": { "id": …, "slug": …, "name": {…}, "path": [ancestorIds] }
```

**Why both.** Every product card renders the brand and category name. A pure reference forces a `$lookup` on every listing query — and this is precisely what broke legacy search, whose RPC returned bare `category_id`/`brand_id` and therefore rendered brand-less grids (F-HIGH-5). A snapshot makes listings a single-collection read.

**Consistency:** renaming a category triggers `updateMany({'category.id': X}, {$set: {'category.name': …}})`. This is a rare admin operation over ≤ a few thousand documents. Staleness window is one operation, and it affects a display label only — never money, stock or identity.

### Category tree

| Concern | Decision |
|---|---|
| Structure | Self-referencing tree, `parentId` + **materialised `path[]`** of ancestor ids, plus `depth` |
| Live shape | 27 categories, 17 roots, **max depth 2** (Phase 0.5) |
| Why `path[]` | MongoDB has no recursive CTE. `path[]` turns "all products in this subtree" into one indexed `$in` — **fixing the legacy defect where a parent-category page omitted every child category's products** (F-MED-10) |
| Tree reads | One `find()` over all categories + in-memory assembly, served by a cached endpoint. Legacy queried this on **every page render** (1,664 seq scans, Phase 0 P1) |
| Maintenance | Reparenting a category rewrites `path[]` for its subtree in one operation. Cycle detection is mandatory on reparent. |
| Depth limit | Max 3 levels enforced — the live tree uses 2; deeper trees are a navigation smell |

### Brands

Flat list, no hierarchy. `slug` unique. Optional `logo` asset. Live: 17 brands, **53 of 85 products have no brand** — so `brand` is **nullable** and every listing must render without one.

---

## 7. Specs — replacing the EAV system

> **DECISION: the 3-table EAV system is replaced by a flat embedded `specs[]` array.**

| Legacy | Rows |
|---|---|
| `attributes` | 9 (definitions only) |
| `attribute_values` | **0** |
| `product_attribute_values` | **0** |

**The EAV system was never populated.** Zero assignments means zero migration cost and complete design freedom. Legacy required a 3-table join that `search_products` could not perform — which is why attribute faceting was designed but never delivered.

**New model:** each product embeds its own specs. A separate small `specDefinitions` collection holds the canonical `key → label/unit/filterable` dictionary used by the admin editor and for facet labelling, but **the product document is self-sufficient for reads**.

```jsonc
"specs": [
  { "key": "operating-voltage", "label": "Operating Voltage",
    "value": "3.3", "unit": "V", "filterable": true }
]
```

- **One multikey index** `{ "specs.key": 1, "specs.value": 1 }` makes faceted filtering a single-collection query.
- `value` is a **string**. Component specs are heterogeneous ("3.3", "Wi-Fi + Bluetooth", "-40…85"). Numeric range filtering is **not** in MVP; if it becomes necessary, add an optional `numericValue` alongside — additive, not a redesign.
- Specs are **display + facet** data. They never participate in pricing, stock or identity.

This directly serves `PRODUCT.md`'s stated principle that *"technical tone should come from useful specificity"* — specs are the product's technical substance, and this is the first design in which they are actually queryable.

---

## 8. Images

Full treatment in [`MEDIA-MODEL.md`](./MEDIA-MODEL.md). Catalog-side rules:

| Rule | Specification |
|---|---|
| Storage | **Embedded** `images[]` — bounded (≤ 8, already enforced client-side in legacy), always loaded with the product, never queried independently |
| Identity | `publicId` + `version`. **Never a URL** — fixes legacy E4/E5 where absolute Supabase URLs were persisted and deletion worked by string-splitting them |
| Dimensions | `width`/`height`/`bytes` captured at upload — **new**; legacy stored none, guaranteeing layout shift |
| Primary invariant | Exactly one `isPrimary` when `images` is non-empty; enforced in a **single atomic array update**, fixing the legacy two-statement non-atomic flip (K10) |
| Ordering | `sortOrder`; reordering is one atomic `$set` of the whole array, fixing the legacy N+1 update loop (K9) |
| Duplication | Product duplication **copies asset references with reference counting**, fixing legacy W4 where two products shared one storage object and deleting from either broke the other |
| Empty state | 74% of live products have no image. A product with zero images is **valid**; the UI must render a placeholder. |

---

## 9. Product state & deletion

> **DECISION: soft delete (`deletedAt`), preserved from legacy.**

| Rationale | |
|---|---|
| Orders embed product snapshots, so a deleted product never breaks order history — but analytics, reviews and reporting still need to resolve the product id | |
| SKUs and slugs must not be silently reusable | |
| Accidental deletion of a catalogue item is recoverable | |

| State | Meaning | Public visibility |
|---|---|---|
| `isActive: true, deletedAt: null` | Published and purchasable | ✅ Visible |
| `isActive: false, deletedAt: null` | Draft / temporarily unlisted | ❌ Hidden |
| `deletedAt: <date>` | Soft-deleted | ❌ Hidden |

**Rules:**
- Every public read filters `{ isActive: true, deletedAt: null }` — **enforced in the repository layer**, not left to individual queries.
- **Checkout re-validates this per line** — closing legacy defect C9/F-HIGH-3, where `create_order_v2` checked neither flag and inactive or soft-deleted products were purchasable.
- **Child resources inherit the parent's visibility** — images and specs of a hidden product are **not** publicly readable, fixing legacy Z6 where 7 child tables carried `SELECT USING (true)` and leaked unreleased products.
- Hard delete exists only as a `SUPER_ADMIN` operation for a product **never referenced by any order**, and it destroys the associated Cloudinary assets.

---

## 10. Searchable fields

Full contract in [`SEARCH-MODEL.md`](./SEARCH-MODEL.md).

| Field | Role | Weight |
|---|---|---|
| `name.en` | Primary text | 10 |
| `sku` | Exact/prefix match — makers search by part number | 8 |
| `brand.name.en` | Text | 4 |
| `shortDescription.en` | Text | 3 |
| `description.en` | Text | 1 |
| `specs.value` | **Facet filter**, not free text | — |
| `category.path` | Subtree filter | — |

`PRODUCT.md` states *"Search is the primary shopping path"*, which makes SKU matching first-class: a maker who knows the part number must find it immediately.

---

## 11. Inventory & review relationships

| Relationship | Decision |
|---|---|
| **Inventory** | `stock` lives **inside** the product document (single-document atomic updates, no join for the availability badge on every card), but is **writable only by InventoryModule**. Movement history lives in a separate `inventoryEvents` collection. See [`INVENTORY-MODEL.md`](./INVENTORY-MODEL.md). |
| **Reviews** | Separate collection (unbounded per product). The product carries only the **aggregate** `rating`, maintained by ReviewsModule. This fixes the legacy defect where 6 UI mappers read `avg_rating`/`review_count` columns **that never existed**, so ratings rendered 0 forever. |
| **Availability** | `available = stock.onHand`. No `reserved` term — reservations are removed (see [`INVENTORY-MODEL.md`](./INVENTORY-MODEL.md) §2). |

---

## 12. Order snapshot contract

**Which product data is copied into an order line, and why.** An order is a point-in-time commercial record; it must render completely and correctly even if the product is later renamed, repriced, delisted or deleted.

| Copied into `order.items[]` | Reason |
|---|---|
| `productId` | Traceability, reorder, sales analytics |
| `sku` | The warehouse/support identifier |
| `name` (resolved string, not the localized object) | Renaming must not rewrite order history |
| `slug` | Enables a "buy again" link; the redirect table covers later renames |
| `unitPrice` (minor units) | **The agreed price.** Immutable. |
| `quantity` | |
| `lineTotal` | Stored, not derived — a future rounding-rule change must not alter history |
| `imagePublicId` (primary image only) | Order confirmation and history render without a catalogue join |
| `brandName` (resolved string, nullable) | Same |

**Deliberately NOT copied:** `description`, `specs`, `rating`, `stock`, `costPrice`, the full `images[]` array, `category`. These are either large, irrelevant to a receipt, or commercially sensitive. If an order view needs richer detail it may resolve the live product **as supplementary information**, clearly separated from the immutable snapshot.

> This is the strongest embedding case in the system and is **PRESERVED** from legacy, which already snapshotted `name`/`sku`/`price` into `order_items`. It was one of the few things the legacy design got right.

---

## 13. Summary of decisions

| # | Decision | Fixes / removes |
|---|---|---|
| 1 | **No variants** | Removes 2 legacy bugs and a dead table |
| 2 | ObjectId `_id`; `sku` and `slug` unique | — |
| 3 | **Slug redirects are read** → 301 | Legacy wrote them and never read them |
| 4 | Localized `{en, ar?}`, `en` only in MVP | Avoids a future rewrite; drops 100%-NULL columns |
| 5 | Category/brand **reference + snapshot** | Fixes brand-less, image-less listings |
| 6 | Category **materialised `path[]`** | Fixes parent pages omitting child products |
| 7 | **EAV → embedded `specs[]`** | Makes faceting possible for the first time |
| 8 | Images embedded, `publicId` not URL, dimensions captured | Fixes brittle deletes and layout shift |
| 9 | **Soft delete**, re-validated at checkout | Fixes purchasable hidden products |
| 10 | `stock` in the document, **writable only by Inventory** | Preserves the ledger invariant |
| 11 | `rating` aggregate maintained by Reviews | Fixes ratings permanently rendering 0 |
| 12 | Explicit **order snapshot contract** | Preserves the one thing legacy got right |
| 13 | Money as **integer minor units** | Removes float error from the price path |
