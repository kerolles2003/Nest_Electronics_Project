# HANDOFF — overnight session, 2026-09-01 → 02

**Short version:** the interrupted Phase 0 run had actually finished all of its commits and
committed **no secrets**. I verified that, tagged the baseline, and then completed Tasks 2–5
on a branch. Everything is committed and **nothing is pushed**.

- `main` → **`6d0673a`**, tagged **`baseline-phase-0`**. Phase 0 only.
- `phase-1-2-overnight` → **`0908721`**, 10 commits. Tasks 2, 3, 4 and 5.
- Working tree clean. 22 commits unpushed. **No history was rewritten. Nothing was reverted.**

Tests: **541/541 jest** (was 527), **4/4 Playwright** (was 2, and neither checked the browser
for errors). Root `install --frozen-lockfile` / `type-check` / `lint` / `build`: green.

---

## 1. What happened to the interrupted Phase 0 run

**It got further than the brief assumed.** I found a clean working tree, no stash, no
branches, no partial index, and **every commit Phase 0 set out to make already in history** —
11 of them, in coherent conventional-commit form, with junk removal correctly isolated in its
own commit (`d3fba04`).

What it had **not** done: the verification pipeline, and the tag.

**Secret scan — clean, checked on contents, not filenames.** I diffed all 11 commits (81,825
lines) against patterns for Brevo/Resend/SendGrid/Stripe/AWS/GitHub/Google keys, JWTs, private
keys and credential-bearing Mongo/Postgres URIs. Two hits, both placeholders (a commented
`YOUR_USER:YOUR_PASSWORD` line in `.env.example`, and a docs table describing an
env-validation test case). `git log --all --diff-filter=A` confirms **no `.env` file has ever
been added on any ref**. Every real `.env` is gitignored; only `.env.example` files are
tracked, and their contents are placeholders.

**One correction to the brief, and the previous run got it right.** The brief lists
`/auth/callback` as orphaned junk to delete. It is **not orphaned** — I verified independently
that `apps/storefront/src/app/auth/callback/route.ts` is the Supabase OAuth `redirectTo` for
three live callers (`login/form.tsx:69`, `register/form.tsx:66`,
`forgot-password/form.tsx:34`). Deleting it would break Google sign-in. Kept.

---

## 2. What is done

### Task 1 — Phase 0 finished ✅

| | |
|---|---|
| `6d0673a` | `docs(work-log)` — state recovery + verification recorded |
| tag `baseline-phase-0` | on `6d0673a` |

All four pipeline steps green at the baseline; no code fix was needed.

### Task 2 — PLAN.md corrections ✅ (one commit, docs only)

**`36f20e4`** — all four, plus a new §26 changelog (old one renumbered to §27, every moved
cross-reference repaired). Every edit was applied by an assertion-checked script requiring
exactly one match, so nothing was half-applied.

- **2a media → Phase 4**, build only, ships empty, admin UI stays in Phase 7, Phase 8's
  blog-cover dependency noted as satisfied earlier. (§12, §13, Phases 4/7/8)
- **2b shipping → the frozen shape wins.** Adopted `shippingRates[].fee` /
  `{governorate:1}` unique from `MONEY-MODEL.md` §6 + `MONGODB-DESIGN.md` §11; the plan's
  `shippingRules {governorates[], fee, isDefault}` sketch is **withdrawn**. Consequence
  recorded: the D-8 rule is **27 rows, not two**. (§3, §9, §12, §20, Phase 5, Phase 7, D-8)
- **2c `shippingFee === 0` → decided in Phase 2**, before the Phase 3 freeze.
  (§19, §20, Phases 2/3/5, F-13, open question 2)
- **2d catalogue timing** — import tool stays in Phase 4, "may be pulled forward" removed,
  spec changed to a declarative column-mapping profile, **§25 risk 3 escalated to risk 1**,
  §23 item 11 made unambiguous. (§23, §25, Phase 4)

**No file under `docs/architecture/` was edited.**

### Task 3 — Phase 1, email correctness ✅ (one commit per item)

