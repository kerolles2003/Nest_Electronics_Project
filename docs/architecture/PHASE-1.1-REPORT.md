# PHASE 1.1 — CODE ARCHITECTURE & SUSTAINABILITY REPORT

**Project:** Nest Electronics · **Date:** 2026-08-30 · **Status:** ✅ **COMPLETE — awaiting architecture review**

| | |
|---|---|
| **Builds on** | Phase 0 audit · Phase 0.5 forensics · **Phase 1 architecture freeze** |
| **Scope** | How the future codebase is organised. **No Phase 1 business decision is reopened.** |
| **Output** | 13 code-architecture documents + 1 Phase 1 clarification appendix |
| **Not done** | No NestJS project, no modules, no services, no controllers, no schemas, no dependencies installed, no `.env` file, no MongoDB/Cloudinary/Resend connection, no Next.js or Supabase change |

---

## 1. Architecture goal

**Modular monolith with enforced boundaries and ports only where they earn their place.**

Two failure modes were designed against simultaneously:

| Failure | Guard |
|---|---|
| **Under-engineering** — business rules scattered across layers, vendor SDKs in services, no boundaries | Four Tier 3 modules with full layering · six justified ports · lint-enforced dependency rules |
| **Over-engineering** — interface per class, generic repository, factories, registries, event bus, CQRS | Three module tiers with promotion criteria · [`ANTI-OVERENGINEERING.md`](./ANTI-OVERENGINEERING.md) with 20 named anti-patterns |

The organising principle: **structure is proportional to complexity.** `BrandsModule` is five flat files; `OrdersModule` has four layers. Both are correct.

---

## 2. Final root folder structure

```
apps/api/src/
├── main.ts                # bootstrap only
├── app.module.ts          # composition root
├── config/                # typed, validated configuration
├── common/                # 3+ consumers, no domain meaning
├── database/              # ← added: connection, transactions, index sync
├── modules/               # 15 business capabilities (Phase 1 domains)
├── providers/             # replaceable vendor adapters — the ONLY SDK location
└── templates/email/       # provider-independent content assets
```

**Two refinements to the proposed structure:**

1. **`database/` added.** `TransactionService` is used by `orders` and `inventory` and belongs to neither; putting it in `common/` would blur that directory into "infrastructure plus utilities".
2. **`providers/` scoped narrowly** — *a directory belongs there if and only if it imports a third-party vendor SDK for a realistically swappable capability.* Persistence stays module-local, so grepping `providers/` reveals every vendor coupling in the system.

**Rejected at root:** `interfaces/`, `services/`, `dto/`, `entities/`, `utils/`, `shared/`, `core/`.

---

## 3. Module architecture

**Three tiers, assigned by complexity, with written promotion *and demotion* criteria.**

| Tier | Structure | Modules |
|---|---|---|
| **1 — Flat** (~5 files) | `module` · `controller` · `service` · `dto/` · `schemas/` | `content`, `fulfilment`, `audit`, `health` |
| **2 — Standard** | `presentation/` · `application/` · `infrastructure/` | `catalog`, `users`, `cart`, `reviews`, `media`, `notifications`, `search` |
| **3 — Full** | `+ domain/` | **`orders`, `inventory`, `auth`, `pricing`** |

**Totals: 4 Tier-1 · 7 Tier-2 · 4 Tier-3 — 15 modules.** Authoritative tier table: [`CODEBASE-STRUCTURE.md`](./CODEBASE-STRUCTURE.md) §7.

**Why exactly those four are Tier 3** — each owns something Phase 0.5 proved dangerous when scattered:

| Module | Owns | Legacy failure |
|---|---|---|
| `orders` | Transition matrix | Lived only in admin app code; the RPC validated nothing |
| `inventory` | Stock authority + ledger | Any direct `UPDATE` bypassed the ledger |
| `auth` | Credentials, tokens | Four `SECURITY DEFINER` RPCs callable by `anon` |
| `pricing` | All money | Effective-price rule duplicated across four frontend components |

**Promotion:** any two criteria met (state machine · computes money · security boundary · multi-collection transaction · rule needs testing without a database). **Demotion is explicitly permitted** — a `domain/` folder holding only enums means the module was mis-tiered.

---

## 4. Layer responsibilities

