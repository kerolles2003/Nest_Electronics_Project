# Codebase Structure — Phase 1.1

**Status:** FROZEN pending review · **Date:** 2026-08-30 · **ADRs:** ADR-CODE-001 … 004

> Defines **how the future NestJS codebase is organised**. It does not reopen any Phase 1 business decision.
>
> Covers Part 1 (root structure), Part 2 (module structure) and Part 8 (MongoDB code boundaries) of the Phase 1.1 brief.

---

## 1. Guiding principle

> **Structure is proportional to complexity.**

The single most common failure in "clean architecture" backends is applying the same four-layer ceremony to every module, so that `BrandsModule` — which lists 17 rows — carries the same folder count as `OrdersModule`, which owns a transactional state machine. That produces navigational noise, not maintainability.

This document therefore defines **three module tiers** with **explicit promotion criteria** (§4). A module earns layers by demonstrating complexity, never by symmetry with its neighbours.

---

## 2. Root structure

The structure proposed in the brief is **accepted with two refinements**, explained in §2.2.

```
apps/api/
├── src/
│   ├── main.ts                 # bootstrap only
│   ├── app.module.ts           # composition root
│   │
│   ├── config/                 # typed, validated configuration
│   ├── common/                 # genuinely cross-cutting code
│   ├── database/               # ← REFINEMENT 1: connection, transactions, indexes
│   ├── modules/                # business capabilities  (Phase 1 domains)
│   ├── providers/              # replaceable external vendor adapters
│   └── templates/              # email templates (provider-independent)
│
├── test/                       # e2e specs and shared fixtures
├── Dockerfile
├── nest-cli.json
├── tsconfig.json
└── package.json
```

### 2.1 Directory contract

| Directory | Purpose | MUST contain | MUST NOT contain |
|---|---|---|---|
| **`main.ts`** | Bootstrap: create the app, apply global config, listen | Nest factory, global pipe/filter/interceptor wiring, Swagger setup, shutdown hooks | Any business logic, any conditional feature logic |
| **`app.module.ts`** | The composition root. The only file that knows the full module list. | Module imports, `APP_GUARD`/`APP_FILTER`/`APP_INTERCEPTOR` providers | Controllers, services, business logic |
| **`config/`** | Typed, validated configuration namespaces | Env schema, config factories, typed accessors | `process.env` reads outside the schema, secrets, business rules |
| **`common/`** | Code used by **three or more** modules with no domain meaning | Decorators, guards, interceptors, filters, pipes, base error classes, shared primitives (`Money`), pagination DTOs | Anything domain-specific, anything used by only one or two modules, a `utils/misc.ts` dumping ground |
| **`database/`** | MongoDB connection lifecycle and transaction plumbing | `DatabaseModule`, `TransactionService`, index-sync script, seed scripts | Any collection schema (those are module-local), any query |
| **`modules/`** | One directory per Phase 1 domain | Business capability code, module-local persistence | Vendor SDK imports, cross-module reach-in (`../orders/internal/...`) |
| **`providers/`** | Adapters to replaceable third-party vendors | Vendor SDK imports (**the only place they may appear**), port implementations, vendor DTO mapping | Business rules, domain types, email templates, Mongoose schemas |
| **`templates/`** | Email templates as content assets | `.hbs` layouts, partials, per-domain templates | Provider-specific markup, TypeScript logic, business rules |

### 2.2 The two refinements

**Refinement 1 — a root `database/` directory was added.**

Phase 1 mandates a replica set with multi-document transactions ([`CONSISTENCY-MODEL.md`](./CONSISTENCY-MODEL.md)) and an explicit, idempotent index-creation step ([`OBSERVABILITY.md`](./OBSERVABILITY.md) §9). Both are cross-module infrastructure concerns:

- `TransactionService` is consumed by `OrdersModule` and `InventoryModule` and belongs to neither.
- Index synchronisation spans every collection.

