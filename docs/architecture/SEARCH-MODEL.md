# Search & Discovery Model — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADR:** ADR-SEARCH-001, 002

---

## 1. Why this matters more than usual

`PRODUCT.md` states the primary design principle plainly:

> **"Search is the primary shopping path."**

Search is not a secondary feature in this application — it is the main way a maker who knows they need an `HC-SR04` finds it. The legacy implementation failed at almost every level, so this is a **REDESIGN**.

---

## 2. Legacy failures (all verified in Phase 0.5)

| # | Failure | Root cause |
|---|---|---|
| 1 | **No sort parameter exists** — the UI advertises 5 sort options, none can work | `search_products` hardcodes `ORDER BY rank DESC, is_featured DESC, created_at DESC` |
| 2 | **Total count is wrong** | The RPC returns no total; the app applied PostgREST `count:'exact'` to an already-paginated result |
| 3 | **Category pages omit child products** | `c.slug = category_slug` — exact match only, on a tree with 10 child categories |
| 4 | **Listings have no images, brand, or rating** | The RPC returns 12 scalar columns; no join |
| 5 | **The full-text index is never used** | `idx_products_search` (GIN): **0 scans**, while `products` shows 1,282 sequential scans |
| 6 | Attribute faceting never built | Required a 3-table EAV join the RPC could not perform |
| 7 | Price-range filter bounds computed from the current page only | Client-side derivation |
| 8 | `/products` and `/search` duplicate the same logic | Two pages, one query |
| 9 | `findBestSelling` sorts by a non-existent `avg_rating` column | — |

**Failure 5 deserves emphasis** because it is instructive. The GIN index was defined *correctly* — matching expression, matching partial predicate. But the query ORs the `tsvector` match with two `ILIKE '%term%'` branches, and a disjunction is only index-accessible if **every** branch is. Two leading-wildcard `ILIKE`s with no trigram index forced a sequential scan every time. The project paid the write cost of an index it could never read.

---

## 3. Technology decision

> ### **DECISION (ADR-SEARCH-001): MongoDB `$text` index + `$facet` aggregation. Not Atlas Search. Not Elasticsearch.**

| Option | Verdict | Reasoning |
|---|---|---|
| **A. Regex / `$regex`** | ❌ Rejected | Leading-wildcard regex cannot use an index — exactly the legacy failure, reproduced |
| **B. MongoDB `$text` index** | ✅ **CHOSEN** | Native, no extra service, weighted fields, stemming, relevance scoring, works on any deployment including the local dev replica set. Handles 85 products trivially and scales to the tens of thousands this catalogue will plausibly reach. |
| **C. Atlas Search (Lucene)** | ⏸ **Deferred** | Materially better — fuzzy matching, autocomplete, synonyms, faceting. But it **binds the project to Atlas**, cannot run locally in CI without a cloud dependency, and is unjustified at 85 products. |
| **D. Elasticsearch / OpenSearch** | ❌ Rejected | An entire additional service, cluster and sync pipeline for a catalogue two orders of magnitude too small. Explicitly warned against in the brief. |

**Revisit conditions for Atlas Search (ADR-SEARCH-001):**
1. Catalogue exceeds ~20,000 products, **or**
2. Typo tolerance / fuzzy matching becomes a stated requirement (plausible: `"ardiuno"` → `"Arduino"`), **or**
3. Search-as-you-type autocomplete is required, **or**
4. Arabic search launches — Arabic needs an analyzer with stemming and diacritic folding that `$text` handles poorly.

The search interface is deliberately isolated behind `SearchService` so the engine can be swapped without touching controllers or DTOs.

### Text index definition

```js
db.products.createIndex(
  { "name.en": "text", "sku": "text", "brand.name.en": "text",
    "shortDescription.en": "text", "description.en": "text" },
  { weights: { "name.en": 10, "sku": 8, "brand.name.en": 4,
               "shortDescription.en": 3, "description.en": 1 },
    name: "product_text_search", default_language: "english" }
)
```

**`sku` is weighted 8 — nearly as high as the product name.** For a components store, part numbers *are* search terms. A maker typing `ESP32-WROOM-32` must get an exact hit first. This is a domain-specific decision that a generic e-commerce weighting would get wrong.

MongoDB permits **one** text index per collection, so all text fields must live in this single index. `specs.value` is deliberately excluded — specs are **facet filters**, not free-text (searching "3.3" should not return every 3.3 V component).

---

## 4. The search contract

```
GET /api/v1/products
    ?q=esp32                     # free text
    &category=microcontrollers   # slug — INCLUDES DESCENDANTS
    &brand=espressif             # slug, repeatable
    &minPrice=10000&maxPrice=50000   # minor units, effective price
    &inStock=true
    &spec=operating-voltage:3.3   # repeatable facet filter
    &sort=relevance
    &page=1&limit=24
```

