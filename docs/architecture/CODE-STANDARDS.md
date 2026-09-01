# Code & Naming Standards — Phase 1.1

**Status:** FROZEN pending review · **Date:** 2026-08-30 · **ADR:** ADR-CODE-018

> One convention, applied everywhere. The value is not in which convention is chosen but in there being exactly one — inconsistent naming (`emailService.ts` / `Email_Service.ts` / `email.service.ts`) makes files unfindable and diffs noisy.

---

## 1. Files

**Convention: `kebab-case` with a dot-separated type suffix.** This is the NestJS CLI convention and the ecosystem default.

```
✅ email-sender.port.ts     order-placement.service.ts     place-order.dto.ts
❌ emailSender.port.ts      OrderPlacementService.ts       place_order.dto.ts
```

| Artifact | Suffix | Example |
|---|---|---|
| Module | `.module.ts` | `orders.module.ts` |
| Controller | `.controller.ts` | `admin-orders.controller.ts` |
| Service | `.service.ts` | `order-placement.service.ts` |
| Port | `.port.ts` | `email-sender.port.ts` |
| Repository (impl) | `.repository.ts` | `mongo-order.repository.ts` |
| Repository (port) | `.repository.port.ts` | `order.repository.port.ts` |
| Request DTO | `.dto.ts` | `place-order.dto.ts` |
| Response DTO | `.response.dto.ts` | `order.response.dto.ts` |
| Command | `.command.ts` | `place-order.command.ts` |
| Result | `.result.ts` | `placed-order.result.ts` |
| Mongoose schema | `.schema.ts` | `order.schema.ts` |
| Domain entity / VO | *(no suffix)* | `order-number.ts`, `order-state-machine.ts` |
| Enum | `.enum.ts` | `order-status.enum.ts` |
| Error | `.error.ts` | `invalid-transition.error.ts` |
| Guard / Interceptor / Filter / Pipe / Decorator | `.guard.ts` etc. | `roles.guard.ts` |
| Config | `.config.ts` | `email.config.ts` |
| Template data contract | `.data.ts` | `order-shipped.data.ts` |
| Test | `.spec.ts` / `.e2e-spec.ts` | `order-state-machine.spec.ts` |
| Email template | `.hbs` / `.txt.hbs` | `order-shipped.hbs` |

**Domain entities and value objects take no suffix deliberately** — `order-number.ts` exporting `OrderNumber` reads as a concept, not a framework artifact. It also makes domain files visually distinct from infrastructure.

---

## 2. Directories

`kebab-case`, **plural for collections of like things, singular for a concept**:

```
modules/orders/              ← plural: the module owns many orders
  application/ports/         ← plural: many ports
  domain/                    ← singular: one layer
  infrastructure/schemas/    ← plural
templates/email/orders/      ← plural
```

**Module directory names are plural** (`orders`, `products`, `reviews`) except where the concept is uncountable: `auth`, `search`, `pricing`, `inventory`, `content`, `media`, `fulfilment`.

> `fulfilment` uses the British spelling consistently, matching Phase 1 documents. One spelling, chosen once.

---

## 3. Classes, types, and members

| Kind | Convention | Example |
|---|---|---|
| Class | `PascalCase` | `OrderPlacementService` |
| Interface / type alias | `PascalCase`, **no `I` prefix** | `OutboundEmail`, not `IOutboundEmail` |
| Abstract port class | `PascalCase` + `Port` | `EmailSenderPort` |
| Enum | `PascalCase` singular | `OrderStatus` |
| Enum member | `SCREAMING_SNAKE_CASE` | `OrderStatus.DELIVERY_FAILED` |
| Method / property | `camelCase` | `placeOrder`, `grandTotal` |
| Private field | `camelCase`, **no underscore** | `private readonly repo` |
| Constant | `SCREAMING_SNAKE_CASE` | `MAX_QUANTITY_PER_LINE` |
| Type parameter | Single capital or `PascalCase` | `T`, `TResult` |

**No Hungarian prefixes.** `IEmailSender` and `TOrderStatus` are rejected — TypeScript already distinguishes these, and the prefix is noise inherited from C#.

