# NestJS Module Architecture — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADR:** ADR-MODULE-001, 002

> **Design only. No module is implemented in Phase 1.**

---

## 1. Principles

1. **One module per domain** ([`DOMAIN-MODEL.md`](./DOMAIN-MODEL.md)) — modules mirror business boundaries, not database tables.
2. **No `AdminModule`.** Admin is a *role*, not a domain. Every admin operation is a privileged variant of a domain operation, so admin controllers live **inside** each domain module behind `@Roles()`. A monolithic admin module would duplicate every service and create a hub of circular dependencies.
3. **Acyclic dependency graph**, enforced by lint (`import/no-cycle`) and by the layering in §3.
4. **Sinks are never callers.** `AuditModule` and `NotificationsModule` may be called by anyone and call no domain module — the structural guarantee against cycles.
5. **One writer per field** — enforced by module boundaries, not convention.
6. **Shared code lives in `CommonModule`**, never in a domain module imported "just for a helper".

---

## 2. Module list

| # | Module | Owns | Global? |
|---|---|---|---|
| 0 | `CommonModule` | Cross-cutting infrastructure | ✅ `@Global()` |
| 1 | `AuthModule` | Credentials, tokens, guards | |
| 2 | `UsersModule` | `users` (profile, addresses) | |
| 3 | `CatalogModule` | `products`, `categories`, `brands`, `slugRedirects`, `specDefinitions` | |
| 4 | `SearchModule` | — (read model over `products`) | |
| 5 | `InventoryModule` | `products.stock`, `inventoryEvents` | |
| 6 | `PricingModule` | `coupons`, `couponRedemptions` | |
| 7 | `CartModule` | `carts` | |
| 8 | `OrdersModule` | `orders`, `orderCounters`, `idempotencyKeys` | |
| 9 | `FulfilmentModule` | `shippingRates`, `orders.shipment` | |
| 10 | `ReviewsModule` | `reviews`, `products.rating` | |
| 11 | `ContentModule` | `blogPosts` | |
| 12 | `MediaModule` | `mediaAssets`, Cloudinary | |
| 13 | `AuditModule` | `auditLogs` | sink |
| 14 | `NotificationsModule` | Email dispatch | sink |
| 15 | `HealthModule` | — | |

**15 modules.** Phase 0 proposed 15 as well; the composition differs — `PricingModule` and `FulfilmentModule` are promoted to first-class, `AttributesModule` is absorbed into Catalog, and `NotificationsModule` is confirmed (email is required by the order lifecycle, even though in-app notifications are removed).

---

## 3. Dependency graph

```
                        ┌──────────────────┐
                        │  CommonModule    │  @Global
                        │  config · logger │  imported implicitly by all
                        │  pipes · filters │
                        └──────────────────┘

  LAYER 4  (composition)
    ┌────────────┐
    │ OrdersModule│──────┬──────────┬───────────┬──────────┐
    └─────┬──────┘      │          │           │          │
          │             ▼          ▼           ▼          ▼
          │      ┌──────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐
          │      │ Cart     │ │Inventory│ │ Pricing │ │Fulfilment│
          │      └────┬─────┘ └────┬────┘ └────┬────┘ └──────────┘
  LAYER 3 │           │            │           │
          │           ▼            ▼           │
          │      ┌─────────────────────────────┴──┐
          └─────▶│        CatalogModule           │
                 └───────────────┬────────────────┘
  LAYER 2                        │
                 ┌───────────────▼────────────────┐
                 │  SearchModule  │  MediaModule  │
                 └────────────────┴───────────────┘
  LAYER 1
                 ┌──────────────┐   ┌──────────────┐
                 │ UsersModule  │◀──│  AuthModule  │
                 └──────────────┘   └──────────────┘

  SINKS (called by everyone, call nobody)
                 ┌──────────────┐   ┌───────────────────┐
                 │ AuditModule  │   │NotificationsModule│
                 └──────────────┘   └───────────────────┘

  INDEPENDENT
                 ┌──────────────┐   ┌──────────────┐
                 │ContentModule │   │ HealthModule │
                 └──────────────┘   └──────────────┘
```

**All arrows point downward or into a sink. There is no path back up. The graph is acyclic by construction.**

---

## 4. Module specifications

### 0. `CommonModule` — `@Global()`

