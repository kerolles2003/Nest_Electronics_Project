# PHASE 2.3 — CONFIGURATION FOUNDATION PLAN

**Status:** Executed · **Date:** 2026-08-30 · **Companion:** [`PHASE-2.3-REPORT.md`](./PHASE-2.3-REPORT.md)
**Preceded by:** [`PHASE-2.2-REPORT.md`](./PHASE-2.2-REPORT.md) · **Architecture:** `ARCHITECTURE FREEZE: APPROVED`

> **No conflict was found** between the frozen architecture and this phase's brief. Every narrowing below is a declared phase-sequencing subset (§8), not a reinterpretation.

---

## 1. Architecture decisions used

Re-read before writing code. [`CONFIGURATION-ARCHITECTURE.md`](../architecture/CONFIGURATION-ARCHITECTURE.md) is the controlling document; the others constrain specific choices.

| Decision | Frozen statement | Authority | Status |
|---|---|---|---|
| **One environment boundary** | "`process.env` is read in exactly one place: the environment schema. Everywhere else, configuration arrives through typed injection." | CONFIG §1 | ✅ |
| **Zod for configuration** | Zod's type inference wins where there is no OpenAPI dimension | CONFIG §3 | ✅ |
| **`class-validator` stays DTO-only** | Driven by `@nestjs/swagger` generating the Flutter client from the same decorated classes | [`DTO-STRATEGY.md`](../architecture/DTO-STRATEGY.md) | ✅ untouched |
| **Fail-fast at boot** | "print EVERY error, exit(1)" — not the first error | CONFIG §3 | ✅ |
| **Typed namespaces via `registerAs`** | Consumed by injection, never by lookup | CONFIG §4 | ✅ |
| **Modules inject only what they need** | No god `AppConfig` object | CONFIG §4 rule 1 | ✅ |
| **Coercion happens in the schema** | "`PORT` becomes a `number` once, at the edge" | CONFIG §4 rule 4 | ✅ |
| **Derivation in the factory** | Not in a consumer's constructor | CONFIG §11 | ✅ `swaggerEnabled` |
| **Application vs vendor config split** | Vendor credentials live beside their adapter, read only by it | CONFIG §5, [`PROVIDER-ARCHITECTURE.md`](../architecture/PROVIDER-ARCHITECTURE.md) §5.5 | ✅ §5 |
| **Conditional vendor requirements** | "Selecting `console` in development must not demand a Resend key" | CONFIG §5 | ✅ verified |
| **No business branching on provider** | `if (config.email.provider === 'resend')` in a service is a red flag | CONFIG §5 | ✅ nothing branches |
| **Secrets never logged** | Startup logs the *shape*, never values | CONFIG §6 | ✅ §4.3 |
| **Secrets have no defaults** | "A weak default silently reaches production" | CONFIG §11 | ✅ `RESEND_API_KEY` has none |
| **One schema across environments** | Differences are values, not shapes | CONFIG §7 | ✅ |
| **`NODE_ENV` only for infrastructure** | Swagger exposure, log verbosity, provider selection — never business behaviour | CONFIG §7 | ✅ only `swaggerEnabled` |
| **No feature flags** | Only boot-time capability switches | CONFIG §8 | ✅ |
| **`.env.example` tracked, `.env*` ignored** | Phase 0 found no `.env.example` existed despite `.gitignore` whitelisting one | CONFIG §6, §9 | ✅ §6 |
| **`SWAGGER_ENABLED` is a capability switch** | Listed explicitly among the three permitted switches | CONFIG §8 | ✅ |
| **`config/` directory placement** | `src/config/` inside the API | [`CODEBASE-STRUCTURE.md`](../architecture/CODEBASE-STRUCTURE.md) §2.1 | ✅ |
| **No `ConfigPort` abstraction** | No speculative ports; the six-port inventory is closed | [`PORTS-AND-CONTRACTS.md`](../architecture/PORTS-AND-CONTRACTS.md) §3, freeze gate #10 | ✅ none created |

---

## 2. Existing configuration audit

State before this phase.

| Finding | Evidence |
|---|---|
| `apps/api` read `process.env` in exactly **two** places | `main.ts:55` (`NODE_ENV`, Swagger gating) and `main.ts:67` (`PORT`, with a `DEFAULT_PORT = 3002` constant) |
| Both were **declared temporary** by Phase 2.2 | Marked in source as this phase's to absorb |
| No configuration library present | `apps/api` had neither `@nestjs/config` nor `zod` |
| No `.env` file for the API | Only root `.env` (0 bytes) and two front-end `.env.local` files |
| **No `.env*` file is tracked anywhere** | `git ls-files` → none |
| `.gitignore` **already correct** | `.env` (18), `.env.*` (19), `!.env.example` (20) — unanchored, so they match at any depth |
| Front-end convention | `.env.local` per app, `NEXT_PUBLIC_*` prefixes — **deliberately not copied**; those are browser-bundle semantics with no meaning server-side |
| Legacy precedent | `packages/config/src/env.ts` implements this exact fail-fast validation and is imported by **zero** files (Phase 2.1 D-7) |

