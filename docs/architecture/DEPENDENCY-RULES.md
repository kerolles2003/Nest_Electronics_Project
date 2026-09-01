# Dependency Rules — Phase 1.1

**Status:** FROZEN pending review · **Date:** 2026-08-30 · **ADR:** ADR-CODE-016

> **Goal: make an architecture violation obvious — ideally to a linter, and always to a reviewer.**
>
> Rules that live only in a document are advisory within two sprints. Every rule here states its enforcement mechanism.

---

## 1. The dependency direction

```
        ┌──────────────────────────────────────────┐
        │            PRESENTATION                  │
        │   controllers · request/response DTOs    │
        └──────────────────┬───────────────────────┘
                           │ may import
                           ▼
        ┌──────────────────────────────────────────┐
        │            APPLICATION                   │
        │  services · commands · results · PORTS   │
        └──────────────────┬───────────────────────┘
                           │ may import
                           ▼
        ┌──────────────────────────────────────────┐
        │              DOMAIN                      │
        │  entities · value objects · rules        │
        │  IMPORTS NOTHING FROM THIS PROJECT       │
        └──────────────────────────────────────────┘
                           ▲
                           │ implements / uses
        ┌──────────────────┴───────────────────────┐
        │           INFRASTRUCTURE                 │
        │  repositories · schemas · adapters       │
        └──────────────────────────────────────────┘
```

Infrastructure sits **below** domain in the diagram but points **upward**: it implements contracts the application declares. That inversion is what keeps business rules free of Mongoose and vendor SDKs.

---

## 2. Layer permission matrix

| From ↓ / May import → | Presentation | Application | Domain | Infrastructure | `common/` | `config/` | Another module | Vendor SDK |
|---|---|---|---|---|---|---|---|---|
| **Presentation** | ✅ own | ✅ own | ✅ types only | ❌ | ✅ | ✅ | ⚠️ public API only | ❌ |
| **Application** | ❌ | ✅ own | ✅ | ❌ (ports only) | ✅ | ✅ | ⚠️ public API only | ❌ |
| **Domain** | ❌ | ❌ | ✅ own | ❌ | ⚠️ primitives only | ❌ | ❌ | ❌ |
| **Infrastructure** | ❌ | ✅ ports + types | ✅ | ✅ own | ✅ | ✅ | ❌ | ⚠️ `providers/` only |

**⚠️ notes**

- *Public API only*: a module may import another module's **exported service and public types** — never its repository, schema, internal service or `infrastructure/` directory.
- *Primitives only*: `domain/` may import `Money` and shared type aliases from `common/`. Nothing else — no decorators, no guards, no DTOs.
- *Vendor SDK*: only under `src/providers/`. Module-local `infrastructure/` imports `mongoose`, never a third-party service SDK.

---

## 3. The forbidden list

Each entry states the rule, why it matters here, and how it is caught.

| # | Forbidden | Why | Enforcement |
|---|---|---|---|
| **F1** | `domain/` → `@nestjs/*` | Domain rules must be unit-testable without a Nest context. The order state machine is a pure function of `(from, to, actor)`. | `no-restricted-imports` |
| **F2** | `domain/` → `mongoose` | Persistence must not shape business rules | `no-restricted-imports` |
| **F3** | `domain/` → any vendor SDK | — | `no-restricted-imports` |
| **F4** | `application/` → a vendor SDK | **The central rule of Phase 1.1.** `AuthService` must never import `resend`. | `no-restricted-imports` |
| **F5** | `application/` → `infrastructure/` | Would invert the dependency and defeat the port | `eslint-plugin-boundaries` |
| **F6** | `presentation/` → a repository or schema | A controller running a query bypasses every business rule | `eslint-plugin-boundaries` |
| **F7** | `presentation/` → `mongoose` | — | `no-restricted-imports` |
| **F8** | `modules/**` → `providers/**` | Business code must not name a vendor adapter. Only `ProvidersModule` may. | `eslint-plugin-boundaries` |
| **F9** | `providers/**` → `modules/*/domain` or `infrastructure` | An adapter may see only the port and its input/output types | `eslint-plugin-boundaries` |
| **F10** | `common/**` → `modules/**` | Inverts the dependency; makes `common/` un-reusable | `eslint-plugin-boundaries` |
| **F11** | Any import cycle | — | `import/no-cycle` |
| **F12** | Cross-module reach-in (`modules/orders/infrastructure/...` from outside) | Breaks encapsulation | `eslint-plugin-boundaries` |
| **F13** | `HttpException` outside `presentation/` | Couples business rules to HTTP ([`CROSS-CUTTING-STANDARDS.md`](./CROSS-CUTTING-STANDARDS.md) §B4) | `no-restricted-imports` |
| **F14** | `process.env` outside `config/env.schema.ts` | Untyped, unvalidated, untestable — the legacy pattern | `no-restricted-properties` |
| **F15** | A Mongoose document type crossing a module boundary | Leaks `costPrice`, `__v`, internal fields | Review + `.lean()` return types |

