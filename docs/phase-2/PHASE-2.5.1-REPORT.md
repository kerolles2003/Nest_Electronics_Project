# PHASE 2.5.1 — ATLAS DEVELOPMENT VERIFICATION & ENVIRONMENT RATIFICATION · REPORT

**Date:** 2026-08-30 · **Git:** no commit, no push · `HEAD` = `dc7768b`
**Ratification:** [`ENVIRONMENT-RATIFICATION.md`](../architecture/ENVIRONMENT-RATIFICATION.md)
**Supersedes in part:** [`PHASE-2.5-REPORT.md`](./PHASE-2.5-REPORT.md)

> ## VERDICT: **APPROVED WITH OPEN ITEMS**
> The transaction implementation is **APPROVED**. The environment developers
> actually work against — **MongoDB Atlas development** — is **VERIFIED** by
> executed database-state proofs against a real 3-member replica set. The one
> open item is **CI**, which remains **READY** until a GitHub-hosted run
> executes. Staging and production are **NOT PROVISIONED**, recorded honestly
> and by decision, not worked around.

---

## 1. Objective and scope

| | |
|---|---|
| **Objective** | Verify Atlas as the real development database, execute the existing transaction proof against it, ratify the CI harness, correct the frozen documentation, and reclassify the environment gate — without starting any domain work. |
| **In scope** | Architecture re-read · CI harness ratification · Atlas verification · environment model ratification · gate reclassification · frozen-document corrections · secret hygiene · regression |
| **Out of scope, and not started** | Every domain module, schema, repository, DTO, provider, auth mechanism, Redis, migration tooling, Phase 3 |
| **Not an** | Atlas integration redesign. The application still sees MongoDB through exactly one seam: `MONGODB_URI`. |

---

## 2. Part A — Architecture re-read

Every document that defines or mentions transaction requirements, MongoDB
topology, CI verification, `mongodb-memory-server`, Docker Compose,
environment configuration, clean database, or production requirements.

| # | Document | Section | Existing requirement | Impact of the Atlas decision | Action |
|---|---|---|---|---|---|
| 1 | `CONSISTENCY-MODEL.md` | §1 table | CI = `mongodb-memory-server`; Staging mirrors production; Local = replica set | CI tooling superseded; staging not provisioned; a Development row is missing | **AMENDED** |
| 2 | `CONSISTENCY-MODEL.md` | §1 gate | "must pass … in every environment" | Unsatisfiable while staging does not exist | **AMENDED** (reclassified) |
| 3 | `CONSISTENCY-MODEL.md` | §2–§9 | Operations, concerns, idempotency, failure handling | None — the transaction design is untouched | **NO ACTION** |
| 4 | `TESTING-ARCHITECTURE.md` | §5 | "Harness: `mongodb-memory-server` in replica-set mode" | Superseded by measured evidence | **AMENDED** |
| 5 | `TESTING-ARCHITECTURE.md` | §5 gate note | "must pass locally and in CI before any domain module" | Reclassified | **AMENDED** |
| 6 | `TESTING-ARCHITECTURE.md` | §10 | `test/setup/` tree comment; `Database` row | Both name the rejected tool | **AMENDED** |
| 7 | `CONFIGURATION-ARCHITECTURE.md` | §7 | Local / Test-CI / Staging / Production | No row for a cloud development database; CI row names the rejected tool | **AMENDED** |
| 8 | `CONFIGURATION-ARCHITECTURE.md` | §1, §3, §5, §6 | One boundary, one schema, secrets never logged | None — reaffirmed and re-verified | **NO ACTION** |
| 9 | `ARCHITECTURE-REVIEW-DOSSIER.md` | §6.7 | Topology table + "gate … in every environment" | Same two defects as #1 and #2 | **AMENDED** |
| 10 | `OBSERVABILITY.md` | deployment table | "CD automatic to staging"; "Staging must mirror production" | Describes infrastructure that does not exist | **AMENDED** |
| 11 | `OBSERVABILITY.md` | §4 | Mandatory redaction of `MONGODB_URI` | None — but it **drove a fix** (§7.6) | **NO ACTION** (applied) |
| 12 | `ARCHITECTURE-FREEZE-RATIFICATION.md` | §11 gate 4 | Replica set in "local, CI, staging and production" before any domain module | Unsatisfiable as written | **AMENDED** (reclassified) |
| 13 | `ARCHITECTURE-FREEZE-RATIFICATION.md` | §11 authority table | Authoritative sources list | Needs an environment-model row | **AMENDED** |
| 14 | `ARCHITECTURE-FREEZE-RATIFICATION.md` | §6 (C1), §7 | Clean database, no migration, seed not migrate | None — reaffirmed in ENVIRONMENT-RATIFICATION §5 | **NO ACTION** |
| 15 | `MONGODB-DESIGN.md` | §1 item 7, §2 | Replica set required; 12 collection names | None — gate collections collide with none | **NO ACTION** |
| 16 | `CODEBASE-STRUCTURE.md` | §2.1, §6.4 | `database/` owns `TransactionService`; only application services open transactions | None | **NO ACTION** |
| 17 | `PORTS-AND-CONTRACTS.md` | §4, §5 | No port for `TransactionService`; no `DatabasePort` | None | **NO ACTION** |
| 18 | `ANTI-OVERENGINEERING.md` | §14 | Database abstraction is dishonest | None | **NO ACTION** |
| 19 | `PHASE-2.0-REPOSITORY-RUNTIME-PLAN.md` | §10.2, §10.3, §14 | Staging leg of the gate; memory-server | Superseded | **NO ACTION** — historical record, preserved (§7.8) |
| 20 | `PHASE-2.0-REPORT.md` | B-3 | "Provide a staging environment … or defer with a recorded date" | Resolved: deferred with a recorded rule | **NO ACTION** — historical record |
| 21 | `PHASE-2.5-REPORT.md` / `-PLAN.md` | §15 / §12 (D1) | Deviation flagged for approval | **D1 is now ratified** | **Supersession banner only** |
| 22 | `docs/audit/phase-0-audit.md` | §recommendations | Suggests memory-server among many deps | Historical audit, never authoritative | **NO ACTION** |

