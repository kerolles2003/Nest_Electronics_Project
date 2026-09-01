# API sandbox recipe

**Audience:** the Flutter developer, or anyone integrating against this API from scratch.
**Goal:** a working API on your machine, with a catalogue, and a way to complete email
verification without any mail ever being sent.

Everything below runs offline. No vendor account, no API key, no DNS, no credentials.

---

## 0. What you need

| Requirement | Version | Note |
|---|---|---|
| Node.js | ≥ 20 | |
| pnpm | ≥ 9 | `corepack enable` is enough |
| Docker | any current | for MongoDB only |

---

## 1. MongoDB — as a replica set, not a standalone

```bash
docker compose -f docker-compose.dev.yml up -d --wait
```

**It must be a replica set.** Order placement is a multi-document transaction, and a
standalone `mongod` refuses those with:

```
IllegalOperation: Transaction numbers are only allowed on a replica set member or mongos
```

The compose file runs a single-node replica set (`rs0`) and initiates it in its own
healthcheck, so `--wait` returns only once a PRIMARY exists. Authority:
`docs/architecture/CONSISTENCY-MODEL.md` §1.

To confirm the topology yourself rather than trusting the filename:

```bash
docker exec nest-electronics-mongo mongosh --quiet --eval \
  'const h = db.adminCommand({hello:1}); print(h.setName + " primary=" + h.isWritablePrimary)'
```

---

## 2. Configuration

```bash
cp apps/api/.env.example apps/api/.env
```

Then set `JWT_SECRET` to any locally generated string of at least 32 characters:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

The defaults in `.env.example` are already the sandbox ones. In particular:

| Variable | Sandbox value | Why |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/nest_electronics_dev` | the container above — **the development default, always** |
| `EMAIL_PROVIDER` | `console` | prints mail instead of sending it — see §4 |
| `EMAIL_FROM_ADDRESS` | `no-reply@nest-electronics.invalid` | RFC 2606 reserved; can never deliver |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `true` | matches production; see §5 to relax it |
| `SITE_URL` | `http://localhost:3000` | the host in the verification links you will click |

> **Never point `MONGODB_URI` at a shared or cloud database for development.**
> The test suite creates and deletes users, carts and orders. Against a shared
> cluster that risks other people's data, and an interrupted run leaves debris
> somebody else has to find. A managed cluster (Atlas) is for **staging and
> production only**. If you genuinely need it for a one-off task, set it for
> that command — `MONGODB_URI=<uri> pnpm --filter api <task>` — rather than
> editing `.env`, so it cannot leak into your next test run.

You do **not** need `BREVO_API_KEY` or `RESEND_API_KEY`. With `EMAIL_PROVIDER=console` no
vendor adapter is constructed at all, so no key is read.

---

## 3. Install, seed, index, run

```bash
pnpm install --frozen-lockfile
pnpm --filter api seed           # 12 categories, 6 brands, 26 products
pnpm --filter api indexes:sync   # REQUIRED — see the note below
pnpm --filter api dev
```

**Both `seed` and `indexes:sync` are required, and skipping the second is the classic
mistake.** `autoIndex` is off deliberately (index creation is a release step, not a side
effect of booting), so a fresh database has no indexes and behaviour that depends on them
misbehaves in ways that look like application bugs.

