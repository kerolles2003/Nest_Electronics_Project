# PHASE 2.2 — NESTJS RUNTIME BOOTSTRAP REPORT

**Date:** 2026-08-30 · **Outcome:** Complete · **Git:** no commit, no push
**Plan:** [`PHASE-2.2-NESTJS-RUNTIME-PLAN.md`](./PHASE-2.2-NESTJS-RUNTIME-PLAN.md)

---

## 1. Files created

**13 files, 336 lines of TypeScript**, all under `apps/api/`.

| File | Purpose |
|---|---|
| `package.json` | Workspace member `api@0.1.0`, private; scripts `dev`, `build`, `start`, `lint`, `type-check` |
| `tsconfig.json` | Server-appropriate config; keeps the workspace's strictness flags |
| `tsconfig.build.json` | Build variant excluding `*.spec.ts` |
| `nest-cli.json` | `sourceRoot: src`, `deleteOutDir: true` |
| `eslint.config.mjs` | ESLint 9 flat config, type-aware via `typescript-eslint` |
| `src/main.ts` | Bootstrap: Helmet · `/api/v1` prefix + URI versioning · shutdown hooks · Swagger · listen |
| `src/app.module.ts` | Composition root; registers `APP_INTERCEPTOR`, `APP_FILTER`, `APP_PIPE`; imports `HealthModule` |
| `src/common/errors/error-code.enum.ts` | 3 stable codes — only those this phase can emit |
| `src/common/filters/all-exceptions.filter.ts` | The single error→HTTP translator; enforces the leakage rule |
| `src/common/interceptors/request-id.interceptor.ts` | Correlation + idempotent `resolveRequestId()` |
| `src/health/health.module.ts` | Dependency-free runtime module |
| `src/health/health.controller.ts` | `GET /api/v1/health` |
| `src/health/health.response.dto.ts` | Decorated class → OpenAPI schema |

Plus this report and the plan under `docs/phase-2/`.

**Not created:** `test/`, `config/`, `database/`, `modules/`, `providers/`, `templates/`, any domain module, any empty directory, any `.env*`, any Docker or CI file.

---

## 2. Files modified

| File | Change | Why |
|---|---|---|
| `pnpm-lock.yaml` | Added the `apps/api` importer and its package snapshots | Unavoidable — the lock file is workspace-global |

