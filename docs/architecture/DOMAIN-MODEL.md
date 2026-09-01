# Domain Model — Phase 1 Architecture Freeze

**Status:** FROZEN pending review · **Date:** 2026-08-30
**Inputs:** Phase 0 repository audit · Phase 0.5 live forensic extraction · `PRODUCT.md` · `.project_plan/`

---

## 1. Method

Domains are derived from **business responsibility**, not from the 28 legacy tables. Three rules were applied:

1. **A domain owns a decision, not a table.** `order_items`, `order_status_history` and `addresses` are not domains — they are data owned by Orders and Users.
2. **A domain must have a real actor and a real requirement.** Legacy tables with zero rows, zero code paths and no roadmap entry do not become domains (see §4).
3. **Cross-cutting concerns are capabilities, not domains.** Media, Audit and Notifications serve other domains; they are modelled as supporting domains with narrow contracts.

This produces **11 core domains** and **3 supporting domains**.

---

## 2. Domain map

```
                          ┌───────────────────────────┐
                          │   IDENTITY & ACCESS       │
                          │   (auth, roles, sessions) │
                          └──────────┬────────────────┘
                                     │ authenticates
                                     ▼
                          ┌───────────────────────────┐
                          │        USERS              │
                          │  profile · addresses      │
                          └─────┬──────────────┬──────┘
                                │ owns         │ writes
                ┌───────────────┘              └──────────────┐
                ▼                                             ▼
        ┌───────────────┐                             ┌───────────────┐
        │     CART      │                             │    REVIEWS    │
        │ (pre-order)   │                             │ (moderated)   │
        └───────┬───────┘                             └───────┬───────┘
                │ converts to                                 │ rates
                ▼                                             │
        ┌───────────────────────────────┐                     │
        │           ORDERS              │                     │
        │  items[] · statusHistory[]    │                     │
        │  shipment · pricing snapshot  │                     │
        └───┬─────────┬─────────┬───────┘                     │
            │ reads   │ consumes│ applies                     │
            │         │         │                             │
            ▼         ▼         ▼                             │
    ┌───────────┐ ┌─────────┐ ┌──────────┐                    │
    │  CATALOG  │ │INVENTORY│ │ PRICING  │                    │
    │ products  │◄┤ stock + │ │ &        │                    │
    │ categories│ │ ledger  │ │DISCOUNTS │                    │
    │ brands    │ └─────────┘ └──────────┘                    │
    └─────┬─────┘                                             │
          │ rated by ──────────────────────────────────────────┘
          │ illustrated by
          ▼
    ┌───────────┐        ┌───────────┐        ┌───────────────┐
    │   MEDIA   │        │  CONTENT  │        │  FULFILMENT   │
    │(Cloudinary)│       │  (blog)   │        │ shipping cost │
    └───────────┘        └───────────┘        └───────────────┘

  SUPPORTING (cross-cutting, no independent actor):
    ┌───────────┐   ┌────────────────┐   ┌───────────────┐
    │   AUDIT   │   │ NOTIFICATIONS  │   │   SEARCH      │
    │ admin log │   │ transactional  │   │ read model    │
    └───────────┘   └────────────────┘   └───────────────┘
```

### Dependency direction (no cycles)

```
Identity ──▶ Users ──▶ Cart ──▶ Orders ──▶ Inventory
                 │                │            │
                 │                ├──▶ Pricing&Discounts
                 │                └──▶ Fulfilment
                 └──▶ Reviews ──▶ Catalog ◀── Media
                                    ▲
                                  Search (read-only projection)

Audit ◀── (all admin-mutating domains, one-way)
Notifications ◀── (Orders, Identity, one-way)
```

**Rule:** arrows point *toward* the dependency. Catalog never imports Orders. Inventory never imports Orders — Orders calls Inventory. Audit and Notifications are only ever *called*, never callers. This is what keeps the NestJS module graph acyclic (see [`NESTJS-MODULE-MAP.md`](./NESTJS-MODULE-MAP.md)).