| Commit | Item |
|---|---|
| `f0da7e1` | **F-07** — every suite isolated from live vendors |
| `62dbbca` | **F-02** — Resend-sandbox sender default replaced + production guard |
| `08788f8` | **F-10** — outcome-based logging |
| `d3cb8e8` | **F-11** — validation detail shown instead of the category |

**Acceptance met:** full jest run green with **zero vendor calls** (the guard never tripped;
run time also fell 214s → ~102s, consistent with ~225 eliminated network round-trips); a
failed send logs `NOT sent`; a replayed token produces the token-specific message, and the API
contract that guarantees it is now asserted in `auth-flow.spec.ts`.

**Nothing from Phase E was touched** — no Brevo key, no DNS, no sender domain.

### Task 4 — Phase 2, crash class + CI truthfulness ✅ (one commit per item)

| Commit | Item |
|---|---|
| `322f0ea` | **F-05** — proxy never redirects a `Next-Action` POST; both trigger sites hardened |
| `b22359d` | **F-15 / F-16** — CI seed **+ indexes:sync**; explicit `API_BASE_URL` |
| `a14f50e` | **F-14** — browser-health fixture + new guest-cart→login spec |
| `a7009c1` | **2c** — `shippingPriced` implemented end to end |

**Curl probe passes**, with controls proving the guard was narrowed rather than removed:

| Case | Result |
|---|---|
| `GET /checkout`, no session | 307 → `/login` ✅ guard intact |
| `POST /checkout`, no `Next-Action` | 307 → `/login` ✅ guard intact |
| `POST /checkout` **with** `Next-Action` | **404 action-not-found — no redirect** ✅ |

### Task 5 — Phase 3, contract freeze ✅

**`0908721`** — `docs/api/openapi.v1.json` (37 paths, 43 operations, 84 schemas), a separate
CI `contract-gate` job, `docs/api/SANDBOX.md`, `docs/api/INTEGRATION.md`.

I ran the gate against four deliberately corrupted artifacts and confirmed each outcome:
clean → exit 0; removed path → BREAKING; newly-required property → BREAKING; purely additive
→ "artifact is stale" with the regenerate command. Restored → exit 0.

---

## 3. What is NOT done

- **Phase E** — untouched by instruction. No Brevo key, no sender domain, no DNS, no
  deliverability testing. Still the long-lead item that blocks go-live.
- **Phases 4–11** — not started. Out of scope for tonight.
- **The `shippingRates` collection itself** — Task 2b was a *documentation* correction. No
  collection, no seed, no `FulfilmentService` lookup was built; that is Phase 5 work. (The
  ratification that used to block it is now settled — §4 item 1.)
- **No unit test for `customerMessage()` (F-11).** The storefront has **no unit-test runner**
  at all — Playwright only — and adding jest/vitest to it is well outside Phase 1. The API
  half of that contract *is* asserted. The browser half belongs to the existing verify-email
  Playwright spec.
- **`AUTH_REQUIRE_EMAIL_VERIFICATION=false` in the e2e config** is unchanged. It is a known
  gap (§20 item 4, "real-verification e2e"), scheduled for Phase 10, and not tonight's task.
- **Playwright is still not part of `pnpm test`** and is not in CI. That was already true and
  is deliberate (it needs three moving parts); I did not change it. The new specs must be run
  manually — see §7.

---

## 4. Needs owner — decisions I would not make for you

1. ~~**Ratify the shipping default-rate extension (blocks Phase 5).**~~ — **RESOLVED
   2026-09-02.** You ratified **27 seeded `shippingRates` rows, one per governorate, with no
   default row, no fallback and no sentinel**; a lookup miss **raises**. No frozen document is
   amended, so the `"*"` extension I proposed is **withdrawn, not approved**. Recorded in
   PLAN.md §3, D-8, Phase 5, Phase 7 and changelog 26e. **Phase 5 is unblocked.**

2. **`apps/api/.env` points `MONGODB_URI` at a live MongoDB Atlas cluster with an embedded
   password.** The file is gitignored and has never been committed — I checked. But I
   deliberately **did not run the 527-test suite against it**; a suite that creates and
   deletes users, carts and orders should not run unattended against a shared cloud database.
   Everything tonight ran against local Mongo, which is what CI does. **Consider whether that
   Atlas URI should be the dev default at all.**

