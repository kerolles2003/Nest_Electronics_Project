# Testing Architecture — Phase 1.1

**Status:** FROZEN pending review · **Date:** 2026-08-30 · **ADR:** ADR-CODE-017

> **Baseline: the legacy project has zero test files and zero CI.** Everything here is new.
>
> Phase 1 specified *what* must be tested (103 behavioural cases in [`baseline-test-cases.md`](../baseline-test-cases.md)). This document specifies *where each test runs* and *what it may touch*.

---

## 1. The rule that shapes everything

> **A test that needs a real vendor account is not a test that runs on every commit.**

Two consequences drive the design:

1. **No test in the default suite touches Resend, Cloudinary, or any external service.** Ports make that structural rather than aspirational.
2. **Tests that must touch MongoDB are separated from those that must not**, so the fast suite stays fast enough to run on save.

The port abstractions from [`PORTS-AND-CONTRACTS.md`](./PORTS-AND-CONTRACTS.md) exist substantially *for* this: J2 ("testability of a business rule") is the justification for all three repository ports.

---

## 2. The pyramid

| Level | Scope | Touches MongoDB? | Touches a vendor? | Target time | Run |
|---|---|---|---|---|---|
| **1. Unit** | A pure function or domain rule | ❌ | ❌ | < 5 ms | Every save |
| **2. Application** | A use case with fake ports | ❌ | ❌ | < 20 ms | Every save |
| **3. Infrastructure** | A repository against real Mongo | ✅ **replica set** | ❌ | < 200 ms | Pre-push, CI |
| **4. Integration** | A module wired end to end | ✅ | ❌ (fakes) | < 500 ms | CI |
| **5. E2E** | HTTP in → HTTP out | ✅ | ❌ (fakes) | < 2 s | CI |
| **6. Contract** | Every port implementation | ❌ | ⚠️ **opt-in only** | varies | Nightly / pre-swap |

Levels 1–5 form the default `npm test`. Level 6 runs against real vendors **only when explicitly enabled**.

---

## 3. Level 1 — Unit

**What:** logic with no I/O. This is where the Tier 3 `domain/` layers pay for themselves.

| Target | Examples |
|---|---|
| `order-state-machine.ts` | Every legal transition permitted; every illegal one rejected; terminal states final; `delivered → pending_payment` rejected |
| `Money` | Addition, `clamp`, HALF_UP rounding, currency-mismatch throws |
| Pricing calculation | `grandTotal = subtotal − discount + shipping`; discount clamped to `[0, subtotal]`; total never negative |
| Coupon eligibility | The V1–V10 ladder ([`DISCOUNT-MODEL.md`](./DISCOUNT-MODEL.md) §4) |
| `order-number.ts` | Format, daily reset semantics |
| Template rendering | Renders with valid data; **throws** on a missing variable |

**Because `domain/` imports nothing framework-shaped (rule F1), these need no Nest testing module.** They are plain function calls, which is why the Tier 3 layering is worth its cost.

**The transition matrix is the highest-value unit test in the system.** Phase 0.5 found the legacy matrix lived only in admin app code while the RPC validated nothing, permitting incoherent states that live data actually contained. Here it is a pure function with exhaustive coverage.

---

## 4. Level 2 — Application (use cases with fakes)

**What:** a service orchestrating ports, with every port replaced by a fake.

```
OrderPlacementService
    ├── OrderRepositoryPort      → InMemoryOrderRepository
    ├── InventoryService         → real (its ports faked too)
    ├── PricingService           → real (pure)
    └── NotificationsService     → FakeNotifications
```

| Assertion | Why here rather than integration |
|---|---|
| Insufficient stock aborts the whole order | The *rule*; the transactional guarantee is Level 3 |
| Quantity ≤ 0 rejected | Direct fix for F-CRIT-3 |
| Inactive/soft-deleted product rejected | Direct fix for F-HIGH-3 |
| `userId` taken from the command, never a payload | Direct fix for F-CRIT-2 |
| Cancellation restores stock | Direct fix for F-HIGH-2 |
| Coupon applied then released on cancel | — |
| Email dispatched **after** commit, and failure does not fail the order | `FakeEmailSender` set to throw |