| Parameter | Rules |
|---|---|
| `q` | 0–100 chars. Empty/absent = browse mode (no text filter). |
| `category` | Slug. **Matches the entire subtree** via `category.path`. |
| `brand` | Slug; repeatable → OR within brands, AND across facet types |
| `minPrice`/`maxPrice` | Integer minor units, applied to the **effective** price (`salePrice ?? basePrice`) — consistent with checkout |
| `inStock` | `true` → `stock.onHand > 0` |
| `spec` | `key:value`, repeatable. AND across different keys, OR within one key. |
| `sort` | See §5 |
| `page` | ≥ 1, default 1 |
| `limit` | 1–100, default 24 |

**Always applied, never optional:** `{ isActive: true, deletedAt: null }`. Enforced in the repository, not per-query — legacy relied on each caller remembering.

### Response

```jsonc
{
  "data": [ { "id","slug","sku","name","shortDescription",
              "brand": {"slug","name"},
              "category": {"slug","name"},
              "pricing": { "basePrice","salePrice","effectivePrice",
                           "discountPercentBps","currency" },
              "primaryImage": { "publicId","version","width","height","alt" },
              "rating": { "average": 4.3, "count": 12 },
              "availability": "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK",
              "isFeatured": true } ],
  "meta": { "page": 1, "limit": 24, "total": 137, "totalPages": 6,
            "hasNext": true, "hasPrev": false },
  "facets": {
    "categories": [ { "slug","name","count": 42 } ],
    "brands":     [ { "slug","name","count": 17 } ],
    "priceRange": { "min": 5000, "max": 450000 },
    "specs": [ { "key":"operating-voltage","label":"Operating Voltage",
                 "values":[ {"value":"3.3","count":31} ] } ]
  }
}
```

**Every one of failures 1–4 and 7 is closed by this shape:** the primary image, brand, category and rating are present (4), `total` is the true match count (2), facet bounds are computed server-side over the whole result set, not the current page (7).

---

## 5. Sorting

| `sort` value | Order | Notes |
|---|---|---|
| `relevance` *(default with `q`)* | `textScore` desc, then `isFeatured` desc, `createdAt` desc | Only valid with `q` |
| `newest` *(default without `q`)* | `createdAt` desc | |
| `price_asc` / `price_desc` | effective price asc/desc | Requires the computed field — §6 |
| `rating` | `rating.average` desc, `rating.count` desc | Count as a tiebreak so a single 5-star review does not outrank a well-reviewed product |
| `name_asc` | `name.en` asc, collation `en` strength 2 | Case/diacritic-insensitive |

Requesting `relevance` without `q` falls back to `newest` rather than erroring.

**This is failure 1 fixed.** The legacy UI (`products/page.tsx:40-47`) already offered exactly these five options; the backend simply had no parameter to receive them.

---

## 6. Sorting and filtering by effective price

`effectivePrice = salePrice ?? basePrice` is not a stored field, but it must be sortable and range-filterable.

> **DECISION (ADR-SEARCH-002): store a maintained `pricing.effectivePrice` field.**

```jsonc
"pricing": { "basePrice": 32500, "salePrice": 28000, "effectivePrice": 28000 }
```

Written by `CatalogService` on every price change — a single writer, alongside the existing snapshot-maintenance responsibility. Rejected alternatives: `$expr` with `$ifNull` (cannot use an index, forcing a collection scan on the hottest query), and an aggregation `$addFields` stage before `$match` (same problem).

Redundancy is accepted in exchange for an indexable, sortable price. The invariant `effectivePrice === (salePrice ?? basePrice)` is asserted in tests.

---

## 7. Query pipeline

```
$match   { isActive: true, deletedAt: null }
         + $text (if q)  + category.path  + brand.id  + effectivePrice range
         + stock.onHand  + specs (elemMatch per key)
   ↓
$facet
   ├── results:  [ $sort, $skip, $limit, $project ]
   ├── total:    [ $count ]
   ├── brands:   [ $group by brand, $count ]
   ├── categories:[ $group by category, $count ]
   ├── priceBounds: [ $group min/max effectivePrice ]
   └── specs:    [ $unwind specs (filterable only), $group, $count ]
```

**One round trip** returns results, total and all facets. Legacy issued a paginated RPC and then a separate broken count.

**Facet-count caveat:** facets are computed over the *filtered* set, so counts reflect currently-applied filters. Recomputing each facet against the set excluding its own filter is the more sophisticated behaviour; it is deliberately **not** built for MVP (it multiplies query cost by the number of facet types). Documented so the behaviour is understood rather than surprising.

---

## 8. Category subtree matching