3. **Confirm `no-reply@nest-electronics.invalid` as the placeholder sender.** I needed a
   value that cannot possibly deliver and refused to invent a real domain. `.invalid` is
   RFC 2606 reserved. Your real sender arrives with Phase E.

4. **`SHIPPING_FLAT_FEE` no longer has a default.** Absent now means "no rate supplied"
   (unpriced); an explicit `0` means "delivery is free". **Customer-visible amounts are
   unchanged** — an unset value still charges nothing. Flagging it because it is a config
   semantics change, and any deployment relying on the old implicit `0` should set it
   explicitly.

5. **Cloudinary credentials are now needed one phase earlier** (Phase 4, not 7), because 2a
   moved the upload API forward. Without them the endpoint can be written and unit-tested but
   not integration-proven.

6. **A sample supplier catalogue file** is the single most useful thing you can produce early
   (now §25 risk 1). Not the whole catalogue — one representative file, so the Phase 4 import
   tool is built against a real column layout instead of an assumed one.

---

## 5. Things I broke, changed, or want you to double-check

**Nothing was reverted and nothing is known-broken.** Full disclosure of everything else:

- **I fixed a bug in my own F-07 guard, mid-task.** My first version also deleted
  `BREVO_API_KEY`/`RESEND_API_KEY` and asserted they stayed deleted. My own bootstrap test
  caught that this is false: `@nestjs/config`'s `forRoot()` runs at *import* time and reloads
  `.env`, restoring them. I removed the deletes rather than weakening the assertion — a
  `delete` that reads as protection while providing none is worse than none — and documented
  the measured reason. Isolation now rests only on the two guarantees `.env` cannot undo.

- **The browser-health fixture ignores one thing globally:** the Next dev-server HMR
  WebSocket error (`_next/webpack-hmr`). On its first run it failed all four specs on **24
  problems that were every one that same error, and not one application error**. That channel
  does not exist in a production build. Scoped to the HMR URL, not to WebSocket errors
  generally. **Worth a second opinion** — an ignore list is how a health check quietly stops
  checking things.

- **I changed a contract other packages read**: `FulfilmentService.quote()` returns
  `{fee, priced}` instead of a number, `OrderPricing` gained `shippingPriced`, and it is
  persisted on the order snapshot. Type-checked, and the invariant assertions still hold, but
  this is the highest-blast-radius change of the night.

- **Existing orders have no `shippingPriced`.** The schema defaults it to `false` and the DTO
  coerces `?? false`. That is the truthful reading (no rate had been supplied then), but it
  means old orders report "not priced" — correct, and worth knowing.

- **I did not kill your `next dev` on port 3000.** Next 16 refuses a second dev server for
  the same directory, so I pointed Playwright at yours via `E2E_PORT=3000`. It is still
  running. **I did restart the API on 3002 twice** (Playwright starts it; it holds an
  in-memory rate limiter — see below).

- **One intermediate Playwright run failed and it was not a regression.** The journey stalled
  at sign-in. I checked instead of assuming: `register` is capped at **3/hour per IP** and the
  throttler is in-memory, so my repeated runs had exhausted it. Restarting the API reset it
  and all 4 passed. **You will hit this too** — it is documented in `SANDBOX.md`.

- **I started Docker Desktop** (it was not running) and left the `nest-electronics-mongo`
  container up. Test databases created and left behind: `nest_electronics_baseline`,
  `nest_ci_proof_*`, `nest_final_*`. All local and disposable;
  `docker compose -f docker-compose.dev.yml down -v` clears everything.

- **I edited your gitignored local env files** (not committed): `apps/api/.env` →
  `EMAIL_PROVIDER=console` + placeholder sender (your `BREVO_API_KEY` left in place for
  Phase E); `apps/storefront/.env.local` → added `API_BASE_URL`.

---

## 6. Test state

| | Before | After |
|---|---|---|
| jest suites | 19 | **20** |
| jest tests | 527 | **541**, all green |
| Live vendor calls per run | **225** | **0** (asserted, not assumed) |
| jest run time | 214s | ~102s |
| Playwright specs | 2 | **4**, all green |
| Playwright error checking | **none** | fails on pageerror / unhandled rejection / console.error / unexpected 5xx |
| root type-check / lint / build | green | green (lint: 0 errors, 57 pre-existing warnings) |
| OpenAPI drift gate | did not exist | green |

