# API sandbox recipe

**Audience:** the Flutter developer, or anyone integrating against this API from scratch.
**Goal:** a working API on your machine, with a catalogue, and a way to complete email
verification without any mail ever being sent.

**Then read, in this order:** [`MOBILE-HANDOFF.md`](./MOBILE-HANDOFF.md) — every
customer screen and the calls that feed it · [`INTEGRATION.md`](./INTEGRATION.md)
— what is stable and what is not · [`openapi.v1.json`](./openapi.v1.json) — the
frozen contract your models are generated from.

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

**Then open `apps/api/.env` and replace the `JWT_SECRET` line.** Generate the value:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

```diff
- JWT_SECRET=REPLACE_WITH_A_LOCALLY_GENERATED_KEY_OF_AT_LEAST_32_CHARS
+ JWT_SECRET=<paste the output above>
```

**This step is not optional and the API will not let you skip it.** The
placeholder is 57 characters, so it used to satisfy the "at least 32" rule — and
an API that boots on it is signing tokens with a key that is in the repository,
identical on every machine that skipped the step. The schema now refuses any
value starting with `REPLACE_`, and the error tells you this command. If you see

```
JWT_SECRET: Still set to the .env.example placeholder. Generate one: ...
```

that is what it means.

The defaults in `.env.example` are already the sandbox ones. In particular:

| Variable | Sandbox value | Why |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/nest_electronics_dev` | the container above — **the development default, always** |
| `EMAIL_PROVIDER` | `console` | prints mail instead of sending it — see §5 |
| `EMAIL_FROM_ADDRESS` | `no-reply@nest-electronics.invalid` | RFC 2606 reserved; can never deliver |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `true` | matches production; see §6 to relax it |
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
pnpm --filter api sandbox:seed    # the customer you will actually use — §4
pnpm --filter api dev-admin:seed  # the admin you will actually use — §4a (DEV ONLY)
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
- Browsable contract, no server needed — [`docs/api/index.html`](./index.html), opened from disk

### Ports

Each app pins its own, so `pnpm dev` at the root starts all three without a collision.

| App | Port | |
|---|---|---|
| `apps/api` | **3002** | `PORT` in `apps/api/.env` |
| `apps/storefront` | **3000** | matches `SITE_URL`, which is what verification links are built from |
| `apps/admin` | **3001** | |

Both Next apps default to 3000, so before they were pinned the second one to start
silently moved to 3001 — or took 3000 first and left the storefront somewhere its own
verification links did not point at. The `--port` flags in each `package.json` are what
prevent that; the e2e suites ignore them and pass their own ports (3100 storefront, 3200
admin) so a test run never fights a development server for a socket.

---

## 4. The sandbox account — start here

```bash
pnpm --filter api sandbox:seed
```

One permanent, already-verified customer, with a history:

| | |
|---|---|
| **Email** | `sandbox@nest-electronics.test` |
| **Password** | `brass thermionic valve` |
| Addresses | **Home** — Cairo (default) · **Work** — Alexandria |
| Orders | one placed order, with a real order number |
| Cart | 2 lines waiting |

```bash
curl -s -X POST http://127.0.0.1:3002/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"sandbox@nest-electronics.test","password":"brass thermionic valve"}'
```

**Use this account for everything that is not specifically about signing up.**
`POST /auth/register` is capped at **3 per hour per IP**, and a developer who
re-registers while building will hit that within minutes and read the `429` as a
broken API. Nothing else here is throttled anywhere near as hard.

### Why the two addresses matter

Delivery is **50.00 EGP inside Cairo and Giza, 100.00 EGP everywhere else**
(D-8). With one address you cannot see the fee move, cannot tell a quote that
priced shipping from one that did not, and will hard-code whichever number you
happened to see. Quote against **Home** and then **Work** and both bands are
visible in a minute:

```bash
# The ids come from GET /users/me/addresses.
# Note it is a POST with a body — a quote is per-cart, and there is nothing to cache.
curl -s -X POST http://127.0.0.1:3002/api/v1/checkout/quote \
  -H "Authorization: Bearer <TOKEN>" -H 'Content-Type: application/json' \
  -d '{"addressId":"<HOME_ID>"}'