| Layer | Owns | Never contains |
|---|---|---|
| **Presentation** | Controllers, request/response DTOs, HTTP serialisation | Business rules, queries, vendor calls |
| **Application** | Use cases, orchestration, commands, results, **ports**, transaction orchestration | Vendor SDKs, HTTP exceptions, Mongoose |
| **Domain** | Entities, value objects, business rules, domain errors | **Anything** — imports no `@nestjs/*`, no `mongoose`, no vendor |
| **Infrastructure** | Repositories, Mongoose schemas, port implementations | Business rules |

`domain/` importing nothing framework-shaped is what makes the transition matrix a pure function testable in under 5 ms.

---

## 5. DTO strategy

**Tiered, matching module tiers.**

```
Tier 1/2:  Request DTO → Service → Response DTO
Tier 3:    Request DTO → Command → Service → Result → Response DTO
```

**A Command is required when** input includes data not in the HTTP request (`userId` from the JWT, `Idempotency-Key` from a header) · the operation is transactional · it has multiple callers · money or stock is computed.

The first condition is the structural answer to F-CRIT-2. `PlaceOrderDto` has **no `userId`, no items, no prices**; `PlaceOrderCommand` has `userId` from the token. A reviewer sees the entire trust boundary in fifteen lines.

**Audience separation is structural, not conditional.** `ProductResponseDto` and `ProductAdminResponseDto` are separate classes so `costPrice` cannot leak — the guarantee depends on the field not existing, not on a decorator being remembered.

**`class-validator`** for DTOs, because `@nestjs/swagger` generates the OpenAPI document — and therefore the Flutter client — from the same decorated classes that validate at runtime.

---

## 6. Ports & contracts

**Six ports. Each individually justified.** A port requires **J1** (vendor replaceability) or **J2** (business rule testable without infrastructure). J3 (simultaneous polymorphism) applies nowhere.

| Port | Owner | Justification |
|---|---|---|
| `EmailSenderPort` | `notifications` | J1 |
| `MediaStoragePort` | `media` | J1 |
| `TemplateRendererPort` | `notifications` | J1 (weak) + J2 |
| `OrderRepositoryPort` | `orders` | J2 |
| `InventoryRepositoryPort` | `inventory` | J2 |
| `CouponRepositoryPort` | `pricing` | J2 |

**Ports are `abstract class`** — one artifact serving as both type and DI token, so consumers use ordinary constructor injection with no token registry to drift.

**Notable rejection:** `SearchService` gets **no** port despite a planned `$text` → Atlas Search migration, because the change is contained inside one service and both engines never coexist.

---

## 7. Provider architecture

```
Business module  →  Capability module  →  Port  →  Adapter  →  Vendor SDK
 (OrdersModule)     (NotificationsService)          (providers/email/resend/)
```

**One active provider, selected by a conditional `useClass` in one file.** No registry, no factory class, no failover, no runtime switching — the requirement is replaceability, not simultaneity.

**Consumers call business methods, never ports.** `AuthModule` calls `NotificationsService.sendEmailVerification(...)` and never sees `EmailSenderPort`. The port sits one module deeper, so the blast radius of any email change is exactly one module.

---

## 8. Email architecture

`EmailSenderPort` has **one method**: `send(OutboundEmail) → EmailSendResult`.

| Property | Decision |
|---|---|
| `OutboundEmail.html` | **Already rendered** — the port receives content, never a template reference |
| `from` | **Adapter-supplied from config** — business code cannot send from the wrong address |
| `providerMessageId` | **Opaque** — logged and stored, never parsed |
| Vendor errors | Translated at the adapter boundary into `EmailTransportError` etc. |
| Credentials | In the provider's own config namespace, read **only** by that adapter |
| Dispatch | Post-commit, failure-tolerant — never rolls back an order |

---

## 9. Media architecture

`MediaStoragePort`: `upload` · `delete` · `getUrl(asset, preset)`.

**The hard case handled honestly:** Cloudinary produces `t_card` by URL transformation; S3 cannot. The port asks for **intent** via a closed application-owned `ImagePreset` union — not a passthrough for vendor transformation strings. An S3 adapter satisfies the same intent by pre-generating derivatives at upload. **That complexity lives entirely inside the adapter.**

**Validation stays in `MediaService`**, not the adapter — MIME allow-list, magic-byte sniffing, size limits, dimension caps, EXIF stripping, SVG rejection. These are Phase 1 *security rules* and must survive a provider change. Reference counting likewise stays in the business module.

---

## 10. Template architecture

**`src/templates/email/`** — outside both `modules/` and `providers/`. 14 templates, each matching a real Phase 1 business event.

