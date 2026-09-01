# PHASE 2.0 — REPOSITORY & RUNTIME FOUNDATION PLAN

**Status:** Audit complete · **Date:** 2026-08-30 · **Phase:** 2.0 (audit & planning only — no implementation)
**Preceded by:** [`ARCHITECTURE-FREEZE-RATIFICATION.md`](../architecture/ARCHITECTURE-FREEZE-RATIFICATION.md) — *ARCHITECTURE FREEZE: APPROVED*

> This document is a **read-only audit and a plan**. No source file, manifest, lock file, environment file or infrastructure file was created or modified in producing it. See §16 for the verification record.

---

## 1. Executive Recommendation

### Recommended repository structure

> **Option B — add `apps/api` to the existing pnpm + Turborepo workspace.**

```
nest-electronics/
├── apps/
│   ├── storefront/     EXISTING
│   ├── admin/          EXISTING
│   └── api/            ← NEW (Phase 2.2, not created yet)
└── packages/           EXISTING (6 packages)
```

### Why

The decisive finding of this audit is that **the question "should this become a monorepo?" is already answered — it is one, and it works.**

`pnpm-workspace.yaml` declares `apps/*` and `packages/*`. `turbo.json` defines a six-task pipeline. Six packages are consumed through the `workspace:*` protocol at **161 import sites** across two applications. This is not a repository *considering* a workspace; it is a functioning workspace with real package boundaries.

That inverts the usual cost calculation:

| | Normally | Here |
|---|---|---|
| Cost of adopting a workspace | Real — tooling, config, learning, build orchestration | **Already paid** |
| Cost of adding one more app to it | — | **One directory.** `apps/*` already globs it. |

`apps/api` requires **zero changes to `pnpm-workspace.yaml`**, because `apps/*` already matches it. The marginal structural cost of Option B is, precisely, creating a folder.

Four further reasons, each grounded in evidence gathered below:

1. **The Next.js → API cutover is a coordinated two-sided change.** §7 shows that replacing a Supabase call means editing a Server Action in `apps/storefront` *and* relying on an endpoint in `apps/api`. There are **9 Server Action files and 2 route handlers** to convert across **two** front-ends. In one repository this is one commit, one review, one CI run, one atomic revert. Across two repositories it is a choreographed release with a window in which `main` is broken on one side.

2. **The API contract must be generated and consumed in lockstep.** The frozen architecture generates `openapi.json` from the API's DTO decorators and derives `packages/api-client` from it ([`API-CONTRACT.md`](../architecture/API-CONTRACT.md) §8). Producer and consumer in one workspace makes regeneration a build step. Split, it becomes a publish-and-bump protocol — the single most common source of silent contract drift.

3. **Deployment independence is not a repository property.** Turborepo filters (`turbo build --filter=api`) already give per-application builds; the existing apps are separately buildable today. Option C buys deployment independence the repository was never obstructing.

4. **The project has no CI at all** (no `.github`, no pipeline of any kind, 2 commits). Phase 2 must build the project's first pipeline. Building **one** pipeline that lints, type-checks, tests and builds all workspaces is strictly less work than building two and keeping them consistent.

### Why the alternatives were rejected

| Option | Rejected because |
|---|---|
| **A — web at root + `api/` subdirectory** | It is not additive; it is **destructive**. Reaching it requires dismantling a working workspace: collapsing two apps (which cannot both sit at the root), dissolving six packages consumed at 161 sites, rewriting `transpilePackages` in both `next.config.ts` files, and deleting `pnpm-workspace.yaml` and `turbo.json`. It produces the **most churn of the three options** while delivering the least capability. It also cannot express the actual application count — there are **two** front-ends, not one. |
| **C — separate API repository** | Its benefits (independent lifecycle, independent CI, hard boundary) are already obtainable inside the workspace via Turborepo filters and per-app deploys, while its costs are real and land during the highest-risk work: cross-repo coordination for every one of the ~11 conversion sites in §7, a publish/version protocol for the generated client, two CI configurations, and two dependency graphs to keep on the same Node/TypeScript versions. It would be the right answer if the API and web were owned by different teams on different release trains. Evidence — **2 commits, one author, no CI** — says they are not. |

### Consistency with the freeze

This recommendation matches [`NESTJS-MODULE-MAP.md`](../architecture/NESTJS-MODULE-MAP.md) §8 (*"`apps/api` joins the existing Turborepo"*) and [`ARCHITECTURE-REVIEW-DOSSIER.md`](../architecture/ARCHITECTURE-REVIEW-DOSSIER.md) §23. It was reached here by independent inspection of the repository, not inherited from those documents — the three options were scored on evidence in §4 before the freeze was consulted.

**However**, this audit found one claim in the frozen documents that the repository does **not** support. It concerns shared-code reuse, not repository structure, and is recorded as **F-1** in §12.3.

---

## 2. Current Repository Evidence

All statements in this section are direct observations. Nothing is inferred.

### 2.1 Repository classification

> **Classification: a real monorepo — pnpm workspaces + Turborepo — with functioning package boundaries.**

Not "partial", not "ad-hoc". The evidence:

| Marker | Evidence |
|---|---|
| Workspace declaration | `pnpm-workspace.yaml` → `packages: ['apps/*', 'packages/*']` |
| Task orchestration | `turbo.json` → tasks `build`, `dev`, `lint`, `type-check`, `test`, `clean`; `build` has `dependsOn: ["^build"]` and declares `.next/**` + `dist/**` outputs |
| Internal linking | `workspace:*` protocol used for all six packages in both apps |
| Real consumption | 161 `@nest/*` import statements across `apps/*/src` |
| Single lock file | `pnpm-lock.yaml` (190,434 bytes) at root only |
| Pinned package manager | `"packageManager": "pnpm@9.0.0"`; `engines: { node: ">=20", pnpm: ">=9" }` |

### 2.2 Root structure

```
nest-electronics/
├── apps/
│   ├── admin/                    Next.js 16.2.4 — basePath '/admin'
│   └── storefront/               Next.js 16.2.4
├── packages/
│   ├── config/                   constants, tailwind preset, env (dead)
│   ├── providers/                Supabase adapters
│   ├── repositories/             repository interfaces
│   ├── services/                 service layer
│   ├── types/                    domain + generated DB types + Zod
│   └── ui/                       24 React components
├── docs/                         architecture (39 files), audit, db, auth, storage, migration
├── package.json                  root workspace manifest
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
├── tsconfig.base.json            ← present at ROOT
└── (loose root scripts, see 2.6)
```

**Absent from the repository entirely:**

| Not present | Consequence for Phase 2 |
|---|---|
| `.github/` — **no CI of any kind** | Phase 2 builds the project's first pipeline |
| Any `Dockerfile` | API containerisation is net-new |
| Any `docker-compose.*` | Local MongoDB runtime is net-new |
| Any `.env.example` | No documented environment contract exists |
| Any `.sql` file, `supabase/` dir, migrations | Confirms Phase 0.5; irrelevant now (clean rebuild) |
| Any `test` script in any workspace | `turbo test` is currently a no-op everywhere |
| Any `build` script in any package | See 2.5 |
| Root `.prettierrc` | `prettier` is a root devDependency with no config and no script |

**Toolchain actually installed:** Node `v24.11.0`, pnpm `9.0.0`. Both satisfy `engines`. Note Node 24 exceeds the declared `>=20` floor — the floor should be raised deliberately in Phase 2.1, not left implicit.

**Git:** remote `origin` → `https://github.com/kerolles2003/Nest_Electro.git`; branch `main`; **2 commits**. GitHub Actions is therefore the evidence-based CI target.

### 2.3 Working-tree state (pre-existing)

`git status --porcelain` reports **112 entries**: 59 modified, 21 deleted, 32 untracked. **111 of these are outside `docs/`.**

> This dirty tree **pre-dates this phase and was not produced by it.** It is recorded here as the baseline against which §16 verifies that Phase 2.0 changed nothing. The uncommitted work is an unrelated in-progress UI change (latest commit: `dc7768b edit ui and fix admin login`).
>
> **Implication for Phase 2.1:** the tree must be committed or stashed before any structural work begins. Introducing `apps/api` on top of 111 uncommitted changes makes any later `git bisect` or revert unusable.

**The entire `docs/` tree is untracked.** `git ls-files docs/` returns **0** against **59 files on disk**. `docs/` is **not** `.gitignore`d — it has simply never been committed. The repository has 2 commits and **nothing unpushed**, so `origin` holds neither the Phase 0 audit, the Phase 0.5 forensic extraction, the 39 frozen architecture documents, the ratification record, nor this plan.

> 🔴 **The frozen architecture exists on exactly one machine, in exactly one copy, with no version history.** Every Phase 1 and 1.1 decision — the order transition matrix, the money model, the port inventory — is one disk failure or one `git clean -fdx` from being gone. This is the single most valuable and least protected asset in the project, and it is the input to every remaining phase. Tracked as blocking decision **B-2** and risk **R-14**.

### 2.4 Package manager & workspace capability

