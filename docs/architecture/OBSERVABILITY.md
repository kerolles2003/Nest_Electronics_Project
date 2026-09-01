# Observability & Production Requirements — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADR:** ADR-OBS-001

> **Baseline:** the legacy system has **zero** error tracking, **zero** metrics, **zero** health checks, **zero** CI/CD, **zero** tests, and **zero** deployment configuration. Everything here is new.
>
> **Constraint:** a small team, a single region, COD-only, low-to-moderate traffic. The goal is to know when something is broken and why — not to build a platform.

---

## 1. What legacy taught us about what to instrument

Phase 0.5 found three defects that had been live for months and were invisible **specifically because nothing was watching**:

| Defect | Why it stayed hidden | Observability requirement it generates |
|---|---|---|
| **Audit log completely empty** (0 rows) | The insert failed on a non-existent column; PostgREST *returned* the error, so the `catch` never fired. The admin page rendered an empty table that read as "no activity yet". | **Silent-failure alerting.** A subsystem that produces nothing must be distinguishable from one with nothing to do. |
| **Shipping with a tracking number always failed** | `EXCEPTION WHEN OTHERS` converted a real fault into `{success:false}`, indistinguishable from a business rejection | **Business rejections and infrastructure faults must be separately countable.** |
| **Reservation cron ran 35,309 times as a no-op** | It reported success every time | **Scheduled work must report units affected, not just success.** |

These shape the design below more than any generic checklist would.

---

## 2. Structured logging — REQUIRED

| | |
|---|---|
| **Library** | `nestjs-pino` (JSON to stdout) |
| **Why pino** | Both legacy apps already ship a hand-rolled JSON logger carrying a TODO to adopt pino (`storefront/lib/logger.ts:1`). This finishes that intent, in one place. |
| **Level** | `info` in production, `debug` in development, from `LOG_LEVEL` |
| **Destination** | stdout → collected by the hosting platform. **No log-aggregation cluster.** |

**Every request logs exactly one completion line:**

```jsonc
{ "level":"info","time":"2026-08-30T14:22:31.000Z","requestId":"01JC8XQZ…",
  "method":"POST","path":"/api/v1/orders","status":201,"durationMs":143,
  "userId":"652f…","role":"CUSTOMER","ip":"197.x.x.x" }
```

**Mandatory redaction** — never logged in any form:
`authorization` · `cookie` · `set-cookie` · `password` · `newPassword` · `passwordHash` · `token` · `refreshToken` · `accessToken` · `apiSecret` · `CLOUDINARY_API_SECRET` · `MONGODB_URI`

**Domain events logged at `info`** (low volume, high value): order placed · order status transition · stock adjustment · coupon redeemed · login failure · email dispatched.

---

## 3. Request correlation — REQUIRED

`X-Request-Id` is generated (ULID) if absent, propagated through an async context, and appears in:

1. every log line of that request
2. the `error.requestId` field of any error response
3. the `requestId` field of any audit record

**This is the highest-value, lowest-cost item in this document.** Legacy surfaced raw PostgREST error strings to users with no way to correlate them to anything server-side. Here, a customer's screenshot leads directly to the exact request, its logs, and its audit entry.

---

## 4. Error tracking — REQUIRED

| | |
|---|---|
| **Tool** | **Sentry** — API and both Next.js apps |
| **Why** | Zero error tracking exists today. An unhandled exception currently vanishes into stdout. |
| **Configuration** | Release-tagged (git SHA) · environment-tagged · source maps uploaded in CI · `requestId`, `userId` and `role` attached as context · PII scrubbed |
| **What is sent** | Unhandled exceptions and 5xx responses **only** |
| **What is NOT sent** | 4xx business rejections — `OUT_OF_STOCK` and `VALIDATION_ERROR` are normal operation, not errors. Sending them would bury real faults. |

That last distinction is the direct lesson of the tracking-number defect: legacy could not separate "the customer did something invalid" from "the system is broken", so a real fault hid inside a stream of soft failures for months.

---

## 5. Health checks — REQUIRED

```
GET /api/v1/health        → 200 { status:"ok" }              liveness  — process is up
GET /api/v1/health/ready  → 200 { status, checks:{ mongo, cloudinary } }
                          → 503 when a dependency is unavailable    readiness
```

Via `@nestjs/terminus`. Required by any container platform for restart and traffic-gating decisions. Neither endpoint reveals versions, hostnames or internal detail.

**`mongo` readiness must additionally assert replica-set availability**, because transactions fail on a standalone node — the failure mode that would break order placement while every other endpoint appeared healthy.

---

## 6. Metrics — REQUIRED (minimal)

> **Use the hosting platform's built-in metrics plus a small `/metrics` endpoint. Do NOT build a bespoke metrics stack.**

| Metric | Type | Why |
|---|---|---|
| `http_requests_total{method,route,status}` | counter | Traffic and error rate |
| `http_request_duration_seconds{route}` | histogram | p50/p95/p99 latency |
| `orders_placed_total{status}` | counter | **Business health** |
| `order_placement_failures_total{reason}` | counter | Separates `OUT_OF_STOCK` from `TRANSACTION_FAILED` — the distinction legacy could not make |
| `inventory_adjustments_total{type}` | counter | Would have shown that `adjust_stock_v2` had **never** succeeded |
| `audit_write_failures_total` | counter | 🔴 **Would have caught the empty audit log on day one** |
| `email_dispatch_total{status}` | counter | Silent email failure is otherwise invisible |
| `mongo_transaction_failures_total` | counter | Replica-set or contention problems |
| `auth_login_failures_total` | counter | Brute-force signal |

Exposed at `/metrics` (internal only) via `@willsoto/nestjs-prometheus`, or read from the platform if it scrapes natively.

