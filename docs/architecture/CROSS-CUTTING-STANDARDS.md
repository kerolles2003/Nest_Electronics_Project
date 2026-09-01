# Cross-Cutting Standards & Error Architecture — Phase 1.1

**Status:** FROZEN pending review · **Date:** 2026-08-30 · **ADR:** ADR-CODE-014, 015

> Covers Part 9 (`src/common/`) and Part 10 (error and exception architecture) of the Phase 1.1 brief.

---

# PART A — `src/common/`

## A1. The admission rule

> **A file may live in `common/` only if it is used by three or more modules AND carries no domain meaning.**

Both conditions. Together they prevent the two failure modes:

- **Fewer than three consumers** → premature generalisation. Two modules sharing a helper should duplicate it or, if genuinely identical, one should own it and export it.
- **Carries domain meaning** → `common/` becomes a second, unowned domain layer. `OrderStatus` used by three modules still belongs to `OrdersModule`.

The rule is deliberately strict because `common/` is the directory that rots fastest. Its failure mode is well known: it starts as five useful decorators and becomes `common/utils/helpers.ts` containing 400 lines nobody dares delete.

---

## A2. Structure

```
src/common/
├── decorators/
│   ├── public.decorator.ts           # @Public()
│   ├── roles.decorator.ts            # @Roles('ADMIN')
│   ├── current-user.decorator.ts     # @CurrentUser()
│   └── idempotency-key.decorator.ts  # @IdempotencyKey()
│
├── guards/
│   ├── jwt-auth.guard.ts             # global via APP_GUARD
│   └── roles.guard.ts
│
├── interceptors/
│   ├── transform.interceptor.ts      # { data, meta } envelope
│   ├── request-id.interceptor.ts
│   └── logging.interceptor.ts
│
├── filters/
│   └── all-exceptions.filter.ts      # the ONLY error→HTTP translator
│
├── pipes/
│   └── parse-object-id.pipe.ts
│
├── errors/
│   ├── app-error.ts                  # base class
│   ├── error-code.enum.ts            # the stable code catalogue
│   └── common-errors.ts              # NotFound, Forbidden, Validation…
│
├── dto/
│   ├── pagination-query.dto.ts
│   ├── paginated-response.dto.ts
│   ├── money.dto.ts
│   └── id-param.dto.ts
│
├── money/
│   ├── money.ts                      # the Money value object
│   └── money.spec.ts
│
└── types/
    ├── authenticated-user.type.ts
    └── locale.type.ts
```

**Note there is no `utils/`.** See §A4.

---

## A3. What belongs, and what does not

| Category | Belongs in `common/` | Stays module-local |
|---|---|---|
| **Decorators** | `@Public`, `@Roles`, `@CurrentUser` — used by every controller | `@RequireOrderOwnership` — one module |
| **Guards** | `JwtAuthGuard`, `RolesGuard` | `OrderOwnershipGuard` — needs `OrderRepositoryPort` |
| **Interceptors** | Response envelope, request id, logging | `AuditInterceptor` — belongs to `AuditModule` |
| **Filters** | `AllExceptionsFilter` — one global translator | none |
| **Pipes** | `ParseObjectIdPipe` | Domain-specific parsing |
| **Errors** | `AppError` base + generic subclasses | `InvalidOrderTransitionError`, `InsufficientStockError` |
| **DTOs** | Pagination, `MoneyDto`, id params | Every request/response DTO |
| **Value objects** | `Money` — used by pricing, orders, cart, catalog, users (5) | `OrderNumber` — one module |
| **Types** | `AuthenticatedUser`, `Locale` | Domain types |

### The `Money` judgement call

`Money` is domain-meaningful, which by §A1 should exclude it. It is admitted anyway, deliberately:

- It is used by `pricing`, `orders`, `cart`, `catalog`, `users` — five modules.
- Placing it in any one of them would force the other four to import a module they otherwise do not depend on, creating edges that do not exist in the Phase 1 dependency graph (`catalog` importing `pricing`, for instance).
- It is a **primitive** — integer plus currency code, with arithmetic — not a business rule. The business rules that *use* money (the total formula, discount clamping, rounding) stay in `PricingModule`.

**This exception is recorded explicitly so it does not become a precedent.** `Money` is in `common/` because it is a shared primitive with no behaviour beyond arithmetic. `OrderStatus`, `CouponType` and `StockLevel` are not, and stay in their modules.

---

## A4. Why there is no `common/utils/`

