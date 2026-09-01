# ENVIRONMENT RATIFICATION

**Project:** Nest Electronics · **Date:** 2026-08-30 · **Phase:** 2.5.1
**Status:** RATIFIED · **Supersedes:** the environment rows of the documents listed in §8

---

## 0. What this document is

> **This is the single authoritative source for the environment model, the MongoDB
> topology required of each environment, and the CI transaction harness.**
>
> No other document may independently define a competing environment model. The
> documents in §8 have had their environment rows corrected to agree with this
> record and now point here.

It exists for the same reason `PORTS-AND-CONTRACTS.md` was made the sole port
authority in ratification **R2**: two documents describing the same inventory
will drift, and the drift is discovered at the worst possible moment.

**No architecture was redesigned.** Nothing here changes the transaction design,
the document model, the module map, the port inventory, the order lifecycle, or
any Phase 1 business decision. Every edit is an environment-row correction, a
tooling ratification, or a gate reclassification.

---

## 1. The distinction everything else follows from

```
ARCHITECTURAL REQUIREMENT                    TOOLING IMPLEMENTATION
─────────────────────────                    ──────────────────────
A transaction-capable MongoDB       vs       How that topology
replica set (or mongos), in                  happens to be provisioned
every environment that runs
the application or its tests
```

The requirement is **frozen and unchanged**. The tooling is an implementation
detail that may be replaced without touching a line of application code, because
the application sees MongoDB through exactly one seam:

```
MONGODB_URI  →  env.schema.ts (validated)  →  database.config.ts (typed)
             →  DatabaseModule  →  mongoose.Connection  →  TransactionService
```

Nothing in `apps/api/src/` knows whether that URI points at Docker, at Atlas, or
at a self-hosted cluster. There is no `if (isAtlas)`, no `if (isDocker)`, no
`NODE_ENV` branch in any data path. Verified by grep (§9).

Phase 1 conflated the two by writing a specific product name into the
requirement tables. This ratification separates them.

---

## 2. E1 — The environment model

| Environment | Database | Provisioning | Purpose | Contains |
|---|---|---|---|---|
| **Local** | single-node replica set `rs0` | `docker-compose.dev.yml` | offline development, fast iteration | disposable |
| **Development** | **MongoDB Atlas — development environment** | Atlas, existing account | the real shared development database | disposable development data |
| **CI** | ephemeral replica set | `docker-compose.dev.yml`, started by the workflow | automated transaction verification | disposable, destroyed each run |
| **Staging** | — | **NOT CURRENTLY PROVISIONED** | future, optional | — |
| **Production** | **MongoDB Atlas — separate production environment** | not yet provisioned | production | **starts clean** |

### 2.1 Local

Retained, not replaced. `docker-compose.dev.yml` stays exactly as Phase 2.4
delivered it. A developer must be able to work with no network and no Atlas
credential, and CI must not depend on a cloud account.

### 2.2 Development — Atlas

The real development database. It is **not** production and carries no
production guarantees: it may be reset or reseeded at any time according to the
future seed strategy, and it holds only disposable development data.

Selected purely through configuration. Atlas introduces:

- no new environment variable,
- no new configuration namespace,
- no Atlas SDK, driver flag or vendor dependency,
- no branch anywhere in application code.

The connection string is a **secret**: already on the `SECRET_KEYS` redaction
list in `env.schema.ts`, never logged, never echoed in a validation error, never
written into any document including this one.

### 2.3 CI

> **CI must never hold a credential to the Atlas development database.**