| Question | Answer | Evidence |
|---|---|---|
| Which manager? | **pnpm 9** | `pnpm-lock.yaml`, `packageManager: pnpm@9.0.0` |
| Lock file? | One, at root | `pnpm-lock.yaml` |
| Workspaces enabled? | **Yes, already** | `pnpm-workspace.yaml` |
| Do the globs already cover `apps/api`? | **Yes** | `apps/*` matches it — **no config change required** |
| Package boundaries real? | **Yes** | `exports` maps in all 6 manifests; `workspace:*` deps |
| Build orchestration? | **Yes, Turborepo 2** | `turbo.json` |

### 2.5 Tooling defects found (pre-existing, must not be inherited by `apps/api`)

These are recorded because Phase 2 introduces a workspace that will run under the same tooling, and because Phase 2.1 must make CI green.

| # | Defect | Evidence | Impact |
|---|---|---|---|
| **D-1** | `packages/ui/tsconfig.json` declares `"extends": "@nest/config/tsconfig.base.json"` — **that file does not exist.** `packages/config/` contains only `package.json` and `src/`; the base config lives at the repo **root** as `tsconfig.base.json`, and `@nest/config`'s `exports` map does not expose it. | `ls packages/config/` | The `@nest/ui` tsconfig is broken. A CI `type-check` stage would fail on it immediately. |
| **D-2** | **Neither app extends `tsconfig.base.json`.** Both `apps/admin/tsconfig.json` and `apps/storefront/tsconfig.json` have no `extends`. | grep for `"extends"` | The strict flags in `tsconfig.base.json` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`) apply to **nothing**. The base config is effectively decorative. |
| **D-3** | `apps/storefront` has **no `type-check` script**. | `apps/storefront/package.json` scripts: `dev, build, start, lint` | `turbo type-check` silently skips 100 source files — the larger of the two apps. |
| **D-4** | **No package has a `build` script**, yet `turbo.json` declares `type-check` and `test` as `dependsOn: ["^build"]`. | all 6 package manifests | The dependency edge resolves to nothing. Packages are consumed as TypeScript source via `transpilePackages`, which works for Next.js but gives `apps/api` (a `tsc`/`nest build` consumer) no compiled artifact to import. |
| **D-5** | `packages/services` depends on `"@supabase/supabase-js": "*"` — an **unpinned wildcard**. | `packages/services/package.json` | Non-reproducible resolution. |
| **D-6** | The **root** `package.json` carries a runtime dependency `@supabase/supabase-js` used only by the loose root script `seed.js`. | root manifest | A workspace root should not carry application runtime dependencies. |
| **D-7** | `packages/config/src/env.ts` implements fail-fast env validation and is **imported by zero files** (verified: `@nest/config/env` has no importers anywhere). The only consumed entry point is `@nest/config/constants` (33 imports). | grep | Already cited in [`CONFIGURATION-ARCHITECTURE.md`](../architecture/CONFIGURATION-ARCHITECTURE.md) §1 as the cautionary precedent. **Confirmed still true.** |

### 2.6 Repository hygiene observations

- Nine loose scripts and data files sit at the repository root: `adjust_images.js`, `fix_hero.js`, `fix_hero2.js`, `fix_hero3.js`, `rewrite.js`, `rewrite2.js`, `seed.js`, `seed_data.json`, and a zero-byte file literally named `cinematic`. Most are `.gitignore`d.
- `DESIGN.md` and `DESIGN copy.md` are byte-identical duplicates (18,320 bytes each).
- `.gitignore` excludes `.env` and `.env.*` but **whitelists `!.env.example`** — the mechanism for a committed environment contract exists; no such file has ever been written.
- **No `.env*` file is tracked by git** (verified). Root `.env` is 0 bytes. `apps/admin/.env.local` and `apps/storefront/.env.local` exist locally and are correctly ignored.

### 2.7 Open security finding carried forward

`apps/admin/src/test.md` (222 bytes) is **tracked by git** and, per Phase 0 finding §1.9, contains a live Anthropic API key. It is present in the history of a repository that has a GitHub remote.

> Deleting the file does not remediate this — the key is in commit history. **Rotation is the only remediation.** This is listed in §15 as blocking for the CI sub-phase, because CI work necessarily involves configuring repository secrets and increases the repository's exposure surface. No key material is reproduced in this document.

---

## 3. Current Web Application Assessment

### 3.1 There are two web applications, not one

The Phase 2.0 brief refers to "the existing web application" in the singular. The repository contains **two**, and the transition plan in §7 must cover both.

| | `apps/storefront` | `apps/admin` |
|---|---|---|
| **Location** | `apps/storefront` | `apps/admin` |
| **Framework** | Next.js `16.2.4`, React `19.2.4` | Next.js `16.2.4`, React `19.2.4` |
| **Router** | **App Router** (`src/app/`) | **App Router** (`src/app/`) |
| **Source files** (`.ts`/`.tsx` under `src/`) | **100** | **59** |
| **basePath** | none | **`/admin`** |
| **Styling** | Tailwind v4 (`@tailwindcss/postcss`) | Tailwind v4 |
| **State** | `zustand` ^5, `nuqs` ^2 | — |
| **Validation** | via `@nest/types` | `zod` ^3.23.8 (direct) |
| **Build** | `next build` | `next build` |
| **Dev** | `next dev` | `next dev` |
| **Lint** | `eslint` (flat config `eslint.config.mjs`) | `eslint` (flat config) |
| **Type-check** | ❌ **missing** (D-3) | ✅ `tsc --noEmit` |
| **Env** | `.env.local` (untracked) | `.env.local` (untracked) |
| **`transpilePackages`** | all six `@nest/*` packages | all six `@nest/*` packages |

`basePath: '/admin'` is meaningful evidence: the admin app is built to be mounted under a path on a shared origin, not necessarily on its own subdomain. That is a deployment decision Phase 2 must not silently change.

### 3.2 Current backend coupling

Coupling to Supabase is **narrower than expected** and concentrated in identifiable seams.

**Direct `@supabase/*` imports in application source: 4 files only.**

| File | Role |
|---|---|
| `apps/storefront/src/lib/supabase.ts` | per-request SSR client |
| `apps/storefront/src/proxy.ts` | Next.js 16 proxy (middleware) — session refresh + route protection |
| `apps/admin/src/lib/supabase.ts` | SSR client **+ `createAdminClient()` reading `SUPABASE_SERVICE_ROLE_KEY`** |
| `apps/admin/src/proxy.ts` | proxy — session refresh + role enforcement |

Everything else reaches Supabase through the package layer:

```
apps/{storefront,admin}
        │
        ├── @nest/ui              55 imports   presentation, Supabase-free
        ├── @nest/types           47 imports   types + Zod
        ├── @nest/config          33 imports   ALL of them '@nest/config/constants'
        ├── @nest/providers       16 imports   ← Supabase SDK lives here
        ├── @nest/services         8 imports
        └── @nest/repositories     2 imports
```

**Write paths** — 9 files declare `'use server'`:

| App | Server Actions |
|---|---|
| `apps/admin/src/actions/` | `category-brand`, `coupon`, `inventory`, `order`, `product`, `review` (6) |
| `apps/storefront/src/actions/` | `cart`, `checkout`, `wishlist` (3) |

Plus **2 route handlers**: `apps/admin/src/app/api/attributes/route.ts`, `apps/admin/src/app/api/check-slug/route.ts`.

**PostgreSQL RPCs invoked from source (8 call sites, 5 distinct functions):**

| RPC | Sites |
|---|---|
| `update_order_status_v2` | 3 |
| `search_products` | 2 |
| `create_order_v2` | 1 |
| `adjust_stock_v2` | 1 |
| `adjust_product_stock` | 1 |

These are exactly the functions recovered in Phase 0.5 and re-specified in Phase 1. Each becomes an API endpoint.

### 3.3 Does the existing web application structurally support adding an API beside it?

> **Yes — with no structural change whatsoever.**

`pnpm-workspace.yaml` globs `apps/*`. Creating `apps/api/package.json` enrols it in the workspace and in every Turborepo task. Nothing in either Next.js app references a sibling app; the coupling is app → package, never app → app.

### 3.4 Would moving the existing applications create unnecessary churn?

> **Yes — severe, and for no benefit.** Quantified in §4 under Option A.

### 3.5 Would keeping them in place create repository confusion?

> **One real risk, and it is a naming risk, not a structural one.**

After `apps/api` exists, the repository contains two directories named `providers` with **different and partly contradictory meanings**:

| Path | Meaning | Contains |
|---|---|---|
| `packages/providers/` | *legacy* — Supabase data-access adapters | `@supabase/supabase-js` calls |
| `apps/api/src/providers/` | *frozen* — replaceable third-party **vendor** adapters only ([`CODEBASE-STRUCTURE.md`](../architecture/CODEBASE-STRUCTURE.md) §2.2 Refinement 2) | Resend, Cloudinary |

`CODEBASE-STRUCTURE.md` §2.2 explicitly *excludes* database access from `providers/` ("dishonest abstraction"). `packages/providers` is database access. The words collide; the definitions oppose. Mitigation in §14 (**R-3**).

A second, milder collision: the internal npm scope is `@nest/*` (`@nest/types`, `@nest/config`), one character from NestJS's own `@nestjs/*`. Inside `apps/api`, both will be imported in the same files. Mitigation in §14 (**R-4**).

---

## 4. Repository Structure Options

Scored against the criteria named in the Phase 2.0 brief. **Rank: 1 = best.**

| Criterion | **A** — web at root + `api/` | **B** — `apps/web` + `apps/api` workspace | **C** — separate API repository |
|---|---|---|---|
| **Migration churn** | 🔴 **Extreme.** Dismantle the workspace: collapse 2 apps into 1 root (impossible without demoting one), dissolve 6 packages used at 161 sites, rewrite both `next.config.ts`, delete `pnpm-workspace.yaml` + `turbo.json`, regenerate the lock file | 🟢 **Zero.** `apps/*` already globs `apps/api`. Add one directory. | 🟡 **Low in this repo**, but adds a second repo to create, configure and secure |
| **Fits the actual app count (2 front-ends)** | 🔴 Cannot express it — only one app can occupy the root | 🟢 Already expresses it | 🟢 Expresses it (web repo keeps both) |
| **Build isolation** | 🟡 Ad-hoc, hand-rolled | 🟢 Turborepo filters + task graph + caching | 🟢 Absolute |
| **Deployment isolation** | 🟡 Achievable, manual | 🟢 `--filter=api`; already how the 2 apps build | 🟢 Absolute |
| **Independent lifecycle / release train** | 🔴 Poor | 🟡 Same repo, but independent deploys | 🟢 Best |
| **Contract synchronisation** (OpenAPI → `packages/api-client`) | 🟡 Possible | 🟢 **Generation is a build step**; producer and consumer co-located | 🔴 **Publish-and-bump protocol** — the classic drift source |
| **Cutover coordination** (§7: ~11 conversion sites, 2 front-ends) | 🟡 | 🟢 **One commit, one CI run, one atomic revert** | 🔴 Cross-repo choreography; `main` breakable on one side |
| **CI cost** (project has **none** today) | 🟡 One pipeline, but on a freshly broken structure | 🟢 **One pipeline** covering all workspaces | 🔴 **Two pipelines** to build and keep aligned |
| **Toolchain drift risk** (Node/TS/lint versions) | 🟡 | 🟢 Single lock file, single root config | 🔴 Two graphs to hold in sync manually |
| **Developer experience** (1 author, 2 commits) | 🔴 | 🟢 One clone, one install, `turbo dev` | 🟡 Two clones, two installs, two terminals |
| **Operational overhead** | 🟡 | 🟢 Lowest | 🔴 Highest |
| **Monorepo ceremony introduced** | 🟢 None | 🟢 **None — already paid for** | 🟢 None |
| **Future maintainability** | 🔴 | 🟢 | 🟡 Good once teams split; premature now |
| **Rank** | **3** | **1** | **2** |

### 4.1 Answering the brief's Option-B questions directly

The brief asks whether Option B introduces monorepo ceremony without real benefit. Answered on evidence:

| Question | Evidence-based answer |
|---|---|
| **Does the project actually benefit from a workspace?** | It **already does**: 161 cross-package imports, 24 shared UI components used by both front-ends, one lock file, one task graph. Removing the workspace would require duplicating `@nest/ui` across two apps. |
| **What shared code exists today?** | Six packages. `@nest/ui` (24 components) and `@nest/config/constants` are genuinely shared and Supabase-free. `@nest/types` is shared but legacy-shaped (see F-1, §12.3). `@nest/providers`/`services`/`repositories` are the Supabase layer the API replaces. |
| **What shared code is expected soon?** | Exactly one item: `packages/api-client`, generated from `openapi.json`, consumed by **both** front-ends ([`API-CONTRACT.md`](../architecture/API-CONTRACT.md) §8). Two consumers is the textbook justification for a shared package — and it does **not** justify a *new* workspace, because the workspace exists. |
| **Would Option B introduce ceremony without benefit?** | **No.** The ceremony is a sunk cost. The question is only whether to *keep* it, and the answer is yes: two front-ends and one generated client require it. |

### 4.2 The strongest argument against Option B, stated fairly

A monorepo lets a developer reach across a boundary that ought to be sealed — for example importing `@nest/types` domain interfaces directly into `apps/api` instead of defining API-owned models. That would silently re-import the legacy Postgres shape into the new backend and quietly undo Phase 1.

This is a **real** risk, and F-1 (§12.3) shows the temptation is already documented in the frozen architecture. It is not, however, an argument for a separate repository — it is an argument for an **enforced dependency rule**. [`DEPENDENCY-RULES.md`](../architecture/DEPENDENCY-RULES.md) §5 already mandates lint-enforced boundaries as CI errors. §12 turns that into an explicit `apps/api` import allow-list, and §13 makes it a completion gate for sub-phase 2.1. Risk **R-5** tracks it.

---

## 5. Final Repository Recommendation

Legend — **`[E]`** existing today · **`[F]`** future, planned, **not created yet** · **`[X]`** to be removed at a named later phase.

```
nest-electronics/
│
├── apps/
│   ├── storefront/                    [E]  Next.js 16.2.4 — 100 src files
│   ├── admin/                         [E]  Next.js 16.2.4 — 59 src files, basePath /admin
│   └── api/                           [F]  NestJS — created in Phase 2.2
│       ├── src/
│       │   ├── main.ts                [F]  bootstrap only
│       │   ├── app.module.ts          [F]  composition root
│       │   ├── config/                [F]  Phase 2.3 — the ONLY process.env reader
│       │   ├── common/                [F]  Phase 2.6 — cross-cutting (3+ consumers)
│       │   ├── database/              [F]  Phase 2.4 — connection, TransactionService, indexes
│       │   ├── modules/               [F]  Phase 3+ — NOT in Phase 2
│       │   ├── providers/             [F]  Phase 2.8 — vendor adapters ONLY
│       │   └── templates/             [F]  Phase 2.8 — email templates
│       ├── test/                      [F]  e2e + fixtures
│       ├── Dockerfile                 [F]  Phase 2.9
│       ├── nest-cli.json              [F]
│       ├── tsconfig.json              [F]
│       └── package.json               [F]
│
├── packages/
│   ├── ui/                            [E]  24 components — KEEP, unchanged
│   ├── config/                        [E]  KEEP /constants; src/env.ts is dead (D-7)
│   ├── types/                         [E]  KEEP for the web apps only — see F-1
│   ├── repositories/                  [E]  [X] retire after Phase 9
│   ├── providers/                     [E]  [X] DELETE after Phase 9 (Supabase)
│   ├── services/                      [E]  [X] DELETE after Phase 9
│   └── api-client/                    [F]  Phase 8 — generated from OpenAPI
│
├── docs/                              [E]  architecture (frozen) + phase-2 (this)
│
├── .github/workflows/                 [F]  Phase 2.1 — the project's FIRST CI
├── docker-compose.dev.yml             [F]  Phase 2.4 — local Mongo replica set
├── package.json                       [E]  root workspace manifest
├── pnpm-workspace.yaml                [E]  UNCHANGED — 'apps/*' already covers api
├── pnpm-lock.yaml                     [E]  regenerated when apps/api deps are added
├── turbo.json                         [E]  extended in 2.1
└── tsconfig.base.json                 [E]  currently extended by nothing (D-2)
```

**What Phase 2 does *not* do to this tree:** no application is moved, renamed, archived or deleted. `packages/providers`, `packages/services` and `packages/repositories` keep working, powering the live web apps, until Phase 9 retires them. The `[X]` marks are a **destination**, not a Phase 2 action.

---

## 6. Runtime Architecture

### 6.1 Target runtime

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────┐
│  Storefront      │   │  Admin           │   │  Flutter app         │
│  (Next.js)       │   │  (Next.js)       │   │  SEPARATE REPOSITORY │
└────────┬─────────┘   └────────┬─────────┘   └──────────┬───────────┘
         │                      │                        │
         │  HTTPS               │  HTTPS                 │  HTTPS
         │  JWT in cookie       │  JWT in cookie         │  Bearer token
         │                      │                        │
         └──────────────┬───────┴────────────────────────┘
                        ▼
             ┌─────────────────────────┐
             │   NestJS API            │
             │   /api/v1               │
             │   apps/api              │
             └───────────┬─────────────┘
                         │
         ┌───────────────┼────────────────┐
         ▼               ▼                ▼
  ┌─────────────┐  ┌───────────┐   ┌────────────┐
  │  MongoDB    │  │ Cloudinary│   │  Resend    │
  │ REPLICA SET │  │  (media)  │   │  (email)   │
  │  MANDATORY  │  │           │   │            │
  └─────────────┘  └───────────┘   └────────────┘
     owned by         via              via
     database/    MediaStoragePort  EmailSenderPort
```

### 6.2 The rules this diagram encodes

| # | Rule | Source |
|---|---|---|
| 1 | **Every client speaks HTTP to `/api/v1`. There is no second entry point.** | [`API-CONTRACT.md`](../architecture/API-CONTRACT.md) §1 |
| 2 | **No client touches MongoDB.** Next.js Server Actions become HTTP callers, not data-layer callers. | §7 |
| 3 | **Vendor SDKs appear only under `apps/api/src/providers/`.** Lint-enforced (freeze gate #5). | [`CODEBASE-STRUCTURE.md`](../architecture/CODEBASE-STRUCTURE.md) §2.2 |
| 4 | **MongoDB is not behind a port.** It is module-local persistence; a `DatabasePort` is explicitly forbidden. | [`CODEBASE-STRUCTURE.md`](../architecture/CODEBASE-STRUCTURE.md) §2.2, freeze gate #10 |
| 5 | **Cookie auth for web, bearer for Flutter — one auth system, two transports.** | [`API-CONTRACT.md`](../architecture/API-CONTRACT.md) §2 |
| 6 | **No Redis.** Deferred pending OPEN-006. | [`REDIS-DECISION.md`](../architecture/REDIS-DECISION.md) |
| 7 | **No message queue, no background worker.** Email is fire-and-retry in-process. | [`NESTJS-MODULE-MAP.md`](../architecture/NESTJS-MODULE-MAP.md) §7 |

### 6.3 Flutter's position — repository-independent

The Phase 2.0 brief requires that Flutter must not influence repository structure. This plan satisfies that literally:

| Flutter must NOT require | Status |
|---|---|
| Shared TypeScript packages | ✅ Its client is generated **Dart**, into the Flutter repository |
| Shared repository workspace | ✅ Flutter is never added to `pnpm-workspace.yaml` |
| Shared UI packages | ✅ `@nest/ui` is React; Flutter uses none of it |
| Flutter-specific backend architecture | ✅ Bearer-token support and `SCREAMING_SNAKE_CASE` enums are **general API-contract properties**, adopted for correctness, not for Flutter |

> **The integration boundary is `openapi.json`, not a repository, a package or a shared type.** Flutter consumes a published contract. If the Flutter team never sees this repository, nothing breaks.

---

## 7. Next.js → API Transition Boundary

> **Nothing in this section is implemented in Phase 2.** This defines where responsibility moves and in what order, so Phase 2 does not build something Phase 9 must undo.

### 7.1 Responsibility movement

| Responsibility | Today | Destination | Phase |
|---|---|---|---|
| Rendering, routing, layout, SEO | Next.js | **Stays in Next.js permanently** | — |
| Client state (`zustand`), URL state (`nuqs`) | Next.js | **Stays** | — |
| Design system (`@nest/ui`) | `packages/ui` | **Stays** | — |
| Form UX and inline feedback | Next.js | **Stays** | — |
| **Input validation as a trust boundary** | client-side Zod (Phase 0: registration validated **only in the browser**) | **Moves to the API.** Web-side validation is retained for UX and demoted from a security control to a convenience. | 4 |
| Authentication / sessions | Supabase GoTrue via `proxy.ts` | **Moves** to `AuthModule`; `proxy.ts` becomes a JWT-cookie refresher | 4 |
| Authorization (RLS + `is_admin()`) | 58 Postgres policies | **Moves** to Nest guards + the authorization traceability matrix | 4 |
| Catalog / search reads | `@nest/services` → `@nest/providers` → Supabase | **Moves** to `/products`, `/categories`, `/brands`, `/search` | 5 |
| Media upload | Server Action → Supabase Storage | **Moves** to `MediaStoragePort` → Cloudinary | 5 |
| **Order placement, stock, coupons** (`create_order_v2`, `adjust_stock_v2`, `update_order_status_v2`) | 5 RPCs, 8 call sites | **Moves** to `/orders`, `/admin/inventory` — inside MongoDB transactions | 6 |
| Reviews, blog, audit | Supabase | **Moves** | 7 |
| Direct `@supabase/*` usage (4 files) | present | **Deleted** | 9 |
| `packages/providers`, `services`, `repositories` | present | **Deleted / retired** | 9 |

### 7.2 What must never be duplicated long-term

| Must exist in exactly one place | Where | Why |
|---|---|---|
| Money arithmetic | `PricingModule` in the API | [`MONEY-MODEL.md`](../architecture/MONEY-MODEL.md); integer piastres, rounded once |
| Stock writes | `InventoryModule` in the API | [`INVENTORY-MODEL.md`](../architecture/INVENTORY-MODEL.md); the ledger invariant |
| Order state transitions | `OrdersModule` in the API | [`ORDER-LIFECYCLE.md`](../architecture/ORDER-LIFECYCLE.md) §5 — the T0–T14 matrix |
| Authorization decisions | API guards | The web app may hide a button; it may not grant access |
| The status/enum vocabulary | `openapi.json` (generated) | Prevents the web app re-declaring a divergent enum — precisely the F-1 hazard |

> **The transitional exception.** Between the first API endpoint and Phase 9 the two backends coexist, and some read logic is genuinely duplicated. That is acceptable **only** for reads, **only** while the endpoint is being cut over, and **never** for money, stock, or order state. A duplicate order-total calculation on the web side is a defect on the day it is written.

### 7.3 Will Supabase calls eventually disappear?

> **Yes — completely, by end of Phase 9.** Terminal state: zero `@supabase/*` imports anywhere; `packages/providers` and `packages/services` deleted; `packages/repositories` retired.

Phase 2 does not begin this. **Zero Supabase calls are replaced in Phase 2.**

### 7.4 How the web applications should consume the new API

**Direction (recommended, deferred to Phase 8/9 for implementation):**

1. **Server-side by default.** Server Components and Server Actions call the API from the Next.js server. HttpOnly cookies never reach client JavaScript, and the browser never learns the API's internal address.
2. **Through `packages/api-client`** — generated by `openapi-typescript` from `openapi.json`. No hand-written fetch wrapper, no hand-maintained response types.
3. **One conversion at a time**, endpoint by endpoint, each behind a passing test, each atomically revertible. This is only possible because both sides live in one repository (§4).
4. **Server Actions survive as an adapter layer.** `checkout.actions.ts` stops calling `supabase.rpc('create_order_v2')` and starts calling `apiClient.orders.create(...)`. The component tree above it does not change.
5. **Never call the API from the browser with the service credential.** The current `createAdminClient()` pattern in `apps/admin/src/lib/supabase.ts` has no successor — admin privilege becomes a JWT role claim checked by an API guard.

---

## 8. API Contract Boundary

The contract is frozen. This section states the **implementation direction only**; it introduces no new decision.

| Aspect | Direction | Authority |
|---|---|---|
| **Style** | REST over HTTPS, JSON. **GraphQL is not introduced** — the frozen architecture does not require it and no evidence in this repository justifies it. | [`API-CONTRACT.md`](../architecture/API-CONTRACT.md) §1 |
| **Versioning** | **URI versioning: `/api/v1`.** Additive-only within v1. Chosen over header versioning because it is visible in logs, curl, and a Flutter developer's URL bar. | [`API-CONTRACT.md`](../architecture/API-CONTRACT.md) §1 |
| **Envelope** | `{ data, meta? }` on success; `{ error }` on failure, with a stable machine-readable `error.code`. **No driver text ever crosses the boundary.** | [`API-STANDARDS.md`](../architecture/API-STANDARDS.md) §1, §3 |
| **Validation ↔ documentation** | `class-validator` DTOs; `@nestjs/swagger` generates OpenAPI **from the same decorated classes that validate at runtime**, so documentation cannot drift from behaviour. | [`DTO-STRATEGY.md`](../architecture/DTO-STRATEGY.md) |
| **DTO → OpenAPI relationship** | One direction only: **DTO is the source, `openapi.json` is the artifact.** The document is never hand-edited. | [`API-CONTRACT.md`](../architecture/API-CONTRACT.md) §8 |
| **Swagger UI** | `/api/v1/docs`. Behind `SWAGGER_ENABLED`; auth-gated or off in production. | [`CONFIGURATION-ARCHITECTURE.md`](../architecture/CONFIGURATION-ARCHITECTURE.md) §5 |
| **TypeScript client** | `openapi-typescript` → `packages/api-client` (Phase 8) | [`API-CONTRACT.md`](../architecture/API-CONTRACT.md) §8 |
| **Dart client** | `openapi-generator` → **the Flutter repository** | [`API-CONTRACT.md`](../architecture/API-CONTRACT.md) §8 |
| **Client independence** | ISO 8601 UTC dates · ObjectId hex ids as strings · money as `{amount, currency, formatted}` · offset pagination with **true totals** · all enums `SCREAMING_SNAKE_CASE` and documented, generating real Dart enums · bearer **and** cookie auth | [`API-CONTRACT.md`](../architecture/API-CONTRACT.md) §9 |

**Phase 2 obligation:** stand up the *mechanism* — versioned prefix, global `ValidationPipe` with `forbidNonWhitelisted: true`, global exception filter, envelope interceptor, Swagger generation — so that the first domain endpoint written in Phase 4 is contract-correct by construction. **Phase 2 defines no business endpoint.**

---

## 9. Environment Boundaries

> **Web environment configuration ≠ API environment configuration. Sharing a repository must never imply sharing a secret.**

### 9.1 Three disjoint sets

| Boundary | Owner | Contains | Never contains |
|---|---|---|---|
| **Web (public)** | `apps/storefront`, `apps/admin` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` | Any secret. `NEXT_PUBLIC_*` is **compiled into the browser bundle**. |
| **Web (server-only)** | Next.js server runtime | Internal API base URL; a server-to-server token if one is later introduced | Database credentials; vendor API keys |
| **API** | `apps/api` | `MONGODB_URI`, `JWT_SECRET`, `RESEND_API_KEY`, `CLOUDINARY_*`, `BCRYPT_ROUNDS`, `THROTTLE_*`, `LOG_LEVEL`, `SWAGGER_ENABLED` | Anything with a `NEXT_PUBLIC_` prefix |

**Not one variable is shared between the web set and the API set.** `NEXT_PUBLIC_API_URL` is a public address, not a credential.

### 9.2 Alignment with the frozen configuration architecture

Verified consistent with [`CONFIGURATION-ARCHITECTURE.md`](../architecture/CONFIGURATION-ARCHITECTURE.md). This phase contradicts none of it and adds nothing to it:

- `process.env` is read in **exactly one file**: `apps/api/src/config/env.schema.ts` (Zod, fail-fast, reports *every* error). Freeze gate #6, lint-enforced.
- **Application-level vs vendor-level config stays split.** `config/email.config.ts` holds `provider`/`fromAddress`; `providers/email/resend/resend.config.ts` holds `apiKey` and is read by **that adapter only**. `RESEND_API_KEY` appearing outside `providers/email/resend/` is a lint error.
- Environment-conditional behaviour is confined to **infrastructure** concerns (Swagger exposure, log level, provider selection). Business rules never branch on `NODE_ENV`.

**Why this matters here specifically:** D-7 confirms `packages/config/src/env.ts` implemented exactly this fail-fast validation and **was imported by nothing**, while `NEXT_PUBLIC_SUPABASE_URL` was read directly in five places. The pattern must not repeat. In `apps/api` the schema runs inside `ConfigModule` at boot, so the process **cannot start** without it.

### 9.3 Per-environment requirements

| Environment | `NODE_ENV` | MongoDB | Providers | Secrets from | Swagger |
|---|---|---|---|---|---|
| **Local dev** | `development` | Single-node replica set (`docker-compose.dev.yml`) | `EMAIL_PROVIDER=console` | untracked `.env` from a committed `.env.example` | on |
| **CI** | `test` | `mongodb-memory-server` **in replica-set mode** | fakes only | **none — vendor credentials deliberately absent** (freeze gate #12) | off |
| **Staging** | `production` | **Real replica set — must mirror production** | real providers, test credentials | platform secret store | auth-gated |
| **Production** | `production` | Atlas **M10+** or self-hosted 3-node | real providers | platform secret store | off or auth-gated |

### 9.4 Phase 2 environment obligations

- Write `apps/api/.env.example` — **variable names and descriptions only, never values.** `.gitignore` already whitelists `!.env.example`.
- Write `.env.example` for both web apps. **None exists today for any workspace** (§2.2).
- Keep every real `.env*` untracked. Currently correct: **zero `.env*` files are tracked by git.**
- **Rotate the credential in `apps/admin/src/test.md` before configuring CI secrets** (§2.7, §15 B-1).

---

## 10. MongoDB Transaction Gate

> ### This is the hardest prerequisite in Phase 2 and the one most likely to be skipped under schedule pressure.

### 10.1 The requirement

[`CONSISTENCY-MODEL.md`](../architecture/CONSISTENCY-MODEL.md) §1:

> **MongoDB must run as a REPLICA SET. This is a hard infrastructure requirement, not a preference.**

A standalone `mongod` **cannot** open a transactional session. The driver throws:

```
IllegalOperation: Transaction numbers are only allowed on
a replica set member or mongos
```

Order placement writes `orders` + N × `products` + N × `inventoryEvents` atomically. Without a transaction there is no atomicity, and the single most important behaviour preserved from legacy — *insufficient stock aborts the entire order* — silently degrades into partial orders and a corrupted ledger.

### 10.2 Minimum topology per environment

| Environment | Minimum topology | Note |
|---|---|---|
| **Local** | Single-node replica set: `mongod --replSet rs0` + `rs.initiate()` | A single-node **replica set** is sufficient — a single-node **standalone** is not. The distinction is the entire gate. |
| **CI** | `mongodb-memory-server` in **replica-set mode** | Default mode is standalone. Replica-set mode must be configured explicitly. |
| **Staging** | Real replica set — **mirrors production** | Non-negotiable; a staging standalone hides exactly the failure it exists to catch |
| **Production** | Atlas **M10 or higher**, or self-hosted 3-node | **M0/M2/M5 shared tiers do not support transactions reliably** |

### 10.3 The verification test — the gate itself

```
                    START TRANSACTION
                           │
                           ▼
              Write A  (e.g. decrement product stock)
                           │
                           ▼
              Write B  (e.g. insert inventory event)
                           │
                           ▼
                    FORCE FAILURE
                           │
                           ▼
                       ROLLBACK
                           │
                           ▼
              ┌────────────┴────────────┐
              ▼                         ▼
       Verify A ABSENT           Verify B ABSENT
              └────────────┬────────────┘
                           ▼
              GATE PASSES ⟺ BOTH absent
```

**Rules governing this test:**

| # | Rule |
|---|---|
| 1 | It runs in **local, CI and staging**. Passing in one environment proves nothing about the others — this is a *topology* test, not a code test. |
| 2 | It is written **before any domain module exists** (freeze gate #4). It uses two throwaway collections, not `orders`/`products`. |
| 3 | It must **fail loudly on a standalone**. A test that skips when transactions are unavailable is worse than no test — it manufactures false confidence. |
| 4 | It is a **permanent CI job**, not a one-off check. It catches the day someone points staging at a cheaper standalone. |
| 5 | **No domain module may be written until it passes** in all three environments. This is sub-phase **2.5**, and it blocks 2.6 onward. |

### 10.4 The runtime consequence at request time

The Terminus **readiness** probe must assert **replica-set availability**, not merely "connected" ([`OBSERVABILITY.md`](../architecture/OBSERVABILITY.md) §85). A standalone answers pings happily; every endpoint looks green; only order placement fails. That is the exact failure mode this assertion exists to prevent.

---

## 11. Deployment Boundaries

### 11.1 Three independently deployable units

```
   apps/storefront ──► Next.js host        │ own pipeline, own rollback
   apps/admin      ──► Next.js host        │ own pipeline, own rollback
   apps/api        ──► container runtime   │ own pipeline, own rollback
   MongoDB         ──► managed service     │ own lifecycle, own backups
```

| Boundary | Guarantee |
|---|---|
| **Web ⇄ API** | Deployable in either order. Contract additive-only within `v1`, so a newer API never breaks an older web build. |
| **Storefront ⇄ Admin** | Already independent — two Next.js apps, two builds. `basePath: '/admin'` is preserved as-is. |
| **API ⇄ MongoDB** | The database is provisioned, backed up and scaled outside the application pipeline. |
| **Repository ⇄ deployment** | **A shared repository does not imply a shared deploy.** `turbo build --filter=<app>` builds one app; `turbo.json` already declares the outputs (`.next/**`, `dist/**`) that make this correct and cacheable. |

### 11.2 No vendor is selected here

The repository selects no host: **no `vercel.json`, no `Dockerfile`, no `docker-compose`, no CI config.** The only vendor facts in evidence are the GitHub remote (⇒ GitHub Actions as the natural CI) and, in the frozen architecture, Cloudinary, Resend and MongoDB Atlas.

> Hosting for the containerised API remains **unselected and non-blocking**: a standard Dockerfile keeps every container host viable. Selecting it is a §15 non-blocking decision, needed before staging exists — not before Phase 2.1.

### 11.3 What Phase 2 delivers toward deployment

Only: `apps/api/Dockerfile` (multi-stage, non-root, healthcheck) and the CI pipeline. **No environment is provisioned, no vendor account created, no deploy performed.**

---

## 12. Shared Code Policy

> The default is **not shared**. A package earns existence by having **two real consumers today** — never by anticipation.

### 12.1 Allowed future shared artifacts

| Artifact | Status | Justification | Earliest |
|---|---|---|---|
| **`openapi.json`** | ✅ The integration boundary | Generated, not written; consumed by TS *and* Dart clients | Phase 2 (mechanism), Phase 8 (freeze) |
| **`packages/api-client`** | ✅ Justified | Generated from `openapi.json`; **two consumers** — `storefront` and `admin`. Never hand-edited. | Phase 8 |
| **`@nest/ui`** | ✅ Already justified | 24 components, both front-ends, **55 imports**, zero backend coupling | exists |
| **`@nest/config/constants`** | ✅ Already justified | 33 imports across both apps. Values (governorates, routes) are re-declared in the API from Phase 1 documents — **not imported across the boundary** | exists |

### 12.2 Forbidden shared artifacts

| Must never be shared | Why |
|---|---|
| **NestJS domain code** (services, guards, business rules) | The business logic is the API. Sharing it recreates the legacy failure where order logic lived in three places. |
| **Mongoose models / schemas** | Persistence is module-local by frozen decision. A shared model lets a front-end bypass the API. |
| **Database schemas or connection code** | Only `apps/api` touches MongoDB. |
| **Business services** | Same as domain code. |
| **Flutter code** | Different language, different repository, no workspace membership. |
| **Web UI code** | React components have no meaning in a headless API. |
| **A `DatabasePort` abstraction** | Explicitly forbidden — freeze gate #10. |
| **Environment variables across boundaries** | §9. |

### 12.3 F-1 — a documented finding: `@nest/types` is not the reusable asset the frozen documents describe

[`NESTJS-MODULE-MAP.md`](../architecture/NESTJS-MODULE-MAP.md) §8 states:

> *"`@nest/types` is the most valuable existing asset — its Zod schemas seed the DTOs directly."*

**Inspection of the package does not support "directly."** Evidence from `packages/types/src/` (1,979 lines):

| # | Observation | Conflicts with |
|---|---|---|
| 1 | `database.ts` is **1,426 of the 1,979 lines** — machine-generated Supabase/PostgREST types. Meaningless against MongoDB. | — |
| 2 | Every field is **`snake_case`** (`base_price`, `shipping_fee`, `full_name`, `is_active`) | The API contract's camelCase JSON |
| 3 | Money is **`z.number().positive()`** — a floating-point decimal | [`MONEY-MODEL.md`](../architecture/MONEY-MODEL.md): **integer minor units (piastres)**. This is the single most dangerous line to copy. |
| 4 | `OrderStatus` = `pending_payment · paid · processing · shipped · delivered · cancelled · failed` | [`ORDER-LIFECYCLE.md`](../architecture/ORDER-LIFECYCLE.md) §5: `PLACED · CONFIRMED · SHIPPED · DELIVERED · DELIVERY_FAILED · RETURNED · CANCELLED`. **Four legacy states do not exist in the frozen model; three frozen states do not exist here.** |
| 5 | Enum **values are lowercase** | [`CODE-STANDARDS.md`](../architecture/CODE-STANDARDS.md): `SCREAMING_SNAKE_CASE`, so the same token appears in code, OpenAPI and Dart |
| 6 | `InventoryTransactionType` includes `reservation` and `reservation_release` | The reservation subsystem Phase 0.5 proved **dead** and Phase 1 **removed** |
| 7 | Ids are `z.string().uuid()` | ObjectId hex strings |
| 8 | `CompatibilityType`, variant types present | Features **removed** in Phase 1 |

**Assessment.** `@nest/types` is a faithful model of the **legacy Postgres schema**. Importing it into `apps/api` would reintroduce, in one line, the decimal money and the legacy order states that Phase 1 spent its entire effort replacing. The risk is not theoretical: a frozen document currently *invites* it.

**What is genuinely reusable** is the *business intent* encoded in a handful of validators — the Egyptian phone regex, the slug pattern, field length limits, the `payment_method: 'cod'` literal. These should be **transcribed** into new API DTOs, with each value re-checked against Phase 1, not imported.

**Policy applied by this plan** (structure-neutral, so it does not reopen the freeze):

> **`apps/api` may not import any `@nest/*` package.** Its allowed dependency surface is `@nestjs/*`, `mongoose`, `class-validator`/`class-transformer`, `zod` (config only) and vendor SDKs under `providers/`. `@nest/types` remains in place, unchanged, serving the two web apps until Phase 9.

This is enforced as a lint rule in sub-phase 2.1 and is a completion gate there. Tracked as risk **R-5**.

> **Recorded, not resolved.** F-1 does not change any frozen *decision*; it contradicts one *characterisation* inside `NESTJS-MODULE-MAP.md` §8. Whether that sentence is amended is an architecture-record decision, listed as non-blocking **N-1** in §15. The import ban stands on its own regardless.

### 12.4 When a new shared package becomes justified

All three must hold:

1. **Two real consumers exist today** — not one, not "soon".
2. **The code is genuinely boundary-neutral** — no business rule, no persistence, no vendor SDK.
3. **Duplication has been tried and hurts** — a copied 20-line helper is cheaper than a package.

`packages/api-client` passes all three at Phase 8. **Nothing else currently does.** Phase 2 creates **no** new shared package.

---

## 13. Phase 2 Implementation Roadmap

Nine sub-phases. **Sequential** — each depends on the one before. **2.5 is a hard gate**: 2.6 onward may not begin until it passes in local, CI and staging.

> Every sub-phase inherits these standing prohibitions: **no domain module, no business endpoint, no Redis, no message queue, no speculative port, no `BaseRepository`, no `DatabasePort`, no provider registry/factory/failover, no legacy data migration, no Supabase call replaced, no application moved or deleted.**

---

### 2.1 — Workspace Hygiene & CI Foundation

| | |
|---|---|
| **Purpose** | Make the workspace green and enforceable **before** a third app joins it. The project has no CI; §2.5 lists seven pre-existing tooling defects. Adding `apps/api` on top of a workspace that cannot type-check itself means the API's first red build is indistinguishable from inherited breakage. |
| **Dependencies** | Working tree committed or stashed (§2.3). B-1 resolved (§15). |
| **Allowed** | Fix **D-1** (`packages/ui` tsconfig extends a non-existent path) · fix **D-2** (apps extend `tsconfig.base.json`) · add **D-3** (`type-check` to storefront) · resolve **D-4** (package build/type-check strategy) · pin **D-5** (wildcard Supabase dep) · relocate **D-6** (root runtime dep) · raise `engines.node` to the version actually used · add `.github/workflows/ci.yml` · add root `prettier` config + script · add `.env.example` for both web apps · configure `eslint-plugin-boundaries` / `no-restricted-imports` / `import/no-cycle` including the **`apps/api` may not import `@nest/*`** rule (§12.3) |
| **Forbidden** | Creating `apps/api` · installing NestJS · touching `apps/*/src/**` beyond what a type-check fix strictly requires · upgrading Next.js, React or Tailwind · changing runtime behaviour · deleting `packages/providers`/`services`/`repositories` |
| **Completion gate** | `pnpm lint`, `pnpm type-check` and `pnpm build` pass across **all** workspaces on a clean checkout in CI. Both web apps still build and run. The boundary lint rules are **errors, not warnings**. A deliberate probe commit importing `@nest/types` from a stub under `apps/api/` fails CI. |

---

### 2.2 — NestJS Application Bootstrap

| | |
|---|---|
| **Purpose** | Create `apps/api` as a workspace member that starts, responds, and is covered by the pipeline from 2.1. Skeleton only. |
| **Dependencies** | 2.1 green. |
| **Allowed** | `apps/api/` with `package.json`, `tsconfig.json` (extending `tsconfig.base.json`), `nest-cli.json`, `src/main.ts`, `src/app.module.ts` · NestJS dependencies scoped to `apps/api` · the frozen root directory contract from [`CODEBASE-STRUCTURE.md`](../architecture/CODEBASE-STRUCTURE.md) §2 as **empty** directories · `dev`/`build`/`lint`/`type-check`/`test` scripts wired into Turborepo · `/api/v1` global prefix |
| **Forbidden** | Any module under `src/modules/` · any controller with a business route · MongoDB connection · any vendor SDK · any `@nest/*` import · Docker · env files |
| **Completion gate** | `turbo dev --filter=api` starts and serves `/api/v1`. `turbo build --filter=api` produces `dist/`. CI covers three workspaces. **`pnpm-workspace.yaml` is unchanged** — confirming the Option B zero-churn claim. |

---

### 2.3 — Configuration Foundation

| | |
|---|---|
| **Purpose** | Make the process refuse to start when misconfigured — the defect D-7 records as the legacy failure (validation written, never imported). |
| **Dependencies** | 2.2. |
| **Allowed** | `src/config/env.schema.ts` — **the only file in the codebase that reads `process.env`** · Zod schema reporting **every** error at once, then `exit(1)` · typed `registerAs` namespaces (`app`, `database`, `auth`, `observability`, `throttle`) · `ConfigModule.forRoot({ validate, isGlobal: true })` · `apps/api/.env.example` (**names and descriptions only, never values**) · a lint rule making `process.env` outside the schema an error |
| **Forbidden** | Committing any real `.env` · any secret value in any tracked file · vendor credentials in `config/` (they belong beside their adapter, §9.2) · reading config by lookup instead of injection · business rules in config |
| **Completion gate** | Removing one required variable prevents boot with a complete, readable error listing **all** problems. A test asserts the fail-fast path. Grep proves exactly one `process.env` read site. |

---

### 2.4 — MongoDB Runtime & Connection

| | |
|---|---|
| **Purpose** | Provide a **replica set** in local and CI, and connect to it. Runtime and connectivity only — no schema, no collection, no query. |
| **Dependencies** | 2.3. |
| **Allowed** | `docker-compose.dev.yml` — single-node replica set (`--replSet rs0` + `rs.initiate()`) · `src/database/database.module.ts` with connection lifecycle and graceful shutdown · pool configuration from `database.config.ts` · `mongodb-memory-server` in **replica-set mode** for tests · the idempotent index-sync entry point (empty) |
| **Forbidden** | **Any Mongoose schema or collection model** (module-local, Phase 3) · any query · any seed data · a `DatabasePort` or repository abstraction (freeze gate #10) · a standalone `mongod` in any environment |
| **Completion gate** | API connects locally against the replica set and in CI against `mongodb-memory-server` in replica-set mode. `rs.status()` confirms an initiated set. A deliberate standalone connection is **rejected with a clear error**, not silently accepted. |

---

### 2.5 — 🔴 TRANSACTION ROLLBACK GATE (blocking)

| | |
|---|---|
| **Purpose** | **Prove** multi-document atomicity in every environment **before any domain code depends on it.** Freeze gate #4. Discovering at Phase 6 that transactions do not work in CI would invalidate the commerce core. |
| **Dependencies** | 2.4. |
| **Allowed** | `src/database/transaction.service.ts` — session lifecycle, commit/abort, retry on transient errors · the §10.3 rollback test against **two throwaway collections** · the same test wired into CI · a Terminus **readiness** check asserting **replica-set availability**, not mere connectivity |
| **Forbidden** | Using `orders`, `products` or `inventoryEvents` — those do not exist yet · **any skip/guard that lets the test pass when transactions are unavailable** · proceeding to 2.6 on a local-only pass |
| **Completion gate** | 🔴 **HARD GATE.** Write A + Write B + forced failure ⇒ rollback ⇒ **both absent**, passing in **local, CI and staging**. On a standalone the test **fails loudly**. Readiness returns unhealthy against a standalone. **No domain module may be written until this passes in all three.** |

---

### 2.6 — Application Core (cross-cutting)

| | |
|---|---|
| **Purpose** | Make the contract's guarantees structural, so the first business endpoint in Phase 4 is correct by construction rather than by discipline. |
| **Dependencies** | **2.5 passed.** |
| **Allowed** | Global `ValidationPipe` with **`whitelist: true, forbidNonWhitelisted: true, transform: true`** (the control that rejects `role`/`stock`/`price`/`userId` injection) · global exception filter emitting `{ error: { code, message } }` with **no driver text** · response-envelope interceptor `{ data, meta? }` · `pino` structured logging with a request-id correlation interceptor · `@nestjs/throttler` in-memory (single-instance assumption, OPEN-006) · security headers + CORS from config · shared primitives used by **three or more** future modules |
| **Forbidden** | Anything domain-specific in `common/` · a `utils/misc.ts` dumping ground · **Redis** unless OPEN-006 has resolved to multi-instance · CQRS buses · a global guard that presumes an auth system not yet built |
| **Completion gate** | An unknown property on any DTO yields `400` with a stable `error.code`. A thrown driver error surfaces as a generic `500` with **zero** driver text in the body, and full detail in the structured log. Every log line carries a request id. Success and failure shapes are asserted by test. |

---

### 2.7 — Contract Surface & Health

| | |
|---|---|
| **Purpose** | Publish the contract mechanism and the operational surface. |
| **Dependencies** | 2.6. |
| **Allowed** | `@nestjs/swagger` generating `openapi.json` **from DTO decorators** · Swagger UI at `/api/v1/docs`, gated by `SWAGGER_ENABLED` · Terminus `/health/live` and `/health/ready`, readiness asserting the **replica set** · `HealthModule` as a Tier-1 flat module |
| **Forbidden** | Hand-editing `openapi.json` · documenting an endpoint that does not exist · any business endpoint · publishing a client package (Phase 8) · exposing Swagger unauthenticated in production config |
| **Completion gate** | `openapi.json` generates in CI and is valid OpenAPI 3. Liveness and readiness behave correctly, and readiness **fails** against a standalone. Swagger is off by default in production config. |

---

### 2.8 — Provider Infrastructure Skeleton

| | |
|---|---|
| **Purpose** | Establish the ports/adapters boundary with **exactly one** adapter per port, so vendor selection (OPEN-004) never becomes a blocker. |
| **Dependencies** | 2.7. |
| **Allowed** | Port interfaces owned by their consuming module: **`EmailSenderPort`**, **`TemplateRendererPort`** (notifications), **`MediaStoragePort`** (media) · `ConsoleEmailSender` under `providers/email/console/` · `src/templates/email/` layout + partials, **provider-independent** · vendor config beside its adapter · a port-conformance test suite |
| **Forbidden** | **A provider registry, factory, or failover system** (freeze gate #10) · more than one active provider per capability · a `PaymentPort`, `SmsPort` or any speculative port (freeze gate #10) · templates under `providers/` or in a vendor dashboard (freeze gate #8) · vendor credentials in CI (freeze gate #12) · the three repository ports (`OrderRepositoryPort`, `InventoryRepositoryPort`, `CouponRepositoryPort`) — those belong to their domain modules in Phase 3+ |
| **Completion gate** | `ConsoleEmailSender` renders a template and satisfies the conformance suite. Grep proves **no vendor SDK import outside `src/providers/`** (freeze gate #5). The default CI suite passes with vendor credentials **absent**. |

---

### 2.9 — Foundation Verification & Deployment Packaging

| | |
|---|---|
| **Purpose** | Prove the foundation is complete, containerised, and that the frozen prohibitions actually hold — before Phase 3 writes the first schema. |
| **Dependencies** | 2.8. |
| **Allowed** | `apps/api/Dockerfile` — multi-stage, non-root user, healthcheck · CI stage building the image · an architecture-verification suite asserting freeze gates #5–#10 mechanically · a Phase 2 completion report in `docs/phase-2/` |
| **Forbidden** | Deploying anywhere · provisioning any cloud resource · creating a staging or production database · selecting a hosting vendor by writing platform-specific config · **any domain module** |
| **Completion gate** | Full pipeline green: `lint → type-check (all workspaces) → unit → infrastructure (replica set) → build → image`. Freeze gates #4, #5, #6, #11, #12 all **mechanically verified**, not merely reviewed. Both web apps still build and run untouched. |

---

### 13.1 Sequence summary

```
2.1 Workspace Hygiene & CI ─────────► must be green before a 3rd app joins
      │
2.2 NestJS Bootstrap ───────────────► apps/api exists, workspace unchanged
      │
2.3 Configuration ──────────────────► one process.env read; fail-fast boot
      │
2.4 MongoDB Runtime ────────────────► replica set local + CI
      │
2.5 🔴 TRANSACTION GATE ────────────► BLOCKS EVERYTHING BELOW
      │                                local + CI + staging
2.6 Application Core ───────────────► pipes, filters, envelope, logging
      │
2.7 Contract Surface & Health ──────► OpenAPI, Swagger, replica-set readiness
      │
2.8 Provider Skeleton ──────────────► 3 ports, 1 adapter each
      │
2.9 Verification & Packaging ───────► Dockerfile, gates mechanically proven
      │
      ▼
Phase 3 — MongoDB schemas, indexes, seed  (NOT Phase 2)
```

---

## 14. Risks

| # | Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| **R-1** | **The transaction gate is skipped or weakened** — a standalone works for every non-order operation, so the omission is invisible until the commerce core | §10 | Medium | 🔴 **Critical** — silent partial orders, corrupted ledger, the one behaviour Phase 1 most wanted to preserve | Sub-phase 2.5 is a hard gate. The test must **fail** on a standalone, never skip. Readiness asserts the replica set, so a misconfigured environment is visible at runtime too. |
| **R-2** | **`apps/api` is created on top of 111 uncommitted changes**, making bisect and revert unusable | §2.3 | **High** — the tree is dirty right now | 🟡 Medium | 2.1 requires a clean tree as an entry condition. |
| **R-3** | **`providers` name collision** — `packages/providers` (Supabase data access) vs `apps/api/src/providers/` (vendor adapters only, database explicitly excluded). Same word, opposing definitions. | §3.5 | High | 🟡 Medium — a developer "follows the existing pattern" and puts a repository under `apps/api/src/providers/` | The §2.2 Refinement-2 rule is testable: *a directory belongs under `providers/` iff it imports a third-party vendor SDK for a swappable capability*. Gate 2.8 greps for vendor SDKs outside `providers/`. Legacy packages carry a deprecation note from 2.1. |
| **R-4** | **`@nest/*` vs `@nestjs/*` scope confusion** — one character apart, both imported in the same files inside `apps/api` | §3.5 | Medium | 🟢 Low, but noisy | The 2.1 lint rule banning `@nest/*` inside `apps/api` makes every confusion a build error rather than a runtime surprise. |
| **R-5** | **Legacy shapes leak into the API through the shared workspace** — importing `@nest/types` reintroduces decimal money and the legacy order states in one line, and a frozen document currently *encourages* it | §12.3 (F-1) | **High** without enforcement | 🔴 **High** — silently undoes `MONEY-MODEL.md` and `ORDER-LIFECYCLE.md` | Import ban enforced by lint in 2.1, verified by a deliberate probe commit that must fail CI. **This is the price of Option B, and it is payable.** |
| **R-6** | **The web app duplicates business logic during the coexistence window** (Phases 4–9) | §7.2 | Medium | 🔴 High if it touches money, stock, or order state | Duplication permitted for **reads only**, only during a cutover, and **never** for money/stock/order state. `packages/api-client` generated from OpenAPI removes the incentive to hand-write types. |
| **R-7** | **Environment bleed** — an API secret placed in a web `.env`, or an API variable given a `NEXT_PUBLIC_` prefix and compiled into the browser bundle | §9 | Medium | 🔴 **High** — direct credential exposure | Three disjoint sets (§9.1). Separate `.env.example` per app. `NEXT_PUBLIC_*` is forbidden in the API schema. Vendor credentials live only beside their adapter. |
| **R-8** | **The committed Anthropic key in `apps/admin/src/test.md`** remains live while CI and repository secrets are configured | §2.7 | **Certain** (already true) | 🔴 High | **Rotate before 2.1** — blocking decision B-1. Deleting the file is insufficient; the key is in the history of a repository with a GitHub remote. |
| **R-9** | **Pre-existing tooling defects (D-1…D-7) make the first CI run red for reasons unrelated to the API** | §2.5 | High | 🟡 Medium — erodes trust in a brand-new pipeline | 2.1 fixes them **before** `apps/api` exists, so the API's first build failure is unambiguously the API's. |
| **R-10** | **Premature monorepo complexity** — a `packages/shared` appears "since we already have a workspace" | §12 | Low–Medium | 🟡 Medium | §12.4's three-part test. Phase 2 creates **zero** new shared packages; `packages/api-client` is not due until Phase 8. |
| **R-11** | **Deployment coupling assumed from repository co-location** — one pipeline deploying all three apps together, destroying independent rollback | §11 | Medium | 🟡 Medium | `turbo build --filter=<app>`; `turbo.json` already declares per-app outputs. Independence is asserted in 2.9. |
| **R-12** | **Single-instance assumption silently violated** — a second API instance is added without Redis, multiplying every in-memory rate limit by N | OPEN-006 | Medium at scale-up | 🔴 High — a **correctness failure in a security control** | Already the project's only production blocker. §15 N-3. Throttler config carries an explicit comment naming the assumption. |
| **R-13** | **`packages/providers`/`services`/`repositories` are deleted early**, breaking the live web apps before their endpoints exist | §5 | Low | 🔴 High | They are marked `[X] after Phase 9`, and deletion is forbidden in **every** Phase 2 sub-phase. |
| **R-14** | **Total loss of the frozen architecture.** All 59 `docs/` files are untracked and unpushed — the Phase 0 audit, the Phase 0.5 forensic extraction (which required live database access that can no longer be repeated the same way; the Supabase PAT is already revoked), 39 architecture documents, and the ratification record exist in **one uncommitted copy on one machine** | §2.3 | Medium — one `git clean -fdx`, one disk failure, one clone to a new machine | 🔴 **Critical** — unrecoverable. Phase 0.5 in particular cannot simply be re-run: it extracted a live legacy system that the clean rebuild will retire | **B-2 — commit and push `docs/` before anything else in Phase 2.1.** This is the cheapest mitigation of the highest-impact risk in the register. |

---

## 15. Decisions Required Before Implementation

> Only genuine blockers are listed. Every item with a recorded safe default is classified non-blocking, per the frozen open-items register.

### 15.1 Blocking

| # | Decision | Blocks | Why it genuinely blocks |
|---|---|---|---|
| **B-1** | **Rotate the credential exposed in `apps/admin/src/test.md`.** | Sub-phase **2.1** | The file is tracked and the key is in the history of a repository with a GitHub remote. 2.1 configures CI and repository secrets, which increases exposure. Deleting the file does not remediate history; **rotation is the only remediation.** This is an action, not a preference — there is no safe default. |
| **B-2** | **Commit and push the repository state — both the 111 uncommitted non-docs changes and the entirely untracked `docs/` tree (59 files, 0 tracked).** | Sub-phase **2.1** | Two distinct problems, one action. (a) Introducing a third application on top of a dirty tree makes `git bisect` and revert unusable for the entire foundation. (b) **The complete frozen architecture is untracked and unpushed — it exists in one copy, on one machine, with no history.** Every subsequent phase consumes it. No default can be assumed for (a): only the author knows whether that work is wanted. For (b) there is no defensible default at all. |
| **B-3** | **Provide a staging environment with a real MongoDB replica set** — or explicitly defer sub-phase 2.5's staging leg with a recorded date. | Sub-phase **2.5** (staging leg only; local + CI proceed regardless) | Freeze gate #4 requires the rollback test to pass in local, CI **and** staging. Staging does not exist. This is listed as blocking because the alternative is silently dropping a third of a hard gate — but it blocks only 2.5's staging leg, so 2.1 → 2.4 proceed unaffected. |

### 15.2 Non-blocking (recorded defaults are safe)

| # | Decision | Default in force | Needed by |
|---|---|---|---|
| **N-1** | Amend `NESTJS-MODULE-MAP.md` §8's claim that `@nest/types` seeds the DTOs directly (finding **F-1**, §12.3) | The §12.3 import ban applies regardless of whether the sentence is amended | Before Phase 4 writes its first DTO |
| **N-2** | Confirm **GitHub Actions** as the CI provider | The only remote is GitHub; nothing else is in evidence | Sub-phase 2.1 |
| **N-3** | **OPEN-006** — will production run more than one API instance? | Single instance; in-memory throttling; **Redis deferred** | Before go-live. If >1, **Redis is required before launch** (R-12). |
| **N-4** | **OPEN-004** — transactional email provider | `ConsoleEmailSender` in development; the port is provider-agnostic | Before Phase 4 sends a verification email |
| **N-5** | Hosting target for the containerised API | A standard Dockerfile keeps every container host viable | Before staging exists |
| **N-6** | Cloudinary account provisioning | `MediaStoragePort` has no adapter until Phase 5 | Before Phase 5 |
| **N-7** | MongoDB production topology (Atlas M10+ vs self-hosted 3-node) | Either satisfies the frozen requirement; local and CI are unaffected | Before staging exists |
| **N-8** | Whether `packages/config/src/env.ts` (dead, D-7) is deleted or left | Harmless if left; **must not be imported by `apps/api`** (§12.3) | Any time |
| **N-9** | Node `engines` floor — declared `>=20`, actually running `v24.11.0` | Both work; CI should pin one version explicitly | Sub-phase 2.1 |
| **N-10** | Whether `apps/admin` keeps `basePath: '/admin'` | **Keep as-is.** Phase 2 changes no deployment topology. | Before web deployment changes |

**Invented blockers: none.** Every item with a documented safe fallback is classified non-blocking, matching the frozen register's treatment of OPEN-001…OPEN-008.

---

## 16. Phase 2.0 Verification Record

| Check | Result |
|---|---|
| Implementation code changed | ❌ None |
| NestJS project created | ❌ No |
| Dependencies installed / removed / upgraded | ❌ None |
| `package.json` modified (any workspace) | ❌ None |
| Lock file modified | ❌ None |
| Environment file created | ❌ None |
| Docker file created | ❌ None |
| MongoDB infrastructure created | ❌ None |
| Next.js file changed | ❌ None |
| Supabase touched | ❌ None |
| Application moved / renamed / deleted / archived | ❌ None |
| Files created | ✅ Exactly 2, both under `docs/phase-2/` |
| Recommendation grounded in repository evidence | ✅ §2, §3 |
| Options evaluated | ✅ Three (§4) |
| Recommendations selected | ✅ Exactly one — **Option B** |
| Flutter remains repository-independent | ✅ §6.3 |
| Unnecessary shared package proposed | ❌ None — zero new packages in Phase 2 (§12.4) |
| Replica set is a hard gate before transaction-dependent domain work | ✅ §10, sub-phase 2.5 |
| Local / CI / staging transaction requirements documented | ✅ §10.2, §10.3 |
| Phase 2 sequence explicit | ✅ §13 — nine sub-phases |
| Uncertainties documented rather than guessed | ✅ §15 — 3 blocking, 10 non-blocking; F-1 recorded, not silently resolved |

**Baseline:** `git status --porcelain` recorded 112 entries (111 outside `docs/`) **before** this phase began. That pre-existing dirty tree is unrelated to Phase 2.0 and untouched by it.

---

## 17. Hard Stop

```
PHASE 2.0 — AUDIT AND PLANNING COMPLETE

Repository classification:  pnpm + Turborepo monorepo (real, functioning)
Recommendation:             Option B — add apps/api to the existing workspace
Structural change required: NONE — 'apps/*' already globs apps/api

Phase 2.1 may begin only after B-1, B-2 and B-3 are resolved.

NOT STARTED: repository restructuring, NestJS creation,
             dependency installation, Phase 2.1.
```
