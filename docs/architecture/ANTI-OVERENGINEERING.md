# Anti-Overengineering Rules — Phase 1.1

**Status:** FROZEN pending review · **Date:** 2026-08-30 · **MANDATORY SECTION**

> Every pattern below is legitimate **somewhere**. None is legitimate **here, now**. Each entry states why it is harmful in this project and the concrete condition that would justify it.
>
> **The default answer to "should we add this abstraction?" is no.** Abstraction is a cost paid every day by every reader, in exchange for flexibility that must actually be exercised to pay back.

---

## 1. An interface for every class

**Harm.** Doubles the file count. Breaks "go to definition" — every navigation lands on a declaration instead of behaviour. Creates the *illusion* of decoupling: a single-implementation interface is a rename away from its implementation, so it constrains nothing. Reviewers stop reading interfaces they know are trivial, and a real contract change slips through.

**Here.** `BrandsService` will have exactly one implementation for the life of this project. `IBrandsService` would add a file, an injection token and a mental hop for zero benefit.

**Justified when:** a second implementation exists (vendor replaceability, J1) or a business rule needs testing without infrastructure (J2). Six ports in this system meet that bar; nothing else does ([`PORTS-AND-CONTRACTS.md`](./PORTS-AND-CONTRACTS.md) §3).

---

## 2. A generic repository for everything

**Harm.** `BaseRepository<T>` with `findAll/findOne/create/update/delete` provides none of the queries this system actually needs, and encourages leaking Mongoose filter objects across boundaries — at which point the "abstraction" is a thin, lossy wrapper over the driver. It also hides concurrency semantics: `update(id, data)` gives no hint that overselling protection depends on a conditional `$gte` predicate.

**Here.** Every real query is specific: `findActiveBySlugWithRedirect`, `decrementStockIfAvailable`, `findForUser`, `transitionIfInStatus`. A generic base class supplies none of them.

**Justified when:** never, in this shape. Tier 2/3 modules get **concrete, named repositories** with intention-revealing methods ([`CODEBASE-STRUCTURE.md`](./CODEBASE-STRUCTURE.md) §6.2).

---

## 3. Factory patterns without multiple construction strategies

**Harm.** A factory whose `create()` has one branch is a constructor with extra steps, plus a file, a test and a registration.

**Here.** Provider selection is a conditional `useClass` in one module — that *is* the factory, expressed in the framework's own vocabulary ([`PROVIDER-ARCHITECTURE.md`](./PROVIDER-ARCHITECTURE.md) §4).

**Justified when:** construction genuinely varies at runtime per call — e.g. a payment gateway selected per order by currency or method. Not applicable: COD only.

---

## 4. Provider registries when one provider is active

**Harm.** A `Map<string, EmailProvider>` implies runtime selection that never happens. It defers a compile-time error (unknown provider) to a runtime lookup failure, and invites per-request routing logic nobody asked for.

**Here.** The brief is explicit: **one active provider at a time, replaceable later.** A registry serves simultaneity, not replaceability.

**Justified when:** two providers must genuinely run at once — transactional mail via one vendor and bulk marketing via another, with routing rules. No such requirement exists.

---

## 5. Failover chains

**Harm.** Failover needs health checks, retry budgets, circuit breakers, and duplicate-send protection. Without duplicate-send protection it sends the same order confirmation twice; with it, you have built a distributed-systems subsystem for a store with four users.

**Here.** Email dispatch is already post-commit and failure-tolerant: a failure is logged, recorded and alerted, and never rolls back an order ([`ORDER-LIFECYCLE.md`](./ORDER-LIFECYCLE.md) §12). That is the proportional answer.

**Justified when:** email delivery becomes revenue-critical with a contractual SLA, and the primary provider's reliability is measurably insufficient.

---

## 6. Event-driven architecture without event requirements

**Harm.** An event bus makes control flow invisible. "What happens when an order is placed?" stops being answerable by reading one method and becomes a search for subscribers. Ordering, failure handling and transactional boundaries all become implicit — and in a system where order placement must be atomic across three collections, implicit is dangerous.

**Here.** Order placement has one caller and a known, ordered set of effects. A direct service call is clearer and transactionally correct.

**Justified when:** a genuine fan-out appears — one event with three or more independent, optional consumers that must not block the producer. If it does, use in-process `EventEmitter2` first, **not** a message broker. The one candidate is `ReviewsModule → OrdersModule`; if it ever becomes bidirectional, an event is the right fix ([`DEPENDENCY-RULES.md`](./DEPENDENCY-RULES.md) §4).

---

## 7. Microservices without scaling requirements