### 2.1 Conflicts — recorded, then resolved through ratification

| # | Conflict | Resolution |
|---|---|---|
| **C-1** | Four documents hard-code `mongodb-memory-server` as the CI harness | **E2** — requirement kept, tooling replaced, all four corrected |
| **C-2** | The gate requires staging, which does not exist and is not planned | **E3** — split into implementation approval + per-environment provisioning obligation |
| **C-3** | No environment row exists for a cloud development database | **E1** — a Development row added; `NODE_ENV` unchanged, only the URI's *value* differs |
| **C-4** | "Staging mirrors production" stated as a live requirement | Retained but **rescoped** — binding if and when staging exists |
| **C-5** | "M0/M2/M5 do not support transactions reliably" | Retained **for production**; for development, capability is **proved by execution**, not inferred from a tier |
| **C-6** | "CD automatic to staging on merge" | Retained as a future-state target, marked as describing infrastructure that does not exist |

**Nothing was silently chosen. No frozen requirement was deleted.**

---

## 3. Environment verification matrix

| Environment | Database | Infrastructure | Rollback | Commit | Isolation | Status |
|---|---|---|---|---|---|---|
| **Local** | Docker `rs0`, 1 member | **Verified** — PRIMARY, 8.0.29 | **Pass** | **Pass** | **Pass** | **VERIFIED** |
| **Development** | **Atlas, 3-member replica set** | **Verified** — PRIMARY, 8.0.29, `memberCount: 3` | **Pass** | **Pass** | **Pass** | **VERIFIED** |
| **CI** | Ephemeral Docker replica set | **Provisioned** — job audited, every step executed locally; **never run on a GitHub runner** | Not run | Not run | Not run | **READY** |
| **Staging** | — | — | — | — | — | **NOT PROVISIONED** |
| **Production** | — | — | — | — | — | **NOT PROVISIONED** |

**Transaction implementation: APPROVED.**

Nothing above is overclaimed. `READY ≠ VERIFIED`. `NOT PROVISIONED` is not a
failure — it is the honest status of infrastructure that has not been built,
carrying a mandatory verification obligation for the day it is (§6.4).

---

## 4. Atlas transaction evidence

All executed against the real Atlas development cluster, through the
application's own `AppModule` → `ConfigModule` → `DatabaseModule` →
`TransactionService`. Every assertion queries MongoDB **after** the session has
ended, over a **separate connection**.

### 4.1 Topology — asked of the server, never inferred

```
topology  {"isReplicaSet":true,"isMongos":false,"isWritablePrimary":true,
           "memberCount":3,"serverVersion":"8.0.29","maxWireVersion":25}
```

Independently interrogated at connection time: `setName` present (value
withheld — it is a cluster identifier), `hosts` length **3**,
`logicalSessionTimeoutMinutes: 30` (sessions supported), `topologyVersion`
present. **A genuine 3-member replica set, not a shared-tier proxy.** Connection
established in **2.5 s**.