Putting these in `common/` would blur `common/` into "infrastructure plus utilities". Putting them in a module would give that module an unwarranted dependency inversion. A small, explicit `database/` directory is the honest boundary.

**Refinement 2 — `providers/` is scoped to *external vendors only*.**

A root `providers/` directory invites a slow slide into "anything that talks to something else". The rule is narrow and testable:

> **A directory belongs under `providers/` if, and only if, it imports a third-party vendor SDK for a capability that could realistically be swapped for a competitor.**

| Belongs in `providers/` | Does **not** belong in `providers/` |
|---|---|
| Resend / Zoho / SES email adapters | Mongoose schemas and repositories — persistence is module-local (§6) |
| Cloudinary / S3 / R2 storage adapters | `TransactionService` — infrastructure, but not a vendor |
| A future Paymob / Stripe payment adapter | Internal helper services |
| A future Twilio SMS adapter | Anything containing a business rule |

**Why MongoDB is deliberately excluded from `providers/`.** Phase 1 chose MongoDB with a document model designed *specifically* for it — embedded order items, materialised category paths, multikey spec indexes ([`MONGODB-DESIGN.md`](./MONGODB-DESIGN.md)). That model does not transfer to PostgreSQL or DynamoDB without redesign. Pretending the database is swappable behind a generic port would be **dishonest abstraction**: it would add ceremony while delivering none of the promised replaceability. Persistence stays module-local, where its coupling is visible.

### 2.3 What is deliberately *not* at the root

| Rejected | Reason |
|---|---|
| `src/interfaces/` | Explicitly forbidden by the brief, and correctly so — contracts orphaned from their capability rot. Ports live with the module that owns them (§5). |
| `src/services/` | A flat service directory destroys module boundaries |
| `src/dto/` | DTOs belong to the module whose endpoints they serve |
| `src/entities/` | Domain types belong to their module |
| `src/utils/` | Becomes a dumping ground. Utilities live in `common/` under strict rules ([`CROSS-CUTTING-STANDARDS.md`](./CROSS-CUTTING-STANDARDS.md)) |
| `src/shared/` | Synonym for `common/`; two names for one concept guarantees drift |
| `src/core/` | Undefinable boundary — everything is arguably "core" |

---

## 3. Module structure standard

The four-layer model from the brief is **accepted for complex modules only**, and explicitly rejected as a universal template.

### Tier 1 — Simple (flat)

For CRUD over a small collection with no meaningful invariants.

```
modules/brands/
├── brands.module.ts
├── brands.controller.ts          # public read
├── admin-brands.controller.ts    # @Roles('ADMIN')
├── brands.service.ts             # queries + business rules (both trivial)
├── dto/
│   ├── create-brand.dto.ts
│   ├── update-brand.dto.ts
│   └── brand-response.dto.ts
└── schemas/
    └── brand.schema.ts           # Mongoose schema + document type
```

**5 files, no layer directories.** The service may use the Mongoose model directly. There is no repository, no port, no command object, no domain entity.

**Assigned (4 modules):** `content`, `fulfilment`, `audit`, `health`.

> `brands` and `categories` follow this same flat shape, but they are **sub-areas inside the Tier-2 `catalog` module**, not standalone modules. They are therefore **not counted as Tier-1 modules**.

### Tier 2 — Standard (service + persistence separation)

For modules with non-trivial queries or several invariants, but no rich domain model.

```
modules/catalog/
├── catalog.module.ts
├── presentation/
│   ├── products.controller.ts
│   ├── admin-products.controller.ts
│   ├── categories.controller.ts
│   └── dto/
├── application/
│   ├── products.service.ts
│   ├── categories.service.ts
│   └── brands.service.ts
└── infrastructure/
    ├── schemas/
    │   ├── product.schema.ts
    │   ├── category.schema.ts
    │   └── brand.schema.ts
    └── repositories/
        └── product.repository.ts   # complex query surface justifies this
```