**The 527 baseline was not free.** From a fresh database the suite is **333 failed / 194
passed**; after `seed` it is still **19 failed / 508 passed**; only after `indexes:sync` is it
green. **This is a real correction to F-15** — the planned CI fix was seed-only and would have
left CI red. CI now runs seed **and** `indexes:sync`, and I proved the full sequence against a
brand-new database.

---

## 7. Suggested first three things in the morning

1. **Read §4 item 1 and decide the shipping default-rate representation.** It is the only
   thing in this handoff that blocks the next phase, it takes about five minutes, and Phase 5
   cannot start honestly without it.

2. **Review `a7009c1` (the `shippingPriced` change) before anything else builds on it.** It is
   the widest-reaching change of the night — a service signature, the persisted order
   snapshot, and three API response DTOs. It is also now frozen into the v1 contract, so this
   is the cheap moment to disagree with it.

3. **Run the suite yourself and read `docs/api/INTEGRATION.md` as if you were the Flutter
   developer:**
   ```bash
   docker compose -f docker-compose.dev.yml up -d --wait
   pnpm --filter api seed && pnpm --filter api indexes:sync
   MONGODB_URI="mongodb://127.0.0.1:27017/nest_electronics_dev" pnpm --filter api test
   cd apps/storefront && E2E_PORT=3000 npx playwright test
   ```
   Then, when you are happy: `git push origin main --tags` and push the branch. **I pushed
   nothing.**

---

# ADDENDUM — session 2 (adversarial verification of `a7009c1` + three corrections)

Branch `phase-1-2-overnight`, 8 further commits. Still **nothing pushed**.
Tests: **541 → 563 jest** (20 → 22 suites), **4/4 Playwright**, root pipeline green.

## Verification verdict on `a7009c1`

The core of the change is **sound**: only two production call sites, both destructuring
`.fee`/`.priced` immediately, no spread/interpolation/object-leak path; money integer and the
`items − discount + shipping` formula holding across quote, placement, detail, history **and**
the persisted document, proven live in all three shipping states; the persisted snapshot
correctly wins over a changed configuration; and a pre-change document (field `$unset` in
Mongo) reads back as a plain `false`.

**But it was incomplete, and one of my own tests was fake.** Five findings:

| # | Severity | Finding | Fixed |
|---|---|---|---|
| 1 | **high** | `/shop/orders/[id]` printed `shippingFee.formatted` unconditionally → every order today rendered "Delivery 0.00 EGP", i.e. *free*, when it was never priced. A **third** consumer the commit missed. | ✅ `7343c38` |
| 2 | medium | The order email had no "Free" state → a priced zero emailed "0.00 EGP" while checkout said "Free". | ✅ `9360368` |
| 5 | medium | **My own previous test was vacuous**: `expect(text).toContain('0.00 EGP')` always passed, because the total renders "650.00 EGP" which *contains* that substring. It tested nothing. | ✅ `9360368` |
| 3 | medium | `shippingPriced` was asserted **nowhere** at the HTTP boundary, and integration suites only ever saw `false`. A boolean observed in one state is untested. | ✅ `34ce853` |
| 4 | low | The documented invariant "`priced:false` always carries `fee:0`" was never asserted, contrary to MONEY-MODEL §7.1. | ✅ `7c420d3` |

**Reported, not fixed** (judgement calls): `CheckoutForm`'s `amount === 0` is *guarded by*
`shippingPriced` and selects "Free" vs the amount — not a semantic inference, kept. Legacy
Supabase `shipping_fee` paths are a different data source scheduled for deletion (D-6).

## Corrections

- **B1 `0d66bad`** — dev now defaults to the local Mongo replica set. The Atlas URI is kept,
  commented, and labelled staging/production-only. `.env.example` and `SANDBOX.md` say why.
- **B2 `7590bf3`** — the health fixture counts every suppression by rule and a reporter prints
  the total at the end of each run. First run: **"ignored 20 browser problem(s) across 4
  test(s) — 20 `/_next\/webpack-hmr/`"**, previously invisible.
