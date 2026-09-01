# Ports & Contracts — Phase 1.1

**Status:** FROZEN pending review · **Date:** 2026-08-30 · **ADR:** ADR-CODE-007, 008

---

## 1. The rule

> **A contract exists where an implementation can realistically change, or where inverting the dependency makes a business rule testable without infrastructure.**
>
> **Not:** *"every class needs an interface."*

An interface with exactly one implementation that will never have a second is not abstraction — it is indirection. It doubles the files, breaks "go to definition", and buys nothing. The test is not *"could this theoretically change?"* (everything could) but *"is there a named, plausible reason it would, or does it unblock a test we actually want to write?"*

---

## 2. The three justifications

A contract requires **at least one**:

| # | Justification | Test |
|---|---|---|
| **J1 — Vendor replaceability** | The implementation calls a third-party SDK that could be swapped for a competitor | Can I name the likely replacement? |
| **J2 — Testability of a business rule** | A rule needs unit testing without a database or network | Is the rule non-trivial enough that I want a fast test? |
| **J3 — Genuine polymorphism** | Two or more implementations exist *simultaneously* in production | Do both actually run? |

**J3 does not currently apply anywhere in this system.** The brief is explicit: one active provider at a time. No provider registry, no routing, no failover.

---

## 3. The complete contract inventory

Every port in the system. There are **six**, and each is individually justified.

| # | Contract | Owner module | Justification | Implementations |
|---|---|---|---|---|
| 1 | `EmailSenderPort` | `notifications` | **J1** — Resend today, Zoho/SES/SMTP plausible | `ResendEmailSender` · `ConsoleEmailSender` (dev) · `FakeEmailSender` (test) |
| 2 | `MediaStoragePort` | `media` | **J1** — Cloudinary today, S3/R2 plausible | `CloudinaryMediaStorage` · `InMemoryMediaStorage` (test) |
| 3 | `TemplateRendererPort` | `notifications` | **J1 (weak) + J2** — the renderer could change (Handlebars → React Email); rendering is testable in isolation | `HandlebarsTemplateRenderer` · `FakeTemplateRenderer` (test) |
| 4 | `OrderRepositoryPort` | `orders` | **J2** — the state machine and placement rules must be unit-testable without MongoDB | `MongoOrderRepository` · `InMemoryOrderRepository` (test) |
| 5 | `InventoryRepositoryPort` | `inventory` | **J2** — the ledger invariant and stock guard must be testable without MongoDB | `MongoInventoryRepository` · `InMemoryInventoryRepository` (test) |
| 6 | `CouponRepositoryPort` | `pricing` | **J2** — coupon validation and atomic redemption must be testable | `MongoCouponRepository` · `InMemoryCouponRepository` (test) |

### Ports 4–6 exist for a specific, concrete reason

These are the three modules that own the rules Phase 0.5 proved most dangerous when unverifiable — the order transition matrix, the stock guard and the ledger invariant, and coupon usage limits. Phase 1 mandates tests such as:

- 20 concurrent orders for 1 unit → exactly one succeeds
- Cancel twice → stock restored once
- `delivered → pending_payment` → rejected
- `Σ inventoryEvents == stock.onHand` after any sequence

The transactional and concurrency assertions **must** run against real MongoDB. But the *rule* assertions — the matrix, the clamping, the coupon eligibility ladder — should run in milliseconds against an in-memory fake, so that a developer runs them on every save. J2 is what makes that possible.

**This is the only reason repositories are abstracted, and it applies to exactly three modules.**

---

## 4. Where contracts do NOT exist

Explicitly enumerated, so their absence is a decision rather than an oversight.

| No contract for | Why |
|---|---|
| `BrandsService`, `CategoriesService`, `ContentService` | Tier 1 CRUD. One implementation, forever. An interface would be pure indirection. |
| `UsersService`, `CartService`, `ReviewsService` | Tier 2. Tested through their module with a test database. |
| Brand / category / blog / review / user / cart repositories | Either no repository at all (Tier 1) or a **concrete class** with no interface (Tier 2) |
| `SearchService` | Concrete class. The *engine* may change (`$text` → Atlas Search per ADR-SEARCH-001), but the change is contained inside this one service — swapping the query builder does not require a second implementation to coexist. |
| `PricingService` | Concrete. It is the single authority on money; a second implementation would be a bug, not a feature. |
| `AuditService`, `HealthService`, `FulfilmentService` | Trivial, single-implementation |
| `TransactionService` | Thin wrapper over the Mongo session API |
| **MongoDB itself** | Not swappable in any honest sense — see §5 |
| Config, logger | Framework primitives |

### 4.1 Why `SearchService` has no port despite a planned engine change

This is the most defensible-looking candidate that is nonetheless rejected, so the reasoning is worth stating.

ADR-SEARCH-001 anticipates migrating `$text` → Atlas Search. But that migration replaces the **query construction inside one service** — the method signatures, the `ProductSearchResult`, and every caller stay identical. A port would only help if both engines had to run at once (they will not) or if `SearchService`'s callers needed to be tested without a database (they do not — `SearchService` *is* the thing being tested, and it must be tested against real MongoDB to verify index usage).

