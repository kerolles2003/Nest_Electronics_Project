# PHASE 2.0 — REPORT

**Date:** 2026-08-30 · **Type:** Read-only audit · **Outcome:** Plan delivered, no implementation
**Detailed artifact:** [`PHASE-2.0-REPOSITORY-RUNTIME-PLAN.md`](./PHASE-2.0-REPOSITORY-RUNTIME-PLAN.md)

---

## 1. Files inspected

### Repository configuration (read)

`package.json` (root) · `pnpm-workspace.yaml` · `pnpm-lock.yaml` (metadata) · `turbo.json` · `tsconfig.base.json` · `.gitignore` · git remotes, branch, commit count, `status --porcelain`

### Application manifests and configuration (read)

`apps/admin/package.json` · `apps/storefront/package.json` · `apps/admin/next.config.ts` · `apps/storefront/next.config.ts` · `apps/storefront/tsconfig.json` · `apps/admin/tsconfig.json` · both `eslint.config.mjs`

### Package manifests and contents (read)

All six `packages/*/package.json` · `packages/config/src/env.ts` · `packages/types/src/{index,enums,schemas,dtos}.ts` · `packages/types/src/{database,domain}.ts` (heads) · `packages/ui/tsconfig.json` · full file listings for all six packages

### Application source (read / measured)

`apps/storefront/src/lib/supabase.ts` · `apps/storefront/src/proxy.ts` · directory trees for both apps · file counts · import-frequency analysis of all `@nest/*` packages · `@supabase/*` import sites · `'use server'` census · `.rpc()` call-site census · route-handler inventory

### Frozen architecture consulted

`ARCHITECTURE-FREEZE-RATIFICATION.md` (§11 gates, §12) · `ARCHITECTURE-REVIEW-DOSSIER.md` (§23, open items) · `CODEBASE-STRUCTURE.md` (§1–2.3) · `CONFIGURATION-ARCHITECTURE.md` · `NESTJS-MODULE-MAP.md` (§8) · `API-CONTRACT.md` · `API-STANDARDS.md` · `CONSISTENCY-MODEL.md` · `TESTING-ARCHITECTURE.md` (§12) · `PHASE-1-REPORT.md` (§22) · `DTO-STRATEGY.md` · `OBSERVABILITY.md` · `CODE-STANDARDS.md` · `docs/audit/phase-0-audit.md`

---

## 2. Repository classification

> **A real monorepo: pnpm workspaces + Turborepo, with functioning package boundaries.**

Not partial, not ad-hoc.

| Evidence | Value |
|---|---|
| Workspace declaration | `pnpm-workspace.yaml` → `apps/*`, `packages/*` |
| Applications | **2** — `apps/storefront` (100 src files), `apps/admin` (59 src files, `basePath: '/admin'`) |
| Packages | **6** — `ui`, `types`, `config`, `providers`, `services`, `repositories` |
| Cross-package imports | **161** across the two apps |
| Task orchestration | Turborepo 2 — `build`, `dev`, `lint`, `type-check`, `test`, `clean` |
| Package manager | pnpm `9.0.0` pinned; one root lock file; `workspace:*` protocol |
| Toolchain installed | Node `v24.11.0`, pnpm `9.0.0` |
| Framework | Next.js `16.2.4`, React `19.2.4`, App Router, Tailwind v4 — **both** apps |
| Git | GitHub remote, branch `main`, **2 commits** |

**Absent entirely:** CI (no `.github`), any Dockerfile, any docker-compose, any `.env.example`, any `test` script, any package `build` script, a root Prettier config.

**Backend coupling is narrower than expected:** only **4** application source files import `@supabase/*` (two `lib/supabase.ts`, two `proxy.ts`). Everything else reaches Supabase through `@nest/providers` / `@nest/services`. Write paths are **9** `'use server'` files plus **2** route handlers; **8** RPC call sites cover **5** distinct functions.

**Seven pre-existing tooling defects** were found and are documented as D-1…D-7 (plan §2.5). The most consequential: `packages/ui/tsconfig.json` extends `@nest/config/tsconfig.base.json`, **which does not exist**; and **neither app extends `tsconfig.base.json`**, so its strict flags currently apply to nothing.

---

## 3. Options considered

| Option | Verdict |
|---|---|
| **A** — existing web at root + `api/` subdirectory | ❌ Rejected — **destructive, not additive.** Requires dismantling a working workspace: collapsing two apps into one root, dissolving six packages used at 161 sites, rewriting both `next.config.ts`, deleting `pnpm-workspace.yaml` and `turbo.json`. Maximum churn, least capability, and it cannot express the actual two-front-end reality. |
| **B** — `apps/api` in the existing workspace | ✅ **Selected** |
| **C** — separate API repository | ❌ Rejected — its benefits are already available via Turborepo filters and per-app deploys, while its costs land during the highest-risk work: cross-repo coordination for ~11 conversion sites across two front-ends, a publish-and-bump protocol for the generated OpenAPI client, two CI pipelines where the project currently has zero, and two dependency graphs to keep aligned. Right answer for separate teams on separate release trains; the evidence (2 commits, one author, no CI) says that is not this project. |

---

## 4. Recommendation

> ### Option B — add `apps/api` to the existing pnpm + Turborepo workspace.

**The decisive finding: the monorepo question is already settled — the repository is one, and it works.** That inverts the usual cost calculation. The ceremony is a sunk cost; the only live question is whether to keep it, and two front-ends plus one generated API client say yes.

**`pnpm-workspace.yaml` requires no change at all** — `apps/*` already globs `apps/api`. The marginal structural cost of this recommendation is creating one directory.

