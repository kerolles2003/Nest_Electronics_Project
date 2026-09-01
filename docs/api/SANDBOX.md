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
pnpm --filter api seed            # 13 categories, 7 brands, 34 products (DEV ONLY)
pnpm --filter api indexes:sync    # REQUIRED — see the note below
pnpm --filter api shipping:seed   # REQUIRED — 27 governorate rates
pnpm --filter api dev
```

The three are not the same kind of command:

| | Class | If you skip it |
|---|---|---|
| `seed` | development fixtures (D-6) — **never run in production** | the catalogue is empty |
| `indexes:sync` | release step | `/health/ready` returns `503` and names what is missing |
| `shipping:seed` | release step — **business data, run it everywhere** | every checkout raises `SHIPPING_RATE_MISSING` |

`shipping:seed` installs one row per governorate (Cairo and Giza 50.00 EGP, the
other 25 governorates 100.00 EGP). There is **no default row and no fallback**, so
a governorate with no row has no price and the lookup raises rather than
inventing a fee — which is only safe because the governorate is closed to a
validated list on both sides. Re-running adds missing rows and **never overwrites
an existing one**, so it cannot silently undo a rate somebody adjusted.

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
| Checkout 500s with `SHIPPING_RATE_MISSING` | `shippingRates` has no row for that governorate | `pnpm --filter api shipping:seed` |
| Delivery shows as "not calculated" in a quote | no address chosen yet — that is `shippingPriced: false`, not an error | choose an address |
| Boot fails listing env keys | a required variable is missing or malformed | read the list; values are never echoed for secrets |
| `429` on register/login | the real rate limits (§4) | wait, or restart the API |
| No verification link in the terminal | `EMAIL_PROVIDER` is not `console` | set it; no key needed |
| Verification link 404s in a browser | `SITE_URL` points at a storefront you are not running | you only need the `token`, not the page |

---

## Media, and the shared Cloudinary account

`MEDIA_PROVIDER=memory` is the development default and needs no account: uploads
are held in the API process and the whole pipeline — sniffing, size limits, EXIF
stripping, dimension capture, the reference ledger — runs exactly as it does in
production. Only the store is different.

### The account is shared with another application

The Cloudinary account holds **108 assets belonging to an unrelated product**,
under `partners/` and `users/avatars/`. Nothing here will ever touch them:
uploads, the orphan report and every listing are scoped to `MEDIA_FOLDER_ROOT`
(default `nest`).

Two things follow, and both matter:

- **Never run a bulk delete against the account without a prefix.** The
  reconciliation report is prefix-scoped and safe; a hand-written cleanup script
  is not.
- **Give each environment its own `MEDIA_FOLDER_ROOT`.** Staging and production
  sharing one root would make each one's assets look like the other's orphans.

### Exercising the real account

```bash
pnpm --filter api test:cloudinary
```

Opt-in, and deliberately not part of `pnpm test`: these are real, authenticated,
billable calls, and running them from the default suite would upload from every
developer's machine and fail wherever there is no network.

Every upload lands under `dev-test/<runId>/` and is destroyed afterwards; the
suite asserts the prefix is empty when it finishes.

### Importing a supplier's images

```bash
MEDIA_PROVIDER=cloudinary pnpm --filter api catalogue:import -- \
  --file supplier/catalogue.csv --profile profiles/supplier.json --images
```

- Refused outright when `MEDIA_PROVIDER=memory`: the bytes would vanish with the
  process, leaving every product pointing at an asset that does not exist.
- Paths in the spreadsheet resolve **against the catalogue file**, not the
  working directory — a supplier sends one folder containing both.
- Every file goes through the same validation an admin upload does, so a `.jpg`
  that is really a PNG is refused and named in the report.
- **A product that already has images is left alone.** That is what makes a
  re-run safe; changing photographs is an admin action, not a re-import.