The tier was never used to infer capability. The gate asked, and then proved it.

### 4.2 Rollback — D1

```
rollback  run=e343ddd5-6d2a-476e-8cff-af53c2f3b416
          {"attempts":1,
           "acknowledgedA":true,"acknowledgedB":true,
           "insertedIdA":"6a942e791803dcffbce38b72",
           "insertedIdB":"6a942e791803dcffbce38b73",
           "visibleOutsideA":0,"visibleOutsideB":0}
rollback  run=e343ddd5-6d2a-476e-8cff-af53c2f3b416  A=0  B=0
```

| Requirement | Evidence |
|---|---|
| Writes **actually reached the server** before the failure | `acknowledged: true` for both, with **server-assigned `insertedId`s**. `0` afterwards means undone, not never-written — the exact failure mode the brief forbids accepting as proof |
| Failure forced **after** both writes | `ForcedGateFailure` thrown as the last statement |
| Deterministic | plain in-process `throw`; `attempts: 1` (no `TransientTransactionError` label ⇒ no driver retry) |
| A absent afterwards | `countDocuments({runId}) === 0`, `find({runId})` returns `[]` |
| B absent afterwards | `countDocuments({runId}) === 0`, `find({runId})` returns `[]` |

### 4.3 Commit — D2

```
commit    run=9170ca49-ced2-4a26-97f1-2443ab54ca2e
          {"inTransactionBeforeA":true,"inTransactionBeforeB":true,
           "acknowledgedA":true,"acknowledgedB":true,
           "visibleOutsideA":0,"visibleOutsideB":0}
commit    run=9170ca49-ced2-4a26-97f1-2443ab54ca2e  A=1  B=1
```

### 4.4 Session propagation — D3

`session.inTransaction()` asserted `true` immediately before **each** write:
`inTransactionBeforeA: true`, `inTransactionBeforeB: true`. Every write inside
the callback passes `{ session }` explicitly.

### 4.5 Independent-connection isolation — D4

A **second `mongoose.Connection`**, opened from the same typed configuration
URI, that never receives a session and has no session object in scope where it
is used. Not "a query without a session on the same execution context" — a
genuinely separate client.

```
while the transaction is open, read from the independent client:   A=0   B=0
after commit,                 read from the independent client:   A=1   B=1
```

`0 → 0 → commit → 1 → 1` is only possible if both writes were held by the
session until the commit released them.

### 4.6 Negative control — D5

```
control   run=5e041a3e-ba39-4850-b1d7-49fe1025ca0a
          A=0 (rolled back)  B=1 (escaped the transaction)
```

A deliberately non-participating write (B, no `{ session }`) survives the
identical abort. **Retained, not removed.** This is the evidence that the
verification queries *can* observe a write that escaped the transaction — so
`A=0, B=0` in §4.2 is a real observation rather than a query that could never
have found anything either way. Without it the whole gate could be vacuous.

### 4.7 Cleanup isolation — D6

Executed against the shared Atlas development database.

```
run 1   4 passed        collections created: transaction_gate_a, transaction_gate_b (0 docs each)
        ↓ seeded a foreign-run document into both collections
run 2   4 passed
run 3   4 passed
        ↓
transaction_gate_a   total=1   foreign=1   gate-residue=0
transaction_gate_b   total=1   foreign=1   gate-residue=0
contents: [{"runId":"ATLAS-FOREIGN-RUN-DO-NOT-DELETE","marker":"must survive"}]
```

| Requirement | Result |
|---|---|
| Unique `runId` per execution | `randomUUID()`; 12 distinct run ids across 3 runs |
| Cleanup removes only that run's records | commit `{a:1,b:1}` · rollback `{a:0,b:0}` · control `{a:0,b:1}` |
| Foreign-run records survive repeated runs | **survived all 3**, byte-identical |
| No test residue after cleanup | **0 gate documents** in both collections |
| No `dropDatabase` / `drop()` / `deleteMany({})` | **none** — grep-verified |
| Domain collections created | **0** |

**Final state of the Atlas development database:** `transaction_gate_a` and
`transaction_gate_b`, both empty. The test sentinel this phase seeded was
removed. The database was empty of collections before this phase and holds no
business data now.

### 4.8 Application connection

The API itself was started against Atlas: `database connection starting` →
`database connection established` → `Nest application successfully started`,
and `GET /api/v1/health` returned `200 {"status":"ok"}`. Connection is not
merely reachable — it is transaction-capable, which §4.2–§4.6 prove.