---

## 3. Domain specifications

### D1 — Identity & Access

| | |
|---|---|
| **Purpose** | Establish *who* is making a request and *what role* they hold. Owns credentials and tokens — nothing else. |
| **Primary actors** | Guest (unauthenticated), Customer, Admin, Super Admin |
| **Responsibilities** | Registration · login · logout · token issue/refresh/revoke · password hashing · password reset · email verification · role assignment (super-admin only) |
| **Owned data** | `users.email`, `users.passwordHash`, `users.emailVerifiedAt`, `users.role`, `refreshTokens` |
| **Business rules** | BR-AUTH-* (see [`BUSINESS-RULES.md`](./BUSINESS-RULES.md)) |
| **Relationships** | Provides the authenticated principal to **every** other domain. Depends on nothing. |
| **External dependencies** | Email provider (verification + reset) |
| **Module candidate** | `AuthModule` |

> **Deliberate split from Users.** Identity owns the credential; Users owns the person. This keeps `passwordHash` inside a single module that no other module may import, which is the structural guarantee that it never leaks into a DTO.

### D2 — Users

| | |
|---|---|
| **Purpose** | The customer as a person: contact details and shipping addresses. |
| **Primary actors** | Customer (own record), Admin (read-only list) |
| **Responsibilities** | Profile read/update · address book CRUD · default-address invariant · admin customer listing |
| **Owned data** | `users` document minus credentials: `fullName`, `phone`, `addresses[]`, `stats` |
| **Business rules** | Exactly one default address · phone must match the Egyptian format · email is immutable via profile · `role` is never settable by the owner |
| **Relationships** | Referenced by Orders (snapshot), Reviews (author), Cart (owner) |
| **External dependencies** | None |
| **Module candidate** | `UsersModule` |

### D3 — Catalog

| | |
|---|---|
| **Purpose** | What is for sale and how it is organised. The system's largest read surface. |
| **Primary actors** | Guest/Customer (read), Admin (write) |
| **Responsibilities** | Product lifecycle · category tree · brands · slug identity and redirects · rating aggregate maintenance (written by Reviews) · publication state |
| **Owned data** | `products`, `categories`, `brands`, `slugRedirects` |
| **Business rules** | BR-CAT-* · public reads always filter `isActive && !deletedAt` · slug uniqueness · a rename emits a redirect |
| **Relationships** | **Referenced by** Orders (snapshot at purchase), Cart (snapshot), Reviews, Inventory (owns the stock field), Search (projects from it), Media (illustrates it) |
| **External dependencies** | Cloudinary (via Media) |
| **Module candidate** | `CatalogModule` (products, categories, brands) |

> Categories and Brands are **not** separate domains. They have no independent lifecycle, no actor of their own, and exist solely to organise products. They are aggregates inside Catalog.

### D4 — Inventory

| | |
|---|---|
| **Purpose** | The single authority on how many units exist, and the immutable record of why that number changed. |
| **Primary actors** | Admin (manual adjustment), Orders (automatic consumption), System |
| **Responsibilities** | Own `product.stock.onHand` · apply every delta · write an immutable ledger entry for **every** mutation · enforce the no-oversell invariant · low-stock reporting |
| **Owned data** | `products.stock` sub-document (write authority), `inventoryEvents` collection |
| **Business rules** | BR-INV-* · stock never negative · every mutation is ledgered with a reason and an actor · `Σ ledger = onHand` |
| **Relationships** | **Called by** Orders (consume/restore). **Never calls** Orders. Owns a field inside a Catalog document — the one deliberate exception to strict aggregate ownership, documented in ADR-INVENTORY-002. |
| **External dependencies** | None |
| **Module candidate** | `InventoryModule` |

> Inventory is a domain, not a Catalog attribute, because it has its own actor (admin adjustments), its own audit requirement, and its own consistency rules that Catalog CRUD must not be able to bypass.

