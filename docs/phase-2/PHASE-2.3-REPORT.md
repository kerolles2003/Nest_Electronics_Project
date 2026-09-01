# PHASE 2.3 — CONFIGURATION FOUNDATION REPORT

**Date:** 2026-08-30 · **Outcome:** Complete · **Git:** no commit, no push
**Plan:** [`PHASE-2.3-CONFIGURATION-PLAN.md`](./PHASE-2.3-CONFIGURATION-PLAN.md)

---

## 1. Files created

**5 files** under `apps/api/`.

| File | Purpose |
|---|---|
| `src/config/env.schema.ts` | The environment boundary: `stripEmpty` → Zod schema → `superRefine` conditional vendor rules → secret-safe error formatting → fail-fast `exit(1)`. Exports `envSchema`, `validateEnv`, `env`, `formatIssues`. |
| `src/config/app.config.ts` | `registerAs('app')` — `nodeEnv`, `port`, `apiPrefix`, `swaggerEnabled` (derived once) |
| `src/config/email.config.ts` | `registerAs('email')` — `provider` only. **Contains no credential.** |
| `src/config/config.module.ts` | `ConfigModule.forRoot({ isGlobal, cache, validate, load, envFilePath })` |
| `.env.example` | 60-line tracked template: names, defaults, valid values, conditional-credential behaviour. **No secrets.** |

---

## 2. Files modified

| File | Change |
|---|---|
| `src/main.ts` | Both `process.env` reads removed. `apiPrefix`, `swaggerEnabled` and `port` now come from the injected `app` namespace; `DEFAULT_PORT` constant deleted; boot log now prints the configuration **shape**. |
| `src/app.module.ts` | Imports `ConfigModule`; removed from the deferred-modules comment |
| `package.json` | +2 dependencies |
| `pnpm-lock.yaml` | `apps/api` importer only |