| | |
|---|---|
| **Responsibilities** | Typed `ConfigModule` with startup validation · `nestjs-pino` logger with request-id · global `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` · `AllExceptionsFilter` · `TransformInterceptor` (response envelope) · `ThrottlerModule` · `MongooseModule.forRootAsync` · `@Public()`, `@Roles()`, `@CurrentUser()` decorators · pagination DTOs · the `Money` value object |
| **Public API** | Decorators, base DTOs, `Money`, `PaginationQuery` |
| **Depends on** | Nothing |
| **Replaces** | `lib/logger.ts` (duplicated in both apps), 10+ inconsistent response shapes, and `packages/config/src/env.ts` — which implemented fail-fast validation but **was never imported**, so it never ran |

### 1. `AuthModule`

| | |
|---|---|
| **Responsibilities** | Register · login · refresh (rotating) · logout / logout-all · email verification · password reset · password hashing · JWT issue/verify · `JwtAuthGuard` (global via `APP_GUARD`) · `RolesGuard` · `OwnershipGuard` |
| **Owned collections** | `refreshTokens`; the credential fields of `users` (`passwordHash`, `emailVerifiedAt`, `tokenVersion`) via a dedicated repository |
| **Public API** | `AuthController`; exports the three guards and `TokenService` |
| **Depends on** | `UsersModule` (profile creation), `NotificationsModule` (verification + reset email) |
| **Rules** | `passwordHash` never leaves this module — **no other module imports the credential repository**. Rate-limited. `role` never settable by a client. |
| **Replaces** | 6 browser `auth.*` call sites, both `proxy.ts` files, `requireAdmin()`, and the password reset that **threw a `TypeError` on submit** |

### 2. `UsersModule`

| | |
|---|---|
| **Responsibilities** | Profile read/update · embedded address CRUD · default-address invariant · admin customer list/detail · role management (SUPER_ADMIN only) · `stats` maintenance |
| **Owned collections** | `users` |
| **Controllers** | `UsersController` (`/users/me/*`), `AdminUsersController` (`/admin/customers`, `/admin/users/:id/role`) |
| **Depends on** | `MediaModule` (avatar — deferred) |
| **Rules** | Exactly one default address, in **one atomic update** · phone validated server-side · email immutable via profile · `role` absent from every self-service DTO |
| **Replaces** | `account/profile` and `account/addresses` (both browser→DB), `useAuth` profile fetch, `admin/customers` |

### 3. `CatalogModule`

| | |
|---|---|
| **Responsibilities** | Product CRUD, soft delete, duplication, publication toggle · category tree with materialised `path[]` · brands · slug uniqueness **and redirect emission + resolution** · spec definitions · `pricing.effectivePrice` maintenance · category/brand snapshot refresh |
| **Owned collections** | `products`, `categories`, `brands`, `slugRedirects`, `specDefinitions` |
| **Controllers** | `ProductsController`, `CategoriesController`, `BrandsController` (public) + `AdminProducts/Categories/BrandsController` |
| **Depends on** | `MediaModule` |
| **Rules** | Public reads always filter `isActive && !deletedAt` · the product DTO **rejects `stock`** (Inventory owns it) and **rejects `rating`** (Reviews owns it) · `costPrice` never in a public DTO · duplication copies asset **references with refcounting** |
| **Replaces** | `ProductService`, 3 Supabase providers, `product.actions.ts`, `category-brand.actions.ts`, `/api/attributes`, `/api/check-slug` |

> **Why `AttributesModule` was absorbed.** Phase 0 proposed a separate module. With EAV flattened into `products.specs[]`, "attributes" is a dictionary (`specDefinitions`) plus an embedded array — not an independent lifecycle. A separate module would be a table wrapper.

### 4. `SearchModule`

| | |
|---|---|
| **Responsibilities** | Faceted product search: text, category subtree, brand, price range, stock, spec facets, 5 sorts, correct totals, suggestions |
| **Owned collections** | **None** — a read model over `products` |
| **Depends on** | `CatalogModule` (read-only) |
| **Rules** | **Never writes.** Engine isolated behind `SearchService` so `$text` → Atlas Search is a swap, not a rewrite. |
| **Replaces** | `search_products` RPC, `SearchService`, `PostgresSearchProvider`; unifies `/products` and `/search` |

> **Why separate from Catalog.** Different query surface, different indexing strategy, and a different evolution path. Keeping it separate makes the eventual Atlas Search migration a single-module change.