Runs in milliseconds, so a developer runs it constantly. That frequency is what makes these rules stay correct.

---

## 5. Level 3 — Infrastructure (real MongoDB)

**What:** repositories, transactions, indexes, concurrency.

**Harness: a Docker Compose MongoDB replica set** (`docker-compose.dev.yml`) — the same artefact locally and in CI. Phase 1 mandates a replica set in *every* environment; CI is not exempt ([`CONSISTENCY-MODEL.md`](./CONSISTENCY-MODEL.md) §1). `mongodb-memory-server` was measured and rejected — 781 MB of postinstall download on every workspace install — and **must not be installed**. Authority: [`ENVIRONMENT-RATIFICATION.md`](./ENVIRONMENT-RATIFICATION.md) §3.

| Assertion | Phase 1 reference |
|---|---|
| **Transaction rollback leaves no partial writes** | The Phase 2 gate |
| **No oversell** — 20 concurrent orders for 1 unit → exactly 1 succeeds | ADR-CONSISTENCY-002 |
| Idempotent placement — same key twice → one order, one decrement | RULE-ORDER-006 |
| Idempotent restore — cancel twice → stock restored once | RULE-INV-010 |
| Coupon race — 2 concurrent orders, limit 1 → one succeeds | RULE-COUPON-002 |
| Status race — 2 concurrent transitions → one `409` | ADR-ORDER-003 |
| **Ledger invariant** — `Σ inventoryEvents == stock.onHand` | RULE-INV-003 |
| Unique indexes enforced; TTL indexes present | — |
| `explain()` shows `IXSCAN`, never `COLLSCAN`, for the top 10 queries | [`MONGODB-DESIGN.md`](./MONGODB-DESIGN.md) §13 |

> **The transaction-rollback test is the Phase 2 completion gate.** Reclassified by [`ENVIRONMENT-RATIFICATION.md`](./ENVIRONMENT-RATIFICATION.md) §4: the *implementation* is proven once by executed rollback and commit evidence, and each *environment* must then pass the same gate before it is considered ready. Discovering at Phase 6 that transactions do not work in CI would be extremely expensive.

The index-usage test is worth singling out: Phase 0.5 found a GIN full-text index with **0 scans** because the query could not use it. An `explain()` assertion turns that class of defect into a CI failure instead of a silent performance cliff.

---

## 6. Levels 4–5 — Integration and E2E

**Integration:** a module wired with real persistence and fake external providers.
**E2E:** the full app via `supertest` — real guards, real pipes, real filters, fake vendors.

### The authorization matrix is the highest-value E2E suite

Phase 1 requires every endpoint tested against **anonymous × customer_a × customer_b × admin × super_admin × expired × tampered** ([`AUTHORIZATION-MODEL.md`](./AUTHORIZATION-MODEL.md) §6).

| Case | Expected |
|---|---|
| `customer_b` reads `customer_a`'s order | **404** (not 403 — a 403 confirms existence) |
| `anonymous` places an order | 401 |
| `customer` calls any admin endpoint | 403 |
| `admin` changes a role | 403 |
| `super_admin` changes a role | 200 |
| Any principal sends `role` in a profile update | 400 `UNKNOWN_FIELD` |
| Any principal sends `stock` in a product update | 400 `UNKNOWN_FIELD` |
| Any principal sends a price at checkout | 400 `UNKNOWN_FIELD` |
| Anonymous reads an inactive product's images | 404 |

**This suite is the direct replacement for RLS**, and the only credible evidence that Phase 0 migration risk **R2** is discharged. The four `UNKNOWN_FIELD` cases are the regression net for the legacy field-injection class of vulnerability.

E2E also covers the critical path end to end: browse → cart → checkout → order appears → admin confirms → ships → delivers.

---

## 7. Level 6 — Port conformance contracts

**One suite per port, run against every implementation** ([`PROVIDER-ARCHITECTURE.md`](./PROVIDER-ARCHITECTURE.md) §7).