- **B3 `48985c8`** — governorate is a closed list. The API accepted **free text**; the `/shop`
  address form was a **free-text input**. Both fixed; the legacy page was already correct and
  admin has no address form. `apps/api` keeps its own copy of the list (it has zero workspace
  dependencies, worth preserving) with a test that reads `packages/config` as text and fails
  on any drift.

## New for the owner

1. **The drift gate reports "additive" for a domain narrowing.** Constraining `governorate`
   to an enum is shape-compatible, so the gate passed it — but a client sending `"cairo"` now
   gets a 400. "Additive" from this gate means *shape-compatible*, not *no client breaks*.
   Tightening it is a judgement about how noisy it should be.
2. **The `shippingRates` default-rate ratification is still open** and still blocks Phase 5
   (§4 item 1 above). B3 was the input validation that makes the no-fallback design *safe*;
   it does not decide it.

---

Full narrative, with the measurements behind every claim, is in **`WORK-LOG.md`**.

---

# SESSION 3 — housekeeping, then Phase 4

## Read this first

**Phase 4 is done.** The media upload API, the catalogue import tool and the T1
read migration all landed. Everything is on `phase-1-2-overnight`, unpushed.

**Three things need you.** Nothing is blocked waiting for them except where said:

1. **The Cloudinary account (D-4) is still not supplied.** The brief said the
   credentials were in `.env`. They are not, anywhere in the repository. The
   upload API is built and tested against an in-memory store; the Cloudinary
   adapter is written to the SDK contract but **has never made a real call**.
   Product images will not display until this arrives — the storefront renders
   its placeholder, correctly, everywhere.
2. **"Featured" on `/products` is now a filter, not a sort.** `featured` is not
   in the frozen sort enum (`SEARCH-MODEL.md` §5). Clicking it now shows the 8
   featured products rather than reordering all 34. Restoring the old meaning
   means adding a value to a frozen contract — your call.
3. **A blank 404 page, pre-existing.** A customer visiting a dead product,
   brand or category link sees the header, the footer, and nothing between. See
   §"Found, measured, not fixed" below.

---

## Part 1 — housekeeping

### 1a — the vacuous-assertion sweep

Audited **all 172** substring assertions across jest and Playwright. **Seven**
could be satisfied by a different value in the same document; all seven are
fixed. The worst was the same shape as the one you found: the discount
assertion `toContain('50.00 EGP')` was satisfied by the line total
`650.00 EGP`, so the Discount row could be deleted entirely and the test still
passed.

**Verified by breaking the templates, not by reading them.** Deleting the
Discount row, the Subtotal row, or every line total was invisible to all three
old assertions and is caught by exactly one new test each.

Also found: `admin-orders.spec.ts` checked index usage against the *whole*
explain output including `queryPlanner.rejectedPlans`, so a regression to a
different index passed. Its own sibling in `orders-read.spec.ts` already scoped
to `winningPlan`.

### 1b — D-8 ratified

Recorded in `PLAN.md` §3, D-8, Phase 5, Phase 7 and changelog **26e**; the open
item is struck from §4 below. **No frozen document was amended** — by rejecting
the premise rather than the proposal, you removed the need for the amendment.
**Phase 5 is unblocked.**

### 1c — the drift gate's blind spot

`docs/api/INTEGRATION.md` now states plainly what the gate does not catch — enum
narrowing, tightened validation, changed meaning, newly-enforced constraints —
with the governorate narrowing as the worked example, plus a contract-policy
checklist item requiring any PR touching an enum, a validator or a field's
meaning to state the client impact. The same warning sits on the CI step.

---

## Part 2 — Phase 4

### What shipped

| | |
|---|---|
| **Media upload API** | `POST` / `DELETE /admin/media`, orphan reconciliation report, `mediaAssets` reference ledger. Ships **empty**. Admin UI stays Phase 7. |
| **Catalogue import tool** | `pnpm --filter api catalogue:import`, declarative mapping profiles, `--dry-run`, per-run report. Documented for a non-developer in **`docs/api/CATALOGUE-IMPORT.md`** — read that one when the supplier file arrives. |
| **T1 routes** | `/`, `/products`, `/products/[slug]`, `/categories`, `/categories/[slug]`, `/brands/[slug]`, `/search`, navbar tree, sitemap. **No Supabase import remains in any of them.** |
| **Dev seed** | 26 → **34 products**, 12 → 13 categories, 6 → 7 brands. |