```

Cairo answers `shippingFee` 50.00 EGP, Alexandria 100.00 EGP, and **omitting
`addressId` entirely** answers `shippingPriced: false` — the third case, and the
one a client most often gets wrong. `INTEGRATION.md` has the rule.

### Resetting it

```bash
pnpm --filter api sandbox:seed -- --reset
```

Removes this account's orders, gives the catalogue back **exactly** the stock
they took, clears its cart and sessions, then rebuilds the state in the table
above. Re-running **without** `--reset` is safe and idempotent: it repairs a
changed password or an un-verified flag, and it does not add a second order or a
third address.

> The seed places its order by calling the same `CheckoutService.placeOrder`
> the HTTP layer calls, and creates the account through the real registration
> path. So the history is a real one — real pricing, a real shipping fee, a real
> stock decrement, a real inventory event — and the password above is provably
> one the API's own policy accepts.

**It refuses to run with `NODE_ENV=production`.** The password is printed in
this document; that is the point, and the guard is what keeps it local.

---

## 4a. The admin account, and how a real one is created

There are two commands here and they are **not** variants of each other. One is a
development fixture with a published password; the other is how a real member of staff
gets an account, and it has no password of its own at all.

### The development admin — local only

```bash
pnpm --filter api dev-admin:seed
```

| | |
|---|---|
| **Email** | `admin@nest-electronics.test` |
| **Password** | `copper oscilloscope probe` |
| Role | `SUPER_ADMIN` |

Same bargain as the sandbox customer in §4, and the same three fences:

- **`.test` is reserved** (RFC 2606) and unresolvable, so the address can never belong to
  a person and can never receive mail.
- **It refuses `NODE_ENV=production`**, and `StaffProvisioningService` independently
  refuses a `.test` address there — so the seed failing open would still not create this
  account in production.
- **A test asserts this document, the seed and the password policy agree**
  (`test/database/dev-admin-seed.spec.ts`), so the password printed above cannot drift
  from the one the seed sets.

Re-running repairs a drifted account — role restored, re-verified, un-deleted — rather
than duplicating it. `-- --reset` removes it and its sessions so the creation path itself
can be exercised.

Sign in at the admin app's `/admin/login`. The admin authenticates against **this API**;
it has no Supabase login.

### A real staff account — `staff:create`

```bash
pnpm --filter api staff:create --   --email operations@your-domain.com   --name "Operations Lead"   --role ADMIN
```

**There is no `--password`, and there is no default.** The command prompts for it twice,
with no echo, and creates nothing if the answer is empty or the two do not match. It
prints the email and the role it created and never a credential — not the password, not a
generated one, not a "temporary" one.

It is deliberately awkward to run:

| Guard | What it refuses |
|---|---|
| No password argument | A value in `ps`, in shell history, or in a CI log — and a thing that could be given a default |
| The password policy | Anything a customer's password would be refused for: too short, too common, containing the address |
| **The repository scan** | Any value that appears in a file in this repository — including the two passwords printed in this document |
| Typed confirmation | The account's email, name and role are printed and you must **retype the address**. A `y/n` prompt is one keystroke from an accident |
| Second super-admin | In production, a second `SUPER_ADMIN` is refused unless you pass `--acknowledge-existing-super-admin` |

The repository scan is the one worth explaining. Length rules and character classes reject
nothing that matters: the sandbox customer's passphrase in §4 is twenty-odd characters and
passes every composition rule ever written — and it is printed in this document, so every
person who can read the code already knows it. This project has already shipped a
`JWT_SECRET` placeholder that **passed its own validator** because it was 57 characters
long. A placeholder nothing rejects is a default; the only check that cannot be satisfied
by an impressive-looking string is one that asks whether the value is already written
down.

So it asks, over every file in the checkout, and a refusal names the **files** and never
the value:

```
refused (PASSWORD_IN_REPOSITORY): it appears in 2 tracked file(s) in this repository...
  found in: apps/api/src/database/seed/sandbox.seed-data.ts
  found in: docs/api/SANDBOX.md