### F4 in detail — the rule this phase exists for

```ts
// ❌ FORBIDDEN — modules/auth/application/auth.service.ts
import { Resend } from 'resend';

// ✅ CORRECT — the port, owned by NotificationsModule
constructor(private readonly notifications: NotificationsService) {}
await this.notifications.sendEmailVerification(user, token);
```

`AuthService` does not even see `EmailSenderPort` — it calls a business method ([`CODEBASE-STRUCTURE.md`](./CODEBASE-STRUCTURE.md) §5). A grep for `from 'resend'` outside `providers/email/resend/` must return **zero results**, permanently.

---

## 4. Inter-module dependencies

The Phase 1 module graph ([`NESTJS-MODULE-MAP.md`](./NESTJS-MODULE-MAP.md)) is the authority. Code-level rules:

| Rule | Detail |
|---|---|
| **Only declared edges may exist** | A new import between modules requires updating the module map |
| **Import the service, not the internals** | `import { InventoryService } from '@modules/inventory'` — via the module's barrel, never a deep path |
| **Barrel exports define the public API** | Each module has an `index.ts` exporting only its service(s) and public types |
| **Sinks import nothing** | `AuditModule` and `NotificationsModule` may not import any domain module — the structural guarantee against cycles |
| **`OrdersModule` is the composition root** | It has 6 dependencies and **zero dependents**, so its edges cannot create a cycle |

### The one dependency to watch

`ReviewsModule → OrdersModule` (read-only, to determine verified purchase). It is one-directional and `OrdersModule` does not import Reviews, so no cycle exists. **If it ever needs to become bidirectional, use a domain event rather than an import** — an in-process `EventEmitter2` event, not a message broker.

---

## 5. Enforcement configuration

### 5.1 Layer boundaries — `eslint-plugin-boundaries`

```jsonc
{
  "boundaries/elements": [
    { "type": "domain",         "pattern": "src/modules/*/domain/*" },
    { "type": "application",    "pattern": "src/modules/*/application/*" },
    { "type": "infrastructure", "pattern": "src/modules/*/infrastructure/*" },
    { "type": "presentation",   "pattern": "src/modules/*/presentation/*" },
    { "type": "providers",      "pattern": "src/providers/*" },
    { "type": "common",         "pattern": "src/common/*" },
    { "type": "config",         "pattern": "src/config/*" }
  ],
  "boundaries/element-types": [
    { "from": "domain",         "allow": ["domain", "common"] },
    { "from": "application",    "allow": ["application", "domain", "common", "config"] },
    { "from": "infrastructure", "allow": ["infrastructure", "application", "domain", "common", "config"] },
    { "from": "presentation",   "allow": ["presentation", "application", "domain", "common", "config"] },
    { "from": "providers",      "allow": ["providers", "common", "config"] },
    { "from": "common",         "allow": ["common"] }
  ]
}
```

Note `providers` may import `application` **only** for the port it implements — expressed as a narrow allow-list rule, since a blanket `application` permission would let an adapter reach into services.