You no longer have to remember. **`GET /health/ready` refuses traffic when an index is
missing**, names every one of them, and prints the command that fixes it:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/api/v1/health/ready
# 200 -> indexes present   503 -> run indexes:sync
```

```jsonc
// 503 Service Unavailable
{
  "status": "degraded",
  "checks": {
    "mongo": { "status": "up", "detail": null },
    "indexes": {
      "status": "down",
      "detail": "2 of 33 declared indexes are missing or have the wrong options. Run: pnpm --filter api indexes:sync",
      "missing": ["users.user_email_unique", "orders.order_idempotency_key_unique"],
      "unexpected": [],
      "remedy": "pnpm --filter api indexes:sync"
    }
  }
}
```

Run `indexes:sync` and the **next** probe is green — there is no cache and no restart needed.

Check it is alive:

```bash
curl -s http://127.0.0.1:3002/api/v1/health | head -c 200
```

Liveness stays `200` throughout, including while readiness is `503`. That is deliberate:
restarting a process cannot create an index, so a missing index must drain traffic without
triggering a restart loop.

- Swagger UI — <http://127.0.0.1:3002/api/v1/docs>
- OpenAPI JSON — <http://127.0.0.1:3002/api/v1/docs-json>
- Frozen artifact — [`docs/api/openapi.v1.json`](./openapi.v1.json) ← **build against this one**

---

## 4. Email verification with no mail server

`EMAIL_PROVIDER=console` runs the *entire* pipeline — template compilation, strict variable
resolution, data mapping, the port call — and replaces only the final network hop. A missing
template variable therefore fails on your laptop rather than in production.

Register a user:

```bash
curl -s -X POST http://127.0.0.1:3002/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"fullName":"Sandbox User","email":"you@example.test","password":"brass thermionic valve"}'
```

Now look at **the API's terminal output**. The console sender prints the plain-text body,
which contains a clickable verification URL:

```
http://localhost:3000/shop/verify-email?token=<TOKEN>
```

Take the `token` query parameter and post it:

```bash
curl -s -X POST http://127.0.0.1:3002/api/v1/auth/verify-email \
  -H 'Content-Type: application/json' \
  -d '{"token":"<TOKEN>"}'
```

Then `POST /auth/login` works and returns your token pair.

Notes that will save you time:

- **Registration returns no session.** That is intentional, not a bug — verify first.
- Tokens are **single-use**. Replaying one returns `400 VALIDATION_ERROR` with
  `details[0].message` = `verification token is invalid or has expired`. Read the *detail*,
  not the top-level `message`, which is only the category `Validation failed.`
- `POST /auth/resend-verification` answers identically for known and unknown addresses, on
  purpose: anything else is an account-existence oracle.
- **Rate limits are real in the sandbox.** `register` is **3/hour per IP** and `login` is
  **5 per 15 minutes**. If you are scripting sign-ups you will hit these. The throttler is
  in-memory, so restarting the API resets the counters.

---

## 5. Skipping verification while you build

If clicking through verification on every run is slowing you down:

```bash
AUTH_REQUIRE_EMAIL_VERIFICATION=false
```

`POST /auth/login` then succeeds for an unverified account.

Two things to know:

1. **You are now testing a different flow from production.** Turn it back on before you
   believe anything about your sign-up UX.
2. **It cannot be set in production.** The env schema refuses to boot with
   `NODE_ENV=production` and this set to `false` — the escape hatch cannot escape.

---

## 6. Resetting

```bash
docker compose -f docker-compose.dev.yml down -v   # -v discards the data volume
docker compose -f docker-compose.dev.yml up -d --wait
pnpm --filter api seed && pnpm --filter api indexes:sync
```

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Transaction numbers are only allowed on a replica set member` | standalone mongod, not the compose file | §1 |
| `seed category development-boards is missing` | never seeded | `pnpm --filter api seed` |
| Queries behave oddly; index assertions fail | seeded but no indexes | `pnpm --filter api indexes:sync` |
| `/health/ready` returns `503` with `checks.indexes.status: "down"` | indexes never created, or a schema changed | run the `remedy` in the response body |
| `/health/ready` is `503` but `checks.mongo` is `down` too | the database, not the indexes | §1 — `indexes` reads `not checked` in this case |
| Boot fails listing env keys | a required variable is missing or malformed | read the list; values are never echoed for secrets |
| `429` on register/login | the real rate limits (§4) | wait, or restart the API |
| No verification link in the terminal | `EMAIL_PROVIDER` is not `console` | set it; no key needed |
| Verification link 404s in a browser | `SITE_URL` points at a storefront you are not running | you only need the `token`, not the page |
