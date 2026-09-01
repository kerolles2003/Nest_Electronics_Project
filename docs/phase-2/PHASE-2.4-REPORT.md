# PHASE 2.4 — MONGODB PERSISTENCE FOUNDATION REPORT

**Date:** 2026-08-30 · **Outcome:** Complete · **Git:** no commit, no push
**Plan:** [`PHASE-2.4-MONGODB-PLAN.md`](./PHASE-2.4-MONGODB-PLAN.md)

> ### Connection readiness ≠ transaction readiness.
> This phase proved the API connects to MongoDB and closes cleanly. It proved **nothing** about transactions. The transaction gate has **not** run and is **not** claimed as passed. See §11.

---

## 1. Files created

| File | Purpose |
|---|---|
| `apps/api/src/database/database.module.ts` | The persistence infrastructure boundary: `MongooseModule.forRootAsync` fed by typed config, lifecycle logging, URI-scrubbing error handler, `OnApplicationShutdown` hook |
| `apps/api/src/config/database.config.ts` | `registerAs('database', () => ({ uri }))` |
| `docker-compose.dev.yml` | Local **single-node replica set** (`mongo:8.0`), self-initiating, loopback-bound, no credentials |

---

## 2. Files modified

| File | Change |
|---|---|
| `apps/api/src/config/env.schema.ts` | `MONGODB_URI` added — required, no default, shape-validated; added to `SECRET_KEYS` |
| `apps/api/src/config/config.module.ts` | `databaseConfig` added to `load` |
| `apps/api/src/app.module.ts` | `DatabaseModule` imported; removed from the deferred-modules comment |
| `apps/api/.env.example` | `MONGODB_URI` documented; the "every variable is optional" note corrected |
| `apps/api/package.json` | +2 dependencies |
| `pnpm-lock.yaml` | `apps/api` importer only |