**`.gitignore` verification, by exit code, not by reading:**

```
apps/api/.env          IGNORED
apps/api/.env.local    IGNORED
apps/api/.env.example  TRACKABLE
```

> **Therefore no `.gitignore` change was made, and none was needed.** The brief required documenting evidence before modifying ignore rules; the evidence says do not modify them.

---

## 3. Configuration flow

```
                    process.env  +  .env.local  +  .env
                                 │
                                 ▼
                    ConfigModule.forRoot  (the raw read)
                                 │
                                 ▼
                    ┌────────────────────────────┐
                    │  env.schema.ts             │   THE BOUNDARY
                    │    stripEmpty()            │   '' → absent
                    │    Zod parse               │   types + ranges + enums
                    │    superRefine             │   conditional vendor rules
                    │    formatIssues            │   secret-safe messages
                    └────────────┬───────────────┘
                        invalid  │  valid
                    ┌────────────┴───────────────┐
                    ▼                            ▼
        print EVERY problem            frozen, typed `Env`
        exit(1) — process              cached for factories
        never starts                            │
                                 ┌──────────────┴──────────────┐
                                 ▼                             ▼
                        app.config.ts                  email.config.ts
                        registerAs('app')              registerAs('email')
                        nodeEnv, port,                 provider
                        apiPrefix, swaggerEnabled      (NO credentials)
                                 │                             │
                                 └──────────────┬──────────────┘
                                                ▼
                                    injected, fully typed
                                    consumer does no parsing
```

**Boundary answers, as the brief requires:**

| Question | Answer |
|---|---|
| Where is raw environment input read? | `ConfigModule.forRoot` — the library's own read, handed straight to the schema |
| Where is it validated? | `env.schema.ts`, and nowhere else |
| Where is normalization performed? | Coercion in the schema (`PORT` → number, booleans → real booleans); derivation in the `registerAs` factory (`swaggerEnabled`) |
| Where is typed configuration exposed? | `app.config.ts`, `email.config.ts` — injected by `ConfigType` |
| Where are configuration categories defined? | One `registerAs` file per category, loaded by `config.module.ts` |

**Zero literal `process.env` accesses now exist in `apps/api/src`.** The library performs the read; the schema owns the boundary. This is *stronger* than the frozen requirement of "exactly one file", not weaker.

---

## 4. Environment validation design

### 4.1 The schema

| Variable | Type | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | `development \| test \| production` | `development` | Infrastructure only |
| `PORT` | integer 1–65535 (coerced) | `3002` | Was a hardcoded constant |
| `API_PREFIX` | non-empty string | `api` | Serves `/<prefix>/v1` |
| `SWAGGER_ENABLED` | boolean (`true\|false\|1\|0`) | *derived* | `?? NODE_ENV !== 'production'` |
| `EMAIL_PROVIDER` | `console \| resend` | `console` | Selection only |
| `RESEND_API_KEY` | non-empty string | **none — secrets have no defaults** | Required **only** when `EMAIL_PROVIDER=resend` |

**Every variable is optional**, so the API starts with no `.env` file at all — which is what makes the failure tests runnable without any credential.

### 4.2 Empty strings are treated as absent

A defect found during verification: `NODE_ENV=` (empty) failed the enum instead of taking the default, because Zod's `.default()` fires only on `undefined`.

`PORT=` in a compose file, a CI secret resolving to empty, or a bare `LOG_LEVEL=` line all arrive as `''`, and every deployment platform treats those as unset. `stripEmpty()` removes empty values before parsing so defaults apply.

Importantly, this does **not** weaken the conditional rule: `EMAIL_PROVIDER=resend RESEND_API_KEY=` still fails, because an empty secret is correctly read as missing.

### 4.3 Secret-safe error reporting

Zod's default messages echo the received value — `Invalid enum value. Expected …, received 'foo'`. For a credential that would put a secret into a log line, violating CONFIG §6.

`SECRET_KEYS` marks such variables; `formatIssues` replaces their message with a generic `Invalid or missing value`. Non-secret variables keep the specific message, because that is what makes an error actionable.

```
✖ Configuration invalid — 3 problem(s):
  PORT                 Expected number, received nan
  SWAGGER_ENABLED      Invalid enum value. Expected 'true' | 'false' | '1' | '0', received 'yes'
  EMAIL_PROVIDER       Invalid enum value. Expected 'console' | 'resend', received 'mailchimp'

See apps/api/.env.example for the full variable set.
```