### Why the seed grew

Four states your pages render were **unreachable** from the old seed, so the
migration could have broken any of them and still looked correct: no product had
*any* image (so the gallery and thumbnail strip were dead code), every product
had reviews, every brand stocked something, and the category tree was two levels
everywhere. The seed is test infrastructure, not business data (D-6).

### The bug that mattered most

`apiFetch` sent `cache: 'no-store'` **and** `next: { revalidate }` together.
They are opposite instructions, `no-store` wins, and **`revalidate` had never
once taken effect** anywhere in the storefront. It cost nothing until the navbar
put such a call in the root layout — at which point `next build` could no longer
prerender `/account`, `/blog` or `/_not-found`, pages with nothing to do with
the catalogue. Fixed; `/categories` is static again with a 5-minute revalidate.

### A bug the migration exposed rather than caused

**No subcategory has ever appeared in the mobile menu.** `MobileMenu` is written
against a flat category list; the legacy service returned a nested tree, where
its check is false for every category. Giving each consumer the shape its own
code reads fixes it. This is a visible change on mobile — flagged, not hidden.

### Security fix found on the way

**`dangerouslyAllowSVG: true` was set in both `next.config.ts` files.** SVG is
executable markup and one served from a whitelisted image host is a stored-XSS
vector; `MEDIA-MODEL.md` §5/§12 require its removal. Nothing rendered an SVG
through `next/image`, so removing it cost nothing.

### Six correctness fixes, each in the page that had it

- the sitemap asked for `limit: 5000`; **the API caps at 100** — transplanted
  unchanged it would have produced an empty sitemap and an error nobody watches
- the sitemap mapped over the category *tree*, silently omitting all seven
  subcategories
- the price-slider bounds came from the current *page*, so page 2 offered a
  different range from page 1
- related products fetched five and filtered client-side, so the row varied
  between four and five items
- the image gallery re-sorted with a comparator that ignores its second
  argument, so the order depended on the JavaScript engine
- JSON-LD listed images with no URL, which crawlers report as invalid

### Found, measured, and deliberately NOT fixed

**`notFound()` on a streaming route renders a blank page.** Measured side by
side in one browser session:

```
/this-route-does-not-exist         404  main=112 chars  h1=["Page Not Found"]
/products/definitely-not-real      200  main=0          h1=[]   <- UN-MIGRATED
/brands/not-a-real-brand           200  main=0          h1=[]   <- migrated
/categories/does-not-exist-at-all  200  main=0          h1=[]   <- migrated
```

The **un-migrated** route behaves identically, so this predates the migration.
Next documents the 200 (streamed responses cannot change status) and applies its
own mitigation — the `noindex` tag is present, so nothing is indexed. The blank
body is separate. Both remedies (remove the root `loading.tsx`, or check
existence in `proxy.ts` before the body streams) are decisions with costs, so
they are yours rather than mine.

---

## The three things worth doing next

1. **Get the Cloudinary account.** It is the only thing standing between the
   media pipeline and being proven, it now blocks Phase 7's upload UI as well as
   Phase 8's blog covers, and it is the difference between a catalogue with
   photographs and one without.
2. **Fix the blank 404.** It is the one defect in this report a customer meets
   directly, it is cheap either way, and it is currently invisible because the
   page returns 200.
3. **Run `indexes:sync` after any fresh database.** This session opened with 19
   red tests and a clean tree; every application index had vanished from the dev
   database. `autoIndex` is off by design, so an index-less database is a silent
   state — the API starts and serves traffic, and only the tests notice. CI does
   this already; a developer's machine does not.

---

# SESSION 4 — Phase 5a (additive only)

**Nothing was cut over.** `/login`, `/register`, `/forgot-password`,
`/account/*`, `/checkout`, the cart UI, the proxy and `/shop` are exactly as you
left them. Everything below is additive and on `phase-1-2-overnight`, unpushed.