**Three layers. No `domain/`** — product rules are simple enough to live in the service. A repository exists for products (faceted search, subtree filters, snapshot refresh) but **not** for categories or brands, whose access is trivial.

**Assigned:** `catalog`, `users`, `cart`, `reviews`, `media`, `notifications`, `search`.

### Tier 3 — Complex (full four layers)

For modules owning a state machine, monetary calculation, or a security boundary.

```
modules/orders/
├── orders.module.ts
├── presentation/
│   ├── orders.controller.ts
│   ├── admin-orders.controller.ts
│   ├── order-tracking.controller.ts
│   └── dto/
│       ├── place-order.dto.ts
│       ├── track-order.dto.ts
│       └── order-response.dto.ts
├── application/
│   ├── commands/
│   │   ├── place-order.command.ts
│   │   ├── transition-order.command.ts
│   │   └── cancel-order.command.ts
│   ├── services/
│   │   ├── order-placement.service.ts
│   │   ├── order-lifecycle.service.ts
│   │   └── order-tracking.service.ts
│   └── ports/
│       └── order.repository.port.ts
├── domain/
│   ├── order-status.enum.ts
│   ├── order-state-machine.ts        # the transition matrix — pure, no Nest
│   ├── order-number.ts               # value object
│   └── errors/
│       └── invalid-transition.error.ts
└── infrastructure/
    ├── schemas/
    │   └── order.schema.ts
    └── repositories/
        └── mongo-order.repository.ts
```

**Assigned:** `orders`, `inventory`, `auth`, `pricing`.

**Why exactly these four.** Each owns something Phase 0.5 proved is dangerous when scattered:

| Module | What it owns | Legacy failure it guards against |
|---|---|---|
| `orders` | The transition matrix | The matrix lived only in admin app code while the RPC validated nothing (F-HIGH-1) |
| `inventory` | Stock authority + ledger invariant | Any direct `UPDATE products SET stock_quantity` bypassed the ledger |
| `auth` | Credentials and token lifecycle | Four `SECURITY DEFINER` RPCs callable by `anon` (F-CRIT-1) |
| `pricing` | The only place money is computed | The effective-price rule was duplicated across four frontend components and a dead service |

Isolating each in a `domain/` layer that imports **nothing** — no NestJS, no Mongoose, no vendor SDK — makes these rules unit-testable in milliseconds and impossible to accidentally couple to transport or persistence.

---

## 4. Tier promotion criteria

A module is promoted when **any two** criteria in the target tier are met. Promotion is a pull request that moves files; it is never a rewrite.

### Tier 1 → Tier 2

- The service exceeds ~200 lines, **or**
- More than three distinct query shapes exist against the collection, **or**
- Aggregation pipelines appear, **or**
- More than one controller serves the module

### Tier 2 → Tier 3

- The module owns a **state machine** or lifecycle, **or**
- The module **computes money**, **or**
- The module owns a **security boundary** (credentials, authorization), **or**
- The module requires **multi-collection transactions**, **or**
- A business rule needs unit testing **without** a database

> **Explicitly permitted: starting a module at Tier 1 and never promoting it.** `BrandsModule` is expected to remain five files forever. That is a success, not technical debt.

**Demotion is also permitted.** If a Tier 3 `domain/` folder ends up holding only enums, the module was mis-tiered; flatten it.

---

## 5. Where ports live

Restating the brief's rule, with the concrete answer for this project:

> **A port lives inside the module that owns the *capability*, not inside the module that *consumes* it.**

| Port | Owned by | Implemented in | Consumed by |
|---|---|---|---|
| `EmailSenderPort` | `modules/notifications/application/ports/` | `providers/email/resend/` | `notifications` only |
| `TemplateRendererPort` | `modules/notifications/application/ports/` | `modules/notifications/infrastructure/` | `notifications` only |
| `MediaStoragePort` | `modules/media/application/ports/` | `providers/storage/cloudinary/` | `media` only |
| `OrderRepositoryPort` | `modules/orders/application/ports/` | `modules/orders/infrastructure/` | `orders` only |

