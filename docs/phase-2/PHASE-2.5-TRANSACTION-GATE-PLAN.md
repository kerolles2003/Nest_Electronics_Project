# PHASE 2.5 — MONGODB TRANSACTION HARD GATE · PLAN

**Date:** 2026-08-30 · **Status:** frozen architecture re-read, gate designed
**Report:** [`PHASE-2.5-REPORT.md`](./PHASE-2.5-REPORT.md)

> ### The gate is satisfied by observed database state, and by nothing else.
> Not by "MongoDB connected". Not by "replica set configured". Not by
> "`withTransaction()` executed". Not by "an exception was thrown". A
> transaction that threw and left both documents behind throws exactly the same
> exception as one that rolled back correctly.

---

## 1. Architecture evidence

Every transaction-related requirement extracted from the frozen documents,
before any code was written.

| # | Requirement | Authority |
|---|---|---|
| 1 | **MongoDB must run as a replica set.** A standalone `mongod` cannot open a transactional session — `IllegalOperation: Transaction numbers are only allowed on a replica set member or mongos` | `CONSISTENCY-MODEL.md` §1 |
| 2 | Replica set required in **local, CI, staging and production** — staging "must mirror production, including the replica set" | `CONSISTENCY-MODEL.md` §1; `OBSERVABILITY.md` §154; `CONFIGURATION-ARCHITECTURE.md` §7 |
| 3 | **Phase 2 gate:** "the first integration test written must prove a transaction rolls back with no partial writes, **in every environment**. If transactions do not work locally and in CI, Phase 2 stops until they do." | `CONSISTENCY-MODEL.md` §1 |
| 4 | The rollback test "must pass locally and in CI **before any domain module is written**" | `TESTING-ARCHITECTURE.md` §5 |
| 5 | Gate 4 of the freeze: replica set available "before any transaction-dependent implementation or testing" — a **hard prerequisite** | `ARCHITECTURE-FREEZE-RATIFICATION.md` §11 |
| 6 | `database/` **MUST contain** `DatabaseModule`, **`TransactionService`**, index-sync, seeds. It **MUST NOT** contain any collection schema or any query | `CODEBASE-STRUCTURE.md` §2.1 |
| 7 | `TransactionService` wraps `session.withTransaction`. Only application services open transactions. Repository methods **accept an optional `session`** so they can participate | `CODEBASE-STRUCTURE.md` §6.4 |
| 8 | `TransactionService` is listed under **"where contracts do NOT exist"** — "a thin wrapper over the Mongo session API" | `PORTS-AND-CONTRACTS.md` §4 |
| 9 | **No `DatabasePort`.** Database portability is a *dishonest abstraction* for this system | `PORTS-AND-CONTRACTS.md` §5; `ANTI-OVERENGINEERING.md` §14 |
| 10 | Transaction concerns: `snapshot` read concern, `{ w: 'majority', j: true }`, `primary` read preference, 15 s transaction timeout, retryable writes | `CONSISTENCY-MODEL.md` §7 |
| 11 | **No external call** (HTTP, email, media) inside a transaction | `CONSISTENCY-MODEL.md` §7; `CODEBASE-STRUCTURE.md` §6.4 |
| 12 | Business rejections and infrastructure faults are **strictly distinguished**; `withTransaction` retries only `TransientTransactionError` / `UnknownTransactionCommitResult` | `CONSISTENCY-MODEL.md` §8 |
| 13 | Runner is **Jest**; MongoDB-touching tests are **Level 3 — Infrastructure**; tests live in `apps/api/test/` | `TESTING-ARCHITECTURE.md` §5, §10 |
| 14 | CI harness for MongoDB is **`mongodb-memory-server` in replica-set mode** | `CONSISTENCY-MODEL.md` §1; `TESTING-ARCHITECTURE.md` §5, §10; `CONFIGURATION-ARCHITECTURE.md` §7 |
| 15 | One environment schema, values differ; **no second env parser**; no `process.env` outside `config/env.schema.ts` | `CONFIGURATION-ARCHITECTURE.md` §1, §3, §7 |
| 16 | Clean database. No legacy migration, no seed of business data | `ARCHITECTURE-FREEZE-RATIFICATION.md` §6 |