---

## 5. CI harness ratification (Part B)

```
ARCHITECTURAL REQUIREMENT                    TOOLING IMPLEMENTATION
CI executes the transaction gate     vs      Docker Compose replica set
against a transaction-capable                (docker-compose.dev.yml)
MongoDB replica set
```

`mongodb-memory-server` **must not be installed or used** — lockfile contains
**0 occurrences**. Grounds: a measured **781.1 MB postinstall download** on
every workspace install, which the `lint`, `type-check` and `build` jobs and
every frontend developer would have paid.

The distinction is what makes this safe: no application file knows what
provisioned MongoDB, so reversing the tooling is a workflow-only edit. **The
transaction architecture, `TransactionService`, and every abstraction boundary
are untouched.**

### 5.1 CI job audit (Part H) — existing implementation, not rewritten

| # | Required property | Result |
|---|---|---|
| 1 | Provisions the Docker Compose replica set | ✅ `up -d --wait` |
| 2 | Verifies transaction-capable topology | ✅ explicit `hello` assertion, exits 1 unless `setName` **and** `isWritablePrimary` |
| 3 | Runs the transaction gate | ✅ `pnpm --filter api test` |
| 4 | Cannot pass through `continue-on-error` | ✅ **0** occurrences |
| 5 | Cannot pass through `\|\| true` | ✅ **0** executable occurrences (the single grep hit is the comment asserting its absence) |
| 6 | Test is not skipped | ✅ no `if:` guard on any gate step; no `.skip` in the suite |
| 7 | `always()` only for cleanup | ✅ sole use is the `Stop MongoDB` teardown |
| 8 | Cannot be satisfied by Turbo cache | ✅ `turbo.json` → `test.cache = false` |
| 9 | **Holds no Atlas credential** | ✅ **0** references to `secrets.`, `ATLAS`, or `mongodb+srv`. The URI is runner-local `127.0.0.1` |

**No CI redesign was performed.** The implementation already satisfied every
requirement.

---

## 6. Environment model (Part F) and gate classification (Part G)

Authority: [`ENVIRONMENT-RATIFICATION.md`](../architecture/ENVIRONMENT-RATIFICATION.md).

### 6.1 Development — Atlas

Disposable development data. Not production. May be reset or reseeded under the
future seed strategy. Selected purely by configuration: **no new environment
variable** (the schema still declares exactly `NODE_ENV`, `PORT`, `API_PREFIX`,
`SWAGGER_ENABLED`, `MONGODB_URI`, `EMAIL_PROVIDER`, `RESEND_API_KEY`), no Atlas
SDK, no branch.

### 6.2 CI

Self-contained, credential-free, disposable. **CI must never hold Atlas
credentials** — preserving freeze gate #12 and guaranteeing a CI run cannot
corrupt or reseed shared development data.

### 6.3 Production

A **separate** Atlas environment/project or cluster — never the development
cluster or database. **Starts from a clean database.** Development data is
never promoted, copied or migrated into it. Sizing is **not** selected: nothing
was provisioned or purchased. See O-1.

### 6.4 Staging

```
NOT CURRENTLY PROVISIONED
NOT REQUIRED TO CONTINUE DEVELOPMENT
REQUIRED TO PASS ITS OWN DATABASE VERIFICATION WHEN INTRODUCED
```

No artificial staging was created to satisfy the old gate wording. If
introduced, it gets its own isolated database and:
`provision → verify topology → run the transaction gate → only then ready`.

### 6.5 Gate reclassification

```
TRANSACTION IMPLEMENTATION           APPROVED
Local replica set                    VERIFIED   (Phase 2.5 evidence, retained + re-run)
Development / Atlas                  VERIFIED   (this phase, executed)
CI                                   READY      until a real GitHub Actions run passes
Staging                              NOT PROVISIONED — mandatory verification when introduced
Production                           NOT PROVISIONED — mandatory verification at provisioning
```

**Nothing was weakened.** No environment may be marked verified without executed
database-state evidence. What changed is that a *nonexistent* environment no
longer produces a permanently unsatisfiable gate.

---

## 7. Reasoning trace (Part M)

### 7.1 A new authority document rather than editing the freeze record