Written to `stderr` rather than through the Nest logger, because the logger does not exist yet at that point and this must be readable when nothing else has started.

### 4.4 Boot log — shape, never values

```
config loaded  env=development  port=3002  prefix=/api/v1  swagger=true
```

Enough to answer "what is live?" without exposing anything. Directly per CONFIG §6.

---

## 5. Provider-selection preparation

Implemented as a **single concrete instance**, not a framework.

```
EMAIL_PROVIDER=console | resend     ← application level → email.config.ts
RESEND_API_KEY=…                    ← vendor level     → NOT exposed anywhere yet
```

| Requirement (brief) | How it is met |
|---|---|
| Provider values must be validated | Zod enum; anything else fails at boot |
| Unsupported providers must fail startup | Verified: `EMAIL_PROVIDER=mailchimp` → exit 1 |
| Must not initialize a vendor SDK | No SDK is installed; nothing is constructed |
| Must not leak vendor config into business modules | `RESEND_API_KEY` is validated but exposed through **no namespace at all** — it is currently unreachable by any code |
| Unselected providers must not require credentials | Verified: `console` (the default) needs nothing |

**Why `RESEND_API_KEY` is validated but not exposed.** CONFIG §5 and PROVIDER-ARCHITECTURE §5.5 place vendor credentials in the adapter's own config file, read only by that adapter. That file lives under `providers/`, which this phase may not create. Validating the key while exposing it nowhere is the honest intermediate state: the *contract* ("select resend, supply its key") is enforced now; the *access path* arrives with the adapter.

### Design choice, documented as the brief requires

**Only the email category was introduced.** `MEDIA_PROVIDER` and the database, auth, throttle and observability categories were **not** added, because:

1. The brief forbids pre-populating every future category with credentials.
2. One concrete instance is sufficient to establish and *prove* the conditional-validation mechanism.
3. A namespace nothing injects is close to the legacy failure the frozen document warns about — a validation module that never runs. One is a demonstrated pattern; six would be dead weight.

**Adding the next category is two edits**, and deliberately so: one block in `env.schema.ts`, one `registerAs` file, one entry in `config.module.ts`'s `load` array.

---

## 6. Environment file policy

| Rule | Decision |
|---|---|
| Tracked | `apps/api/.env.example` — names, safe placeholders, comments |
| Ignored | `apps/api/.env`, `.env.local`, any `.env.*` — already covered by the root `.gitignore` |
| Created by this phase | **Only `.env.example`.** No `.env` was created; the API starts without one. |
| Loading order | `.env.local` then `.env`, relative to `apps/api`. Real process env always wins. |
| Production | **No `.env` file on a production host** — variables come from the platform secret store |
| Secrets in the template | **None.** `RESEND_API_KEY` is commented out with the placeholder `YOUR_RESEND_API_KEY_HERE` |

The template documents, for every variable: whether it is required, its default, its valid values, and — for `EMAIL_PROVIDER` — the conditional-credential behaviour. Deferred categories are listed **as names only, in a comment**, so the file never presents a variable that currently does nothing.

---

## 7. Dependency decisions

| Package | Version | Why required | Phase 2.3 consumer |
|---|---|---|---|
| `@nestjs/config` | **`4.0.4`** exact | Provides `ConfigModule.forRoot({ validate, load })`, `registerAs` and `ConfigType` — the exact APIs the frozen architecture specifies. Peers `@nestjs/common ^10 \|\| ^11` → compatible with Nest 11.2.3. | `config.module.ts`, both namespaces |
| `zod` | **`3.25.76`** exact | The frozen configuration validation library | `env.schema.ts` |

**Both pinned exactly, applying the Phase 2.2 lesson.** `zod@3.25.76` is the version **already resolved** workspace-wide for `apps/admin` and `packages/types`; a caret range could resolve higher and trigger the same workspace-wide dedup shift that `typescript-eslint@^8.68.0` caused in Phase 2.2.

**Lockfile audit, importer by importer:**

| Importer | Result |
|---|---|
| `apps/api` | CHANGED (+2 dependencies) |
| `apps/admin`, `apps/storefront` | **unchanged** ✅ |
| `packages/config`, `providers`, `repositories`, `services`, `types`, `ui` | **unchanged** ✅ |

Single `zod` version in the lock file (`3.25.76`); no duplication. `pnpm install --frozen-lockfile` passes. **Zero collateral churn — no restore-and-retry was needed this time.**

**Not added:** `mongoose`, `mongodb`, `redis`, `ioredis`, `cloudinary`, `@aws-sdk/*`, `resend`, `@nestjs/jwt`, `passport`, `bcrypt`, `@nestjs/throttler`, `@nestjs/terminus`, `class-validator` for config.

---

## 8. Explicit deferrals