**A consequence worth stating explicitly:** `AuthModule` and `OrdersModule` never see `EmailSenderPort`. They call `NotificationsService.sendOrderConfirmation(...)` — a business-meaningful method. The email port is an internal detail of `NotificationsModule`.

This matters for replaceability. If `AuthModule` injected `EmailSenderPort` directly, then switching provider *semantics* (say, a provider requiring pre-registered template ids) would ripple into Auth. Keeping the port one module deep means the blast radius of any email change is exactly one module. See [`REPLACEMENT-TESTS.md`](./REPLACEMENT-TESTS.md).

The same applies to media: `CatalogModule` calls `MediaService.uploadProductImage(...)`, never `MediaStoragePort`.

---

## 6. MongoDB code boundaries (Part 8)

### 6.1 Where things live

| Artifact | Location | Rule |
|---|---|---|
| Mongoose schema + document type | `modules/<m>/infrastructure/schemas/` (Tier 2/3) or `modules/<m>/schemas/` (Tier 1) | **One schema file per collection. A schema is owned by exactly one module.** |
| Queries | Tier 1: the service · Tier 2/3: a repository | Never in a controller. Never in `common/`. |
| Repository implementation | `modules/<m>/infrastructure/repositories/` | Implements the module's own port (Tier 3) or is a concrete class (Tier 2) |
| Repository port | `modules/<m>/application/ports/` | **Tier 3 only** |
| Connection + transactions | `database/` | — |
| Index definitions | Declared on the schema; **created by an explicit sync step**, never `autoIndex` in production | Phase 1 requirement |

### 6.2 When a repository is justified

> **Do not introduce a generic repository pattern merely because MongoDB exists.**

| Situation | Verdict |
|---|---|
| Tier 1 module, `findOne`/`find`/`create`/`update` | ❌ **No repository.** The service uses the injected model directly. A repository here is a one-line wrapper with no purpose. |
| Tier 2 with a complex query surface (faceted search, aggregation, subtree filters) | ✅ **Concrete repository class**, no interface. It isolates query construction and keeps the service readable. |
| Tier 3 with business rules needing tests without a database | ✅ **Port + implementation.** The port exists so `OrderPlacementService` can be unit-tested with an in-memory fake. |
| "For consistency with other modules" | ❌ **Never a reason.** |

**Absolutely forbidden: a generic `BaseRepository<T>` with `findAll/findOne/create/update/delete`.** It is the canonical over-abstraction ([`ANTI-OVERENGINEERING.md`](./ANTI-OVERENGINEERING.md) §2). Every real query in this system is specific — `findActiveBySlugWithRedirect`, `decrementStockIfAvailable`, `findForUser`. A generic base class provides none of them and encourages leaking Mongoose filter objects across boundaries.

### 6.3 Preventing document leakage

**Rule: a Mongoose document must never leave its owning module.**

```
Mongoose Document  ──▶  Domain type / plain object  ──▶  Response DTO
   (infrastructure)          (application)                (presentation)
```

Three enforcement points:

1. Repositories return **plain objects** (`.lean()`) or domain types — never hydrated documents. This stops `.save()` being callable from a service and prevents accidental serialisation of `__v` and internal fields.
2. Controllers return **Response DTOs**, never a document ([`DTO-STRATEGY.md`](./DTO-STRATEGY.md)).
3. A cross-module call never accepts or returns a document type.

**Why this matters concretely.** Phase 1 requires that `costPrice` never appears in a public DTO ([`CATALOG-MODEL.md`](./CATALOG-MODEL.md) §5). If a controller could return a raw product document, that guarantee would depend on remembering to strip a field on every endpoint. With explicit Response DTOs it depends on the field simply not existing in `ProductPublicDto`.

