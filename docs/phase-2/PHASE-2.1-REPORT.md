# PHASE 2.1 — WORKSPACE HYGIENE & CI FOUNDATION REPORT

**Date:** 2026-08-30 · **Outcome:** Complete · **Git:** no commit, no push
**Plan:** [`PHASE-2.1-WORKSPACE-HYGIENE-PLAN.md`](./PHASE-2.1-WORKSPACE-HYGIENE-PLAN.md)

---

## 1. Scope

**Allowed to change, and what was actually changed:**

| Allowed | Used? |
|---|---|
| `.github/workflows/` | ✅ created `ci.yml` |
| `.gitignore` — only if it blocked doc tracking | ❌ **not needed** — no ignore rule matched `docs/` |
| TypeScript configs — only where a defect was verified | ✅ one file: `packages/ui/tsconfig.json` |
| The leaked-credential file — only to remove the secret | ✅ deleted |
| `docs/` | ✅ 59 files staged + 2 created |

**Not changed:** application source, `package.json` (any workspace), `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, both app tsconfigs, Supabase behaviour, business logic, frontend features.

---

## 2. Baseline State

Captured before any modification.

| Property | Value |
|---|---|
| `HEAD` | `dc7768b` — *edit ui and fix admin login* |
| Branch | `main`, **in sync with `origin/main`** |
| Commits in history | 2 |
| Tracked files | 236 |
| Working tree | **59 modified · 21 deleted · 148 untracked** (228 entries) |
| `docs/` tracked | **0 of 59** |
| CI configuration | none |
| Toolchain | Node `v24.11.0` · pnpm `9.0.0` · TypeScript `5.9.3` · Turborepo `2.9.6` · ESLint `9.39.4` |

The dirty tree is pre-existing work-in-progress, unrelated to this phase.

---

## 3. Credential Remediation

| Field | Finding |
|---|---|
| **File** | `apps/admin/src/test.md` — 222 bytes, **tracked**, referenced by no import |
| **Content** | A shell snippet appending `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL="https://agentrouter.org"` to `~/.zshrc`, then invoking the Claude Code CLI |
| **Classification** | **Active or unknown — must be treated as real.** `sk-` prefix, 51 characters, high entropy, **not** Anthropic's `sk-ant-` format, no placeholder markers. The base URL is `agentrouter.org`, a third-party Claude-API-compatible proxy — so this is a **credential for that third-party service**, stored under the `ANTHROPIC_API_KEY` variable name only because that is what the CLI reads. **Not** an Anthropic-issued key. |
| **Repository action** | `git rm apps/admin/src/test.md` — removed from the working tree; deletion **staged, not committed** |
| **History exposure** | **Present in both commits** (`4673949`, `dc7768b`). `main` is in sync with `origin/main`, so the value **has been pushed to GitHub**. History **not** rewritten — explicitly forbidden. |
| **Rotation / revocation status** | ❌ **NOT performed, and not claimed.** Rotation requires an account on `agentrouter.org`. That access does not exist in this environment, the credential owner is not identifiable from the repository, and it is not an Anthropic key revocable through any available channel. |
| **Outstanding external action** | 🔴 **Revoke the key on `agentrouter.org`.** Because it exists in pushed history, **the credential must be considered compromised.** Deletion of the file does not remediate this; revocation is the only remediation. |

**Verification:** no `ANTHROPIC_API_KEY` value remains anywhere in the working tree. The only surviving mention is in `docs/audit/phase-0-audit.md`, which names the **variable** in a findings table and contains **no value**.

**Residual local-only copies:** six Turbopack cache files under `apps/admin/.next/dev/cache/` contain the string. `.next/` is gitignored (`apps/admin/.gitignore:17`), so this is local disk residue with no repository exposure; it clears on the next clean build.

**No secret value was printed, logged, or written to any file during this phase.**

---

## 4. Architecture Documentation Protection

| | |
|---|---|
| **Documents found** | **59** files under `docs/` |
| **Tracking state before** | **0 tracked** — Phase 0 audit (1), Phase 0.5 forensics (16), Phase 1 + 1.1 architecture incl. dossier and ratification (39), Phase 2.0 (2), plus 1 more |
| **Ignore rule?** | **None.** `git check-ignore` matched no file under `docs/`. The directory was never `git add`-ed — omission, not an ignore rule. |
| **`.gitignore` change** | ❌ **None made, none required.** |
| **Changes made** | `git add docs/` → all 59 staged |
| **Tracking state after** | **59 staged** (`A`), awaiting the user's commit |

**Pre-staging secret scan** — mandatory, since staging is the act that would publish a leak:

| Check | Result |
|---|---|
| High-entropy `sk-*` tokens in `docs/` | none |
| `ANTHROPIC_API_KEY` in `phase-0-audit.md` | variable name only, no value |
| JWT-shaped string in `API-CONTRACT.md` | `eyJhbGciO…` — **23 chars**, truncated illustrative example |
| `sbp_` / `AKIA` / `ghp_` / `re_` / `xoxb-` prefixes | none |

Breakdown of what is now protected: `architecture/` 39 · `db/` 11 · `phase-2/` 2 (+2 new) · `audit/` 1 · `auth/` 1 · `storage/` 1 · `migration/` 1 · root 3.

---

## 5. TypeScript Configuration

The workspace contains exactly **four** tsconfig files. No project references exist.

### Previous config graph

```
tsconfig.base.json  (repo root)
   ▲
   └── ✗ packages/ui/tsconfig.json
           extends "@nest/config/tsconfig.base.json"   → TS6053: File not found