**Explicitly not built:** custom dashboards beyond the platform default, per-user metrics, cardinality-heavy labels (never label by `userId` or `productId`).

---

## 7. Alerting — REQUIRED (small and specific)

> An alert that fires often is an alert that gets ignored. Nine alerts, each actionable.

| # | Alert | Condition | Severity |
|---|---|---|---|
| 1 | **API down** | `/health` fails 2× consecutively | 🔴 Critical |
| 2 | **MongoDB unreachable** | `/health/ready` mongo check fails | 🔴 Critical |
| 3 | **Elevated 5xx rate** | > 2% of requests over 5 min | 🔴 Critical |
| 4 | **Order placement failing** | > 10% of `POST /orders` fail (excluding `OUT_OF_STOCK`) over 15 min | 🔴 Critical |
| 5 | **Audit write failures** | any occurrence | 🔴 Critical |
| 6 | **Transaction failures** | > 5 in 5 min | 🟠 High |
| 7 | **Email dispatch failing** | > 20% failure over 30 min | 🟠 High |
| 8 | **Refresh-token reuse detected** | any occurrence (possible theft) | 🟠 High |
| 9 | **Disk / connection-pool saturation** | platform threshold | 🟠 High |

Alerts 4 and 5 exist specifically because of Phase 0.5 findings. Alert 5 is the one that would have surfaced the empty audit log immediately rather than after months.

---

## 8. Database monitoring — REQUIRED

| Capability | Source |
|---|---|
| Slow-query log | Atlas Profiler (threshold 100 ms) |
| Index-usage review | Atlas Performance Advisor — **monthly** |
| Connection-pool saturation | Atlas metrics |
| Replica-set health | Atlas + readiness check |
| Storage growth | Atlas metrics |

**Monthly index review is not optional.** Phase 0.5 found a GIN full-text index with **0 scans** (unusable by the only query that would have used it), four duplicate index pairs, and four *missing* indexes on foreign keys serving 51,128 sequential scans. All were invisible because nobody ever looked.

**A dedicated reconciliation job** (weekly) asserts the inventory invariant `Σ inventoryEvents.quantityDelta == product.stock.onHand` for every product and alerts on drift. This is the check that was **impossible** in the legacy system.

---

## 9. Deployment requirements

| Requirement | Detail |
|---|---|
| **Containerised API** | Multi-stage Dockerfile, non-root user, health check |
| **CI pipeline** | lint → type-check (**all** workspaces) → unit → integration → build. **The repository has none today**, and `apps/storefront` lacks even a `type-check` script, so `turbo type-check` covered only the admin app. |
| **CD** | *Future state — no CD exists.* Automatic to staging on merge; manual promotion to production |
| **Staging** | **NOT CURRENTLY PROVISIONED** ([`ENVIRONMENT-RATIFICATION.md`](./ENVIRONMENT-RATIFICATION.md) §2.4). If introduced: must mirror production, including the replica set, and must pass the transaction gate before it is considered ready |
| **Index creation** | Explicit, idempotent startup/CI step — never implicit `autoIndex` in production |
| **Config validation** | Fail-fast at boot on missing/invalid env. `packages/config/src/env.ts` implemented exactly this and **was never imported**, so it never ran. `CommonModule` makes it structural. |
| **Secrets** | Platform secret store. **Never** committed. A live Anthropic key is currently in git history (Phase 0 C1) and the Supabase PAT is already revoked — evidence that exposure here has had real consequences. |
| **Rollback** | Previous image redeployable in one step |

---

## 10. Explicitly NOT recommended

| Not built | Reason |
|---|---|
| **Distributed tracing** (OpenTelemetry/Jaeger) | One service. `requestId` in logs gives the same answer at a fraction of the cost. Revisit if services multiply. |
| **APM beyond Sentry + platform metrics** | Overkill at this traffic |
| **Self-hosted log aggregation** (ELK/Loki) | Use the platform's log viewer |
| **Custom dashboarding stack** (Grafana) | Platform dashboards suffice |
| **Feature-flag SaaS** | No requirement |
| **Chaos engineering / load testing in CI** | Premature; one pre-launch load benchmark is enough |
| **RUM / session replay** | Privacy cost, no current need |

Every one of these is defensible at a larger scale and wasteful now.

---

## 11. Phase mapping

| Phase | Observability deliverable |
|---|---|
| **2 — Foundation** | pino + requestId · health checks · Sentry · **CI pipeline** · config validation · Dockerfile |
| **3 — MongoDB** | Atlas monitoring · slow-query threshold · **explicit index creation step** |
| **4 — Auth** | Auth metrics · rate-limit observability · token-reuse alert |
| **6 — Commerce core** | Order/inventory metrics · transaction-failure alert · **reconciliation job** |
| **Pre-launch** | Alert routing verified · one load benchmark for a p95 baseline · **backup restore rehearsed at least once** |

---

## 12. Summary

| Capability | Decision |
|---|---|
| Structured logging | ✅ pino, JSON, stdout, redacted |
| Request correlation | ✅ `X-Request-Id` in logs, errors and audit — **highest value per unit of effort** |
| Error tracking | ✅ Sentry, 5xx only — 4xx is normal operation |
| Health checks | ✅ Terminus; readiness asserts **replica-set** availability |
| Metrics | ✅ Minimal Prometheus set, including `audit_write_failures_total` |
| Alerting | ✅ Nine specific alerts, each actionable |
| Database monitoring | ✅ Atlas + **monthly index review** + **weekly inventory reconciliation** |
| CI/CD | ✅ Required from Phase 2 — the project's first |
| Backups | ✅ Atlas continuous + PITR, **restore rehearsed** |
| Tracing / APM / log cluster / Grafana | ❌ Not justified at this scale |