### 6.4 Transactions

`TransactionService` (in `database/`) wraps `session.withTransaction`. Rules:

- Only **application services** open transactions — never controllers, never repositories.
- Repository methods **accept an optional `session`** so they can participate.
- **No external call (Cloudinary, email) may occur inside a transaction** — Phase 1 rule, enforced by review and by the fact that provider adapters are injected into different services than the transactional ones.

---

## 7. Module inventory and tier assignment

The 15 Phase 1 modules, tiered:

| Module | Tier | Structure | Repository? | Ports? |
|---|---|---|---|---|
| `auth` | **3** | Full | ✅ credential repo | — |
| `users` | 2 | 3 layers | ✅ | — |
| `catalog` | 2 | 3 layers | ✅ products only | — |
| `search` | 2 | 3 layers | ✅ read-only query service | — |
| `inventory` | **3** | Full | ✅ | `InventoryRepositoryPort` |
| `pricing` | **3** | Full | ✅ coupons | `CouponRepositoryPort` |
| `cart` | 2 | 3 layers | ✅ | — |
| `orders` | **3** | Full | ✅ | `OrderRepositoryPort` |
| `fulfilment` | 1 | Flat | ❌ | — |
| `reviews` | 2 | 3 layers | ✅ | — |
| `content` | 1 | Flat | ❌ | — |
| `media` | 2 | 3 layers | ❌ (metadata only) | **`MediaStoragePort`** |
| `notifications` | 2 | 3 layers | ❌ | **`EmailSenderPort`**, `TemplateRendererPort` |
| `audit` | 1 | Flat | ❌ | — |
| `health` | 1 | Flat | ❌ | — |

> **Port inventory authority:** the "Ports?" column above reflects [`PORTS-AND-CONTRACTS.md`](./PORTS-AND-CONTRACTS.md) §3, which is the **single authoritative port inventory** (six ports). This table must never define a competing set. `auth` has **no port** — a token-store port is not part of the approved architecture and would require its own J1/J2 justification.

**Four Tier-1, seven Tier-2, four Tier-3 — 15 modules total.** Roughly a quarter of modules carry full layering — proportionate to the fact that a quarter of the domains own money, stock, state or credentials.

---

## 8. Enforcement

Structure that is not enforced becomes advisory within two sprints.

| Rule | Mechanism |
|---|---|
| No import cycles | `eslint-plugin-import/no-cycle` — CI error |
| Layer direction | `eslint-plugin-boundaries` (or `dependency-cruiser`) — CI error |
| Vendor SDKs only in `providers/` | `no-restricted-imports` — CI error ([`DEPENDENCY-RULES.md`](./DEPENDENCY-RULES.md)) |
| `domain/` imports nothing framework-shaped | `no-restricted-imports` on `@nestjs/*`, `mongoose` — CI error |
| Naming conventions | ESLint + review ([`CODE-STANDARDS.md`](./CODE-STANDARDS.md)) |
| Tier appropriateness | Human review against §4 |

---

## 9. Summary

| Decision | Choice |
|---|---|
| Root layout | `config` · `common` · **`database`** · `modules` · `providers` · `templates` |
| `providers/` scope | **External vendor SDKs only** — not MongoDB |
| Module layering | **Three tiers**, promoted on explicit criteria — not uniform |
| Tier 3 modules | `orders`, `inventory`, `auth`, `pricing` — money, stock, state, credentials |
| Tier 1 modules | `content`, `fulfilment`, `audit`, `health` (4) |
| Port location | **Inside the owning capability module**, never a global `interfaces/` |
| Port visibility | Consumers call business methods, not ports |
| Repositories | **Only when justified** — never generic, never for symmetry |
| Documents | **Never leave their module** |
| Enforcement | Lint rules in CI, not convention |