### 5.2 Restricted imports

```jsonc
// src/modules/*/domain/**
"no-restricted-imports": ["error", { "patterns": ["@nestjs/*", "mongoose", "resend", "cloudinary", "**/infrastructure/**"] }]

// src/modules/**  (application + presentation)
"no-restricted-imports": ["error", { "patterns": ["resend", "cloudinary", "@aws-sdk/*", "nodemailer"] }]

// src/modules/*/presentation/**
"no-restricted-imports": ["error", { "patterns": ["mongoose", "**/infrastructure/**"] }]

// everywhere except src/config/env.schema.ts
"no-restricted-properties": ["error", { "object": "process", "property": "env" }]
```

### 5.3 Path aliases

```jsonc
{ "@common/*": ["src/common/*"], "@config/*": ["src/config/*"],
  "@modules/*": ["src/modules/*"], "@database/*": ["src/database/*"] }
```

Aliases exist for readability **and** enforceability — a lint pattern can match `@modules/orders/infrastructure/*` reliably, where `../../../orders/infrastructure/x` is easy to miss in review.

Deliberately **no `@providers/*` alias**: nothing outside `providers.module.ts` should import from `providers/`, so making it awkward is a feature.

### 5.4 CI

All boundary rules are **errors**, not warnings. A build with an architecture violation fails.

An optional `dependency-cruiser` job renders the actual module graph and diffs it against the Phase 1 map — catching drift that per-file linting cannot see.

---

## 6. Legitimate exceptions

Three, each explicit and bounded.

| # | Exception | Why | Bound |
|---|---|---|---|
| **E1** | `InventoryModule` writes `products.stock`, which lives in a `CatalogModule` document | Availability is read on every product card; a separate collection would force a `$lookup` on the hottest query (ADR-INVENTORY-002) | The product update DTO **rejects** `stock`. Inventory owns a focused repository method, not general product access. |
| **E2** | `ReviewsModule` writes `products.rating` | Same shape as E1 | The product DTO **rejects** `rating` |
| **E3** | `domain/` may import `Money` from `common/` | A shared primitive used by 5 modules ([`CROSS-CUTTING-STANDARDS.md`](./CROSS-CUTTING-STANDARDS.md) §A3) | `Money` only — not decorators, guards or DTOs |

**Exceptions are documented here and nowhere else.** An undocumented exception is a violation. Adding one requires a decision-register entry.

---

## 7. Review checklist

Fast triage for any pull request:

- [ ] Does a `domain/` file import `@nestjs/*` or `mongoose`? → **reject**
- [ ] Does an `application/` file import a vendor SDK? → **reject**
- [ ] Does a controller import a repository or schema? → **reject**
- [ ] Does a module import from `providers/`? → **reject**
- [ ] Does `common/` import from `modules/`? → **reject**
- [ ] Is there a new inter-module import not in the module map? → **update the map or reject**
- [ ] Does a Mongoose document escape its module? → **reject**
- [ ] Is `process.env` read outside the schema? → **reject**
- [ ] Is `HttpException` thrown outside `presentation/`? → **reject**
- [ ] New cycle? → **reject** (CI catches it first)

---

## 8. Summary

| Rule | Enforcement |
|---|---|
| Presentation → Application → Domain | `eslint-plugin-boundaries` |
| Infrastructure implements application ports | `eslint-plugin-boundaries` |
| **Domain imports nothing framework-shaped** | `no-restricted-imports` |
| **Vendor SDKs only in `providers/`** | `no-restricted-imports` |
| **Business modules never import `providers/`** | `eslint-plugin-boundaries` |
| `common/` never imports `modules/` | `eslint-plugin-boundaries` |
| No cycles | `import/no-cycle` |
| `process.env` only in the schema | `no-restricted-properties` |
| `HttpException` only in presentation | `no-restricted-imports` |
| Documents stay in their module | Review + `.lean()` |
| Inter-module edges match the Phase 1 map | Review + `dependency-cruiser` |
| Exceptions | **Three, documented here only** |