| Decision | Reason |
|---|---|
| **Handlebars** | **Logic-less by design** — a business rule *cannot* be written into a template, so it must live in a service where it is testable. Given Phase 0.5 found rules scattered across five layers, an engine that cannot hold logic is a structural guard. |
| **Rendered before the port** | What makes "0 templates change on a provider swap" true |
| **Typed data contract per template** | Never a domain entity or Mongoose document — the same reasoning that forbids returning a document from a controller |
| **Money and dates pre-formatted** | Templates never compute |
| **Missing variable throws**, in production too | Handlebars' silent-empty default would send *"Your order  has shipped"* |
| **Compiled at boot** | A broken template is a startup failure, not a customer discovery |
| **Locale directories with `en` fallback** | Arabic structured, not built — avoiding the legacy mistake of 100%-NULL `name_ar` columns |

---

## 11. Configuration architecture

**`env.schema.ts` is the only file reading `process.env`.** Zod-validated at boot, fail-fast, reporting **every** error at once. Typed namespaces injected; never global lookup.

**Application-level vs vendor-level config is separated:** `EMAIL_PROVIDER` and `EMAIL_FROM_ADDRESS` are application config; `RESEND_API_KEY` lives beside the Resend adapter and is read only by it.

**Business constants are code constants**, not environment variables — max quantity 99, bcrypt rounds, TTLs. Changing a business rule should require review and tests.

> Direct lesson from Phase 0: `packages/config/src/env.ts` implemented exactly this validation and was **imported nowhere**, so it never ran. A validation module nothing imports is worse than none.

**No feature-flag system** — only boot-time infrastructure switches.

---

## 12. MongoDB code boundaries

| Artifact | Location |
|---|---|
| Schema | `modules/<m>/infrastructure/schemas/` — **one module owns each collection** |
| Queries | Tier 1: the service · Tier 2/3: a repository. **Never a controller.** |
| Repository port | **Tier 3 only** |
| Connection, transactions, index sync | `database/` |

**Repositories only when justified.** Tier 1 uses the model directly — a one-line wrapper is pure overhead. **`BaseRepository<T>` is forbidden**: every real query here is specific (`decrementStockIfAvailable`, `findActiveBySlugWithRedirect`), and a generic base provides none of them while hiding concurrency semantics.

**A Mongoose document never leaves its module.** Repositories return `.lean()` plain objects; controllers return Response DTOs.

**Transactions are opened only by application services** — never controllers, never repositories — and **no external call may occur inside one**.

---

## 13. Cross-cutting standards

**`common/` admits a file only if 3+ modules use it AND it carries no domain meaning.** Both conditions.

**There is no `common/utils/`** — a `utils/` directory is a naming failure, not a category. Named directories only.

**One documented exception:** `Money` lives in `common/` despite being domain-meaningful, because five modules use it and placing it in any one would create dependency edges absent from the Phase 1 graph. It is a *primitive*; the rules that use money stay in `PricingModule`. Recorded explicitly so it does not become a precedent.

**`common/` may never import from `modules/`** — that constraint alone decides most placement questions.

---

## 14. Error boundaries

```
DomainError / ApplicationError / InfrastructureError
        ↓
AllExceptionsFilter   ← the ONLY error→HTTP translator
        ↓
{ error: { code, message, requestId, timestamp } }
```

**`HttpException` is forbidden outside `presentation/`.** A service throwing `NotFoundException` cannot then be called from a job, another service, or a test without dragging transport semantics along — and Phase 1 requires order cancellation callable from both a customer and an admin route.

**Business rejections are not errors:** `OUT_OF_STOCK` is 4xx, logged `info`, **not** sent to Sentry. Infrastructure faults are 5xx, logged `error`, **sent** to Sentry. That separation is the direct lesson of the tracking-number defect, where legacy's `EXCEPTION WHEN OTHERS` collapsed a genuine fault into the same shape as a business rejection and hid it for months.

---

## 15. Dependency rules

```
Presentation → Application → Domain
Infrastructure → implements Application ports
```

**Fifteen forbidden dependencies, each with an enforcement mechanism.** The central one:

| Forbidden | Enforcement |
|---|---|
| `application/` → a vendor SDK | `no-restricted-imports`, CI error |
| `domain/` → `@nestjs/*` or `mongoose` | `no-restricted-imports`, CI error |
| `modules/**` → `providers/**` | `eslint-plugin-boundaries`, CI error |
| `common/**` → `modules/**` | `eslint-plugin-boundaries`, CI error |
| `process.env` outside the schema | `no-restricted-properties`, CI error |
| `HttpException` outside presentation | `no-restricted-imports`, CI error |
| Any import cycle | `import/no-cycle`, CI error |