**Harm.** Turns in-process calls into network calls, local transactions into distributed sagas, and one deployment into several. Phase 1 mandates multi-document transactions for order placement — splitting Orders and Inventory into separate services would make that impossible without a saga, trading a solved problem for a hard one.

**Here.** ~200 rows of data, four users, one team. **Modular monolith** with enforced boundaries is the correct shape, and the enforced boundaries are what would make a future split feasible.

**Justified when:** a specific module has genuinely divergent scaling or availability requirements, *and* the team is large enough that deployment coupling is a real constraint.

---

## 8. Redis without a concrete need

**Harm.** A new service, a new credential, a new health check, a new local-dev dependency, and a new failure mode — in exchange for caching 27 categories and 17 brands.

**Here.** Rate limiting works in-memory on a single instance. Refresh tokens and idempotency keys need **durability**, which argues *against* an in-memory store. Reservations — Phase 0's "optionally justified" use — no longer exist.

**Justified when:** the trigger conditions in [`REDIS-DECISION.md`](./REDIS-DECISION.md) §4 fire. **Primary trigger: more than one API instance**, at which point in-memory rate-limit counters silently multiply every limit by N. That is a correctness failure in a security control, and it is the one to watch.

---

## 9. CQRS infrastructure for trivial CRUD

**Harm.** `@nestjs/cqrs` with command buses, query buses and handler classes turns a three-line service method into four files and an indirection nobody can step through in a debugger.

**Here.** Command *objects* are used at Tier 3 — but as **plain typed inputs**, not as a bus with dispatch. That captures the real benefit (explicit inputs, `userId` provenance visible) without the infrastructure ([`DTO-STRATEGY.md`](./DTO-STRATEGY.md) §3).

**Justified when:** read and write models genuinely diverge — separate read stores, event sourcing, or independent read scaling. `SearchModule` is a *read model* in the conceptual sense, but it queries the same collection, so no bus is needed.

---

## 10. Excessive DTO duplication

**Harm.** Five near-identical DTOs for one resource means a field addition is a five-file change, and one of them will be missed.

**Here.** DTO variants exist **only where the audience genuinely differs** — `ProductResponseDto` vs `ProductAdminResponseDto` exists because `costPrice` must never reach a public consumer, and `OrderTrackingResponseDto` exists because Phase 1 requires no PII, no items and no money in a public tracking response. Those are security boundaries, not symmetry.

**The counter-rule:** where the audience is the same, use one DTO. Do not create `CreateXDto`, `CreateXRequestDto`, `CreateXInputDto` and `CreateXPayloadDto` for one endpoint.

**Justified when:** audience, security boundary, or shape genuinely differ.

---

## 11. Excessive mapping layers

**Harm.** `Document → Entity → DomainModel → Result → DTO` for a brand list is four mappings and four files where one would do. Every hop is a chance to drop a field.

**Here.** The full pipeline applies only at Tier 3. Tier 1 and 2 collapse to `Request DTO → Service → Response DTO`.

**Justified when:** the persisted shape, the domain shape and the wire shape genuinely differ — true for `orders`, false for `brands`.

---

## 12. Empty architectural directories

**Harm.** `domain/` containing only `index.ts` teaches new developers that the structure is decorative. Once one directory is ceremonial, all of them become suspect.

**Here.** Tier 1 modules have **no** layer directories at all. A `domain/` folder appears only when there is a domain rule to put in it ([`CODEBASE-STRUCTURE.md`](./CODEBASE-STRUCTURE.md) §3).

**Rule:** if a directory would be empty or hold only re-exports, **do not create it**. If a Tier 3 `domain/` ends up holding only enums, the module was mis-tiered — demote it.

---

## 13. One-line wrapper services

**Harm.** A service whose every method is `return this.repo.findX(...)` adds a file, a test and an injection with no behaviour. It is often defended as "a place for future logic" — a promise that is usually never redeemed.

```ts
// ❌ pure overhead
async findBySlug(slug: string) { return this.repo.findBySlug(slug); }
```

**Here.** Tier 1 modules have **no repository at all** — the service uses the model directly, so there is nothing to wrap.

**Justified when:** the method adds something real — authorization, a business rule, caching, or composition of multiple sources.

---

## 14. Abstracting the database

**Harm.** A `DatabasePort` promising portability is a *dishonest* abstraction. Phase 1's model is MongoDB-specific: embedded order items, materialised category paths, multikey `specs[]` indexes, `$facet` aggregation, conditional `$inc` as the overselling guard, multi-document transactions. None of that survives a move to PostgreSQL without redesign. The abstraction would impose ceremony on every query while pushing code toward a lowest-common-denominator surface — losing exactly the constructs the design depends on.

