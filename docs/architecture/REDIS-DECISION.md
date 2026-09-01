# Redis Decision — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADR:** ADR-REDIS-001

---

## 1. Decision

> ### **REDIS IS NOT REQUIRED IN PHASE 2.**
> Deferred, with **explicit, measurable trigger conditions** (§4). The system is designed so that adopting it later is additive, not a refactor.

Phase 0 recommended adopting Redis at Phase 6 for rate limiting, read caching and a refresh-token denylist. That recommendation was made **before** the Phase 0.5 forensic data existed. With the real numbers in hand, all three needs are met more simply for MVP.

---

## 2. Evaluation against actual requirements

### 2.1 Rate limiting — needed, but not yet Redis

| | |
|---|---|
| **Is it required?** | **Yes, absolutely.** Legacy had none anywhere, and its only "limiter" was in-memory client state reset by a page reload. `/orders/track` is a public PII-adjacent endpoint. |
| **Does it need Redis?** | **Not for a single instance.** `@nestjs/throttler` with the default in-memory store enforces every limit in [`AUTHORIZATION-MODEL.md`](./AUTHORIZATION-MODEL.md) §7 correctly. |
| **When does it?** | **The moment the API runs on more than one instance.** With N instances and an in-memory store, counters are per-instance and the effective limit becomes N × the configured value — silently. |
| **Verdict** | ⏸ **Defer.** This is the **most likely** trigger and the one to watch. |

### 2.2 Read caching — measurable, but modest

Phase 0 P1 identified the real problem: the storefront root layout renders an async `<Navbar/>` that fetches the category tree, so **every page render** queried it (1,664 sequential scans on `categories`, 852 on `brands`).

| | |
|---|---|
| **Is caching required?** | **Yes** — the query is genuinely repeated on every render. |
| **Does it need Redis?** | **No.** The dataset is **27 categories and 17 brands** — a few kilobytes. An in-process TTL cache (`@nestjs/cache-manager`, 15 min, invalidated on write) eliminates the query entirely. |
| **Cost of in-process** | Each instance holds its own copy; a write invalidates only the local copy, so other instances serve stale data for up to the TTL. **For a category tree, 15 minutes of staleness after a rename is acceptable.** |
| **Verdict** | ⏸ **Defer.** In-process caching solves the measured problem. |

### 2.3 Session storage — not needed

| | |
|---|---|
| **Required?** | **No.** Access tokens are stateless JWTs; there is no server-side session. |
| **Refresh-token denylist?** | Refresh tokens are stored in the `refreshTokens` collection with a TTL index, which gives revocation and logout-everywhere **without** Redis. |
| **Verdict** | ❌ **Not required.** MongoDB with a TTL index is the correct store — refresh tokens are low-volume (one per device per user) and must survive a restart, which an in-memory Redis without persistence would not guarantee. |

> This is where the Phase 0 recommendation is most clearly superseded. It proposed a Redis denylist; a TTL-indexed collection is simpler, durable, and queryable alongside the user.

### 2.4 Queues / background jobs — not needed

| | |
|---|---|
| **What background work exists?** | Transactional email only. |
| **Does it need a queue?** | **No.** Email dispatch is post-commit and failure-tolerant, with a bounded in-process retry and a delivery log. If an email fails permanently it is logged and alerted; it does not block or roll back anything. |
| **Scheduled jobs?** | **None in MVP.** The only legacy scheduled job (`release_expired_reservations`) is removed — reservations no longer exist, and it ran 35,309 times as a no-op. |
| **Verdict** | ❌ **Not required.** |

### 2.5 Temporary state — not needed

| Candidate | Actual home |
|---|---|
| Inventory reservation TTLs | **Reservations removed entirely** ([`INVENTORY-MODEL.md`](./INVENTORY-MODEL.md) §2) |
| Idempotency keys | `idempotencyKeys` collection, TTL 24 h — must be **durable**; losing them to a restart would permit duplicate orders |
| Email verification / password reset tokens | MongoDB with TTL — must survive a restart |
| Cart expiry | MongoDB TTL index |

**Verdict:** ❌ Not required. Every case needs durability, which argues *against* an in-memory store.

---

## 3. Why deferring is the right call