| Deferred | Frozen end state | Why not now |
|---|---|---|
| `database` namespace (`MONGODB_URI`, `MONGODB_DB_NAME`) | CONFIG §9 | Persistence is the next phase's; adding the variables now would mean a namespace nothing injects |
| `auth` namespace (`JWT_SECRET`, TTLs, `BCRYPT_ROUNDS`) | CONFIG §9 | The brief forbids it unless an API-wide runtime secret is required now. It is not. |
| `media` namespace (`MEDIA_PROVIDER`, `CLOUDINARY_*`) | CONFIG §9 | No media capability exists |
| Email application settings (`EMAIL_FROM_ADDRESS`, `_NAME`, `_REPLY_TO`) | CONFIG §9 | Consumed by `NotificationsService`, which does not exist |
| `http` extras (`SITE_URL`, `CORS_ORIGINS`) | CONFIG §9 | CORS is deliberately still unimplemented; adding origins config without a consumer is speculative |
| `throttle`, `observability` (`LOG_LEVEL`, `SENTRY_*`) | CONFIG §9 | Rate limiting and structured logging are later phases |
| Vendor config files (`providers/email/resend/resend.config.ts`) | CONFIG §5 | `providers/` may not be created in this phase |
| Redis | [`REDIS-DECISION.md`](../architecture/REDIS-DECISION.md) | Deferred pending OPEN-006; **absent by design**, not by omission |
| Schema unit tests | CONFIG §10 | The repository still has **no test infrastructure** (Phase 2.1). Validation was proven by executing the built binary against 12 environment permutations (§9) — evidence, not a substitute test suite. |

---

## 9. Validation results

### Configuration failure behaviour

| # | Input | Result |
|---|---|---|
| T1 | `PORT=not-a-number` | ✅ exit 1 — `PORT  Expected number, received nan` |
| T2 | `EMAIL_PROVIDER=mailchimp` | ✅ exit 1 — enum message lists the valid values |
| T3 | `EMAIL_PROVIDER=resend`, no key | ✅ exit 1 — `RESEND_API_KEY  Invalid or missing value` (**redacted**) |
| T4 | `SWAGGER_ENABLED=yes` | ✅ exit 1 — lists `'true' \| 'false' \| '1' \| '0'` |
| T5 | Three invalid values at once | ✅ exit 1 — **all three reported together**, not one per restart |
| T6 | `EMAIL_PROVIDER=resend RESEND_API_KEY=` | ✅ exit 1 — empty secret correctly read as missing |

### Default and happy-path behaviour

| Input | Result |
|---|---|
| No environment at all | ✅ `env=development port=3002 prefix=/api/v1 swagger=true` |
| `PORT=4100` | ✅ `port=4100` |
| `NODE_ENV=production` | ✅ `swagger=false` — the frozen non-production rule, automatic |
| `NODE_ENV=production SWAGGER_ENABLED=true` | ✅ `swagger=true` — explicit value overrides the derivation |
| `API_PREFIX=gateway` | ✅ `prefix=/gateway/v1` |
| `EMAIL_PROVIDER=console` | ✅ starts — **no credential required** |
| `EMAIL_PROVIDER=resend` + placeholder key | ✅ starts — no real credential needed to test |
| `NODE_ENV=` / `PORT=` / `EMAIL_PROVIDER=` (empty) | ✅ all take their defaults |

### Phase 2.2 regression — unchanged

| Behaviour | Result |
|---|---|
| `GET /api/v1/health` | ✅ `200 {"status":"ok"}` — **byte-identical** |
| `/api/health`, `/health` | ✅ both 404 |
| Unknown route error envelope | ✅ `{"error":{"code":"RESOURCE_NOT_FOUND",…}}` |
| `X-Request-Id` echo | ✅ `cfg-trace` echoed |
| All five security headers | ✅ unchanged, including `X-Frame-Options: DENY` |
| Swagger JSON | ✅ 200 |
| SIGINT shutdown | ✅ clean exit, port released |

### Tooling

| Check | Result |
|---|---|
| `pnpm --filter api type-check` | ✅ 0 errors |
| `pnpm --filter api lint` | ✅ 0 errors, 0 warnings |
| `pnpm --filter api build` | ✅ 12 JS files |
| Turbo discovery | ✅ `api#build`, `api#lint`, `api#type-check` |
| Workspace regression | ✅ `api` passes all three; the pre-existing failures are unchanged in count and identity |

---

## 10. Inherited unresolved ambiguity

> **`API-CONTRACT.md` §3 — "One envelope, always" — versus `API-STANDARDS.md` §10, where health returns a bare `{ status: "ok" }`.**

**Carried forward from Phase 2.2, deliberately untouched.** No response-envelope interceptor was introduced, and the health response is byte-identical. This phase neither resolved nor advanced the question; it must be settled before the envelope interceptor is built.