### 1.1 Conflicts with the required transaction design

```
NONE.
```

No frozen document contradicts anything the transaction gate must do. The
frozen architecture *anticipates* this phase: `TransactionService` already has a
mandated home, a mandated shape, and a recorded decision that it gets no port.

**One frozen choice is deviated from and is flagged, not silently resolved** —
see §12 (**D1**, the CI harness). It is a provisioning choice, not a design
conflict: it changes no requirement in the table above, and no source file
depends on it.

---

## 2. Hard gate definition

The gate passes for an environment only when **both** proofs execute against
that environment's real MongoDB and both assert on **queried database state**.

```
ROLLBACK PROOF                          COMMIT PROOF
──────────────                          ────────────
begin transaction                       begin transaction
write A            (with session)       write A            (with session)
write B            (with session)       write B            (with session)
force deterministic failure             commit
transaction aborts                      session ends
session ends                                  ↓
      ↓                                 independent read
independent read                        A count == 1
A count == 0                            B count == 1
B count == 0
```

Not accepted as evidence: an exception being thrown · `session.inTransaction()`
alone · a driver return value · a log line · the absence of an error.

---

## 3. Environment matrix

| Environment | MongoDB provisioning | Topology required | Who supplies `MONGODB_URI` |
|---|---|---|---|
| **Local** | `docker-compose.dev.yml` (Phase 2.4, unmodified) | single-node replica set `rs0`, PRIMARY | developer shell or `apps/api/.env` |
| **CI** | the same compose file, started by the workflow | single-node replica set `rs0`, PRIMARY | job-level `env:` — runner-local, credential-free |
| **Staging** | pre-existing staging cluster | replica set mirroring production | staging secret store |

The gate code is identical in all three. It connects to whatever
`MONGODB_URI` names and interrogates the server it actually reaches.

---

## 4. Test-only persistence design

```
transaction_gate_a          transaction_gate_b
{ runId, marker }           { runId, marker }
```

| Decision | Reason |
|---|---|
| **Two collections, not one** | Atomicity must be observed across a **collection boundary**. A single-document write is atomic without any transaction and would prove nothing. |
| **Names outside the domain vocabulary** | Neither name appears in `MONGODB-DESIGN.md` §2. There is no `users`, `orders`, `products`, `inventoryEvents`, `coupons`. |
| **Two fields** | `runId` for isolation, `marker` to tell A from B. No timestamps, no enums, no money, no relationships, no status — the subject is atomicity, not schema design. |
| **No Mongoose schema, no model** | Written through `connection.db.collection(name)`. A schema would be a domain artefact this phase must not create, and the frozen rule keeps schemas module-local anyway (`CODEBASE-STRUCTURE.md` §6.1). |
| **Names live in `test/`, never in `src/`** | No collection name appears anywhere in application source. |
| **Collections are created up front, outside the transaction** | An insert into a missing collection creates it implicitly, and inside a transaction that takes an exclusive collection lock a concurrent reader can block on. Pre-creating makes the first run behave exactly like the hundredth. |

---

## 5. `runId` isolation

```
runId = randomUUID()          — one per scenario execution
```

Every document written by a run carries it. Every verification query and every
deletion filters on that exact value.

```
✅  find({ runId: CURRENT_RUN_ID })          ❌  countDocuments()  === 0
✅  deleteMany({ runId: CURRENT_RUN_ID })    ❌  deleteMany({})
```

"The collection is empty" is not used as a signal anywhere. Another run, another
developer, another environment process or a previous failed run may legitimately
have documents present; none of that can affect this run's assertions.

