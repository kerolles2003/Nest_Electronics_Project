# PHASE 2.4 — MONGODB PERSISTENCE FOUNDATION PLAN

**Status:** Executed · **Date:** 2026-08-30 · **Companion:** [`PHASE-2.4-REPORT.md`](./PHASE-2.4-REPORT.md)
**Preceded by:** [`PHASE-2.3-REPORT.md`](./PHASE-2.3-REPORT.md) · **Architecture:** `ARCHITECTURE FREEZE: APPROVED`

> **No internal conflict was found** in the frozen architecture on persistence. Every narrowing below is a declared phase boundary (§10), not a reinterpretation.

---

## 1. Architecture evidence

| Decision | Frozen statement | Authority |
|---|---|---|
| **Replica set is mandatory** | "MongoDB must run as a REPLICA SET. This is a hard infrastructure requirement, not a preference." A standalone throws `IllegalOperation: Transaction numbers are only allowed on a replica set member or mongos`. | [`CONSISTENCY-MODEL.md`](../architecture/CONSISTENCY-MODEL.md) §1 |
| **Transaction gate precedes domain work** | "The first integration test written must prove a transaction rolls back with no partial writes, in every environment." | CONSISTENCY §1 |
| **`database/` is the infrastructure boundary** | Holds `DatabaseModule`, `TransactionService`, index-sync and seed scripts. **MUST NOT contain any collection schema or any query.** | [`CODEBASE-STRUCTURE.md`](../architecture/CODEBASE-STRUCTURE.md) §2.1, §2.2 Refinement 1 |
| **Persistence is module-local** | Schemas live in `modules/<m>/…`, never in `database/` and never in `providers/` | CODEBASE-STRUCTURE §6.1 |
| **No `DatabasePort`** | Pretending MongoDB is swappable would be "dishonest abstraction" — the document model was designed specifically for it | CODEBASE-STRUCTURE §2.2; freeze gate #10 |
| **Repositories exist for testability, not portability** | "Do not introduce a generic repository pattern merely because MongoDB exists." | CODEBASE-STRUCTURE §6.2 |
| **`autoIndex` never implicit** | Indexes are created by an "explicit, idempotent startup/CI step" | CODEBASE-STRUCTURE §6.1; [`OBSERVABILITY.md`](../architecture/OBSERVABILITY.md) §9 |
| **`MONGODB_URI` is a mandatory-redaction key** | Listed alongside `password`, `token`, `authorization` — "never logged in any form" | OBSERVABILITY §4 |
| **Secrets have no defaults** | "A weak default silently reaches production" | [`CONFIGURATION-ARCHITECTURE.md`](../architecture/CONFIGURATION-ARCHITECTURE.md) §11 |
| **Clean database** | No data migration of any kind; ObjectIds chosen precisely because there is no legacy data to preserve | [`MONGODB-DESIGN.md`](../architecture/MONGODB-DESIGN.md) §1; ratification C1 |
| **Config boundary owns env** | `process.env` enters in exactly one place | CONFIGURATION §1 |

**Directory placement.** The brief offered `infrastructure/database/` as a *conceptual* example and instructed following the frozen contract instead. The frozen contract is **`src/database/`** ([`CODEBASE-STRUCTURE.md`](../architecture/CODEBASE-STRUCTURE.md) §2.1), so that is what was created — no `infrastructure/` layer was introduced.

---

## 2. Existing-state audit

| Finding | Evidence |
|---|---|
| `apps/api` had **no** database dependency | deps: `@nestjs/{common,config,core,platform-express,swagger}`, `class-*`, `helmet`, `reflect-metadata`, `rxjs`, `zod` |
| Configuration boundary already established | `src/config/` with `env.schema.ts`, `app.config.ts`, `email.config.ts`, `config.module.ts` |
| **Zero literal `process.env`** in `apps/api/src` | Phase 2.3 result, re-verified |
| No Docker/Compose anywhere in the repository | `find` over the tree — none |
| No `mongod` installed; nothing listening on 27017 | `command -v mongod` → absent; `netstat` → empty |
| **Docker CLI present (29.2.1), daemon not running** | `docker --version` succeeded; `docker info` failed with a named-pipe error |
| `mongosh` present | available for replica-set inspection |
| `.gitignore` already covers `.env*` and whitelists `.env.example` | verified by exit code in Phase 2.3 |

