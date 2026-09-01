# PHASE 2.1 — WORKSPACE HYGIENE & CI FOUNDATION PLAN

**Status:** Executed · **Date:** 2026-08-30 · **Companion:** [`PHASE-2.1-REPORT.md`](./PHASE-2.1-REPORT.md)
**Preceded by:** [`PHASE-2.0-REPOSITORY-RUNTIME-PLAN.md`](./PHASE-2.0-REPOSITORY-RUNTIME-PLAN.md)

> This is the **verified execution plan**: every Phase 2.0 claim was re-checked against the live repository before any change was made. Two Phase 2.0 recommendations did not survive verification and were **rejected with evidence** (§4.3, §5.2). Two defects Phase 2.0 did not find were discovered (§5.3).

---

## 1. Scope boundary

| Phase 2.1 owns | Phase 2.1 does not own |
|---|---|
| Credential remediation (B-1) | NestJS, `apps/api` |
| Architecture-document tracking (R-14) | MongoDB, Docker, CD |
| TypeScript configuration validity (T-1) | Domain modules, business logic |
| Minimal CI foundation | Frontend features, Next.js routing, Supabase behaviour |
| Workspace/tooling defect **identification** | Fixing application source code |

**Standing rule applied throughout:** where a fix would require editing application source, a manifest, or the lock file, the defect was **documented with an exact reproduction and an exact remedy**, and left unapplied. The brief's instruction — *"If uncertain: Do not modify it. Document it instead."* — was treated as binding.

---

## 2. Verification-first method

Phase 2.0 was a planning artifact, not an authority. Every issue it raised was re-tested:

| Phase 2.0 claim | Verified? | Outcome |
|---|---|---|
| B-1 — credential in `apps/admin/src/test.md` | ✅ | **Confirmed**, and reclassified: it is **not** an Anthropic key (§3) |
| R-14 — `docs/` untracked | ✅ | **Confirmed** — 0 of 59 tracked; **not** caused by `.gitignore` (§4) |
| D-1/T-1 — `packages/ui` extends a non-existent path | ✅ | **Confirmed**, plus a 2-error cascade Phase 2.0 did not identify (§5.1) |
| D-2 — apps should extend `tsconfig.base.json` | ✅ | **REJECTED** — verified feasible but unjustified (§5.2) |
| D-3 — storefront lacks `type-check` | ✅ | Confirmed; **not** added (§5.2) |
| D-4 — packages have no `build`; `dependsOn: ^build` is inert | ✅ | Confirmed; harmless today, **not** changed |
| D-5 — wildcard `@supabase/supabase-js` in `packages/services` | ✅ | Confirmed — and found to be **uncommitted**, which breaks CI install (§6.1) |
| D-6 — root runtime dependency | ✅ | Confirmed; out of allowed scope, documented |
| D-7 — `@nest/config/env` dead | ✅ | Confirmed — 0 importers |

---

## 3. B-1 — credential: plan and outcome

**Verified facts** (no secret value printed, logged, or written anywhere):

- `apps/admin/src/test.md`, 222 bytes, **tracked by git**, unreferenced by any import.
- Content is a shell snippet appending two exports to `~/.zshrc`, then invoking the Claude Code CLI.
- The second export is `ANTHROPIC_BASE_URL="https://agentrouter.org"` — **not** `api.anthropic.com`.
- The key's shape: `sk-` prefix, 51 characters, high entropy, **no** `sk-ant-` prefix, no placeholder markers (`xxx`/`your`/`example`/`test`/`fake`/`changeme`/`<…>`).

**Classification: an active-or-unknown credential for the third-party service `agentrouter.org`** — a Claude-API-compatible proxy. It is stored under the variable name `ANTHROPIC_API_KEY` only because that is the variable the CLI reads; the credential is **not Anthropic-issued**. It is not a placeholder, so it must be treated as real.

**Rotation: NOT performed, and not claimable.** Rotation requires an account on `agentrouter.org`; no such access exists in this environment, the credential owner is not identifiable from the repository, and it is not an Anthropic key that could be revoked through any available channel. Per the brief, the action taken was therefore *remove the exposed value + record that revocation remains externally required*.

**Action:** `git rm apps/admin/src/test.md` — removed from the working tree, deletion **staged, not committed**.