**Enum members are `SCREAMING_SNAKE_CASE` to match the API contract**, where Phase 1 specifies enums serialise as `SCREAMING_SNAKE_CASE` strings. The same token appears in the code, the OpenAPI document and the Flutter client — no mapping layer, no drift.

---

## 4. Method naming

Method names carry intent. These conventions are worth being strict about because they encode the architecture.

| Prefix | Meaning | Returns |
|---|---|---|
| `find…` | Query, may find nothing | `T \| null` |
| `get…` | Query, must exist | `T` or throws `ResourceNotFoundError` |
| `list…` | Query returning many | `T[]` or a paginated result |
| `create…` | Creates | The created entity |
| `update…` | Partial mutation | The updated entity |
| `delete…` / `remove…` | Removes | `void` |
| `is…` / `has…` / `can…` | Predicate | `boolean` |
| `assert…` | Throws if invalid | `void` |
| `execute…` | A use case (Tier 3 command handlers) | A result object |

The `find` / `get` distinction is enforced: a `get…` that returns `null` forces every caller into a null check and eventually one of them forgets.

**Repository methods are specific, never generic:**

```
✅ findActiveBySlug(slug)          decrementStockIfAvailable(id, qty)
   findForUser(userId, orderId)    transitionIfInStatus(id, from, to)
❌ findAll(filter)                 update(id, data)
```

**This is the single most effective guard against a generic repository.** A named, intention-revealing method cannot be reused for an arbitrary query, so the query surface stays visible and reviewable ([`ANTI-OVERENGINEERING.md`](./ANTI-OVERENGINEERING.md) §2).

`decrementStockIfAvailable` also *names the concurrency guarantee* — the conditional `$gte` update that prevents overselling. `update(id, data)` would hide it.

---

## 5. Class member order

```ts
export class OrderPlacementService {
  // 1. static / readonly constants
  // 2. constructor (all DI)
  // 3. public methods — the module's API
  // 4. private methods — helpers, in call order
}
```

Public API before private helpers, so a reader sees what a class *does* before how it does it.

**Constructor injection only.** No property injection, no `@Inject()` where the type suffices, no service locator.

```ts
constructor(
  private readonly orders: OrderRepositoryPort,
  private readonly inventory: InventoryService,
  private readonly pricing: PricingService,
) {}
```

**A constructor with more than five dependencies is a review flag** — usually the service is doing too much and should be split. `OrderPlacementService` is expected to approach this limit legitimately; nothing else should.

---

## 6. Module organisation

Every module has a barrel that defines its public API:

```ts
// modules/inventory/index.ts
export { InventoryModule } from './inventory.module';
export { InventoryService } from './application/inventory.service';
export type { StockLevel } from './domain/stock-level';
// Repositories, schemas and internal services are NOT exported.
```

Cross-module imports use the barrel:

```ts
✅ import { InventoryService } from '@modules/inventory';
❌ import { MongoInventoryRepository } from '@modules/inventory/infrastructure/…';
```

The barrel is what makes rule F12 (no cross-module reach-in) enforceable.

---

## 7. TypeScript

| Setting | Value | Reason |
|---|---|---|
| `strict` | `true` | Non-negotiable |
| `noUncheckedIndexedAccess` | `true` | `arr[0]` is `T \| undefined` — catches a real class of bug |
| `exactOptionalPropertyTypes` | `true` | Distinguishes "absent" from "explicitly undefined" |
| `noImplicitOverride` | `true` | Matters with abstract-class ports |
| `noUnusedLocals` / `noUnusedParameters` | `true` | — |

**Rules:**

- **No `any`.** Use `unknown` and narrow. A justified `any` needs an inline comment.
- **No non-null assertion (`!`)** except in tests. Narrow instead.
- **Prefer `type` for data shapes, `interface` for contracts** meant to be implemented.
- **`readonly` by default** on DTO and result properties.
- **Explicit return types on all public methods** — inference is fine internally, but a public signature is a contract and should not change silently.

---

## 8. Async

- **`async`/`await` only** — no raw `.then()` chains.
- **Always `await` or explicitly return a promise.** A floating promise is a lint error (`no-floating-promises`).
- **`Promise.all` for genuinely independent work.** Phase 0 found sequential awaits where parallel was possible (`blog/page.tsx` ran three sequential queries).
- **No `async` on a function that never awaits.**

---

## 9. Imports

