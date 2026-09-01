# Deployment Architecture — Decision Document

**Status:** RECOMMENDATION, awaiting approval · **Date:** 2026-09-01
**Nothing described here is deployed.** No account has been created, no
credential issued, no DNS record changed.

---

## 1. What is being deployed

| Component | What it is | State |
|---|---|---|
| Storefront | Next.js 16.2.4, App Router, React 19 | `/shop/*` on the API; 21 legacy pages still on Supabase |
| API | NestJS 11, Node ≥ 20 | Complete for the purchase journey; 400+ tests green |
| Database | MongoDB **replica set** | Atlas dev cluster exists |
| Email | Transactional only | Resend **and** Brevo adapters built, both unconfigured |
| Admin | Next.js, 100% Supabase | Out of scope this phase |

---

## 2. The decision that removes most of the difficulty

> **The browser never talks to the API.**

Every API call the storefront makes is server-side. `src/lib/api/client.ts` is
`server-only`, the session cookies are `httpOnly`, and every `/shop` route is a
server component or a server action.

```
Browser ──HTTPS──> Storefront (Next.js server) ──HTTPS──> API ──> Atlas
   │                        │
   └── httpOnly cookies ────┘   set by the STOREFRONT, on the STOREFRONT's domain
```

This is worth stating plainly because it deletes the three problems that
usually dominate a split frontend/API deployment:

| Usual problem | Why it does not arise |
|---|---|
| Third-party cookie blocking | The cookie is **first-party** to the storefront domain. Safari ITP and Chrome's third-party rules never see it. |
| `SameSite=None` + `Secure` juggling | `SameSite=Lax` is correct and sufficient. Nothing is cross-site. |
| CORS with credentials | No browser request ever reaches the API, so no pre-flight occurs. |

**Consequence: the API and the storefront do not need to share a domain.** They
may sit on entirely different registrable domains with no cookie impact. That
frees the choice of platform for each, independently.

**This property is load-bearing and easy to lose.** The day a client component
calls the API directly, all three problems arrive at once — and at that point
the API and storefront must share a parent domain (`api.example.com` +
`www.example.com`) with `SameSite=Lax`, or accept `SameSite=None; Secure` and
its ITP consequences. Adding `CORS_ORIGINS` is the visible signal that this
line has been crossed.

---

## 3. Options considered

| | **A. Vercel + Render** | **B. Everything on Render** | **C. Single VPS + Docker** | **D. AWS (ECS + Amplify)** |
|---|---|---|---|---|
| Next.js 16 support | Native, first-party | Good, generic Node | Manual | Amplify lags on new Next |
| NestJS support | n/a | Native | Native | Native |
| Deploy effort | Lowest | Low | Medium — you own the OS | Highest |
| Docker required | No | Optional | Yes | Yes |
| HTTPS + domains | Automatic | Automatic | Manual (Caddy/Traefik + certbot) | Manual (ALB + ACM) |
| Secrets | Per-environment UI | Per-environment UI | `.env` on a box, or a vault | Secrets Manager |
| Early-stage cost | Free → low | Low | Lowest at scale | Highest |
| Ops burden | Near zero | Near zero | **Patching, backups, uptime are yours** | High |
| Scaling path | Automatic | Slider, then autoscale | Vertical, then rebuild | Genuinely elastic |
| Region control | Function region selectable | Region per service | Full | Full |

**Rejected, with reasons:**

- **C (VPS)** — cheapest per unit and worst per hour. At this stage the team's
  scarce resource is attention, not money; a $6 VPS that needs security
  patching, TLS renewal, log rotation and a backup story is more expensive than
  a $7 managed service. Revisit when traffic makes the arithmetic flip.
- **D (AWS)** — correct at a scale this project is nowhere near. It would add
  VPCs, task definitions, load balancers and IAM to a system that currently has
  one API process. Every one of those is a thing to get wrong before the first
  customer.
- **B (all Render)** — a genuinely reasonable second choice, and the right one
  if a single vendor is preferred. It loses Next.js-specific optimisations
  (ISR, image optimisation, streaming) that Vercel does natively, and gains
  nothing this system needs.

---

## 4. Recommendation

> **A: Vercel for the storefront, Render for the API, Atlas for the database,
> and either supported email vendor — all in or near `eu-central-1` (Frankfurt).**

| Layer | Choice | Configuration |
|---|---|---|
| Storefront | **Vercel** | Build `next build`; function region **fra1** |
| API | **Render** Web Service | Region **Frankfurt**; `pnpm --filter api build` → `node dist/main.js` |
| Database | **Atlas** | Dedicated tier for production, region **eu-central-1** |
| Email | **Resend** *or* **Brevo** | Verified sending domain (SPF + DKIM + DMARC) |