### D5 — Cart

| | |
|---|---|
| **Purpose** | A **draft intent to purchase**. Explicitly *not* a source of price or stock truth. |
| **Primary actors** | Guest, Customer |
| **Responsibilities** | Hold line items · re-price against live catalog on every read · flag unavailable lines · merge a guest cart on login · expire |
| **Owned data** | `carts` collection (items embedded with display snapshots) |
| **Business rules** | BR-CART-* · quantity 1–99 · prices always re-derived server-side · a snapshot is for display only and is never trusted at checkout |
| **Relationships** | Reads Catalog and Inventory. Converted by Orders. |
| **External dependencies** | None |
| **Module candidate** | `CartModule` |

### D6 — Orders

| | |
|---|---|
| **Purpose** | The transactional core. Converts intent into an immutable commercial record and owns its lifecycle. |
| **Primary actors** | Customer (place, view, cancel-while-pending), Admin (confirm, ship, deliver, cancel), Guest (track only) |
| **Responsibilities** | Checkout quote · order placement (transactional) · **all** state transitions · shipment/tracking data · status history · customer and admin views · secure order tracking |
| **Owned data** | `orders` collection — items, pricing, statusHistory, shipment, address snapshots |
| **Business rules** | BR-ORDER-* — the largest rule set in the system |
| **Relationships** | Consumes Cart · reads Catalog · **calls** Inventory · **calls** Pricing & Discounts · **calls** Fulfilment · emits to Audit and Notifications |
| **External dependencies** | None (COD — no payment provider in MVP) |
| **Module candidate** | `OrdersModule` |

### D7 — Pricing & Discounts

| | |
|---|---|
| **Purpose** | Compute money. The only place in the system permitted to decide what a customer pays. |
| **Primary actors** | System (invoked by Cart and Orders), Admin (coupon management) |
| **Responsibilities** | Effective unit price · line totals · coupon validation and redemption · discount cap logic · the canonical total formula · rounding |
| **Owned data** | `coupons`, `couponRedemptions` |
| **Business rules** | BR-PRICE-*, BR-COUPON-* |
| **Relationships** | Called by Cart (quote) and Orders (authoritative calculation). Depends on Catalog for prices. |
| **External dependencies** | None |
| **Module candidate** | `PricingModule` (contains coupon logic) |

> **Elevated to a first-class domain deliberately.** In the legacy system pricing was scattered across the database function, four frontend components and a dead service — the single largest source of the duplication Phase 0 catalogued. Making it one domain with one entry point is the structural fix.

### D8 — Fulfilment

| | |
|---|---|
| **Purpose** | Decide the shipping cost and describe the delivery. |
| **Primary actors** | System (quote), Admin (dispatch) |
| **Responsibilities** | Shipping-cost policy by governorate · free-shipping threshold · shipment record (carrier, tracking number, dispatch date) · delivery-attempt outcomes |
| **Owned data** | `shippingRates` (small config collection), `orders.shipment` (written on behalf of Orders) |
| **Business rules** | BR-SHIP-* |
| **Relationships** | Called by Orders and by the checkout quote |
| **External dependencies** | None in MVP (no carrier API) |
| **Module candidate** | `FulfilmentModule` — small, but separated because shipping policy will change independently of order logic |

### D9 — Reviews

| | |
|---|---|
| **Purpose** | Customer feedback on purchased products, and the rating aggregate the catalogue displays. |
| **Primary actors** | Customer (submit/edit own), Admin (moderate), Guest (read approved) |
| **Responsibilities** | Submission · verified-purchase determination · moderation queue · **maintaining `product.rating`** · helpfulness votes |
| **Owned data** | `reviews` |
| **Business rules** | BR-REVIEW-* · one review per customer per product · default `PENDING` · only `APPROVED` is public · aggregate recomputed on every status change |
| **Relationships** | Writes the `rating` aggregate into Catalog documents · reads Orders to establish verified purchase |
| **External dependencies** | Cloudinary (review images — deferred) |
| **Module candidate** | `ReviewsModule` |