**Before:** `ARCHITECTURE-FREEZE-RATIFICATION.md` was the sole ratification
record, explicitly scoped as "the final consistency record for Phase 1 + Phase
1.1". Environment facts were scattered across five documents that disagreed.
**Changed:** created `ENVIRONMENT-RATIFICATION.md` as the single authority;
every other document corrected and pointed at it.
**Why:** appending Phase 2.5.1 content to a document that declares itself final
for Phase 1 would corrupt its scope; leaving five documents to restate the model
independently guarantees drift.
**Rule:** the R2 precedent — "no other document may independently define a
competing port inventory" — applied to environments. `REDIS-DECISION.md` is the
established precedent for a single-topic decision document.
**Rejected:** (a) editing the freeze record in place — scope corruption;
(b) correcting the five documents without an authority — drift returns.
**Verified:** grep confirms zero remaining `mongodb-memory-server` references in
`docs/architecture/` other than explicit "is not used" statements and the
ratification's own audit trail.

### 7.2 CI harness ratified rather than re-litigated

**Before:** Phase 2.5 flagged deviation **D1** as unresolved, pending approval.
**Changed:** ratified as a **tooling** decision, with the architectural
requirement restated separately and left intact.
**Why:** the requirement is "a transaction-capable replica set in CI". The tool
was an implementation detail written into a requirement table.
**Rule:** `ANTI-OVERENGINEERING.md` — decisions need evidence; the 781 MB figure
is measured, matching the codebase's existing evidence culture (Phase 2.4's
`retryAttempts: 0` was justified the same way).
**Rejected:** installing memory-server anyway (cost falls on every developer and
three unrelated CI jobs); a GitHub `services:` block (cannot pass `command:`, so
cannot start `--replSet`).
**Verified:** lockfile contains 0 occurrences; CI job re-audited against 9
properties; local and Atlas gates both pass unchanged.

### 7.3 A Development row, not a new variable

**Before:** `CONFIGURATION-ARCHITECTURE.md` §7 had four rows and no cloud
development database.
**Changed:** added a **Development** row; `NODE_ENV` stays `development`, and
the row differs from Local *only in the value of `MONGODB_URI`*.
**Why:** the frozen rule is "one schema across all environments — differences
are values, not shapes".
**Rejected:** a `MONGODB_ATLAS_URI` variable, an `IS_ATLAS` flag, a `database`
namespace extension — each would put infrastructure identity into the schema and
invite `if (isAtlas)` at the first inconvenience.
**Verified:** the schema still declares exactly 7 variables; grep finds no
`isAtlas`/`isDocker` branch and no `NODE_ENV` read outside `config/`.

### 7.4 Gate reclassified rather than quietly dropped

**Before:** one hard gate across local + CI + staging, blocking all domain work.
**Changed:** split into implementation approval and per-environment
provisioning obligations.
**Why:** the old wording made progress hostage to an environment nobody had
decided to build, and the only ways out were to build a fake staging or to
silently ignore a third of a gate — both explicitly forbidden.
**Rule:** the requirement's own purpose — "this is a *topology* test, not a code
test" (`PHASE-2.0` §10.3). A topology test belongs to the topology, so it belongs
to provisioning.
**Rejected:** creating an artificial staging environment (forbidden, and it would
produce evidence about infrastructure nobody uses); marking staging "N/A"
(erases the obligation).
**Verified:** every affected document carries the reclassification with an
explicit pointer; no status anywhere claims verification without evidence.

### 7.5 Gate collections preserved (Part E)

**Before:** `transaction_gate_a` / `transaction_gate_b`, created in Phase 2.5
against a private local database.
**Changed:** **nothing.**
**Why:** the brief says to change only if isolation is insufficient. Audited
against all 15 known domain collection names (`users`, `products`, `categories`,
`brands`, `carts`, `orders`, `inventoryEvents`, `coupons`, `couponRedemptions`,
`reviews`, `blogPosts`, `auditLogs`, `refreshTokens`, `idempotencyKeys`,
`orderCounters`) plus `wallets`/`payments`: **zero collisions**. They also use a
`transaction_gate_` prefix in `snake_case`, while every domain collection is
`camelCase` — a structurally distinct namespace, not merely a different name.
**Rejected:** renaming for tidiness — churn with no safety gain, against the
explicit instruction not to rename unnecessarily.
**Verified:** collision check executed; the gate references no domain collection
name; after 3 Atlas runs the database contains 0 domain collections.

### 7.6 Topology output redacted — a defect the Atlas move exposed