**A grep for `from 'resend'` outside `providers/email/resend/` must return zero results, permanently.**

**Exactly three documented exceptions** (Inventory writing `products.stock`, Reviews writing `products.rating`, `domain/` importing `Money`). An undocumented exception is a violation.

---

## 16. Testing architecture

**Six levels.** Unit and application use fakes and touch no database. Infrastructure and above use a **real replica set**. Contract suites run against every port implementation.

**No test in the default suite touches a real vendor** — and this is structural: **vendor credentials are absent in CI**, so a test needing one fails rather than silently reaching the network.

| Highest-value suite | Level | Guards |
|---|---|---|
| Order transition matrix | Unit | The rule that legacy left in app code while the RPC validated nothing |
| No-oversell under concurrency | Infrastructure | 20 concurrent orders for 1 unit → exactly 1 succeeds |
| **Authorization matrix** | E2E | The direct replacement for RLS; the only credible evidence Phase 0 risk **R2** is discharged |
| Port conformance | Contract | The acceptance test for any provider swap |

**Phase 2 gate:** the transaction-rollback test must pass in every environment before any domain module is written.

**A fake must honour its port's semantics** — verified by running the same contract suite against fakes and real adapters. A permissive fake produces green tests and a broken deployment.

---

## 17. Code naming standards

`kebab-case.type.ts` · `PascalCase` classes · **no `I` prefix** · `SCREAMING_SNAKE_CASE` enum members matching the API contract exactly · constructor injection only, ≤ 5 dependencies · named exports only · barrel per module defining the public API.

**The most consequential rule:** repository methods are **specific and intention-revealing** — `decrementStockIfAvailable(id, qty)`, never `update(id, data)`. A named method cannot be reused for an arbitrary query, and it *names the concurrency guarantee* rather than hiding it. This is the most effective structural guard against a generic repository.

---

## 18. Anti-overengineering rules

**20 named anti-patterns**, each with why it is harmful *here* and the concrete condition that would justify it. Highlights:

| Rejected | Would be justified when |
|---|---|
| Interface for every class | A second implementation exists (J1) or a rule needs isolated testing (J2) |
| `BaseRepository<T>` | **Never in this shape** |
| Provider registry / factory / failover | Two providers must genuinely run at once |
| Event-driven architecture | A real fan-out — 3+ independent consumers |
| Microservices | Divergent scaling *and* a team large enough for deployment coupling to matter |
| Redis | **More than one API instance** (the trigger to watch) |
| CQRS buses | Read and write models genuinely diverge |
| Database abstraction | **Never** — it would be dishonest |
| Speculative ports | Design the port *with* its first implementation |

**The five-question test:** does a second implementation exist or is one concretely planned? Does it enable a currently-impossible test? If both are no, the answer is no.

**The counterweight:** *under-*engineering the order transition matrix would be exactly as costly as over-engineering the brands module. The honest test of the discipline is whether a module is ever **demoted** when its `domain/` turns out to hold only enums.

---

## 19. Provider replacement tests

| Scenario | Business modules changed | Templates changed | Files modified | Data migration | Verdict |
|---|---|---|---|---|---|
| **Resend → Zoho** | **0** | **0** | 3 (~10 lines) | No | ✅ Clean |
| **Cloudinary → S3** | **0** | **0** | 3 | **Yes** | ✅ Clean code, real data migration |
| Handlebars → React Email | 0 | **All 14** | 2 | No | ⚠️ Bounded |
| Add Paymob | Orders only | 2 new | several | No | ✅ Additive |
| **MongoDB → PostgreSQL** | All persistence | 0 | ~everything | Yes | ❌ **Not replaceable, by design** |

**Where the guarantee is weaker than the headline** — stated plainly rather than buried:

- Media carries **persisted state**; code is unaffected, data is not. No abstraction fixes that.
- A template *format* change rewrites templates; the port bounds the blast radius, it does not eliminate the work.
- The database is not swappable, and the architecture does not pretend otherwise.
- A provider with fundamentally different semantics (server-side template ids) would need a rendering decision inside `NotificationsModule` — still one module, but not a zero-thought swap.

---

## 20. Changes made to Phase 1