**Here.** The three repository ports exist for **testability**, not portability, and that distinction should be stated explicitly whenever this comes up in review.

**Justified when:** never, for this system.

---

## 15. Premature caching

**Harm.** A cache adds an invalidation problem and a staleness class of bug. Cached wrong data is worse than slow correct data.

**Here.** Exactly one cache is specified: the category tree and brand list, 15-minute TTL, invalidated on write — because Phase 0.5 *measured* the problem (1,664 sequential scans on `categories`, driven by an async `<Navbar/>` in the root layout). No search-result caching: too many parameter combinations, and stock and price must be current.

**Justified when:** profiling shows a specific hot path, as it did here.

---

## 16. Speculative ports for future providers

**Harm.** A `PaymentPort` designed with zero implementations encodes guesses. The first real integration then contradicts them, and the port is rewritten anyway — having cost design time and constrained the implementation in between.

**Here.** No payment, SMS or push port exists. COD only ([`PORTS-AND-CONTRACTS.md`](./PORTS-AND-CONTRACTS.md) §11).

**Justified when:** the integration is actually being built. Design the port **with** the first implementation, not before it.

---

## 17. Over-configuration

**Harm.** Every knob is a combination to test and a way to misconfigure production. A configurable value with one used setting is a constant with extra steps.

**Here.** Business constants — max cart quantity 99, bcrypt cost 12, token TTLs, max 8 images — are **code constants**, not environment variables. Changing them is a deliberate code change with review and tests, which is correct for a business rule. Configuration covers infrastructure: connection strings, credentials, provider selection, log level.

**Justified when:** the value genuinely differs per environment.

---

## 18. Test abstraction layers

**Harm.** A test framework on top of the test framework makes failures indirect and onboarding slower.

**Here.** Simple **builder functions** for fixtures (`aProduct({ stock: 5 })`), plain fakes in `test/doubles/`. No custom DSL, no base test classes, no shared mutable world.

**Justified when:** a genuinely repeated multi-step setup appears in many suites — and even then, a helper function usually suffices.

---

## 19. Barrel files everywhere

**Harm.** Barrels that re-export everything create import cycles and defeat tree-shaking. A cycle through a barrel is particularly hard to diagnose because the file looks empty.

**Here.** **One barrel per module**, exporting only the public API (the module, its service, its public types) — which is what makes the no-reach-in rule enforceable. No barrels inside layers.

---

## 20. Over-documenting the obvious

**Harm.** `// increment the counter` above `counter++` is noise that trains readers to skip comments, including the important ones.

**Here.** Comments explain **why** ([`CODE-STANDARDS.md`](./CODE-STANDARDS.md) §10). JSDoc on ports and non-obvious business rules, linked to the architecture document.

---

## The five-question test

Before adding any abstraction:

1. **Does a second implementation exist, or is one concretely planned?** No → do not abstract.
2. **Does it make a test possible that is currently impossible?** No → weak justification.
3. **Can I name the specific problem it solves?** "Flexibility" and "best practice" are not problems.
4. **What does it cost every reader, every day?** Files, hops, indirection.
5. **What is the cost of adding it later?** Usually low — most abstractions are cheap to introduce once the need is real.

**If 1 and 2 are both no, the answer is no.**

---

## Review red flags

| 🚩 | Ask |
|---|---|
| A new `I`-prefixed interface | Which of J1/J2/J3 applies? |
| `BaseRepository` / `AbstractService` | Which real query does it provide? |
| A registry or factory | How many implementations run at once? |
| An event emitter | How many independent consumers? |
| A new npm dependency for something small | Can 20 lines do it? |
| A directory with one file | Is the module mis-tiered? |
| A service method that only forwards | What does it add? |
| A new environment variable for a business rule | Should this be a constant? |
| "We might need it later" | Then add it later — it is cheap. |
| "For consistency with the other modules" | **Never a reason.** Structure follows complexity, not symmetry. |

---

## The counterweight

This document argues consistently for less. It is not an argument for no structure — the same audit that motivates restraint also motivates the abstractions that **do** exist:

- Four Tier 3 modules with full layering, because they own money, stock, state and credentials
- Six ports, each individually justified
- Enforced dependency rules in CI
- 90% coverage targets on the modules that can lose money

**Under-engineering the order transition matrix would be exactly as costly as over-engineering the brands module.** The discipline is proportionality in both directions — and the honest test of that discipline is whether a module is ever *demoted* when its `domain/` turns out to hold only enums.