---

## 3. Database boundary design

```
src/
├── config/
│   ├── env.schema.ts        ← MONGODB_URI validated + redacted here
│   ├── database.config.ts   ← NEW: registerAs('database') → { uri }
│   ├── app.config.ts
│   ├── email.config.ts
│   └── config.module.ts     ← loads databaseConfig
│
└── database/                ← NEW: the infrastructure boundary
    └── database.module.ts   ← connection lifecycle only
```

**What `database/` contains:** connection wiring, lifecycle logging, shutdown observability.
**What it must never contain:** a collection schema, a query, a repository, domain knowledge. A `database/users/` directory would be an architecture violation.

**Deliberately absent, by phase:**

| Not created | Owner |
|---|---|
| `TransactionService` | the transaction gate |
| Index-sync step | the phase that declares the first index |
| Seed scripts | none — the database starts clean, there is no data migration |
| Any schema, model, repository or port | domain phases |

---

## 4. Configuration design

The **existing** Phase 2.3 boundary was extended. No second environment system was created.

| Property | Decision |
|---|---|
| Variable | `MONGODB_URI` — matches the frozen inventory ([`CONFIGURATION-ARCHITECTURE.md`](../architecture/CONFIGURATION-ARCHITECTURE.md) §9) |
| Required? | **Yes, with no default.** It is a secret, and CONFIG §11 forbids defaulting secrets |
| Validation | Non-empty **and** shape-checked: `/^mongodb(\+srv)?:\/\/\S+$/` |
| Why validate the shape | So an obviously wrong value is rejected at boot instead of becoming a cryptic driver error 30 seconds later. This checks **form only** — reachability is the connection's job |
| Secret handling | Added to `SECRET_KEYS`, so its validation message is replaced with `Invalid or missing value` and never echoes the value |
| Typed exposure | `registerAs('database', () => ({ uri }))` |
| Consumer contract | `DatabaseModule` receives a validated `string`. It never parses an environment variable, checks for empty, applies a default, or inspects `NODE_ENV` |

**`MONGODB_DB_NAME` and `poolSize` were not added.** The database name travels in the URI, and no evidence justifies overriding driver pool defaults. Both are additive when a requirement appears.

### A deliberate behavioural change

Phase 2.3 left the API startable with no environment at all. **It is no longer.** `MONGODB_URI` is required, so the database is now a hard startup dependency — which is exactly the frozen semantics: the application has no degraded mode.

---

## 5. Dependency decisions

| Package | Version | Compatibility evidence | Why needed now |
|---|---|---|---|
| `@nestjs/mongoose` | **`11.0.4`** exact | peers `@nestjs/core ^10 \|\| ^11`, `@nestjs/common ^10 \|\| ^11`, `mongoose ^7 \|\| ^8 \|\| ^9`, `rxjs ^7` — all satisfied by Nest 11.2.3 / rxjs 7.8.2 | The NestJS↔Mongoose integration that owns the connection lifecycle |
| `mongoose` | **`8.24.4`** exact | `engines.node >= 16.20.1` (running 24.11.0); bundles driver `mongodb ~6.20.0` | The ODM the frozen design targets |

**Why the Nest-11 line rather than `@nestjs/mongoose@12`.** Version 12 also supports Nest 11 (`peer @nestjs/core ^11 || ^12`), so both were viable. `11.0.4` was chosen as the release aligned with our Nest major; 12 targets Nest 12, which this project cannot adopt because its CLI requires TypeScript 6 (Phase 2.2 §3).

**Why mongoose 8 rather than 9.** Both satisfy the peer range. Mongoose 8 is still actively released (107 published 8.x versions, latest `8.24.4`) and is the mature line; mongoose 9 is a recent major offering nothing this phase needs. "Do not blindly use latest versions" — a major-version jump for a phase that only opens a connection is unjustified risk.

**Both pinned exactly**, applying the Phase 2.2 lesson.