### 5. `InventoryModule`

| | |
|---|---|
| **Responsibilities** | **Sole writer of `products.stock`** · append-only ledger · manual adjustments · restock · low-stock reporting · reconciliation |
| **Owned collections** | `inventoryEvents`; write authority over `products.stock` |
| **Public API** | `InventoryService.consume()`, `.restore()`, `.adjust()` — called by Orders |
| **Depends on** | `CatalogModule` (product existence only) |
| **Rules** | Every mutation writes a ledger event **in the same transaction** · `onHand` never negative · restoration idempotent via unique index · actor always from the JWT · **no reservations** |
| **Replaces** | `adjust_stock_v2`, `inventory.actions.ts`, and the `pg_cron` reservation job (35,309 no-op runs) |

### 6. `PricingModule`

| | |
|---|---|
| **Responsibilities** | **The only place that computes a payable amount.** Effective price · line totals · coupon validation and redemption · discount caps · the canonical total formula · rounding |
| **Owned collections** | `coupons`, `couponRedemptions` |
| **Public API** | `PricingService.priceCart()`, `.priceOrder()`, `.validateCoupon()`, `.redeemCoupon()`, `.releaseCoupon()` |
| **Depends on** | `CatalogModule` (prices), `FulfilmentModule` (shipping) |
| **Rules** | Discount clamped to `[0, itemsSubtotal]` · `grandTotal >= 0` · one coupon per order · usage limits enforced **in the update filter** |
| **Replaces** | Pricing logic scattered across `create_order_v2`, 4 frontend components and a dead `OrderService` |

> **Why first-class.** Phase 0 found the effective-price rule duplicated in 4 places, cart subtotal in 3, and a dead competing implementation. Money computed in one module is the structural fix.

### 7. `CartModule`

| | |
|---|---|
| **Responsibilities** | Server cart per user · add/update/remove/clear · **re-price on every read** · line status flags · guest-cart merge on login · TTL |
| **Owned collections** | `carts` |
| **Depends on** | `CatalogModule`, `InventoryModule` (availability), `PricingModule` (totals) |
| **Rules** | Snapshots are display-only · one merge strategy (`max`) · one `MAX_QUANTITY_PER_LINE` constant · never authoritative for price or stock |

### 8. `OrdersModule` — highest risk

| | |
|---|---|
| **Responsibilities** | Checkout quote · **transactional placement** · the state machine · shipment data · status history · customer/admin views · **secure order tracking** · `salesCount` maintenance |
| **Owned collections** | `orders`, `orderCounters`, `idempotencyKeys` |
| **Controllers** | `OrdersController` (customer), `AdminOrdersController`, `OrderTrackingController` (public, rate-limited) |
| **Depends on** | `CartModule`, `CatalogModule`, `InventoryModule`, `PricingModule`, `FulfilmentModule`, `UsersModule`, sinks |
| **Rules** | `userId` **always** from the JWT · items derived from the server cart · **server-owned transition matrix** enforced in a guarded atomic update · stock restored on cancel/return · carrier + tracking required to ship · orders are immutable and undeletable |
| **Replaces** | `create_order_v2`, `create_order_v1`, `update_order_status_v2`, `checkout.actions.ts`, `order.actions.ts`, `OrderService`, `orderTrackingStore`'s data layer |

**This module has the most dependencies (6) by design** — it is the composition root of the commerce flow. Crucially, **nothing depends on it**, so it introduces no cycle.

### 9. `FulfilmentModule`

| | |
|---|---|
| **Responsibilities** | Shipping-cost policy by governorate · free-shipping threshold · shipment record · delivery-attempt outcomes |
| **Owned collections** | `shippingRates`; writes `orders.shipment` on behalf of Orders |
| **Public API** | `FulfilmentService.quote(governorate, subtotal)` |
| **Depends on** | Nothing |
| **Rules** | Shipping fee **always server-computed** — legacy hardcoded `p_shipping_fee: 0` at the call site |

> **Why separate from Orders.** Shipping policy changes on a different cadence than order logic (rate changes, new carriers, promotional free shipping) and is a leaf dependency with no back-reference.

### 10. `ReviewsModule`

