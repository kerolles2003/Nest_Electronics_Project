# Phase 1.1 Decision Register — Code Architecture

**Status:** FROZEN pending review · **Date:** 2026-08-30

Code architecture decisions only. Phase 1 business decisions are not reopened; where Phase 1.1 clarifies a Phase 1 statement, it is recorded in §ADR-CODE-019.

---

## ADR-CODE-001 — Root structure: `config` · `common` · `database` · `modules` · `providers` · `templates`

| | |
|---|---|
| **Context** | The brief proposed `config`, `common`, `modules`, `providers`, `templates` and asked for evaluation rather than acceptance. |
| **Problem** | Where do the MongoDB connection, the transaction helper and the index-sync step live? They are cross-module infrastructure owned by no domain. |
| **Options** | (A) accept the proposal as-is and put them in `common/` · (B) put them in a module · (C) **add a root `database/`** |
| **Chosen** | **C** |
| **Reason** | `TransactionService` is used by `orders` and `inventory` and belongs to neither. Putting it in `common/` would blur `common/` into "infrastructure plus utilities" — the first step toward the dumping ground the brief warns about. Index synchronisation spans every collection. |
| **Trade-off** | One more root directory. Accepted: it is small, explicitly scoped, and prevents `common/` drift. |
| **Revisit** | If `database/` grows beyond connection, transactions and index/seed scripts, something has been misplaced. |

---

## ADR-CODE-002 — `providers/` is scoped to external vendor SDKs only

| | |
|---|---|
| **Problem** | A root `providers/` invites a slide into "anything that talks to something else", especially persistence. |
| **Options** | (A) all infrastructure under `providers/` · (B) **vendors only; persistence stays module-local** |
| **Chosen** | **B** — *a directory belongs under `providers/` if and only if it imports a third-party vendor SDK for a capability that could realistically be swapped.* |
| **Reason** | Persistence is not honestly swappable (ADR-CODE-004) and each schema is owned by exactly one module. Mixing Mongoose repositories with vendor adapters would destroy the property that makes `providers/` valuable: **grep it and you see every vendor coupling in the system.** |
| **Trade-off** | "Infrastructure" is split across two places. Accepted — the split is by *replaceability*, which is the axis that matters. |
| **Revisit** | Never expected. |

---

## ADR-CODE-003 — Three module tiers, promoted on explicit criteria

| | |
|---|---|
| **Problem** | Four layers for every module would give `BrandsModule` (17 rows, pure CRUD) the same ceremony as `OrdersModule` (transactional state machine). The brief explicitly forbids this. |
| **Options** | (A) uniform 4 layers · (B) uniform flat · (C) **tiers with promotion criteria** |
| **Chosen** | **C** — Tier 1 flat (5 files) · Tier 2 three layers · Tier 3 full four layers. Tier 3 = `orders`, `inventory`, `auth`, `pricing`. |
| **Reason** | Structure should be proportional to complexity. The four Tier 3 modules each own something Phase 0.5 proved dangerous when scattered: the transition matrix, the stock/ledger invariant, credentials, and money. Isolating each in a `domain/` layer that imports nothing framework-shaped makes those rules unit-testable in milliseconds. |
| **Trade-off** | Modules look different from one another, which can read as inconsistency. Mitigated by **written promotion criteria** — the tier is derivable, not arbitrary. |
| **Revisit** | Promotion when criteria are met; **demotion when a `domain/` folder holds only enums.** Demotion is explicitly permitted and is the honest test of the discipline. |

---

## ADR-CODE-004 — MongoDB is not abstracted behind a portability port