apps/admin/tsconfig.json        no "extends"
apps/storefront/tsconfig.json   no "extends"
```

### Defects found

| # | Defect | Impact |
|---|---|---|
| **T-1** | `packages/ui/tsconfig.json` extends `@nest/config/tsconfig.base.json`; that file does not exist (`packages/config/` holds only `package.json` and `src/`, and its `exports` map exposes no tsconfig) | `TS6053`, **plus a cascade** — because `extends` failed, no base option applied: `moduleResolution: NodeNext` was lost (`TS2307`, `@nest/types` unresolvable) and `skipLibCheck` was lost (`TS2305`, `lucide-react`). **One broken string, three errors.** |
| **D-2** | Phase 2.0 claimed the apps should extend the root base | **Rejected — see below** |

### Minimal corrections

Exactly one file changed:

```jsonc
// packages/ui/tsconfig.json
"extends": "../../tsconfig.base.json",     // was "@nest/config/tsconfig.base.json"
"lib": ["ES2022", "DOM", "DOM.Iterable"]   // added
```

The `lib` override was required because the base declares `lib: ["ES2022"]` with no DOM, and `@nest/ui` is a React component library — repointing alone raised the count to 9 (`HTMLTableCellElement` ×6, `window` ×1, plus 2 pre-existing). This **declares the package's runtime environment; it does not loosen strictness** — confirmed by `exactOptionalPropertyTypes` still reporting errors afterwards.

### D-2 rejected — with evidence

A disposable probe config (created, measured, deleted; the apps' real tsconfigs were never touched) had `apps/storefront` extend the root base:

| Measurement | Value |
|---|---|
| Source files checked | **100** (all of `apps/storefront/src`) |
| Effective `lib` / module / resolution | `["es2022"]` / `nodenext` / `nodenext` |
| `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` | both `true` |
| Errors | **1** — the pre-existing generated `.next/dev/types/routes.d.ts` `TS1128` |

So D-2 is **feasible** — and still rejected:

1. Both app configs are stock `create-next-app` output using `moduleResolution: "bundler"`, Next.js's documented recommendation; the base uses `NodeNext`.
2. Changing module-resolution semantics for two production apps is a material behavioural change. **`tsc --noEmit` passing does not imply `next build` passing** — different resolvers.
3. Nothing in Phase 2.1's scope requires it. The base's real consumer is `packages/*`, and its only ever consumer is now correct.
4. The brief: *"Do not force identical configuration onto all packages if the existing architecture intentionally differs."*

**D-3 (add `type-check` to storefront) also rejected** — adding a script is introducing a new failing check, not repairing an existing one.

### Final config graph

```
tsconfig.base.json  (repo root)
   ▲
   └── ✓ packages/ui/tsconfig.json   extends "../../tsconfig.base.json"
             overrides: lib (+DOM), outDir, rootDir, jsx

apps/admin/tsconfig.json        standalone — intentional (Next.js scaffold)
apps/storefront/tsconfig.json   standalone — intentional (Next.js scaffold)
```

### Validation results

| Stage | `packages/ui` errors |
|---|---|
| Before | **3** — all rooted in the broken `extends` |
| After repointing only | 9 — base applied, DOM missing |
| **After repoint + `lib`** | **2** |

The 2 remaining are genuine source defects, revealed only because the intended strict config now actually applies:

| File | Error | Cause |
|---|---|---|
| `packages/ui/src/dropdown-menu.tsx:91` | `TS2375` | `exactOptionalPropertyTypes: true` |
| `packages/ui/src/toast.tsx:52` | `TS2345` | `exactOptionalPropertyTypes: true` |

**Recorded, not fixed** — application source, per the brief.

---

## 6. Workspace Health

| Area | Result |
|---|---|
| **pnpm workspace** | ✅ all **9** projects resolve (`root`, `admin`, `storefront`, 6 packages). `pnpm-workspace.yaml` globs `apps/*` + `packages/*` — already covers a future `apps/api`; **not modified**. |
| **Turborepo** | ✅ `turbo.json` orchestrates correctly; task filtering and caching work. **Not modified.** `type-check`/`test` declare `dependsOn: ["^build"]`, which resolves to nothing because no package has a `build` script — inert, harmless today, left alone. |
| **Workspace dependency issues** | 🔴 **two found** (below) |
| **Fixes made** | **None in this area** — all remedies require manifest or lock-file edits, outside the allowed set |

### 6.1 Deterministic install is broken — conditionally

`pnpm install --frozen-lockfile` (CI's exact install step) **fails**:

```
ERR_PNPM_OUTDATED_LOCKFILE
  pnpm-lock.yaml is not up to date with packages\services\package.json
```

Cause: the **pre-existing, uncommitted** addition of `"@supabase/supabase-js": "*"` to `packages/services/package.json`, with no lockfile update.

| Scenario | Install |
|---|---|
| CI against committed `HEAD` | ✅ passes — the lockfile importer lists exactly the three workspace deps `HEAD` declares |
| CI after the working tree is committed | 🔴 **fails — every job dies at install** |

The command failed fast and **did not mutate the lock file** (verified).

### 6.2 Undeclared dependencies in `apps/storefront` (W-2)

A declared-versus-imported audit across all eight workspaces found missing dependencies in exactly one:

| Package | Import site | Declared | Resolves |
|---|---|---|---|
| `zod` | `src/app/forgot-password/form.tsx:7` | ❌ (`apps/admin` declares `^3.23.8`) | ❌ |
| `pino` | `src/lib/logger.ts:5` | ❌ | ❌ |

pnpm's isolated `node_modules` permits no accidental hoisting, so **`zod` breaks `next build` today**; `pino` is a second latent failure behind it. Remedy: `pnpm --filter storefront add zod pino`.

### 6.3 `@nest/ui` lint task cannot run (W-1)

`packages/ui/package.json` declares `"lint": "eslint src/"`, but the package has no `eslint.config.*`. ESLint 9 removed `.eslintrc` support, so the task hard-fails with `ESLint couldn't find an eslint.config.(js|mjs|cjs) file.`

---

## 7. CI Foundation

**Provider: GitHub Actions** — evidence-based. The sole remote is `https://github.com/kerolles2003/Nest_Electro.git`; no other CI configuration exists anywhere in the repository. No assumption was required.

**Workflow created:** `.github/workflows/ci.yml` (83 lines), validated by parsing with `js-yaml`.

**Commands executed** — only scripts that already exist in `package.json`; none invented:

| Job | Steps |
|---|---|
| `lint` | checkout → `pnpm/action-setup@v4` → `setup-node@v4` (Node 20, pnpm cache) → `pnpm install --frozen-lockfile` → **`pnpm lint`** |
| `type-check` | same setup → **`pnpm type-check`** |
| `build` | same setup → **`pnpm build`** |

**What CI validates:** deterministic install from the lock file; lint, type-check and build across every workspace via Turborepo. Three independent gates — each separately red/green and re-runnable.

**What CI intentionally does not validate yet:**

| Omitted | Reason |
|---|---|
| **Tests** | No workspace defines a `test` script, so `turbo test` runs zero tasks and exits 0 — a vacuously green gate. The brief forbids placeholder tests. |
| **Deploy / CD** | Out of scope |
| **MongoDB / Docker services** | Out of scope; no runtime infrastructure exists |
| **Secrets** | No job needs one, and none is referenced |
| **`apps/api`** | Does not exist |

**Determinism choices:** `pnpm/action-setup@v4` is given **no version**, so it reads `"packageManager": "pnpm@9.0.0"` from `package.json` — one source of truth. Node is pinned to `20`, the only declared contract (`engines: { node: ">=20" }`).

> **Node discrepancy, deliberately unresolved:** `engines` declares `>=20`; the local machine runs `v24.11.0`. CI pins the declared floor. Reconciling these is a decision, not a Phase 2.1 fix.

**No `continue-on-error` anywhere.** CI will be red on its first run — that is the repository's true state, and §8 is the triage list.

---

## 8. Validation Results

| Check | Command | Result | Failure classification |
|---|---|---|---|
| Workspace resolution | `pnpm -r list --depth -1` | ✅ **PASS** — 9 projects | — |
| Deterministic install | `pnpm install --frozen-lockfile` | 🔴 **FAIL** — `ERR_PNPM_OUTDATED_LOCKFILE` | **Pre-existing** — uncommitted manifest drift (§6.1) |
| Lint | `pnpm lint` | 🔴 **FAIL** — `@nest/ui` crashes (no config); `admin` 128 err / 32 warn; `storefront` 45 err / 16 warn | **Pre-existing** |
| Type check | `pnpm type-check` | 🔴 **FAIL** — `admin` 4 × `TS2339` | **Pre-existing** |
| Type check, clean checkout | `tsc -p apps/admin` with `next-env.d.ts` removed | 🔴 **FAIL** — same 4 errors | **Pre-existing** (proves CI needs no build-before-typecheck ordering) |
| `packages/ui` type check | `tsc -p packages/ui` | 🔴 **FAIL** — **2** errors (was **3**) | **Pre-existing, revealed by the T-1 fix** |
| Storefront type check | `tsc -p apps/storefront` | 🔴 **FAIL** — 1 error in generated `.next/dev/types/routes.d.ts` | **Pre-existing**, generated artifact |
| Build | `pnpm build` | 🔴 **FAIL** — `admin` type error; `storefront` cannot resolve `zod` | **Pre-existing** |
| D-2 probe | `tsc -p` disposable probe config | ✅ 100 files checked, 1 pre-existing error | — (probe deleted) |
| Workflow syntax | `js-yaml` parse | ✅ **PASS** — 3 jobs, no tabs, no `continue-on-error`, no secrets | — |
| Credential absent from tree | `grep -r ANTHROPIC_API_KEY` | ✅ **PASS** | — |
| Docs staged | `git diff --cached` | ✅ **PASS** — 59 files | — |
| Lockfile unmutated | `git status -- pnpm-lock.yaml` | ✅ **PASS** — unchanged | — |

> **Zero failures were introduced by Phase 2.1.** Every failure above pre-dates this phase. The only movement is `packages/ui`: **3 → 2**, with the residual 2 reclassified from *config-broken* to *genuine source defects*.

---

## 9. Files Modified

| File | Change | Exact reason |
|---|---|---|
| `apps/admin/src/test.md` | **Deleted** | B-1 — removes the exposed credential from the working tree. File was unreferenced by any import. |
| `packages/ui/tsconfig.json` | `extends` repointed to `../../tsconfig.base.json`; `lib: ["ES2022","DOM","DOM.Iterable"]` added | T-1 — the only verified TypeScript defect. The `lib` override supplies the DOM types a React package requires once the base actually applies. |
| `.github/workflows/ci.yml` | **Created** | CI foundation — 3 jobs over existing root scripts |
| `docs/**` (59 files) | **Staged** (content unchanged) | R-14 — makes the approved architecture baseline git-trackable |
| `docs/phase-2/PHASE-2.1-WORKSPACE-HYGIENE-PLAN.md` | **Created** | Required documentation |
| `docs/phase-2/PHASE-2.1-REPORT.md` | **Created** | Required documentation |

**Nothing else.** No manifest, no lock file, no workspace config, no `turbo.json`, no `.gitignore`, no `tsconfig.base.json`, no app tsconfig, no application source.

---

## 10. Git State

| Class | Count | Contents |
|---|---|---|
| **Staged** (Phase 2.1's complete changeset) | **64** | **61** docs added (59 pre-existing + the 2 written this phase) · `.github/workflows/ci.yml` added · `packages/ui/tsconfig.json` modified · `apps/admin/src/test.md` deleted |
| **Modified, unstaged** | **59** | Pre-existing WIP — **identical to baseline (59)**, untouched |
| **Deleted, unstaged** | **21** | Pre-existing WIP — **identical to baseline (21)**, untouched |
| **Untracked** | **89** | Baseline 148 − 59 now-staged docs = **89**, all pre-existing (`DESIGN.md`, `PRODUCT.md`, new app routes, etc.). No Phase 2.1 file is left untracked. |
| **Already tracked, unmodified** | 235 | 236 baseline − 1 staged deletion |

Porcelain breakdown: `62 A` · `1 M ` · `1 D ` (staged) · `59  M` · `21  D` (unstaged) · `89 ??`.

**The unstaged counts match the baseline exactly**, which is the arithmetic proof that Phase 2.1 modified nothing pre-existing.

**The staged index is exactly Phase 2.1's work, and nothing else.** `git diff --cached` is a complete and reviewable changeset; `git diff` shows only the pre-existing dirty tree.

> ✅ **No commit was created.** `HEAD` is still `dc7768b`, unchanged from the start of the phase.
> ✅ **No push was performed.** `main` remains in sync with `origin/main`.
> ✅ No history rewrite, no force push, no `filter-repo`, no BFG.

---

## 11. Pre-existing Failures

| # | Failure | Classification | Why not fixed | Impact on next phase |
|---|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` fails — lock file out of sync with the uncommitted `packages/services/package.json` | Pre-existing | Manifest + lock file are outside the allowed set; regenerating would fold the user's uncommitted work into this changeset | 🔴 **CI cannot run at all once the working tree is committed.** Highest-priority item. |
| 2 | `apps/storefront` build fails — `zod` unresolved; `pino` latent behind it | Pre-existing | Requires a manifest + lock-file change (§6.1) | Build gate stays red. One command fixes it. |
| 3 | `apps/admin` — 4 × `TS2339` `Property 'role' does not exist on type 'never'` (`services.ts:29` ×2, `proxy.ts:78` ×2) | Pre-existing (`services.ts` unchanged from `HEAD`) | Application source — forbidden | Blocks both `type-check` and `build` gates |
| 4 | `@nest/ui` lint crashes — no `eslint.config.*` | Pre-existing | Adding a config would surface unreviewed frontend lint errors; removing the script edits a manifest | Lint gate stays red |
| 5 | `admin` 128 lint errors / 32 warnings; `storefront` 45 / 16 | Pre-existing | Application source — forbidden | Lint gate stays red until triaged |
| 6 | `packages/ui` — 2 × `exactOptionalPropertyTypes` errors | Pre-existing, **revealed** by the T-1 fix | Application source — the brief requires recording, not refactoring | No current gate runs it (`packages/ui` has no `type-check` script) |
| 7 | `apps/storefront` — 1 error in generated `.next/dev/types/routes.d.ts` | Pre-existing, generated artifact | Not source; regenerated by `next build` | None — storefront has no `type-check` script |
| 8 | Credential live in pushed git history | Pre-existing | History rewrite explicitly forbidden | 🔴 Requires external revocation (§3) |

---

## 12. New Risks

Introduced or first discovered by Phase 2.1:

| # | Risk | Severity | Note |
|---|---|---|---|
| **N-1** | **Committing the working tree makes CI fail at install**, before any gate runs — the lock file and `packages/services/package.json` disagree | 🔴 High | *Discovered*, not introduced. Fix by deciding the manifest's fate and running `pnpm install`. Sequence matters: resolve **before** the first CI run, or the first run tells you nothing. |
| **N-2** | **Staging without committing is a fragile state.** 62 staged files — including the credential deletion and the entire architecture baseline — live only in the index. `git reset`, `git checkout`, or a stash mishandling would silently discard them. | 🟡 Medium | Introduced by this phase, unavoidably: the brief requires staging and forbids committing. Mitigated by review-then-commit as the immediate next action. |
| **N-3** | **CI is red on first run**, so it cannot gate anything yet | 🟡 Medium | Deliberate and honest. Risk is normalisation — a permanently red pipeline gets ignored. Triage §11 items 1–5 to make it meaningful. |
| **N-4** | **`packages/ui` strictness is now genuinely enforced** by the corrected config, so its 2 errors will surface in any future check that includes it | 🟢 Low | A correctness improvement that arrives as new visible failures. Expected. |
| **N-5** | **Node version split** — CI pins 20, local runs 24.11.0 | 🟢 Low | Could mask environment-specific behaviour. Reconcile deliberately. |
| **N-6** | Credential remains in pushed history and **is not revoked** | 🔴 High | *Discovered*. The only remediation is external revocation on `agentrouter.org`. |

---

## 13. Phase 2.2 Readiness

> ## READY WITH KNOWN NON-BLOCKING FAILURES

Phase 2.1's own objectives are all met:

| Objective | Status |
|---|---|
| Credential removed from the working tree; exposure characterised; history checked | ✅ (revocation is external and outstanding) |
| Architecture documentation git-trackable | ✅ 59 files staged; no ignore rule involved |
| TypeScript `extends` chains valid | ✅ the one broken chain is repaired and verified |
| Workspace validated | ✅ 9 projects resolve; 3 defects identified and documented |
| Minimal CI foundation on real scripts | ✅ 3 jobs, no invented commands, no fake tests |

**"Non-blocking" means: none of these prevents creating `apps/api`.** Phase 2.2 bootstraps a new, isolated workspace; it does not depend on the existing apps linting, type-checking, or building.

**Two things the user should settle before Phase 2.2, neither of which blocks it:**

| # | Action | Why it matters |
|---|---|---|
| 1 | **Review and commit the staged changeset** (`git diff --cached`) | Resolves N-2 and finally protects the architecture baseline. Until this happens, the frozen architecture still exists in one uncommitted copy. |
| 2 | **Revoke the credential on `agentrouter.org`** | It is live in pushed history and cannot be removed without a history rewrite (out of scope). |

**Three items to resolve before CI can gate anything** — worth doing early, since Phase 2.2 will want a working pipeline:

1. Decide the fate of `"@supabase/supabase-js": "*"` in `packages/services/package.json`, then run `pnpm install` to realign the lock file *(otherwise CI dies at install)*.
2. `pnpm --filter storefront add zod pino` *(unblocks the storefront build)*.
3. Triage the `admin` `TS2339` errors and the 173 lint errors *(application source — a dedicated commit, outside this phase)*.

**No blockers to Phase 2.2 itself.**

---

## 14. Final Validation Checklist

| # | Check | Result |
|---|---|---|
| 1 | No NestJS application was created | ✅ |
| 2 | `apps/api` does not exist | ✅ verified absent |
| 3 | No MongoDB infrastructure was created | ✅ |
| 4 | No Docker infrastructure was created | ✅ |
| 5 | No domain architecture was changed | ✅ frozen docs staged byte-unchanged |
| 6 | No business logic was changed | ✅ |
| 7 | No frontend feature was changed | ✅ |
| 8 | No Supabase behaviour was changed | ✅ |
| 9 | Credential exposure handled without printing the secret | ✅ only length, prefix class and character-class shape were derived |
| 10 | Git history exposure was checked | ✅ present in both commits; pushed to `origin/main` |
| 11 | Architecture documents are git-trackable | ✅ 59 staged |
| 12 | No architecture documents accidentally ignored | ✅ `git check-ignore` matched none |
| 13 | TypeScript `extends` chains are valid | ✅ the only chain resolves; both app configs intentionally standalone |
| 14 | Workspace configuration validated | ✅ 9 projects; `pnpm-workspace.yaml` and `turbo.json` untouched |
| 15 | CI based on actual repository scripts | ✅ `pnpm lint` / `type-check` / `build` — all pre-existing |
| 16 | CI commands tested locally | ✅ all four run, results in §8 |
| 17 | No fake tests introduced | ✅ test job deliberately omitted |
| 18 | No deployment / CD introduced | ✅ |
| 19 | No commit created | ✅ `HEAD` still `dc7768b` |
| 20 | No push performed | ✅ `main` in sync with `origin/main` |
| 21 | Final git state explicitly reported | ✅ §10 |
