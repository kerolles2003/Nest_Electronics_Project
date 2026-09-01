# Configuration Architecture — Phase 1.1

**Status:** FROZEN pending review · **Date:** 2026-08-30 · **ADR:** ADR-CODE-013

---

## 1. The rule

> **`process.env` is read in exactly one place: the environment schema. Everywhere else, configuration arrives through typed injection.**

A `process.env.X` in a service is three problems at once: it is untyped (`string | undefined`), unvalidated (a typo yields `undefined` at 3 a.m. rather than at boot), and untestable (overriding it requires mutating global state).

**The legacy precedent is instructive.** Phase 0 found `packages/config/src/env.ts` implementing exactly the fail-fast validation this document describes — and it was **imported nowhere**, so it never ran. Meanwhile `NEXT_PUBLIC_SUPABASE_URL` was read directly in five separate files. A validation module that nothing imports is worse than none, because it creates the appearance of safety. Here, validation runs in `ConfigModule` at boot and the application cannot start without it.

---

## 2. Structure

```
src/config/
├── config.module.ts          # ConfigModule.forRoot with the schema + namespaces
├── env.schema.ts             # THE ONLY FILE THAT READS process.env
│
├── app.config.ts             # port, nodeEnv, apiPrefix, corsOrigins, siteUrl
├── database.config.ts        # mongoUri, dbName, poolSize
├── auth.config.ts            # jwtSecret, accessTtl, refreshTtl, bcryptRounds
├── email.config.ts           # provider selector + application-level settings
├── media.config.ts           # provider selector + application-level settings
├── throttle.config.ts        # rate-limit windows and quotas
└── observability.config.ts   # logLevel, sentryDsn, release
```

**Provider credentials do not live here.** They live in the provider's own config file, read only by that adapter (§5).

---

## 3. Validation

> **Fail-fast at boot with a complete error report. The process must not start with invalid configuration.**

```
main.ts bootstrap
   ↓
ConfigModule.forRoot({ validate: validateEnv, isGlobal: true })
   ↓
env.schema.ts parses process.env
   ↓  invalid  →  print EVERY error, exit(1)
   ↓  valid    →  typed namespaces registered
```

**Schema library: Zod.** The project already uses Zod in `@nest/types`, it produces a TypeScript type by inference (so the config type cannot drift from the schema), and its error output naturally lists all failures at once.

> Note the deliberate asymmetry with [`DTO-STRATEGY.md`](./DTO-STRATEGY.md), which chose `class-validator` for HTTP DTOs. That choice is driven by `@nestjs/swagger` generating the OpenAPI document — and therefore the Flutter client — from the same decorated classes that validate at runtime. Configuration has no OpenAPI dimension, so Zod's superior type inference wins. Two libraries in two clearly-bounded roles is a smaller cost than forcing one into a role it fits poorly.

**Report every error, not the first.** A developer setting up the project should see all six missing variables at once, not discover them one restart at a time.

```
✖ Configuration invalid — 3 problems:
  MONGODB_URI          Required
  JWT_SECRET           String must contain at least 32 character(s)
  EMAIL_PROVIDER       Invalid enum value. Expected 'resend' | 'console'
```

---

## 4. Typed namespaces

```ts
// config/auth.config.ts  (conceptual)
export const authConfig = registerAs('auth', () => ({
  jwtSecret: env.JWT_SECRET,
  accessTokenTtl: env.JWT_ACCESS_TTL,       // '15m'
  refreshTokenTtl: env.JWT_REFRESH_TTL,     // '30d'
  bcryptRounds: env.BCRYPT_ROUNDS,          // 12
}));

export type AuthConfig = ConfigType<typeof authConfig>;
```

Consumed by injection, never by lookup:

```ts
constructor(
  @Inject(authConfig.KEY) private readonly cfg: AuthConfig,
) {}
```

Rules:

| # | Rule |
|---|---|
| 1 | **A module injects only the namespaces it needs.** `AuthService` gets `auth`, not the whole config object. |
| 2 | **Namespaces are typed**, so `cfg.bcryptRounds` is `number` and `cfg.jwtSecrt` is a compile error. |
| 3 | **No namespace crosses a domain boundary.** There is no `misc` or `common` namespace. |
| 4 | **Coercion happens in the schema.** `PORT` becomes a `number` once, at the edge. |

---

## 5. Provider configuration boundaries

The distinction that keeps a provider swap contained:

```
config/email.config.ts                   ← APPLICATION-level (provider-agnostic)
    provider: 'resend' | 'console'
    fromAddress, fromName, replyTo

providers/email/resend/resend.config.ts  ← VENDOR-level
    apiKey                               ← read ONLY by ResendEmailSender
```

| Level | Owns | Read by |
|---|---|---|
| **Application** | Which provider is active; sender identity, reply-to | `ProvidersModule` (selection) and `NotificationsService` |
| **Vendor** | Credentials, endpoints, vendor-specific tuning | Only that adapter |

`RESEND_API_KEY` appearing anywhere outside `providers/email/resend/` is an architecture violation and a lint error.

**Adding Zoho** adds a `ZOHO_*` block to the schema and a `zoho.config.ts` beside its adapter. `email.config.ts` gains `'zoho'` in its union. Nothing in `modules/` changes.

### Provider selection

```
EMAIL_PROVIDER=resend
MEDIA_PROVIDER=cloudinary
```

Read once, in `ProvidersModule`, to choose a `useClass` ([`PROVIDER-ARCHITECTURE.md`](./PROVIDER-ARCHITECTURE.md) §4). **No business code branches on these values, ever.** A `if (config.email.provider === 'resend')` inside a service is a red flag that means provider-specific behaviour has leaked upward.

**Conditional validation:** vendor credentials are required **only when that provider is selected**. Selecting `console` in development must not demand a Resend key.

---

## 6. Secret handling

| Rule | Detail |
|---|---|
| **Never committed** | `.env*` is gitignored; only `.env.example` (names, no values) is tracked |
| **Never logged** | Pino redaction covers `JWT_SECRET`, `MONGODB_URI`, `*_API_KEY`, `*_SECRET` |
| **Never in a response** | `/health` returns status only — no versions, no hostnames, no config |
| **Never in an error** | The global filter emits no configuration detail |
| **Platform-managed in production** | Hosting secret store; no `.env` file on a production host |
| **Rotatable** | Rotation is a config change plus a restart — no code change |
| **Minimum strength enforced** | `JWT_SECRET` ≥ 32 characters, rejected at boot otherwise |

**Startup logs the configuration *shape*, never values:**

```
config loaded  env=production  emailProvider=resend  mediaProvider=cloudinary
               mongo=connected(replicaSet)  logLevel=info
```

Enough to diagnose "which provider is live?" without exposing anything.

> This is a live concern, not a hypothetical: Phase 0 found a committed Anthropic API key in git history, a Supabase PAT in a plaintext plan document, a database password in `.mcp.json`, and a service-role key deployed to an app that never used it. The Supabase PAT has since been **revoked**, which is direct evidence that exposure here has had consequences.

---

## 7. Environment separation

Authority for the environment model: [`ENVIRONMENT-RATIFICATION.md`](./ENVIRONMENT-RATIFICATION.md) §2.

| Environment | `NODE_ENV` | Distinguishing configuration |
|---|---|---|
| Local development | `development` | `EMAIL_PROVIDER=console` · local Docker replica set · `LOG_LEVEL=debug` · Swagger on |
| Development | `development` | `EMAIL_PROVIDER=console` · **MongoDB Atlas development environment** · Swagger on. Differs from Local **only in the value of `MONGODB_URI`** |
| Test / CI | `test` | Fake providers · **ephemeral Docker Compose replica set** · logging silenced · **no Atlas credential, ever** |
| Staging | `production` | **NOT CURRENTLY PROVISIONED.** If introduced: mirrors production, including the replica set · real providers with test credentials |
| Production | `production` | **Separate Atlas environment, clean database** · platform secret store · Swagger auth-gated or disabled · `LOG_LEVEL=info` |

**One schema across all environments.** Differences are values, not shapes — so a variable that exists in production cannot be silently absent in staging.

**Environment-conditional behaviour is confined to configuration values.** Code must not branch on `NODE_ENV` to change business behaviour; only infrastructure concerns (Swagger exposure, log verbosity, provider selection) may differ. A rule that behaves differently in test is a rule that is not tested.

---

## 8. Feature flags

> **No feature-flag system in MVP.**

Phase 1 explicitly rejected feature-flag SaaS as unjustified ([`OBSERVABILITY.md`](./OBSERVABILITY.md) §10). Nothing in the roadmap requires runtime toggling, gradual rollout or A/B testing.