| | |
|---|---|
| **Responsibilities** | Submission · verified-purchase determination · moderation queue · **maintaining `products.rating`** · public listing |
| **Owned collections** | `reviews`; write authority over `products.rating` |
| **Depends on** | `CatalogModule`, `OrdersModule` (read-only, verified purchase) |
| **Rules** | One review per user per product · default `PENDING` · only `APPROVED` public · editable only while `PENDING` · aggregate recomputed on every status change |

> ⚠️ **The one dependency worth watching:** Reviews → Orders. It is read-only and Orders does not depend on Reviews, so no cycle exists. If it ever needs to become bidirectional, use a domain event rather than an import.

### 11. `ContentModule`

Blog CRUD, publication state, slug identity. Owns `blogPosts`. Depends on `MediaModule`. Fully independent — no domain module depends on it.

### 12. `MediaModule`

| | |
|---|---|
| **Responsibilities** | Validation (MIME allow-list, **magic bytes**, size, dimensions, EXIF strip) · Cloudinary upload/destroy · reference counting · transformation presets · URL derivation |
| **Owned collections** | `mediaAssets` |
| **Depends on** | Nothing (Cloudinary SDK only) |
| **Rules** | Server authors all metadata · SVG rejected · store `publicId`+`version`, never a URL · refcount-aware deletion |

### 13. `AuditModule` — sink

Writes `auditLogs` via an interceptor with **system privilege**, never as the acting principal. Read-only admin endpoint. **Depends on nothing.** Write failures are logged at `error` and alerted — never swallowed (legacy swallowed them, producing **0 audit rows**).

### 14. `NotificationsModule` — sink

Transactional email only: order lifecycle, email verification, password reset, admin new-order alert, low-stock alert. **In-app notifications are removed** (the `notifications` table had 0 rows and the UI rendered mock data). Depends on an email provider. Dispatch is **post-commit and failure-tolerant**.

### 15. `HealthModule`

`GET /health` (liveness) · `GET /health/ready` (Mongo + Cloudinary ping) via `@nestjs/terminus`.

---

## 5. Dependency risks

| # | Risk | Assessment | Mitigation |
|---|---|---|---|
| 1 | `OrdersModule` depends on 6 modules | **Accepted** — it is the composition root. Nothing depends on it, so no cycle is possible. | Keep it thin: orchestration, not domain logic borrowed from elsewhere |
| 2 | `ReviewsModule` → `OrdersModule` | **Low** — read-only, one-directional | If it ever becomes bidirectional, use a domain event |
| 3 | `InventoryModule` writes a field inside a `CatalogModule` document | **Accepted, documented** (ADR-INVENTORY-002) | `stock` rejected by the product DTO; Inventory is the only writer |
| 4 | `ReviewsModule` writes `products.rating` | Same pattern | `rating` rejected by the product DTO |
| 5 | `PricingModule` ↔ `CartModule` | **No cycle** — Cart → Pricing only | Pricing never imports Cart; it receives priced input |
| 6 | `AuthModule` ↔ `UsersModule` | **Watch.** Auth needs user creation; Users needs no auth logic. | Auth → Users only. Guards live in Auth and are consumed via `@Global` export |
| 7 | Everything → sinks | **No risk** — sinks import nothing | Lint-enforced |

**Enforcement:** `import/no-cycle` as a CI error, plus an architecture test asserting that `AuditModule` and `NotificationsModule` import no domain module.

---

## 6. Cross-cutting mechanics

| Concern | Mechanism |
|---|---|
| Authentication | `JwtAuthGuard` global via `APP_GUARD`; `@Public()` opts out |
| Authorization | `RolesGuard` + `OwnershipGuard` |
| Validation | Global `ValidationPipe({whitelist: true, forbidNonWhitelisted: true, transform: true})` — `forbidNonWhitelisted` is what rejects `role`, `stock`, `price` and `userId` injection attempts |
| Response shape | `TransformInterceptor` |
| Errors | `AllExceptionsFilter` — no driver text ever reaches a client |
| Audit | `AuditInterceptor` on admin-mutating routes |
| Rate limiting | `ThrottlerGuard` + per-route overrides |
| Request id | Middleware → async context → every log line and error response |
| Transactions | `TransactionService` wrapping `session.withTransaction` |

---

## 7. Modules deliberately NOT created