**Nothing else.** `.gitignore`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig*.json`, the CI workflow, `src/health/**`, `src/common/**`, `src/main.ts`, every other workspace manifest, and all front-end source are untouched.

---

## 3. Dependencies added — exact versions

| Package | Requested | Resolved | Compatibility |
|---|---|---|---|
| `@nestjs/mongoose` | `11.0.4` **exact** | 11.0.4 | peers `@nestjs/core ^10 \|\| ^11`, `@nestjs/common ^10 \|\| ^11`, `mongoose ^7 \|\| ^8 \|\| ^9`, `rxjs ^7` — all satisfied |
| `mongoose` | `8.24.4` **exact** | 8.24.4 | `engines.node >= 16.20.1`; bundles driver `mongodb ~6.20.0` |

`@nestjs/mongoose@12` also supports Nest 11, but `11.0.4` is the release aligned with our Nest major. Mongoose 8 was chosen over 9 because it is the mature, still-actively-released line (107 published 8.x versions) and a major-version jump buys nothing for a phase that only opens a connection.

**Not added:** `@nestjs/terminus`, Redis, any provider SDK, any auth library.

---

## 4. Environment variables added

| Variable | Required | Default | Validation | Secret |
|---|---|---|---|---|
| `MONGODB_URI` | **Yes** | **None** — secrets have no defaults | non-empty **and** `/^mongodb(\+srv)?:\/\/\S+$/` | **Yes** — in `SECRET_KEYS`; never logged, never echoed in an error |

> **Behavioural change:** the API previously started with no environment at all. It no longer does — the database is now a hard startup dependency, which is the frozen semantics (no degraded mode).

---

## 5. Connection behaviour

| Property | Result |
|---|---|
| Connects using typed configuration | ✅ `DatabaseModule` receives a validated `string`; it parses nothing |
| Raw `process.env` outside the config boundary | ✅ **none** |
| Lifecycle log — starting | ✅ `database connection starting` |
| Lifecycle log — established | ✅ `database connection established` |
| URI in any log line | ✅ **none** — grep for `mongodb://` / `mongodb+srv` across the full startup log returned nothing |
| Domain schema / collection created | ✅ none — verification used **no** application collection |

Non-default options — two only, each justified:

| Option | Value | Basis |
|---|---|---|
| `autoIndex` | `false` | **Frozen requirement**: indexes come from an explicit idempotent sync step, never implicit registration |
| `retryAttempts` | `0` | **Measured**: default 3 retries × a 30s selection window made failure take **296s**; now **32s** |

---

## 6. Failure verification

### Configuration-level — rejected before any socket is opened

| Input | Result |
|---|---|
| `MONGODB_URI` absent | exit **1** — `MONGODB_URI  Invalid or missing value` |
| `MONGODB_URI=` (empty) | exit **1** — same |
| `MONGODB_URI=postgres://user:pass@localhost:5432/db` | exit **1** — same. **The embedded password was not echoed.** |
| `MONGODB_URI=not-a-uri` | exit **1** — same |
| `PORT=abc` with no URI | exit **1** — **both** problems reported together |

### Connection-level — valid URI, database unreachable

| Property | Result |
|---|---|
| Exit code | **1** |
| `Nest application successfully started` printed | **never** |
| Listened on the HTTP port | **never** |
| Time to fail | **32s** (was 296s before `retryAttempts: 0`) |
| Credential exposure | **none** — the driver reported `connect ECONNREFUSED 127.0.0.1:27017`; host and port only |

**No degraded mode exists.** There is no code path where the API serves traffic without its database.

---

## 7. Shutdown verification

**No custom signal handler was added.** The Mongoose integration closes the connection through the shutdown hooks already enabled in `main.ts`.

Two independent proofs:

**1 — Server-side.** MongoDB's `serverStatus().connections.current`: `5` before start → `6` while running → `5` after shutdown. The server observed the connection open and close.

**2 — Lifecycle trace** (temporary harness calling `app.close()`, deleted after use):

```
database connection starting
database connection established
Nest application successfully started
>>> app.close()
database shutting down          ← DatabaseModule.onApplicationShutdown
database disconnecting          ← mongoose close() begins
database disconnected           ← socket released
>>> app.close() RESOLVED
```

### Correction to the verification method used in Phases 2.2 and 2.3

On Windows, `process.kill(pid, 'SIGINT')` against a **foreign** process terminates it rather than delivering a signal — Windows has no cross-process POSIX signal delivery. The earlier "SIGINT shutdown verified" checks therefore demonstrated **process termination and port release**, not that Nest's graceful-shutdown path executed.

Those observations were accurate about the outcome but were weaker evidence than stated. The graceful path is now genuinely verified by the two proofs above.

### Two defects found by verification and fixed

| # | Defect | Cause | Fix |
|---|---|---|---|
| 1 | `database connection established` never logged | Mongoose had already connected before `connectionFactory` ran, so a `'connected'` listener never fired | Check `readyState === 1` directly **and** keep the listener |
| 2 | Shutdown was not observable | The driver's `'disconnected'` event can race with process exit | `OnApplicationShutdown` on `DatabaseModule` — Nest awaits module hooks, so the line is reliably written. Framework-integrated, not a signal handler. |

---

## 8. Regression verification

Phase 2.2 and 2.3 behaviour, re-verified against the running binary with the database connected.

| Behaviour | Result |
|---|---|
| `GET /api/v1/health` | ✅ `200 {"status":"ok"}` — **byte-identical** |
| `GET /api/health` | ✅ 404 |
| `GET /health` | ✅ 404 |
| Unknown route error envelope | ✅ `{"error":{"code":"RESOURCE_NOT_FOUND",…}}` |
| `X-Request-Id` echo | ✅ `db-trace` echoed |
| Swagger JSON | ✅ 200 |
| `Strict-Transport-Security` · `X-Content-Type-Options` · `X-Frame-Options: DENY` · `Referrer-Policy` · CSP | ✅ all five unchanged |
| `src/health/` database references | ✅ **zero** — health has no database dependency |
| Invalid `PORT` still fails | ✅ |
| Unsupported `EMAIL_PROVIDER` still fails | ✅ |
| `EMAIL_PROVIDER=resend` without key still fails | ✅ |
| Multi-error report | ✅ now includes `MONGODB_URI`, redacted |

**Health envelope ambiguity: still unresolved, still inherited.** No envelope interceptor, no Terminus, no health redesign.

---

## 9. Build / type-check / lint / frozen lockfile

| Check | Result |
|---|---|
| `pnpm --filter api build` | ✅ EXIT 0 |
| `pnpm --filter api type-check` | ✅ EXIT 0 |
| `pnpm --filter api lint` | ✅ EXIT 0 — 0 errors, 0 warnings |
| `pnpm install --frozen-lockfile` | ✅ EXIT 0 — `Lockfile is up to date` |
| Turbo discovery | ✅ `api#build`, `api#lint`, `api#type-check` |

**Workspace regression — unchanged from baseline:**

| Task | Result |
|---|---|
| `turbo lint --continue` | 1 successful (`api`) / 4 — fails: `@nest/ui`, `admin`, `storefront` |
| `turbo type-check --continue` | 1 successful (`api`) / 2 — fails: `admin` |
| `turbo build --continue` | 1 successful (`api`) / 3 — fails: `admin`, `storefront` |

Identical in count and identity. **Zero regressions.**

---

## 10. Lockfile impact

| Importer | Result |
|---|---|
| `apps/api` | CHANGED — `+@nestjs/mongoose@11.0.4`, `+mongoose@8.24.4` (17 packages added) |
| `apps/admin`, `apps/storefront` | **unchanged** ✅ |
| `packages/config`, `providers`, `repositories`, `services`, `types`, `ui` | **unchanged** ✅ |

**Zero collateral churn**; no restore-and-retry required.

---

## 11. Replica set / transaction gate status

> ### **CONNECTION READINESS ≠ TRANSACTION READINESS.**

| Fact | Status |
|---|---|
| API connects to MongoDB | ✅ **verified** |
| Connection closes cleanly on shutdown | ✅ **verified** (two independent proofs) |
| Local topology used for verification is a single-node **replica set** | ✅ `rs.status()` → `set: rs0`, 1 member, `PRIMARY` |
| A transaction commits | ⬜ **NOT TESTED** |
| A transaction rolls back with no partial writes | ⬜ **NOT TESTED — this is the gate** |
| Transactions work in CI | ⬜ **NOT TESTED** — no MongoDB was added to CI |
| Transactions work in staging | ⬜ **NOT TESTED** — no staging exists |

**A standalone MongoDB would have satisfied every check in this phase.** That is exactly why connection success must not be read as transaction success.

`docker-compose.dev.yml` provides **database availability**, not gate verification. The implementation remains compatible with transactional sessions — a real `mongoose.Connection` is exposed through the standard integration, so `startSession()` / `withTransaction()` are available with no rework. **No transaction code, helper or test was written.**

---

## 12. Git boundary

| Class | Count | Delta | Contents |
|---|---|---|---|
| **Untracked** | **116** | **+5** | 3 implementation files (`database/database.module.ts`, `config/database.config.ts`, `docker-compose.dev.yml`) + these 2 documents |
| **Modified, unstaged** | **60** | **0** | `pnpm-lock.yaml` + 59 pre-existing |
| **Deleted, unstaged** | **21** | 0 | pre-existing |
| **Staged (Phase 2.1)** | **64** | 0 | untouched |

The five other files this phase edited (`env.schema.ts`, `config.module.ts`, `app.module.ts`, `.env.example`, `apps/api/package.json`) were created in earlier phases and are **still untracked**, so they remain in the `??` set rather than producing new ` M` rows.

**Machine state:** the MongoDB container was stopped and removed after verification (`docker compose down`). The named volume was kept; `down -v` removes it. Docker Desktop was started to run the verification and left running.

> ✅ **No commit created.** `HEAD` is still `dc7768b`.
> ✅ **No push performed.** `main` in sync with `origin/main`.
> ✅ No pre-existing dirty-tree file was modified — ` M` and ` D` counts identical to the phase-start baseline.

---

## 13. Final checklist

| # | Check | Result |
|---|---|---|
| 1 | Frozen persistence architecture re-read | ✅ |
| 2 | MongoDB-specific design preserved | ✅ |
| 3 | No fake database portability abstraction | ✅ no `DatabasePort`/`PersistencePort`/`GenericRepository` |
| 4 | Existing configuration architecture extended | ✅ |
| 5 | No second environment system | ✅ |
| 6 | No raw `process.env` outside the config boundary | ✅ zero literal accesses |
| 7 | `MONGODB_URI` validated | ✅ non-empty + shape |
| 8 | `MONGODB_URI` treated as a secret | ✅ in `SECRET_KEYS` |
| 9 | `MONGODB_URI` never logged | ✅ grep-verified across the full log |
| 10 | Invalid URI fails before connection | ✅ at config validation |
| 11 | Missing URI fails safely | ✅ |
| 12 | Empty URI fails safely | ✅ |
| 13 | Connection uses typed configuration | ✅ |
| 14 | API does not start when the connection fails | ✅ exit 1, never listened |
| 15 | Lifecycle is framework-integrated | ✅ |
| 16 | Disconnects cleanly on shutdown | ✅ two proofs |
| 17 | No unnecessary custom signal handling | ✅ none added |
| 18 | No domain module | ✅ |
| 19 | No domain schema | ✅ |
| 20 | No repository | ✅ |
| 21 | No repository port | ✅ |
| 22 | No business collection | ✅ |
| 23 | No business data seeded | ✅ |
| 24 | No migration created | ✅ |
| 25 | No Supabase data imported | ✅ |
| 26 | No transaction implementation | ✅ |
| 27 | Transaction gate **not** claimed as passed | ✅ §11 |
| 28 | Compatible with MongoDB sessions | ✅ real `Connection` exposed |
| 29 | Connection readiness distinguished from transaction readiness | ✅ stated in the header and §11 |
| 30 | Health behaviour unchanged | ✅ byte-identical |
| 31 | Health envelope ambiguity unresolved | ✅ inherited |
| 32 | No Terminus dependency | ✅ |
| 33 | No Redis dependency | ✅ |
| 34 | No provider SDK | ✅ |
| 35 | No auth implementation | ✅ |
| 36 | Dependency versions justified | ✅ §3 |
| 37 | No unrelated workspace churn | ✅ §10 |
| 38 | `pnpm install --frozen-lockfile` passes | ✅ |
| 39 | API build passes | ✅ |
| 40 | API type-check passes | ✅ |
| 41 | API lint passes | ✅ |
| 42 | Pre-existing dirty-tree files unmodified | ✅ |
| 43 | Phase 2.4 changes clearly identifiable | ✅ §12 |

---

## 14. Phase 2.5 readiness

> ## READY

The persistence infrastructure is in place and verified by execution: connection, failure, shutdown, and a full runtime regression.

**What the transaction gate inherits:**

| Item | Note |
|---|---|
| A live `mongoose.Connection` | Injectable via the standard integration; `startSession()` / `withTransaction()` available with no rework |
| A local replica set | `docker-compose.dev.yml` — `rs0`, single node, `PRIMARY`. Availability only; the gate supplies its own proof |
| `database/` boundary | `TransactionService` belongs here, beside `DatabaseModule` |
| Fail-fast startup | The app already refuses to start without a working connection |
| Secret discipline | `MONGODB_URI` redaction is established and verified |

**What the gate must still establish — none of it done here:**

1. A transaction that **commits**.
2. A transaction that **rolls back leaving no partial writes** — the actual gate.
3. The same proof in **CI** (no MongoDB service exists in CI today).
4. The same proof in **staging** (no staging exists).
5. A test that **fails loudly on a standalone** rather than skipping.

**Still outstanding from earlier phases, none blocking:** revoke the `agentrouter.org` credential; review and commit Phase 2.1's 64 staged files; commit `packages/services/package.json` with `pnpm-lock.yaml`; resolve the health-envelope ambiguity before the envelope-interceptor phase.