| | |
|---|---|
| **Problem** | Should a `DatabasePort` exist so the database could be replaced? |
| **Options** | (A) generic `DatabasePort` · (B) generic `BaseRepository<T>` · (C) **no portability abstraction; three testability ports** |
| **Chosen** | **C** |
| **Reason** | Phase 1's model is MongoDB-specific — embedded order items, materialised `path[]`, multikey `specs[]`, `$facet`, conditional `$inc` as the overselling guard, multi-document transactions. None survives a move to a relational store without redesign. A port promising portability would be **dishonest abstraction**: ceremony on every query, plus pressure toward a lowest-common-denominator surface that loses the constructs the design depends on. |
| **Trade-off** | Database migration would be a rewrite. Accepted and stated openly ([`REPLACEMENT-TESTS.md`](./REPLACEMENT-TESTS.md) §3). |
| **Revisit** | Never for portability. Repository ports exist for **testability**, and that distinction should be restated whenever this resurfaces in review. |

---

## ADR-CODE-005 — DTO pipeline is tiered, not uniform

| | |
|---|---|
| **Problem** | Request → Command → domain → Result → Response for every endpoint is five artifacts for `GET /brands`. |
| **Chosen** | Tier 1/2 collapse to `Request DTO → Service → Response DTO`. Tier 3 uses the full pipeline. |
| **Reason** | The Command earns its place when input includes data **not in the HTTP request** — `userId` from the JWT, `Idempotency-Key` from a header. That is a direct structural answer to F-CRIT-2, where legacy `create_order_v2` accepted `p_user_id` and never compared it to the caller. A reviewer sees the whole trust boundary by reading `PlaceOrderDto` beside `PlaceOrderCommand`. |
| **Trade-off** | Two patterns to learn. Accepted — the trigger conditions are written down. |

---

## ADR-CODE-006 — `class-validator` for DTOs; Zod for configuration

| | |
|---|---|
| **Problem** | The project already uses Zod. Should DTOs use Zod too? |
| **Options** | (A) Zod everywhere via `nestjs-zod` · (B) `class-validator` everywhere · (C) **`class-validator` for DTOs, Zod for config** |
| **Chosen** | **C** |
| **Reason** | `@nestjs/swagger` generates the OpenAPI document from the same decorated classes that validate at runtime — and that document generates the **Flutter client**. Phase 1 requires documentation that cannot drift from behaviour; this is the mechanism. Configuration has no OpenAPI dimension, so Zod's type inference wins there. |
| **Trade-off** | Two validation libraries. Accepted: each is confined to one clearly-bounded role, which is cheaper than forcing one into a role it fits poorly. |
| **Revisit** | If `nestjs-zod` gains first-class Swagger generation of equal fidelity. |

---

## ADR-CODE-007 — Ports are abstract classes, not interfaces

| | |
|---|---|
| **Problem** | TypeScript interfaces do not exist at runtime, so a NestJS provider cannot be keyed on one. |
| **Options** | (A) `interface` + `Symbol` token · (B) `interface` + string token · (C) **`abstract class`** |
| **Chosen** | **C** |
| **Reason** | One artifact serves as both type and DI token. Consumers use ordinary constructor injection with no `@Inject()`. There is no token registry to drift, and a whole class of "token not found" runtime errors disappears. |
| **Trade-off** | An abstract class is nominally a class, which purists dislike in a domain-adjacent layer. Accepted for a NestJS codebase. |

---

## ADR-CODE-008 — Six ports, each individually justified

| | |
|---|---|
| **Problem** | "Interface for everything" is explicitly forbidden; where is the line? |
| **Chosen** | A port requires **J1** (vendor replaceability), **J2** (business rule testable without infrastructure) or **J3** (genuine simultaneous polymorphism). J3 applies nowhere. Result: `EmailSenderPort`, `MediaStoragePort`, `TemplateRendererPort`, and repository ports for `orders`, `inventory`, `pricing`. |
| **Reason** | The three repository ports exist so the transition matrix, stock guard and coupon ladder can be unit-tested in milliseconds against in-memory fakes. Concurrency and transaction assertions still run against real MongoDB. |
| **Notable rejection** | `SearchService` has **no** port despite a planned `$text` → Atlas Search migration, because that change is contained inside one service — both engines never coexist, and the service itself must be tested against real MongoDB to verify index usage. |
| **Revisit** | Per-port, when a justification appears. |

---