Ordered, with blank lines between groups:

```ts
// 1. Node built-ins
import { randomUUID } from 'node:crypto';

// 2. External packages
import { Injectable } from '@nestjs/common';

// 3. Path-aliased internal
import { Money } from '@common/money/money';
import { InventoryService } from '@modules/inventory';

// 4. Relative (same module only)
import { OrderRepositoryPort } from '../ports/order.repository.port';
```

**Relative imports never cross a module boundary.** `../../catalog/...` is a lint error — cross-module always uses `@modules/<name>`, which is what makes boundary rules matchable.

**Type-only imports use `import type`** so they are erased at compile time and cannot create a runtime cycle.

---

## 10. Comments

**Comment *why*, never *what*.**

```ts
// ❌ increment the stock
stock.onHand += qty;

// ✅ Restore stock on cancellation. Idempotent via the unique index on
// {reference.id, productId, type} — a retried cancellation fails the
// constraint rather than inflating stock. See INVENTORY-MODEL.md §5.2.
```

- **JSDoc on every port method** — it is a contract others implement.
- **JSDoc on non-obvious business rules**, with a link to the architecture document.
- **No commented-out code.** Git remembers.
- **No `TODO` without an issue reference.** Phase 0 found a `pino` TODO that survived the entire project lifetime.

---

## 11. Formatting

Prettier owns formatting; ESLint owns correctness. No manual style debates.

```jsonc
{ "semi": true, "singleQuote": true, "trailingComma": "all",
  "printWidth": 100, "tabWidth": 2, "arrowParens": "always",
  "endOfLine": "lf" }
```

`endOfLine: "lf"` is explicit because development happens on Windows — Phase 1.1 file operations already surfaced CRLF warnings. Mixed line endings produce diffs where nothing changed.

---

## 12. Size guidelines

Guidelines, not hard limits — but crossing one prompts a question.

| Artifact | Guideline | If exceeded |
|---|---|---|
| File | ~300 lines | Split by responsibility |
| Class | ~200 lines | Probably more than one responsibility |
| Method | ~40 lines | Extract private helpers |
| Constructor params | ≤ 5 | The class is doing too much |
| Nesting depth | ≤ 3 | Early returns, guard clauses |
| Module | ~15 files | Consider whether it is two modules |

> For calibration: Phase 0 found `ProductTable.tsx` at 837 lines, `ProductForm.tsx` at 770, and `InventoryTable.tsx` at 633 — each a single client component. Those are the outcomes these guidelines exist to prevent.

---

## 13. Anti-patterns

| ❌ Avoid | ✅ Instead |
|---|---|
| `IEmailSender` | `EmailSenderPort` |
| `utils.ts`, `helpers.ts`, `misc.ts` | A named module or a named `common/` directory |
| `data`, `info`, `obj`, `temp`, `res` | Names that say what the value is |
| `manager`, `handler`, `processor` in a class name | A verb-noun that names the responsibility |
| Boolean parameters (`save(order, true)`) | Named options or separate methods |
| Deep nesting | Guard clauses and early returns |
| `_privateField` | `private readonly field` |
| Barrel files re-exporting everything | Barrels export only the public API |
| Default exports | Named exports — greppable, refactor-safe |
| `enum` for two states | A union type or boolean |

---

## 14. Summary

| Aspect | Standard |
|---|---|
| Files | `kebab-case.type.ts` |
| Directories | `kebab-case`, plural for collections |
| Classes / types | `PascalCase`, **no `I` prefix** |
| Enum members | `SCREAMING_SNAKE_CASE` — matches the API contract exactly |
| Methods | `camelCase`, with a strict `find`/`get` distinction |
| Repository methods | **Specific and intention-revealing**, never generic |
| Constants | `SCREAMING_SNAKE_CASE` |
| DI | **Constructor only**, ≤ 5 dependencies |
| Module API | Barrel exports; no cross-module reach-in |
| TypeScript | `strict` + `noUncheckedIndexedAccess`; **no `any`** |
| Imports | Grouped; `@modules/*` across boundaries, relative within |
| Comments | **Why, not what**; JSDoc on ports and business rules |
| Formatting | Prettier, `printWidth: 100`, `endOfLine: lf` |
| Exports | **Named only** |