What *does* exist is a small set of **capability switches** that are ordinary configuration, not flags:

| Switch | Purpose |
|---|---|
| `EMAIL_PROVIDER` / `MEDIA_PROVIDER` | Provider selection |
| `SWAGGER_ENABLED` | Documentation exposure |
| `THROTTLE_ENABLED` | Disable rate limiting in tests only |

These are boot-time and infrastructure-scoped. They are **not** used to toggle business features, and adding a flag to gate a business rule requires a decision recorded in the register — otherwise flags accumulate into permanent, untested branches.

**Revisit if:** a genuine gradual-rollout requirement appears.

---

## 9. The complete variable set

Names only — this is documentation, not a `.env` file, and no `.env` file is created in this phase.

```
# Application
NODE_ENV · PORT · API_PREFIX · SITE_URL · CORS_ORIGINS

# Database
MONGODB_URI · MONGODB_DB_NAME

# Auth
JWT_SECRET · JWT_ACCESS_TTL · JWT_REFRESH_TTL · BCRYPT_ROUNDS

# Email (application level)
EMAIL_PROVIDER · EMAIL_FROM_ADDRESS · EMAIL_FROM_NAME · EMAIL_REPLY_TO
# Email (vendor level — required only when selected)
RESEND_API_KEY

# Media (application level)
MEDIA_PROVIDER
# Media (vendor level — required only when selected)
CLOUDINARY_CLOUD_NAME · CLOUDINARY_API_KEY · CLOUDINARY_API_SECRET

# Rate limiting
THROTTLE_ENABLED · THROTTLE_TTL · THROTTLE_LIMIT

# Observability
LOG_LEVEL · SENTRY_DSN · SENTRY_RELEASE

# Admin
ADMIN_ALERT_EMAIL
```

**Absent by design:** no `REDIS_URL` (deferred, ADR-REDIS-001), no payment credentials (COD only), no SMS credentials, no Supabase variables (being retired).

A tracked `.env.example` lists every name with an empty value and a one-line comment. Phase 0 found **no `.env.example` existed** despite `.gitignore` explicitly whitelisting one, so onboarding required reading `AGENTS.md` to discover required variables.

---

## 10. Testing

| Concern | Approach |
|---|---|
| Schema validation | Unit-test the schema directly: valid input parses; each invalid case reports the right error |
| Conditional vendor requirements | Assert `EMAIL_PROVIDER=console` does not require `RESEND_API_KEY` |
| Service consumption | Override the config namespace in the testing module — **never mutate `process.env`** |
| Missing variable | Assert the application fails to start |

Because configuration is injected, a test overrides a namespace with a plain object. No global mutation, no test-order dependence, no `beforeEach` cleanup of `process.env`.

---

## 11. Anti-patterns

| Anti-pattern | Why harmful |
|---|---|
| `process.env.X` outside the schema | Untyped, unvalidated, untestable — the legacy pattern |
| A god `AppConfig` object injected everywhere | Every module gains a dependency on every setting |
| Reading config in a constructor to compute a derived value | Do the derivation in the config factory |
| Business code branching on `EMAIL_PROVIDER` | Provider leakage — the exact coupling being prevented |
| Vendor credentials in an application namespace | Breaks the provider boundary; leaks vendor identity |
| Defaulting a secret (`?? 'dev-secret'`) | A weak default silently reaches production. **Secrets have no defaults.** |
| `NODE_ENV` branching in business logic | Behaviour that differs in test is behaviour that is not tested |
| A validation module that nothing imports | The precise legacy failure — safety theatre |

---

## 12. Summary

| Question | Answer |
|---|---|
| `process.env` reads | **One file** — `env.schema.ts` |
| Validation | **Zod, at boot, fail-fast, all errors reported** |
| Why Zod here but `class-validator` for DTOs | Config needs type inference; DTOs need OpenAPI generation |
| Access pattern | Injected typed namespaces; never global lookup |
| Namespace granularity | Per domain; modules inject only what they need |
| Provider selection | `EMAIL_PROVIDER` / `MEDIA_PROVIDER`, read **once** in `ProvidersModule` |
| Vendor credentials | In the provider's own config, read **only** by that adapter |
| Secrets | No defaults, never logged, never in responses, platform-managed |
| Environments | **One schema**, different values; staging mirrors production |
| Feature flags | **None** — only boot-time infrastructure switches |
| `.env` files | **Not created in this phase**; `.env.example` tracked with names only |