## ADR-CODE-009 — One active provider, selected by a conditional `useClass`

| | |
|---|---|
| **Problem** | How is provider replaceability delivered without building multi-provider infrastructure? |
| **Options** | (A) registry `Map<string, Provider>` · (B) factory class · (C) **conditional `useClass` in `ProvidersModule`** · (D) failover chain |
| **Chosen** | **C** |
| **Reason** | The requirement is replaceability, not simultaneity. A conditional `useClass` delivers it completely in one file — which becomes the only file in the codebase naming both a port and a vendor. A registry implies runtime selection that never happens and defers a compile-time error to a runtime lookup failure. |
| **Trade-off** | Switching requires a redeploy. Correct for a change of this magnitude. |
| **Revisit** | Only if two providers must genuinely run at once. |

---

## ADR-CODE-010 — Consumers call business methods, never ports

| | |
|---|---|
| **Problem** | Should `AuthModule` inject `EmailSenderPort` directly? |
| **Chosen** | **No.** `AuthModule` calls `NotificationsService.sendEmailVerification(...)`. The port sits one module deeper. Likewise `CatalogModule` calls `MediaService.uploadProductImage(...)`. |
| **Reason** | If Auth injected the port, it would own subjects, recipients and templates — so a change in email *semantics* (a provider requiring pre-registered template ids) would ripple into authentication. Keeping the port inside its capability module means the blast radius of any email change is exactly one module. Validated in [`REPLACEMENT-TESTS.md`](./REPLACEMENT-TESTS.md) §1: **zero business modules change** on a provider swap. |
| **Trade-off** | One extra hop. Negligible against the containment it buys. |

---

## ADR-CODE-011 — Templates live at `src/templates/email/`

| | |
|---|---|
| **Problem** | Templates under `providers/resend/` would be coupled to a vendor; in a vendor dashboard they would be un-versioned and lost on a switch. |
| **Options** | (A) provider directory · (B) vendor dashboard · (C) `modules/notifications/templates/` · (D) **root `src/templates/email/`** |
| **Chosen** | **D** |
| **Reason** | Three practical arguments over C: templates are **content** most likely to be edited by someone not touching business logic; they are **cross-domain** (order emails span Orders and Fulfilment); and they are **build assets** needing an explicit copy step, which one root path makes a one-line rule. Template *selection* and data contracts stay in `NotificationsModule`. |
| **Trade-off** | Content is separated from the module that uses it. Accepted — the typed data contract keeps them coupled where it matters (a renamed field is a compile error). |

---

## ADR-CODE-012 — Handlebars, rendered before the port, throwing on missing variables

| | |
|---|---|
| **Options** | Handlebars · React Email · MJML · TS template literals · provider-hosted |
| **Chosen** | **Handlebars**, with MJML deferred |
| **Reason** | **Logic-less by design** — a developer cannot express "if total > X show free-shipping copy" in the template, so that decision must move into `NotificationsService` where it is testable. Given Phase 0.5 found business rules scattered across five layers including presentation, a template engine that *cannot* hold logic is a structural guard. Editable by anyone who knows HTML; layouts and partials are native; no build step. |
| **Second decision** | **Rendering completes before `EmailSenderPort.send()`** — the port receives HTML, never a template reference. This is what makes "0 templates change on a provider swap" true. |
| **Third decision** | **A missing variable throws**, in production too. Handlebars' silent-empty default would send *"Your order  has shipped"*. A missed email is recoverable; a garbled one sent to every customer is not. |
| **Revisit** | MJML if cross-client rendering defects appear. A format change rewrites all 14 templates ([`REPLACEMENT-TESTS.md`](./REPLACEMENT-TESTS.md) §4) — bounded, but real work. |

---

## ADR-CODE-013 — Configuration: one `process.env` read, Zod-validated at boot