```
test/contract/email-sender.contract.spec.ts
    → FakeEmailSender          (default suite)
    → ConsoleEmailSender       (default suite)
    → ResendEmailSender        (opt-in: RUN_VENDOR_TESTS=1 + sandbox key)
```

It asserts **port semantics, not vendor behaviour**:

- A valid message resolves with a non-empty `providerMessageId`
- An invalid recipient throws `EmailRecipientError` — **not** a vendor error type
- A transport failure throws `EmailTransportError`
- Both `html` and `text` are transmitted
- No vendor type appears in any resolved or rejected value

> **This suite is the acceptance test for a provider swap.** A Zoho adapter is ready when it passes unchanged. It is also what proves the port has not quietly become vendor-shaped — if a new adapter cannot satisfy it without changing the suite, the port was wrong.

---

## 8. Test doubles

| Double | Replaces | Behaviour |
|---|---|---|
| `FakeEmailSender` | `EmailSenderPort` | Records messages; assertable; configurable to throw |
| `ConsoleEmailSender` | `EmailSenderPort` | Logs; used in local dev, not tests |
| `InMemoryMediaStorage` | `MediaStoragePort` | Buffers in a Map; deterministic ids and dimensions |
| `FakeTemplateRenderer` | `TemplateRendererPort` | Returns a predictable subject/html/text |
| `InMemoryOrderRepository` | `OrderRepositoryPort` | Array-backed; supports the guarded-update semantics |
| `InMemoryInventoryRepository` | `InventoryRepositoryPort` | Enforces the `>= qty` guard so the no-oversell rule is testable without Mongo |
| `InMemoryCouponRepository` | `CouponRepositoryPort` | Enforces the usage-limit predicate |

**Location:** `test/doubles/`, not inside `src/`. Production code must not be able to import a fake.

**Rule: a fake must honour its port's semantics.** `InMemoryInventoryRepository` must reject a decrement below zero exactly as the Mongo implementation does. A fake that is more permissive than reality produces green tests and a broken deployment — which is why the same contract suite (§7) also runs against the fakes.

---

## 9. What is mocked, integration-tested, and never touched

| Dependency | Unit | Application | Infrastructure | Integration | E2E |
|---|---|---|---|---|---|
| MongoDB | ❌ absent | ❌ fake repo | ✅ **real (replica set)** | ✅ real | ✅ real |
| Email provider | ❌ | 🎭 fake | — | 🎭 fake | 🎭 fake |
| Media storage | ❌ | 🎭 fake | — | 🎭 fake | 🎭 fake |
| Template renderer | ✅ real (pure) | 🎭 fake | — | ✅ real | ✅ real |
| Config | injected | injected | injected | test namespace | test namespace |
| Clock | injected | injected | injected | injected | real |
| Guards / pipes / filters | ❌ | ❌ | ❌ | ✅ real | ✅ real |

**Never touched in the default suite:** Resend, Cloudinary, Sentry, any real SMTP, any live Supabase resource.

**Time is injected**, not mocked globally. Coupon windows, token expiry and daily order-number resets all depend on "now"; a `ClockPort`-style injected function keeps those tests deterministic without `jest.useFakeTimers()` leaking across files.

---

## 10. Structure and tooling

```
apps/api/
├── src/**/*.spec.ts              # unit + application, beside the code
└── test/
    ├── contract/                 # port conformance suites
    ├── integration/              # module-level
    ├── e2e/                      # HTTP
    ├── doubles/                  # fakes
    ├── fixtures/                 # builders
    ├── setup/                    # shared harness bootstrap
    └── infrastructure/            # Level 3 — topology, transactions (Phase 2.5)
```

| Concern | Choice |
|---|---|
| Runner | **Jest** — the NestJS default; `@nestjs/testing` assumes it |
| HTTP | `supertest` |
| Database | **Docker Compose replica set** — `docker-compose.dev.yml`, identical locally and in CI ([`ENVIRONMENT-RATIFICATION.md`](./ENVIRONMENT-RATIFICATION.md) §3) |
| Fixtures | **Builder functions** (`aProduct({ stock: 5 })`), not JSON blobs — a schema change breaks one builder, not forty files |
| Naming | `<subject>.spec.ts` beside code; `<feature>.e2e-spec.ts` in `test/e2e/` |