### Email vendor: either, decided late

Both adapters are built and tested; `EMAIL_PROVIDER` chooses between them and
nothing else changes. The decision can therefore be deferred until someone has
actually looked at both dashboards, and reversed later without a code change.

| | **Resend** | **Brevo** (formerly Sendinblue) |
|---|---|---|
| Free tier | Low monthly volume | Higher daily allowance |
| Dependency added | `resend` SDK (~1 MB) | **none** — native `fetch` |
| Sender verification | Domain, or `onboarding@resend.dev` for owner-only smoke tests | Domain **or** a single verified sender address |
| Idempotency | First-class `Idempotency-Key` | Custom header only; **treat as best-effort** |
| Also offers | Email only | Email, SMS, contacts, CRM |

Neither is recommended over the other here, because the deciding factors are
commercial and regional (deliverability to Egyptian and Saudi inboxes, free-tier
volume, invoicing) rather than technical, and none of those can be settled from
the code. **What matters technically is that the choice is cheap to change and
cheap to reverse.**

> A domain verified with one vendor is **not** verified with the other. Switching
> means republishing SPF/DKIM records and waiting for propagation — the one part
> of a vendor switch that is not instant.

### Why Frankfurt for Egyptian and Saudi customers

The requirement is latency and reliability, not data residency. Egyptian
consumer traffic transits Mediterranean cables into southern Europe, and
Frankfurt is the best-connected European hub for that path. Bahrain
(`me-south-1`) is physically nearer Riyadh and is the better choice if Saudi
becomes the primary market; it is a slightly weaker choice for Cairo.

**The co-location that actually matters is API ↔ Atlas.** One page render makes
several API calls, and each API call makes several database round trips, so
database latency is multiplied. Putting the API and Atlas in the same region is
worth far more than moving either closer to the customer. Choosing the same
region for the storefront's server functions removes a second multiplication.

> A CDN in front of static assets is what actually shortens the *perceived*
> distance for Cairo and Riyadh; Vercel provides it without configuration.

### Approximate early-stage cost

Verify current pricing before committing — these are indicative only.

| Item | Tier | ~Monthly |
|---|---|---|
| Vercel | Hobby → Pro when a team needs it | $0 → ~$20/user |
| Render | Starter instance | ~$7 |
| Atlas | M0 free (dev) · M10 (production) | $0 → ~$60 |
| Email (Resend or Brevo) | Free tier → paid | $0 → ~$20 |

**Do not run production on Render's free tier.** It sleeps when idle, so the
first customer of the morning waits through a cold start, and MongoDB
connections are dropped and re-established on every wake.

---

## 5. Environment model

Three environments, one build artifact per component.

| | development | staging | production |
|---|---|---|---|
| `NODE_ENV` | `development` | `production` | `production` |
| `EMAIL_PROVIDER` | `console` | the chosen vendor (test domain) | the chosen vendor |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `true` | `true` | `true` (**forced**) |
| `SWAGGER_ENABLED` | default on | `true` | default **off** |
| `SITE_URL` | `http://localhost:3000` | staging storefront URL | production storefront URL |
| `CORS_ORIGINS` | empty | empty | empty (see §2) |
| Atlas | shared dev cluster | own database | own cluster |

Because `API_BASE_URL` is a **runtime** server variable rather than a
`NEXT_PUBLIC_` build-time one, the identical storefront build promotes from
staging to production unchanged. That is the whole reason for the distinction.

### Guards that make a bad deployment fail loudly

The env schema refuses to boot rather than degrade quietly:

| Condition | Result |
|---|---|
| `NODE_ENV=production` + `EMAIL_PROVIDER=console` | **Startup failure** — no mail would be delivered, so no account could ever sign in |
| `NODE_ENV=production` + `AUTH_REQUIRE_EMAIL_VERIFICATION=false` | **Startup failure** |
| `NODE_ENV=production` + `SITE_URL` on localhost | **Startup failure** — links only the deployer could open |
| A vendor selected without its API key | **Startup failure** |
| `MONGODB_URI` absent | **Startup failure** |

Every problem is reported at once, and no message echoes a secret value.

### Full variable classification

**API**