CI is self-contained: it provisions its own disposable replica set, runs the
transaction gate against it, and destroys it. This preserves freeze gate #12
("vendor credentials absent in CI, so no default-suite test can silently reach a
real provider") and means a CI run can never corrupt, reseed or exhaust shared
development data.

### 2.4 Staging

```
NOT CURRENTLY PROVISIONED
NOT REQUIRED TO CONTINUE DEVELOPMENT
REQUIRED TO PASS ITS OWN DATABASE VERIFICATION WHEN INTRODUCED
```

Staging does not exist and **is not created to satisfy a gate's wording**. An
environment invented so a checklist can be ticked is worse than an absent one:
it produces evidence about infrastructure nobody uses.

If staging is introduced it receives its **own isolated database/environment** —
never the development database — and provisioning is not complete until:

```
provision database  →  verify replica-set topology  →  run the transaction gate  →  ready
```

### 2.5 Production

A **separate** Atlas environment/project or cluster — never the development
cluster, never the development database. It starts from a **clean database**
(§5). The same provisioning sequence as staging applies: transaction capability
is verified by execution before the environment is considered ready.

**Sizing is not selected here.** Nothing is provisioned, purchased or committed
to by this phase. See §7 (**O-1**) for the standing frozen requirement and the
open question against it.

---

## 3. E2 — CI transaction harness: `mongodb-memory-server` → Docker Compose

### What was frozen

Four documents named `mongodb-memory-server` in replica-set mode as the CI
MongoDB harness: `CONSISTENCY-MODEL.md` §1, `TESTING-ARCHITECTURE.md` §5 and
§10, `CONFIGURATION-ARCHITECTURE.md` §7, `ARCHITECTURE-REVIEW-DOSSIER.md` §6.7.

### What is ratified

```
APPROVED CI TRANSACTION HARNESS:
Docker Compose MongoDB replica set (docker-compose.dev.yml)

mongodb-memory-server MUST NOT be installed or used.
```

### Why

Measured during Phase 2.5, not assumed. `mongodb-memory-server@11.2.0` was
installed and observed:

| Observation | Consequence |
|---|---|
| `postinstall` downloads **781.1 MB** of MongoDB binaries | — |
| that postinstall runs on **every workspace install** | the existing `lint`, `type-check` and `build` jobs would each pay it, as would every frontend developer who never runs a MongoDB test |
| binaries land in `node_modules/.cache/` | outside the pnpm store cache, so nothing amortises it without extra cache plumbing |

Docker Compose costs one workflow step, adds **zero dependencies**, and makes CI
and a developer's machine prove the same thing about the same artefact.

A GitHub Actions `services:` block was also rejected: service containers cannot
take `command:`, so they cannot start `mongod --replSet` without a custom image.

### What this does and does not change

| | |
|---|---|
| **Requirement** | unchanged — CI executes the transaction gate against a transaction-capable replica set |
| **Application code** | unchanged — no source file knows what provisioned MongoDB |
| **Transaction design** | unchanged — `TransactionService` is untouched |
| **Abstractions added** | none |
| **Reversibility** | workflow-only. Swapping the harness back requires editing `.github/workflows/ci.yml` and nothing else |

The tooling remains replaceable precisely because the requirement was separated
from it in §1.

---

## 4. E3 — Reclassification of the transaction gate

### What was frozen

`ARCHITECTURE-FREEZE-RATIFICATION.md` §11 gate 4, `CONSISTENCY-MODEL.md` §1 and
`PHASE-2.0-REPOSITORY-RUNTIME-PLAN.md` defined one hard gate spanning **local,
CI and staging**, blocking all domain work until it passed in all three.

### The defect in that wording

It conflates two different things:

```
IS THE TRANSACTION IMPLEMENTATION CORRECT?          ←  a property of the code
IS ENVIRONMENT X TRANSACTION-CAPABLE?               ←  a property of infrastructure
```

The first is answered once. The second must be answered separately for every
environment, **at the time that environment is provisioned** — and it is not
answerable at all for an environment that does not exist. Under the old wording,
domain work is blocked forever by an environment nobody has decided to build.

### The ratified classification

```
TRANSACTION IMPLEMENTATION                                    APPROVED
    proven by executed rollback + commit + session-propagation
    + independent-read + negative-control evidence

ENVIRONMENT-SPECIFIC VERIFICATION
    Local replica set          VERIFIED    (Phase 2.5 evidence, retained)
    Development / Atlas        VERIFIED    only when executed successfully
    CI                         READY       until a real GitHub Actions run passes
    Staging                    NOT PROVISIONED   — verification mandatory when introduced
    Production                 NOT PROVISIONED   — verification mandatory at provisioning
```

**Rule.** Environment verification is a **provisioning obligation**, not a
development blocker. An environment is not "ready" until the transaction gate
has passed against it. An environment that does not exist has no status to
claim.

**What still blocks what:**

| Blocks | Condition |
|---|---|
| **Domain modules** | the transaction implementation must be APPROVED, and the environment developers actually write code against must be VERIFIED |
| **Merging to a protected branch** | CI VERIFIED |
| **Any production deploy** | production environment verification |
| **Nothing** | staging — it does not exist and does not gate development |

**Nothing is being weakened.** No environment may be marked VERIFIED without
executed database-state evidence. The change is that a *nonexistent* environment
no longer produces a permanently-unsatisfiable gate.

---

## 5. E4 — Clean database, no migration (reaffirmed)

Unchanged from `ARCHITECTURE-FREEZE-RATIFICATION.md` §6 (correction C1), and
restated here because the environment model is where it bites:

```
NO legacy data migration          NO Supabase data migration
NO user / order / product migration
NO password migration             NO image migration
NO ledger migration               NO reconciliation against legacy data
NO migration tooling              NO Supabase compatibility layer
```

**Development Atlas data is disposable.** It is never promoted, copied or
migrated into production. **Production starts from a new, clean database.**
Initial data, when required, comes from the project's future seed strategy —
seeding, not migrating (`ARCHITECTURE-FREEZE-RATIFICATION.md` §7).

---

## 6. Conflicts found and how each was resolved

Every conflict between the frozen documents and the ratified environment model,
recorded rather than silently chosen.

| # | Conflict | Frozen text | Resolution |
|---|---|---|---|
| **C-1** | CI harness names a specific tool | 4 documents: "`mongodb-memory-server` replica-set mode" | **Resolved by E2.** Requirement retained, tooling replaced by Docker Compose, all four documents corrected and pointed here. |
| **C-2** | Gate requires staging, which does not exist | Freeze gate #4: "local, CI, staging and production … before any domain module is written" | **Resolved by E3.** Split into implementation approval + per-environment provisioning obligations. Staging recorded as NOT PROVISIONED; its verification becomes mandatory at introduction. |
| **C-3** | No environment row for a cloud development database | `CONFIGURATION-ARCHITECTURE.md` §7 lists Local / Test-CI / Staging / Production only | **Resolved by E1.** A **Development** row is added. `NODE_ENV` stays `development`; only the URI's value differs — no schema change, honouring "one schema, different values". |
| **C-4** | "Staging mirrors production" is stated as a live requirement | `CONSISTENCY-MODEL.md` §1, `OBSERVABILITY.md`, `CONFIGURATION-ARCHITECTURE.md` §7 | **Retained, rescoped.** It remains binding *if and when* staging exists. It is not a present obligation. |
| **C-5** | Atlas shared tiers described as transaction-unreliable | `CONSISTENCY-MODEL.md` §1: "M0/M2/M5 … do not support transactions reliably" | **Retained for production; empirically tested for development.** The caveat is a production-reliability judgement. Whether the *development* cluster is transaction-capable is not assumed from its tier — the gate asks the server and proves it by execution. |
| **C-6** | CD "automatic to staging on merge" | `OBSERVABILITY.md` | **Retained as a future-state target**, marked as describing an environment that does not exist. No CD was built. |

**No conflict was silently resolved. No frozen requirement was deleted.**

---

## 7. Open items

| ID | Question | Standing default | Blocks |
|---|---|---|---|
| **O-1** | Production Atlas tier | Frozen requirement stands: **M10+ or a self-hosted 3-node replica set** (`CONSISTENCY-MODEL.md` §1). This phase selects, provisions and pays for **nothing**. Whether the M10 floor should be revisited is a separate architecture decision, and the deciding evidence is the gate run against the candidate cluster. | Production only |
| **O-2** | Whether staging is ever introduced | Not introduced. Absence is recorded, not worked around. | Nothing |
| **O-3** | Development seed strategy for the Atlas dev database | Not designed. No seed script exists; the database is currently empty of business data. | Nothing — needed before broad domain work |
| **O-4** | Atlas dev cluster IP allowlist for CI | **Deliberately not granted.** CI must not reach Atlas (§2.3). | Nothing |

---

## 8. Documents amended

Every change is an environment-row correction or a pointer to this record.

| Document | Section | Change |
|---|---|---|
| `CONSISTENCY-MODEL.md` | §1 | Environment table: **Development/Atlas** row added; **CI** row `mongodb-memory-server` → Docker Compose; **Staging** row marked NOT PROVISIONED; Phase 2 gate paragraph reclassified per E3; authority pointer added |
| `TESTING-ARCHITECTURE.md` | §5, §10 | Level 3 harness line and the `Database` / `test/setup/` rows corrected to the Docker Compose replica set |
| `CONFIGURATION-ARCHITECTURE.md` | §7 | Environment-separation table: **Development/Atlas** row added; Test/CI row corrected; staging marked not provisioned |
| `ARCHITECTURE-REVIEW-DOSSIER.md` | §6.7 | Topology table CI row corrected; staging marked not provisioned; gate sentence reclassified |
| `OBSERVABILITY.md` | §(deployment) | Staging and CD rows marked as describing an environment that does not exist |
| `ARCHITECTURE-FREEZE-RATIFICATION.md` | §11 gate 4 | Reclassified per E3, pointing here; §11 authoritative-sources table gains an **Environment model** row |

**Not touched:** the transaction design, `MONGODB-DESIGN.md`'s document model,
the module map, the port inventory, `ANTI-OVERENGINEERING.md`,
`DEPENDENCY-RULES.md`, business rules, the order lifecycle, money, DTO strategy,
templates, and every other architecture document.

---

## 9. Invariants this ratification must not break

Re-verified after the amendments:

| Invariant | Status |
|---|---|
| One environment schema, values differ | ✅ no variable added, removed or made conditional |
| `MONGODB_URI` is the only database seam | ✅ |
| No `process.env` outside `config/env.schema.ts` | ✅ grep-verified |
| No application branch on environment or vendor | ✅ no `isAtlas` / `isDocker` / data-path `NODE_ENV` branch exists |
| `MONGODB_URI` treated as a secret | ✅ in `SECRET_KEYS`; never logged, never echoed |
| No `DatabasePort` / `TransactionPort` / `UnitOfWork` | ✅ |
| No migration tooling | ✅ |
| CI holds no Atlas credential | ✅ |

---

## 10. Authority

| Topic | Authority |
|---|---|
| **Environment model** | **this document** §2 |
| **CI transaction harness** | **this document** §3 |
| **Transaction gate classification** | **this document** §4 |
| Transaction design, concerns, operations | [`CONSISTENCY-MODEL.md`](./CONSISTENCY-MODEL.md) §2–§9 |
| Configuration boundary | [`CONFIGURATION-ARCHITECTURE.md`](./CONFIGURATION-ARCHITECTURE.md) |
| Clean database / no migration | [`ARCHITECTURE-FREEZE-RATIFICATION.md`](./ARCHITECTURE-FREEZE-RATIFICATION.md) §6 + §5 here |
| Module tiers · ports | `CODEBASE-STRUCTURE.md` §7 · `PORTS-AND-CONTRACTS.md` §3 |