> **A `utils/` directory is a naming failure, not a category.**

Every function has a real home. If a function does not obviously belong somewhere, that is information: it is either misplaced or badly named.

| Instead of `utils/` | Put it in |
|---|---|
| `formatMoney` | `common/money/money.ts` as a method |
| `slugify` | `modules/catalog/` — slug rules are catalogue rules |
| `normalizePhone` | `common/` **only if** three modules need it; otherwise `modules/users/` |
| `generateOrderNumber` | `modules/orders/domain/order-number.ts` |
| Date formatting | `common/` if genuinely shared; usually a template helper |

If a genuinely generic helper emerges with three consumers and no domain meaning, it gets a **named directory** (`common/text/`, `common/dates/`) — never `utils/`.

---

## A5. `common/` review checklist

- [ ] Three or more modules use it (name them)
- [ ] No domain meaning
- [ ] Not framework-specific in a way that fights `@nestjs/*`
- [ ] Has a named directory, not `utils/` or `helpers/`
- [ ] Has a test
- [ ] If it is domain-meaningful, is there an explicit, recorded exception?

---

# PART B — Error architecture

## B1. The rule

> **Business code throws business errors. Only the presentation boundary knows about HTTP.**

```
Domain / Application            throws  InvalidOrderTransitionError
        ↓                               (extends AppError, has an ErrorCode)
Infrastructure                  throws  EmailTransportError, MongoWriteError
        ↓
AllExceptionsFilter             maps    AppError → HTTP status + response envelope
        ↓                               unknown  → 500 INTERNAL_ERROR
HTTP Response                           { error: { code, message, requestId, timestamp } }
```

A service that throws `new NotFoundException()` from `@nestjs/common` has coupled a business rule to HTTP. It cannot then be called from a scheduled job, another service, or a test without dragging transport semantics along. Phase 1 requires that Orders be callable from both a customer route and an admin route with different guards — the same domain error must serve both.

---

## B2. Error taxonomy

```
Error
└── AppError (abstract)                 code, message, details?, cause?
    ├── DomainError                     a business rule was violated
    │   ├── InvalidOrderTransitionError
    │   ├── InsufficientStockError
    │   ├── ProductUnavailableError
    │   ├── CouponNotApplicableError
    │   └── CartEmptyError
    │
    ├── ApplicationError                a use case cannot proceed
    │   ├── ResourceNotFoundError
    │   ├── ConflictError               (concurrent modification, duplicate key)
    │   ├── ForbiddenError
    │   └── ValidationError
    │
    └── InfrastructureError             an external dependency failed
        ├── EmailTransportError
        ├── MediaStorageError
        ├── TransactionFailedError
        └── DatabaseUnavailableError
```

Every `AppError` carries an `ErrorCode` from the stable catalogue in [`API-STANDARDS.md`](./API-STANDARDS.md) §2 — the values the Flutter client switches on.

| Layer | Throws | Never throws |
|---|---|---|
| **Domain** | `DomainError` | Anything from `@nestjs/common`; anything HTTP-shaped |
| **Application** | `DomainError`, `ApplicationError` | HTTP exceptions |
| **Infrastructure** | `InfrastructureError` (translated from vendor/driver errors) | Vendor error types escaping the boundary |
| **Presentation** | Nothing — it catches nothing and lets the filter work | — |

---

## B3. Translation

`AllExceptionsFilter` is the **only** place an error becomes an HTTP status.

| Error class | Status | Logged at |
|---|---|---|
| `ValidationError` | 400 | `info` |
| `UnauthenticatedError` | 401 | `info` |
| `ForbiddenError` | 403 | `warn` |
| `ResourceNotFoundError` | 404 | `info` |
| `ConflictError`, `InvalidOrderTransitionError`, `InsufficientStockError` | 409 | `info` |
| `DomainError` (other) | 422 | `info` |
| `RateLimitError` | 429 | `warn` |
| `InfrastructureError` | 503 | **`error`** + Sentry |
| Anything else | 500 | **`error`** + Sentry |

Two properties this delivers:

**Business rejections are not errors.** `OUT_OF_STOCK` is normal operation and is logged at `info`, not sent to Sentry. This is the direct lesson of the Phase 0.5 tracking-number defect: legacy's `EXCEPTION WHEN OTHERS` collapsed a genuine fault (a missing column) into the same `{success:false}` shape as a business rejection, so a real bug hid inside a stream of soft failures for months.