**No Phase 1 decision was changed.** Three clarifications were appended as §10 of [`NESTJS-MODULE-MAP.md`](./NESTJS-MODULE-MAP.md), with reasons:

| Clarification | Why needed |
|---|---|
| **C1** — Capabilities stay with modules; **vendor SDKs move to `src/providers/`** | Phase 1 described `MediaModule` as performing "Cloudinary upload/destroy", written before code placement existed. The capability is unchanged; only the SDK location is specified. |
| **C2** — Consumers call **business methods, not ports** | Makes explicit that `Orders → Notifications` (an existing Phase 1 edge) is the dependency — not `Orders → EmailSenderPort`. No graph change. |
| **C3** — Email templates live at **`src/templates/email/`** | Phase 1 did not address template placement. |

**One naming refinement, recorded:** `MediaStoragePort` uses `assetId`/`version` rather than Phase 1's persisted `publicId`/`version`, because "publicId" is Cloudinary vocabulary and a port must not speak a vendor's language. **The persisted field names in [`MEDIA-MODEL.md`](./MEDIA-MODEL.md) are unchanged**; mapping is one line in the media repository.

**Unchanged:** module list, responsibilities, dependency graph, sinks, no-`AdminModule`, one-writer-per-field, and every business rule, money decision, order lifecycle, inventory model and authorization rule.

---

## 21. Open decisions

| ID | Question | Blocks | Default |
|---|---|---|---|
| OPEN-1.1-A | Handlebars vs MJML | Nothing | Handlebars; revisit on measured rendering defects |
| OPEN-1.1-B | Port for `SearchModule` when Atlas Search arrives | Nothing | No port; revisit if engines must coexist |
| OPEN-1.1-C | Does `CatalogModule` split into products/taxonomy? | Nothing | One module; split above ~15 files |
| OPEN-1.1-D | `EventEmitter2` for `Reviews → Orders` | Nothing | Direct read-only call |
| OPEN-1.1-E | Formal `ClockPort` vs injected `now()` | Nothing | Injected function |

**None blocks Phase 2.** Phase 1's open items (shipping rates, VAT display, email provider choice, carrier list, **instance count → Redis**) remain open and unchanged.

---

## 22. Final quality check

| Question | Answer |
|---|---|
| Can Resend be replaced without changing Auth or Order business logic? | ✅ **Yes** — 3 files modified, **0 business modules**, 0 templates |
| Can Cloudinary be replaced without changing Product business logic? | ✅ **Yes** for code — 0 business modules. ⚠️ A **data migration** is required for existing assets. |
| Are email templates independent from providers? | ✅ **Yes** — rendering completes before the port; templates live outside `providers/` |
| Are business modules isolated from vendor SDKs? | ✅ **Yes** — lint-enforced; vendor imports only under `providers/` |
| Are DTOs separated from business models where complexity justifies it? | ✅ **Yes** — tiered; Tier 3 uses Command/Result, Tier 1/2 collapse |
| Are interfaces used only where useful? | ✅ **Yes** — six ports, each justified by J1 or J2; `SearchService` deliberately has none |
| Can a new developer understand where new code belongs? | ✅ **Yes** — tier criteria, directory contracts, and a review checklist per document |
| Does the architecture avoid unnecessary boilerplate? | ✅ **Yes** — 4 of 15 modules are 5 flat files; no generic repository, factory, registry or event bus |
| Does it support growth without building prematurely? | ✅ **Yes** — promotion criteria, deferred ports, and named triggers for Redis, Atlas Search and payments |

---

## 23. PHASE 2 CODE ARCHITECTURE HANDOFF

### FINAL ROOT STRUCTURE
```
apps/api/src/{ main.ts, app.module.ts, config/, common/, database/,
               modules/, providers/, templates/email/ }
```
`providers/` = **external vendor SDKs only.** `database/` = connection, transactions, index sync.

### MODULE STRUCTURE STANDARD
**Tier 1 (flat, ~5 files):** content, fulfilment, audit, health  *(4 modules; `brands`/`categories` are flat sub-areas inside the Tier-2 `catalog` module, not standalone modules)*
**Tier 2 (presentation/application/infrastructure):** catalog, users, cart, reviews, media, notifications, search
**Tier 3 (+ domain/):** **orders, inventory, auth, pricing**
Promotion on written criteria. **Demotion permitted and expected** when a layer proves empty.