```

If the repository cannot be read at all, the command **refuses** rather than assuming
clean — run it from a checkout. There is no flag to skip the scan, because a bypass on a
control like this becomes the documented way to run the command.

---

## 5. Email verification with no mail server

> You do **not** need this to start building — §4 hands you a verified account.
> This section is for when you are implementing the sign-up screen itself and
> need to see what a real registration does.

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
http://localhost:3000/verify-email?token=<TOKEN>
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
  in-memory, so restarting the API resets the counters — and §6 has the supported way to
  raise them for an automated run.

---

## 6. Skipping verification while you build

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

### Raising the rate limits for an automated run

Registration at 3 an hour is right for the internet and a hard ceiling for a test suite
that needs an account or two per run. Rather than restarting the API to clear the
in-memory counters:

```bash
RATE_LIMIT_RELAXED=true
```

Every declared limit is multiplied by 200 — so registration becomes 600 an hour — and
nothing else changes: the guard still runs, still keys login on IP **and** email, still
sets `Retry-After`, and still answers in the standard error envelope. The per-route
numbers are not rewritten anywhere; there is one multiplier, in
`apps/api/src/config/throttle.config.ts`.

Same two caveats as above, plus one:

1. You are testing a different ceiling from production.
2. **It cannot be set in production** — the schema refuses to boot.
3. The jest suite pins it to `false` for every suite, so the throttle stays proven
   against the real numbers in `apps/api/test/auth/auth-guards.spec.ts`. Setting this in
   your shell or in `.env` will not quieten that suite; it will fail loudly if it ever
   does take effect there.

---

## 7. Resetting

Everything, including the database:

```bash
docker compose -f docker-compose.dev.yml down -v   # -v discards the data volume
docker compose -f docker-compose.dev.yml up -d --wait
pnpm --filter api seed
pnpm --filter api indexes:sync
pnpm --filter api shipping:seed
pnpm --filter api sandbox:seed
```

Just the sandbox account's history, leaving the catalogue and your own accounts
alone — which is what you want nine times out of ten:

```bash
pnpm --filter api sandbox:seed -- --reset
```

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Conflict. The container name "/nest-electronics-mongo" is already in use` | a **second checkout** of this repo already has it up. The container name is fixed, so two working copies cannot both run it, and `down -v` from the second copy silently does nothing — it is a different compose project | stop it from whichever checkout started it, or `docker rm -f nest-electronics-mongo` |
| `JWT_SECRET: Still set to the .env.example placeholder` | §2 was skipped | §2 — generate a key and paste it into `apps/api/.env` |
| `Transaction numbers are only allowed on a replica set member` | standalone mongod, not the compose file | §1 |
| `seed category development-boards is missing` | never seeded | `pnpm --filter api seed` |
| Queries behave oddly; index assertions fail | seeded but no indexes | `pnpm --filter api indexes:sync` |
| `/health/ready` returns `503` with `checks.indexes.status: "down"` | indexes never created, or a schema changed | run the `remedy` in the response body |
| `/health/ready` is `503` but `checks.mongo` is `down` too | the database, not the indexes | §1 — `indexes` reads `not checked` in this case |
| Checkout 500s with `SHIPPING_RATE_MISSING` | `shippingRates` has no row for that governorate | `pnpm --filter api shipping:seed` |
| Delivery shows as "not calculated" in a quote | no address chosen yet — that is `shippingPriced: false`, not an error | choose an address |
| Boot fails listing env keys | a required variable is missing or malformed | read the list; values are never echoed for secrets |
| `429` on register/login | the real rate limits (§5) | wait, or restart the API — or use the §4 account, which needs neither |
| No verification link in the terminal | `EMAIL_PROVIDER` is not `console` | set it; no key needed |
| Verification link 404s in a browser | `SITE_URL` points at a storefront you are not running | you only need the `token`, not the page |

---

## Image processing: sharp has two backends

The API resizes and re-encodes every uploaded image with `sharp`, which ships a
**native** addon per platform and a **WebAssembly** fallback. Its loader tries
them in that order and reaches for WebAssembly only when the native `require`
throws, so native wins wherever it works — including CI and production. Nothing
configures this; it is the order inside `sharp/dist/sharp.cjs`.

`@img/sharp-wasm32` is an **optional dependency of `apps/api`** so that the
fallback is actually present when it is needed. It costs about 9 MB on install
and is otherwise inert.

### When you will end up on it

A machine whose OS refuses to load unsigned native code. The known case is
**Windows Smart App Control** in enforcing mode, which fails the native addon
with:

```
ERR_DLOPEN_FAILED: An Application Control policy has blocked this file
```

Without a fallback that is not a slow API, it is **no API at all** — the process
cannot start, and every test that touches an image fails with it.

### What it means for you

| | Native | WebAssembly |
|---|---|---|
| Output | identical — same libvips, byte-for-byte | identical |
| Uploads | fast | several times slower |
| Correctness | — | unchanged: dimensions, format, orientation and EXIF stripping all match |

The equivalence is asserted, not assumed: `test/media/sharp-backend.spec.ts`
runs the upload pipeline in a second process with the native addon made
unloadable and compares SHA-256 hashes of the output.

### Knowing which one you are on

The API says so on boot:

```
[MediaService] image processing: sharp native backend
```

On the fallback it warns instead, and **in production it logs an ERROR** naming
the platform package to install. It does not refuse to boot: the images are
correct, only slow, and turning a performance problem into an outage would be
the wrong trade. What must never happen is the fallback becoming the production
path silently — and it cannot.

> If you are on the WebAssembly path and do not want to be, the fix is to make
> the native addon loadable, not to remove the fallback. On Windows that means
> Smart App Control, which **cannot be re-enabled without reinstalling
> Windows** — so decide deliberately rather than as a workaround for one
> library.

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