**The seam that matters here is the service boundary, which already exists.** Adding an interface on top adds a file and buys nothing.

---

## 5. Why MongoDB is not behind a swappable abstraction

The largest deliberate omission, and the one most likely to be challenged in review.

Phase 1's document model is designed *specifically for MongoDB*: embedded order items and status history, materialised category `path[]` arrays, multikey indexes over `specs[]`, `$facet` aggregation, conditional `$inc` updates as the overselling guard, and multi-document transactions ([`MONGODB-DESIGN.md`](./MONGODB-DESIGN.md)).

None of that transfers to a relational or key-value store without redesigning the data model. A `DatabasePort` promising database independence would be **dishonest abstraction**: it would impose ceremony on every query while delivering none of the portability it implies, and it would push code toward a lowest-common-denominator query surface — losing exactly the MongoDB-specific constructs the design depends on.

The repository ports in §3 exist for **testability (J2)**, not portability. That distinction is deliberate and should be stated in review whenever "should we abstract the database?" comes up.

---

## 6. Interface vs abstract class

> **Decision (ADR-CODE-007): ports are declared as `abstract class`. Pure data shapes are `interface` or `type`.**

TypeScript interfaces do not exist at runtime, so a NestJS provider cannot be keyed on one. That leaves three options:

| Option | Verdict |
|---|---|
| `interface` + a separate `Symbol` injection token | ❌ Two artifacts per port, `@Inject(TOKEN)` on every consumer, and the token can drift from the interface |
| `interface` + a string token | ❌ Same, plus stringly-typed |
| **`abstract class`** | ✅ **Chosen** — one artifact that is both the type and the runtime token |

```ts
// modules/notifications/application/ports/email-sender.port.ts
export abstract class EmailSenderPort {
  abstract send(message: OutboundEmail): Promise<EmailSendResult>;
}
```

```ts
// registration
{ provide: EmailSenderPort, useClass: ResendEmailSender }

// consumption — plain constructor injection, no @Inject
constructor(private readonly email: EmailSenderPort) {}
```

**Trade-off accepted:** an abstract class is nominally a class, which purists dislike in a "domain" layer. In exchange, every port is one file, every consumer uses ordinary DI, and there is no token registry to keep in sync. For a NestJS codebase this is the pragmatic choice, and it removes a whole category of "token not found" runtime errors.

**Interfaces are still used** for data shapes that are never injected: `OutboundEmail`, `EmailSendResult`, `StoredAsset`, `PlaceOrderCommand`.

---

## 7. Location and naming

### Location

```
modules/<module>/application/ports/<capability>.port.ts
```

Ports live **inside the module that owns the capability** — never in a global `interfaces/` directory, which the brief correctly forbids. An orphaned contract loses the context that explains why it has the shape it has.

```
modules/notifications/application/ports/
  ├── email-sender.port.ts
  └── template-renderer.port.ts

modules/media/application/ports/
  └── media-storage.port.ts

modules/orders/application/ports/
  └── order.repository.port.ts
```

### Naming

| Kind | Pattern | Example |
|---|---|---|
| Capability port | `<Capability>Port` | `EmailSenderPort`, `MediaStoragePort` |
| Repository port | `<Entity>RepositoryPort` | `OrderRepositoryPort` |
| Vendor implementation | `<Vendor><Capability>` | `ResendEmailSender`, `CloudinaryMediaStorage` |
| Persistence implementation | `Mongo<Entity>Repository` | `MongoOrderRepository` |
| Test double | `Fake<Capability>` / `InMemory<Entity>Repository` | `FakeEmailSender` |
| File | `<kebab-name>.port.ts` | `email-sender.port.ts` |

The `Port` suffix is deliberate: seeing `EmailSenderPort` in a constructor immediately tells a reader this is a replaceable boundary, and seeing it imported from outside its owning module is an obvious review flag.

---

## 8. Registration and composition

Two distinct binding patterns.

### 8.1 Vendor ports — bound in `ProvidersModule`, selected by configuration

```
providers/providers.module.ts   (@Global)
    reads config.email.provider   →  binds EmailSenderPort
    reads config.media.provider   →  binds MediaStoragePort
```

The selection happens in exactly one file. `NotificationsModule` declares a dependency on `EmailSenderPort` and never learns which implementation satisfied it. Detail in [`PROVIDER-ARCHITECTURE.md`](./PROVIDER-ARCHITECTURE.md).

### 8.2 Repository ports — bound in their own module

```ts
// orders.module.ts
providers: [
  { provide: OrderRepositoryPort, useClass: MongoOrderRepository },
  OrderPlacementService,
]
```

No configuration switch — there is one production implementation. The port exists for J2 (testability), and the in-memory fake is substituted only in unit tests via `overrideProvider`.

---

## 9. Contract design rules

Rules that keep a port genuinely replaceable rather than vendor-shaped.