**jest 800 passed / 15 skipped (815). Playwright 44. Build, type-check, lint and
the drift gate green.** The 15 skipped are the Cloudinary suite, which is opt-in.

---

## What needs you

### 1. ~~The password-reset paths contradict a frozen document~~ RESOLVED

**Fixed in the 5b cleanup.** The endpoints are now `POST /auth/forgot-password`
and `POST /auth/reset-password`, as `AUTHORIZATION-MODEL.md` §2.8 specifies.
`PLAN.md` §9 named them wrongly and has been corrected at the source; the
behaviour never changed.

The rename was a **breaking** contract change and the gate reported it as one.
Accepted because nothing consumes them — verified, not assumed: `/forgot-password`
still calls Supabase. That window closes the moment 5b wires the page up.

### 2. ~~A shipping-rate row may carry its own free-shipping threshold~~ WITHDRAWN

**Removed in the 5b cleanup.** The column and the precedence rule were both
mine and neither was specified; nothing set the column, nothing read it and
nothing tested the rule. `MONGODB-DESIGN.md` §11's "Governorate → fee,
free-shipping threshold" is a purpose summary, not a field list.

The threshold is global configuration and still off, so **no order is free**.
Per-governorate free shipping remains a reasonable later feature — it needs a
written rule before a column, and PLAN Phase 5 says what the rule has to answer.

### 3. The Cloudinary account is shared with another application

It holds **108 assets that are not this shop's** — `partners/images/…` and
`users/avatars/…`.

Nothing here can reach them: every upload, listing and orphan report is scoped
to `MEDIA_FOLDER_ROOT` (default `nest`). Two consequences:

- **Never run a bulk delete against that account without a prefix.** The
  reconciliation report is safe; a hand-written cleanup script is not.
- Decide whether this shop should have its own account before it holds real
  product photographs.

### 4. The blank 404 body is 5b's

The status is fixed — every dead link now answers `404` instead of `200`. The
BODY is still empty, and that half cannot be fixed from inside a page. See below.

---

## The five things that landed

### Readiness now refuses traffic when an index is missing

`GET /health/ready` returns `503`, names every missing index and prints
`pnpm --filter api indexes:sync`. Liveness stays green, because restarting
cannot create an index.

**It found a real defect on its first run:**
`mediaAssets.media_asset_public_id_unique` — a UNIQUE index — was simply absent
from the development database. It had been since the media ledger landed.

This matters more than test noise. `CredentialRepository` and `CartRepository`
both catch MongoDB error `11000` and translate it, and **that is their entire
concurrency control**. No index, no error, no `catch`, and the race silently
succeeds: two accounts on one email, a retried checkout becoming two orders, one
order line decrementing stock twice.

### Shipping rates, the D-8 model

27 rows, Cairo and Giza 50.00 EGP, the other 25 at 100.00 EGP. No default row,
no fallback, no sentinel — **a miss raises**, as a 500, because the governorate
is validated on both sides so a miss means bad data rather than bad input.

`pnpm --filter api shipping:seed` is a **release step, like `indexes:sync`** —
with no fallback row, an empty collection means every checkout in the country
raises. It adds missing rows and never overwrites an edited one.

`SHIPPING_FLAT_FEE` is **removed, not deprecated**: a knob nothing reads
survives in deployment manifests until somebody sets it and nothing explains the
silence.

Checkout now quotes a real fee. Three states, and the middle one is easy to
conflate: a governorate with a row is priced, **no address chosen yet is
unpriced** (an ordinary step of checkout, not an error), and a governorate with
no row raises.

### Password reset and profile update

The three endpoints G-01 listed as blocking T2. A reset **signs the account out
everywhere** — `tokenVersion` bump plus full refresh-token revocation, in one
transaction with the credential change, because a reset that leaves an
attacker's refresh token alive has not reset anything.

The reset token lives in a **separate field** from the verification token, with
a separate lookup. Both are a hash and a date, so nothing in the type system
tells them apart; without the separation, an email-verification link would be a
password-reset link. Tested in both directions.

`PATCH /users/me` writes `fullName` and `phone` only. `role`, `email` and every
credential field return `400 UNKNOWN_FIELD` — refused, not ignored.