### D10 — Content

| | |
|---|---|
| **Purpose** | Editorial content — the blog. |
| **Primary actors** | Guest (read), Admin (author) |
| **Responsibilities** | Post CRUD · publication state · slug identity |
| **Owned data** | `blogPosts` |
| **Business rules** | Published + `publishedAt <= now` is public · slug unique |
| **Relationships** | Standalone. Uses Media. |
| **External dependencies** | Cloudinary |
| **Module candidate** | `ContentModule` |

### D11 — Media

| | |
|---|---|
| **Purpose** | Own every binary asset and its metadata. |
| **Primary actors** | Admin (product/blog images), Customer (review images — deferred) |
| **Responsibilities** | Validation (MIME, magic bytes, size, dimensions) · upload to Cloudinary · metadata persistence · deletion with reference counting · transformation presets |
| **Owned data** | Asset descriptors embedded in the owning document (`{publicId, version, width, height, …}`) |
| **Business rules** | BR-MEDIA-* · the browser never supplies asset metadata · SVG rejected |
| **Relationships** | Called by Catalog, Content, Reviews, Users |
| **External dependencies** | **Cloudinary** |
| **Module candidate** | `MediaModule` |

### Supporting domains

| # | Domain | Purpose | Owned data | Module |
|---|---|---|---|---|
| S1 | **Audit** | Immutable record of privileged actions, written by the system and never by the acting principal | `auditLogs` | `AuditModule` |
| S2 | **Notifications** | Transactional email (order confirmation, status change, verification, password reset) | `notificationLog` (delivery attempts only) | `NotificationsModule` |
| S3 | **Search** | A read-only query model over Catalog: filtering, faceting, sorting, pagination | none — projects from `products` | `SearchModule` |

> **Search owns no data.** It is a read model, separated from Catalog because its query surface, indexing strategy and evolution path (`$text` today, Atlas Search later) differ entirely from catalogue CRUD. See [`SEARCH-MODEL.md`](./SEARCH-MODEL.md).

---

## 4. Rejected domain candidates

Each was a legacy table or a plausible e-commerce concept. Each is excluded with a reason.

| Candidate | Legacy evidence | Decision | Reason |
|---|---|---|---|
| **Product Variants** | `product_variants` table, referenced by a `create_order_v2` branch. **0 rows.** | **REMOVE** | Never in any roadmap document. Components (an ESP32, an HC-SR04) do not have size/colour variants — differing parts are distinct SKUs. The legacy variant pricing path also ignored `sale_price`. Adding variants would be pure speculative complexity. Revisit only if a real variant product appears. |
| **Wishlist** | `wishlists` table (0 rows) + localStorage store + 2 uncalled server actions | **DEFER** | A real but non-core feature, currently two disconnected half-implementations. Keep client-side for MVP; promote to a domain only when cross-device sync is actually requested. |
| **Notifications (in-app)** | `notifications` table (0 rows), `AdminHeader` mock data | **REMOVE (in-app) / KEEP (email)** | No requirement for an in-app inbox. Transactional email *is* required by the order lifecycle. |
| **Recently viewed** | `recently_viewed` table (0 rows), world-writable RLS policy | **REMOVE** | No feature, no requirement, and its legacy policy was a security defect. |
| **Product comparison** | `ROUTES.compare` exists; no route | **REMOVE from MVP** | Listed as "Not started" in the roadmap. Not a domain until specified. |
| **Product compatibility** | `product_compatibility` table (0 rows); "compatibility list" in remaining work | **DEFER** | Genuinely interesting for a components store, but unspecified. If built, it is a Catalog feature, not a domain. |
| **Product tags** | `product_tags` (0 rows) | **REMOVE** | Superseded by categories + search. |
| **Payments** | `payment_provider_id` column, Paymob "not started" | **REMOVE from MVP** | COD only. Creating a Payments domain now would model a provider that does not exist. The order model reserves a place for it (ADR-ORDER-004). |
| **EAV Attributes** | `attributes` (9 rows), `attribute_values` (0), `product_attribute_values` (0) | **REDESIGN into Catalog** | Technical specs matter for components ("3.3V", "16MHz"), but a 3-table EAV system with zero assigned values is not the way. Becomes a flat embedded `specs[]` array on the product. Not a domain. |
| **Admin** | — | **REJECTED as a domain** | Admin is a *role*, not a domain. Every admin operation is a privileged variant of a domain operation. A monolithic `AdminModule` would duplicate every service. Admin controllers live inside each domain behind `@Roles()`. |