Supporting reasons:

1. The Next.js → API cutover is a **coordinated two-sided change** across ~11 conversion sites and two front-ends. One repository makes each conversion one commit, one CI run, one atomic revert.
2. The OpenAPI contract and its generated client must move in lockstep; co-location makes regeneration a build step instead of a publish protocol.
3. **Deployment independence is not a repository property** — `turbo build --filter=api` already provides it, and `turbo.json` already declares per-app outputs.
4. The project has **no CI**. Building one pipeline across all workspaces is strictly less work than building and aligning two.

**The honest cost of Option B**, stated in the plan (§4.2, R-5): a shared workspace makes it *possible* to import legacy types into the new API. That is mitigated by an enforced lint rule — **`apps/api` may not import any `@nest/*` package** — verified in CI by a probe commit that must fail.

### One finding recorded, not resolved

`NESTJS-MODULE-MAP.md` §8 states that `@nest/types` *"seeds the DTOs directly."* **Inspection does not support "directly."** The package models the legacy Postgres schema: `snake_case` fields, UUID ids, **decimal money** (`z.number().positive()` where `MONEY-MODEL.md` mandates integer piastres), the **legacy** `OrderStatus` set (four states that no longer exist; three frozen states that are missing), lowercase enum values against a `SCREAMING_SNAKE_CASE` contract, and the **dead reservation** transaction types Phase 1 removed. 1,426 of its 1,979 lines are generated Supabase types.

Recorded as **F-1** (plan §12.3). It contradicts a *characterisation*, not a frozen decision, and does not change the structural recommendation. Amending that sentence is listed as non-blocking **N-1**; the import ban applies either way.

---

## 5. No-code confirmation

| Check | Result |
|---|---|
| Implementation code changed | ❌ None |
| NestJS project created | ❌ No |
| Dependencies installed / removed / upgraded | ❌ None |
| `package.json` modified (any workspace) | ❌ None |
| Lock file modified | ❌ None |
| Environment file created | ❌ None |
| Docker / docker-compose created | ❌ None |
| CI configuration created | ❌ None |
| MongoDB infrastructure created | ❌ None |
| Next.js file changed | ❌ None |
| Supabase touched (code or project) | ❌ None |
| Application moved / renamed / deleted / archived | ❌ None |
| Directory created | ✅ `docs/phase-2/` only |
| Files created | ✅ Exactly 2, both in `docs/phase-2/` |

**Baseline:** `git status --porcelain` recorded **112 entries (111 outside `docs/`)** *before* this phase began — pre-existing work-in-progress from commit `dc7768b`, unrelated to Phase 2.0 and untouched by it.

---

## 6. Open questions

### Blocking (3)

| # | Question | Blocks |
|---|---|---|
| **B-1** | Rotate the credential exposed in the tracked file `apps/admin/src/test.md` — it is in the history of a repository with a GitHub remote, and deletion does not remediate history | Sub-phase 2.1 |
| **B-2** | Commit and push the repository state — the 111 uncommitted non-docs changes **and** the entirely untracked `docs/` tree. `git ls-files docs/` returns **0** against **59 files on disk**; `docs/` is not gitignored, merely never committed, and nothing is unpushed. **The complete frozen architecture therefore exists in one copy, on one machine, with no history** — including the Phase 0.5 forensic extraction, which cannot simply be re-run | Sub-phase 2.1 |
| **B-3** | Provide a staging environment with a real MongoDB replica set, or explicitly defer that leg of the gate with a recorded date | Sub-phase 2.5 (**staging leg only** — local and CI proceed) |

### Non-blocking (10)

`N-1` amend the `@nest/types` characterisation (F-1) · `N-2` confirm GitHub Actions · `N-3` **OPEN-006** instance count → whether Redis is needed before go-live · `N-4` **OPEN-004** email provider · `N-5` API hosting target · `N-6` Cloudinary provisioning · `N-7` production MongoDB topology · `N-8` fate of the dead `packages/config/src/env.ts` · `N-9` Node `engines` floor (declared `>=20`, running `v24.11.0`) · `N-10` retention of `basePath: '/admin'`

**No blockers were invented.** Every item with a documented safe fallback is classified non-blocking, matching the frozen register's treatment of OPEN-001…OPEN-008.

---

## 7. Recommended next phase

> **Phase 2.1 — Workspace Hygiene & CI Foundation**

**Not** NestJS creation. The workspace must be green and enforceable *before* a third application joins it: seven pre-existing tooling defects (D-1…D-7) would otherwise make the API's first CI run red for reasons that have nothing to do with the API.

**Entry conditions:** B-1 and B-2 resolved.

**Delivers:** the seven defect fixes · the project's **first CI pipeline** (lint → type-check across **all** workspaces → test → build) · boundary lint rules as **errors**, including the `apps/api` ⇏ `@nest/*` ban · `.env.example` for both web apps · a root Prettier configuration.

**Completion gate:** `lint`, `type-check` and `build` pass across all workspaces on a clean checkout in CI; both web apps still build and run; a deliberate probe commit importing `@nest/types` from a stub under `apps/api/` **fails** CI.

**Then, in order:** 2.2 NestJS bootstrap → 2.3 configuration → 2.4 MongoDB runtime → **2.5 🔴 transaction rollback gate** → 2.6 application core → 2.7 contract surface & health → 2.8 provider skeleton → 2.9 verification & packaging.

> **Sub-phase 2.5 blocks 2.6 onward.** No domain module may be written until the rollback test — write A, write B, force failure, roll back, verify **both** absent — passes in local, CI **and** staging, and **fails loudly** against a standalone `mongod`.