### The 404 — status fixed, body measured

Every dead product, category and brand URL answered **200**. A soft 404:
indexable, counted as a successful page view, invisible to monitoring.

Fixed by removing the `loading.tsx` boundaries above the existence check. The
products listing kept its skeleton by moving into a `(listing)` route group —
the URL is unchanged, because a route group is not a path segment.

**The body is still empty**, and this is the honest part. Measured across every
route and every way `notFound()` can be reached:

```
how notFound() is reached                     status   designed page
URL matches no route at all                     404     RENDERED
thrown synchronously, before any await          404     RENDERED
thrown after an await, no loading.tsx above     404     empty
thrown after an await, loading.tsx above        200     empty      <- was here
thrown from generateMetadata after an await     404     empty
```

A data-driven 404 must ask the API whether the thing exists, so it always
awaits. Next's own docs say to place `notFound()` "before any `await` that may
suspend" — which this cannot obey. **The remedy is the existence check in
`proxy.ts`, which is yours in 5b**, and it would also let every `loading.tsx`
come back.

**Cost, accepted:** the four detail routes have no loading skeleton until then.

Also found: the root `app/not-found.tsx` never caught `notFound()` at all — it
only covers URLs matching no route — and the root `loading.tsx` was a
product-grid skeleton being shown on `/about`, `/contact` and `/login`.

### Cloudinary — D-4 is closed

The credentials work. **15 tests against the real account**, opt-in via
`pnpm --filter api test:cloudinary`, every upload under `dev-test/<runId>/` and
destroyed afterwards.

The response mapping — the one item recorded as unproven at the end of Phase 4 —
was right, **with one exception**: Cloudinary answers `format: "jpg"` where
everything else in the system says `jpeg`. The adapter now maps that one
spelling, so a photograph is recorded identically whichever adapter stored it.

`--images` works. Files go through the same validation an admin upload gets, so
a supplier's `.jpg` that is really a PNG is refused and named in the report.
**Idempotent by construction** — a product that already has images is left
alone, because re-uploading gives the same photograph a second identity.

**The most important thing found here:** nothing had ever called `retain()`.
Every ledger row sat at `refCount: 0`, because until now nothing in production
ever attached an image — so `DELETE /admin/media` would have cheerfully
destroyed a photograph a live product page was showing. **Phase 7's upload UI
must call `MediaService.retain()` and `release()`.**

---

## How ready is 5b

**The API side is done.** Every endpoint the T2 cutover needs now exists and is
tested at the HTTP boundary: auth, cart, checkout with real delivery fees,
orders, addresses, password reset, profile. Nothing in 5b should need a new
endpoint.

**What the flip touches**, and it is genuinely atomic: `/login`, `/register`,
`/forgot-password`, `/account/*`, `/checkout`, the Navbar cart button, the
CartDrawer, the Zustand cart store, `proxy.ts`, and the deletion of the legacy
Supabase auth/cart/checkout actions — all in one release, because the session
authority cannot be half-migrated.

**What I expect to be hardest**, in order:

1. **The guest cart.** Everything else is "call a different function". This is a
   state machine: a client-side cart for anonymous visitors, the API cart when
   signed in, and a merge at the moment of login that must not lose lines, must
   not double them on a retry, and must re-price against the catalogue rather
   than trusting what the browser held.
2. **`proxy.ts`.** It guards `/account` and `/checkout` and must never redirect
   an action POST. Rewriting it around `nest_rt` while the pages beneath it are
   also changing is the part where a mistake looks like an intermittent logout.
3. **The 404 body**, if you want it fixed in the same pass — the existence check
   belongs in the file you are already rewriting, which makes 5b the cheap
   moment to do it.

**Decide before starting:**

- The password-reset paths (above). `/forgot-password` will consume them.
- Whether the `/shop` slice is deleted in the same commit as the flip or left
  redirecting for a release. Deleting it removes the only proven reference
  implementation while the new one is a day old.
- Whether "Featured" on `/products` goes back to being a sort. It is a filter
  today because `featured` is not in the frozen sort enum; restoring the old
  meaning means amending a frozen contract, and 5b is the last comfortable
  moment to decide.