**Isolation is proved, not assumed.** A sentinel document under a *foreign*
`runId` is present for the whole suite. Every cleanup must leave it untouched —
that assertion is what distinguishes `deleteMany({ runId })` from
`deleteMany({})`.

---

## 6. Session propagation

The failure this must exclude:

```
write A   with    session     →  rolls back
write B   WITHOUT session     →  commits immediately, survives the abort
```

Three independent guarantees, in increasing strength:

1. **Structural.** Every write inside the callback passes `{ session }`
   explicitly. `session.inTransaction()` is asserted `true` before each write.
2. **Behavioural — the real proof.** While the transaction is open, an
   **independent connection** counts both collections by `runId` and must see
   `0` and `0`. Uncommitted transactional writes are invisible outside the
   transaction; a write that had escaped the session would be visible
   *immediately*. After commit the same reader sees `1` and `1`. The sequence
   `0 → 0 → commit → 1 → 1` is only possible if both writes were held by the
   session until the commit released them.
3. **Negative control.** A dedicated scenario deliberately omits `{ session }`
   on write B and forces the same abort. If the harness is honest it must
   report `A = 0, B = 1`. This is what makes `A = 0, B = 0` in the rollback
   proof a real observation rather than a query that could never have found
   anything either way.

---

## 7. Independent verification

```
transaction ends  →  session aborted/committed  →  session.endSession()
                                                          ↓
                              read over a SEPARATE mongoose connection
                                                          ↓
                                              assert database state
```

Verification uses a second `mongoose.Connection`, opened from the same typed
configuration URI, that never receives a session and has no session object in
scope where it is used. A session-less read on the application connection would
already be outside the transaction; the separate client removes the question
entirely.

No assertion about final state is made inside the transaction callback.

---

## 8. Cleanup safety

```
run transaction  →  verify state  →  record result  →  clean up this run
```

Cleanup happens in the test body **after** every assertion, so it cannot
manufacture a result. An `afterAll` net repeats the same per-`runId` deletion so
a *failed* test still leaves nothing behind.

| Forbidden | Present? |
|---|---|
| `dropDatabase()` | never |
| `drop()` a collection | never |
| `deleteMany({})` | never |

The two gate collections are **left in place** — empty, but not dropped. That is
deliberate: the gate must be safe to run against staging, and dropping a
collection there is a destructive operation the gate has no business performing.

Cleanup is not evidence of rollback. The rollback scenario's cleanup deletes
`0` and `0`, and that count is recorded precisely so "nothing was left behind"
is distinguishable from "cleanup removed it".

---

## 9. Local strategy

1. `docker compose -f docker-compose.dev.yml up -d --wait` — Phase 2.4's file, unmodified.
2. Ask the server directly for its topology; require `setName` and `isWritablePrimary`.
3. Run the rollback proof.
4. Run the commit proof.
5. Verify residue.

Local is marked **VERIFIED** only if both database-state assertions pass.

---

## 10. CI strategy

Requirements, each of which the job must satisfy:

| Requirement | Mechanism |
|---|---|
| Transaction-capable MongoDB | the same `docker-compose.dev.yml`, so CI and a developer prove the same thing about the same topology |
| Wait for **actual** readiness | `up -d --wait` blocks on the compose healthcheck, which initiates the replica set idempotently |
| Readiness asserted, not assumed | an explicit `hello` check that exits non-zero unless `setName` **and** `isWritablePrimary` are present |
| Gate executes | `pnpm --filter api test` |
| **Fails loudly** on unsupported transactions | no `continue-on-error`, no `\|\| true`, no conditional skip, no `if:` guard on any gate step, no try/catch that swallows a transaction error |
| Not vacuously green | Turborepo caching disabled for `test`; the suite's own negative control proves the assertions can fail |