**Lockfile audit — importer by importer:**

| Importer | Result |
|---|---|
| `apps/api` | CHANGED (+2 dependencies, +17 transitive packages) |
| `apps/admin`, `apps/storefront` | **unchanged** ✅ |
| all six `packages/*` | **unchanged** ✅ |

**Zero collateral churn.** No restore-and-retry was needed.

---

## 6. Connection options

Defaults everywhere except **two**, each justified below. No `retryWrites`, `retryReads`, `serverSelectionTimeoutMS`, `socketTimeoutMS`, `family`, `useNewUrlParser` or `useUnifiedTopology` — none has evidence behind it here.

| Option | Value | Reason | Evidence |
|---|---|---|---|
| `autoIndex` | `false` | Indexes must be created by an explicit, idempotent sync step, never implicitly on model registration | **Frozen requirement** — [`CODEBASE-STRUCTURE.md`](../architecture/CODEBASE-STRUCTURE.md) §6.1, [`OBSERVABILITY.md`](../architecture/OBSERVABILITY.md) §9 |
| `retryAttempts` | `0` | `@nestjs/mongoose` retries a failed initial connection 3× by default. Combined with the driver's 30s server-selection window, an unreachable database took a **measured 296 seconds** to fail — during which the process looks hung rather than broken, and an orchestrator would likely kill it first with a less useful signal. The application has no degraded mode, so in-process retry only delays an inevitable crash; restart-with-backoff belongs to the orchestrator, which already does it properly. | **Measured**: 296s → **32s** after the change |

`serverSelectionTimeoutMS` was deliberately **left at its 30s default**: that window absorbs transient DNS and network setup, and shortening it would be tuning without evidence.

---

## 7. Connection lifecycle

```
ConfigModule validates MONGODB_URI      ← invalid/missing/empty fails HERE, before any socket
        ↓
DatabaseModule.forRootAsync(databaseConfig)
        ↓
"database connection starting"
        ↓
   ┌────┴─────────────────────────┐
success                        failure
   ↓                              ↓
"database connection            "database connection failed: <name> — <URI-scrubbed>"
 established"                    exit code 1, application never listens
   ↓
Nest application successfully started
   ↓
… serving …
   ↓  app.close() / shutdown signal
"database shutting down"        ← DatabaseModule.onApplicationShutdown
"database disconnecting"        ← mongoose close() begins
"database disconnected"         ← socket released
   ↓
process exits
```

**Observability is deliberately minimal.** Four distinguishable states, via Nest's `Logger`. No Prometheus, no OpenTelemetry, no external logging service — none is frozen for this phase.

**Nothing logs the URI.** The error handler scrubs any `mongodb://…` / `mongodb+srv://…` substring from driver messages before logging, on top of `MONGODB_URI` already being a redaction key.

**One implementation detail worth recording:** Mongoose may already be connected by the time `connectionFactory` runs, so a `'connected'` listener alone never fires. The factory therefore checks `readyState === 1` directly *and* registers the listener — without this, "database connection established" was silently never logged.

---

## 8. Startup semantics

> **Required: if the connection fails, the API must not report itself as successfully started.**

Verified by execution, not by reading framework docs:

| Case | Result |
|---|---|
| Valid URI, database unreachable | exit code **1**; `Nest application successfully started` **never printed**; never listened; ~32s |
| Missing / empty / wrong-scheme / garbage URI | exit code **1** at *configuration validation* — no connection attempted at all |

**No degraded mode exists.** There is no code path where the API serves traffic without its database.

---

## 9. Shutdown semantics

The Mongoose integration closes the connection through Nest's shutdown hooks, already enabled in `main.ts`. **No custom signal handler was added** — the framework guarantees the cleanup, and the brief forbids duplicating it.

Two independent proofs:

1. **Server-side:** MongoDB's `serverStatus().connections.current` went `5 → 6 → 5` across start and shutdown. The server itself observed the connection open and close.
2. **Lifecycle trace** via a temporary harness calling `app.close()` directly (deleted after use):