| Variable | Class | Required |
|---|---|---|
| `MONGODB_URI` | **secret** | always |
| `JWT_SECRET` | **secret** | always |
| `RESEND_API_KEY` | **secret** | when `EMAIL_PROVIDER=resend` |
| `BREVO_API_KEY` | **secret** | when `EMAIL_PROVIDER=brevo` |
| `NODE_ENV`, `PORT`, `API_PREFIX` | server-only | defaulted |
| `SITE_URL` | server-only | production-required |
| `CORS_ORIGINS` | server-only | optional (empty = closed) |
| `EMAIL_PROVIDER`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | server-only | production-required |
| `EMAIL_REPLY_TO` | server-only | optional |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | server-only | forced true in production |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `BCRYPT_ROUNDS` | server-only | optional |
| `SHIPPING_FLAT_FEE`, `FREE_SHIPPING_THRESHOLD` | server-only | optional |
| `SWAGGER_ENABLED` | server-only | optional |

**Storefront**

| Variable | Class | Required |
|---|---|---|
| `API_BASE_URL` | server-only | always |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | **public** | while legacy pages exist |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | server-only — never `NEXT_PUBLIC_` |

**Admin** — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public)
and `SUPABASE_SERVICE_ROLE_KEY` (secret).

**No secret is shared between applications.** The admin app holds no
`JWT_SECRET`, no `MONGODB_URI` and no mail credential, because it needs none —
a secret copied into an application that does not use it is simply a second
place it can leak from.

---

## 6. Health and probes

| Endpoint | Purpose | Configure as |
|---|---|---|
| `GET /api/v1/health` | Liveness — no dependencies | Render health check path |
| `GET /api/v1/health/ready` | Readiness — pings MongoDB, `503` if down | Manual / future LB |

Liveness deliberately checks nothing. If it pinged MongoDB, a database blip
would fail every instance's liveness probe simultaneously and the platform
would restart the whole fleet — converting a recoverable wobble into a
cold-start stampede against an already struggling database.

---

## 7. Deployment steps (when approved)

1. **Atlas** — production cluster in `eu-central-1`; database user; network
   access for the API's egress; connection string into Render only.
2. **Email vendor** (Resend or Brevo) — add the sending domain, publish
   SPF/DKIM/DMARC, wait for verification, mint an API key. Set `EMAIL_PROVIDER`
   and that vendor's key; the other adapter stays unused and unconstructed.
3. **Render** — Web Service from this repo, root `apps/api`, Frankfurt.
   Build `pnpm install --frozen-lockfile && pnpm --filter api build`;
   start `node apps/api/dist/main.js`; health check `/api/v1/health`.
4. **Vercel** — project rooted at `apps/storefront`, region `fra1`,
   `API_BASE_URL` pointing at the Render URL.
5. **Domains** — storefront apex/`www`; API on its own subdomain or the
   platform URL (§2: it need not be related).
6. **Smoke test** — register, receive the real email, verify, sign in, add to
   cart, place an order, receive the confirmation.

**Docker is not required** for this recommendation. If a future platform needs
it, add `output: 'standalone'` to the Next config for a substantially smaller
image; nothing else changes.

---

## 8. Known blockers and constraints

| # | Item | Impact |
|---|---|---|
| 1 | **In-memory rate limiting** | The throttler counts per process. **The API must run as ONE instance** until the limits move to Redis (`REDIS-DECISION.md` §4) — scaling to two silently multiplies every limit. This is the first thing to fix before horizontal scaling. |
| 2 | **Two databases** | `/shop` reads MongoDB; 21 legacy pages read Supabase Postgres. Both must be provisioned, and product data exists in both. A cutover needs a data decision, not just code. |
| 3 | **Admin on Supabase** | Deploys separately, needs the Supabase project alive. |
| 4 | **No email retry** | At-most-once dispatch by design (see the failure policy). A provider outage loses that notification permanently; the order is unaffected. |
| 5 | **Sending domain unverified** | Until SPF/DKIM are published for the CHOSEN vendor, mail reaches almost nobody. **Registration is unusable by real customers until this is done**, and the records are vendor-specific. |
| 6 | **No error tracking** | Failures are visible only in platform logs. Sentry integration points exist; nothing is wired. |
| 7 | **`SHIPPING_FLAT_FEE=0`** | Delivery is charged at zero and the UI says "calculated before dispatch". A business decision, not a technical one. |

---

## 9. What is explicitly NOT decided here

- Payment provider — COD only; no gateway chosen.
- CDN or WAF beyond what Vercel includes.
- Backup and restore policy beyond Atlas defaults.
- Log retention and aggregation.
- The legacy-page migration schedule.
- Whether Saudi growth should move the region to Bahrain.