**Before:** the gate logged `{"setName":"rs0", ..., "me":"localhost:27017"}`.
Harmless locally.
**Changed:** added `redactTopology()`; the printed evidence is now
`isReplicaSet` · `isMongos` · `isWritablePrimary` · `memberCount` ·
`serverVersion` · `maxWireVersion`. `setName` and `me` values are never printed;
the unredacted values remain available to the assertions.
**Why:** against Atlas that line would print a cluster hostname and replica-set
identifier into test output and CI logs.
**Rule:** `OBSERVABILITY.md` §4, mandatory redaction; Part I of this phase.
**Rejected:** filtering the output in my shell (leaves the defect for CI and
every future run); dropping topology evidence entirely (weakens the proof —
`memberCount` was *added*, so the evidence is now strictly stronger: it
distinguishes Atlas's 3 members from local's 1).
**Verified:** local run prints `memberCount: 1`, Atlas prints `memberCount: 3`;
neither prints a hostname. Type-check, lint and both gates pass.

### 7.7 A `.env` placeholder that fails loudly

**Before:** no `apps/api/.env` existed.
**Changed:** created it (gitignored) with a placeholder that **fails Zod
validation**.
**Why:** a placeholder pointing at `localhost` would let the gate silently pass
against Docker while the report claimed Atlas — manufacturing exactly the false
evidence this phase exists to prevent.
**Rejected:** defaulting to the local URI (silent false pass); leaving the file
absent (the user would have had to hand a secret through the chat transcript).
**Verified:** executed before the URI was supplied — exit 1,
`MONGODB_URI  Invalid or missing value`, with no value echoed.

### 7.8 Historical records preserved, not rewritten

**Before:** `PHASE-2.5-REPORT.md` concluded BLOCKED with staging BLOCKED;
`PHASE-2.0` documents carry the old staging gate.
**Changed:** added a **supersession banner** to the Phase 2.5 report. Its body
is unedited. The Phase 2.0 documents are untouched.
**Why:** rewriting a report to match a later decision destroys the audit trail
that justifies the decision. The brief required not silently reinterpreting or
erasing the previous gate.
**Rejected:** editing the Phase 2.5 verdict in place; deleting the D1 section
now that it is approved.
**Verified:** the Phase 2.5 executed evidence stands unchanged and is re-cited
here; the banner states exactly what changed and what still stands.

---

## 8. Files changed

### Created

| File | Why necessary |
|---|---|
| `docs/architecture/ENVIRONMENT-RATIFICATION.md` | The single authority for the environment model, CI harness and gate classification. Without it, five documents restate the model independently and drift (§7.1) |
| `docs/phase-2/PHASE-2.5.1-REPORT.md` | This report |
| `apps/api/.env` | **Gitignored, never committed.** The only mechanism for supplying the Atlas credential through the existing configuration boundary (§7.7) |

### Modified

| File | Change | Why necessary |
|---|---|---|
| `docs/architecture/CONSISTENCY-MODEL.md` | §1 environment table + gate paragraph | C-1, C-2, C-3 |
| `docs/architecture/TESTING-ARCHITECTURE.md` | §5 harness, §5 gate note, §10 tree + Database row | C-1, C-2 |
| `docs/architecture/CONFIGURATION-ARCHITECTURE.md` | §7 environment table | C-1, C-3, C-4 |
| `docs/architecture/ARCHITECTURE-REVIEW-DOSSIER.md` | §6.7 topology table + gate sentence | C-1, C-2 |
| `docs/architecture/OBSERVABILITY.md` | Staging + CD rows | C-4, C-6 |
| `docs/architecture/ARCHITECTURE-FREEZE-RATIFICATION.md` | §11 gate 4 reclassified; authority table gains an Environment-model row | C-2 |
| `docs/phase-2/PHASE-2.5-REPORT.md` | Supersession banner only; body unedited | Audit trail (§7.8) |
| `apps/api/test/infrastructure/transaction-gate.spec.ts` | `redactTopology()` + `memberCount`; one `console.log` call site | Secret hygiene, Part I (§7.6) |

**Exactly one file in the source tree was modified, and only its evidence
output.** No assertion, no proof, no transaction code was changed.

### Deleted

```
none
```

### Dependencies

```
none added, none removed, none upgraded
```

`pnpm install --frozen-lockfile` passes, which is the proof that no manifest
changed. `mongodb-memory-server`: **0** occurrences in the lockfile.

---

## 9. What was intentionally NOT changed