**Nothing else.** `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, every other `package.json`, the CI workflow, and all application source are untouched — verified by `git status`.

### 2.1 Lock-file impact, audited importer by importer

| Importer | Result |
|---|---|
| `apps/api` | **ADDED** (this phase) |
| `apps/admin` | **unchanged** ✅ |
| `apps/storefront` | **unchanged** ✅ |
| `packages/ui` | **unchanged** ✅ |
| `packages/config`, `providers`, `repositories`, `types` | **unchanged** ✅ |
| `packages/services` | **CHANGED** — `+ '@supabase/supabase-js': specifier '*' → version 2.105.1` |

The `packages/services` entry is the lock file catching up to a manifest **the user had already modified before this phase began** (Phase 2.1 finding D-5/§6.1). **`packages/services/package.json` was not touched** — no unrelated manifest was repaired. Any `pnpm install` in this workspace would produce the same line; it is unavoidable collateral of installing anything at all.

**A first install attempt caused wider collateral and was reverted.** Using `typescript-eslint@^8.68.0` made pnpm deduplicate `@typescript-eslint/*` workspace-wide, moving `apps/admin`, `apps/storefront` and `packages/ui` from `8.59.1` → `8.68.0`. The lock file was restored from a pre-install copy, the dependency pinned to the already-resolved `8.59.1`, and the install re-run — after which those three importers are byte-identical to before, and `8.68.0` appears nowhere in the lock file.

---

## 3. Dependencies added

**NestJS 11.2.3.** NestJS 12 was evaluated and rejected: `@nestjs/cli@12` depends directly on `typescript ~6.0.2` and `@nestjs/schematics@12` peers `typescript >=6.0.0`, while the workspace is on **5.9.3** and this phase may not upgrade TypeScript. `@nestjs/cli@11.0.24` bundles TypeScript **5.9.3** — an exact match.

| Package | Requested | Resolved | Used by |
|---|---|---|---|
| `@nestjs/common` | ^11.2.3 | 11.2.3 | module, filter, controller, pipe |
| `@nestjs/core` | ^11.2.3 | 11.2.3 | `NestFactory`, `APP_*` tokens |
| `@nestjs/platform-express` | ^11.2.3 | 11.2.3 | HTTP adapter |
| `@nestjs/swagger` | ^11.4.7 | 11.4.7 | OpenAPI generation |
| `class-validator` | ^0.15.1 | 0.15.1 | `ValidationPipe` peer |
| `class-transformer` | ^0.5.1 | 0.5.1 | `transform: true` |
| `helmet` | ^8.3.0 | 8.3.0 | security headers |
| `reflect-metadata` | ^0.2.2 | 0.2.2 | DI metadata |
| `rxjs` | ^7.8.2 | 7.8.2 | interceptor `Observable` |
| **dev** | | | |
| `@nestjs/cli` | ^11.0.24 | 11.0.24 | `build`, `dev` |
| `typescript` | ^5 | **5.9.3** | `type-check` — **no upgrade** |
| `@types/node` | ^20 | 20.19.39 | `node:crypto` |
| `@types/express` | ^5 | 5.0.6 | express 5 typings |
| `eslint` | ^9 | 9.39.4 | `lint` |
| `@eslint/js` | ^9 | 9.39.5 | flat config (v10 rejected — peers `eslint ^10`) |
| `typescript-eslint` | **8.59.1** exact | 8.59.1 | flat config — pinned to contain dedup (§2.1) |

**Verified absent:** `mongoose`, `mongodb`, `@nestjs/mongoose`, `redis`, `ioredis`, `passport`, `@nestjs/jwt`, `bcrypt`, `cloudinary`, `resend`, `@aws-sdk/*`, `@nestjs/config`, `@nestjs/throttler`, `@nestjs/terminus`.

**No workspace dependency was upgraded.** Next.js, React, TypeScript, pnpm and Turborepo are unchanged.

---

## 4. Workspace integration result

| Check | Result |
|---|---|
| pnpm recognises the app | ✅ `api@0.1.0` — **10** workspace projects (was 9) |
| `pnpm-workspace.yaml` change required | ❌ **None** — `apps/*` already matched, confirming Phase 2.0's zero-churn claim |
| `turbo.json` change required | ❌ **None** — `build` already declares `dist/**` as an output |
| Turbo discovers the tasks | ✅ `api#build`, `api#lint`, `api#type-check` |
| Nested monorepo created | ❌ None — no `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `turbo.json` or `.npmrc` inside `apps/api` |
| Depends on `@nest/types` (or any `@nest/*`) | ❌ **None** — no dependency, no import |
| Depends on another app's runtime | ❌ None — no Next.js, no Supabase, no browser API |
| `dist/` escaping into git | ❌ Ignored by the root `.gitignore` |

### CI impact

**No change was needed.** The Phase 2.1 workflow runs `pnpm lint`, `pnpm type-check` and `pnpm build`, which are Turborepo tasks spanning every workspace. `apps/api` is picked up automatically — confirmed by `turbo --dry=json` listing `api#*` in all three task graphs. No deployment, no secrets, no database services were added.

---

## 5. Runtime verification result

The API was built, started, and exercised over HTTP.

| # | Check | Result |
|---|---|---|
| 1 | Process starts | ✅ `Nest application successfully started`, listening on `:3002` |
| 2 | Route mapping | ✅ `Mapped {/api/health, GET} (version: 1)` |
| 3 | **Health** | ✅ `GET /api/v1/health` → `200 {"status":"ok"}` |
| 4 | Versioning isolation | ✅ `/api/health` → 404, `/health` → 404, `/api/v1/health` → 200 |
| 5 | `Strict-Transport-Security` | ✅ `max-age=31536000; includeSubDomains` |
| 6 | `X-Content-Type-Options` | ✅ `nosniff` |
| 7 | `X-Frame-Options` | ✅ `DENY` |
| 8 | `Referrer-Policy` | ✅ `strict-origin-when-cross-origin` |
| 9 | `Content-Security-Policy` | ✅ `default-src 'none';frame-ancestors 'none'` |
| 10 | **Error envelope** | ✅ `{"error":{"code":"RESOURCE_NOT_FOUND","message":"…","requestId":"…","timestamp":"…"}}` |
| 11 | **Leakage rule** | ✅ Nest's default `"Cannot GET /api/v1/nope"` never reaches the client |
| 12 | Correlation — generated | ✅ `x-request-id` present on every response |
| 13 | Correlation — client-supplied | ✅ `x-request-id: trace-abc` echoed verbatim |
| 14 | Correlation — error path | ✅ present on the 404, which no interceptor sees |
| 15 | Server-side correlation | ✅ `[AllExceptionsFilter] GET /api/v1/nope -> 404 RESOURCE_NOT_FOUND [ebf84bdc-…]` |
| 16 | **OpenAPI** | ✅ `3.0.0`; path `/api/v1/health`; schema `HealthResponseDto` — generated from decorators, not hand-written |
| 17 | Graceful shutdown | ✅ `SIGINT` → clean exit, port released |

### Build / type-check / lint

| Check | Command | Result |
|---|---|---|
| Type check | `pnpm --filter api type-check` | ✅ **0 errors** |
| Lint | `pnpm --filter api lint` | ✅ **0 errors, 0 warnings** |
| Build | `pnpm --filter api build` | ✅ 8 JS files; **verified repeatable** across consecutive runs |

### Two defects found by verification and fixed

| # | Defect | Cause | Fix |
|---|---|---|---|
| 1 | `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer` | Helmet 8 defaults differ from the frozen table | Explicit `frameguard: deny`, `referrerPolicy: strict-origin-when-cross-origin`, explicit HSTS |
| 2 | Second build emitted only `main.js`; third emitted **nothing** | `"incremental": true` conflicted with `deleteOutDir: true` — a stale `.tsbuildinfo` suppressed emit after Nest deleted `dist/` | Removed `incremental`; repeatability re-verified |

> Defect 2 would have passed a single-run check and failed the next CI build. It was caught only by building twice.

---

## 6. Known failures

**None introduced by Phase 2.2.** `apps/api` passes lint, type-check, build and runtime verification.

One item requires the user's attention — **not a failure, but a sequencing consequence**:

> **`pnpm install --frozen-lockfile` now passes against the working tree, but would fail against committed `HEAD`.**
>
> The lock file now records `@supabase/supabase-js` for `packages/services`, matching the **uncommitted** manifest. `HEAD`'s copy of that manifest does not declare it.
>
> **`packages/services/package.json` must be committed together with `pnpm-lock.yaml`.** Committing the lock file alone would break CI's install step.

This also *resolves* Phase 2.1's risk N-1 (committing the tree would break the install) — as a side-effect of installing, not as an intended fix.

---

## 7. Pre-existing failures

Unchanged from the Phase 2.1 baseline. Verified by re-running every workspace task with `--continue`.

| # | Failure | Status | Owner |
|---|---|---|---|
| 1 | `@nest/ui` lint crashes — no `eslint.config.*` | 🔴 unchanged | Phase 2.1 W-1 |
| 2 | `admin` lint — 128 errors / 32 warnings | 🔴 unchanged | application source |
| 3 | `storefront` lint — 45 errors / 16 warnings | 🔴 unchanged | application source |
| 4 | `admin` type-check + build — 4 × `TS2339` `Property 'role' does not exist on type 'never'` | 🔴 unchanged | application source |
| 5 | `storefront` build — `zod` unresolved (`pino` latent behind it) | 🔴 unchanged | Phase 2.1 W-2 |
| 6 | `packages/ui` — 2 × `exactOptionalPropertyTypes` errors | 🔴 unchanged | application source |
| 7 | Credential live in pushed git history, **not revoked** | 🔴 unchanged | external action on `agentrouter.org` |

**Regression check:**

| Task | Before 2.2 | After 2.2 |
|---|---|---|
| `turbo lint --continue` | 3 failures | 3 failures + **`api` passes** |
| `turbo type-check --continue` | `admin` fails | `admin` fails + **`api` passes** |
| `turbo build --continue` | `admin`, `storefront` fail | same 2 + **`api` passes** |

**Zero regressions.**

---

## 8. Documentation ambiguity recorded

> **`API-CONTRACT.md` §3 — "One envelope, always" (`{data, …}`) — versus `API-STANDARDS.md` §10, which documents health as a bare `{ status: "ok" }`.**

Both frozen; they disagree on whether health is envelope-exempt. This phase implemented **§10 verbatim** (bare shape) as the more specific statement about that endpoint. Because `TransformInterceptor` is deferred, nothing depends on the resolution yet — but it **must be settled before the envelope interceptor is added**, which is the phase where the two documents generate different code.

**Recorded, not resolved.** A second minor gap: `requestId` appears ULID-shaped in examples but is never normatively specified; this phase uses `crypto.randomUUID()` (zero dependencies).

---

## 9. Git State

| Class | Count | Contents |
|---|---|---|
| **Untracked — Phase 2.2** | **13** | every file under `apps/api/` (source + config) |
| **Modified — Phase 2.2** | **1** | `pnpm-lock.yaml` |
| **Staged — Phase 2.1, untouched** | **64** | 61 docs, `.github/workflows/ci.yml`, `packages/ui/tsconfig.json`, `apps/admin/src/test.md` (deleted) |
| **Modified, unstaged — pre-existing** | **59** | unchanged from baseline |
| **Deleted, unstaged — pre-existing** | **21** | unchanged from baseline |
| **Untracked — pre-existing** | **89** | unchanged from baseline |

Arithmetic proof of isolation: untracked `89 → 102` (**+13**, exactly the new files); modified `59 → 60` (**+1**, exactly the lock file); deleted `21 → 21`; staged `64 → 64`.

> ✅ **No commit created.** `HEAD` is still `dc7768b`.
> ✅ **No push performed.** `main` remains in sync with `origin/main`.
> ✅ Phase 2.1's staged index is untouched — Phase 2.2's work is entirely untracked-plus-one-lockfile, so the two phases remain separately reviewable.

---

## 10. Final validation checklist

| # | Check | Result |
|---|---|---|
| 1 | `apps/api` exists | ✅ 13 files |
| 2 | Normal pnpm workspace member | ✅ `api@0.1.0`, 10 projects |
| 3 | No nested monorepo | ✅ no nested workspace/lock/npmrc/turbo config |
| 4 | No unrelated workspace restructuring | ✅ `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` untouched |
| 5 | Does not import `@nest/types` | ✅ no `@nest/*` dependency or import |
| 6 | No MongoDB dependency | ✅ |
| 7 | No Mongoose dependency | ✅ |
| 8 | No MongoDB connection | ✅ |
| 9 | No database schema | ✅ |
| 10 | No repository implementation | ✅ |
| 11 | No provider implementation | ✅ |
| 12 | No Cloudinary integration | ✅ |
| 13 | No email provider | ✅ |
| 14 | No Redis integration | ✅ |
| 15 | No speculative domain module | ✅ only `HealthModule`, which the frozen map defines as runtime infrastructure |
| 16 | API starts successfully | ✅ verified |
| 17 | Health endpoint works | ✅ `200 {"status":"ok"}` at `/api/v1/health` |
| 18 | Build result documented | ✅ §5 — passes, repeatable |
| 19 | Type-check result documented | ✅ §5 — 0 errors |
| 20 | Lint result documented | ✅ §5 — 0 errors, 0 warnings |
| 21 | Workspace integration verified | ✅ §4 |
| 22 | Turbo integration verified | ✅ `--dry=json` shows all three `api#` tasks |
| 23 | CI impact documented | ✅ §4 — no change required |
| 24 | Phase 2.2 changes distinguishable from the dirty tree | ✅ §9 — exact arithmetic |
| 25 | Frozen architecture not redesigned | ✅ subsets declared in the plan §7; one ambiguity recorded, not resolved (§8) |
| 26 | No secrets introduced | ✅ no `.env*`, no credential, no vendor key |
| 27 | No production credentials introduced | ✅ |

---

## 11. Phase 2.3 Readiness

> ## READY

`apps/api` builds, type-checks, lints, starts, serves the frozen `/api/v1` namespace, returns the frozen error envelope, emits correlation ids, generates OpenAPI from decorators, and shuts down cleanly — with zero regressions to the existing applications.

**Handed to Phase 2.3 (configuration foundation):**

| Item | Note |
|---|---|
| Two temporary `process.env` reads | `PORT` and `NODE_ENV` in `main.ts`, both marked in source. Phase 2.3 replaces them with the validated `app` namespace so `env.schema.ts` becomes the single reader. |
| `SWAGGER_ENABLED` | Currently gated on `NODE_ENV !== 'production'`; becomes a validated config flag. |
| CORS allow-list | Deferred — needs configured origins. |
| `ConfigModule` slot | `app.module.ts` documents the deferred imports in a comment block. |

**Two items the user should settle — neither blocks Phase 2.3:**

1. **Commit `packages/services/package.json` together with `pnpm-lock.yaml`** (§6), or CI's install step will fail against the new commit.
2. **The health-envelope ambiguity** (§8) — must be resolved before the `TransformInterceptor` phase.

Still outstanding from earlier phases: revoke the credential on `agentrouter.org`, and review/commit Phase 2.1's 64 staged files.
