# PHASE 2.5 — MONGODB TRANSACTION HARD GATE · REPORT

**Date:** 2026-08-30 · **Git:** no commit, no push · `HEAD` = `dc7768b`
**Plan:** [`PHASE-2.5-TRANSACTION-GATE-PLAN.md`](./PHASE-2.5-TRANSACTION-GATE-PLAN.md)

> **SUPERSEDED IN PART by Phase 2.5.1** — see [`PHASE-2.5.1-REPORT.md`](./PHASE-2.5.1-REPORT.md)
> and [`ENVIRONMENT-RATIFICATION.md`](../architecture/ENVIRONMENT-RATIFICATION.md).
> This record is retained unedited because it was accurate when written.
> Two things changed after it: the **environment model** (development moved to
> MongoDB Atlas; staging is recorded as not provisioned rather than blocking),
> and the **gate classification** (transaction *implementation* is approved
> separately from per-environment verification). **Deviation D1 (§15) was
> ratified** — the Docker Compose CI harness is now the approved tooling.
> Every piece of executed evidence below stands unchanged.

> ## HARD-GATE VERDICT: **BLOCKED**
> Local is **VERIFIED** by executed database-state proofs. CI is **READY** —
> implemented and provisioned, GitHub-hosted execution not yet run. Staging is
> **BLOCKED** — the infrastructure does not exist, and verification against it
> is therefore impossible, not merely outstanding.
>
> The frozen requirement is a rollback proof **in every environment**
> (`CONSISTENCY-MODEL.md` §1). Two of three environments lack execution
> evidence, so the gate is not passed. **No domain module may begin.**

---

## 1. Required evidence matrix

| Environment | Infrastructure | Rollback | Commit | Status |
|---|---|---|---|---|
| **Local** | **Verified** — `rs0`, 1 member, PRIMARY, MongoDB 8.0.29, interrogated via `hello` | **Pass** | **Pass** | **VERIFIED** |
| **CI** | **Provisioned** — job added, compose replica set, readiness assertion, no failure suppression. Every step executed on this machine; **not** executed on a GitHub runner | **Not run** (on GitHub) | **Not run** (on GitHub) | **READY** |
| **Staging** | **Not provisioned** — no staging infrastructure exists in this repository | **Not run** | **Not run** | **BLOCKED** |

`READY` ≠ `VERIFIED`. Nothing below claims otherwise.

---

## 2. Files created

| File | Purpose |
|---|---|
| `apps/api/src/database/transaction.service.ts` | `TransactionService` — the single place a transaction is opened. Wraps `session.withTransaction` with the frozen concerns. No domain knowledge, no query, no collection name. |
| `apps/api/test/infrastructure/transaction-gate.spec.ts` | The gate. Topology check, commit proof, rollback proof, negative control. |
| `apps/api/jest.config.js` | Jest configuration — 30 lines, no coverage thresholds, no setup file. |
| `docs/phase-2/PHASE-2.5-TRANSACTION-GATE-PLAN.md` | This phase's plan. |
| `docs/phase-2/PHASE-2.5-REPORT.md` | This document. |

## 3. Files modified

| File | Change | Why |
|---|---|---|
| `apps/api/src/database/database.module.ts` | `providers: [TransactionService]`, `exports: [TransactionService]`; removed `TransactionService` from the "NOT here yet" list | The frozen home for it (`CODEBASE-STRUCTURE.md` §2.1) |
| `apps/api/package.json` | `+ "test": "jest"`; `lint` → `eslint src test`; 3 devDependencies | The gate must be runnable and lintable |
| `apps/api/tsconfig.json` | `include` gains `test/**/*`; `rootDir` removed | One program for `tsc --noEmit`, ESLint `projectService` and ts-jest |
| `apps/api/tsconfig.build.json` | gains `"rootDir": "./src"` and `"include": ["src/**/*"]` | Emit boundary moves here, so `dist/` keeps its exact shape and tests never reach the compiler |
| `turbo.json` | `test` task: `"cache": false`, `"env": ["MONGODB_URI"]` | Without `cache: false` a second `pnpm test` is a **cache hit** — a vacuously green infrastructure gate. Without `env` Turborepo's strict env mode hides `MONGODB_URI` from the task (observed: the run failed with `MONGODB_URI Invalid or missing value`). |
| `.github/workflows/ci.yml` | `transaction-gate` job added; header comment corrected | Step 9 of this phase. This file was **staged** by Phase 2.1 and is now `AM` — an intended, in-scope modification, called out in §16. |
| `pnpm-lock.yaml` | `apps/api` importer only | 3 devDependencies |