```
database connection starting
database connection established
Nest application successfully started
>>> app.close()
database shutting down
database disconnecting
database disconnected
>>> app.close() RESOLVED
```

### A correction to earlier phases' verification method

On Windows, `process.kill(pid, 'SIGINT')` against a **foreign** process terminates it rather than delivering a signal — Windows has no cross-process POSIX signal delivery. The "SIGINT shutdown verified" checks in Phases 2.2 and 2.3 therefore demonstrated **process termination and port release**, not that Nest's graceful-shutdown path ran.

That path is now genuinely verified by the two proofs above. The earlier conclusions were not wrong about the observable outcome (the process exits, the port frees), but they were weaker evidence than stated, and this records the difference.

---

## 10. Replica-set handoff

> ### **Connection readiness ≠ transaction readiness.**

Phase 2.4 proves the API can open, use and cleanly close a MongoDB connection. It proves **nothing** about transactions.

| Fact | Status |
|---|---|
| API connects to MongoDB | ✅ verified |
| Connection closes cleanly on shutdown | ✅ verified |
| Local topology used during verification is a single-node **replica set** | ✅ `rs.status()` → `set: rs0`, 1 member, `PRIMARY` |
| **A transaction commits** | ⬜ **NOT TESTED** |
| **A transaction rolls back with no partial writes** | ⬜ **NOT TESTED — this is the gate** |
| Transactions work in CI | ⬜ **NOT TESTED** — no MongoDB was added to CI |
| Transactions work in staging | ⬜ **NOT TESTED** — no staging exists |

**`docker-compose.dev.yml` is database-availability infrastructure, not gate verification.** It provides a replica set because the frozen architecture requires one locally and because the gate will need it — but running it proves availability only.

A standalone MongoDB would have satisfied every check in this phase. **That is precisely why connection success must not be read as transaction success.**

The implementation stays compatible with transactional sessions: a real `mongoose.Connection` is exposed through the standard integration, so `connection.startSession()` and `session.withTransaction()` are available to the gate with no rework. No transaction code, helper or test was written.

---

## 11. Local development infrastructure

`docker-compose.dev.yml` (repository root, matching the layout Phase 2.0 §5 planned) runs `mongo:8.0` as a **single-node replica set**, self-initiating through an idempotent healthcheck, bound to `127.0.0.1` only, with no credentials.

It was added because it was **necessary**, not because it is common: no `mongod` is installed and nothing listens on 27017, so without it the required connection verification was impossible.

`directConnection` is deliberately **not** used — it bypasses replica-set topology discovery and would break transactions later.

**CI was not touched.** No MongoDB service, no transaction test, no claim of CI transaction support. The gate owns that.

---

## 12. Explicit exclusions

| Not done | Why |
|---|---|
| Any domain module | Forbidden |
| Any schema, model, repository, port, service, controller, DTO | Forbidden |
| `TransactionService`, any transaction code or test | The gate owns it |
| Any business collection or seed data | The database stays empty from the application's perspective; connection verification used **no** application collection |
| Any migration or import script | Clean database; there is no legacy data |
| `DatabasePort` / `PersistencePort` / `GenericRepository<T>` | Explicitly rejected by the freeze |
| Terminus / database health indicator | Health architecture is untouched (§13) |
| Redis, provider SDK, auth | Later phases |
| `MONGODB_DB_NAME`, `poolSize` | No consumer; the db name is in the URI |
| CI database service | The gate owns it |

---

## 13. Health endpoint — unchanged

`GET /api/v1/health` still returns exactly `{"status":"ok"}`, and `src/health/` contains **zero** database references (verified by grep). No Terminus, no readiness indicator, no health redesign.

> The **envelope ambiguity remains unresolved and inherited**: [`API-CONTRACT.md`](../architecture/API-CONTRACT.md) §3 "one envelope, always" versus [`API-STANDARDS.md`](../architecture/API-STANDARDS.md) §10's bare health payload. This phase neither resolved nor advanced it.

Making health database-aware would require reopening the readiness architecture, which the brief forbids. The frozen end state (`/health/ready` asserting replica-set availability via Terminus) therefore stays deferred — a limitation recorded, not a redesign.