**History: NOT rewritten** (explicitly forbidden). The value is present in **both** commits, and `main` is in sync with `origin/main`, so it has been pushed to GitHub.

> **The credential must be considered compromised. Revocation on `agentrouter.org` is the required security response and remains outstanding.**

---

## 4. R-14 — architecture documents: plan and outcome

**Verified:** 59 files on disk under `docs/`, **0 tracked**. `git check-ignore` matched **no** file under `docs/` — the directory is not ignored, it was simply never added.

> **Therefore no `.gitignore` change was required, and none was made.** Phase 2.0 correctly flagged the exposure but did not establish the cause; the cause is omission, not an ignore rule.

**Pre-staging secret scan** (mandatory, because staging is what would publish a leak):

| Check | Result |
|---|---|
| High-entropy `sk-*` tokens anywhere in `docs/` | **none** |
| `ANTHROPIC_API_KEY` in `docs/audit/phase-0-audit.md` | **variable name only**, in a findings table — no value |
| JWT-shaped string in `docs/architecture/API-CONTRACT.md` | `eyJhbGciO…` — **23 characters**, a truncated illustrative example, not a token |
| Other secret prefixes (`sbp_`, `AKIA`, `ghp_`, `re_`, `xoxb-`) | **none** |

**Action:** all 59 files staged. **Not committed, not pushed** — the user reviews first.

---

## 5. T-1 — TypeScript configuration

### 5.1 Config graph — before

The entire workspace contains **four** tsconfig files. No project references exist anywhere.

```
tsconfig.base.json  (repo root)
   ▲
   └── ✗ packages/ui/tsconfig.json
           extends "@nest/config/tsconfig.base.json"
           └─► TS6053: File not found
               (packages/config/ contains only package.json and src/;
                its "exports" map does not expose any tsconfig)

apps/admin/tsconfig.json        no "extends" — standalone
apps/storefront/tsconfig.json   no "extends" — standalone
```

**The broken path caused a cascade Phase 2.0 did not identify.** Because `extends` failed, *none* of the base options applied, producing two further errors that looked unrelated:

| Error | Real cause |
|---|---|
| `TS6053` — file not found | the broken path itself |
| `TS2307` — cannot find module `@nest/types` (*"There are types at … but could not be resolved under your current 'moduleResolution' setting"*) | base's `moduleResolution: NodeNext` never applied |
| `TS2305` — `lucide-react` has no exported member `ReactSVG` | base's `skipLibCheck: true` never applied |

**One broken string produced all three errors.**

### 5.2 Corrections applied — and rejected

**Applied — `packages/ui/tsconfig.json`:**

```jsonc
"extends": "../../tsconfig.base.json",   // was "@nest/config/tsconfig.base.json"
"lib": ["ES2022", "DOM", "DOM.Iterable"] // added
```

Fixing only the path dropped the count from 3 to **9** — because the base config, now genuinely applied, declares `lib: ["ES2022"]` with no DOM, and `@nest/ui` is a React component library (`HTMLTableCellElement` ×6, `window` ×1).

The `lib` override is **not** a loosening of strictness. `tsconfig.base.json` is a **Node/library** base (`NodeNext`, `declaration`, `declarationMap`); supplying DOM types declares the package's actual runtime environment. Every strict flag remains inherited — verified by the fact that `exactOptionalPropertyTypes` still reports errors afterwards.

**Rejected — Phase 2.0's D-2 ("make the apps extend `tsconfig.base.json`").**