The single most user-visible legacy bug: with a 27-category tree (17 roots, 10 children, depth 2), viewing a parent category showed **only** products assigned directly to that parent.

```
1. Resolve the slug -> category document
2. Match products where  category.id == C._id  OR  C._id ∈ category.path
```

Products carry `category.path` (their category's ancestor chain), so the filter is a single indexed `$in`. No `$graphLookup`, no recursion at query time. See [`CATALOG-MODEL.md`](./CATALOG-MODEL.md) §6.

---

## 9. Indexes

| Index | Purpose |
|---|---|
| `product_text_search` (weighted text) | `q` |
| `{ isActive:1, deletedAt:1, 'category.path':1, 'pricing.effectivePrice':1 }` | Category browse + price sort — the most common path |
| `{ isActive:1, deletedAt:1, 'brand.id':1 }` | Brand pages |
| `{ isActive:1, isFeatured:1 }` | Homepage — legacy's hottest product index (621 scans) |
| `{ isActive:1, createdAt:-1 }` | `newest` |
| `{ isActive:1, 'rating.average':-1 }` | `rating` |
| `{ isActive:1, 'pricing.effectivePrice':1 }` | Global price sort |
| `{ 'specs.key':1, 'specs.value':1 }` (multikey) | Facet filtering |
| `{ slug:1 }` unique · `{ sku:1 }` unique | Direct lookup |

**Deliberately not created:** an index on `stock.onHand` (low selectivity — most products are in stock; it is a post-filter, not a driver).

---

## 10. Endpoint consolidation

Legacy had `/products` and `/search` as separate pages running the same query with duplicated URL→filter mapping.

> **One endpoint: `GET /api/v1/products`.** Search is a *parameter* (`q`), not a different resource.

Category and brand pages are the same endpoint with `category=` / `brand=` pre-applied. `/search?q=…` in the web app is a routing concern, not an API concern.

**Supporting endpoints:**

| Endpoint | Purpose |
|---|---|
| `GET /products/suggest?q=` | Lightweight autocomplete — up to 8 `{slug, name, sku, primaryImage}`. Prefix match on `name.en` and `sku`. |
| `GET /products/:slug` | Detail; resolves `slugRedirects` → **301** |
| `GET /products/:slug/related` | Same category, excluding self, ordered by `salesCount` |
| `GET /categories/tree` | Full tree, cacheable |

`GET /products/suggest` directly serves the *"search is dominant"* requirement in `PRODUCT.md`.

---

## 11. Caching

| Resource | Strategy |
|---|---|
| Category tree | In-process TTL cache, 15 min, invalidated on write. Legacy queried this on **every page render** (1,664 sequential scans) because the root layout rendered an async `<Navbar/>`. |
| Brand list | Same, 15 min |
| Search results | **Not cached** in MVP — too many parameter combinations, and stock/price must be current |
| Product detail | HTTP `Cache-Control: public, max-age=60` |

In-process caching is sufficient for a single instance. Multi-instance deployment is a Redis trigger — see [`REDIS-DECISION.md`](./REDIS-DECISION.md).

---

## 12. Deliberately not built

| Excluded | Reason |
|---|---|
| Fuzzy / typo tolerance | `$text` cannot; an Atlas Search trigger |
| Synonyms (`uC` → microcontroller) | Requires a curated dictionary; revisit with real query logs |
| Personalised ranking | No behavioural data, no requirement |
| Search analytics / zero-result tracking | 🔶 Recommended for Phase 3 — it is the evidence needed to justify Atlas Search |
| Arabic search | No Arabic content exists (100% NULL) |
| Numeric range filtering on specs | Spec values are strings; add `numericValue` if needed |
| Cross-field faceting exclusion | §7 |

---

## 13. Summary of decisions

| # | Decision | Fixes |
|---|---|---|
| 1 | **MongoDB `$text` + `$facet`**; Atlas Search deferred with explicit triggers | Avoids a premature service dependency |
| 2 | `sku` weighted 8 of 10 | Part numbers are primary search terms for makers |
| 3 | **Real `sort` parameter**, 5 options | The UI advertised 5; none worked |
| 4 | `$facet` returns the **true total** in one round trip | Totals were wrong by construction |
| 5 | **Category subtree** via `category.path` | Parent pages omitted child products |
| 6 | Listings return image, brand, category, rating | Image-less, brand-less grids |
| 7 | Maintained `pricing.effectivePrice` | Makes price sort/filter indexable |
| 8 | Server-computed facets and price bounds | Bounds derived from the current page only |
| 9 | **One** `/products` endpoint | `/products` and `/search` duplicated |
| 10 | `isActive`/`deletedAt` enforced in the repository | Per-query responsibility |
| 11 | Category tree cached | Queried on every page render |