**Isolation:** each of the three suites owns a database, selected with `MONGODB_DB_NAME` and named in `apps/api/src/database/testing/scratch-databases.ts`:

| Suite | Database |
|---|---|
| `apps/api` jest | `nest_electronics_scratch_api` |
| `apps/storefront` Playwright | `nest_electronics_scratch_storefront` |
| `apps/admin` Playwright | `nest_electronics_scratch_admin` |

Preparation (`test-db --ensure-clean`) rebuilds a database that does not match the baseline it recorded — index sync, catalogue, shipping rates, development admin — and reuses one that does. Teardown (`--assert-clean`) FAILS the run if the database is not still that baseline, naming every difference. Only those three names may be dropped; anything else is refused. Within a suite, tests isolate by tracked identity and must not depend on execution order.

The same rule applies to Next's build directory. `pnpm dev` uses `.next`; each browser suite passes `NEXT_DIST_DIR` and gets its own (`.next-e2e`, plus `.next-dead-api` for the admin's unreachable-API server). A shared dev cache is shared mutable state with no fence around it, and a poisoned one is silent: it once made the admin dev server answer `/admin` with 200 and every nested route with a clean 404, failing eleven specs with no error anywhere.

> **Corrected 3 September 2026.** This line previously read "each suite gets a clean database", and that was never true — every suite shared `nest_electronics_dev`. The cost is recorded in `WORK-LOG.md`: a browser suite without a teardown drained the shared catalogue, and the failure surfaced in a *different* suite while the guilty one stayed green.

---

## 11. Coverage targets

Phase 1 set these, and they are proportional to blast radius rather than uniform:

| Module | Target | Why |
|---|---|---|
| `orders` | **≥ 90%** | Money, stock, state machine |
| `inventory` | **≥ 90%** | Stock authority, ledger invariant |
| `pricing` | **≥ 90%** | Every monetary calculation |
| `auth` | **≥ 90%** | The security boundary |
| Everything else | ≥ 70% | — |
| Overall | ≥ 70% | — |

Coverage is a floor, not a goal. A module at 95% with no concurrency test is worse tested than one at 75% that proves it cannot oversell.

---

## 12. CI gates

```
lint  →  type-check (ALL workspaces)  →  unit + application
      →  infrastructure (replica set) →  integration  →  e2e  →  build
```

Every stage blocks. Additional gates:

- **Architecture:** boundary lint rules are errors ([`DEPENDENCY-RULES.md`](./DEPENDENCY-RULES.md) §5)
- **Template inventory:** every `TemplateId` has matching `.hbs` and `.txt.hbs` files
- **Index usage:** `explain()` shows `IXSCAN` for the top 10 queries
- **No vendor calls:** the default suite runs with vendor credentials **absent**; a test that needs one fails rather than silently reaching the network

> The last gate is the practical guarantee behind §1. If credentials are simply not present in CI, a test cannot accidentally depend on them.

Phase 0 found `apps/storefront` has **no `type-check` script**, so `turbo type-check` covered only the admin app. The type-check gate must span all workspaces.

---

## 13. Summary

| Question | Answer |
|---|---|
| Levels | Unit · Application · Infrastructure · Integration · E2E · **Contract** |
| Default suite touches a vendor? | **Never** — credentials are absent in CI |
| MongoDB in unit/application tests? | **No** — fake repositories |
| MongoDB in infrastructure and above? | **Yes — replica set, always** |
| Why repository ports exist | Testability (J2), not portability |
| Highest-value suites | Transition matrix (unit) · no-oversell (infra) · **authorization matrix (e2e)** |
| Phase 2 gate | **Transaction-rollback test passing in every environment** |
| Provider swap acceptance | **Port conformance suite passing unchanged** |
| Fakes | `test/doubles/`, must honour port semantics, verified by the same contract suite |
| Coverage | 90% for orders/inventory/pricing/auth; 70% elsewhere |
| Time | **Injected**, never globally mocked |