| Not created | Reason |
|---|---|
| `AdminModule` | Admin is a role; admin controllers live in each domain module |
| `PaymentsModule` | COD only. `payment.status` is a field on the order. Create when Paymob is actually adopted. |
| `WishlistModule` | Client-side for MVP (legacy table had 0 rows) |
| `AttributesModule` | Absorbed into Catalog as `specs[]` + `specDefinitions` |
| `VariantsModule` | Variants removed |
| `RealtimeModule` | Realtime confirmed unused (0 tables published) |
| `QueueModule` | No background work in MVP; email is fire-and-retry |
| `SettingsModule` | Legacy settings page was a stub with no requirement |

---

## 8. Workspace placement

```
nest-electronics/
├── apps/
│   ├── api/          ← NEW — the NestJS application (Phase 2)
│   ├── storefront/
│   └── admin/
├── packages/
│   ├── types/        ← domain types + Zod schemas (reused for DTOs)
│   ├── config/       ← constants (ROUTES, governorates)
│   ├── ui/           ← unchanged
│   ├── api-client/   ← NEW — generated from OpenAPI (Phase 8)
│   ├── repositories/ ← retired after Phase 9
│   ├── providers/    ← DELETED after Phase 9 (Supabase)
│   └── services/     ← DELETED after Phase 9
```

`apps/api` joins the existing Turborepo. `@nest/types` is the most valuable existing asset — its Zod schemas seed the DTOs directly.

---

## 9. Summary

| Aspect | Decision |
|---|---|
| Modules | **15** (1 global + 12 domain + 2 sinks) |
| Admin | **Role-guarded controllers inside domain modules** — no `AdminModule` |
| Graph | **Acyclic**, 4 layers + 2 sinks, lint-enforced |
| Composition root | `OrdersModule` — 6 dependencies, zero dependents |
| Money | Computed **only** in `PricingModule` |
| Stock | Written **only** by `InventoryModule` |
| Rating | Written **only** by `ReviewsModule` |
| Credentials | Never leave `AuthModule` |
| Sinks | `AuditModule`, `NotificationsModule` — called by all, call none |
| Search | Isolated so the engine can be swapped |

---

## 10. Phase 1.1 clarifications (added 2026-08-30)

> **No Phase 1 decision is changed.** Phase 1.1 defines *where the code lives*; the module list, responsibilities and dependency graph above are unchanged. Three clarifications are recorded so the two phases read consistently.

### C1 — Vendor SDKs live in `src/providers/`, not inside modules

§4 describes `MediaModule` as performing "Cloudinary upload/destroy" and `NotificationsModule` as depending on "an email provider". Phase 1.1 refines the code placement:

| Module | Owns (unchanged) | Vendor SDK location (new) |
|---|---|---|
| `MediaModule` | Validation, metadata, reference counting, transformation presets, **`MediaStoragePort`** | `src/providers/storage/cloudinary/` |
| `NotificationsModule` | Template selection, recipients, business meaning, **`EmailSenderPort`**, `TemplateRendererPort` | `src/providers/email/resend/` |

The **capability** stays with the module; only the **vendor adapter** moves. See [`PROVIDER-ARCHITECTURE.md`](./PROVIDER-ARCHITECTURE.md).

### C2 — Consumers call business methods, not ports

A consequence of C1 worth stating explicitly: `AuthModule` and `OrdersModule` do **not** inject `EmailSenderPort`. They call `NotificationsService.sendEmailVerification(...)` / `.sendOrderConfirmation(...)`. Likewise `CatalogModule` calls `MediaService.uploadProductImage(...)`, never `MediaStoragePort`.

The port sits **one module deeper** than its consumers, so the blast radius of any provider or email-semantics change is exactly one module. This does not alter the dependency edges in §3 — those already show `Orders → Notifications`, not `Orders → EmailSenderPort`.

### C3 — Email templates are application content, not module or provider code

The 14 email templates live at **`src/templates/email/`**, outside both `modules/` and `providers/`. `NotificationsModule` owns template *selection* and the typed data contracts; the `.hbs` files themselves are versioned content assets. See [`TEMPLATE-ARCHITECTURE.md`](./TEMPLATE-ARCHITECTURE.md) §3.

### Module tiering

Phase 1.1 additionally assigns each of the 15 modules a **structural tier** (flat / 3-layer / full 4-layer) based on complexity, so that `BrandsModule` is not forced into the same folder ceremony as `OrdersModule`. The module list is unchanged; only internal structure differs. See [`CODEBASE-STRUCTURE.md`](./CODEBASE-STRUCTURE.md) §3 and §7.