| Reason | Detail |
|---|---|
| **Scale does not justify it** | 4 users, 85 products, 10 orders, ~200 rows total. This is a development-stage application with no production traffic. |
| **It is a new failure mode** | A Redis outage takes down rate limiting and caching. At this scale that is added operational risk for no measured benefit. |
| **Operational cost** | Another managed service, another credential to rotate, another dependency in health checks, another thing to run locally and in CI. |
| **The brief is explicit** | *"Redis must NOT be included automatically. Its use must be justified by an actual requirement."* No current requirement survives scrutiny. |
| **Deferring costs almost nothing** | `@nestjs/throttler` and `@nestjs/cache-manager` both swap their storage backend by configuration. Adopting Redis later is a config change plus a deployment, not a refactor. |
| **Reservations are gone** | Phase 0's "optionally justified" Redis use — reservation TTL keys — no longer exists as a concept. |

---

## 4. Trigger conditions

Adopt Redis when **any one** of these becomes true. Each is observable, not a matter of judgement.

| # | Trigger | Why | Priority |
|---|---|---|---|
| **T1** | **The API runs on more than one instance** (horizontal scaling, blue-green with overlap, or any multi-replica deploy) | In-memory rate-limit counters become per-instance; the effective limit silently multiplies by N. **This is a correctness failure in a security control, not a performance issue.** | 🔴 **Highest — most likely trigger** |
| **T2** | Cache invalidation staleness becomes user-visible | With N instances, a category rename is stale on N−1 instances for up to the TTL | 🟠 High |
| **T3** | Sustained catalogue read load makes MongoDB the bottleneck | Evidenced by p95 latency and Atlas metrics — **not** assumed | 🟡 Medium |
| **T4** | Real background work appears (bulk import, report generation, scheduled sync) | BullMQ requires Redis | 🟡 Medium |
| **T5** | An online payment provider (Paymob) is integrated | Reintroduces a payment gap → reservations → TTL keys → and webhook idempotency benefits from a fast shared store | 🟡 Medium |
| **T6** | Search-as-you-type autocomplete needs sub-10 ms responses | Cached prefix results | 🔵 Low |

**T1 is the one to watch.** The single-instance assumption is the load-bearing premise of this decision, and it must be stated in the deployment documentation so that scaling out is never done casually. **Adding a second instance without adding Redis is a silent security regression.**

---

## 5. What is built instead, and how the seam is preserved

| Need | MVP implementation | Redis migration path |
|---|---|---|
| Rate limiting | `@nestjs/throttler`, in-memory | Swap in `ThrottlerStorageRedisService` — **config only** |
| Category tree / brand cache | `@nestjs/cache-manager`, in-memory, 15 min TTL, invalidated on write | Swap the cache store — **config only** |
| Refresh tokens | `refreshTokens` collection + TTL index | Keep in MongoDB (durability required) |
| Idempotency keys | `idempotencyKeys` collection + TTL | Keep in MongoDB (durability required) |
| Cart expiry | MongoDB TTL index | Keep |
| Email dispatch | Post-commit, in-process retry, delivery log | BullMQ + Redis on T4 |

**Architectural rule:** all caching and throttling goes through the NestJS abstractions (`CacheModule`, `ThrottlerModule`) — never a hand-rolled `Map` in a service. This is what keeps the migration a configuration change. A bespoke in-memory cache written directly into a service would have to be found and rewritten later; the abstraction cannot.

---

## 6. Re-evaluation checkpoints

| Checkpoint | Question |
|---|---|
| End of Phase 2 (foundation + CI) | Is the deployment definitely single-instance? Is that documented? |
| Before Phase 6 (commerce core) | Has any trigger fired? |
| **Before production cutover** | **T1 check — how many instances will run?** If more than one, Redis is required *before* launch. |
| Post-launch, monthly | Review p95 latency and MongoDB metrics against T3 |

---

## 7. Summary

| Question | Answer |
|---|---|
| **Redis in Phase 2?** | **No** |
| Rate limiting | Required — in-memory throttler is correct **for one instance** |
| Caching | Required — in-process TTL cache handles 27 categories and 17 brands |
| Session storage | Not needed — stateless JWT |
| Refresh-token store | **MongoDB**, not Redis — durability is required |
| Queues | Not needed — no background work exists |
| Reservation TTLs | **Not applicable** — reservations removed |
| Primary trigger | **T1: more than one API instance** |
| Migration cost when triggered | Configuration change — the abstractions are already in place |
| Deviation from Phase 0 | Phase 0 recommended Redis at Phase 6. Superseded by Phase 0.5 evidence: the scale is ~200 rows, the refresh-token store needs durability, and reservations no longer exist. |