| | |
|---|---|
| **Context** | Phase 0 found `packages/config/src/env.ts` implementing exactly this — and **imported nowhere**, so it never ran. Meanwhile `NEXT_PUBLIC_SUPABASE_URL` was read directly in five files. |
| **Chosen** | `env.schema.ts` is the only file reading `process.env`. Fail-fast at boot reporting **every** error. Typed namespaces injected; never global lookup. Vendor credentials live in the provider's own config, read only by that adapter. |
| **Reason** | A validation module nothing imports is worse than none — it creates the appearance of safety. Here validation runs in `ConfigModule` and the application cannot start without it. |
| **Trade-off** | More ceremony than `process.env.X`. That is the point. |
| **Related** | Business constants (max quantity 99, bcrypt rounds, TTLs) are **code constants**, not env vars — changing a business rule should require review and tests. |

---

## ADR-CODE-014 — `common/` admits only what 3+ modules use with no domain meaning

| | |
|---|---|
| **Problem** | `common/` is the directory that rots fastest. |
| **Chosen** | Both conditions required. **No `utils/` directory** — named directories only. `common/` may never import from `modules/`. |
| **Documented exception** | **`Money`** is domain-meaningful but admitted, because it is used by five modules and placing it in any one would create dependency edges absent from the Phase 1 graph (`catalog → pricing`). It is a **primitive** — integer plus currency with arithmetic. The rules that *use* money stay in `PricingModule`. |
| **Reason for recording the exception** | So it does not become a precedent. `OrderStatus`, `CouponType` and `StockLevel` stay in their modules. |

---

## ADR-CODE-015 — Business errors never know about HTTP

| | |
|---|---|
| **Chosen** | `AppError` → `DomainError` / `ApplicationError` / `InfrastructureError`, each carrying a stable `ErrorCode`. `HttpException` is forbidden outside `presentation/`. `AllExceptionsFilter` is the only translator. |
| **Reason** | Phase 1 requires order cancellation callable from a customer route and an admin route with different guards — the same domain error must serve both. It also separates **business rejections** (4xx, logged `info`, not sent to Sentry) from **infrastructure faults** (5xx, logged `error`, sent to Sentry). That separation is the direct lesson of the tracking-number defect, where legacy's `EXCEPTION WHEN OTHERS` collapsed a genuine fault into the same shape as a business rejection and hid it for months. |

---

## ADR-CODE-016 — Dependency rules are lint-enforced, not documented

| | |
|---|---|
| **Problem** | Documented-only rules become advisory within two sprints. |
| **Chosen** | `eslint-plugin-boundaries` for layer direction · `no-restricted-imports` for vendor SDKs, `@nestjs/*` and `mongoose` in `domain/`, and `HttpException` outside presentation · `no-restricted-properties` for `process.env` · `import/no-cycle`. **All errors in CI.** |
| **Key rule** | A grep for `from 'resend'` outside `providers/email/resend/` must return zero results, permanently. |
| **Exceptions** | Exactly three, documented in one place ([`DEPENDENCY-RULES.md`](./DEPENDENCY-RULES.md) §6). An undocumented exception is a violation. |

---

## ADR-CODE-017 — No test in the default suite touches a real vendor

| | |
|---|---|
| **Chosen** | Six levels: unit · application (fake ports) · infrastructure (real replica set) · integration · e2e · **contract**. Vendor credentials are **absent in CI**, so a test needing one fails rather than silently reaching the network. |
| **Reason** | Makes the guarantee structural rather than aspirational. |
| **Highest-value suites** | Transition matrix (unit) · no-oversell under concurrency (infrastructure) · **authorization matrix (e2e)** — the direct replacement for RLS and the only credible evidence Phase 0 risk R2 is discharged. |
| **Gate** | The transaction-rollback test must pass in **every** environment before any domain module is written. |
| **Fake rule** | A fake must honour its port's semantics — verified by running the same contract suite against fakes and real adapters. A permissive fake produces green tests and a broken deployment. |

---

## ADR-CODE-018 — Naming: `kebab-case.type.ts`, no `I` prefix, specific repository methods