**Chosen over** a GitHub Actions `services:` block, which cannot pass `command:`
to a container and therefore cannot start `mongod --replSet` without a custom
image. See §12 (**D1**) for the deviation this creates and its justification.

---

## 11. Staging strategy

No staging infrastructure exists in this repository — no Terraform, no
Dockerfile, no deploy workflow, no environment definition, no connection
string, and no credential. Phase 2.4 recorded the same finding.

Therefore:

```
STAGING: implementation and configuration are READY.
STAGING: verification is NOT POSSIBLE in this phase.
STAGING: it will NOT be claimed as passed.
```

The gate is already staging-compatible: it reads `MONGODB_URI` through the one
validated environment boundary and needs no code change, no flag and no
staging-specific branch. The report records the exact command, the required
topology and the required privileges.

**Staging safety**, by construction: the gate touches only
`transaction_gate_a` / `transaction_gate_b`, deletes only its own `runId`s,
drops nothing, seeds no business data, and is safe to run repeatedly.

---

## 12. Flagged deviation — D1: the CI MongoDB harness

> **This is surfaced for explicit approval. It is not silently resolved.**

**Frozen text.** Three documents name `mongodb-memory-server` in replica-set
mode as the CI MongoDB harness: `CONSISTENCY-MODEL.md` §1,
`TESTING-ARCHITECTURE.md` §5 and §10, `CONFIGURATION-ARCHITECTURE.md` §7.

**What was done instead.** CI starts the existing `docker-compose.dev.yml`
replica set.

**Measured evidence.** `mongodb-memory-server@11.2.0` was installed and its
behaviour observed:

- its `postinstall` downloads **781.1 MB** of MongoDB binaries;
- that postinstall runs on **every workspace install**, so `pnpm install
  --frozen-lockfile` in the existing `lint`, `type-check` and `build` jobs would
  each pay it, as would every frontend developer who has no use for it;
- the binaries land in `node_modules/.cache/`, which the `pnpm` store cache does
  not cover, so nothing amortises it without additional cache plumbing.

**Why the deviation is narrow.** It satisfies every *requirement* the frozen
documents impose — a real replica set in CI, a real transaction proof, loud
failure on a standalone. It changes no design decision, adds no dependency, and
touches no source file. Reversing it is a **workflow-only** change: the gate
reads `MONGODB_URI` and does not know or care what provisioned it.

**What approval decides.** Whether `CONSISTENCY-MODEL.md` §1's CI row, and its
two echoes, are amended to name Docker Compose — or whether the workflow is
changed back and the install cost accepted.

---

## 13. Explicit exclusions

Nothing below was created, installed or touched.

| Excluded | Detail |
|---|---|
| **Domain modules** | no `Users`, `Auth`, `Products`, `Catalog`, `Orders`, `Inventory`, `Pricing`, `Reviews`, `Categories`, `Brands` |
| **Domain schemas** | no `UserSchema`, `OrderSchema`, `ProductSchema`, `InventorySchema`, `CouponSchema`, `CategorySchema`, `BrandSchema`, `ReviewSchema` — no Mongoose schema of any kind |
| **Repositories & ports** | no repository, no repository port, no `BaseRepository<T>` |
| **DTOs / controllers / services** | no domain DTO, no controller, no domain service |
| **Data** | no seed, no migration, no legacy import, no business collection |
| **Fake portability** | no `DatabasePort`, no `TransactionPort`, no `UnitOfWork`, no `GenericTransactionManager` |
| **Redis** | none. `redis`, `ioredis`, `@nestjs/cache-manager` absent. OPEN-006 not reopened |
| **Providers** | no Cloudinary, S3, Resend, Zoho, SMTP |
| **Auth** | no JWT, Passport, refresh tokens, bcrypt, users |
| **Config sprawl** | **no new environment variable**; no second `.env` parser; no hardcoded URI in any source file |
| **`@nestjs/testing`** | not needed — the gate boots the real composition root through `NestFactory` |