| # | Rule | Rationale |
|---|---|---|
| 1 | **Speak the application's language, not the vendor's** | `send(message)` — not `sendWithResend(payload)`. A method named after a vendor is not a port. |
| 2 | **No vendor type in any signature** | If `CreateEmailOptions` from the Resend SDK appears in the port, the port is the SDK. |
| 3 | **Own the input and output types** | `OutboundEmail`, `EmailSendResult`, `StoredAsset` are defined by the owning module. |
| 4 | **Return application-meaningful results** | `{ providerMessageId, sentAt }` — never the raw vendor response body. |
| 5 | **Throw the module's own errors** | Adapters translate vendor exceptions into `EmailDeliveryError`. Business code never catches a Resend error type. |
| 6 | **Model the intersection, not the union** | Include only capabilities every plausible implementation can support. Cloudinary's on-the-fly transformation URLs are the interesting case — see §10. |
| 7 | **Keep it small** | `EmailSenderPort` has **one** method. A port with fifteen methods is a service that has been renamed. |
| 8 | **No lifecycle leakage** | No `connect()`/`disconnect()` in the port; that is the adapter's business. |

---

## 10. The hard case: provider-specific capability

Rule 6 has a real tension in this system, and pretending otherwise would be dishonest.

Phase 1 specifies **named transformation presets** — `t_thumb` (96×96), `t_card` (400×400), `t_detail` (1000×1000) — which Cloudinary delivers by URL manipulation ([`MEDIA-MODEL.md`](./MEDIA-MODEL.md) §8). S3 has no equivalent; it would need a CDN with an image service, or pre-generated derivatives at upload time.

**Resolution: the port exposes the *intent*, not the mechanism.**

```ts
export abstract class MediaStoragePort {
  abstract upload(file: UploadInput): Promise<StoredAsset>;
  abstract delete(assetId: string): Promise<void>;
  abstract getUrl(asset: StoredAsset, preset: ImagePreset): string;
}

export type ImagePreset = 'thumb' | 'card' | 'detail' | 'zoom' | 'original';
```

`getUrl` asks for *"the card-sized URL for this asset"*. Cloudinary answers by composing a transformation URL. An S3 adapter would answer with a pre-generated derivative key, or a CloudFront/imgproxy URL. **The business module asks the same question either way**, and `ImagePreset` is a closed application-owned union — not a passthrough for vendor transformation strings.

**What is deliberately *not* in the port:** eager transformation, format auto-negotiation flags, and quality parameters. Those are configured **inside the Cloudinary adapter**. If S3 later requires derivative generation at upload time, that also lives inside its adapter. The port does not grow to accommodate either.

**The residue, stated honestly:** if a future provider genuinely cannot produce a `card` URL, the *adapter* must generate derivatives at upload. That is adapter work, not application work — which is exactly the outcome the port is designed to guarantee. See [`REPLACEMENT-TESTS.md`](./REPLACEMENT-TESTS.md) §3.

---

## 11. Ports deliberately deferred

| Deferred port | Why not now | Trigger |
|---|---|---|
| `PaymentPort` | COD only; no provider exists. Designing a payment abstraction against zero implementations would guess at the wrong shape. | Paymob integration (ADR-ORDER-004) |
| `SmsPort` | No SMS requirement | OTP or delivery notifications by SMS |
| `PushNotificationPort` | Flutter push is out of scope for this repository | Mobile push requirement |
| `CachePort` | `@nestjs/cache-manager` **is** the abstraction; wrapping it adds nothing | Never — this would be a wrapper over a wrapper |
| `QueuePort` | No background work exists ([`REDIS-DECISION.md`](./REDIS-DECISION.md) §2.4) | Real async work appears |
| `SearchEnginePort` | §4.1 | Two engines must coexist |

**Deferring is the correct default.** A port designed before any implementation exists encodes assumptions that the first real integration then contradicts.

---

## 12. Review checklist

When a pull request adds a port:

- [ ] Which of J1 / J2 / J3 justifies it? Named explicitly.
- [ ] For J1: can the likely replacement be named?
- [ ] Does any signature reference a vendor type? → reject
- [ ] Is the method count small and cohesive?
- [ ] Does it live in the owning module's `application/ports/`?
- [ ] Is a test double provided or planned?
- [ ] Do consumers outside the owning module call a **business method**, not the port?

When a pull request adds an interface that is **not** a port:

- [ ] Is it a pure data shape? → fine, use `interface`/`type`
- [ ] Is it an interface over a single service that will never have a second implementation? → **reject**

---

## 13. Summary

| Question | Answer |
|---|---|
| Contract rule | **Only where implementation can change (J1) or a rule needs isolated testing (J2)** |
| Total ports | **Six** — email, media storage, template renderer, and three repositories |
| Repository ports | **Only** `orders`, `inventory`, `pricing` — for testability, not portability |
| MongoDB abstraction | **None** — the model is MongoDB-specific; a `DatabasePort` would be dishonest |
| Interface or abstract class | **`abstract class`** — one artifact serving as type and DI token |
| Location | Owning module's `application/ports/` — **never** a global `interfaces/` |
| Vendor binding | One file: `ProvidersModule`, driven by config |
| Repository binding | The module itself; no config switch |
| Port visibility | Consumers call business methods; ports stay one module deep |
| Multi-provider routing | **None** — one active provider at a time, by design |