| | |
|---|---|
| **Chosen** | NestJS CLI convention throughout. `SCREAMING_SNAKE_CASE` enum members to match the API contract exactly, so the same token appears in code, OpenAPI and the Flutter client with no mapping. |
| **Most consequential sub-rule** | **Repository methods are specific and intention-revealing** — `decrementStockIfAvailable`, never `update(id, data)`. A named method cannot be reused for an arbitrary query, so the query surface stays visible; and it *names the concurrency guarantee* rather than hiding it. This is the most effective structural guard against a generic repository. |

---

## ADR-CODE-019 — Phase 1 clarifications, not changes

| | |
|---|---|
| **Context** | Phase 1 described `MediaModule` as performing "Cloudinary upload/destroy" and `NotificationsModule` as depending on "an email provider" — written before code placement existed. |
| **Chosen** | Record clarifications; change no decision. Appended as §10 of [`NESTJS-MODULE-MAP.md`](./NESTJS-MODULE-MAP.md). |
| **The three clarifications** | (1) Capabilities stay with modules; **vendor SDKs move to `src/providers/`**. (2) Consumers call business methods, not ports. (3) Email templates live at `src/templates/email/`, outside both `modules/` and `providers/`. |
| **One naming refinement** | The `MediaStoragePort` uses `assetId`/`version` rather than Phase 1's persisted `publicId`/`version`, because "publicId" is Cloudinary vocabulary and a port must not speak a vendor's language. **The persisted field names in [`MEDIA-MODEL.md`](./MEDIA-MODEL.md) are unchanged**; mapping is one line in the media repository. |
| **What did NOT change** | Module list, module responsibilities, dependency graph, sinks, no-`AdminModule`, one-writer-per-field, and every business rule. |

---

## Open decisions

| ID | Question | Blocks | Default until answered |
|---|---|---|---|
| **OPEN-1.1-A** | Handlebars vs MJML for email layout | Nothing | **Handlebars.** Revisit on measured cross-client rendering defects. |
| **OPEN-1.1-B** | Should `SearchModule` get a port when Atlas Search arrives? | Nothing | **No port.** Revisit only if both engines must coexist during migration. |
| **OPEN-1.1-C** | Does `CatalogModule` eventually split into `products` / `taxonomy`? | Nothing | **One module.** Split if it exceeds ~15 files or categories/brands grow rules of their own. |
| **OPEN-1.1-D** | In-process `EventEmitter2` for `Reviews → Orders` if it becomes bidirectional | Nothing | **Direct read-only call.** Event only if the edge must reverse. |
| **OPEN-1.1-E** | Formal `ClockPort` vs an injected `now()` function | Nothing | **Injected function.** A port is more ceremony than the problem warrants. |

None blocks Phase 2.

---

## Decision summary

| # | Decision |
|---|---|
| 001 | Root: `config` · `common` · **`database`** · `modules` · `providers` · `templates` |
| 002 | `providers/` = **external vendor SDKs only** |
| 003 | **Three module tiers** with promotion *and demotion* criteria |
| 004 | **No database portability abstraction** — repository ports are for testability |
| 005 | **Tiered DTO pipeline**; Command where input exceeds the HTTP request |
| 006 | `class-validator` for DTOs (drives OpenAPI → Flutter), Zod for config |
| 007 | Ports are **abstract classes** |
| 008 | **Six ports**, each justified by J1 or J2 |
| 009 | **One active provider**, conditional `useClass`, one file |
| 010 | **Consumers call business methods, never ports** |
| 011 | Templates at **`src/templates/email/`** |
| 012 | **Handlebars**, rendered **before** the port, **throws** on missing variables |
| 013 | **One `process.env` read**, Zod-validated, fail-fast |
| 014 | `common/`: **3+ modules AND no domain meaning**; `Money` a recorded exception |
| 015 | **Business errors never know HTTP** |
| 016 | Dependency rules **lint-enforced in CI** |
| 017 | **No vendor in the default test suite**; credentials absent in CI |
| 018 | `kebab-case.type.ts`; **specific repository method names** |
| 019 | Phase 1 **clarified, not changed** |