**Nothing internal escapes.** Phase 1 forbids any driver message, stack trace, collection name or index name reaching a client ([`API-STANDARDS.md`](./API-STANDARDS.md) §3) — legacy leaked raw PostgREST text in ~20 places. The filter emits only the code, a safe message, and the `requestId` that links the client's screenshot to full server-side detail.

---

## B4. Rules

| # | Rule |
|---|---|
| 1 | **Never throw `HttpException` or its subclasses outside `presentation/`** — lint-enforced |
| 2 | **Never `catch` an error only to rethrow it unchanged** — noise |
| 3 | **Translate at boundaries.** A Mongo duplicate-key error becomes `ConflictError` in the repository; a Resend failure becomes `EmailTransportError` in the adapter |
| 4 | **Preserve the cause.** `new ConflictError(code, msg, { cause: err })` — logged, never serialised to a client |
| 5 | **Error messages are for humans and may change.** `code` is the contract |
| 6 | **No error message contains user input** — avoids reflected-content issues and log injection |
| 7 | **Domain errors carry structured detail** where the client needs it: `InsufficientStockError` includes `{ sku, requested, available }` |

---

## B5. Where error classes live

| Error | Location |
|---|---|
| `AppError`, `ErrorCode`, generic subclasses | `common/errors/` |
| Domain errors (Tier 3) | `modules/<m>/domain/errors/` |
| Domain errors (Tier 1/2) | `modules/<m>/<m>.errors.ts` |
| Infrastructure errors for a port | Beside the port, in the owning module |

Proportionality again: `OrdersModule` earns an `errors/` directory; `BrandsModule` gets one file, or simply uses `ResourceNotFoundError` from `common/`.

---

# PART C — Cross-cutting mechanics

## C1. Global registration

Registered once in `app.module.ts` / `main.ts`:

| Mechanism | Registration | Purpose |
|---|---|---|
| `JwtAuthGuard` | `APP_GUARD` | **Auth global by default**; `@Public()` opts out |
| `RolesGuard` | `APP_GUARD` | Role enforcement |
| `ThrottlerGuard` | `APP_GUARD` | Rate limiting |
| `ValidationPipe` | `APP_PIPE` | `whitelist` + `forbidNonWhitelisted` |
| `AllExceptionsFilter` | `APP_FILTER` | The single error translator |
| `TransformInterceptor` | `APP_INTERCEPTOR` | Response envelope |
| `RequestIdInterceptor` | `APP_INTERCEPTOR` | Correlation |

**Auth is global by default and opts out**, never the reverse — forgetting the decorator makes a route *inaccessible*, not *unprotected*. Legacy's admin `/api/*` handlers relied on a route matcher with no in-handler check, so a matcher regression would have silently exposed them (M6).

## C2. Ordering

```
Request  → RequestId → Logging → Throttler → JwtAuth → Roles
         → Ownership (route-level) → Validation → Controller
Response → Transform → (Audit, on admin mutations)
Error    → AllExceptionsFilter
```

Request id is first so every subsequent log line and error carries it. Throttling precedes authentication so an unauthenticated flood is rejected before any token work — relevant for `/orders/track`, where Phase 1 requires throttling **before database access**.

## C3. Module-local by design

| Component | Owner | Why not `common/` |
|---|---|---|
| `OrderOwnershipGuard` | `orders` | Needs `OrderRepositoryPort` — a `common/` guard depending on a module inverts the dependency |
| `AuditInterceptor` | `audit` | Domain-specific; belongs to the capability |
| `IdempotencyInterceptor` | `orders` | Only order placement requires it |

A `common/` component **must not import from `modules/`**. That constraint alone decides most placement questions.

---

## C4. Summary

| Question | Answer |
|---|---|
| `common/` admission | **3+ modules AND no domain meaning** — both required |
| `common/utils/` | **Does not exist.** Named directories only. |
| `Money` in `common/` | Explicit, recorded exception — a shared primitive used by 5 modules |
| `common/` importing `modules/` | **Forbidden** |
| Business errors | `AppError` hierarchy; **never** `HttpException` outside presentation |
| HTTP translation | **One place** — `AllExceptionsFilter` |
| Business rejections | 4xx, logged `info`, **not** sent to Sentry |
| Infrastructure faults | 5xx, logged `error`, **sent** to Sentry |
| Internal detail in responses | **Never** — correlated by `requestId` |
| Vendor / driver errors | Translated at the boundary |
| Auth default | **Global**, `@Public()` opts out |