| Category | Confirmation |
|---|---|
| **Domain modules** | `apps/api/src/` contains exactly `app.module.ts`, `main.ts`, `common/`, `config/`, `database/`, `health/` — unchanged |
| **Schemas** | No Mongoose schema exists. The only `*schema*` file is `config/env.schema.ts` (Phase 2.3) |
| **Repositories** | none |
| **DTOs** | The only DTO is `health/health.response.dto.ts` (Phase 2.2) — not a domain DTO |
| **Providers** | none. No Cloudinary, S3, Resend, Zoho, SMTP |
| **Auth** | none. `grep` for `jsonwebtoken\|passport\|bcrypt` in `apps/api/package.json` → **0** |
| **Redis** | none. OPEN-006 not reopened |
| **Migrations** | No migration tooling, no Supabase compatibility layer, no reconciliation. The single `migrat` string in the source tree is a comment in `database.module.ts` saying *"there is no data migration"* |
| **`TransactionService`** | **Untouched** — one method `run`, same frozen concerns (`snapshot`, `majority`+`j`, `primary`, `maxCommitTimeMS: 15_000`) |
| **New abstractions** | none. No `DatabasePort`, `TransactionPort`, `UnitOfWork` |
| **Docker infrastructure** | `docker-compose.dev.yml` untouched |
| **CI design** | No redesign — it already satisfied all 9 properties |
| **Phase 3** | Not started |

---

## 10. Verification results

| Check | Command | Result |
|---|---|---|
| Build | `pnpm --filter api build` | ✅ exit 0 |
| Type-check | `pnpm --filter api type-check` | ✅ exit 0 |
| Lint | `pnpm --filter api lint` | ✅ exit 0 |
| Frozen install | `pnpm install --frozen-lockfile` | ✅ exit 0 |
| **Atlas transaction gate** | `pnpm --filter api test` | ✅ **4 passed, 3 consecutive runs**, 19 s |
| **Local transaction gate** | same, `MONGODB_URI` → Docker | ✅ **4 passed** |

### Health and behaviour regression

| Behaviour | Result |
|---|---|
| `GET /api/v1/health` **against Atlas** | ✅ `200` · `{"status":"ok"}` — **byte-identical**, 15 bytes, confirmed via `od -c` |
| Global prefix | ✅ `/api/v1/health` 200 |
| URI versioning | ✅ `/api/health` 404 · `/health` 404 · `/api/v2/health` 404 |
| Error envelope | ✅ `{"error":{"code":"RESOURCE_NOT_FOUND","message":…,"requestId":…,"timestamp":…}}` |
| Request-ID behaviour | ✅ `X-Request-Id: p251-trace` echoed |
| Security headers | ✅ all five unchanged (CSP · HSTS · nosniff · `X-Frame-Options: DENY` · Referrer-Policy) |
| Configuration validation | ✅ unchanged — placeholder URI rejected at boot, exit 1 |
| **URI redaction** | ✅ Atlas startup log: **0** `mongodb://`/`mongodb+srv://`, **0** `mongodb.net`, **0** credential separators |
| MongoDB failure behaviour | ✅ unchanged — unreachable database: exit 1, never listens, no URI in log |
| Graceful shutdown | ✅ unchanged |

### Phase 2.5.1 regressions vs pre-existing workspace failures

```
Phase 2.5.1 regressions:  NONE
```

| Task | Result | Baseline (2.4 / 2.5) |
|---|---|---|
| `turbo lint --continue` | 1 / 4 — fails `@nest/ui`, `admin`, `storefront` | **identical** |
| `turbo type-check --continue` | 1 / 2 — fails `admin` | **identical** |
| `turbo build --continue` | 1 / 3 — fails `admin`, `storefront` | **identical** |

Pre-existing frontend failures, untouched by this phase and deliberately not fixed.

---

## 11. Secrets handling (Part I)

| Control | Result |
|---|---|
| Atlas URI printed | **never** — a shape-only inspection reported scheme / loopback-or-not / db name, values withheld |
| Atlas URI in any document | **none** — including this report |
| Atlas URI in logs | **0** occurrences across the full Atlas startup log |
| Atlas URI in test output | **0** — `redactTopology()` added precisely for this |
| Credentials in validation errors | **none** — `MONGODB_URI` remains in `SECRET_KEYS`; error is `Invalid or missing value` |
| `.env` committed | **no** — `git check-ignore` → `.gitignore:18`; confirmed absent from `git status --porcelain -uall` |
| CI holds Atlas credentials | **no** — 0 references to `secrets.`, `ATLAS`, `mongodb+srv` in the workflow |
| Secret scan of changed files | ✅ clean — the only credential-pattern hits are **pre-existing** variable *names* (`RESEND_API_KEY`, `CLOUDINARY_API_KEY`) on lines this phase never touched, plus the `<user>:<password>` placeholder inside the gitignored `.env` comment |

---

## 12. Git boundary