Tested with a disposable probe config (created, measured, deleted; the apps' real tsconfigs were never modified):

| Probe measurement | Value |
|---|---|
| Source files actually checked | **100** (all of `apps/storefront/src`) |
| Effective `lib` | `["es2022"]` |
| Effective module / resolution | `nodenext` / `nodenext` |
| `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess` | `true` / `true` |
| **Errors produced** | **1** — the same pre-existing `.next/dev/types/routes.d.ts` `TS1128`, a generated artifact |

So D-2 is **feasible** — and still rejected, for reasons that are about correctness, not error count:

1. Both app configs are **stock `create-next-app` output** using `moduleResolution: "bundler"`, which is Next.js's own documented recommendation. The base uses `NodeNext`.
2. Changing module-resolution semantics for two production applications is a **material behavioural change**. `tsc --noEmit` passing does **not** imply `next build` passing — they are different resolvers.
3. Nothing in Phase 2.1's scope requires it. The base config's real consumer is `packages/*`; `packages/ui` was its only ever consumer, and it is now correct.
4. The brief is explicit: *"Do not force identical configuration onto all packages if the existing architecture intentionally differs."* Stock Next.js scaffolding differing from a Node library base is an intentional difference.

**Also rejected — D-3 (adding `type-check` to storefront).** Adding a script is adding a *new* failing check, not repairing an existing one. Storefront's current state was measured instead (§6.2) and recorded.

### 5.3 Config graph — after

```
tsconfig.base.json  (repo root)
   ▲
   └── ✓ packages/ui/tsconfig.json   extends "../../tsconfig.base.json"
             overrides: lib (+DOM), outDir, rootDir, jsx

apps/admin/tsconfig.json        standalone — intentional (Next.js scaffold, bundler resolution)
apps/storefront/tsconfig.json   standalone — intentional (Next.js scaffold, bundler resolution)
```

**Residual, recorded and deliberately not fixed** — 2 genuine source defects in `@nest/ui`, revealed only because the intended strict config now actually applies:

| File | Error | Cause |
|---|---|---|
| `packages/ui/src/dropdown-menu.tsx:91` | `TS2375` | `exactOptionalPropertyTypes: true` |
| `packages/ui/src/toast.tsx:52` | `TS2345` | `exactOptionalPropertyTypes: true` |

Per the brief — *"If newly applying an existing intended config reveals source-code errors: Record them. Do not silently refactor unrelated application code."*

---

## 6. Workspace findings

### 6.1 Deterministic install is currently broken — conditionally

`pnpm install --frozen-lockfile` (the exact command CI runs) **fails**:

```
ERR_PNPM_OUTDATED_LOCKFILE
  pnpm-lock.yaml is not up to date with packages\services\package.json
```

Cause: the **pre-existing, uncommitted** addition of `"@supabase/supabase-js": "*"` to `packages/services/package.json`, with no corresponding lockfile update.

| Scenario | Install result |
|---|---|
| CI against **committed `HEAD`** | **passes** — the lockfile importer lists exactly the three workspace deps `HEAD` declares |
| CI after the working tree is committed | **fails** — every job dies at the install step |

The command failed fast and **did not mutate the lock file** (verified). Not fixed: manifests and lock files are outside Phase 2.1's allowed set, and regenerating the lock would fold the user's uncommitted work into Phase 2.1's changeset.

### 6.2 Measured health of every CI-relevant command

| Command | Exit | Detail |
|---|---|---|
| `pnpm -r list --depth -1` | 0 | all **9** workspace projects resolve |
| `pnpm install --frozen-lockfile` | 1 | §6.1 |
| `pnpm lint` | 2 | `@nest/ui` crashes; `admin` 128 errors / 32 warnings; `storefront` 45 errors / 16 warnings |
| `pnpm type-check` | 2 | `admin` — 4 × `TS2339` (`services.ts` ×2, `proxy.ts` ×2) |
| `pnpm build` | 1 | `admin` compiles then fails type-check; `storefront` fails module resolution |
| `tsc -p apps/storefront` (no script exists) | 2 | 1 error, in the generated `.next/dev/types/routes.d.ts` |

**Clean-checkout check:** `apps/admin` type-check was re-run with `next-env.d.ts` removed (it is gitignored, so CI never has it). Result: the **same 4 errors** — so CI needs no build-before-typecheck ordering.

### 6.3 Two defects Phase 2.0 did not find

**W-1 — `@nest/ui` has a lint script but no ESLint config.**
`packages/ui/package.json` declares `"lint": "eslint src/"`; the package contains no `eslint.config.*`. ESLint 9 removed `.eslintrc` support, so the task hard-fails:
`ESLint couldn't find an eslint.config.(js|mjs|cjs) file.`
Not fixed: adding a config would surface an unknown number of new lint errors in frontend source that Phase 2.1 may not modify; removing the script would edit a manifest.

**W-2 — `apps/storefront` uses two undeclared dependencies.**
A declared-versus-imported audit across all eight workspaces found missing dependencies in exactly one:

| Package | Import site | Declared? | Resolves? |
|---|---|---|---|
| `zod` | `src/app/forgot-password/form.tsx:7` | ❌ (`apps/admin` declares `^3.23.8`; storefront does not) | ❌ |
| `pino` | `src/lib/logger.ts:5` | ❌ | ❌ |

Under pnpm's isolated `node_modules` there is no accidental hoisting, so **`zod` breaks `next build` today** — this is the storefront build failure in §6.2. `pino` is a second latent failure queued behind it. Not fixed: manifest + lock file, per §6.1.

---

## 7. CI foundation

**Provider: GitHub Actions.** Evidence, not assumption: the sole remote is `https://github.com/kerolles2003/Nest_Electro.git`. No other CI configuration exists anywhere in the repository.

**File:** `.github/workflows/ci.yml` (83 lines). Validated by parsing with `js-yaml`.

| Property | Choice | Rationale |
|---|---|---|
| Jobs | `lint`, `type-check`, `build` | Three independent gates — each separately red/green and re-runnable |
| Install | `pnpm install --frozen-lockfile` | Deterministic; fails loudly on lock drift rather than silently resolving |
| pnpm version | `pnpm/action-setup@v4` with **no pinned version** | Reads `"packageManager": "pnpm@9.0.0"` from `package.json` — one source of truth, nothing invented |
| Node version | `20` | The only declared contract is `engines: { node: ">=20" }`. See the discrepancy note below. |
| Cache | `actions/setup-node@v4` `cache: pnpm` | Standard, no extra config |
| Commands | `pnpm lint` / `pnpm type-check` / `pnpm build` | **Existing root scripts only** — no invented script |
| `continue-on-error` | **absent** | Would manufacture green from red |
| Secrets | **none referenced** | No job needs one |
| Test job | **omitted** | No workspace defines a `test` script, so `turbo test` runs zero tasks and exits 0 — a vacuously green gate. The brief forbids placeholder tests. |
| Deploy / CD | **omitted** | Out of scope |
| Services (MongoDB, Docker) | **omitted** | Out of scope |

> **Node version discrepancy, unresolved by design.** `engines` declares `>=20`; the local machine runs `v24.11.0`. CI pins the declared floor. Reconciling the two is a deliberate decision, not a Phase 2.1 fix.

**CI will be red on its first run.** That is the accurate state of the repository, and suppressing it was explicitly out of bounds. §6.2 is the triage list.

---

## 8. Change ledger

| File | Change | Justification |
|---|---|---|
| `apps/admin/src/test.md` | **deleted** (staged) | B-1 — removes the exposed value from the working tree |
| `docs/**` (59 files) | **staged** | R-14 — makes the approved baseline git-trackable |
| `packages/ui/tsconfig.json` | `extends` repointed; `lib` override added | T-1 — the one verified TypeScript defect |
| `.github/workflows/ci.yml` | **created** | CI foundation |
| `docs/phase-2/PHASE-2.1-*.md` | created | Required documentation |

**Not touched:** every `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, and all application source. The pre-existing dirty tree (59 modified, 21 deleted) is **numerically identical** to the baseline.

---

## 9. Deliberately deferred

| # | Item | Why not now | Fix when unblocked |
|---|---|---|---|
| **F-1** | `@nest/types` legacy shapes | Brief forbids touching it in 2.1 | Future decision (Phase 2.0 §12.3) |
| **W-1** | `@nest/ui` missing ESLint config | Would surface unreviewed frontend lint errors | Add `eslint.config.mjs`, or drop the script |
| **W-2** | `zod`/`pino` undeclared in storefront | Manifest + lock file | `pnpm --filter storefront add zod pino` |
| **D-5** | Lock drift in `packages/services` | Pre-existing uncommitted user work | `pnpm install` after deciding the manifest's fate |
| **D-3** | Storefront has no `type-check` | Adding a new failing check ≠ repair | Add once its 1 generated-file error is understood |
| **D-4/D-6** | Inert `^build`; root runtime dep | No current impact | Revisit at `apps/api` bootstrap |
| — | 2 × `@nest/ui` strictness errors | Application source | Fix in a dedicated commit |
| — | 173 lint errors + 4 type errors in apps | Application source | Triage before CI can gate |