**Nothing else.** `.gitignore`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig*.json`, the CI workflow, every other workspace manifest, and all front-end source are untouched.

> **Reporting note:** `main.ts`, `app.module.ts` and `apps/api/package.json` were created by Phase 2.2 and are **still untracked**, so editing them produces no ` M` row in `git status`. They remain listed under `??`. This is stated explicitly so the git boundary in §9 is not misread.

---

## 3. Dependencies added

| Package | Version | Why | Consumer |
|---|---|---|---|
| `@nestjs/config` | `4.0.4` **exact** | Supplies `ConfigModule.forRoot({ validate, load })`, `registerAs`, `ConfigType` — the exact APIs the frozen architecture names. Peers `@nestjs/common ^10 \|\| ^11` ✓ | `config.module.ts`, both namespaces |
| `zod` | `3.25.76` **exact** | The frozen configuration validation library | `env.schema.ts` |

`zod@3.25.76` is the version **already resolved** for `apps/admin` and `packages/types`. Pinning exactly (rather than `^3.25.76`) prevents the workspace-wide dedup shift that `typescript-eslint@^8.68.0` caused in Phase 2.2.

**Not added:** `mongoose`, `mongodb`, `redis`, `ioredis`, `cloudinary`, `@aws-sdk/*`, `resend`, `@nestjs/jwt`, `passport`, `bcrypt`, `@nestjs/throttler`, `@nestjs/terminus`. No provider SDK, no database driver, no auth library.

---

## 4. Environment variables introduced

| Variable | Type | Required | Default | Valid values |
|---|---|---|---|---|
| `NODE_ENV` | enum | no | `development` | `development` · `test` · `production` |
| `PORT` | integer | no | `3002` | 1–65535 |
| `API_PREFIX` | string | no | `api` | any non-empty string |
| `SWAGGER_ENABLED` | boolean | no | *derived*: `NODE_ENV !== 'production'` | `true` · `false` · `1` · `0` |
| `EMAIL_PROVIDER` | enum | no | `console` | `console` · `resend` |
| `RESEND_API_KEY` | string | **only when `EMAIL_PROVIDER=resend`** | **none** — secrets have no defaults | any non-empty string |

Every variable is optional, so **the API starts with no `.env` file at all**. That is what makes the failure tests runnable without any credential.

---

## 5. Validation behaviour

```
process.env + .env.local + .env
        │
        ▼  ConfigModule.forRoot  (the raw read)
        ▼
   env.schema.ts     stripEmpty → Zod parse → superRefine → formatIssues
        │
  ┌─────┴─────┐
invalid      valid
  │            │
print EVERY   frozen typed Env  →  registerAs namespaces  →  injected consumers
problem
exit(1)
```

| Property | Behaviour |
|---|---|
| When | At boot, inside `ConfigModule`. The process cannot start with invalid configuration. |
| Completeness | **All problems reported at once** — verified with three simultaneous errors |
| Output stream | `stderr` — the Nest logger does not exist yet at that point |
| Secret safety | `SECRET_KEYS` redaction replaces messages for credential variables with `Invalid or missing value`, because Zod's default text echoes the received value |
| Coercion | Once, at the edge: `PORT` becomes a `number`; `SWAGGER_ENABLED` becomes a real boolean |
| Derivation | Once, in the factory: `swaggerEnabled = SWAGGER_ENABLED ?? NODE_ENV !== 'production'` |
| Consumer contract | Injected `ConfigType`; no consumer parses a string, knows a variable name, or sees `string \| undefined` |
| `process.env` in `apps/api/src` | **Zero literal accesses** — the library reads, the schema validates |

### Verified failures

| # | Input | Result |
|---|---|---|
| T1 | `PORT=not-a-number` | exit 1 — `PORT  Expected number, received nan` |
| T2 | `EMAIL_PROVIDER=mailchimp` | exit 1 — `Expected 'console' \| 'resend', received 'mailchimp'` |
| T3 | `EMAIL_PROVIDER=resend`, no key | exit 1 — `RESEND_API_KEY  Invalid or missing value` (**redacted**) |
| T4 | `SWAGGER_ENABLED=yes` | exit 1 — `Expected 'true' \| 'false' \| '1' \| '0'` |
| T5 | Three invalid values together | exit 1 — **all three listed in one run** |
| T6 | `EMAIL_PROVIDER=resend RESEND_API_KEY=` | exit 1 — empty secret correctly treated as missing |

Example output:

```
✖ Configuration invalid — 3 problem(s):
  PORT                 Expected number, received nan
  SWAGGER_ENABLED      Invalid enum value. Expected 'true' | 'false' | '1' | '0', received 'yes'
  EMAIL_PROVIDER       Invalid enum value. Expected 'console' | 'resend', received 'mailchimp'

See apps/api/.env.example for the full variable set.
```

---

## 6. Default behaviour

| Input | Boot log |
|---|---|
| No environment at all | `env=development  port=3002  prefix=/api/v1  swagger=true` |
| `PORT=4100` | `port=4100` |
| `NODE_ENV=production` | `swagger=false` — the frozen non-production rule, applied automatically |
| `NODE_ENV=production SWAGGER_ENABLED=true` | `swagger=true` — explicit value overrides the derivation |
| `API_PREFIX=gateway` | `prefix=/gateway/v1` |
| `EMAIL_PROVIDER=console` | starts — **no credential required** |
| `EMAIL_PROVIDER=resend` + placeholder key | starts — no real credential needed |
| `NODE_ENV=` / `PORT=` / `EMAIL_PROVIDER=` empty | all take their defaults |

**The boot log prints the shape, never values:**

```
config loaded  env=development  port=3002  prefix=/api/v1  swagger=true
```

### One defect found and fixed during verification

`NODE_ENV=` (empty string) failed the enum instead of taking the default — Zod's `.default()` fires only on `undefined`. Empty environment variables are routine (`PORT=` in a compose file, a CI secret resolving to empty, a bare `.env` line), and every platform treats them as unset. `stripEmpty()` now removes empty values before parsing.

This does **not** weaken the conditional rule: `EMAIL_PROVIDER=resend RESEND_API_KEY=` still fails, because an empty secret is correctly read as missing (T6).

---

## 7. Regression verification

Phase 2.2 behaviour, re-verified against the running binary after the refactor.

| Behaviour | Result |
|---|---|
| API starts | ✅ |
| `GET /api/v1/health` | ✅ `200 {"status":"ok"}` — **byte-identical** |
| `GET /api/health` | ✅ 404 |
| `GET /health` | ✅ 404 |
| Unknown route error envelope | ✅ `{"error":{"code":"RESOURCE_NOT_FOUND","message":"…","requestId":"…","timestamp":"…"}}` |
| `X-Request-Id` echo | ✅ client-supplied `cfg-trace` echoed |
| Swagger JSON | ✅ 200 at `/api/v1/docs-json` |
| `Strict-Transport-Security` | ✅ `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | ✅ `nosniff` |
| `X-Frame-Options` | ✅ `DENY` |
| `Referrer-Policy` | ✅ `strict-origin-when-cross-origin` |
| `Content-Security-Policy` | ✅ `default-src 'none';frame-ancestors 'none'` |
| SIGINT shutdown | ✅ clean exit, port released |

**No HTTP behaviour changed.** The only functional difference is that three values previously hardcoded are now validated configuration with identical defaults.

**The health-envelope ambiguity remains unresolved and untouched** — no envelope interceptor was introduced, and the health response is unchanged (§10).

---

## 8. Build / type-check / lint

| Check | Command | Result |
|---|---|---|
| Type check | `pnpm --filter api type-check` | ✅ **0 errors** |
| Lint | `pnpm --filter api lint` | ✅ **0 errors, 0 warnings** |
| Build | `pnpm --filter api build` | ✅ 12 JS files (was 8) |
| Turbo discovery | `turbo run <task> --dry=json` | ✅ `api#build`, `api#lint`, `api#type-check` all present |
| Deterministic install | `pnpm install --frozen-lockfile` | ✅ `Lockfile is up to date` |

**Workspace regression — unchanged from the Phase 2.2 baseline:**

| Task | Result |
|---|---|
| `turbo lint --continue` | 1 successful (`api`) / 4 — fails: `@nest/ui`, `admin`, `storefront` |
| `turbo type-check --continue` | 1 successful (`api`) / 2 — fails: `admin` |
| `turbo build --continue` | 1 successful (`api`) / 3 — fails: `admin`, `storefront` |

Identical in count and identity to before. **Zero regressions.** No pre-existing front-end failure was touched.

---

## 9. Lockfile impact

| Importer | Result |
|---|---|
| `apps/api` | CHANGED — `+@nestjs/config@4.0.4`, `+zod@3.25.76` |
| `apps/admin` | **unchanged** ✅ |
| `apps/storefront` | **unchanged** ✅ |
| `packages/config`, `providers`, `repositories`, `services`, `types`, `ui` | **unchanged** ✅ |

Single `zod` version in the lock file (`3.25.76`, appearing once under `packages:` and once under `snapshots:` — normal structure, not duplication). **Zero collateral churn; no restore-and-retry was required.**

---

## 10. Git boundary

| Class | Count | Delta | Contents |
|---|---|---|---|
| **Untracked** | **109** | **+5** | the 4 `src/config/*.ts` files and `.env.example` |
| **Modified, unstaged** | **60** | **0** | `pnpm-lock.yaml` (already modified by 2.2) + 59 pre-existing |
| **Deleted, unstaged** | **21** | 0 | pre-existing |
| **Staged (Phase 2.1)** | **64** | 0 | untouched |

`main.ts`, `app.module.ts` and `apps/api/package.json` were edited by this phase but were already untracked, so they stay in the `??` set rather than appearing as ` M` (§2).

> ✅ **No commit created.** `HEAD` is still `dc7768b`.
> ✅ **No push performed.** `main` in sync with `origin/main`.
> ✅ No pre-existing dirty-tree file was modified — the ` M` and ` D` counts are identical to the phase-start baseline.

---

## 11. Inherited unresolved ambiguity

> **`API-CONTRACT.md` §3 "One envelope, always" versus `API-STANDARDS.md` §10's bare `{ status: "ok" }` for health.**

Carried forward from Phase 2.2, **deliberately not resolved here**. No response-envelope interceptor was introduced; the health response format is unchanged. It must be settled before that interceptor is built.

---

## 12. Final checklist

| # | Check | Result |
|---|---|---|
| 1 | Frozen architecture re-read | ✅ CONFIG, PROVIDER, CODEBASE-STRUCTURE, PORTS, CROSS-CUTTING, API-CONTRACT, API-STANDARDS |
| 2 | Decisions grounded in authoritative documents | ✅ plan §1, cited inline |
| 3 | Zod used for configuration validation | ✅ |
| 4 | `class-validator` remains DTO-only | ✅ untouched, still the global `ValidationPipe` |
| 5 | Raw `process.env` access centralised | ✅ **zero literal accesses** in `apps/api/src` |
| 6 | Consumers do not parse environment strings | ✅ injected `ConfigType` only |
| 7 | Values typed and normalized | ✅ number, booleans, literal unions |
| 8 | Invalid configuration fails at startup | ✅ 6 verified failure cases, `exit(1)` |
| 9 | Errors do not expose secret values | ✅ `SECRET_KEYS` redaction, verified in T3/T6 |
| 10 | No real secrets introduced | ✅ |
| 11 | No real credentials committed | ✅ no `.env` created; template holds only defaults |
| 12 | Environment file policy documented | ✅ plan §6 |
| 13 | `.env.example` contains no secrets | ✅ four plain assignments, no high-entropy value |
| 14 | Provider selection values validated | ✅ enum; `mailchimp` rejected at boot |
| 15 | Unselected providers need no credentials | ✅ `console` (default) requires nothing |
| 16 | No provider SDK installed | ✅ |
| 17 | No provider implementation exists | ✅ |
| 18 | No MongoDB dependency | ✅ |
| 19 | No database connection | ✅ |
| 20 | No Redis dependency | ✅ |
| 21 | No authentication implementation | ✅ |
| 22 | No domain module created | ✅ |
| 23 | Phase 2.2 HTTP behaviour unchanged | ✅ §7 |
| 24 | Health response unchanged | ✅ byte-identical |
| 25 | Health ambiguity still unresolved and documented | ✅ §11 |
| 26 | API build passes | ✅ |
| 27 | API typecheck passes | ✅ |
| 28 | API lint passes | ✅ |
| 29 | Turbo recognises `apps/api` | ✅ all three tasks |
| 30 | Lockfile changes inspected | ✅ §9, importer by importer |
| 31 | No unrelated dependency churn accepted | ✅ zero collateral |
| 32 | Pre-existing dirty-tree files unmodified | ✅ ` M`/` D` counts identical |
| 33 | Phase 2.3 changes clearly distinguishable | ✅ §10 |

---

## 13. Phase 2.4 readiness

> ## READY

The configuration boundary is in place, validated, typed, and proven by execution: 6 failure cases, 8 default/happy-path cases, and a full Phase 2.2 regression pass.

**What Phase 2.4 (persistence foundation) inherits:**

| Item | Note |
|---|---|
| Extension pattern | Adding the `database` namespace is three edits: a block in `env.schema.ts`, a `database.config.ts` with `registerAs`, one entry in `config.module.ts`'s `load` array |
| Conditional-requirement mechanism | `superRefine` is in place and proven; reusable for any "required only when…" rule |
| Secret-safe errors | Add `MONGODB_URI` to `SECRET_KEYS` — a connection string carries credentials |
| No secret defaults | The rule is established: `RESEND_API_KEY` has none, and `MONGODB_URI` must not either |
| Replica-set gate | **Untouched and still binding.** No MongoDB dependency, connection or schema was added; the transaction-rollback proof remains a hard prerequisite before any domain module. |

**Still outstanding from earlier phases, none blocking Phase 2.4:**

1. Revoke the credential on `agentrouter.org` (in pushed git history).
2. Review and commit Phase 2.1's 64 staged files.
3. Commit `packages/services/package.json` together with `pnpm-lock.yaml`.
4. Resolve the health-envelope ambiguity before the envelope interceptor phase.