**Not touched:** `docker-compose.dev.yml` (Phase 2.4's file, used exactly as delivered) · `apps/api/.env.example` (no new variable) · `src/config/**` · `src/common/**` · `src/health/**` · `src/main.ts` · `src/app.module.ts` · every other workspace.

---

## 4. Dependencies added — exact versions

| Package | Requested | Resolved | Why | Alternatives rejected |
|---|---|---|---|---|
| `jest` | `30.5.0` **exact** | 30.5.0 | The frozen runner: `TESTING-ARCHITECTURE.md` §10 — "Jest — the NestJS default" | `vitest` — would be a silent change to a frozen decision. `node --test` — zero-dependency, but needs a TypeScript loader anyway and abandons the frozen runner for the entire future suite. |
| `ts-jest` | `29.4.12` **exact** | 29.4.12 | Compiles with the project `tsconfig`, so `emitDecoratorMetadata` (required by Nest DI) is honoured **and a type error fails the test run** | `@swc/jest` — faster, but drops type checking, which is a real gate here. `babel-jest` — no decorator metadata. |
| `@jest/globals` | `30.5.0` **exact** | 30.5.0 | Explicit `import { describe, it, expect }` | `@types/jest` — would inject Jest globals into the type environment of **all** of `src/`, where they do not belong. |

**Peer compatibility, checked before installing:** `ts-jest@29.4.12` declares
`jest: ^29.0.0 || ^30.0.0` and `typescript: >=4.3 <7` — both satisfied
(`jest@30.5.0`, `typescript@5.9.3`). `jest@30` requires Node `^18.14 || ^20 || >=22`;
CI pins Node 20, local ran Node v24.11.0.

**Not added:** `@nestjs/testing` (unnecessary — the gate boots the real
composition root through `NestFactory`), `supertest`, Redis, any provider SDK,
any auth library.

### 4.1 `mongodb-memory-server` — installed, measured, removed

The frozen CI harness was installed at `11.2.0` and measured before being
rejected. Its `postinstall` downloaded **781.1 MB** of MongoDB binaries, and it
runs on *every* workspace install — so the existing `lint`, `type-check` and
`build` jobs would each have paid it, as would every frontend developer. The
binaries land in `node_modules/.cache/`, outside the pnpm store cache.

It was removed, its cache directory deleted, and the lockfile now contains
**0 occurrences** of the string `mongodb-memory-server`. See §15 (**D1**).

**Environment variables added: none.** `MONGODB_URI` already existed from
Phase 2.4 and is used unchanged, through the same validated boundary.

---

## 5. Transaction implementation

`apps/api/src/database/transaction.service.ts` — one method:

```ts
async run<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await this.connection.startSession();
  try {
    return await session.withTransaction(work, TRANSACTION_OPTIONS);
  } finally {
    await session.endSession();
  }
}
```

| Frozen concern (`CONSISTENCY-MODEL.md` §7) | Applied |
|---|---|
| Read concern `snapshot` | `readConcern: { level: 'snapshot' }` |
| Write concern `majority` + journal | `writeConcern: { w: 'majority', j: true }` |
| Read preference `primary` | `readPreference: 'primary'` |
| Transaction timeout 15 s | `maxCommitTimeMS: 15_000` — applied to the **commit budget**. A full end-to-end CSOT budget is **not** set: sizing it needs a measured operation, and guessing one now would be tuning without evidence. Recorded here rather than left implicit. |
| Retryable writes | driver default, unchanged |

**What it deliberately is not:** no `TransactionPort`, no `UnitOfWork`, no
`GenericTransactionManager`, no `DatabasePort`. `PORTS-AND-CONTRACTS.md` §4
lists `TransactionService` under *where contracts do NOT exist* — "a thin
wrapper over the Mongo session API" — and §5 records that database portability
is a dishonest abstraction for this system. It has one method because one method
is what the gate needs; an API shaped for callers that do not exist yet would be
guesswork frozen into code.

**No domain knowledge:** the file contains no collection name, no query, no
schema, no business rule. Grep-verified.

---

## 6. Rollback evidence

Executed against local `rs0`. Independent reads, after the session ended.

```
rollback  run=69e07a01-51ee-4e4f-b777-b24daa30a9fb
          {"attempts":1,
           "acknowledgedA":true,"acknowledgedB":true,
           "insertedIdA":"6a94239fabf180a8026b6545",
           "insertedIdB":"6a94239fabf180a8026b6546",
           "visibleOutsideA":0,"visibleOutsideB":0}
rollback  run=69e07a01-51ee-4e4f-b777-b24daa30a9fb  A=0  B=0
```

| Assertion | Observed |
|---|---|
| Both writes actually reached the server | `acknowledged: true` for A and B, with server-assigned `insertedId`s. `0` afterwards therefore means **undone**, not **never written**. |
| Failure forced **after** both writes | `ForcedGateFailure` thrown as the last statement of the callback |
| Failure is deterministic | a plain in-process `throw`. No network fault, no timing window, no killed process, no database crash. |
| Exactly one attempt | `attempts: 1` — the error carries no `TransientTransactionError` label, so `withTransaction` does not retry |
| The expected error propagated | `.rejects.toThrow(ForcedGateFailure)` — the caller's own error, not a driver error |
| `transaction_gate_a` count for this `runId` | **0** |
| `transaction_gate_b` count for this `runId` | **0** |
| Documents returned by `find({ runId })` | `[]` and `[]` |

---

## 7. Commit evidence

```
commit    run=e66841ae-72cb-4966-af7b-ed070e90e42f
          {"inTransactionBeforeA":true,"inTransactionBeforeB":true,
           "acknowledgedA":true,"acknowledgedB":true,
           "visibleOutsideA":0,"visibleOutsideB":0}
commit    run=e66841ae-72cb-4966-af7b-ed070e90e42f  A=1  B=1
```

| Assertion | Observed |
|---|---|
| `transaction_gate_a` count for this `runId` | **1** |
| `transaction_gate_b` count for this `runId` | **1** |
| Neither was visible before the commit | `visibleOutsideA: 0`, `visibleOutsideB: 0` |

Rollback alone would not prove transactions are correctly *committing* — a
connection that silently discarded every write would pass a rollback test.

---

## 8. Session propagation proof

Three independent guarantees, all executed:

**1 — Structural.** Every write inside the callback passes `{ session }`.
`session.inTransaction()` asserted `true` immediately before each:
`inTransactionBeforeA: true`, `inTransactionBeforeB: true`.

**2 — Behavioural, the real proof.** While the transaction was open, a
**separate mongoose connection** counted both collections by `runId`:

```
inside the transaction, read from another client:   A=0   B=0
after commit,           read from another client:   A=1   B=1
```

Uncommitted transactional writes are invisible outside the transaction. A write
that had escaped the session would have been visible *immediately*. The
sequence `0 → 0 → commit → 1 → 1` is only possible if both writes were held by
the session until the commit released them.

**3 — Negative control — the harness is not vacuous.**

```
control   run=c8136061-6b7c-4681-89a4-2cb585914798
          A=0 (rolled back)  B=1 (escaped the transaction)
```

A dedicated scenario writes A **with** the session and B **without** it, then
forces the identical abort. The harness reports `A = 0, B = 1`. This is direct
evidence that the verification queries **can** observe a write that escaped the
transaction — so `A = 0, B = 0` in §6 is a real observation, not a query that
could never have found anything either way.

---

## 9. Independent-read proof

```
transaction ends → session aborted/committed → session.endSession()
                                                      ↓
                    read over a SEPARATE mongoose.Connection
                                                      ↓
                                          assert database state
```

- Verification uses a second `mongoose.Connection`, opened from the same typed
  configuration URI (`app.get(databaseConfig.KEY).uri` — the file never reads
  `process.env` and never parses a connection string).
- That connection never receives a session, and no session object is in scope
  where it is used.
- **No assertion about final state is made inside the transaction callback.**
- Writes go through the **application's own** connection —
  `app.get(getConnectionToken())`, the connection `DatabaseModule` opened — so
  what is proved is the infrastructure production runs, not a test-local
  imitation.

The gate boots `AppModule` itself via `NestFactory.createApplicationContext`,
so `ConfigModule` validates `MONGODB_URI` through the single environment
boundary and `DatabaseModule` connects with the same `autoIndex: false` /
`retryAttempts: 0` options production uses.

---

## 10. Topology evidence

Asked of the server, not inferred from a filename or a variable name.

```
topology  {"setName":"rs0","isWritablePrimary":true,"msg":null,
           "me":"localhost:27017","serverVersion":"8.0.29","maxWireVersion":25}
```

`rs.status()` independently: `set=rs0  members=1  state=PRIMARY`.

### 10.1 Standalone rejection — executed, not asserted

A real standalone `mongod` (`mongo:8.0`, no `--replSet`, port 27018) was started
and the gate pointed at it:

```
topology  {"setName":null,"isWritablePrimary":true,...}
FAIL test/infrastructure/transaction-gate.spec.ts
  ● runs against a transaction-capable topology, not a standalone
      Expected: true   Received: false
  ● commits: …
      MongoServerError: Transaction numbers are only allowed on a replica set member or mongos
  ● rolls back: …
      Received constructor: MongoServerError
  ● negative control: …
      Received constructor: MongoServerError

Tests: 4 failed, 4 total          EXIT=1
```

**Exit code 1. Four failures. No skip, no catch, no green.** Note that the
standalone reported `isWritablePrimary: true` — which is exactly why the check
requires `setName` (or `msg === 'isdbgrid'`) and never trusts "primary" alone.

---

## 11. Cleanup evidence

**Order — verification strictly precedes cleanup.** Cleanup runs in the test
body after every assertion; an `afterAll` net repeats the per-`runId` deletion
so a *failed* test also leaves nothing behind. Cleanup can therefore never
manufacture a result.

| Scenario | Deleted | Meaning |
|---|---|---|
| Commit | `{ a: 1, b: 1 }` | removed exactly what it committed |
| Rollback | `{ a: 0, b: 0 }` | **nothing to remove** — the rollback, not the cleanup, produced `0` |
| Negative control | `{ a: 0, b: 1 }` | removed only the write that escaped |

**Isolation proved, not assumed.** A document under a foreign `runId` was
inserted directly into both collections, then the gate was run **three times
consecutively**:

```
gate run #1   4 passed
gate run #2   4 passed
gate run #3   4 passed

transaction_gate_a  total=1  foreign=1
transaction_gate_b  total=1  foreign=1
docs in A: [{"runId":"PRE-EXISTING-OTHER-RUN","marker":"must survive"}]
docs in B: [{"runId":"PRE-EXISTING-OTHER-RUN","marker":"must survive"}]
```

The foreign document survived all three runs untouched; the gate's own runs left
zero residue. This is the property that makes it safe against staging.

**Even the failing standalone run cleaned up** — after four failures, both
collections held 0 documents.

| Forbidden operation | Present in the gate? |
|---|---|
| `dropDatabase()` | **never** |
| `drop()` a collection | **never** |
| `deleteMany({})` | **never** |

Both collections are left **in place but empty**. Dropping them is a destructive
operation the gate has no business performing against staging.

**No application collection was created or touched.** After all runs the
database contains exactly `transaction_gate_a` and `transaction_gate_b`.

---

## 12. Local status — **VERIFIED**

| Step | Result |
|---|---|
| `docker compose … up -d --wait` from an **empty volume** | Healthy PRIMARY in **7 s** |
| Topology | `rs0`, 1 member, PRIMARY, MongoDB 8.0.29 |
| Rollback proof | **Pass** — A=0, B=0 |
| Commit proof | **Pass** — A=1, B=1 |
| Session propagation | **Pass** — 0→0→commit→1→1, plus negative control |
| Cleanup | **Pass** — 0 residue, foreign run untouched |
| Repeatability | **Pass** — 3 consecutive runs |
| Suite | `Test Suites: 1 passed · Tests: 4 passed` · exit 0 · 3.5 s |

Connection target is not printed anywhere: `MONGODB_URI` remains on the
`SECRET_KEYS` redaction list and appears in no log line, no error and no
assertion message. Verified by grep across every captured run.

## 13. CI status — **READY**, not verified

**Implemented.** A `transaction-gate` job (`.github/workflows/ci.yml`):
`checkout` → `pnpm/action-setup` → `setup-node@20` → `pnpm install
--frozen-lockfile` → `docker compose … up -d --wait` → assert PRIMARY →
`pnpm --filter api test` → `docker compose … down -v`.

**Executed here — every step, on this machine, in order:**

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `docker compose -f docker-compose.dev.yml up -d --wait` (cold volume) | Healthy in 7 s |
| The job's exact `mongosh` PRIMARY assertion | `replica set rs0 PRIMARY at localhost:27017, server 8.0.29` · exit 0 |
| `pnpm --filter api test` against a **cold, empty** database | 4 passed · exit 0 |
| Workflow YAML | parses; the folded `run:` scalar produces the intended shell command |

**Not executed:** the job on a GitHub-hosted runner. The workflow file has never
been committed (`HEAD` = `dc7768b`; the file is staged from Phase 2.1), and this
phase makes no commit and no push by explicit decision. **CI is therefore READY,
not VERIFIED**, and this report claims nothing more.

**Failure-loudness properties, by construction:**

| Requirement | Status |
|---|---|
| `continue-on-error` | **absent** from every job |
| `\|\| true`, `set +e`, swallowed exit codes | **absent** |
| Conditional skip of the gate | **absent** — the only `if:` is `always()` on the container teardown, which cannot affect the outcome |
| `test.skip` / `it.skip` / `describe.skip` in the suite | **absent** |
| `try/catch` around a transaction | **absent** — the only `catch` is `NamespaceExists (48)` during collection pre-creation, outside any transaction |
| Vacuous green via Turborepo cache | **prevented** — `test` has `"cache": false`; observed `cache bypass, force executing` on consecutive runs |
| Vacuous green via a never-failing assertion | **disproved** by the negative control and by the standalone run (§10.1) |

**To convert READY → VERIFIED:** commit and push; read the `Transaction gate`
job result. No code change is required.

## 14. Staging status — **BLOCKED**

No staging infrastructure exists in this repository. Searched: no Terraform, no
`Dockerfile`, no deploy or CD workflow, no `infra/`, `deploy/`, `fly.toml`,
`render.yaml` or `railway.json`, no staging environment definition, no staging
connection string, no credential. `.env` at the repository root is **0 bytes**.
Phase 2.4 recorded the same finding.

```
Staging verification was NOT performed and is NOT claimed.
```

**What is ready.** The gate is staging-compatible with no code change, no flag
and no staging-specific branch: it reads `MONGODB_URI` through the one
validated environment boundary and interrogates whatever server answers.

**Exact command:**

```bash
MONGODB_URI='<staging replica-set connection string>' pnpm --filter api test
```

**Required of staging:**

| Requirement | Detail |
|---|---|
| Topology | replica set or `mongos` — Atlas **M10+** or a self-hosted 3-node set. M0/M2/M5 shared tiers are excluded by `CONSISTENCY-MODEL.md` §1 |
| Privileges | `readWrite` on the target database, plus `createCollection`; `hello` and `buildInfo` on `admin` (both granted to any authenticated user by default) |
| Blast radius | creates at most `transaction_gate_a` / `transaction_gate_b`; writes and deletes only its own `runId`s; drops nothing; seeds nothing |
| Safety | proved repeatable — three consecutive runs left a foreign document untouched and zero residue (§11) |

**The architecture gate remains incomplete until staging evidence exists.**

---

## 15. Flagged deviation — D1: the CI MongoDB harness

> **Surfaced for explicit approval. Not silently resolved.**

Three frozen documents name `mongodb-memory-server` in replica-set mode as the
CI MongoDB harness — `CONSISTENCY-MODEL.md` §1, `TESTING-ARCHITECTURE.md` §5 and
§10, `CONFIGURATION-ARCHITECTURE.md` §7. **CI instead starts the existing
`docker-compose.dev.yml` replica set.**

| | |
|---|---|
| **Measured evidence** | 781.1 MB postinstall download, on **every** workspace install — so `lint`, `type-check` and `build` would each pay it, as would every frontend developer. Cached in `node_modules/.cache/`, outside the pnpm store cache. |
| **What the deviation preserves** | Every *requirement*: a real replica set in CI, a real transaction proof against it, loud failure on a standalone. Zero new dependencies. CI and local prove the same thing about the same artefact. |
| **What it costs** | A `docker compose` step in one job. |
| **Why not a `services:` block** | GitHub Actions service containers cannot take `command:`, so they cannot start `mongod --replSet` without a custom image. |
| **Reversibility** | **Workflow-only.** No source file knows what provisioned MongoDB; the gate reads `MONGODB_URI`. |
| **Decision required** | Amend `CONSISTENCY-MODEL.md` §1's CI row (and its two echoes) to name Docker Compose — or revert the workflow and accept the install cost. |

The Phase 2.5 verdict does not depend on this: the gate is proved against a real
replica set either way.

---

## 16. Build / type-check / lint / frozen-lockfile

| Check | Command | Result |
|---|---|---|
| Build | `pnpm --filter api build` | ✅ exit 0 — `dist/main.js` present, `dist/{common,config,database,health}/` intact, **no `*.spec.js` emitted** |
| Type-check | `pnpm --filter api type-check` | ✅ exit 0 — now covers `src/` **and** `test/` |
| Lint | `pnpm --filter api lint` | ✅ exit 0, 0 errors, 0 warnings — now covers `src/` **and** `test/` |
| Frozen lockfile | `pnpm install --frozen-lockfile` | ✅ exit 0 |
| Turbo test discovery | `turbo test` | ✅ `api#test` — `cache bypass, force executing` on every run |

**Workspace regression — identical to the Phase 2.4 baseline in count and identity:**

| Task | Result | Baseline |
|---|---|---|
| `turbo lint --continue` | 1 successful / 4 — fails `@nest/ui`, `admin`, `storefront` | identical |
| `turbo type-check --continue` | 1 successful / 2 — fails `admin` | identical |
| `turbo build --continue` | 1 successful / 3 — fails `admin`, `storefront` | identical |

**Zero regressions.**

**Lockfile impact:** the `apps/api` importer only. Verified per-importer —
`apps/admin`, `apps/storefront`, `packages/{config,providers,repositories,services,types,ui}`
and the root list none of the new packages. `mongodb-memory-server` appears
**0 times**.

---

## 17. Regression results

Re-verified against the running binary, database connected.

| Behaviour | Result |
|---|---|
| `GET /api/v1/health` | ✅ `200` · `{"status":"ok"}` — **byte-identical** |
| All five security headers (HSTS · nosniff · `X-Frame-Options: DENY` · Referrer-Policy · CSP) | ✅ unchanged |
| Unknown route envelope | ✅ `{"error":{"code":"RESOURCE_NOT_FOUND",…}}` unchanged |
| `X-Request-Id` echo | ✅ `phase25-trace` echoed |
| `GET /api/health`, `GET /health` | ✅ 404, 404 |
| Swagger `docs-json` | ✅ 200 |
| **Startup behaviour** | ✅ unchanged — `database connection starting` → `database connection established` → `Nest application successfully started`, same order |
| **Database-failure behaviour** | ✅ unchanged — unreachable database: exit **1**, **31 s**, `successfully started` **never** printed, HTTP port never opened, no URI in the log |
| Missing `MONGODB_URI` | ✅ exit 1 — `MONGODB_URI  Invalid or missing value` |
| Invalid `MONGODB_URI` carrying a password | ✅ exit 1, **password not echoed** (grep count 0) |
| **Graceful shutdown** | ✅ unchanged — trace **identical** to Phase 2.4's, with `TransactionService` now in the module |
| MongoDB connection release | ✅ server-side `connections.current` 7 → 5 after the process stopped |

Shutdown trace, captured against the freshly built `dist/`:

```
[Database] database connection starting
[Database] database connection established
[InstanceLoader] DatabaseModule dependencies initialized
>>> app.close()
[Database] database shutting down          ← DatabaseModule.onApplicationShutdown
[Database] database disconnecting
[Database] database disconnected
>>> app.close() RESOLVED
```

**Health envelope ambiguity: still unresolved, still inherited.** No envelope
interceptor, no Terminus, no health redesign.

---

## 18. Git boundary

| Class | Count | Delta vs Phase 2.4 | Contents |
|---|---|---|---|
| **Untracked** | **121** | **+5** | `transaction.service.ts`, `transaction-gate.spec.ts`, `jest.config.js` + these 2 documents |
| **Modified, unstaged** | **61** | **+1** | `turbo.json`. `pnpm-lock.yaml` was already in this set; the other 59 are pre-existing |
| **Deleted, unstaged** | **21** | **0** | pre-existing |
| **Staged (Phase 2.1)** | **64** | **0** | `.github/workflows/ci.yml` moved `A ` → `AM` — modified in place, as Step 9 requires |

`apps/api` is **wholly untracked**, so this phase's edits to `package.json`,
`tsconfig.json`, `tsconfig.build.json` and `database.module.ts` stay inside the
existing `??` set and produce no new ` M` rows.

**No pre-existing dirty-tree file was modified.** The two tracked files this
phase touched — `turbo.json` and `.github/workflows/ci.yml` — are both in scope
(anti-vacuous-green, and CI integration). The pre-existing ` M
packages/services/package.json` and the 59 front-end files are untouched.

> ✅ **No commit created.** `HEAD` is still `dc7768b`.
> ✅ **No push performed.** `main` in sync with `origin/main`.
> ✅ No branch created, no tag, no remote operation of any kind.

**Machine state:** the local replica-set container is left **running** with its
named volume intact; `docker compose -f docker-compose.dev.yml down -v` removes
both. The temporary standalone container used for §10.1 was removed. The
`mongodb-memory-server` binary cache was deleted.

---

## 19. Final checklist

| # | Check | Result |
|---|---|---|
| 1 | Architecture re-read | ✅ 6 mandated documents + `CONSISTENCY-MODEL`, `TESTING-ARCHITECTURE`, `CONFIGURATION-ARCHITECTURE`, `MONGODB-DESIGN`, `ANTI-OVERENGINEERING` |
| 2 | Frozen transaction requirements preserved | ✅ 16 extracted, all honoured (plan §1) |
| 3 | No architecture conflict silently resolved | ✅ none found; **D1 flagged**, not resolved |
| 4 | No domain module created | ✅ |
| 5 | No domain schema created | ✅ no Mongoose schema of any kind |
| 6 | No domain repository created | ✅ |
| 7 | No repository port created | ✅ |
| 8 | No domain DTO created | ✅ |
| 9 | No domain controller created | ✅ |
| 10 | No business data seeded | ✅ |
| 11 | No migration created | ✅ |
| 12 | Test persistence clearly isolated | ✅ `transaction_gate_a` / `transaction_gate_b`, two fields, names only in `test/` |
| 13 | Unique `runId` per execution | ✅ `randomUUID()` |
| 14 | Verification filters by `runId` | ✅ every query |
| 15 | Cleanup filters by `runId` | ✅ every deletion |
| 16 | Cleanup never drops a database | ✅ |
| 17 | Cleanup never clears a whole collection | ✅ proved — a foreign document survived 3 runs |
| 18 | Rollback failure occurs after both writes | ✅ both `acknowledged`, both with `insertedId` |
| 19 | Rollback verification after transaction completion | ✅ after `endSession()` |
| 20 | Rollback verification uses independent reads | ✅ separate `mongoose.Connection` |
| 21 | Rollback proves A = 0 | ✅ |
| 22 | Rollback proves B = 0 | ✅ |
| 23 | Commit proves A = 1 | ✅ |
| 24 | Commit proves B = 1 | ✅ |
| 25 | Every transactional write joins the same session | ✅ |
| 26 | Session propagation explicitly verified | ✅ three ways, incl. a negative control |
| 27 | Local rollback executed | ✅ |
| 28 | Local commit executed | ✅ |
| 29 | Local marked VERIFIED only because both passed | ✅ |
| 30 | CI infrastructure transaction-capable | ✅ replica set; readiness asserted, not assumed |
| 31 | CI does not skip transaction failures | ✅ no skip, no catch, no `continue-on-error` |
| 32 | CI fails loudly on unsupported transactions | ✅ **executed** against a standalone: exit 1, 4 failures |
| 33 | CI marked VERIFIED only with execution evidence | ✅ marked **READY** — it has not run on GitHub |
| 34 | Staging marked VERIFIED only with execution evidence | ✅ marked **BLOCKED** — no staging exists |
| 35 | No staging data outside a gate run modified | ✅ nothing ran against staging |
| 36 | No Redis dependency | ✅ |
| 37 | No provider SDK | ✅ |
| 38 | No auth implementation | ✅ |
| 39 | No fake database portability abstraction | ✅ no `DatabasePort` / `TransactionPort` / `UnitOfWork` |
| 40 | Build passes | ✅ |
| 41 | Type-check passes | ✅ now including `test/` |
| 42 | Lint passes | ✅ now including `test/` |
| 43 | `pnpm install --frozen-lockfile` passes | ✅ |
| 44 | Health behaviour unchanged | ✅ byte-identical |
| 45 | Database startup behaviour unchanged | ✅ |
| 46 | Database failure behaviour unchanged | ✅ exit 1, 31 s, never listened |
| 47 | Shutdown behaviour unchanged | ✅ identical trace |
| 48 | Pre-existing dirty-tree files unmodified | ✅ |
| 49 | Phase 2.5 changes identifiable in git status | ✅ §18 |

---

## 20. Verdict

```
HARD GATE: BLOCKED

LOCAL      VERIFIED   rollback pass · commit pass · observed database state
CI         READY      implemented, provisioned, locally executed end to end;
                      never run on a GitHub runner
STAGING    BLOCKED    infrastructure does not exist; nothing was executed
                      and nothing is claimed
```

**Phase 2.5 has produced the proof it can produce and has not claimed the proof
it cannot.** The transaction infrastructure is real, correct against a real
replica set, and demonstrably able to fail.

**No domain module may begin.** The frozen gate requires the rollback proof in
every environment.

### What remains

1. **Commit and push**, then read the `Transaction gate` job result → CI VERIFIED. No code change.
2. **Provision staging** with a replica set, then run
   `MONGODB_URI='…' pnpm --filter api test` → STAGING VERIFIED. No code change.
3. **Rule on D1** (§15) — amend the three frozen documents, or revert the CI harness.

Outstanding from earlier phases, none blocking: revoke the `agentrouter.org`
credential; review and commit Phase 2.1's 64 staged files; commit
`packages/services/package.json` with `pnpm-lock.yaml`; resolve the
health-envelope ambiguity before the envelope-interceptor phase.