### DEPENDENCY DIRECTION
`Presentation → Application → Domain`; Infrastructure implements Application ports.
**Forbidden, lint-enforced:** `domain/`→`@nestjs/*`|`mongoose` · `application/`→vendor SDK · `presentation/`→repository|schema · `modules/`→`providers/` · `common/`→`modules/` · `process.env` outside the schema · `HttpException` outside presentation · any cycle.
**Three documented exceptions only.**

### DTO RULES
Tier 1/2: `Request DTO → Service → Response DTO`. Tier 3: `+ Command + Result`.
Command when input exceeds the HTTP request (`userId` from JWT, idempotency key), is transactional, has multiple callers, or computes money.
**Audience separation is structural** — separate classes, never conditional stripping.
`class-validator` with `whitelist` + **`forbidNonWhitelisted`**.

### PORT RULES
Six ports. **J1** (vendor replaceability) or **J2** (rule testable without infrastructure) required.
**`abstract class`**, named `<Capability>Port`, living in the owning module's `application/ports/`.
**Never** a global `interfaces/`. **Consumers call business methods, not ports.**

### PROVIDER RULES
Vendor SDK imports **only** under `src/providers/`. One active provider, conditional `useClass`, **one composition file**.
No registry, no factory class, no failover, no runtime switching.
Ports use application vocabulary; provider ids are **opaque**; vendor errors translated at the boundary.
**Business rules (upload validation, refcounting) stay in the business module** so they survive a swap.

### EMAIL TEMPLATE RULES
`src/templates/email/` — outside `modules/` and `providers/`. Handlebars, logic-less.
**Rendered before the port.** Typed data contract per template; **never** a domain entity.
Money/dates pre-formatted. **Missing variable throws**, in production too. Compiled at boot.

### CONFIGURATION RULES
**One `process.env` read** (`env.schema.ts`), Zod-validated, fail-fast, all errors at once.
Typed namespaces injected. Vendor credentials beside their adapter.
**Business constants are code constants**, not env vars. No feature flags.

### DATABASE ACCESS RULES
Schemas in the owning module. Queries in the service (Tier 1) or a repository (Tier 2/3).
**Repository only when justified. `BaseRepository<T>` forbidden.**
Repository methods **specific and intention-revealing**.
**Documents never leave their module** (`.lean()`). Transactions opened only by application services; **no external calls inside one.**

### TESTING BOUNDARIES
Six levels. Unit/application: fakes, no DB. Infrastructure and above: **real replica set**.
**No vendor in the default suite — credentials absent in CI.**
Fakes must honour port semantics, verified by the shared contract suite.
90% coverage on orders/inventory/pricing/auth; 70% elsewhere.

### ANTI-OVERENGINEERING RULES
No interface-per-class · no generic repository · no factory without multiple strategies · no registry with one provider · no failover · no event bus without fan-out · no microservices · no Redis until multi-instance · no CQRS buses · no speculative ports · no `utils/` · no empty directories · no one-line wrapper services · **no database abstraction.**
**Five-question test:** if "does a second implementation exist?" and "does it enable an impossible test?" are both no — the answer is no.

### ARCHITECTURAL RED FLAGS TO WATCH DURING IMPLEMENTATION
| 🚩 | Meaning |
|---|---|
| `import { Resend }` outside `providers/email/resend/` | The core boundary is broken |
| A vendor type in a port signature | The port is the SDK |
| A business module injecting `EmailSenderPort` / `MediaStoragePort` | Port leaked past its capability module |
| A template under `providers/` | Templates coupled to a vendor |
| `BaseRepository`, `AbstractService`, `IServiceName` | Over-abstraction |
| A `domain/` folder holding only enums | Module mis-tiered — **demote it** |
| `update(id, data)` on a repository | Generic query surface; concurrency semantics hidden |
| A service method that only forwards to a repository | One-line wrapper |
| `process.env` in a service | Config boundary broken |
| `throw new NotFoundException()` in a service | Business logic coupled to HTTP |
| A Mongoose document in a controller return | Document leakage — `costPrice` is one typo away |
| A new env var for a business rule | Should be a code constant |
| "For consistency with the other modules" | **Never a reason** — structure follows complexity |
| A second API instance added without Redis | **Silent security regression** — rate limits multiply by N |

---

## HARD STOP

Phase 1.1 is complete. **No NestJS project was created, no module, service, controller or schema written, no dependency installed, no `.env` file created, no MongoDB/Cloudinary/Resend connection made, and no Next.js or Supabase code modified.**

Awaiting architecture review and approval before Phase 2 implementation begins.