| Class | Count | Delta vs Phase 2.5 | Contents |
|---|---|---|---|
| **Untracked** | **122** | **+1** | `ENVIRONMENT-RATIFICATION.md` (+ this report on write) |
| **Modified, unstaged** | **61** | **0** | unchanged |
| **Deleted, unstaged** | **21** | **0** | pre-existing |
| **Staged (Phase 2.1), now `AM`** | **7** | **+6** | `ci.yml` (from 2.5) + the 6 architecture documents amended here |

`apps/api/.env` is **invisible to git**. `apps/api` remains wholly untracked, so
the spec-file edit produces no new row.

> ✅ **No commit created.** `HEAD` is still `dc7768b`.
> ✅ **No push performed.** `main` in sync with `origin/main`.

**Machine state:** local Mongo container left running (`docker compose -f
docker-compose.dev.yml down -v` clears it). The Atlas development database holds
two empty gate collections and no business data.

---

## 13. Open items

### Blocking current development

```
NONE
```

The environment developers work against — Atlas development — is VERIFIED, and
the transaction implementation is APPROVED.

### Blocking production

| ID | Item |
|---|---|
| **P-1** | Provision the **separate** production Atlas environment and run the transaction gate against it. Clean database; no development data promoted |
| **O-1** | Production Atlas tier. Frozen requirement stands (**M10+ or self-hosted 3-node**). Nothing selected or purchased here; revisiting the M10 floor is a separate architecture decision |
| OPEN-006 | More than one API instance ⇒ Redis required before go-live (inherited, unchanged) |
| OPEN-001 / 004 / 005 | Shipping rates · email provider · carrier list (inherited, unchanged) |

### Non-blocking

| ID | Item |
|---|---|
| **CI-1** | **CI remains READY.** Commit + push, then read the `Transaction gate` job result to reach VERIFIED. No code change required |
| **O-2** | Whether staging is ever introduced. If it is: own isolated database, then `provision → verify topology → run gate → ready` |
| **O-3** | Development seed strategy for the Atlas dev database (no seed script exists; the database holds no business data) |
| **O-4** | Atlas IP allowlist for CI — **deliberately not granted**; CI must stay credential-free |
| — | Inherited: revoke the `agentrouter.org` credential · commit Phase 2.1's staged files · health-envelope ambiguity |

---

## 14. Final checklist

**Architecture** — ✅ frozen requirements re-read (22 document/section rows) · ✅ 6 conflicts explicitly identified · ✅ Atlas ratified · ✅ Docker Compose CI harness ratified · ✅ no silent reversal · ✅ no duplicate authority (one new authority, five documents pointed at it)

**Development** — ✅ Atlas connects (2.5 s) · ✅ topology transaction-capable (3-member replica set, PRIMARY) · ✅ rollback verified · ✅ commit verified · ✅ independent-connection isolation verified · ✅ negative control verified · ✅ cleanup scoped by `runId` · ✅ foreign-run data survived 3 runs · ✅ zero residue

**CI** — ✅ provisions its own replica set · ✅ no Atlas credential · ✅ cannot be cached into a false pass · ✅ no `continue-on-error` · ✅ no skip · ✅ status reported honestly as READY

**Environments** — ✅ Development = Atlas · ✅ CI = ephemeral Docker · ✅ Production = separate clean Atlas · ✅ staging absence recorded honestly · ✅ future staging verification documented · ✅ no migration infrastructure

**Security** — ✅ no URI leaked · ✅ no credentials leaked · ✅ no secrets committed · ✅ changed files scanned

**Scope** — ✅ no domain module · ✅ no repository · ✅ no schema · ✅ no provider · ✅ no Phase 3 work

---

## 15. Recommended next phase — not started

> ### Phase 2.6 — Index synchronisation & seed foundation

The narrowest useful next step, and the one the architecture already names as
missing: `CODEBASE-STRUCTURE.md` §2.1 requires `database/` to own an **explicit,
idempotent index-sync step**, `DatabaseModule` runs with `autoIndex: false`
specifically because of it, and `ARCHITECTURE-FREEZE-RATIFICATION.md` §7
establishes **seed-integrity validation** as the replacement for the deleted
migration verification. Neither exists.

It stays infrastructure-only — no schema declares an index yet, so the sync step
is built and proven against the same test-only collections the transaction gate
uses, and the seed foundation is a mechanism with no business data in it.

**Alternative worth considering first:** commit and push to convert **CI-1**
from READY to VERIFIED. It requires no code and closes the last open item that
is not production-scoped.

**Neither has been started.**