---

## 5. Domain ↔ legacy table traceability

Confirms nothing was lost. Row counts from Phase 0.5.

| Legacy table | Rows | Destination domain | Disposition |
|---|---|---|---|
| `auth.users` + `profiles` | 4 + 4 | Identity + Users | Merged into `users` |
| `addresses` | 1 | Users | Embedded |
| `products` | 85 | Catalog | Core |
| `product_images` | 22 | Catalog + Media | Embedded |
| `product_attribute_values`, `attributes`, `attribute_values` | 0, 9, 0 | Catalog | Flattened to `specs[]` |
| `categories` | 27 | Catalog | + materialised `path[]` |
| `brands` | 17 | Catalog | Core |
| `slug_redirects` | 0 | Catalog | Kept — must now be **read** |
| `carts` + `cart_items` | 2 + 4 | Cart | Rebuilt; rows not migrated |
| `orders` | 10 | Orders | Core |
| `order_items` | 7 | Orders | Embedded |
| `order_status_history` | 8 | Orders | Embedded |
| `inventory_transactions` | 7 | Inventory | → `inventoryEvents` |
| `coupons` | 0 | Pricing & Discounts | Redesigned |
| `reviews` | 0 | Reviews | Redesigned |
| `review_images`, `review_votes` | 0, 0 | Reviews | Embedded |
| `blog_posts` | 6 | Content | Core |
| `admin_audit_logs` | 0 | Audit | Rebuilt |
| `wishlists` | 0 | — | Deferred (client-side) |
| `product_variants`, `product_tags`, `product_compatibility`, `notifications`, `recently_viewed` | 0 each | — | **Removed** |

**28 legacy tables → 11 core + 3 supporting domains → 12 MongoDB collections** (see [`MONGODB-DESIGN.md`](./MONGODB-DESIGN.md)).

---

## 6. Boundary rules (enforced in Phase 2)

1. **One writer per field.** `product.stock` is written **only** by Inventory. `product.rating` is written **only** by Reviews. Catalog CRUD must not touch either.
2. **Money is computed in exactly one place.** Only Pricing & Discounts may compute a payable amount. Cart and Orders *call* it; they never re-implement it.
3. **State transitions belong to the owning domain.** Only Orders may change an order's status — never a controller, never a DTO, never the client.
4. **Audit and Notifications are sinks.** They may be called by anyone and may call no one. This prevents the cycle that a naive `AdminModule` would create.
5. **Search is read-only.** It never writes to `products`.
6. **Identity is a leaf.** It depends on nothing, so credentials cannot leak upward through a dependency.

---

## 7. Open questions carried to the decision register

| # | Question | Blocking |
|---|---|---|
| Q1 | Shipping rate table per governorate — actual EGP values | Fulfilment (mechanism specified, rates are business input) |
| Q2 | VAT rate and whether invoices must show a VAT breakdown | Pricing (decision: prices are VAT-inclusive; component display is open) |
| Q3 | Is the blog actually launching, or is Content deferred? | Content scope only |
| Q4 | Transactional email provider | Notifications |

None of these blocks the freeze. All are recorded in [`PHASE-1-DECISIONS.md`](./PHASE-1-DECISIONS.md).
