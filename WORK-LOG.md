# WORK-LOG

Overnight autonomous session. Started 2026-09-01.
Appended continuously as work proceeds. Newest entries at the bottom of each section.

---

## STEP 0 — State recovery after the interrupted Phase 0 run

### Git state as found

- Branch `main`, **working tree clean**, 11 commits ahead of `origin/main`.
- `git stash list` — empty. No stashes to recover.
- `git branch -a` — only `main` and `remotes/origin/main`. No leftover work branch.
- `git tag -l` — **empty. No baseline tag exists.**
- No partially-staged index, no unmerged paths.
- No conflict markers in any tracked file (`git grep` for `<<<<<<<`/`=======`/`>>>>>>>` → no hits).

### Which Phase 0 commits exist

The interrupted run got **further than expected — all commit units for Phase 0 landed.**
Reading history oldest → newest above the pre-existing `dc7768b`:

| Commit | Subject | Phase 0 unit |
|---|---|---|
| `7550ebc` | feat(api): establish backend application baseline | api baseline |
| `b344173` | chore(deps): lock the api dependency graph | api deps |
| `d3fba04` | chore(repo): remove stray development artifacts | **junk removal (F-19), own commit** |
| `d02a397` | docs: land architecture freeze, forensics and phase documentation | docs |
| `636e255` | chore(workspace): update shared packages, turbo config and lockfile | workspace |
| `655176d` | feat(api): email architecture, providers, health readiness and CORS | email architecture |
| `07bf88e` | feat(storefront): legacy UI overhaul, route flattening and new pages | storefront UI |
| `c877e27` | feat(storefront): API-backed /shop slice with e2e journey | `/shop` slice |
| `4b29fa0` | feat(admin): dashboard updates and environment example | admin/ui edits |
| `c4574f0` | ci: monorepo pipeline with Mongo transaction gate | CI workflow |
| `96d4650` | docs(plan): completion roadmap | PLAN.md |

All units named in Phase 0's "Work required" are present, in coherent conventional-commit
form, with junk removal correctly isolated in its own commit (`d3fba04`).

**Therefore what remains of Phase 0 is: (a) the verification pipeline, (b) the tag.**

### Secret scan of the interrupted run's commits — CLEAN

This was checked on commit *contents*, not filenames, per instruction.

- Full diff `dc7768b..HEAD` (81,825 lines) grepped for: `xkeysib-`, `sk_live`/`sk_test`,
  `pk_live`, SendGrid `SG.*`, `AKIA…`, `ghp_`/`github_pat_`, `AIza…`, JWT-shaped
  `eyJ….….`, `-----BEGIN … PRIVATE KEY`, `mongodb+srv://user:pass@`,
  `postgres://user:pass@`, `re_…`.
- **Two hits, both non-secret:**
  - `apps/api/.env.example` — `# MONGODB_URI=mongodb+srv://YOUR_USER:YOUR_PASSWORD@YOUR_CLUSTER.example.mongodb.net/YOUR_DB` (commented placeholder).
  - a docs table row documenting an env-validation test case (`postgres://user:pass@…`),
    describing that the embedded password is *not* echoed.
- Second scan for `KEY=`/`SECRET=`/`PASSWORD=`/`TOKEN=` assignments with real-looking
  values: every hit was a TypeScript identifier or enum member, no literal credential.
- `git log --all --diff-filter=A --name-only` → **no `.env` file (non-`.example`) has ever
  been added in any commit on any ref.**

### `.env` gitignore verification

`.gitignore` has `.env`, `.env.*`, `!.env.example`. Verified per-file with `git check-ignore`:

| File | Status |
|---|---|
| `./.env` | IGNORED |
| `./apps/api/.env` | IGNORED |
| `./apps/admin/.env.local` | IGNORED |
| `./apps/storefront/.env.local` | IGNORED |
| `./apps/{api,admin,storefront}/.env.example` | tracked — **intended**, contents verified placeholder-only |

**Conclusion: no secret was committed. Work may proceed; no history surgery needed.**

### Junk (F-19) verification — done and correct

All F-19 items absent from disk and from the index: `fix_hero{,2,3}.js`, `rewrite{,2}.js`,
`adjust_images.js`, `seed.js`, `seed_data.json`, `cinematic`, `DESIGN copy.md`,
`testsprite_tests/`, empty `src/app/orders/`.
Remaining `*.tsbuildinfo` on disk are inside `.next/cache/` or gitignored by `*.tsbuildinfo`
— build artifacts, not tracked, correctly left alone.
`apps/api` seed tooling left intact as instructed.

**One deviation from the brief, and it is correct:** the brief lists the `/auth/callback`
route as orphaned junk. It is **not** orphaned. `d3fba04` deliberately kept it, and I
re-verified independently — `apps/storefront/src/app/auth/callback/route.ts` is referenced
by three live callers as the Supabase OAuth `redirectTo`:

- `apps/storefront/src/app/login/form.tsx:69`
- `apps/storefront/src/app/register/form.tsx:66`
- `apps/storefront/src/app/forgot-password/form.tsx:34`

Deleting it would break Google OAuth sign-in. Kept. The brief's own rule — "verify nothing
references each item before deleting it" — is what settles this.

---

## TASK 1 — Finish Phase 0

### Verification pipeline — all four GREEN

Run at the found `HEAD` (`96d4650`), no code changes needed:

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ lockfile up to date, "Already up to date" |
| `pnpm type-check` | ✅ 3/3 tasks (api, admin, storefront) |
| `pnpm lint` | ✅ 3/3 tasks — **0 errors**, 57 warnings (unused vars / `no-explicit-any`, pre-existing) |
| `pnpm build` | ✅ 3/3 tasks |

Nothing in Phase 0 required a fix; the interrupted run left the tree in a building state.

### Test environment — what I had to stand up

- Docker Desktop was **not running**; started it (`Docker Desktop.exe -Autostart`).
- `docker compose -f docker-compose.dev.yml up -d` → `nest-electronics-mongo` healthy
  (single-node replica set `rs0`, required for transactions per CONSISTENCY-MODEL.md §1).

**Decision — I did NOT run tests against the URI in `apps/api/.env`.**
That file (gitignored, never committed — verified) points `MONGODB_URI` at a **live MongoDB
Atlas cluster** with an embedded credential. Running a 527-test suite that creates and
deletes users, carts and orders against a shared cloud dev database is not something I will
do unattended. I ran against a local, disposable database instead —
`mongodb://127.0.0.1:27017/nest_electronics_baseline` — which is exactly what CI does
(`ci.yml:109`). Flagged under "Needs owner".

### Baseline test state — and a finding beyond F-15

Three runs, because the first two exposed a real gap:

| Run | Preconditions | Result |
|---|---|---|
| 1 | fresh empty DB | **333 failed / 194 passed** of 527 — every failure `seed category development-boards is missing — run \`pnpm --filter api seed\`` |
| 2 | after `pnpm --filter api seed` | **19 failed / 508 passed** of 527 — all 19 are `index usage`, `idempotency`, `transaction atomicity/rollback`, `concurrency` suites |
| 3 | after `pnpm --filter api indexes:sync` | ✅ **527 passed / 527 total, 19 suites, 214s** |

**BASELINE = 19 suites / 527 tests, all green.** Matches PLAN.md Phase 1's "≥527 green".

**Finding — F-15 as written is insufficient.** The brief (and PLAN.md) say CI needs a
`seed` step before `test`. Evidence above shows seeding alone still leaves **19 failures**:
the suite also requires `pnpm --filter api indexes:sync`, because `autoIndex` is off and a
fresh database has no `order_user_history`, `order_admin_queue`,
`idempotency_key_unique`, etc. for the index-usage assertions to observe.
I will implement the CI fix as **seed + indexes:sync**, and say so, rather than shipping a
seed-only step that leaves CI red. This is an observed mechanical requirement, not a
business-rule invention.

### Phase 0 remaining work

Only the tag was outstanding. Junk, commits and pipeline were already done/green.

---

## TASK 2 — Branch `phase-1-2-overnight`, four PLAN.md corrections

Branch created off the tagged baseline. Documentation only, one commit. All edits applied
by assertion-checked scripts (each replacement required exactly one match, or the script
aborted) — no fuzzy matching, no partial application.

**2a — media → Phase 4, build only, no data.** Moved the ADR-MEDIA-001 upload API from
Phase 7 to Phase 4; recorded that it ships EMPTY and is test-exercised only; kept the admin
upload UI in Phase 7; noted Phase 8's blog-cover dependency is satisfied earlier.
Touched §12, §13, Phase 4 (title/goal/files/work item 4/risks/acceptance/DoD), Phase 7
(title/files/work/deps/risks), Phase 8 (deps + blog item).

**2b — shipping model aligned to the frozen doc.** Re-read `MONEY-MODEL.md` §6 and
`MONGODB-DESIGN.md` §11 before writing. Frozen shape adopted verbatim: collection
`shippingRates`, key `{governorate:1}` **unique** (one row per governorate), `fee` int64
minor units, `freeShippingThreshold` reserved and left off. The plan's `shippingRules` /
`{governorates[], fee, isDefault}` sketch is **withdrawn**. Consequence recorded: the D-8
rule becomes **27 rows, not two**.
**The gap is stated, not silently patched** — a unique scalar key cannot express "the fee
for a governorate with no row", so the frozen shape *cannot* express D-8's default fallback.
Proposed the minimal extension (a reserved `governorate: "*"` sentinel — no new field, no
schema change, no index change), recorded the `isDefault` + partial-index alternative as the
larger amendment, and **left it unimplemented pending owner ratification** because adopting
it amends a frozen document. Until ratified, a lookup miss must raise rather than invent a
fee. Touched §3, §9, §12, §20, Phase 5, Phase 7, D-8.

**2c — `shippingFee === 0` moved into Phase 2.** Verified both consumers in the tree before
writing: `CheckoutForm.tsx:88` (`amount === 0` → "Not yet calculated") and
`notifications.service.ts:299` (`shippingUnpriced: shippingFee === 0`).
**New evidence found while checking, which strengthens the case:** `FulfilmentService.quote`
**already returns `0`** when the free-shipping threshold is met `[V]` — so this is not only a
future ambiguity, it is reachable the moment a threshold is configured. Recorded the core
argument in the plan: additive fields are visible to the drift gate, a change in the meaning
of an existing value is not. Recommended `shippingPriced: boolean`.
Touched §19, §20, Phase 2 (goal/files/work/acceptance/DoD), Phase 3 (deps/risks), Phase 5
(DoD), F-13, open question 2.

**2d — catalogue timing.** Import tool stays in Phase 4; "may be pulled forward" removed;
spec changed to a **declarative column-mapping profile** so an unknown supplier format costs
a profile rather than a parser. §25 risk 3 **escalated to risk 1, the top schedule risk to
go-live** (renumbering the previous 1 and 2 down), with the reasoning that it is the only
launch-list item engineering cannot retire. §23 item 11 made unambiguous — items 1–10 can
all be true while the store has nothing to sell; blocks **launch only, never engineering**.
Added a concrete earliest-useful owner action: obtain one representative sample file, not
the whole catalogue.

**Frozen-doc conflicts:** none required leaving an item unchanged. 2b was a plan-vs-frozen
conflict that the owner had already directed me to resolve in the frozen doc's favour, which
I did. The single place that would *amend* a frozen doc (the sentinel default row) is left
unimplemented and flagged under "Needs owner" instead of being decided here.
**No file under `docs/architecture/` was edited.**

Also added §26 (new changelog, four corrections), renumbered the previous changelog to §27,
and repaired every cross-reference that moved (§26 note 2 → §27 note 2, §25 risk 4 → risk 1,
header revision line), plus superseded-markers on the two lines of the older changelog that
the corrections contradict.

---

## TASK 3 — Phase 1 (email correctness in development)

### Item 1 — F-07 provider isolation (done first, as instructed)

**What the 225 calls actually were.** Traced before writing anything: `email-integration.spec.ts`
was already safe (it overrides `EmailSenderPort` with a recorder) and `brevo-adapter.spec.ts`
stubs `fetch`. The live calls came from the **nine other suites that build the real
`AppModule`** (auth-flow, auth-guards, cart, checkout, transaction-gate, customer-journey,
admin-orders, order-lifecycle, orders-read, addresses) — they register real users, and
registration sends a verification email through whatever `.env` selected (`brevo`).

**Approach — central, not per-suite.** A `setupFiles` entry
(`apps/api/test/setup/email-isolation.ts`) rather than an `.overrideProvider` in eleven
places, so a NEW suite is isolated *by default* instead of by remembering. `setupFiles`
(not `setupFilesAfterEnv`) because `ConfigModule` reads the environment when the module
graph first compiles.

Two independent guarantees:
1. **Selection** — `EMAIL_PROVIDER=console` forced. `ConfigModule` is configured so real
   process env wins over `.env` `[V]`, so this overrides the developer's file. The
   `ProvidersModule` switch then constructs `ConsoleEmailSender` and never constructs a
   vendor adapter, so no key is read.
2. **Transport** — a `fetch` guard that **throws** on any request to a known mail-vendor
   host (brevo, sendinblue, resend, sendgrid, mailgun). Converts a future regression from a
   silent send into a loud failure. Narrow by design: Mongo uses sockets, not `fetch`.

**A correction I made to my own first attempt, worth recording.** I initially also deleted
`BREVO_API_KEY`/`RESEND_API_KEY` in the setup file and asserted they stayed deleted. The
bootstrap test caught that this is false: `@nestjs/config`'s `forRoot()` runs at *import*
time and reloads `.env`, restoring the keys. I removed the deletes rather than weakening the
assertion — a `delete` that reads as protection while providing none is worse than none — and
documented the measured reason in the file. Isolation now rests only on the two guarantees
that `.env` cannot undo.

**Bootstrap test** — `apps/api/test/setup/email-isolation.spec.ts`, 10 tests: the provider is
forced; the port resolves to `ConsoleEmailSender` in a *real* `ConfigModule + ProvidersModule`
graph (not an overridden one); no vendor adapter is constructed; a send completes through the
console sink; and the transport guard throws for each of the five vendor hosts while leaving
other hosts alone.

**Result:** 20 suites / **537 tests, all green** (527 baseline + 10 new). **Zero vendor
calls** — the guard never tripped. Suite time fell **214s → 149s**, consistent with ~225
eliminated network round-trips. `tsc --noEmit` and `eslint src test` both clean.

### Item 2 — F-02 dev config coherence

**The root was deeper than the `.env` file.** `apps/api/.env.example` already said
`EMAIL_PROVIDER=console`, so the committed example was half-right. The actual defect was in
`env.schema.ts:196`: `EMAIL_FROM_ADDRESS` **defaulted to `onboarding@resend.dev`** — Resend's
shared sandbox sender, a real deliverable address belonging to one vendor, baked into the
schema. Cleaning `.env` alone would not have fixed it; any deployment that simply omitted a
sender inherited a Resend identity while `EMAIL_PROVIDER` said `brevo`.

Changes:
- **`env.schema.ts`** — default is now `no-reply@nest-electronics.invalid`, hoisted into a
  documented `PLACEHOLDER_SENDER` constant. `.invalid` is **reserved by RFC 2606 and can
  never resolve**, so the placeholder cannot deliver to anyone. No real domain was invented.
- **New production guard**, following the file's existing superRefine pattern (which already
  refuses console-mail, verification-off and localhost-SITE_URL in production): the API now
  **refuses to start with the placeholder sender when `NODE_ENV=production`.** This is what
  makes the placeholder safe to ship as a default — the F-02 mismatch can no longer leak
  toward production. Production config itself was not touched; no production value exists to
  touch (D-10 deferred).
- **`.env.example`** — the Resend-sandbox block replaced with an explicit placeholder
  explanation and a pointer to Phase E for the real sender.
- **`apps/api/.env` (local, gitignored, NOT committed — verified with `git check-ignore`)** —
  flipped to `EMAIL_PROVIDER=console` with the placeholder sender, so dev is coherent as
  Phase 1 requires. **`BREVO_API_KEY` was deliberately left in place** for Phase E; with the
  console provider selected the schema does not require it and no adapter reads it.

`docs/deployment/DEPLOYMENT-DECISION.md` also mentions `onboarding@resend.dev`, but as a
factual description of what Resend offers, not as configuration. Left alone.

537/537 green, `tsc --noEmit` clean.

### Item 3 — F-10 outcome-based logging

`NotificationsService.dispatch()` catches every delivery failure, logs `email NOT sent`, and
returned `void` — so `deliver()` had no way to know and logged
`email verification challenge dispatched` unconditionally, **including straight after a
`401 Key not found`**. The log stated the opposite of what happened, which is worse than
silence: it is what an operator reads when a customer says the mail never arrived, and it
pointed them away from the mail provider.

- Added an exported `EmailDispatchResult` = `{accepted: true, providerMessageId}` |
  `{accepted: false}`. `dispatch()` now returns it; the **no-throw contract is unchanged**.
- `sendEmailVerification` surfaces it. `deliver()` logs `accepted` (with the provider message
  id) or **`NOT sent`** at `warn` — warn rather than error because the account exists, the
  challenge is stored, and "resend" recovers it.
- Used the transport's own word, `accepted`, not "sent" or "delivered": it means the provider
  took the message, which is all this process ever learns.
- **`sendOrderConfirmation` deliberately still returns `void`** — documented in place. Its
  only caller is `CheckoutService` post-commit, where no branch on the mail outcome exists or
  is wanted; handing it a result would invite failing or retrying a *placement* because an
  email did not go out.

One existing assertion (`sendEmailVerification` … `resolves.toBeUndefined()`) encoded the old
return type. Its intent — "does not throw" — is preserved and now stated directly
(`expect(outcome).toEqual({accepted: false})`), plus a new test for the success branch.
**538/538 green**, tsc and eslint clean.

### Item 4 — F-11 validation-detail message

`AppException.validation()` sets the top-level message to the **category**,
`'Validation failed.'` `[V]`, and puts the actionable sentence in `details`. The storefront's
`customerMessage()` fell through to `error.message` for validation errors, so a replayed or
expired verification link told the customer "Validation failed." while the server had
supplied `details: [{ field: 'token', message: 'verification token is invalid or has
expired' }]` — the one fact that would have pointed them at "resend".

- `customerMessage()` gains an explicit `case 'validation'` returning
  `error.details[0]?.message ?? error.message`. The fallback means an envelope without
  details can never render empty.
- First detail on purpose: screens needing per-field errors already use `fieldError(field)`
  and render them beside their inputs; this function produces the single summary line, and
  for the failures it is used on the first detail is the whole story.

**Cross-package contract now asserted.** The storefront fix is only correct while the API
keeps the specific reason in the first detail, so I strengthened the existing replay test in
`auth-flow.spec.ts` to assert both halves — top-level `'Validation failed.'` *and*
`details[0] == {field:'token', message:'verification token is invalid or has expired'}`.
Previously it only asserted `400`.

**Not done, and why:** no unit test for `customerMessage()` itself — the storefront has **no
unit-test runner** (Playwright only), and adding jest/vitest to it is well outside Phase 1.
The browser-level half of the acceptance criterion belongs to the existing verify-email
Playwright error-path spec (§20 item 4).
**Deliberate non-change:** I did not capitalise or otherwise rewrite the server's message.
Server copy is authored customer-safe, and silently transforming it in the client is the kind
of hidden rewrite that surprises people later.

538/538 green; storefront `tsc` clean, eslint 0 errors (57 pre-existing warnings unchanged).

---

## TASK 4 — Phase 2 (crash class + CI truthfulness)

**Project instruction honoured:** `apps/storefront/AGENTS.md` says this is not the Next.js I
know and to read `node_modules/next/dist/docs/` first. I did. **Next 16.2.4** — `middleware`
is now `proxy`; the proxy guide states it "should not be used as a full session management or
authorization solution" and is for **optimistic checks** only, which is precisely the
argument for the F-05 fix. I also read the action-header constant out of the installed
runtime rather than trusting memory: `node_modules/next/dist/client/components/app-router-headers.js`
→ `ACTION_HEADER = 'next-action'`.

### Item 1 — F-05 proxy + defensive error states

**`proxy.ts`** — a first branch, before every route rule: a request carrying `next-action`
returns `NextResponse.next()` and is never redirected. Placed first deliberately so no future
route rule can reintroduce a redirect on that path.

**Curl probe — three cases, run against the live dev server:**

| Case | Result | Meaning |
|---|---|---|
| `GET /checkout`, no session | **307** → `/login?redirect=%2Fcheckout` | navigation guard intact |
| `POST /checkout`, no session, **no** `Next-Action` | **307** → `/login?redirect=%2Fcheckout` | guard intact |
| `POST /checkout`, no session, **with** `Next-Action` | **404 `x-nextjs-action-not-found: 1`** | ✅ **no redirect** — reached the action dispatcher, which correctly rejected my fake action id |

The third case is the acceptance criterion and it passes. The first two are the control: they
prove the guard was narrowed, not removed, and that the running server really is executing
this change (otherwise case 3 would also be 307).

*Note:* a storefront dev server was **already running on :3000 from this same working tree**
(the owner's). Next 16 refuses a second dev server for the same directory, so I probed the
existing one rather than killing it. It hot-reloads `proxy.ts`, and the control cases prove
the new code was live.

**`app/login/form.tsx`** — the genuinely dangerous site. `await syncCartToDatabase(...)` had
**no catch**, so the thrown "unexpected response" left `loading === true` for ever: a spinning
button, no message, nothing to click. Now the whole handler is wrapped (error state +
`setLoading(false)` on every non-navigating path), with the cart sync in its own **nested,
non-fatal** catch — authentication has already succeeded by then, and a convenience feature
must not cost the customer the sign-in they just completed. The local cart is left intact so
nothing is lost.

**`CheckoutStepper`** — already had `try/catch/finally` and an error state, so it was never
stranded; the defect was a **bare `catch {}`** that discarded the error and showed
"An unexpected error occurred". Now it logs the error and gives an actionable message naming
the recoverable cause. The "your cart has not been changed" reassurance is verifiable:
`clearCart()` is only on the success branch.

### Items 2 & 3 — F-15 CI seed step, F-16 explicit `API_BASE_URL`

**F-15 — the brief's version of this fix was incomplete, and I have the measurements.**
Adding only the seed step would have left CI red. Evidence (all against local Mongo, the
same topology CI uses):

| Preconditions | Result |
|---|---|
| fresh database | 333 failed / 194 passed — every failure "seed category development-boards is missing" |
| after `seed` | **19 failed** / 508 passed — index-usage, idempotency, transaction-atomicity, concurrency |
| after `seed` **+ `indexes:sync`** | **538 / 538 green** |

`autoIndex` is off deliberately (index creation is a release step, not a side effect of
booting), so a fresh database has no `order_user_history`, `order_admin_queue` or
`idempotency_key_unique` for the index-usage assertions to observe. `ci.yml` therefore gets
**two** steps before the gate — `seed`, then `indexes:sync` — each with the measurement that
justifies it written next to it.

**End-to-end proof of the acceptance criterion** ("green CI from a fresh clone with no local
state"): ran the exact CI sequence against a brand-new database
(`nest_ci_proof_1788237488`) — seed → indexes:sync → test → **538/538 green**.

**F-16** — `API_BASE_URL` added explicitly to `apps/storefront/.env.local`. It is
**gitignored and therefore not in any commit** (verified). The committed `.env.example`
already documented it correctly, so no example change was needed. The point of the fix: the
`http://127.0.0.1:3002/api/v1` fallback in `client.ts` is a safety net, not configuration —
dev worked only by coincidence of the default matching the local port, and moving the API
would have produced a confusing connection error instead of a missing-config one.

### Item 4 — browser-health Playwright fixture (F-14)

`e2e/fixtures/browser-health.ts` exports an extended `test`; importing it instead of
`@playwright/test` covers a spec automatically (`auto: true`). It fails a test on:
uncaught exception (`pageerror`), **unhandled promise rejection**, any `console.error`, and
any **unexpected ≥500** response.

Unhandled rejections needed an `addInitScript` reporter — Playwright's `pageerror` does not
reliably carry them, and a rejected promise is the normal shape of a failed `fetch` or
server action, i.e. exactly the class the fixture exists for.

Opting out is explicit and scoped: `health.allowConsoleError(pattern)` /
`allowServerError(pattern)`. Declaring costs a sentence; ignoring silently costs nothing —
that asymmetry is deliberate.

**Adopted by the existing journey spec**, and a new spec `e2e/guest-cart-login.spec.ts`:
1. *guest cart → login* — seeds the persisted Zustand guest cart, submits the login form, and
   asserts the button becomes **enabled again** (the "not stranded" contract that the F-05
   hardening restores) and the URL is still `/login`, not an error overlay.
2. *guarded-route control* — a guest navigating to `/checkout` is **still redirected**. This
   guards the half of the proxy that must NOT change; without it a later "simplification"
   could delete the guard entirely with every other test still green.

The cart is seeded via `addInitScript` rather than clicked together, because the legacy
product pages read the catalogue from **Supabase** — clicking through them would make a
proxy/form regression test depend on a database D-6 already calls disposable.

**First run found a real problem with my own fixture, not with the app.** All 4 specs failed
on **24 problems that were every one the identical Next dev-server HMR WebSocket handshake
error** (`_next/webpack-hmr`) — **zero application errors**. That channel does not exist in a
production build and says nothing about the application, so it is excluded globally, scoped
to the HMR URL rather than to "WebSocket errors" generally, with the reasoning written in.

**Result: 4/4 Playwright specs green** (2 pre-existing + 2 new) under the fixture, in 35s.

Incidental confirmations from the run: the order email printed
`messageId=console-…` — the **console provider really is in use end-to-end** (F-07/F-02) —
and the order email rendered **"Delivery — Calculated before dispatch"** on a real placed
order, which is correction 2c's bug visible in production output.

### Item 5 — the 2c decision implemented: `shippingPriced`

The ambiguity had a **config-level root** I had to fix first. `SHIPPING_FLAT_FEE` was
`.default(0)`, and its own docstring said the zero meant "no rate supplied … charges nothing
and says so, rather than guessing" — so `0` was *already* the sentinel for "unpriced", while
also being a legitimate value meaning "free". The two were indistinguishable **by
construction**, so no amount of downstream logic could have told them apart.

The chain, end to end:

1. **`SHIPPING_FLAT_FEE` is now `.optional()` with no default.** Absent = no rate supplied.
   Present-and-`0` = a deliberate decision that delivery is free. **The numbers a customer
   sees are unchanged** — an unset value still charges nothing, exactly as `.default(0)` did.
2. **`fulfilment.config.ts`** → `shippingFlatFee: number | null`.
3. **`FulfilmentService.quote()` returns `ShippingQuote {fee, priced}`** instead of a bare
   number. A met free-shipping threshold returns **`{fee: 0, priced: true}`** — free *is* a
   price, and that case is reachable today.
4. **`OrderPricing` / `computeOrderPricing`** carry `shippingPriced` through; only `fee`
   enters the arithmetic.
5. **Persisted** on `OrderPricingSnapshot` (`default: false`) — the order email renders from
   the snapshot long after placement, so the order must record what was true on the day. The
   schema is `strict: 'throw'`, so this had to be declared, not just written.
6. **API contract:** `shippingPriced` added to the shared `PricingBreakdownDto`, which covers
   the **quote, order detail and order summary** responses. Documented at length because
   Phase 3 freezes it, and it is the field that stops a mobile client mis-rendering free
   orders. Optional on the way in (`?? false`) so an order written before the field reads
   back truthfully; always present on the way out, so no client handles a missing value.
7. **Consumer 1 — order email:** `shippingUnpriced: !order.pricing.shippingPriced`, was
   `order.pricing.shippingFee === 0`.
8. **Consumer 2 — checkout UI:** `CheckoutForm` reads the flag, and now renders three
   distinct states: a fee, **"Free"**, and "Not yet calculated". It previously could not
   render "Free" at all.

**Tests.** The fulfilment spec is rewritten to assert both halves everywhere (asserting only
the fee is what let the meanings blur), plus a new case proving a deliberate `0` and an
absent rate are distinguishable. Two new notifications tests pin the crux: **two orders with
an identical `shippingFee: 0` that must read differently** — one "Calculated before
dispatch", one not — which the old contract could not express.

**API: 541/541 green** (from 527 at baseline). eslint and tsc clean.

**Playwright: 4/4 green.** One intermediate run failed the journey at sign-in; I checked
rather than assumed, and it was **rate limiting from my own repeated runs** — `register` is
capped at 3/hour per IP and the throttler is in-memory, so it had accumulated across three
journey runs. Restarting the API reset it and all 4 passed. **Not a regression**, and worth
knowing before someone hits it in the morning.

---

## TASK 5 — Phase 3 (Flutter contract freeze)

Unlocked only because Tasks 1–4 were all complete and green first — 541/541 jest, 4/4
Playwright, and the root pipeline green.

**Frozen artifact — `docs/api/openapi.v1.json`.** 37 paths, 43 operations, 84 schemas.
**It contains `shippingPriced`**, which is the whole point of having done 2c first: the
contract froze around the honest representation rather than around the ambiguous zero.

**The extraction that makes the artifact meaningful.** The `DocumentBuilder` chain lived
inline in `main.ts`. A second copy in an export script would drift, and the gate would then
be comparing a copy to a copy. It now lives once in `src/openapi/openapi.document.ts` and has
two consumers: `main.ts` (serves `/api/v1/docs`) and `export-openapi.ts` (writes the file).
The server port in the artifact is pinned to 3002 rather than read from config, so a
developer with `PORT=3005` cannot produce spurious drift.

Two scripts: `pnpm --filter api openapi:export` and `openapi:check`. Both build the **real**
`AppModule` (so they need Mongo) and never listen on a port — an artifact generated from a
half-booted app would describe an API that does not exist.

**Drift gate — `check-openapi-drift.ts`.** Any difference fails; the two outcomes are
reported differently because the required human response differs. Breaking = path, operation,
schema or property removed / retyped / newly required. "Newly required" is deliberately
conservative: harmless in a response, fatal in a request body, and the gate does not guess —
over-reporting costs a conversation, under-reporting costs a release.

**I proved all four behaviours rather than asserting them:**

| Scenario | Result |
|---|---|
| clean tree | `OK, the API matches` — **exit 0** |
| frozen claims a path the API lacks | `BREAKING … path removed: /api/v1/auth/google` — **exit 1** |
| generated has a newly-required property | `BREAKING … property newly required: PricingBreakdownDto.shippingPriced` — **exit 1** |
| purely additive drift | `changed additively, but … is stale` + the regenerate command — **exit 1** |
| restored | `OK` — **exit 0** |

**CI:** a **separate `contract-gate` job**, not a step in the transaction gate, so a red CI
already names which contract broke. It starts the same compose Mongo.

**Docs.** `docs/api/SANDBOX.md` — compose (replica set, and why a standalone fails), env,
seed **+ `indexes:sync`** (called out as the classic mistake), the console-mail verification
walkthrough with real curl commands, the verification toggle and why it cannot be set in
production, reset, and a troubleshooting table including the **real rate limits** (3
registrations/hour) that cost me a debugging cycle tonight.
`docs/api/INTEGRATION.md` — the §19 safe / unstable / forbidden lists, the v1 conventions,
the refresh-and-reuse auth sequence, and a dedicated section on **reading `shippingPriced`
instead of `shippingFee.amount === 0`**, stating plainly that a client branching on the
amount keeps compiling and starts lying.

PLAN.md Phase 3 "Current state" updated to DONE with the evidence.

**Verification after this task:** 541/541 jest; root `type-check`, `lint`, `build` all green.

---

## FINAL STATE

Final verification, run on a brand-new database using the exact CI sequence:
seed → `indexes:sync` → jest → drift gate.

- **jest: 20 suites / 541 tests, all green** (~102s)
- **drift gate: OK**
- **Playwright: 4/4 green** under the browser-health fixture
- root `type-check` / `lint` / `build`: green

Git, as required:
- `main` = `6d0673a`, tagged `baseline-phase-0` — Phase 0 only
- `phase-1-2-overnight` = `0908721`, 10 commits — Tasks 2–5
- working tree clean; **22 commits unpushed; nothing pushed; no history rewritten; nothing reverted**

`HANDOFF.md` written. Six items are recorded under "Needs owner", of which one — ratifying
the shipping default-rate extension — is the only thing blocking the next phase.

---

# SESSION 2 — adversarial verification of `a7009c1`, plus three corrections

**Baseline before any change:** jest **20 suites / 541 tests green**.

## PART A — findings

Checks run, in order. Every conclusion below has evidence pasted in-session.

### A1 — surviving zero-comparisons on a shipping fee

Grepped `apps/api/{src,test}`, `apps/storefront/{src,e2e}`, `apps/admin/src` and `packages`
for `=== 0` / `!== 0` / negation / truthiness / ternaries on any shipping-fee value.

Hits triaged:
- `order-pricing.ts:131,133` — invariant arithmetic. Legitimate.
- `orders-read.spec.ts:646` — `?? 0` null-safety inside a total assertion. Legitimate.
- `quote-response.dto.ts:129` — the string *warning clients not to do this*. Legitimate.
- `CheckoutForm.tsx:99` — `amount === 0` **guarded by `shippingPriced`**, choosing between
  "Free" and the formatted amount. Not a semantic inference. **Kept** (see report).
- **`shop/orders/[id]/page.tsx:102` — → FINDING 1.**
- Email templates — **→ FINDING 2.**

`shippingUnpriced` is **not** a second source of truth: computed in exactly one place
(`notifications.service.ts:346`) as `!order.pricing.shippingPriced`. Derived, not stored.

Legacy Supabase `shipping_fee` (`packages/services/src/order.service.ts:13` hardcodes `0`;
account/admin order pages print it raw) is a **different data source**, scheduled for deletion
under D-6, and contains no two-meanings inference. Out of scope; reported, not touched.

### A2 — every `quote()` caller

Two production call sites (`checkout.service.ts:393` placement, `:687` quote). Both pass the
object straight into `computeOrderPricing`, which destructures `.fee` / `.priced` immediately.
`grep` for `...pricing` / `...quote` / `...shipping` / `${…fee}` returns **nothing** — no
spread, no interpolation, no arithmetic on the object. `ShippingQuote` is referenced only in
`fulfilment.service.ts` and `order-pricing.ts`. **No object-leak path. Clean.**

### A3/A4 — money math and all three states, live

Drove the real API end to end (register → cart → address → quote → place → detail → history)
under three configurations, then read the persisted Mongo document directly via `mongosh`.

| State | config | fee | priced | subtotal | grand | formula | persisted matches |
|---|---|---|---|---|---|---|---|
| A unpriced | (unset) | 0 | `false` | 530000 | 530000 | ✅ | ✅ identical |
| B priced-zero | flat 5000 + threshold 1 | 0 | **`true`** | 530000 | 530000 | ✅ | ✅ identical |
| C normal | flat 5000 | 5000 | `true` | 530000 | 535000 | ✅ | ✅ identical |

All four API views (quote, order response, order detail, order summary) agreed in every
state. All amounts integers, minor units. **No float introduced, no rounding moved.**
State B — the case the old code got wrong — is correct at the API layer.

### A5 — persistence vs recomputation

Restarted the API with `SHIPPING_FLAT_FEE=7777` and re-read the state-A order, which was
placed with no rate at all:

```
order detail           fee=     0  priced=false  grand=530000   <- persisted snapshot wins
order history row      fee=     0  priced=false  grand=530000
fresh quote            fee=  7777  priced= true                 <- new config, for contrast
```

**Order integrity holds.** A config change does not retroactively alter an existing order.

### A6 — the frozen contract

`git log --follow docs/api/openapi.v1.json` → created in `0908721`, which is **after**
`a7009c1`. Drift gate run now: `drift gate: OK, the API matches` — **exit 0**.
`PricingBreakdownDto` carries `shippingPriced` in `required`, referenced by
`CheckoutQuoteViewDto`, `OrderDto` and `OrderSummaryDto`.
`docs/api/INTEGRATION.md:66-69` states explicitly that `true` "**including when it is `0`**"
means show the amount **or "Free"**. A client reading only that cannot reproduce the old bug.

### A7 — missing-field handling, executed not inferred

`$unset` the field on a real order via `mongosh` (bypassing Mongoose, exactly as a
pre-change document would be), then read it back through the API:

```
field present in doc? false
API:  shippingPriced = false (typeof boolean)   key present in JSON? true
```

The schema default and the DTO `?? false` coercion both work. No `undefined` reaches a
client. **✅** — but it also produced `priced:false` alongside `fee:5000`, which is
**→ FINDING 4.**

## FINDING 1 (highest severity) — the order-detail page ignored the flag

`apps/storefront/src/app/shop/orders/[id]/page.tsx:102` rendered
`order.pricing.shippingFee.formatted` unconditionally.

**Failure scenario:** every order placed today is unpriced (`SHIPPING_FLAT_FEE` is unset), so
the page rendered **"Delivery — 0.00 EGP"**, telling the customer delivery was *free* when it
had never been priced. The checkout page they had just left said "Not yet calculated" for the
same order. Confirmed live on the state-A order: `shippingPriced:false`,
`shippingFee.formatted:"0.00 EGP"`.

This is the exact bug class `a7009c1` exists to remove, surviving in a **third** consumer.
The commit updated two (checkout form, order email); the brief said "both consumers", but
`OrderDto` carries `shippingPriced` and this page was already receiving it and discarding it.

**Fixed** — same three states as the checkout summary, reading the persisted flag.

## FINDING 2 — the order email had no "Free" state

`price-summary.hbs:35` and `order-placed.txt.hbs:17` had two branches only:
`shippingUnpriced` → "Calculated before dispatch", otherwise the amount.

**Failure scenario:** free-shipping threshold met → `priced:true, fee:0`. The checkout page
says **"Free"**; the confirmation email for that same order says **"0.00 EGP"**. The same
fact, told two different ways to the same customer minutes apart. Reachable as soon as
`FREE_SHIPPING_THRESHOLD` is set — verified live in state B.

**Fixed** with a third state. `shippingFree` is computed in `NotificationsService`
(`shippingPriced && shippingFee === 0`), **not** in the template — the partial's own docstring
says booleans are computed in the service because a logic-less engine is what keeps business
rules testable, and `hasDiscount` already sets that precedent.

**A miss this nearly became:** `order-placed.hbs` passes named arguments into the partial.
Adding the branch without adding `shippingFree=shippingFree` to that call would have left the
HTML email silently falling through to the amount while the text email said "Free". Caught by
grep before committing, and now covered by a test that asserts **both** renderings.

## FINDING 5 — a vacuous assertion in my own previous test

`notifications-service.spec.ts` asserted `expect(text).toContain('0.00 EGP')` for the
priced-zero case. **That assertion could never fail.** The grand total renders as
`"650.00 EGP"`, and `'650.00 EGP'.includes('0.00 EGP') === true`:

```
grandTotal renders as: "650.00 EGP"
does it contain '0.00 EGP'? -> true
```

So the test passed regardless of what the delivery line actually said — including when it was
wrong. This is my own test from the previous session and it was weaker than I described it.

**Fixed:** both delivery-line tests now extract the delivery line specifically and assert the
whole line (`'Delivery          Free'` / `'Delivery          Calculated before dispatch'`),
via a `deliveryLineOf()` helper, so they can only pass for the stated reason.

## FINDING 3 — `shippingPriced` was asserted nowhere at the HTTP boundary

Grep showed `checkout.spec.ts:427` and `:699` assert `shippingFee.amount === 0`, and
`orders-read.spec.ts:636-642` walks the money fields, but **no test anywhere asserted
`shippingPriced` on any response**.

**Failure scenario:** the DTO stops serialising the field, or hardcodes `true`, and all 541
tests still pass — while a mobile client built on the frozen contract silently misreports
free delivery. A field in a frozen contract with no boundary test is untested.

Compounding it: the integration suites only ever run under the deployed configuration, where
no rate is supplied, so **`false` was the only value any test had ever observed.** A boolean
seen in one state is not a tested boolean.

**Fixed** in three places:
- `checkout.spec.ts` — the quote response and the persisted order both assert the flag.
- `orders-read.spec.ts` — the order-**summary** serialiser is a different class from the
  detail one, so the flag is asserted on that shape too rather than assumed to travel with
  the money.
- **New `test/orders/pricing-dto.spec.ts`** (6 tests) — `PricingBreakdownDto.of` is pure, so
  all three states are exercised without a database or a config change that would leak into
  other suites, including *two otherwise identical zero-fee orders that must serialise
  differently*, and the missing-field coercion from A7.

## FINDING 4 — a documented invariant that was never asserted

`ShippingQuote` states: *"`priced: false` always carries `fee: 0`; there is no such thing as
an unpriced non-zero fee."* Nothing enforced it — `assertPricingInvariants` checks integers,
ranges and the total formula, but not this pair.

**Proven reachable during A7:** unsetting the field on an order that had a real 5000 fee
produced `priced:false` alongside `fee:5000`, and the API served it without complaint.

MONEY-MODEL.md §7.1 requires invariants to be *"asserted in code, not merely documented"*,
and this one was only documented.

**Why it matters, concretely:** a non-zero fee flagged unpriced renders as "not yet
calculated" beside a charge the customer is nonetheless being asked to pay.

**Fixed** with one clause in `assertPricingInvariants`, plus a property test over all seven
meaningful `FulfilmentService` configurations × five subtotals (rather than one example,
since the failure it guards against is a future `quote()` body that a single case would
miss). **Behaviour today is unchanged** — every current path already satisfies it. This
closes the gap before Phase 5 introduces a `shippingRates` lookup that could violate it on a
miss. Classified as hardening, not a live bug.

---

## PART B

### B1 — development defaults to local Mongo

`apps/api/.env` had `MONGODB_URI` pointing at a live Atlas cluster with an embedded
credential. The jest suite creates and deletes users, carts and orders, so an unattended run
was writing to a shared cloud database.

- **`apps/api/.env`** (gitignored, not committed) — now the local replica set
  `mongodb://127.0.0.1:27017/nest_electronics_dev`. The Atlas URI is **kept, commented and
  untouched**, labelled for deliberate staging/production use only. Nothing was deleted.
- **`apps/api/.env.example`** — the local URI was already the default; the *reasoning* was
  not. It now states plainly that Atlas is for staging and production **by explicit choice**
  and never the development default, and shows the one-off form
  `MONGODB_URI=<uri> pnpm --filter api <task>` so a staging task cannot leak into the next
  test run by way of an edited file.
- **`docs/api/SANDBOX.md`** — the same warning as a callout, plus "the development default,
  always" in the variable table.

Verified the API still seeds against the local URI after the change (5 seed lines).

### B2 — the health fixture's ignore list is now counted and printed

The scoping was correct and is unchanged (`_next/webpack-hmr` only). What was missing was
visibility: nothing recorded how much the rule was swallowing, so growth would have been
silent.

- The fixture counts every suppression **keyed by the rule's own `RegExp.source`**, so a new
  rule names itself in the output the first time it fires. Counting covers the dev-server
  noise list *and* per-test `allowConsoleError` / `allowServerError` declarations.
- Counts are attached on **every test, passing ones included** — a suppression that only
  surfaces on failure is invisible in exactly the runs where the list is quietly growing.
- A small reporter (`e2e/reporters/health-summary.ts`) aggregates and prints once at the end
  of the run. A reporter rather than a `console.log` in the fixture, because the useful
  question ("is the ignore list growing?") only exists at run level, and the fixture runs in
  a worker process interleaved with test output.
- **It never fails a run.** Deciding a number is too high is a person's judgement; a reporter
  that failed builds on a threshold nobody agreed would just become another thing to
  suppress.

Live output from the run:

```
  4 passed (49.6s)
browser-health: ignored 20 browser problem(s) across 4 test(s), by rule:
     20  /_next\/webpack-hmr/
Each line is something the health check did NOT check. If a rule you do not
recognise appears here, or a count grows, that is the signal to look.
```

20 suppressions across 4 tests — previously invisible.

### B3 — governorate is now a closed list on both sides

**Audit result — one side of three was already correct:**

| Surface | Before | After |
|---|---|---|
| API `CreateAddressDto` / update DTO | ❌ **free text**, `@MinLength(2) @MaxLength(80)` | ✅ `@IsIn` over the 27 |
| `/shop` `AddressBook` (API-backed) | ❌ **free-text `<input>`** | ✅ `<select>` from `EGYPTIAN_GOVERNORATES` |
| legacy `account/addresses` page | ✅ already a `<select>` from the constant | unchanged |
| admin | *no address form exists* | nothing to fix |

The DTO's old docstring explained itself honestly: free text *because* "the governorate list
belongs to the shipping rate table, which is unresolved business input (OPEN-001)". **D-8
removed that premise** — 27 rows, no fallback, a miss must raise — so the closed list is now
the precondition that makes the no-fallback design safe.

**Source of truth — a decision I did NOT take unilaterally.** `apps/api` has **zero
workspace-package dependencies** (verified: no `@nest/*` in its `package.json`, no `@nest/`
import in `src` or `test`). Importing `@nest/config` for a string array would spend that
property. So the API keeps its own copy in `src/common/constants/governorates.ts`, and
`test/users/governorates.spec.ts` **reads `packages/config/src/constants.ts` as text** and
fails if the two differ in content or order — drift is impossible, neither side gains a
dependency. The parser is itself sanity-checked (asserts it found 27) so the comparison
cannot pass against an empty list.

**Tests added** (`addresses.spec.ts`): all 27 accepted; refusals for unknown, wrong case,
internal spacing, transliteration, empty, `$role` and `$ne`; refusal **on update as well as
create** (an update path accepting free text would reopen the hole); and trimming still
applied before matching.

**Two existing tests had to change, and neither lost coverage:**
- the `$`-injection test used `governorate: '$role'` as one of five payloads. Governorate is
  now refused outright — a *stronger* guarantee — so it carries `'Cairo'` and the payload
  coverage moved to the new explicit refusal case.
- "accepts every one of the 27" first hit `MAX_ADDRESSES_PER_USER = 10` (422). Rewritten to
  PATCH one address through all 27 values, which exercises the same `@IsIn` without fighting
  an unrelated business rule.

Artifact regenerated; drift gate green. `INTEGRATION.md` documents the enum and tells clients
to build their picker **from the artifact** rather than hardcoding a list.

---

## SESSION 2 — final state

| | Before | After |
|---|---|---|
| jest suites | 20 | **22** |
| jest tests | 541 | **563**, all green |
| Playwright | 4/4 green | **4/4 green** + suppression summary |
| root type-check / lint / build | green | green |
| OpenAPI drift gate | green | green (artifact regenerated for the enum) |

### One limitation of the drift gate, found by using it

Narrowing `governorate` from an unconstrained string to a 27-value enum was classified by the
gate as **additive**, not breaking. That is correct by its own stated rule — no path,
operation, schema or property was removed, retyped or newly required — but it is a **domain**
narrowing: a client that was sending "cairo" and succeeding now gets a 400.

The gate protects *shape*, not *domain*. That is the same blind spot the `shippingPriced` work
existed to route around, and it is worth the owner knowing that "additive" from this gate
means "shape-compatible", not "no client can break". Recorded, not worked around — tightening
it to compare enum members is a judgement call about how noisy the gate should be.

---

# SESSION 3 — housekeeping, then Phase 4

Branch `phase-1-2-overnight`, continuing from `fdc33d1`.

## Baseline, and a real surprise before any work started

The session-2 close reported 563/563 green. **The first run this session was 19 failed / 544
passed.** Nothing in the tree had changed — `git status` was clean and HEAD was still
`fdc33d1` — so the difference had to be environmental.

```
$ docker exec nest-electronics-mongo mongosh --quiet --eval \
    'const d=db.getSiblingDB("nest_electronics_dev");
     d.getCollectionNames().sort().forEach(c=>print(c+"  ->  "+d[c].getIndexes().map(i=>i.name).join(", ")))'
brands  ->  _id_
carts  ->  _id_
categories  ->  _id_
idempotencyKeys  ->  _id_
inventoryEvents  ->  _id_
orderCounters  ->  _id_
orders  ->  _id_
products  ->  _id_
refreshTokens  ->  _id_
users  ->  _id_
```

**Every application index was gone.** All 19 failures were index-dependent — the index-usage,
idempotency, transaction-atomicity and concurrency suites, plus the two duplicate-email cases
that rely on `user_email_unique`. `autoIndex` is off by deliberate design (index creation is a
release step, not a side effect of booting), so an index-less database is a *silent* state:
the API starts, serves traffic, and only the tests notice.

`pnpm --filter api indexes:sync` restored them and the count went to **562/563** — the single
remaining failure being one of my own new assertions, fixed below.

**This is the F-15 finding proving itself a second time.** CI already runs `seed` +
`indexes:sync` because of it; a developer's machine has no such step, and the failure mode is
19 red tests with no obvious cause. Logged for the owner under "worth doing next".

---

## 1a — the vacuous-assertion sweep

Treated as a class, per the brief. **172 assertion sites** across jest and Playwright
(`toContain`, `toMatch`, `.includes(`, `toContainText`, `getByText`) were enumerated and
triaged:

| Category | Verdict |
|---|---|
| `toContain` on an **array** (element membership, not substring) | Safe by construction |
| `not.toContain` (leak / absence checks) | Cannot pass vacuously — the failure direction is over-strict, never under-strict |
| Positive substring **already scoped to a field** (`details[0].message`, `line.sku`, `error.message`) | Satisfies "scope it to a field" |
| Anchored regex (`/^NE-\d{8}-\d{4,}$/`, `/^[0-9a-f]{64}$/`) | Exact by construction |
| Playwright locator assertions under strict mode | Multiple matches fail rather than pass |
| **Positive substring where the needle can collide** — **7 found** | **Weak — all seven fixed** |

### The seven, with the evidence

Occurrence counts taken by rendering the real templates and counting, not by reading them:

```
  3x  base.html   "735.50 EGP"   <- spec:187, aimed at the SUBTOTAL
  1x  base.html   "650.00 EGP"   <- spec:184, lineTotal[0]
  2x  base.html   "85.50 EGP"    <- spec:184, lineTotal[1]
  1x  base.html   "Cairo"        <- spec:194
  1x  free.html   "Free"         <- spec:259
  2x  disc.html   "50.00 EGP"    <- spec:212, aimed at the DISCOUNT
```

1. **`email-rendering.spec.ts:212` — `toContain('50.00 EGP')` for the discount row.**
   Two occurrences: the discount itself, and **inside the line total `650.00 EGP`**. The same
   shape as the `'0.00 EGP'` / `'650.00 EGP'` defect found in session 2.
2. **`:187` — `toContain('735.50 EGP')` for the subtotal.** Three occurrences: subtotal, grand
   total, amount due. The assertion could not tell which one it had found.
3. **`:184` — `toContain(item.lineTotal)`.** For the quantity-1 item, `85.50 EGP` is both the
   unit price and the line total, so the Total column could vanish unnoticed.
4. **`:259` / `:262` / `:277` — `Free` searched across the whole document.** One occurrence
   today, but "Free" is exactly the generic status word the brief names; one "Free returns"
   line in a footer would make it vacuous.
5. **`cart.spec.ts:449` — `toContain('0 available')`.** The message is
   `` `${sku} has ${n} available` ``, so this passes for `10 available`, `20 available` and
   `100 available`. It also could not tell whether the SKU and the quantity referred to the
   same line.
6. **`admin-orders.spec.ts:1160 / :1176 / :1192` — index assertions against
   `JSON.stringify(<whole explain output>)`**, which includes `queryPlanner.rejectedPlans`.
   Its own sibling at `orders-read.spec.ts:867` scopes to `queryPlanner.winningPlan`; these did
   not. A regression to a *different* index still passed, because `order_admin_queue` appeared
   among the plans the planner threw away — precisely the regression the test exists to catch.
7. **`email-integration.spec.ts:458` — `toContain('325.00 EGP')`, a hardcoded literal** in a
   test whose every other assertion compares against the stored order. The fixture product
   costs 32500, so that one string is simultaneously the unit price, the line total, the
   subtotal, the grand total and the amount due.

Also fixed, same class, in Playwright: **`purchase-journey.spec.ts:128` —
`getByText(/EGP/).first()`**. Any cart line's price satisfied it, so the quote's own total
could have rendered blank, an em dash, or `NaN EGP` and the step still passed. Now scoped to
the `<dd>` beside "Total to pay" and matched against a complete money string.

### Mutation proof — the fixes were verified by breaking the templates

Not asserted; executed. Three mutations, each run against the OLD assertions and the NEW suite:

```
MUTATION: drop the Discount row entirely
  PASSES  OLD email-rendering:212  html.toContain('50.00 EGP')   [discount]
  PASSES  OLD email-rendering:187  html.toContain('735.50 EGP')  [subtotal]
  PASSES  OLD email-rendering:184  html.toContain('85.50 EGP')   [lineTotal]
  NEW suite -> Tests: 1 failed, 22 passed, 23 total

MUTATION: drop the Subtotal row entirely
  PASSES  OLD :212 / :187 / :184   (all three)
  NEW suite -> Tests: 1 failed, 22 passed, 23 total

MUTATION: drop the line-total column from every item row
  PASSES  OLD :212 / :187 / :184   (all three)
  NEW suite -> Tests: 1 failed, 22 passed, 23 total
```

**Deleting the Discount row, the Subtotal row, or every line total was invisible to all three
old assertions**, and each is now caught by exactly one test. Templates restored and
`git status` verified clean afterwards.

### Two things found along the way

- My first replacement, `toBe('CART-TEST-EMPTY has 0 available')`, **failed** — the fixture
  SKU carries a per-run suffix (`CART-TEST-EMPTY-B890BB25`). Corrected to build the expected
  string from `RUN_ID`. Recorded because the over-literal fix was caught by the suite, which
  is the system working.
- **Nine spec docstrings still said "the real Atlas development database"** — stale since B1
  made local Mongo the dev default. Corrected; a comment that misdescribes what a suite runs
  against is a small lie that costs somebody an hour later.

---

## 1b — D-8 ratification recorded

Owner ratification applied to `PLAN.md` §3, D-8 (§25), Phase 5, Phase 7, and a new changelog
entry **26e**; the superseded proposal in 26b now carries a forward pointer rather than
standing as an open question. The corresponding blocking item is struck from `HANDOFF.md` §4.

**No file under `docs/architecture/` was touched** — which is the point of the ratification:
by rejecting the premise (that a fallback is needed) rather than the proposal (a `"*"`
sentinel), the owner removed the need to amend a frozen document at all. The reasoning is
recorded in 26e because it is not recoverable from the shape alone: 27 individually-priced
rows are *more* of what D-8 asks for than two rules, and since B3 closed the governorate to a
validated list, a lookup miss is bad data rather than an unpriced region — so failing loudly
beats silently charging a made-up fee.

Phase 5 is unblocked.

---

## 1c — the drift gate's blind spot, documented

No semantic differ built, per the brief. Instead:

- **`docs/api/INTEGRATION.md`** gains "What the gate does NOT catch" — a table of the four
  classes (enum narrowing, tightened validation, changed meaning of an existing value,
  newly-enforced constraints) with why the gate is blind to each and what it does to a client.
- **The governorate narrowing is the worked example**, stated concretely: the artifact gained
  an `enum` array on an existing `string` property, the gate called it additive and the build
  passed, while any client sending `"cairo"` went from `201` to `400`.
- **A contract-policy checklist item**: any PR touching an enum, a validator, or the meaning of
  an existing field must state the client impact in its description, because the gate cannot
  see it. "The drift gate passed" is explicitly named as not an answer to that.
- **`.github/workflows/ci.yml`** carries the same warning at the `openapi:check` step, so a
  developer reading the gate finds the limitation without having to read the consumer docs.

---

# SESSION 3, PART 2 — Phase 4

## Step 0 — the seed assessment, before a single route moved

Inventoried the seeded catalogue against what the T1 pages actually render, by
querying Mongo rather than reading the seed file:

```
products 26   categories 12   brands 6
  with >=1 image : 0        <-- every product
  on sale        : 7        out of stock : 2      low stock : 4
  featured       : 6        no brand     : 13
  rating.count 0 : 0        max category depth : 1
  brands with 0 products : none
```

**Four states the T1 pages handle were unreachable from the seed**, which meant
a migration could break any of them and still look correct:

| State | Rendered by | Seed support |
|---|---|---|
| a product image | every card, the detail hero | **0 of 26** |
| the gallery / thumbnail strip (`images.length > 1`) | `/products/[slug]` | **0** |
| "no reviews yet" (the rating widget renders nothing) | every card | **0** |
| a brand that stocks nothing | `/brands/[slug]` empty state | **0** |
| a breadcrumb deeper than two levels | `/categories/[slug]` | **0** |

Extended to **34 products / 13 categories / 7 brands**: 12 products with images
(8 with 2+, 5 with 3), 2 with no reviews, 3 out of stock, 6 low stock, 11 on
sale, 8 featured, 17 with no brand, one brand (`sparkfun`) stocking nothing, and
one depth-2 category (`imu-modules`). Idempotency re-proven: two runs leave
34/13/7 unchanged, zero primary-image invariant violations.

Images carry a provider-relative `publicId` in the namespace the upload API
writes to — never a URL (`MEDIA-MODEL.md` §3). With no Cloudinary account they
resolve to nothing and the placeholder renders, which is correct; the LAYOUT is
still driven by real image counts and real dimensions.

**Acceptance criterion corrected.** Phase 4 demanded T1 routes render
"pixel-equivalent to before". That is impossible — the two catalogues hold
different mock data by design (D-6) — so the criterion is now **structural
parity**: same layout, same components, every state still handled. A criterion
that cannot be met is one that gets quietly ignored.

---

## Step 1 — media upload API

`Client → NestJS → Cloudinary` per ADR-MEDIA-001. Three endpoints
(`POST`/`DELETE /admin/media`, `GET /admin/media/reconciliation`), the
`mediaAssets` reference ledger, and `MEDIA_PROVIDER` switching through
`ProvidersModule` — the same one switch, in the same one file, as
`EMAIL_PROVIDER`.

**The credentials were not there.** The brief said Cloudinary credentials are in
`.env`; they are not, anywhere in this repository. Per the instruction the
endpoint was built and tested anyway, and the gap is recorded rather than worked
around: the adapter's request shape is asserted against the SDK contract, but no
call has ever reached a real account, so its response mapping is unproven.

An in-memory adapter — the media counterpart of the console email sender — runs
the entire pipeline without an account, which is what makes the other 95% of
this provable today.

**163 assertions across three suites**, weighted deliberately towards refusals:
a JPEG declared as PNG, an SVG (honest and lying), a PDF, a zip, plain text,
oversize, an image below the minimum edge, an empty part, a missing part, a
path-traversal filename, an `entityId` containing separators, and a signed-in
CUSTOMER — each asserting that **nothing was stored**.

Proven rather than assumed: EXIF orientation is applied *before* stripping (get
that backwards and every phone photo comes out sideways); 6000px downscales to
4000 while 600px is not upscaled; the ledger never goes negative and does not
lose 20 concurrent increments; a referenced asset is refused with its count; and
the port resolves to the memory adapter with no credentials present — the media
equivalent of the F-07 guarantee.

**A test caught a contradiction in my own docstring.** I had written that
reordering images promotes a new primary, while `setPrimary` argued that order
and primary are independent questions. The code was right and the docstring and
test were wrong; the corrected test records why.

---

## Step 2 — catalogue import tool

`pnpm --filter api catalogue:import -- --file <csv|json> --profile <json> [--dry-run]`

Column mapping is configuration. Two profiles ship and the second exists to
prove the point: `nest-standard` reads our own headings, `supplier-example`
reads a semicolon-separated file with German headings, `1.299,00` prices and
Ja/Nein booleans. The tests import **the same three products from both** and
assert the catalogue matches — nothing but the JSON differs between the runs.

Idempotency is *observable*, not asserted: `unchanged` is a separate outcome
from `updated`, so a second run reports "3 unchanged, 0 updated" rather than a
number that would look identical if the tool rewrote everything. Proven at the
CLI:

```
pass 1   created 3, updated 0, unchanged 0, skipped 1, errored 1
pass 2   created 0, updated 0, unchanged 3, skipped 1, errored 1
```

with no duplicate rows, `89.5` stored as 8950 and `1,299.00` as 129900.

### Five bugs the tests found, each fixed in the code rather than the test

1. An absent short description wrote `{ en: '' }`, which the schema refuses.
   Found by the first fixture that omitted the column entirely — the CSV
   fixtures all happened to carry one, which is exactly how this kind of hole
   survives.
2. Unmapped optional numeric columns became `NaN` and failed every row with a
   Mongoose cast error.
3. A profile could not declare a supplier's own yes/no words, so the German feed
   errored on every row. `trueValues` / `falseValues` are now declarative.
4. **`89.5` parsed as 89,500 EGP** — a thousandfold overcharge from an entirely
   ordinary-looking cell. The rule required exactly two decimal digits; one is
   also a decimal.
5. Running the documented command failed before reading anything: pnpm forwards
   the literal `--`, which the argument parser treated as a flag needing a value.

### And one deeper correction

A profile is a statement about which columns a file HAS. A field it does not
mention is one that feed has **no opinion about** — not one it says is empty.
Writing whole documents meant importing a price list nulled every product's
weight, and importing from a second supplier undid the first. It now writes
dotted `$set` paths for mapped fields only.

Documented for a non-developer in `docs/api/CATALOGUE-IMPORT.md`.

---

## Step 3 — the T1 read migration

Every T1 route is API-backed. **No `@nest/services` import remains in any of
them**; only `/blog` still reads Supabase, and blog is a Phase 8 domain.

An adapter (`lib/api/view-model.ts`) reshapes API types into what the existing
components already accept, so **no component changed**. That was the point: a
page that renders differently can then only be a data problem, and there is
exactly one place to look. The file is temporary by design and says so — Phase 9
deletes it whole.

### Three storefront types had never matched the contract

`discountPercent` (the API sends `discountPercentBps`), `stockQuantity` (the API
sends `stockOnHand`), and `ProductImage` missing `version`, `format`, `width`
and `height`. All three were latent — a wrong type costs nothing until the first
reader, and the `/shop` slice never showed a discount badge or a stock count.
T1 pages do.

### The build broke, and it was mine to break

`apiFetch` sent `cache: 'no-store'` **and** `next: { revalidate }` on the same
request. Those are opposite instructions — Next's own docs give
`{cache:'no-store', next:{revalidate:0}}` as the definition of `force-dynamic` —
so `no-store` won and **`revalidate` had never once taken effect**.

Harmless while every caller was a `force-dynamic` page. Fatal the moment the
navbar put such a call in the ROOT LAYOUT: a no-store fetch in a layout opts the
entire application out of static rendering, and `next build` then failed to
prerender `/account`, `/blog` and `/_not-found` — pages with nothing to do with
the catalogue — each reporting *"couldn't be rendered statically because it used
no-store fetch .../categories/tree"*. Fixed at the client; `/categories` is
prerendered static again with a 5-minute revalidate.

### A latent bug the migration exposed

`MobileMenu` is written against a FLAT category list — it asks
`categories.some(c => c.parent_id === category.id)` — and the legacy service
returned a NESTED tree, where that is false for every category. **No subcategory
has ever appeared in the mobile menu.** Giving each consumer the shape its own
code reads fixes it. That is a user-visible change and is recorded as one; the
alternative was knowingly feeding a component data it cannot interpret in order
to preserve a bug.

### Six more corrections, each in the page that had it

| Was | Consequence |
|---|---|
| sitemap asked for `limit: 5000` | the API caps at **100** (checked); transplanted unchanged it would have produced an empty sitemap and an error nobody watches |
| sitemap mapped over the category TREE | silently omitted all seven subcategories |
| price-slider bounds computed from the current PAGE | page 2 offered a different range from page 1, and neither was the range of the result set |
| related products fetched 5 and filtered client-side | the row silently varied between four and five items |
| gallery re-sorted with `.sort((a) => a.isPrimary ? -1 : 1)` | not a valid comparator — it ignores its second argument, so the order depended on the engine |
| JSON-LD listed images whose URL is null | structured data naming an image with no URL is reported as invalid |

### Two deliberate, flagged changes

- **"Featured" became a filter, not a sort.** `featured` is not in the frozen
  sort enum (`SEARCH-MODEL.md` §5); the API offers it as a filter. Preserving
  the sort exactly means adding a value to a frozen contract — an owner
  decision, not something to slip into a read migration.
- **Six category tile images were COPIED to the API's root slugs.** The files
  were named for legacy slugs the API does not use, so every tile on the home
  page would have fallen back to a generic icon *and* fired a failed image
  request. No artwork was drawn and none deleted.

### A pre-existing defect found, measured, and deliberately not fixed

`notFound()` on a streaming route renders an **empty `<main>`** — header, footer,
nothing between. Measured side by side in one browser session:

```
/this-route-does-not-exist         404  main=112 chars  h1=["Page Not Found"]
/products/definitely-not-real      200  main=0          h1=[]   <- UN-MIGRATED, Supabase
/brands/not-a-real-brand           200  main=0          h1=[]   <- migrated
/categories/does-not-exist-at-all  200  main=0          h1=[]   <- migrated
```

The un-migrated route behaves identically and a route with no page at all still
renders its 404, so the trigger is streaming, not the data source. Next
documents the 200 status and applies its own mitigation — the `noindex` tag is
present, so nothing is indexed. The blank body is a separate matter, and both
remedies (removing the root `loading.tsx`, or an existence check in `proxy.ts`)
are decisions with costs beyond T1. The specs assert what is true rather than
pinning the defect in place.

### The security fix found on the way

`dangerouslyAllowSVG: true` was set in **both** `next.config.ts` files.
`MEDIA-MODEL.md` §5 item 6 and §12 require its removal: SVG is executable markup
and one served from a whitelisted image host is a stored-XSS vector (Phase 0
M3). Nothing in either `src/` renders an SVG through `next/image`, so removing
it cost nothing.

### Three Playwright assertions were wrong before they were right

Each is recorded in the spec that has it: a hover-revealed menu asserted without
hovering; a 404 status Next documents as 200 for streamed responses; and a
product count that double-counted because every card links to its product twice.

---

## SESSION 3 — final state

| | Session start | Session end |
|---|---|---|
| jest suites | 22 | **26** |
| jest tests | 563 declared, **19 failing** (missing indexes) | **697, all green** |
| Playwright | 4 | **37, all green** |
| root build / type-check / lint | build green | **all green** |
| OpenAPI drift gate | green | **green** (artifact regenerated for the media endpoints, additive) |
| Supabase reads in T1 routes | 9 files | **0** |

The 19 failures at the start were environmental, not a regression: every
application index had vanished from the development database and
`pnpm --filter api indexes:sync` restored them. `autoIndex` is off by design, so
that is a silent state — the API starts and serves traffic, and only the tests
notice.

**16 commits**, all on `phase-1-2-overnight`, nothing pushed, no history
rewritten, nothing reverted.

---

# SESSION 4 — Phase 5a (additive only)

Baseline before any change: jest **696 passed, 1 failed** (697), Playwright not
yet run. The one failure was mine and is described below.

## 1 — index enforcement

`GET /health/ready` now refuses traffic when any declared index is absent.

**The check found a real defect on its very first run**, before any test was
written to look for one: `mediaAssets.media_asset_public_id_unique` and
`media_asset_unreferenced` did not exist in the development database. They were
added with the media ledger last session and `indexes:sync` was never run
afterwards, so the ledger has been running for a session with **no unique
constraint on `publicId`** — the exact class of silent absence this task is
about. Fixed by running the sync.

### What it checks, and why `diffIndexes()`

Mongoose's `diffIndexes()` is the primitive `syncIndexes()` itself uses, so the
probe cannot disagree with the command it recommends. It also catches the case a
name comparison cannot see. Measured, on a scratch collection:

```
index `scratch_email_unique` created WITHOUT unique, under the declared name
  diff        -> toDrop:["scratch_email_unique"], toCreate:[{email:1}]
  two documents with the same email  -> BOTH STORED
```

A check asking "does an index of that name exist?" reports healthy there. The
guarantee is gone.

### Deliberate boundaries

- **Fails on missing, reports on extra.** An index the schemas no longer declare
  wastes write throughput but breaks no invariant; refusing traffic over it
  would turn a tidy-up into an outage.
- **Liveness untouched, and asserted so.** Restarting cannot create an index, so
  a missing one must drain traffic without triggering a restart loop.
- **No cache.** A cached healthy verdict would keep reporting green after a drop
  and — worse — keep reporting red after the remedy was run, sending an operator
  to reach for a restart. Measured at one round trip for all 13 collections.
- **Cloudinary is still not a readiness check**, now for a better reason than
  "it does not exist yet": readiness failing drains traffic, so a Cloudinary
  outage would take the storefront down because a dependency only *admin upload*
  needs was unavailable.

### Two bugs found on the way

1. **A leaked timer in `pingMongo`.** `Promise.race` settles on the winner but
   does not cancel the loser, so every successful readiness probe left a 2-second
   timer holding the event loop. Invisible in production; visible as "jest did
   not exit one second after the test run" the moment a suite probed readiness.
   Cleared in `finally`.
2. **A test that read a secret.** `media-upload.spec.ts` asserted
   `process.env.CLOUDINARY_API_KEY` was undefined — encoding one machine's
   temporary state as a permanent property. It broke the moment the account was
   supplied, **and printed the API key into the failure output**, from there into
   any CI log holding it. It now asserts the thing that actually decides whether
   bytes leave the machine: which adapter the port resolved to.

### The drift gate had to learn a distinction

Adding `checks.indexes` was reported as **BREAKING** — "property newly
required". The gate's own docstring already called this out as a deliberate
over-report: newly-required is fatal in a request body and harmless in a
response, "and this gate does not try to tell which it is looking at".

The alternatives were both worse than fixing it: mark the field optional (a
permanent lie in the public contract — it is always sent), or regenerate past a
gate whose message says not to. So the gate now classifies schemas by
reachability through `$ref`, transitively. A schema is exempt **only** if it is
reachable from a response and not from a request; reached by both is fatal, and
so is reached by neither, because "I cannot tell" must resolve to the fatal
reading.

It had no tests. It has 16 now, weighted towards the direction that costs a
release: every category it caught before is asserted still caught, and the
exemption is proven unreachable from a request body, a nested request DTO, a
`$ref` inside an array, a query parameter, a schema used in both directions, and
a schema nothing references.

**Other invariants that depend on an index that could be absent** — the answer
to the question asked, and it is worse than the two named in the brief.
`CredentialRepository` and `CartRepository` both catch MongoDB error `11000` and
translate it. **That is their entire concurrency control.** No index, no error,
no `catch`, and the race silently succeeds:

| Index | What stops being prevented |
|---|---|
| `users.user_email_unique` | two accounts on one email address |
| `orders.order_idempotency_key_unique` | a retried checkout becoming two orders |
| `orders.order_number_unique` | two orders sharing one customer-facing number |
| `inventoryEvents.inventory_event_reference_unique` | one order line decrementing stock twice |
| `carts.cart_user_unique` | a customer holding two carts |
| `products.product_sku_unique` | catalogue import duplicating instead of upserting |
| `mediaAssets.media_asset_public_id_unique` | two ledger rows for one asset — **and this one was actually missing** |

TTL indexes (`refresh_token_ttl`, `cart_ttl`, `idempotency_ttl`) are a separate
class: their absence corrupts nothing, it just means expired documents are never
reclaimed. Reported, but not what makes this a gate.

Documented in `docs/api/SANDBOX.md` §3 and §7 and a new section of
`docs/api/INTEGRATION.md`.

## 2 — shipping rates, the D-8 model

`shippingRates` exists with the frozen shape — `MONGODB-DESIGN.md` §11 and
`MONEY-MODEL.md` §6 adopted unchanged, nothing amended. 27 rows, unique
`{governorate:1}`, Cairo and Giza 5 000 pt and the other 25 at 10 000 pt.

`FulfilmentService.quote()` is now `async` and reads the table. That is the
whole change to callers: `governorate` was made a parameter before it was
consulted, precisely so this substitution would not touch them, and the frozen
public API is still `quote(governorate, subtotal)`.

### Three outcomes, not two

The miss path is the point of D-8, and it is not the same as "no address yet":

| Input | Result | Why |
|---|---|---|
| a governorate with a row | `{ fee, priced: true }` | ordinary |
| `null` governorate | `{ fee: 0, priced: false }` | the customer has not chosen an address; an ordinary step of checkout |
| a governorate with **no** row | **raises** `SHIPPING_RATE_MISSING` (500) | bad data — the table is incomplete |

Conflating the middle row with the last one would turn the checkout page into a
500 before the customer picks an address. Conflating it the other way would
quote a fee nobody decided.

The raise is a **500, not a 4xx**: the governorate is closed to a validated list
on both sides, so this is unreachable by any input a customer can send, and
answering 400 would blame them for the operator's missing row. It names the
governorate in the LOG and not in the response, because which parts of the rate
table are incomplete is operational information and this surfaces mid-checkout.

### `SHIPPING_FLAT_FEE` — removed, not deprecated

A knob nothing reads is worse than one that does not exist: it survives in
`.env.example` files and deployment manifests, somebody eventually sets it
expecting an effect, and nothing anywhere says why there was none. `.env.example`
carries a tombstone pointing at `shipping:seed` instead. Safe to remove because
the env schema is a plain `z.object`, so an unknown key is stripped rather than
rejected — an existing `.env` still boots.

`FREE_SHIPPING_THRESHOLD` stays, implemented and off. A row may carry a
threshold of its own, which wins for that governorate; **none does**. That
precedence is a decision I made rather than one I was given — see "Needs owner".

### `shipping:seed` is a release step, and non-destructive

Separate from `seed`, which is development fixtures that must never reach
production (D-6). This is the opposite: with no fallback row, an empty
collection means **every checkout in the country raises**.

`$setOnInsert`, never `$set`. Every row is independently editable (D-8), so a
re-seed that reset an adjusted Alexandria rate from 12 000 back to 10 000 would
be a silent pricing change and the person who ran it would have no reason to
look. Stated in the command's own output: adds missing rows, leaves existing
ones alone. The script also **asserts the row count** and exits non-zero on 26,
because a short table is not a smaller table — it is one governorate whose
customers cannot check out, and nothing else says so until one of them tries.

### Tests

38 across two files, split by what each can actually prove.

- `fulfilment.spec.ts` (24) — the policy, over a stand-in repository. The **full
  fee table**, every one of the 27 rows: a spot check on two or three would pass
  just as happily if `Giza` had been typed `Gizah` and 26 rows were on the
  standard fee.
- `shipping-rates.spec.ts` (14) — the collection against the real database. The
  unique index is asserted **by inserting a duplicate and being refused**, not by
  reading `listIndexes`: an index can exist under the right name without
  `unique`, which §1 measured storing two duplicates while looking healthy.

The three `shippingPriced` states are re-proven with real rates in place, and
one test exists purely to show the property test is not vacuous — a property
over "never unpriced and non-zero" passes trivially if the interesting state is
never reached.

Also asserted: the fee is read **fresh on every quote**, proven by editing a row
and re-quoting without a restart. That is the reason the repository holds no
cache — money a customer is shown must not be a function of how long a process
has been up.

### Four downstream assertions had encoded the absence of rates

`checkout.spec.ts` and `addresses.spec.ts` asserted `shippingFee === 0` and
`shippingPriced === false`. Correct then, wrong now. Each was updated to the
state it actually exercises — with an address it is priced, without one it is
not — and the expected figure is **derived from the seed** rather than written
as `5000`, so the suites fail if what checkout charges ever stops matching the
ratified table rather than agreeing with a second copy of the same mistake.

One is worth naming: the pricing-identity test asserted
`grandTotal === subtotal − discount + shipping` while shipping was always 0, so
the equation held whether or not the code added the term. It now runs against a
non-zero fee.

## 3 — password reset and profile endpoints

`POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`,
`PATCH /users/me`. 35 tests, all at the HTTP boundary.

### A path conflict, resolved and flagged

`AUTHORIZATION-MODEL.md` §2.8 — a **frozen** document — sketches these as
`POST /auth/forgot-password` and `POST /auth/reset-password`. `PLAN.md` §9 and
the 5a brief both name `/auth/password-reset/request` and `/confirm`.

Built the briefed paths, because the brief is explicit and the most recent
instruction. **Everything §2.8 actually specifies is honoured exactly** — neutral
responses, hashed at rest, single-use, 1-hour TTL, `tokenVersion` bump, full
refresh-token revocation. Only the two URLs differ. Recorded in `PLAN.md` §9 and
`docs/api/INTEGRATION.md`, both of which now say plainly which document is the
authority on the URL. **Cheap to change while nothing consumes them; that stops
being true in 5b.**

### The security properties, and why each is tested

| Property | What breaks without it |
|---|---|
| identical response for known / unknown / unverified / deleted | an unauthenticated account-existence oracle |
| **no email** for an unknown address | a way to send mail to arbitrary addresses |
| token hashed at rest | database read access becomes account takeover |
| single-use | a link seen once still works after the password changed |
| requesting again invalidates the previous link | every "didn't get it" click leaves another live key in a mailbox |
| unknown / expired / used are one error | a stolen token reveals whether it was ever valid |
| a **verification** token is refused here, and vice versa | an email-verification link becomes a password-reset link |

That last one is the one worth naming. Both tokens are 32 random bytes stored as
a SHA-256 digest with an expiry — **nothing in the type system tells them
apart**. Only the separate field and the separate lookup do. So they get separate
fields, separate lookups, and a test in both directions.

### The transaction, and why it is one

A reset does three things to the credential and one to sessions:

```
$set passwordHash          the reset itself
$set passwordReset: null   makes the token single-use
$inc tokenVersion          kills outstanding ACCESS tokens (15 min)
revoke all refresh tokens  kills the 30-day tokens the bump cannot reach
```

The first three are one update. The fourth is a different collection, so it runs
in the **same transaction** — the split state is the one that defeats the whole
feature: password changed, attacker's refresh token still alive, still minting
access tokens for thirty days, now under the new password.

`revokedReason` is `PASSWORD_RESET`, not `LOGOUT_ALL`. Someone reading that field
after a takeover needs to see the sessions ended because the password changed,
not because the owner pressed a button.

The update's filter re-checks the token hash, so two confirmations racing on one
token cannot both win — the loser matches nothing and is reported as an
already-used token, which is what it is.

### Two ordering decisions

- **Password policy runs AFTER the token is resolved**, because it refuses a
  password containing the account's email and needs to know whose token this is.
  The side effect is worth having: the weak-password error is only reachable by
  someone who already holds a valid token.
- **A refused password does not burn the token.** Otherwise a customer who typed
  something too short has to start the entire flow again, from the email.

### `PATCH /users/me`

`fullName` and `phone` only. `email`, `role`, `passwordHash`, `emailVerifiedAt`,
`tokenVersion`, `_id`, `createdAt` and `addresses` all return `400 UNKNOWN_FIELD`
— refused, not ignored — and the service builds its `$set` from named fields
rather than spreading the DTO, so the guarantee does not rest on the validation
pipe alone.

`phone: null` clears the number and is distinct from omitting the key. Building
the update from `!== undefined` rather than truthiness is what keeps them
distinct; a truthiness check would silently ignore a deliberate `null` and leave
the old number for a courier to ring.

An empty patch is a no-op rather than an empty `$set`, which MongoDB rejects.

There is deliberately **no `GET /users/me`** — `GET /auth/me` already returns
this shape and is what every client calls. A test asserts the two return the
same body, because the shape is described by two DTO classes: moving one across
modules would close a dependency cycle, and deleting one is a breaking contract
change. Duplication that cannot drift is the cheaper mistake.

### The template inventory guard earned its keep

Registering `auth/password-reset` in the id union failed
`email-rendering.spec.ts` immediately: a template id with files but **no
rendering fixture**. Exactly the hole it was written for. Six rendering tests
followed, including one asserting the email says "1 hour" and *not* "24 hours" —
the two templates are deliberately similar and the second was written by copying
the first.

### Contract

Additive: 2 new paths, 1 new operation on an existing path, 5 new schemas. The
gate confirmed additive before the artifact was regenerated.

## 4 — the blank 404

**Status fixed. Body not, and the reason is measured rather than guessed.**

Every dead product, category and brand URL answered **200**. That is a soft 404:
indexable, counted as a successful page view, and invisible to any monitoring
that watches 4xx.

### What the fix was

Next gives two remedies: check existence in `proxy.ts` before the body streams,
or "ensure the resource exists before the response body is streamed". **The
proxy is out of scope for 5a**, so the second one — and the body starts
streaming "when a Suspense fallback renders (for example, a `loading.tsx`)".

Removed: the root `app/loading.tsx` and the `loading.tsx` of
`products/[slug]`, `categories/[slug]`, `brands/[slug]` and `blog/[slug]`.

`app/products/loading.tsx` was the awkward one — it covers `[slug]` as well as
the listing, so the listing's skeleton was forcing a 200 on every unknown
product. Rather than delete the skeleton from the page that most needs it, the
listing moved into a **`(listing)` route group**. A route group is not a path
segment, so `/products` is unchanged and keeps its skeleton, while
`/products/[slug]` no longer inherits it.

### The full measurement, because three separate things were going on

```
how notFound() is reached                     status   designed page
URL matches no route at all                     404     RENDERED
thrown synchronously, before any await          404     RENDERED
thrown after an await, no loading.tsx above     404     empty
thrown after an await, loading.tsx above        200     empty      <- was here
thrown from generateMetadata after an await     404     empty
```

Every data-driven 404 moved from the fourth row to the third. **The status is
fixed; the body is still empty.**

I could not fix the body within scope, and it is worth being precise about why.
A data-driven 404 must ask the API whether the thing exists, so it always
awaits — which is exactly the case Next's docs warn about: *"Place `notFound()`
before those boundaries and before any `await` that may suspend."* No in-page
arrangement satisfies both. Tried and measured as not working: a segment-level
`not-found.tsx`, a re-exported one, and throwing from `generateMetadata`.

The remaining half needs the existence check in `proxy.ts`, which is 5b's.

### Two things found on the way

1. **The root `app/not-found.tsx` never caught `notFound()` at all.** It covers
   URLs that match no route. A segment that throws needs its own
   `not-found.tsx`, and a bare `export { default } from ...` does not register
   as one — both measured. Five route files now render one shared
   `NotFoundContent`, so there is a single copy of the markup.
2. **The root `loading.tsx` was a product-grid skeleton on a legacy class**,
   shown on `/about`, `/contact`, `/login` and everything else without its own.
   Removing it is closer to a fix than a regression.

### What this costs, and it is a real cost

The four detail routes have **no loading skeleton**. A click on a product shows
the previous page until the server responds. Accepted deliberately: a correct
status on every dead link against a skeleton on four routes — and reversible,
because the proxy check that fixes the body would also let every `loading.tsx`
come back.

### The spec

`e2e/not-found.spec.ts`, 10 tests. The status, the `noindex`, the absence of
catalogue content, and — separately — **`test.fail()` on the rendered page**.

`test.fail()` rather than a skip, deliberately: a skipped test proves nothing
and rots. This one runs, asserts the real thing, and **turns the suite red if it
ever passes** — which is the signal to delete the workaround rather than let it
outlive the bug.

Three older T1 tests covered the same ground more weakly (they asserted
`noindex` but deliberately not the status, because the status was the defect).
Removed rather than duplicated, with a pointer where they stood — and the long
measurement note in `t1-taxonomy.spec.ts` went with them, because a second copy
of a measurement is a second thing to keep true.

## 5 — Cloudinary, proven

The credentials are real and everything works. **15 tests against the live
account**, opt-in via `pnpm --filter api test:cloudinary`.

### The response mapping was right, with one exception

The item recorded as unproven at the end of Phase 4 was the mapping. Measured
against a real upload, every field it reads is present with the assumed type:
`public_id` string, `version` number, `format` string, `width`/`height` number,
`bytes` number. `destroy` answers `{result:'ok'}` then `{result:'not found'}`,
exactly as the retry story assumed; `api.resources` returns
`next_cursor: undefined` when exhausted, which is what the paging loop tests.

**One field was wrong: Cloudinary answers `format: "jpg"`.** Everything else in
the system — the sniffer, the MIME allow-list, the in-memory adapter, sharp —
says `jpeg`. Left alone, the same photograph would be recorded with a different
`format` depending on which adapter stored it, and a port whose output shape
depends on the vendor behind it is not a port. The adapter now maps that one
spelling. Deliberately a one-entry alias table rather than a general normalise
step: a genuine transcode (`png` back from a JPEG upload) still passes through
visibly, which is what MEDIA-MODEL.md §4 wants when it makes the response the
authority for what was stored.

The upload response also carries `api_key` and `signature`. Neither is mapped,
and the probe that measured all this redacted both rather than printing them.

### The account is SHARED with another application

It holds **108 assets that are not ours** — `partners/images/...` and
`users/avatars/...` from an unrelated product.

Nothing here can touch them: uploads, listings and the reconciliation report are
all scoped to `folderRoot`. But that scoping stopped being tidiness and became
load-bearing, so two things changed:

- **`MEDIA_FOLDER_ROOT` is now configurable** (default `nest`). Staging and
  production pointing at one cloud with one root would each see the other's
  assets as orphans in the reconciliation report. Validated to lowercase
  path-safe characters with no `..`, because it is concatenated into a
  `publicId`.
- Documented in `SANDBOX.md`: **never run a bulk delete against the account
  without a prefix.**

### What the 15 tests cover

Upload of all three formats; the stored identifier is provider-relative and
**no absolute URL appears anywhere in the response** (asserted over the whole
serialised body, not a field list, so a future field carrying one fails too);
retrieval from Cloudinary under exactly that id; EXIF stripped with orientation
baked in first (a 1200x800 tagged "rotate 90" is stored 800x1200); a 6000px
image downscaled to 4000.

Every refusal is asserted **against the real account with a list before and
after** — a JPEG claiming to be a PNG, an SVG both honest and lying, an oversize
file, an image below the minimum edge, a signed-in CUSTOMER. That before/after
list is the only check that would notice a refusal happening *after* the upload
rather than before it.

Delete removes the remote object, not just the ledger row. The reconciliation
report names a real orphan and **does not delete it**.

### `--images` is unblocked

Every file goes through `MediaService`, so a supplier's photograph gets the same
sniffing, size cap, EXIF strip and ledger row as one an operator drags into the
admin. A supplier folder is untrusted input that nobody looked at.

**Idempotency is by construction: a product that already has images is left
alone.** Re-uploading would give the same photograph a second identity —
duplicates on the product, and the first copy orphaned in the account, on every
run. Proven twice: 14 offline tests, and a live two-run case asserting **the
same public ids**, not merely the same count.

Verified by hand against the real account as well:

```
pass 1   created 4, images uploaded 3, failed 1   -> cloudinary holds 3
pass 2   unchanged 4, uploaded 0, skipped 3       -> cloudinary holds 3
ledger   3 rows, refCounts [1,1,1], 0 primary-image invariant violations
```

The `failed 1` is the deliberately mislabelled PNG-named-`.jpg` — refused, named
in the report, and the product imported without it.

### Three bugs found while building it

1. **Nothing had ever called `retain()`.** Reference counting is what makes
   `DELETE /admin/media` refuse to destroy an image a live page is showing — and
   every ledger row sat at `refCount: 0`, because until now nothing in
   production ever ATTACHED an image. Harmless while no product had one; a live
   defect the moment the import gave them some. `MediaService.retain/release`
   now exist and the import calls `retain` **after** the product write, so a
   failure leaves the count at zero rather than at one with nothing referencing
   it. Phase 7's upload UI needs exactly this.
2. **A profile that does not map `brandSlug` skipped every row** with
   `brand "undefined" does not exist`. `brandSlug` is optional, so a feed with
   no brand column is legitimate — but unmapped, `String(undefined)` is the
   literal `"undefined"`. Both shipped profiles map a brand column, which is
   precisely why no test caught it. Found by my own fixture on its first run.
3. **The report showed the HTTP-safe refusal message** — "The uploaded file was
   rejected" — instead of the specific reason. Useless to the person holding the
   file; it now says which check failed.

### Two bugs in my own test fixtures, worth recording

The image-import spec cleaned up by SKU prefix and left 13 products behind,
because **the schema uppercases `sku`** and the prefix was lowercase — the same
shape as the cart-test bug from session 3. And the product names were not
run-scoped, so the derived slug collided with a previous run and tripped
`product_slug_unique`. Both fixed; the second one is why the leftovers were
noticed at all.

### Cleanup, asserted rather than assumed

Every test upload goes under `dev-test/<runId>/`, and `afterAll` lists that
prefix from Cloudinary and destroys what it finds — by what the account actually
holds, not by what the ledger recorded, so a case that failed between the upload
and the ledger write still cleans up. It then asserts the prefix is empty. A
cleanup nobody checks is how a test account fills with a decade of orphans.

Independently audited afterwards: `dev-test` 0, `nest` 0, and the 108 foreign
assets untouched.

### Secrets

`.env` is still gitignored. Every tracked file plus the four new ones swept for
the cloud name, the API key and the secret: **no match**. The OpenAPI artifact
is clean. The one test that ever read a credential — asserting the API key was
undefined, and printing it when that broke — was removed in section 1.

## SESSION 4 — final state

| | Before | After |
|---|---|---|
| jest | **696 passed, 1 failed** (697) | **800 passed, 15 skipped** (815) across 33 suites |
| Playwright | 37 | **44** |
| Cloudinary integration | 0, and unprovable | **15**, against the real account, opt-in |
| root `build` / `type-check` / `lint` | green | green |
| OpenAPI drift gate | green | green — **additive** at every step |

The 15 skipped are the Cloudinary suite: it is opt-in
(`pnpm --filter api test:cloudinary`) and prints a line saying so on every
default run, so it cannot be quietly forgotten.

**The one failure at the start was mine**, from session 3: a test asserting
`process.env.CLOUDINARY_API_KEY` was undefined. It broke the moment the account
was supplied and **printed the API key into the failure output**. Fixed in §1.

### Commits

| | |
|---|---|
| `36174a3` | readiness fails when a declared index is missing |
| `b9f959e` | the D-8 shipping rate table, and a miss that raises |
| `2f38682` | password reset and profile update |
| `446fc90` | a dead link answers 404, not 200 |
| `41ae0ad` | the media pipeline, proven against the real Cloudinary account |

Branch `phase-1-2-overnight`, **39 commits ahead of `main`**, nothing pushed.
`main` untouched at `6d0673a`, still tagged `baseline-phase-0`. No history
rewritten, no stash, no `.bak` files, no probe routes left behind.

### Needs owner

1. **The `/auth/password-reset/*` paths contradict a frozen document.**
   `AUTHORIZATION-MODEL.md` §2.8 says `/auth/forgot-password` and
   `/auth/reset-password`; `PLAN.md` §9 and the 5a brief say
   `/auth/password-reset/request` and `/confirm`. I built the briefed pair and
   honoured §2.8's behaviour exactly. **Cheap to change while nothing consumes
   them; that stops being true in 5b.**

2. **A `shippingRates` row may carry its own free-shipping threshold, and a row
   threshold wins over the configured one.** The frozen shape gives the
   collection a threshold, so the field exists; nothing sets one, so nothing
   changes today. The precedence is a decision I made rather than one I was
   given, and it is worth ratifying before anything depends on it.

3. **The Cloudinary account is shared with an unrelated application** — 108
   assets under `partners/` and `users/avatars/`. Everything here is
   prefix-scoped so they cannot be touched, but it is worth deciding whether
   this shop should have its own account before it holds real photographs.

4. **The blank 404 body needs `proxy.ts`**, which is 5b's. Status is fixed;
   body is not, and cannot be from inside a page.

---

# SESSION 5 — cleanup before Phase 5b

Baseline before any change: jest **800 passed, 15 skipped** (815), Playwright
**44**.

## 1 — secret audit

**Nothing reached git. No credential needs rotating.**

### What was searched, and how

Every blob of every commit on **all 54 commits across all refs**, for the literal
VALUE of each of six variables — not filenames, not patterns. `git grep -F` over
`git rev-list --all`, so a value that appeared in one commit and was removed in
the next is still found.

| Variable | Result |
|---|---|
| `CLOUDINARY_API_KEY` | clean across all commits |
| `CLOUDINARY_API_SECRET` | clean across all commits |
| `CLOUDINARY_CLOUD_NAME` | clean across all commits |
| `JWT_SECRET` | clean across all commits |
| `BREVO_API_KEY` | clean across all commits |
| `MONGODB_URI` | **matches — and is not a secret**, see below |

`WORK-LOG.md`, `HANDOFF.md`, `docs/`, `docs/api/openapi.v1.json`, every fixture
and every test file are all tracked, so all of them were covered.

### The one match, and why it is not a finding

`MONGODB_URI` is `mongodb://127.0.0.1:27017/…` — **localhost, no username, no
password**. It appears in `apps/api/.env.example` and `docs/api/SANDBOX.md`
deliberately, as the documented development connection string. The audit checks
for an embedded password separately and found none.

Reporting it as an exposure would be worse than useless: it would train whoever
reads the next audit to wave the result through.

### The working tree and local logs

Clean, outside the `.env` files themselves — which are gitignored (`.gitignore:18`
for `apps/api/.env`; `apps/{storefront,admin}/.gitignore:35` for `.env.local`).

Scanned every file including gitignored ones: `.next/`, `dist/`, Playwright
`test-results/`, the Next dev log, and this session's own scratch scripts. All
clean. **Removed anyway**, per the brief: eight `next dev` logs, the Playwright
results tree, the Next development log, and the scratch files from session 4.

### Why the result is trustworthy

Both search mechanisms were **proved to detect before being believed**:

- the local scanner found a planted canary containing the real cloud name and
  API key, and reported it;
- the history search found a string known to be in history.

A scanner that reports "clean" and has never been shown to detect anything is
not evidence.

### Root cause

The offending assertion was already removed in session 4. Swept the whole suite
again: **exactly one test reads a credential**, `cloudinary-integration.spec.ts`,
and it does it correctly — the values are passed to the adapter and nowhere
else, and its error message names the VARIABLES rather than what they contain.
The rule is now written at that site, with the incident that taught it.

### The guard

`test/infrastructure/secret-hygiene.spec.ts` fails if any credential value
appears in any git-tracked file.

- **Pattern-based, not a list**: any variable whose name contains `SECRET`,
  `API_KEY`, `PASSWORD`, `TOKEN`, `CREDENTIAL` or `PRIVATE_KEY`, so a
  `STRIPE_SECRET_KEY` added next year is covered the day it is added.
- **Reads `.env` AND `process.env`**, because a developer has the file and CI
  has the variables; reading one would pass vacuously in the place it matters.
- **Never prints a value.** A failure names the variable, the file and the line
  number — a guard that echoed what it found would put the credential into the
  CI log it exists to keep clean.
- **Carries its own canary**, because this test reports "clean" on every
  ordinary run and would otherwise never be exercised.
- **Says so when it has nothing to check**, so a green run on a fresh checkout
  cannot be mistaken for a verified one.

Proven in both directions: appending a real API key to `WORK-LOG.md` produced
`CLOUDINARY_API_KEY appears in: WORK-LOG.md:1898` — the variable and the line,
and no value. `WORK-LOG.md` was restored to zero diff afterwards.

**It deliberately does not** parse test sources for risky-looking expressions.
The original defect asserted `toBeUndefined()`, which looks entirely harmless;
checking the outcome rather than the shape is the check that cannot be fooled.

## 2 — password-reset paths adopt the frozen document

`POST /auth/password-reset/request` → **`POST /auth/forgot-password`**
`POST /auth/password-reset/confirm` → **`POST /auth/reset-password`**

`AUTHORIZATION-MODEL.md` §2.8 is the authority. `PLAN.md` §9 named them wrongly,
the 5a brief took the names from §9, and I built them that way without noticing
that a planning document was overruling a frozen one — the same mistake 26b
already caught for `shippingRates`. §9 is corrected **at the source**, so the
wrong names cannot propagate a third time.

The DTOs went with the paths: `ForgotPasswordDto`, `ResetPasswordDto`. **The
behaviour is untouched** — every one of the 19 tests passes unchanged apart from
the URL they post to.

What deliberately did NOT change: the template id `auth/password-reset` (the
frozen `TEMPLATE-ARCHITECTURE.md` §3 inventory names that file), the
`PasswordResetService`, and the `passwordReset` schema field. §2.8 governs URLs,
and its own title is "Password reset" — the concept keeps its name.

### The gate said BREAKING, correctly

```
drift gate: BREAKING CHANGE. This removes or changes something clients already use.
  - path removed: /api/v1/auth/password-reset/request
  - path removed: /api/v1/auth/password-reset/confirm
  - schema removed: PasswordResetRequestDto
  - schema removed: PasswordResetConfirmDto
```

Accepted for one reason with an expiry date: **nothing consumes them.** Verified
rather than assumed — `apps/storefront/src/app/forgot-password/form.tsx` still
calls `supabase.auth.resetPasswordForEmail`, there is no admin auth client, and
the Flutter application does not exist. The endpoints had existed for hours.

Recorded in `docs/api/INTEGRATION.md` beside the gate's own rules, including the
part that matters most: **this does not generalise.** Once 5b wires
`/forgot-password` to the API, the same rename breaks a shipped client and the
answer becomes "add a path, deprecate the old one".

## 2.1 — every other path §9 names, audited

§9 named only two things concretely: the reset pair (wrong, now fixed) and
`PATCH /users/me` (correct — it agrees with `AUTHORIZATION-MODEL.md` and
`BEHAVIOR-DECISIONS.md`). Everything else in §9 is prose.

So the audit was widened to **every endpoint path named in any frozen document,
against the 49 operations actually served**. Five disagreements, recorded in a
new **§9.1** and deliberately **not fixed**:

| # | Frozen document | Served | Why it is listed, not changed |
|---|---|---|---|
| 1 | `GET /users/me` (`AUTHORIZATION-MODEL.md` §12) | `GET /auth/me` | Same payload, different path; `INTEGRATION.md` already documents the deviation |
| 2 | `PATCH /orders/:id/cancel` (`ORDER-LIFECYCLE.md` §6) | `POST /orders/{id}/cancel` | Method only — a cancellation is an action |
| 3 | `PATCH /admin/orders/:id/status` (§6) | seven `POST /admin/orders/{id}/<action>` | The biggest: separate actions make the permitted edges the URL space itself, and `transition()` is still the single enforcement point §6 requires |
| 4 | `DELETE /admin/products/:id/images/:publicId` (`MEDIA-MODEL.md` §7) | `DELETE /admin/media?publicId=…` | The endpoint is entity-agnostic, and a `publicId` contains slashes so it cannot be a path segment |
| 5 | `PATCH /cart/items/:id` (`BUSINESS-RULES.md`) **vs** `PATCH /cart/items/:product` (`CART-MODEL.md`) | `{productId}` | **Two frozen documents disagree with each other**; the code follows the one that owns the cart |

Two apparent disagreements dissolved on inspection and are not listed:
`DELETE /orders/:id` appears in `API-CONTRACT.md` inside a table of endpoints
that must NOT exist, and both `GET /users/me` and `GET /auth/google` appear in
`INTEGRATION.md` only in sentences saying they do not exist.

Everything else a document names and the API does not serve belongs to a later
phase — coupons, reviews, wishlist, blog, audit logs, admin CRUD, guest order
tracking, `POST /cart/merge` — or is deferred by D-3.

## 3 — the per-row free-shipping threshold is withdrawn

Removed from the schema, the seed, the service and the tests. The column and the
precedence rule were both mine; **neither was specified, nothing set the column,
nothing read it, and nothing tested the rule.**

`MONGODB-DESIGN.md` §11 describes the collection as "Governorate → fee,
free-shipping threshold". That is a one-line PURPOSE summary in a table of
supporting collections, not a field list — and I read it as a field, then had to
invent a precedence rule to make the field mean anything. An unexercised rule is
not future flexibility; it is a decision made in advance by somebody who was not
thinking about the problem, waiting to be discovered as folklore.

The service now reads one threshold, from configuration. `FREE_SHIPPING_THRESHOLD`
is unchanged, still unset, so **no order is free** — exactly as before.

### The 27 existing rows

`$unset` on all 27 development rows: 27 had the field, 27 modified, 0 remain,
total still 27. **Production is unaffected** — the collection has never been
deployed.

### Two tests changed shape rather than disappearing

The two precedence cases are gone, and the row-threshold assertions were
replaced by something more useful than nothing:

- `fulfilment.spec.ts` now asserts the threshold applies to **every one of the
  27 governorates**, not to one example — "global" is a claim about all of them,
  and a single case would pass just as happily if Cairo were special-cased.
- Both suites now assert the row's **exact key set**, so a field cannot creep
  back in without a rule to go with it.

Recorded where somebody would look: a note at the bottom of
`shipping-rate.schema.ts` saying why there is no such field, and what a future
per-governorate free-shipping feature has to decide first — what beats what, and
what a row saying `0` means against a global saying `50 000`. PLAN Phase 5 and
changelog **29** carry the same.

38 fulfilment tests pass.

## 4 — the 15 skipped tests, verified

**All 15 are the opt-in live Cloudinary suite. Nothing is accidentally disabled
and nothing was left skipped after debugging.**

Taken from jest's own JSON report rather than by reading files, so the list is
what the runner actually did:

```
suites: 33 passed, 0 failed, 34 total
tests:  802 passed, 15 pending, 0 todo, 0 failed, 817 total

every pending test is in test/media/cloudinary-integration.spec.ts
```

| # | Test | Why it skips |
|---|---|---|
| 1 | upload › stores the bytes and answers with the fields the ledger records | live account |
| 2 | upload › returns NO absolute URL, anywhere in the response | live account |
| 3 | upload › stores a provider-relative identifier in the ledger, not a URL | live account |
| 4 | upload › is RETRIEVABLE from Cloudinary under exactly that identifier | live account |
| 5 | upload › strips EXIF, and bakes the orientation in first | live account |
| 6 | upload › downscales an image above the maximum edge | live account |
| 7 | refuses a JPEG that claims to be a PNG, and stores nothing | live account |
| 8 | refuses an SVG, and stores nothing | live account |
| 9 | refuses an oversized file, and stores nothing | live account |
| 10 | refuses an image below the minimum edge, and stores nothing | live account |
| 11 | refuses a signed-in CUSTOMER, and stores nothing | live account |
| 12 | delete › removes the asset from Cloudinary, not only from the ledger | live account |
| 13 | delete › treats an already-destroyed asset as success, so a retry is safe | live account |
| 14 | catalogue import › uploads once, and a second run uploads nothing and orphans nothing | live account |
| 15 | reconciliation › names an asset that exists in Cloudinary with no ledger row | live account |

### The one skip mechanism, and how it is opted into

```ts
const suite = INTEGRATION ? describe : describe.skip;
```

`INTEGRATION` is `process.env.CLOUDINARY_INTEGRATION === '1'`, set only by
`pnpm --filter api test:cloudinary`. Run that and all 15 execute against the
real account; **verified this session — 15/15 pass.**

The file also prints a line on every default run saying it was skipped and how
to run it, so it cannot be quietly forgotten.

### Why they are opt-in rather than always-on

Real, authenticated, billable calls. In the default suite they would upload from
every developer's machine on every run and fail wherever there is no network —
the media form of the 225 live email sends F-07 found. The same pipeline IS
exercised on every run against the in-memory adapter; only the vendor half is
opt-in.

### Also checked: nothing is disabled by a mechanism jest does not report

`.only` is the dangerous one — a single stray `it.only` silently disables every
other test in its file and the run still goes green.

```
jest       .only  .skip  .todo  xit  xdescribe   -> the one describe.skip above, nothing else
playwright .only  .skip  .fixme                  -> none
```

Playwright's three `test.fail()` calls in `not-found.spec.ts` are **not** skips:
they run, they assert, and they fail on purpose — the suite goes red the day the
404 body starts rendering, which is the point of them.

### One observation, not fixed

Nothing would catch a `.only` committed by accident. It is a small guard and it
belongs to whoever decides it is worth having; item 4 asked for verification, so
this is reported rather than built.

## 5 — the index-dependent invariants, verified rather than assumed

**I under-reported this in session 4.** I said two repositories catch error
`11000` as their entire concurrency control. Verified: there are **five call
sites**, of which **four are genuinely at risk** and one is not — and there are
**eight** invariants, not seven.

### The eight, and the index each depends on

| # | Invariant | Index | Where the catch is | Consequence if the index is absent |
|---|---|---|---|---|
| 1 | one account per email | `users.user_email_unique` | `CredentialRepository.create` | two accounts on one address; login resolves to whichever row returns first |
| 2 | one cart per customer | `carts.cart_user_unique` | `CartRepository.addLine` | two carts; which one the customer sees depends on the query |
| 3 | one order per idempotency key | `idempotencyKeys.idempotency_key_unique` | `IdempotencyRepository.reserve` | **`reserve()` always returns `true` and a retried checkout places a second order** |
| 4 | the same, one layer deeper | `orders.order_idempotency_key_unique` | `CheckoutService.place` | the belt behind #3 |
| 5 | one number per order | `orders.order_number_unique` | *no catch* — the daily counter allocates it | two orders share a customer-facing number |
| 6 | one stock movement per order line | `inventoryEvents.inventory_event_reference_unique` | *no catch* — the write fails outright | a double SALE or RESTORE moves stock twice |
| 7 | one product per SKU | `products.product_sku_unique` | `ImportRunner` reports the errored row | an import duplicates instead of upserting |
| 8 | one ledger row per stored asset | `mediaAssets.media_asset_public_id_unique` | `MediaAssetRepository.record` | the upsert stops being atomic |

**#3 is the one I had wrong.** I listed `orders.order_idempotency_key_unique`,
but the catch that actually decides whether a checkout is a replay is on
`idempotencyKeys.idempotency_key_unique`. It is also the most expensive of the
eight: without it a retried checkout charges the customer twice, and nothing
anywhere raises.

### The one that looks identical and is safe

`OrderCounterRepository` catches `11000` in the same shape. It is **not** at
risk: its key is the document's `_id`, the one index MongoDB always creates and
`syncIndexes()` cannot drop. Recorded at the site, because the pattern is
indistinguishable from the four that are.

### All eight are covered by the probe — proven, not asserted

The probe walks `schema.indexes()` for every registered model, so coverage is
automatic rather than a list somebody maintains. `it.each` over the table above
checks that each index is genuinely declared, so a renamed or removed
declaration fails here instead of silently leaving an invariant unguarded. A
ninth entry added to the code and not to the table trips a length assertion.

### The comments

Every `catch (11000)` site now says the index **is** the concurrency control,
what breaks without it, and where the table lives. The shared header on each
`DUPLICATE_KEY = 11000` constant says it once more:

> Every `catch` on this code below is a CONCURRENCY CONTROL, not error handling.
> Drop the index and the error never arrives, the catch never runs, and the race
> silently succeeds — no exception, no log line, nothing to notice.

That is the whole problem in three lines: the code reads as ordinary defensive
error handling, which is exactly why the index under it looks removable.

### The probe's own guarantee is now tested

Two new cases, on `users.user_email_unique` — the most consequential of the
eight rather than the safest:

- **dropped → `GET /health/ready` answers 503**, names `users.user_email_unique`,
  prints the remedy, and **liveness stays 200** (restarting cannot create an
  index). Restored, then 200 again.
- **recreated WITHOUT `unique`, under the same name** → still reported missing.
  A name comparison would call that healthy; `diffIndexes()` does not.

Restored in `finally` and again in `afterEach`, and verified afterwards outside
the suite: the index is present, `unique: true`, and **refuses a real duplicate
insert** — checked by inserting one rather than by reading `listIndexes`.

jest **813 passed, 15 skipped** (828). Drift gate green.

## SESSION 5 — final state

| | Before | After |
|---|---|---|
| jest | 800 passed, 15 skipped (815) | **813 passed, 15 skipped** (828), 34 suites |
| Playwright | 44 | **44** |
| Cloudinary integration | 15, opt-in | 15, opt-in — unchanged |
| build / type-check / lint / drift gate | green | green |

Net +13 jest tests: 3 secret-hygiene, 12 index-invariant, and 2 net from the
fulfilment reshaping.

**Secret audit re-run after every commit of this session**: the five real
credentials are still clean across all commits and all local files. The
`MONGODB_URI` match is the passwordless localhost URI, documented on purpose.

### Commits

| | |
|---|---|
| `5c0c27d` | fail the suite if a credential value reaches a tracked file |
| `57910e5` | password reset adopts the frozen §2.8 paths (**breaking**, accepted) |
| `31e2065` | withdraw the per-row free-shipping threshold |
| `55db245` | verify all 15 skipped tests are the opt-in Cloudinary suite |
| `845e858` | name the unique index as the concurrency control at every catch site |

### Needs owner, after this session

1. **The Cloudinary account is shared** with an unrelated application (108
   assets). Unchanged from session 4 — worth deciding whether this shop gets its
   own account before it holds real photographs.
2. **The blank 404 body** still needs the existence check in `proxy.ts`, which
   is 5b's.
3. **Five doc-vs-implementation disagreements** are now listed in PLAN §9.1,
   including one where two frozen documents contradict each other about the cart
   item parameter. Listed, not fixed.
4. **Nothing catches a stray `.only`.** Reported in item 4, not built.

---

# SESSION 6 — Phase 5b

Baseline: jest **813 passed, 15 skipped** (828), Playwright **44**.

## Part 0 — §9 corrections

### The four where a document described an older shape

Resolved as **the served implementation is authoritative**, for the same reason
each time: it is frozen in `openapi.v1.json` and consumed by the verified
`/shop` slice. `GET /auth/me`, `POST /orders/{id}/cancel`, the seven
`POST /admin/orders/{id}/<action>` endpoints, and `DELETE /admin/media?publicId=`.
§9.1 now records each with the reasoning rather than listing it as an open
disagreement. **No code changed.**

**One thing worth flagging:** rows 1–4 originate in `AUTHORIZATION-MODEL.md`,
`ORDER-LIFECYCLE.md` and `MEDIA-MODEL.md` — not in §9. §9 never named them; I
found them by widening the audit. §9.1 now says the implementation wins, but
those three frozen documents still describe the older shape and I have **not**
annotated them: amending a frozen architecture document is an owner decision, and
the brief asked for a supersession note on one document, not four. Recorded in
§9.1 so it is not lost.

### The one where two frozen documents contradicted each other

**`BUSINESS-RULES.md` lost.**

| | |
|---|---|
| `BUSINESS-RULES.md` RULE-ORDER-001 | `PATCH /cart/items/:id` |
| `CART-MODEL.md` §6 | `PATCH /cart/items/:productId` |
| **Served** (`cart.controller.ts:122`) | `@Patch('items/:productId')` |

`CART-MODEL.md` owns the cart and matches the served path character for
character. `BUSINESS-RULES.md` is corrected inline and carries a dated
supersession note at the top of §1 explaining which document won and why. **No
rule changed** — only a parameter's name inside a path, in a Trigger cell.

### §9.2 — order idempotency was `[V]` by luck

The Phase 0 audit marked order idempotency verified working, and it was. But the
guarantee rested entirely on `idempotencyKeys.idempotency_key_unique`, which
nothing was watching. `reserve()` returns `false` only because the insert is
refused; with the index absent it returns `true` every time and **a retried
checkout commits a second order**. No exception, no log line.

`autoIndex` is off by design, so an index-less database is silent — and 5a found
`mediaAssets.media_asset_public_id_unique` actually missing from the development
database, the same failure with a cheaper consequence.

Recorded in PLAN §9.2 and changelog **30**, because a `[V]` that holds only while
an unmonitored precondition happens to be true is worth naming as what it was.

## Part 1 — the guest cart

A thin store of `{productId, quantity}`, priced by the API at render, merged
into the customer's cart on the first authenticated page load.

### The merge, in the one order that survives being interrupted

```
1. plan     read-only. Nothing has changed if it fails.
2. FREEZE   the absolute target quantities are persisted BEFORE any write.
3. apply    converge each line to its target. Repeating changes nothing.
4. confirm  the basket is emptied only now.
```

Step 2 is the whole guarantee and the easy one to leave out. Without it a retry
re-plans against a cart that already holds some of the guest quantities and adds
them a second time.

That is also why the merge is **two server actions rather than one**: a single
action would compute and write in one breath, and a dropped connection after the
write but before the response would leave the browser holding a basket it
believes is unmerged.

### The rules as shipped

| Situation | Result |
|---|---|
| guest items, empty server cart | all move |
| guest items, different server items | union; the server's lines are not in the plan at all, so nothing can rewrite them |
| **same product in both** | **quantities SUM**, then the API clamps to `min(99, onHand)` |
| beyond stock after merging | clamped by the API, and the customer is told |
| a line is unpurchasable | that line is skipped, the rest merge, sign-in is unaffected |
| the merge is retried | absolute targets, so the answer is the same however far the first attempt got |
| the merge fails | the basket is untouched and retried on the next authenticated page load |

Summing is a product decision and is documented as one: a customer with two in
their account and two in their basket wants four. `max()` silently discards the
smaller intent; "server wins" throws away the basket they just built.

**Stock is never consulted client-side.** The plan may ask for more than exists;
the API clamps, and the notice is derived from the cart it returns rather than
from what the writes claimed.

### What was retired

The store holds no prices, names or images. `syncCartToDatabase` sent `price`,
`name` and `maxStock` FROM the client to a server action that trusted them — a
price that round-trips through `localStorage` is a price the customer can edit.
It is still in the tree; deleting it belongs to the T2 flip that stops calling
it.

### Tests

**19 rule tests** as pure functions (`guest-cart-merge.spec.ts`) — no browser, no
server. The storefront has no unit-test runner, and adding one for a single
module would be more infrastructure than the module deserves.

**8 browser tests** against the real API (`guest-cart-journey.spec.ts`), asserting
the cart line by line from the API's own JSON rather than from the page. Two of
them cover the retry:

- the second server action is **aborted at the network layer**, the frozen plan
  is asserted to be on disk, and the retry produces 5 — not 7, not 10;
- and the deterministic twin: a plan that was already applied but whose response
  was lost. That is the case a network abort cannot reliably produce, and the
  one that doubles a basket if the plan is recomputed.

One test signs in through the real form; the rest install the session cookies
directly, because registration is throttled to 3/hour and login to 5/15min —
right for humans, a hard ceiling for a suite that wanted an account each.

## The bug underneath all of it: **the client had never been running**

The merge did nothing. No error, no request, no console message. Four
increasingly narrow probes later:

```
a trivial client component's useEffect on /shop   ->  never ran
document.title set in that effect                 ->  unchanged
/, /products, /shop                               ->  no client behaviour anywhere
```

**Next 16 blocks cross-origin requests for `/_next/*` dev resources, and treats
`127.0.0.1` and `localhost` as different origins.** The suite drives
`http://127.0.0.1:3100`; the dev server calls itself `localhost:3100`. Every
client chunk was refused. React never booted on any page, in any test, ever.

It hid for so long because nothing depended on it: pages server-render, forms
still submit through progressive enhancement, and the only symptom was a failing
HMR WebSocket — which reads exactly like dev noise. It sat in the
`browser-health` ignore list as 77–84 suppressed problems per run.

`allowedDevOrigins: ['127.0.0.1']` in `next.config.ts`, which is what Next's own
warning tells you to do.

### It also means I reported the 404 body wrongly in Phase 5a

I wrote that `notFound()` after an `await` produces an empty document and that
it could not be fixed from inside a page. **The client was not rendering
anything.** With the browser actually running the application, the designed 404
renders — and the three `test.fail()` cases I left as tripwires went red by
passing, which is exactly what they were for.

Corrected in `not-found.spec.ts`: the content is asserted directly, and the
header records what actually happened. **The status fix was real and was
needed;** the "empty body" was an artefact of measuring through a harness that
had disabled the client.

### Two further consequences

- **The dev server now runs out of memory** doing the work it was never asked to
  do before. `NODE_OPTIONS=--max-old-space-size=4096` for the e2e web server; a
  harness setting, not a product one.
- **A zustand trap, recorded where it bit.** The obvious sanitising hook,
  `onRehydrateStorage: () => (state) => useGuestCartStore.setState(...)`,
  references the store binding from inside `create()` before the `const` is
  initialised. The `ReferenceError` is swallowed by the persist middleware and
  hydration silently never completes — `hasHydrated()` false for ever, basket
  reads empty, nothing in the console. `merge` is the correct hook and touches
  no outer binding.

### Counts

jest **813 passed, 15 skipped** (828) — unchanged, no API code changed.
Playwright **44 → 68**, all green. Build, type-check, lint and the drift gate
green.

## Phase 5b prerequisites — making the harness honest

Three pieces of protection, plus one machine problem that had to be solved
before anything could be measured at all.

### P1 — a hydration canary, and one host

React never booted in any browser test for the whole of phases 1 to 5a and
nothing noticed. Pinning the origin fixes today's instance; it does not stop
tomorrow's. Two things now do.

**The canary.** `browser-health.ts` loads a page and waits for React to take
over BEFORE every spec's body runs. It looks for React's own internal markers —
`__reactContainer$…` on the hydration container, `__reactFiber$…` on host nodes
— because those cannot be faked by server HTML and need nothing from the
application. If they never appear the spec fails immediately with a message
that distinguishes the two cases: no client runtime at all (the chunks never
arrived — a serving or origin problem) from a runtime that loaded and then
failed to hydrate (an application problem).

**The host.** There was one HOST constant needed in three places, and it had
been written out separately in two files, which is how they drifted. It is now
`HOST` in `playwright.config.ts`, used for the tests' `baseURL`, passed to
`next dev --hostname`, and passed on to `allowedDevOrigins` through
`DEV_ORIGIN_HOST`. `next.config.ts` no longer names a host of its own for the
suite.

**The canary is itself tested.** `hydration-canary.spec.ts` aborts every
`/_next/**` request in its own browser context, which reproduces exactly the
state the engagement was in, and asserts the probe reports a dead client — and
that the page still LOOKS fine while it does, which is the whole problem. The
positive case asserts a live one. A canary nobody has watched die is just a
bird.

### P2 — the HMR ignore is gone

`DEV_SERVER_NOISE` held one entry, `/_next\/webpack-hmr/`, on the reasoning that
the hot-reload socket cannot always complete under Playwright. **That reasoning
was wrong.** The socket was failing because the dev server was refusing every
cross-origin `/_next/*` request — the same refusal that stopped React booting.
The rule was not suppressing dev noise, it was suppressing the only visible
symptom of the bug that invalidated every browser test in the suite, at 77–84
occurrences a run.

Removed, and the suite is green without it: **`browser-health: nothing was
ignored in this run`** on a run of the specs that used to report the most.

Six suppressions remain across a full run and every one is a per-test
declaration with a reason at the call site, not a global rule:

| Rule | Count | Where, and why |
|---|---|---|
| `Failed to load resource.*404` | 4 | `not-found.spec.ts` — the tests are *about* 404s |
| `Failed to (load resource\|fetch)\|net::ERR_FAILED` | 1 | the merge interrupted at the network layer, on purpose |
| `Invalid login credentials\|400\|AuthApiError` | 1 | `guest-cart-login.spec.ts` — a login that fails is the probe |

The list stays as a named, empty thing rather than being deleted, with the
history written at it. The counting machinery stays too: it exists because this
entry went unexamined for months.

### P3 — the throttle stops bounding the suite

Registration is 3 an hour per IP and login 5 per 15 minutes. Right for the
internet; a hard ceiling for a suite that needs an account or two per run, and
Part 2 adds more auth journeys. A suite that fails environmentally teaches
everyone to disregard failures, which is how a real one gets missed.

**One multiplier, one place.** No route's limit is rewritten. `@Throttle`
still carries the frozen numbers at the route it protects, and
`AppThrottlerGuard.handleRequest` multiplies whatever the route declared by
`throttle.limitMultiplier` — 1 in every normal process, 200 in a relaxed one.
`RATE_LIMIT_RELAXED=true` is set for the API process Playwright starts, and
nowhere else.

Multiplied rather than switched off deliberately: turning the guard off would
stop exercising the tracker, the IP+email key, the `Retry-After` header and the
error envelope in every browser run.

**The 429 keeps its test, at production strength.** `auth-guards.spec.ts` is
that spec, and it now asserts the pin *first*:

```ts
it('runs against the PRODUCTION limits, not a relaxed test ceiling', () => {
  const throttle = app.get<ThrottleConfig>(throttleConfig.KEY);
  expect(throttle.relaxed).toBe(false);
  expect(throttle.limitMultiplier).toBe(1);
});
```

Asserted on the running application rather than on the environment, because the
environment is only how the value gets in. Without it, someone relaxing the
limits globally would turn the cases below it into tests of nothing and the
failure would read "expected 429, got 201" — a broken guard, not a mis-set
variable.

`test/setup/production-like-limits.ts` pins `RATE_LIMIT_RELAXED=false` for every
jest suite, so a stray shell export or a leftover `.env` line cannot quieten it.
`setupFiles` rather than `setupFilesAfterEnv`, and dotenv does not overwrite a
variable that is already set, so it wins over `.env` too.

**Production is untouched, and cannot be touched.** The default is `false`, and
the env schema refuses to boot with `NODE_ENV=production` and this set — the
same shape as `AUTH_REQUIRE_EMAIL_VERIFICATION`.

**Proof:** two consecutive full e2e runs against the SAME API process, inside
the same hour — four registrations against a limit of three — both 70/70. That
run used to fail on the second pass.

### Three tests were passing on timing alone

`t1-catalogue.spec.ts` had three cases that counted products immediately after
`page.goto`: pagination, the price filter, and search-by-SKU. The product grid
streams behind its own Suspense boundary and lands AFTER the `load` event that
`goto` resolves on — measured at up to four seconds on a cold dev route — so
those counts were reading the shell.

They failed the moment the harness got slower. Measured rather than guessed at:
the server HTML was correct (`curl` returns 2 products for `?page=3`), the API
was correct, and a probe showed 0 links at `load` and the right number four
seconds later. They now use `expect.poll` or wait on an auto-waiting assertion
first, and `countProducts` carries a docstring saying it does not wait and what
every caller therefore owes.

The sibling test that asserts an EMPTY grid is unaffected and still correct: it
waits for the empty-state heading, which is what proves the boundary resolved.

### The machine stopped being able to run any of it

Mid-session, **21 of 34 jest suites and the API itself stopped starting**:

```
ERR_DLOPEN_FAILED: An Application Control policy has blocked this file.
  …\@img\sharp-win32-x64\lib\sharp-win32-x64-0.35.4.node
```

Windows **Smart App Control** switched to enforcement on this machine today
(`VerifiedAndReputablePolicyState = 1`; the CodeIntegrity log shows it blocking
unsigned DLLs in other applications too, including the browser's). It blocks
sharp's unsigned native binary, and sharp is imported by `MediaModule` at module
load, so nothing that builds the application graph could start.

Nothing in the repository changed to fix it. sharp's documented fallback —
`@img/sharp-wasm32`, a WebAssembly build with no native binary to block — was
placed in the local `node_modules` hoist directory along with its
`@emnapi/runtime` dependency. **No tracked file, no lockfile and no
`package.json` was touched**, because this is one machine's security policy and
not a property of the project.

It works: libvips 8.18.6 through WebAssembly, and every image suite passes on it
— `image-format`, `media-upload`, `image-import` and the Cloudinary integration
included. Two things the owner should know:

1. **It is undone by the next `pnpm install`.** If it comes back, the two
   packages go back in the same place, or the durable fix is chosen below.
2. **Local image tests now exercise the WASM libvips, not the native one.** They
   all pass, which is good evidence the two agree, but it is not the same
   binary that production runs.

The durable options are the owner's call: turn Smart App Control off (Windows
Security → App & browser control — **irreversible without a Windows reset**), or
add `@img/sharp-wasm32` to the project as an explicit optional dependency, which
costs everyone the download and changes the lockfile.

### Counts

jest **814 passed, 15 skipped** (829) — one new, the production-limits pin.
Playwright **68 → 70**, all green, twice in a row inside the same hour.
Build, type-check, lint and the drift gate green.

## Part 2 — the T2 flip

`/login`, `/register`, `/forgot-password`, `/account/*`, `/checkout` and the
cart UI are the API's. Supabase is gone from the identity and money cluster.

### What moved, and what it cost

| Surface | Before | Now |
|---|---|---|
| `/login`, `/register` | browser Supabase client, local zod schema, Google button | `loginAction` / `registerAction`, server-reported field errors, no OAuth (D-3) |
| `/forgot-password` | `resetPasswordForEmail` → `/auth/callback` (PKCE-only, orphaned) | `forgotPasswordAction`; the link lands on `/forgot-password/reset`, which now exists |
| `/verify-email` | only at `/shop/verify-email` | canonical, and the API mails the canonical address |
| `/account/orders`, `/[id]` | Supabase `orders` table, float totals, local status map | API orders, integer minor units, server statuses, **self-cancel** |
| `/account/profile` | read/wrote a Supabase `profiles` row from the browser | `PATCH /users/me`, two fields, email read-only |
| `/account/addresses` | 442 lines: browser queries, client-side default toggle, client-side count cap | `AddressBook` over the API; all three invariants server-side |
| `/checkout` | three-step wizard summing a browser cart, own shipping rule | quote + `placeOrderAction`, **D-8 fee live** |
| Navbar cart, drawer | client store holding prices | one `CartProvider`; the API prices both carts |
| `proxy.ts` | `createServerClient` + `auth.getSession()` on every matched request | a cookie-presence check |

**Deleted:** `auth/callback/route.ts`, `hooks/useAuth.ts`, `stores/cart-store.ts`,
`actions/cart.actions.ts` (`syncCartToDatabase`), `actions/checkout.actions.ts`,
`components/CheckoutStepper.tsx`, `components/CartSync.tsx`, and
`toCartProduct` — the adapter that existed to feed the store prices.

### One cart, two owners

The header basket has to work for a customer whose cart is the API's and a
visitor whose basket is their browser's. Rendering those from two code paths is
how a basket shows one total before sign-in and another after, so both go
through `CartProvider` and both come back as the API's `Cart`: same fields, same
money, same status ladder, same clamping.

That needed something the API did not have. **`POST /cart/preview`** — public,
stores nothing, prices a `{productId, quantity}` list and returns the `GET /cart`
shape. It reuses the cart's own projection rather than a second pricing path, so
a basket cannot change shape when its owner signs in.

The one thing it cannot report is `PRICE_CHANGED`. That status compares the live
price against the price the customer was shown when they added the line, which a
stored cart keeps as a snapshot; a browser basket has none, so the comparison
genuinely cannot be made and is not faked.

**This is an API addition made during a storefront flip, and it is worth
flagging.** Part 1's approved design says the guest basket holds
`{productId, quantity}` and is "priced by the API at render". There was no way
to do that: the catalogue has no by-id lookup, `findByIdsForCart` deliberately
returns invisible products and is documented as never reaching a public
response, and the alternatives were putting slugs back in the browser store or
showing a basket with no prices. Additive; the drift gate reports it as such.

### Optimism is deliberately absent

The cart shows a quantity only after the server has agreed to it. The API clamps
to live stock, so "add 40" can legitimately become 12 — a brief spinner beats a
number that changes under the customer's eyes a moment after they read it.

### The proxy does much less

It looks for `nest_rt` and never inspects it. **It is not the authorization
boundary** — every guarded page asks the API, which decides on the identity in
the token — so deleting the file would cost polish and no security.

`nest_rt` rather than `nest_at`: the access token is a fifteen-minute session
cookie, gone after a browser restart while the customer is still signed in.
Guarding on it would bounce people who have a perfectly good session.

Matching is on **segment boundaries**. `startsWith('/account')` also matches
`/accountancy`, and `startsWith('/register')` would bounce a signed-in customer
off `/registered-dealers`. There is a test for the first.

One exception is written into the guard: a signed-in customer is still allowed
onto `/forgot-password/reset`. A reset link is a credential with an expiry sent
to an inbox, and somebody signed in here may be recovering the account from
another device. Bouncing them consumes nothing and leaves them holding a token
they cannot use.

The `Next-Action` pass-through survives unchanged and is now asserted at the
protocol level: a POST carrying the header gets no 3xx and no `Location`.

### The empty 404 needs no proxy fix

The brief listed "fix the empty 404 body" as part of this rewrite. Part 1 found
that diagnosis was wrong — the body was empty because React was never booting in
the harness, not because of anything the proxy did. The designed 404 renders,
`not-found.spec.ts` asserts its content, and the proxy does not touch 404s.
There is a test that an unguarded path near a guarded prefix still answers 404
as itself.

### What the journey caught

`POST /orders/:id/cancel` requires a `reason` — 3 to 500 characters, free text,
stored verbatim on the permanent record (API-CONTRACT.md §5.4). The first cancel
UI sent an empty body and the API refused it. The form collects a reason now,
and it is **not** defaulted on the customer's behalf: "Cancelled by customer"
written into a record shown back to them reads like something they said.

Two test defects surfaced with it:

- The interrupted-merge probe aborted "the second server action". True when the
  page fired two; the header now prices the basket through an action of its own
  on every signed-in render, so an ordinal killed whichever action happened to
  be second. It aborts on the **frozen target quantity** now — the basket holds
  2 and the cart holds 3, so only the write carries 5. That is "kill the write"
  stated in the terms the test is about.
- The cancel step asserted a confirmation message. The action revalidates the
  route, so the page re-renders into the cancelled state and the message's
  component unmounts. It asserts the order's **state** now: a message can be
  shown by a component that did nothing.

### The purchase journey walks the real URLs

It drove `/shop/*` because that was where the API-backed implementation lived.
It walks `/register`, `/login`, `/products`, `/account/addresses`, `/checkout`
and `/account/orders/[id]` now, and it asserts the **D-8 delivery fee as a
number** — `50.00 EGP` for Cairo, on the quote and again on the placed order.
Two independent computations, one from the cart and one inside the placement
transaction, and they must agree. Every order placed before this read
"Not yet calculated".

### Counts

jest **825 passed, 15 skipped** (840) — 11 new, all on `POST /cart/preview`.
Playwright **70 → 83**, all green.
Build, type-check, lint (0 errors; storefront warnings 59 → 24 as legacy code
left) and the drift gate green; the OpenAPI artifact regenerated and additive.

## Part 3 — the T3 collapse

`/shop` is gone. Its URLs still resolve, permanently, to the canonical ones.

### The redirect table, and the one thing that could quietly ruin it

```
/shop                      -> /products
/shop/login                -> /login
/shop/register             -> /register
/shop/verify-email         -> /verify-email
/shop/cart                 -> /cart
/shop/checkout             -> /checkout
/shop/addresses            -> /account/addresses
/shop/orders               -> /account/orders
/shop/orders/:id           -> /account/orders/:id
/shop/:slug                -> /products/:slug
```

`/shop/:slug` matches `login`, `cart`, `orders` and every other single segment,
so it is listed **last** and the specific paths first. Next takes the first
match. Every row is asserted — status and `Location` — because a redirect table
is exactly the kind of thing that looks right in a config file while sending
`/shop/orders/abc` to a product page that does not exist.

**301, not 308.** The frozen plan says 301, these are all GET pages, and the
distinction that separates the two — 308 preserves the method — buys nothing
here. Crawlers treat them identically.

These URLs were live: they are in verification emails and order emails sitting
in inboxes, some carrying tokens that are still valid. That is why the tombstones
exist rather than a clean deletion.

### `/shop/cart` needed somewhere real to go

There was no canonical cart page — the cart was a drawer. `/cart` is a page now,
reading the same `useCart()` the drawer and the header badge read, so the three
cannot disagree.

It works **signed out**, unlike the `/shop` page it replaces, which redirected an
anonymous visitor to sign in because the only cart it knew about was the API's.
Making somebody sign in to look at their own basket is a good way to lose the
basket.

### F-12 was two defects, and only one of them was the one recorded

The finding says "two nested `<main>` landmarks on every `/shop` page". Deleting
the slice removed that pair — and revealed that **`/account/*` had the same
defect independently**, from a different layout, on every page in the account
area. It would have outlived the deletion with the finding marked closed.

Two nested `main` landmarks is invalid HTML, and it degrades exactly the thing
the landmark is for: "skip to main content" cannot say which one is meant, and
"next landmark" walks into a nested copy of where the user already is. The inner
element is a labelled `<section>` now, so the region is still announced.

`t3-collapse.spec.ts` counts the landmark on a page per layout — including a
signed-in account page, which is the only render that draws the layout that hid
the second one.

**No route-group split was needed.** The plan named it as the mechanism; deleting
the slice achieved the outcome the mechanism existed for, and the account layout
needed a one-element change rather than a restructure.

### The sitemap needed no change

It was already built from the API and already listed only canonical URLs — F-03
recorded `/shop`'s absence from it as a symptom. There is now a test asserting
that silence, so the absence is a property rather than an omission.

### A flake class, found and fixed

`t1-catalogue` went red on a count assertion that had passed for months.

React streams a Suspense boundary by writing its content into a `<div hidden>`
appended to `<body>` and then moving it into place. Between those two steps the
same text is in the document **twice** — once hidden, once not — and an unscoped
`getByText` resolves to both. That is a strict-mode violation, which Playwright
raises rather than retries, so it lands as a hard failure that reproduces
perhaps one run in three.

The hidden copy is outside `main`. Every count assertion is scoped to `main`
now, which also makes it mean what it says: the text is in the page's content,
not in a staging buffer.

### Findings closed

| | |
|---|---|
| F-03 | `/shop` unreachable — deleted, with 301s and a sitemap assertion |
| F-04 | register stranding the customer — replaced, not patched |
| F-06 | orphaned `/auth/callback` — deleted; a spec asserts it 404s |
| F-12 | nested `<main>` — **both** instances, with a landmark count |
| F-13 | "Not yet calculated" — D-8 fees live, asserted as a number |
| F-18 | dormant Zustand cart authority — deleted with `syncCartToDatabase` |

### Counts

jest **825 passed, 15 skipped** (840).
Playwright **83 → 94**, all green.
Build, type-check, lint and the drift gate green. The built route list contains
no `/shop`.

### Two more things the flip exposed

**The relaxation can be silently bypassed, and now says so.**

`RATE_LIMIT_RELAXED=true` is set on the API process *Playwright starts* — but
`reuseExistingServer` means an API a developer already had running is used
instead, and that one does not have it. The failure is genuinely confusing:
specs fail on `expect(registered.ok()).toBe(true)` inside a helper, several
files apart, with nothing on screen about rate limits. I hit it myself, having
started an API by hand for a build.

`e2e/global-setup.ts` now refuses the run before any test executes. One
deliberately-wrong sign-in reads `X-RateLimit-Limit-global`, which reports the
ceiling *after* `AppThrottlerGuard` has applied the multiplier — so the number
is the whole answer, and it is asserted rather than the environment variable,
because the variable is only how the value gets in and the suite may be talking
to a server it did not start.

Proven by pointing the suite at a production-limits API: it stops with a message
naming the cause and the fix.

**`guest-cart-login.spec.ts` was testing an empty basket and suppressing
nothing.**

It seeded `nest-cart-storage` — the legacy Zustand key, deleted in T2 — so "a
guest with a full cart" had quietly become a guest with none. And it declared
`allowConsoleError(/Invalid login credentials|400|AuthApiError/i)` for Supabase
errors that can no longer happen: a failed sign-in is a server action now and
the browser logs nothing.

Both fixed. The allowance is gone, and the suite is green without it —
`browser-health: nothing was ignored in this run` for that file. An allowance
that suppresses nothing is worse than no allowance; it is a licence nobody is
checking, and this suite has already been bitten once by exactly that.

**The origin is one module now.** `e2e/origin.ts` holds HOST, PORT, BASE_URL and
API_BASE_URL; the Playwright config, the global setup and every spec that needed
a literal read it. The specs had four hardcoded copies of `127.0.0.1:3002` and
`127.0.0.1:3100` between them, which is the same drift the canary exists to
catch, one layer down.

### Final counts for the branch

jest **825 passed, 15 skipped** (840 total, 34 suites).
Playwright **94 passed**, twice in a row against the same API process inside one
hour. Build, type-check, lint (0 errors) and the drift gate green.

---

## POST /cart/preview: the projection audit (A1–A3)

**The endpoint reused a projection built for a signed-in customer and served it
to the open internet.** That is the shape most accidental exposure takes, so the
audit was done field by field rather than by asserting that the cart's own
projection must be safe.

### Every field an anonymous caller receives

| Field | Where a visitor can already see it |
|---|---|
| `productId`, `slug`, `sku`, `name`, `imagePublicId` | `GET /products` grid and `GET /products/:slug` |
| `unitPrice`, `previousUnitPrice`, `lineTotal` | `pricing.effectivePrice` on both |
| `availableQuantity` | `ProductDetailDto.stockOnHand` — already public |
| `quantity`, `effectiveQuantity`, `addedAt` | the caller's own request; `addedAt` is the request clock |
| `status` | derived from the above |

`costPrice`, `isActive`, `deletedAt`, `salesCount`, `lowStockThreshold`, the
internal category/brand ids and `brandName` are absent **by construction** —
none is a field on `CartLineDto`, so nothing has to be remembered for them to
stay out. `brandName` is the interesting one: it exists on the domain `CartView`
because checkout snapshots it onto an order line, and it stops at the DTO.

The list is now a test. A field added to `CartLineDto` for the account cart
cannot reach the anonymous one without `returns EXACTLY the audited field list`
failing.

### One field failed, and it was a whole class

`findPurchasableByIds` deliberately returns delisted and soft-deleted products
— a signed-in cart must keep showing a line the customer added before the
product vanished. Served anonymously, that resolved **hidden products**: post
the id of an unpublished or soft-deleted product and the response came back with
its real name, SKU, slug, image, price and live stock count. None of those is
reachable from any public page.

Worse than the disclosure was the oracle. An imaginary id produced a blank line;
a hidden id produced a populated one. **That is an enumeration primitive** — it
turns the endpoint into a queryable index of the unpublished catalogue, complete
with names and prices, for anyone willing to walk ObjectIds.

**The fix is one line in `previewGuestCart`:** non-purchasable products are
dropped from the resolved map *before* the snapshots are built, so a hidden
product and an imaginary one produce byte-identical lines — `UNAVAILABLE`, empty
`name`/`sku`/`slug`, zero price, zero stock. The filter reads
`PurchasableProduct.purchasable`, the same boolean the cart, checkout and order
placement already treat as authoritative, rather than a second copy of
`isActive && deletedAt === null` written as a Mongo filter that could drift.

A signed-in cart is untouched: it still names such a line, because there the
customer added it while it was real and the cart kept a snapshot.

### The cap, and the throttle

Both already existed; what was missing was proof.

- **50 distinct products per request**, `@ArrayMaxSize`, `400 VALIDATION_ERROR`
  naming the rule. Asserted on **both** sides of the boundary — 50 is a basket,
  51 is somebody using the endpoint as a bulk price lookup.
- **120 requests per minute per IP**, through the P3 multiplier, so a relaxed
  test environment is not bound by it. The 429 is asserted in
  `auth-guards.spec.ts` — **the one suite that runs at production strength**.
  Proving a ceiling where the multiplier is 200 would prove nothing about what
  the internet gets. The limit is read from `X-RateLimit-Limit-global` rather
  than written twice, which is the same evidence `e2e/global-setup.ts` uses.
- An unknown id is **skipped, not errored**: a basket whose product was delisted
  last week must not turn every page load into an error the visitor cannot clear
  without knowing to empty their own `localStorage`.

### The artifact did not move, and that is the right answer

`openapi:export` produced a one-line diff — the operation description. The
contract did not change; **what the endpoint is willing to resolve did.** The
description now states the indistinguishability property and tells a client to
treat an `UNAVAILABLE` line with an empty `name` as "no longer for sale" rather
than rendering a blank row. Drift gate: OK.

---

## sharp: the WebAssembly fallback becomes a real dependency (Part B)

`@img/sharp-wasm32` is now an **optional dependency of `apps/api`**, pinned to
sharp's own range. The lockfile carries it; a fresh clone works with no manual
step. The previous fix was two directories hand-extracted into
`node_modules/.pnpm/node_modules/`, which the next `pnpm install` would have
erased — and did, when this change was made.

Cost: about 9 MB on install, on every platform, whether or not it is used.

### Why an optional dependency installs everywhere

`optional` in npm and pnpm means "do not fail the install if this fails"; it is
`os` and `cpu` that make a package platform-specific. `@img/sharp-wasm32@0.35.4`
declares **neither**, so it installs everywhere — which is what a fallback has
to do to be one. It is already in the lockfile as a transitive optional of
`@img/sharp-freebsd-wasm32` and `@img/sharp-webcontainers-wasm32`, both of which
*are* `os`-restricted and so were never installed here.

### How production and CI are known to stay on native

Not by configuration — **by the order inside sharp's own loader**
(`sharp/dist/sharp.cjs`, lines 19–105). It tries, in order:

1. a locally-compiled native addon (we never build one)
2. a locally-compiled wasm addon (likewise)
3. `@img/sharp-<platform>` — **native**, installed for every target
4. `@img/sharp-wasm32` — WebAssembly

Step 4 is reached only when step 3 **throws**. Adding the package cannot move
anything off native; it can only supply an answer where there previously was
none.

Verified three ways rather than asserted:

- **Observed here.** Tracing every `.node` require while loading sharp shows
  `@img/sharp-win32-x64` loading and the WASM package never being reached.
- **Reported at boot.** `MediaService.onModuleInit` names the backend. In
  production a WASM backend logs at **ERROR** with the platform package to
  install. It does **not** refuse to boot — the images are correct, only slow,
  and turning a performance problem into an outage is the wrong trade. The rule
  is that the fallback can never become the production path *silently*.
- **Tested.** `test/media/sharp-backend.spec.ts` asserts the detector reaches a
  verdict, and that the report is quiet for native, a warning for WASM and an
  error for WASM in production.

### The equivalence, measured

Catalogue images are the product, so "same libvips, therefore same output" was
checked rather than believed. A second process is started with the native addon
made unloadable — a `require` patch standing in for the OS policy, so
`node_modules` is never touched — and its output is compared with this
process's.

| Fixture | Native | WASM |
|---|---|---|
| 900×600 ordinary photograph | | **identical SHA-256** |
| 3000×1800, downscaled to 2000×1200 | | **identical SHA-256** |
| 800×1200 with EXIF orientation 6, baked to 1200×800 | | **identical SHA-256** |

Byte-for-byte, not merely visually alike: same dimensions, same format, EXIF
absent in both, same libvips 8.18.6. The orientation case is the one that
matters most — it proves `.rotate()` bakes the tag before it is stripped on both
backends, which is the classic EXIF bug and the reason that fixture exists.

The test asserts the child really ran on the other backend before comparing
anything, so it cannot pass by comparing native with native.

### One thing that changed under us

**The native binary loads on this machine again.** Smart App Control blocked it
yesterday and does not today — its enforcement is reputation-based, so a file
can gain reputation. That is worth knowing for two reasons: the block is real
but intermittent, and this machine is no longer a reproduction of it. Everything
above about the WASM path was therefore proven by forcing the fallback, not by
happening to be on it.

---

## Guest order tracking: withdrawn, not deferred (C1)

`GUEST-CHECKOUT.md` §3 promised a redesigned `POST /orders/track`, and Phase 8
carried it as item 5. **The promise was conditional on something that no longer
exists.** Guest checkout was removed by a frozen decision; every order belongs to
an account. There is no order a guest could be tracking, so the endpoint would
be an unauthenticated read of order data with no user — answering questions
about somebody's purchase to anyone who can guess an order number and a phone
number.

Read §3.4 again and it says so itself: every justification given ("the UI
already exists", "a reasonable expectation for a COD store") is about a customer
who checked out *without an account*.

**Not built. Deleted, and the deletion recorded** — PLAN.md §9.3, the §9 table
row, the Phase 8 item, and a banner on `GUEST-CHECKOUT.md` so the promise is not
read as pending. §3 is retained as the specification for *if guest checkout
returns*, which is the only condition that revives it.

### What the page actually was

Worth writing down, because it was live and linked from the top nav.

`stores/orderTrackingStore.ts` ran a **browser-side Supabase query** against
`orders` filtered only by `order_number`, selected the whole row joined to
`order_items` and `order_status_history`, and then compared the phone number
**in the browser**. The row — items, addresses, totals, status history — crossed
to the client before any ownership check happened; whatever RLS did or did not
allow, the test itself was client-side.

It could not have found a real order in any case: orders have lived in MongoDB
since T2. So it was a page that could only ever say "Order not found", reachable
from every page of the site. This was also the last browser-side Supabase read
outside the blog path.

### Removed

`app/order-tracking/`, `components/order-tracking/` (4 components),
`stores/orderTrackingStore.ts`, `orderLookupSchema` / `OrderLookupInput` from
`packages/types` (referenced by nothing else), and the `TOP_NAV_LINKS` entry.

`/order-tracking` now **301s to `/account/orders`**. Signed out, the proxy then
carries the visitor to `/login?redirect=%2Faccount%2Forders`, so a bookmark
lands on the sign-in step with its destination attached rather than on a dead
end — asserted in `t3-collapse.spec.ts`, not just configured.

**The footer's "Track Order" link stays.** It already pointed at
`/account/orders`: the same question, with the only answer that still exists.
The test asserts where the phrase points rather than forbidding anyone from
saying it — a test that banned the words would have failed on correct code.

---

## A permanent sandbox account (C2)

```
pnpm --filter api sandbox:seed              converge
pnpm --filter api sandbox:seed -- --reset   erase this account's history first
```

`sandbox@nest-electronics.test` / `brass thermionic valve`, verified, with a
Cairo address (default), an Alexandria address, one placed order and a two-line
cart. Documented in `SANDBOX.md` §4.

**Why it is worth a script at all.** `POST /auth/register` is 3 per hour per IP.
A mobile developer re-registering while building hits that within minutes and
reads the `429` as a broken API. That is the worst possible first impression and
it is entirely avoidable.

### Two decisions worth the words

**It places a REAL order** — `CheckoutService.placeOrder`, the same method the
HTTP layer calls. An order document written by hand is a guess about the order
model that goes stale the first time that model changes, silently, because
nothing type-checks a `db.orders.insertOne`. This way the history has real
pricing, a real shipping fee resolved from the governorate, a real stock
decrement, a real inventory event, and the cart cleared in the same transaction.

**And it creates the account through `AuthService.register`**, so the password
in the docs is provably one the real policy accepts. A seed that inserted a
bcrypt hash directly could happily document a password registration would
reject.

### Two addresses, in two rate bands

Cairo 50.00 EGP, Alexandria 100.00 EGP. A developer with one address cannot see
that the fee moves, cannot tell a quote that priced shipping from one that did
not, and will hard-code whichever number they saw. This is the exact trap the
contract freeze exists to prevent, and one extra seeded row disarms it.

### Reset gives the stock back

Deleting an order does not restock. A reset that only deleted documents would
drain the seeded catalogue one run at a time until a product the docs name went
out of stock, with nothing to point at. The reversal reads the **inventory
events** rather than the order lines — those are the authority for what actually
moved, so it stays exact even for a partially fulfilled order.

Verified: stock and `salesCount` for both ordered products are identical before
and after `--reset` followed by a re-place.

### The credentials are a promise, so they are a test

`test/database/sandbox-seed.spec.ts` reads `SANDBOX.md` and the seed data and
compares them. A document is exactly the thing that drifts — someone changes the
seed, the docs keep the old value, and the first thing a new developer does is
fail to log in and conclude the API is broken. Nothing else in the repository
would have noticed. It also asserts the password passes the real policy and that
the address is on a reserved `.test` domain, so a development run can never mail
a stranger.

**One thing this forced:** the constants had to move to `sandbox.seed-data.ts`.
The seed is a script ending in `void main()`, so importing it to read a constant
*runs the seed* — which is what the first version of the test did. Same split as
`catalog.seed-data.ts` and `shipping.seed-data.ts`, for the same reason.

---

## The sandbox walkthrough, done adversarially (C3)

Phase 3's acceptance was "the Flutter developer completes the journey from the
docs alone", and **that walkthrough had never actually happened**. It has now:
a fresh `git clone` into an empty directory, `docker compose down -v` to destroy
the data volume, no `.env`, no `node_modules`, nothing cached — then
`SANDBOX.md` followed **literally**, executing only commands it contains.

Six defects. Two of them are the kind that only this exercise finds, because
everyone who already knows the answer never notices the question.

### 1 — `.env.example` shipped a working JWT signing key ⚠️ SECURITY

`JWT_SECRET=REPLACE_WITH_A_LOCALLY_GENERATED_KEY_OF_AT_LEAST_32_CHARS` is **57
characters**, and the schema's only rule was "at least 32". So:

```
cp apps/api/.env.example apps/api/.env     # §2, the first command
pnpm --filter api seed                     # worked
pnpm --filter api dev                      # booted
curl .../auth/login                        # returned a signed token
```

A complete, serving API on a signing key that is **committed to the repository**,
identical on every machine that skipped the step, forgeable by anyone who can
read the source. §2 said "then set `JWT_SECRET`" and nothing enforced it — and
the step is easy to skip precisely because everything works if you do.

The schema's own comment read: *"No default, deliberately: a defaulted signing
key is a token-forgery vulnerability that reaches production silently."* True of
the schema, false of the workflow. **A placeholder nothing rejects is a
default.**

Fixed in three places, because a doc fix alone would have left the hole:

- the schema refuses any `JWT_SECRET` starting with `REPLACE_`, and the refusal
  prints the generator command and the file to put it in;
- `test/infrastructure/env-example.spec.ts` reads `.env.example` and asserts the
  schema **rejects** its value — the example must stay unusable, and that is a
  property worth failing a build over rather than trusting to review;
- §2 now shows the diff to make, not just the command to run.

### 2 — a missing field reported the wrong rule

`POST /orders/{id}/cancel` with `{}` answered:

```
details[0].message = "reason must not exceed 500 characters"
```

`INTEGRATION.md` tells every client that the actionable sentence is
`details[0].message`, and the storefront's `customerMessage()` shows exactly
that. So the commonest mistake on that endpoint — sending no body, because
"cancel this order" reads like it needs none — produced a sentence about a
500-character ceiling on a field the caller never wrote.

The cause is general, not local: a field you did not send fails **every** rule
declared on it at once, and class-validator's order put the length rules first.

`validation-exception.factory.ts` now sorts each field's constraints
most-fundamental-first, so `details[0]` is the sentence worth showing across
every DTO in the API. `CancelOrderDto`'s `@IsString` message became "reason is
required — say why the order is being cancelled".

**No existing test moved.** The 846-test suite passes unchanged, because the
cases that assert on `details[0]` were all single-constraint failures.

### 3 — `INTEGRATION.md` was a release behind on shipping

> "Today `shippingPriced` is `false` for every order. When real per-governorate
> rates land it becomes `true`…"

D-8 landed. The walkthrough quoted Cairo at 50.00 EGP and Alexandria at 100.00
EGP, both `shippingPriced: true`. A mobile developer reading the SAFE section
would have concluded `true` does not happen yet and coded for one case.

Corrected rather than deleted, because the reason the field exists is the point:
a client that had branched on `shippingFee.amount === 0` compiled fine, passed
its tests, and would have started telling every Cairo customer their delivery
was not worked out on the day the rates arrived. It would do the same again the
day a free-shipping threshold lands.

### 4 — my own §4 example had the wrong HTTP method

I documented the quote as `GET /checkout/quote?addressId=…`. It is **`POST`**
with a body. Written from memory, wrong, and caught by running it.

### 5 — a second checkout cannot start the database, and says something unhelpful

`docker-compose.dev.yml` pins `container_name: nest-electronics-mongo`, so a
second working copy gets:

```
Conflict. The container name "/nest-electronics-mongo" is already in use
```

and `down -v` from the second copy silently does **nothing** — it is a different
compose project, so it tears down a stack that was never up. Neither the message
nor the doc says any of this. Added as a troubleshooting row with the fix.

### 6 — §3's command block omitted the step §4 depends on

The block a reader copies wholesale listed `seed`, `indexes:sync`,
`shipping:seed` and `dev`, but not `sandbox:seed`. Added, and the §7 reset
sequence now lists all four.

### What the journey needed that no document said

Beyond the above, running the full customer journey — browse → cart → address →
quote → place → history → cancel, plus an anonymous basket — required knowing:

| Needed | Where it was |
|---|---|
| `GET /users/me/addresses` is the path | the OpenAPI artifact only |
| `POST /orders/{id}/cancel` is the path | the artifact only |
| Cancellation **requires** a 3–500 character `reason` | **nowhere** |
| `Idempotency-Key` is mandatory on `POST /orders` | INTEGRATION.md ✓ |
| A retry answers `200`, not `201`, with an identical body | INTEGRATION.md ✓ |
| VAT is **inclusive**; there is no additive tax line | the DTO description only |
| The address book is capped at 10 | the error message only |
| Order *list* returns a summary with no `items` and no address | the artifact only |

None of these is a bug. All of them are why `MOBILE-HANDOFF.md` exists, and all
of them are in it.

### And it works now

Re-run end to end after the fixes, on a second clean clone and a destroyed data
volume: the API refuses to boot on the placeholder and names the fix, the guide
runs start to finish, and the journey completes — login, browse, cart, both
shipping bands, a placed order, an idempotent retry, history, a cancellation
with a reason, and an anonymous basket priced with no token at all.

---

## `docs/api/MOBILE-HANDOFF.md` (C4)

The artefact the mobile developer needed and did not have. `SANDBOX.md` gets an
environment running, `INTEGRATION.md` says what is stable, `openapi.v1.json` is
the contract — **none of them says which endpoints feed which screen, in what
order, or what to do when one fails.** That mapping existed only inside the
Next.js storefront.

Nine sections, all reference material — tables and step lists, no prose walls:

1. **Screen inventory** — 18 customer-facing screens, route, purpose, whether
   auth is needed. The cart is marked "both", which is the one that surprises.
2. **Per screen** — the calls, in order, what each sends and renders. Four
   screens share one endpoint and say so.
3. **Six flows end to end** — registration/verification, login and silent
   refresh, browse → cart → address → quote → place, history, self-cancel,
   password reset. Every step, and what each failure means.
4. **Shipping semantics** — the `priced: false` / `priced: true, fee: 0` trap,
   with a worked example of each against the sandbox account's two addresses.
5. **The guest cart** — what to store, how to price it, and the merge rules
   including whole-merge clearing and why.
6. **Errors** — 30 codes, the HTTP status, what the web UI shows, and whether
   the customer can recover.
7. **Rate limits** — every throttled route at its production number, what
   `Retry-After` means, and what not to do on a 429.
8. **What is NOT in v1** — twelve entries, each with its reason.
9. **Before you write a line of Dart** — seven contract conventions.

### Three things it says that nothing else did

**Cancellation requires a reason, 3–500 characters.** Written in a callout,
because sending `{}` is the single likeliest mistake on that endpoint — "cancel
this order" reads like it needs no body — and because the API's message for it
was itself misleading until this task fixed it. With the instruction that it must
**not** be defaulted: a reason nobody typed reads on the permanent record like
something the customer said.

**VAT is inclusive and there is no additive tax line.** `vatInclusive` and
`vatRateBps` are in every pricing block and a developer who assumes they are a
tax to add would overcharge every customer. The formula for displaying the
included amount is given precisely so nobody derives a different one.

**`shippingPriced: true` with `fee: 0` means FREE.** It cannot happen today —
no threshold exists — and the document says handle it anyway, because that is
the entire reason the field was shipped before the feature.

### Where the numbers came from

Not from memory. The endpoint list is generated from `openapi.v1.json` (50
operations, of which the customer-facing subset is documented here); the rate
limits are read out of the `@Throttle` decorators; the error table is the
storefront's own `ApiErrorCode` union and `customerMessage()` mapping; and the
response shapes, the headers, the VAT fields and the address cap were each
verified against a running API during the walkthrough rather than asserted.

Linked from the top of both `SANDBOX.md` and `INTEGRATION.md` — a handoff
document nobody can find is not a handoff.

### And the handoff document was checked against the contract, not trusted

Writing 35 endpoint references from a reading of the source is exactly the way a
document acquires a wrong path. So every `METHOD /path` in `MOBILE-HANDOFF.md`
is matched against `openapi.v1.json`, and every backticked error code against
`ErrorCode`.

**It found one, in my own text:** the home screen said
`GET /products?isFeatured=true`. The parameter is **`featured`**. Because
unknown query parameters are a `400 UNKNOWN_FIELD` rather than a silent ignore,
that would have been a dead first screen for whoever copied it.

Corrected, the full eleven-parameter set is now listed, and the mistake is left
in the document as the reason to take names from the artifact rather than from
prose. The check also found `RESOURCE_NOT_FOUND` — the generic 404 — missing
from the error table; added.

### One more gap the check did not catch, and a reader would have

**The API never returns an image URL** — every image field is a Cloudinary
`publicId` plus a `version`, and the client builds the delivery URL. That is
documented, in one table row inside `INTEGRATION.md`'s **UNSTABLE** section,
which is the last place somebody looks for a thing every screen depends on.

`MOBILE-HANDOFF.md` §5 now covers it properly: the URL shape, why the API stores
no URL (a stored URL makes changing CDN a data migration and deleting an image a
string-split), the three transformations the web storefront uses so the two
clients render the same images, why `version` matters for cache-busting, the one
place it is legitimately absent — a cart line, and what that costs — and the
fact that **no product has an image today**, so the placeholder path is the one
to build first.

---

# Frontend QA — the first pass with a browser open

Everything before this was reasoned from jsdom and a clean build. This is the
first time the storefront has been rendered, screenshotted at real phone widths
and looked at.

## Part 0 — making it judgeable

### The catalogue had no pixels

Every product image field resolves through `imageUrl()`, which returns `null`
without `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, so all 34 products rendered their
letter placeholder. A grid of blank boxes is uniform in a way a grid of
photographs never is: unequal card heights, clipped titles, aspect-ratio
handling and the gallery are all invisible against it.

`apps/api/scripts/generate-placeholder-images.mjs` draws one image per image the
seed already declares, at the **exact** `width` and `height` the database holds
— so the file matches the box the page reserved — and pushes the bytes through
`processUploadedImage()`, the same function `MediaService.upload()` calls. The
seed already had the awkward mix worth having: 25 images over 13 of 34 products,
squares at 1200×1200, landscape at 1600×900, one portrait at 900×1600, five
products with a three-image gallery, and 21 products with none at all.

`apps/storefront/e2e/qa/` serves them to the browser by intercepting
`res.cloudinary.com` **and** `/_next/image` — the grid uses a plain `<img>` and
the detail page uses `next/image`, which fetches from the server where no
browser-side route can see it. Intercepting only the first left every detail
image broken and looked like a product bug.

Nothing in `src/` knows any of this exists, and the URL the browser requests is
the URL production will request.

### Is this site Arabic?

**No, and nothing in it is prepared to be.** `<html lang="en">`, no `dir`
attribute anywhere, no Arabic character in `apps/storefront/src` or `packages/`,
no locale routing, no message catalogue, and the storefront never sends
`Accept-Language` — so the API's Arabic support is real and unreachable from the
web client. The catalogue has no Arabic content seeded either: `name.ar` is
`null` throughout. Details in the report; **no RTL work was started.**

### What governs the design

`DESIGN.md` plus `apps/storefront/src/app/globals.css`, which implements it.
`packages/config/src/tailwind.preset.ts` is **dead** — nothing imports it, there
is no `tailwind.config.*` anywhere, and the storefront is Tailwind v4 driven by
`@theme inline` in `globals.css`. It also disagrees: blue `#1d4ed8` and
Inter/Space Grotesk against the live rose `#e14a5c` and Albert Sans/Urbanist. It
was used as a reference for one of its colours and is otherwise reported, not
changed.

## The defect underneath the whole storefront: **`packages/ui` was not a Tailwind source**

Tailwind v4 detects its sources automatically from the stylesheet's directory
and **excludes `node_modules`**. `@nest/ui` is a workspace package reached
through a `node_modules` symlink, so it was never scanned: every utility used
only in `packages/ui/src` and nowhere in `apps/storefront/src` produced **no CSS
at all**.

135 classes. Measured, not estimated — the compiled stylesheet was fetched from
the dev server and every class token in `packages/ui/src` matched against it.
What that was doing to the shipped site:

| Missing | Effect |
|---|---|
| `bg-[#E14A5C]` | the sale badge: white text on a transparent background, over a light image box — **invisible** |
| `fill-[#EABE12]` `text-[#EABE12]` | star ratings could never be gold |
| `min-h-[38px]` | card titles reserved no second line, so cards in a row had different heights |
| `text-[18px]` | the price rendered at the inherited size |
| `z-[9999]` `w-80` `border-l-4` | the toast had no width, no stacking order and no colour bar |
| `top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%]` | any `Dialog` was not centred |
| `sr-only` | screen-reader-only text was **visible** |
| `[&_tr]:border-b` `align-middle` `overflow-auto` | tables lost their row separators and their scroll |
| the whole `before:*` set | the skeleton had no shimmer |

The reason nobody noticed is the worst part: the classes the storefront happens
to use as well *were* emitted, so the library was styled **in patches**. Patchy
looks like a design decision. Unstyled looks like a bug.

The fix is one line — `@source "../../../../packages/ui/src"` — and it took the
compiled stylesheet from 118,986 to 132,123 bytes. 139 unresolved tokens became
28, and those 28 are `tailwindcss-animate` utilities for a plugin that is not
installed, two import strings the scanner cannot tell from classes, and
`text-warning`.

### `--color-warning` was simply absent

`StatusBadge` styles `pending`, `processing` and `pending_payment` with
`bg-warning/10 text-warning border-warning/20`. No `--color-warning` was
defined, so none of the three produced a rule and **an order waiting to be
confirmed — where every cash-on-delivery order starts — drew a badge with no
background, no border and inherited text.** Defined now, at the value this
repository already chose for the role in `tailwind.preset.ts` (`#b45309`, 5.9:1
on white) rather than DESIGN.md's `#EABE12`, which is specified there for star
fills and is about 1.7:1 as text.

## Every product image on the site was invisible

`ProductCard` renders its `<img>` at `opacity-0` and flips to `opacity-100` in
`onLoad`. The card is **server-rendered**: the browser starts the fetch when the
HTML arrives and very often finishes before React hydrates, so `load` has
already fired by the time `onLoad` is attached, the state never flips, and the
image sits at zero opacity for the life of the page — fetched, decoded, laid
out, invisible.

Measured on the home page before the fix: **12 of 21 images at `opacity: 0`,
every one of them `complete` with a real `naturalWidth`.** The failure mode is
inverted in the worst way — the *faster* the image arrives, the more certainly
the event is missed, so a slow first load looks fine and a reload from cache
shows nothing.

Fixed in the primitive by asking the DOM instead of waiting for it:
`img.complete && img.naturalWidth > 0` in a mount effect, with `onLoad` still
handling the in-flight case. `naturalWidth` is what separates "already loaded"
from "failed", and fading in a failed image would replace the letter placeholder
with nothing.

## Every product was rated zero stars

`toProductCard` did `rating: product.rating.average / 100`, with a comment
asserting the API sends hundredths. It does not: `ProductRatingDto.from` already
does `Math.round(average) / 100` and `openapi.v1.json` documents the field as
"Mean score, 0–5, one decimal". So 4.47 became 0.0447, `Math.floor` made it
zero, and every product on the site drew five empty stars **beside its review
count** — "29 people rated this nothing", which is worse than showing no rating
at all.

The same division was in the product detail page, where it also feeds
`lib/json-ld.ts` — so the structured data offered to search engines said the
entire catalogue was rated 0.04 out of 5.

## The body scrolled sideways on a phone, on six routes, for three reasons

Measured, not guessed: `document.documentElement.scrollWidth` against
`clientWidth` at each breakpoint, with `e2e/qa/overflow.mjs` naming the element.
At 360px the catalogue was **90px** wider than the screen.

The naive detector — "list every element wider than the viewport" — finds
nothing, because a block parent does not grow when a child overflows it. It has
to look at every element's right edge, fixed ones included: a `position: fixed`
bar with `left-0 right-0` stretches to the DOCUMENT width, so the mobile bottom
navigation was being dragged off-screen as a symptom and looked like a cause.

| Route | Cause |
|---|---|
| `/` | the New Arrivals grid item: default `min-width: auto` on a grid item means the track cannot be narrower than its content's min-content width, and the list card's was 439px |
| `/products` and every filtered view | six sort chips in a row that neither wrapped nor scrolled — "Top Rated" and "Name: A-Z" were off the right edge of the screen, and the labels broke mid-phrase ("Price:/Low to/High") trying to fit |
| `/products/<slug>` with a long name | the breadcrumb pill is `inline-flex`, so it sizes to its content and ignores its container: 413px of "Home · Development Boards · <name capped at 200px>" plus padding |

`min-w-0`, `flex-wrap` + `whitespace-nowrap`, and `flex-wrap` + `max-w-full`.
No layout was redesigned; the same elements in the same order now fit. Verified
at 360 and 390 on all four routes: `scrollWidth === clientWidth` exactly.

### The catalogue had no `<h1>`

Every other route has exactly one. `/products` identified itself only through
the last segment of its breadcrumb, which lives in a `<nav>` and is not a
heading — so the most indexable page on the site had no top-level heading, and a
screen reader's heading list showed it as untitled. Added as `sr-only`, because
the design deliberately puts the page's identity in the breadcrumb and the
toolbar; whether the catalogue should have a visible title is a question for the
owner and is in the report, not decided here.

### And one thing that was reported closed and actually is

**Exactly one `<main>` on every route at every one of the five breakpoints** —
24 routes × 5 widths, counted in the DOM rather than in the source. The root
layout owns the only one and no page adds a second.

### Six dead links in the chrome of every page — and the gap underneath them

`/about`, `/faq` and `/vendors` have never been routes. They were in
`TOP_NAV_LINKS` and `MAIN_NAV_LINKS` in `packages/config`, which the top bar,
the category nav and the mobile menu all render, so each one was a 404 **in the
chrome of every page on the site** — a crawl of fifteen customer-facing pages
found six such links, each present on all fifteen. `/brands`, `/shipping` and
`/returns` were the same story in the footer.

Removed rather than pointed somewhere plausible: a link that lands on the wrong
page is a worse answer than no link.

**That is the bug. This is the finding underneath it, and it is not a bug.**

An About page and an FAQ are missing content, not broken code, and for this shop
specifically they are worth more than they would be for most. Everything here is
**cash on delivery**: a customer in Egypt hands cash to a courier for goods they
have not yet seen, from a shop they have not bought from before. The questions
they need answered before they will do that are exactly the ones those two pages
answer — who is behind this, where are you, what happens if the board arrives
dead, how long does delivery take to my governorate, what does it cost, can I
refuse it at the door.

The API can already answer several of those factually. `GET /fulfilment/rates`
knows the per-governorate delivery fee, and `ORDER-LIFECYCLE.md` defines what
happens on a failed delivery and on a return. So an FAQ is not blocked on a
decision — most of its content already exists as behaviour and only needs
writing down for a buyer rather than for a developer.

`/vendors` is different and should not come back: it describes a marketplace
with third-party sellers, and this is a single-merchant shop. There is no vendor
domain, no seller onboarding and no split settlement anywhere in the design.
Removing that link corrected a claim the product does not make.

**Recorded, not built.** Writing an About page is a content decision for the
owner and copy nobody on this side should invent — inventing a company history
is worse than having none. The entries go back into `TOP_NAV_LINKS` the day the
pages do, and the same is true of `/shipping` and `/returns` in the footer.
Flagged here as a launch-readiness gap rather than a defect: the site works
without them, and a first-time COD buyer is measurably less likely to complete
a purchase because of it.

---

# Phase 6 — the admin on the API: orders and staff identity

The storefront has placed orders in Mongo through the NestJS API since T2. The
admin console read Supabase. **So every order a customer placed was invisible
to the console that exists to fulfil it**, and had been since T2.

That is what this phase fixes, plus the two things that had to exist first: a
way to create the operator who signs in, and a way to know that the browser
tests of a second Next application are not as hollow as the storefront's were.

## What I found about transition attribution, before building anything

The API was **already recording it, correctly, and exposing it nowhere.**

`OrderLifecycleService.apply` resolves the actor from the token, snapshots
`{id, role, name}` onto the history entry, and writes it in the SAME guarded
update as the status change. So an order whose status moved without a named
actor is not representable — not discouraged, not unlikely, unrepresentable.
The role comes from the database profile rather than the JWT claim, so an
account demoted since its token was issued cannot still ship goods. That half
was sound and I did not touch it.

What was missing is that **no DTO serialised any of it**. `statusHistory` was
absent from `OrderDto` and from `OrderSummaryDto`, so the trail existed only in
the database. No console, no report and no support conversation could reach it;
the only way to answer "who confirmed this order" was to open a Mongo shell.

An unreadable audit trail is not an audit trail. Exposing it was the minimum,
and it lands on a new `AdminOrderDto` rather than on the canonical `OrderDto` —
a customer must be able to see that the shop cancelled their order without
learning which member of staff did it, which is why `OrderCancellationDto.by`
carries the ROLE and nothing else.

### The second thing the admin needed, which also did not exist

`allowedTransitions`. The console held its own transition maps — in
`order.actions.ts` AND a second copy in `OrderDetail.tsx`, over a status
vocabulary the API does not have — and they had already drifted from each other.
Neither was enforced: the RPC underneath was callable by the `anon` role, so the
state machine was advisory (F-CRIT-1 / F-HIGH-1).

The API now computes the available moves with the same `checkTransition` its
engine calls before it writes, and each move carries **its endpoint**, not just
its target status. That last part matters more than it looks:

- `-> SHIPPED` is `ship` from `CONFIRMED` and `retry-shipment` from
  `DELIVERY_FAILED`, with different mandatory fields. A map keyed by target
  status would be wrong half the time, in the expensive direction.
- The matrix permits a staff actor to drive `-> CANCELLED`, and this API exposes
  no staff route for it — cancelling is the customer's own operation. Reporting
  `action: null` is the honest answer; omitting it would hide a thing the order
  genuinely permits, and offering it would draw a button that posts to nothing.

## Staff provisioning: what it looks like, and how it refuses to be run carelessly

Nothing could mint the first `SUPER_ADMIN`. Registration hard-codes
`Role.CUSTOMER`, and there is no endpoint, DTO field or flag that produces a
staff account — correctly. So the shop could not be operated at all until
somebody edited the database by hand.

`pnpm --filter api staff:create` is the replacement, and it is deliberately
awkward, because this is the exact shape of command that produces a default
credential. The usual version takes `--password` with a fallback, prints
"admin / ChangeMe123!", and is run once on every environment including the real
one. **This project has already shipped that bug one layer down**: a
`JWT_SECRET` placeholder that passed its own validator because it was 57
characters and the rule was "at least 32".

The lesson generalises, and it is the rule the command enforces: **a placeholder
nothing rejects is a default.** Length rules and character classes reject
nothing that matters. Asking whether the value is already written down rejects
exactly the values that do.

| Guard | What it refuses |
|---|---|
| No `--password` at all | Prompted twice, no echo. An argument is visible in `ps` and in shell history — and an argument is a thing that can be given a default. A prompt is not. |
| The password policy | Everything a customer's password is refused for |
| **The repository scan** | Any value appearing in a file in this checkout — including both passwords printed in `SANDBOX.md`. The refusal names the FILES, never the value |
| Typed confirmation | The email, name and role are printed and the ADDRESS must be retyped. A `y/n` prompt is one keystroke from an accident |
| Production second super-admin | Refused unless `--acknowledge-existing-super-admin` is passed |

It prints no credential on success. Not the password, not a generated one, not a
"temporary" one — the person who typed it is the only person who knows it, which
is the only arrangement where nobody has to be trusted to rotate it afterwards.

**If the repository cannot be scanned, it refuses** rather than assuming clean.
A check that silently degrades to green when it cannot run is worse than no
check, because it reports the same green as one that ran. There is no flag to
skip it: a bypass on a control like this becomes the documented way to run the
command.

### The dev-only admin, and why a published password is acceptable there

`pnpm --filter api dev-admin:seed` creates `admin@nest-electronics.test` with a
password written in `SANDBOX.md` §4a. That is a fixture, not a default, and the
distinction rests on three fences — the same three the sandbox customer has:

1. `.test` is reserved and unresolvable (RFC 2606), so the address can never
   belong to a person or receive mail.
2. The seed refuses `NODE_ENV=production`, and `StaffProvisioningService`
   independently refuses a `.test` address there. The seed failing open would
   still not create it in production.
3. `test/database/dev-admin-seed.spec.ts` asserts the docs, the seed and the
   password policy all agree.

It goes through the same service, so the documented password is provably one the
real policy accepts. It is exempt from exactly one rule — the repository scan —
and only because its address ends in `.test`, which production refuses one check
earlier. The two rules are a pair; neither is safe alone.

## The admin harness landed before the first admin spec

The storefront ran 44 browser specs that were all hollow for five phases:
`next dev` refused every cross-origin `/_next/*` request, React never booted,
and everything passed because pages server-render and forms submit by
progressive enhancement. The only visible symptom was a hot-reload WebSocket
error, which was diagnosed as dev noise and added to a suppression list.

The admin is a second Next application with its own dev server and its own
config, so it could reproduce that independently, in a place nobody watches. Its
harness therefore landed first: one HOST constant, the hydration canary before
every spec body, and **the canary itself tested three ways** — live, dead
(chunks aborted), and slow-then-alive, the last because a probe that only ever
said `false` would satisfy the dead case and fail everything real.

There is no blanket suppression list. `allowConsoleError(pattern, reason)` takes
the reason as a required parameter, and the run prints every suppression with
its reason, pass or fail. Across every admin run so far the line reads
"nothing was ignored in this run".

**Honestly, about what was measured:** the canary is proven by aborting chunks,
not by reproducing a cross-origin refusal. I tried to reproduce one on Next
16.2.4 and could not — `127.0.0.1` and `localhost` differ to the dev server's
allow-list but are the same origin to the browser once the page is served from
one of them, so a deliberately wrong `allowedDevOrigins` still hydrated cleanly.
The origin pin stays anyway (it costs one constant and a release can tighten the
rule again), but what actually protects the suite is that the canary asserts the
OUTCOME — no React root — so it catches a dead client from any cause.

## The specs found five bugs the code review had not

Every one was found by running, not by reading — and the code had been read.

1. **Every render of the sign-in page was a 500.** `EMPTY_LOGIN_STATE` was
   exported from a `'use server'` module, which may export async functions and
   nothing else; every other export is stripped silently. `useActionState` got
   `undefined` and the form read `state.fieldErrors`. A console nobody could
   sign in to.
2. **The proxy's redirect dropped the basePath.** `new URL('/login',
   request.url)` gives `/login`, not `/admin/login`. The redirect happened, the
   browser left the guarded page, and it landed nowhere.
3. **A second fabricated identity in `Sidebar.tsx`** — "Admin User /
   admin@nest.com / AD" again, with its own `supabase.auth.signOut()` that
   revoked nothing. Grepping the header alone missed it; the whole-page
   assertion did not.
4. **Radix cancelled the sign-out.** `DropdownMenuItem` calls `preventDefault()`
   on the selecting click, which killed the form submit inside it. The button
   did nothing at all, silently.
5. **`getByRole('alert')` is ambiguous** — Next renders its own route announcer
   with that role.

And one in my own test, worth recording because it is the failure mode this
engagement keeps finding: the "no fabricated identity" check listed `'AD'` as a
forbidden substring of the whole page. It matched inside unrelated words. That
is the same overbroad-substring mistake as the seven vacuous money assertions;
the initials are now asserted on the avatar element.

## What the console stopped claiming

Three panels were removed rather than repointed, and the reasoning is the same
each time: a plausible number is worse than an absent one.

- **Revenue**, on both the queue and the dashboard. No API endpoint aggregates
  it. Summing a page gives a figure that changes when you paginate; fetching
  every order is a table scan per load.
- **Top Products by units sold.** Its only source was a join through
  `order_items` — discarded by D-6 — and the API has no sales ranking.
- **The dashboard's five order queries.** Stale or zero, and every "Recent
  Orders" row linked to `/orders/<supabase-uuid>`, which the API-backed detail
  page refuses because it is not a 24-character hex id. A literal legacy-orders
  view: a table of orders nobody could act on.

Counts show an em dash, never `0`, when a request fails. Zero is a claim — "no
orders are awaiting confirmation" — and a fulfilment console must not make it
because a request failed. The same rule governs the queue: when it cannot be
read it says so and shows nothing, because an empty table is indistinguishable
from a quiet morning and is the most expensive lie this console could tell.

## The audit trail is broken, and now says so

`admin_audit_logs.admin_id` has a foreign key to Supabase `profiles.id`. The
acting admin is now an API account, so every insert would violate it — and the
previous code wrapped the insert in a `catch` that logged and continued, on the
correct principle that audit logging must never break the operation it records.
The consequence is that the trail would have gone silently empty on the day
identity changed, and nobody would have found out until they needed it.

It now refuses those writes up front and reports it once per process, naming the
reason and Phase 7. **Order lifecycle actions are unaffected and are strictly
better off** — the API records their actor on the order itself, and this phase
is the first time any screen could read it.

---

# Phase 7 — one database per suite, and a residue check that can go red

Taken out of order, ahead of anything else in this phase, because the debt it
clears had just cost real debugging time and destroyed real data.

## What actually happened

The admin browser suite shipped without a teardown. It places a real order per
spec, through the real checkout, which really does decrement stock. Twelve
specs and several runs later the shared development database held **62 accounts,
35 orders and four products at zero stock out of thirty-four**.

The failure appeared in the STOREFRONT suite. `/products › filters by brand and
by stock` and the purchase journey went red over a catalogue they had not
touched, while the suite that emptied it stayed green. That is the worst shape
test residue can take, and it is the reason the rule below is now standing
practice:

> **Compare failing test names, never counts.** A count hides a swap.

The count in that run went 5 → 6 and read as one new problem. It was three
failures disappearing and four appearing.

## A teardown fixed the instance and not the class

Adding the missing teardown put the catalogue back. It does not make the suites
isolated, because **a teardown only runs on the happy path**. This session alone
has had a Mongo container die mid-run, a dev server run out of memory, and an
editor crash kill a run outright. In each of those the teardown never executes
and the residue is back, in a database three suites and one developer share.

So each suite now owns a database:

| Suite | Database |
|---|---|
| `apps/api` jest | `nest_electronics_scratch_api` |
| `apps/storefront` Playwright | `nest_electronics_scratch_storefront` |
| `apps/admin` Playwright | `nest_electronics_scratch_admin` |

`PLAN.md` §20 item 7 and §25 item 7 recorded this as isolation debt scheduled
for Phase 10. Both are now closed.

## Rebuilt when dirty, reused when clean

The instruction was to drop the database wholesale rather than reason about what
the last run left behind. It does — but only when there is something to drop.
Preparation records a **baseline** in the database it has just built: every
collection's document count, every product's stock per SKU, and a fingerprint of
the seed data. A run that ended clean leaves a database matching that exactly,
and rebuilding it would be twenty seconds of seeding to arrive at the state
already present.

The property that matters survives: **nothing ever works out WHAT to remove.**
The judgement is binary — matches or does not — and the remedy for "does not" is
always the same total drop, index sync, catalogue, shipping rates, development
admin. There is no surgical cleanup path to get subtly wrong, which was the
whole failure mode.

The seed fingerprint is in the baseline for the other half of the problem: a
database that is clean but STALE passes every check and then fails specs for
reasons that have nothing to do with the code under test.

## "Zero residue" is now an assertion

The teardowns used to print `removed 12 user(s), 11 order(s), reversed 12 stock
movement(s)`. **A count of what a cleanup found says nothing about what it
missed**, and what it missed is the entire failure mode.

Every suite now ends by comparing the database against its recorded baseline. A
run that left anything FAILS and names it, per collection and per SKU:

```
The api-jest suite left 1 thing(s) behind in nest_electronics_scratch_api:
  · refreshTokens: 2 document(s), prepared with 0 (+2)
```

Stock is compared per SKU rather than in total, because a total nets off: one
product over-restored and another under-restored sum to the right answer and
read as clean.

### It found two things on its first full run

1. **`media-upload.spec.ts` and `cloudinary-integration.spec.ts` leaked refresh
   tokens.** Both create accounts, sign them in, and delete the users — and
   deleting a user does not delete the session row it opened. Two orphaned
   documents per run, invisible for months. Both teardowns now remove them.
   *This is the one existing-test edit in this change, and it is a defect fix
   rather than an accommodation: those suites are stricter afterwards, not
   looser.*

2. **The admin suite left fifteen operator sessions per run.** Every spec signs
   the development admin in, and that account is a seeded fixture deliberately
   outside the `admin-e2e.` namespace the teardown cleans — so it survived, and
   so did its refresh tokens. The account is still left alone; only its sessions
   go now. The constants the two halves of that suite disagreed about live in
   one module, `e2e/fixtures/accounts.ts`, because the split is what hid it.

3. **`orderCounters` is not residue and must not be treated as it.** It holds
   one document per day carrying that day's order-number sequence, and deleting
   it would reissue a number already used. It is the ONLY exclusion, written by
   name rather than as a pattern — an exclusion rule wide enough to be
   convenient is wide enough to hide what this check exists to find.

## The out-of-stock fixtures are protected explicitly

Three products — `NRF52840-DONGLE`, `SIM800L-GSM`, `BNO055-BREAKOUT` — are
seeded at zero on purpose, and they are the **only out-of-stock coverage in the
repository**: the OUT OF STOCK badge, the disabled add-to-cart button and the
`/products` stock filter have no other fixture.

A teardown that reverses inventory events restores stock. If one ever
over-restored these, every test involved would go green while covering nothing.
So the drift message for those three SKUs is different from every other and says
what restoring them costs; the list is DERIVED from the seed rather than written
out, so restocking one in the seed data cannot leave a stale list behind; and a
test asserts the derived list is non-empty, because a list that quietly became
empty would make every assertion about it vacuously true.

## Two fences before any drop, and both earned it

`dropDatabase` is the operation being guarded, so the guard has to be something
an accident cannot satisfy. A rule like "any name ending in `_test`" is
satisfied by a typo; a fixed set of three is satisfied only by one of the three.

The first run proved the point immediately. `AppModule` was imported at the top
of the harness, and `ConfigModule.forRoot()` executes INSIDE the `@Module`
decorator argument — so the environment was read, validated and frozen the
moment that module was imported, which is before any function in it could set
`MONGODB_DB_NAME`. The connection landed on `nest_electronics_dev`, and the next
statement would have dropped it. It refused:

```
Expected to be connected to "nest_electronics_scratch_api"
but the driver reports "nest_electronics_dev".
```

Every import that reaches `AppModule` is now deferred to the point of use. The
fence stays, because it is what will catch the next version of that mistake.

### What the fence actually prevented, which is the argument for having it

Worth separating from the anecdote above, because the two are different claims.

The fence's **first real action was preventing the destruction of
`nest_electronics_dev`.** Not a near miss discovered afterwards, not a
hypothetical the control might one day earn: the first time the harness ran, the
next statement after the check was `dropDatabase()` on a connection pointed at
the development database, and the check is the only reason it did not execute.

The cause is worth stating precisely, because it is not a mistake anybody
notices by reading. `ConfigModule.forRoot()` executes **inside the `@Module`
decorator argument**, so the environment is read, validated and frozen at the
moment `AppModule` is first imported — which is before any function in the
harness can set `MONGODB_DB_NAME`. The override was correct, the import order
made it arrive too late, and every log line said the run was fine.

That is the justification for the control rather than a story about its outcome.
A guard on `dropDatabase` is not defence in depth against a careless operator;
it is the thing standing between a correct-looking change and the loss of a
developer's database, in a codebase where the failure mode is invisible at the
call site.

### Isolation was proven under abnormal termination, not a clean exit

The property claimed for per-suite databases is that a run which *dies* cannot
damage anything shared. Verifying that under a clean exit would prove nothing —
a clean exit runs the teardown, which was already the mechanism that failed.

Three runs were killed mid-flight during this session, by memory pressure rather
than by design. Afterwards `nest_electronics_dev` held 34 products with exactly
3 at zero stock — its seeded state, untouched — and the next run reported
`rebuilt nest_electronics_scratch_storefront` and carried on. The damage was
confined to the database the dead run owned, and recovering it required no
reasoning about what that run had left behind.

## The override is resolved into the URI, and that was not the first design

`MONGODB_DB_NAME` started as a second option passed to Mongoose alongside the
URI. The transaction gate found the flaw within one run.

`test/infrastructure/transaction-gate.spec.ts` opens an INDEPENDENT verifier
connection built from `databaseConfig.uri` — deliberately, because proving a
transaction committed requires a connection that was never inside it. With two
mechanisms the writer went to the scratch database and the verifier to the
development one, and the gate failed with `Expected: 1, Received: 0`.

It was right to. The override is now applied by rewriting the URI inside the
configuration boundary, so there is ONE string and whatever connects with it is
on the same database as everything else. Credentials, every host of a replica
set and the option string are preserved verbatim — the parts that are hard to
reproduce and easy to corrupt — and each of those is a test.

## A reused API server is a database hazard, not just a throttle one

Both Playwright configs had `reuseExistingServer: true` locally. That means an
API a developer started by hand — pointed at the DEVELOPMENT database, with
production rate limits — silently became the system under test. `global-setup`
caught the rate-limit half of that. Nothing caught the database half, and that
is the half that destroys data.

Both are now `reuseExistingServer: false`. The cost is one build and boot per
run; the alternative is a suite writing real orders into whichever database
somebody else's process happened to leave open.

## The same bug again, one layer up: a shared `.next`

The first admin run on its own database failed 11 of 28 — every spec in
`admin-orders.spec.ts` — and the symptom was absurd: `/admin` answered 200 while
`/admin/orders`, `/admin/products`, `/admin/customers` and `/admin/inventory`
all answered a clean 404. No error, no warning, no stack trace. Half the console
simply did not exist.

It was not the database and it was not the API. Proof, in order:

1. `GET /api/v1/admin/orders?status=PLACED` against the running API returned the
   three orders the specs had just placed. The data was there.
2. `/admin/products` and `/admin/customers` are still Supabase-backed and make
   no API call at all. They 404'd too.
3. The suite starts a SECOND `next dev` on the same source for the
   unreachable-API specs, and that one has its own build directory
   (`.next-dead-api`). It served `/admin/orders` correctly at the same moment
   the first server 404'd it.

Same source, same request, same second — the only difference was `distDir`. The
`.next` directory was poisoned, and Next served the poisoned route manifest
without a word.

`pnpm dev` and the browser suite both wrote to `.next`. A killed run, or two
servers racing on it, leaves a cache the next server reads happily and wrongly.
That is the same defect as the shared database, one layer up: **shared mutable
state between a developer and a test run, with no fence around it.**

So the fix is the same shape. Each browser suite now passes `NEXT_DIST_DIR` and
gets its own build directory; `pnpm dev` keeps `.next`. The eleven specs pass on
the first run afterwards.

Worth stating plainly: **this failure was not caused by the isolation work, and
it was not visible before it.** The suite's previous green run used whatever
`.next` happened to hold at the time. Nothing in the harness would have told
anybody the difference, which is the part worth fixing.

## A recorded hazard this narrows

`HANDOFF.md` notes that `apps/api/.env` once pointed `MONGODB_URI` at a live
Atlas cluster, and that the 527-test suite was deliberately NOT run against it:
"a suite that creates and deletes users, carts and orders should not run
unattended against a shared cloud database."

That is now less dangerous and not yet safe. Whatever cluster the URI names, the
suites write only to `nest_electronics_scratch_*` on it, and the harness will
drop nothing else — the development database on that cluster is refused by name.
What it does NOT do is stop three scratch databases being created on somebody's
shared cluster. The right answer is still a local Mongo for tests; this makes
the wrong answer survivable rather than acceptable.

## The admin console 500'd when an access token expired

Found by probing the dev server with a session the API rejects, not by a test —
no test in this suite has ever held a token long enough:

```
⨯ Error: Cookies can only be modified in a Server Action or Route Handler.
    at clearSession (src/lib/api/session.ts:120)
    at async apiFetch (src/lib/api/client.ts:153)
    at async readIdentity (src/lib/api/identity.ts:68)
    at async requireAdmin (src/lib/api/identity.ts:151)
    at async OrdersPage (src/app/(dashboard)/orders/page.tsx:75)
```

`apiFetch` refreshed on an expired access token and stored the new pair.
Storing means writing cookies, and this version's own documentation is
unambiguous: *"Setting cookies is not supported during Server Component
rendering. To modify cookies, invoke a Server Function from the client or use a
Route Handler."* `tryApi` only catches `ApiError`, so the write threw and the
page 500'd.

**The half that was worse than the crash.** The refresh had already SUCCEEDED
server-side, so the API had rotated the refresh token and burned the old one.
The new pair was never persisted, so the browser went on presenting the burned
token, and the next attempt came back `REFRESH_TOKEN_REUSED` — which the API
correctly treats as theft and answers by revoking the whole family. A stack
trace, then a silent sign-out, from leaving a tab open for fifteen minutes.
On a console that moves money.

### Why not middleware, which can write cookies

It was the obvious candidate and `proxy.ts` already argued against it, in
writing, before any of this: middleware runs on every request a page load
makes, including the RSC prefetch a hovered link fires. The refresh token
rotates on every use, so two concurrent renewals burn each other and the loser
is read as theft. The symptom is a sign-out nobody can reproduce — the same
failure, arrived at from the other direction.

### One place, reached by one redirect

`app/session/renew/route.ts`. `apiFetch` now writes no cookie at all and an
expired access token surfaces as a new typed kind, `expired`, distinct from
`unauthenticated` — collapsing the two is what threw operators onto the sign-in
page for the crime of sitting still. `requireAdmin` redirects to the renewal
route; the route renews once, stores the pair, and redirects back. Single-flight
by construction rather than by hoping two requests do not overlap.

Three things the route is careful about:

- **The base path is derived, not assumed.** The docs promise automatic
  `basePath` prefixing for links and say nothing about route handlers. The last
  assumption about base paths cost a whole browser run — the redirect happened
  and landed nowhere — so the prefix is read off the path that actually arrived.
- **A loop guard.** Renewal succeeding and the very next request still being
  refused is possible (an account revoked between the two), and every step
  reports success, so it loops forever. A thirty-second breadcrumb cookie sends
  the second consecutive expiry to the sign-in page instead. Thirty seconds
  because a fresh access token is good for fifteen minutes: any second expiry
  inside that window is a fault, not a race.
- **`next` is an open redirect unless checked.** `//evil.example` is another
  origin to most parsers. It is discarded rather than repaired.

### The specs break the token instead of waiting

Waiting fifteen minutes is not a test. The nine specs replace the access cookie
with a value the API rejects and leave the refresh cookie intact —
`TOKEN_INVALID` and `TOKEN_EXPIRED` take the identical path through both the API
and the console, which is what makes the substitution honest rather than
convenient. They assert the renewed pair was PERSISTED, not merely that a page
rendered: a page can render from a renewal whose result was thrown away, and
that is exactly what the old code did.

### Verifying it found two more bugs, both in the redirect

The Playwright config needs three web servers and this machine could not start
the third, so the same twelve assertions were driven against two servers started
by hand. That run went **5 passed, 7 failed**, and every failure had one cause:

```
location: http://localhost:3200/orders     <- should be /admin/orders
```

1. **The redirect dropped the base path.** Every renewal landed on a route that
   does not exist. The first implementation derived the prefix from the request,
   on the reasoning that deriving beats assuming — but the derivation was itself
   an assumption. Measured on Next 16.2.4, for a request to
   `/admin/session/renew`: `request.url` is `http://localhost:3200/session/renew`
   with the prefix **already stripped**, `nextUrl.pathname` is `/session/renew`,
   and `nextUrl.basePath` is the empty string. There is nothing left to read it
   from. So `BASE_PATH` is written down once, in `renewal.ts`, and
   `next.config.ts` mounts the application with that same constant — the two
   cannot drift.

2. **Rebuilding an absolute URL moved the origin.** `NextResponse.redirect`
   requires one, and the origin came from `request.url`, which Next reports as
   `http://localhost:3200` even for a request made to `127.0.0.1`. Those are
   different origins to `next dev`, to a cookie jar, and to this suite's origin
   pinning — the exact class of mismatch that cost the storefront five phases of
   client-side coverage. The route now returns a RELATIVE `Location`, which is
   legal and which the browser resolves against the URL it actually asked for.

After both fixes: **12 assertions, 0 failures** — the page renders, the rotated
pair is persisted, the operator is still the operator, a second navigation does
not rotate again, an unrenewable session goes to sign-in with no dead cookies
left behind, and the renewal route refuses both a protocol-relative and an
absolute `next` while still honouring an ordinary path.

### And it corrected the spec

The first diagnosis of the base-path bug was wrong, and wrong in an instructive
way. `curl` showed `/admin/orders` answering **200** rather than a redirect,
which read as "the renewal never fires". It fires: the console shell has already
streamed by the time the page segment decides to renew, and HTTP cannot redirect
a response that has begun — so Next performs it client-side and the first
response is a 200 carrying the instruction.

The spec had asserted `expect(response.status()).toBe(200)`, which would have
passed against a broken implementation exactly as readily as a working one. It
now waits for the heading that only appears once the chain has completed against
a working session.

**Status:** the behaviour is verified in a real browser. The spec FILE has still
not been executed under Playwright's own runner, because the third web server
cannot start here — see the note at the end of this log.

## Storefront failure set, by name

Confirmed on the repaired catalogue, before this work began:

| Spec | Damaged run | Repaired run |
|---|---|---|
| `guest-cart-journey.spec.ts:385` | fail | gone |
| `purchase-journey.spec.ts:49` | fail | gone |
| `t1-catalogue.spec.ts:109` brand/stock filter | fail | gone |
| `qa-layout.spec.ts:253` inert control | fail | fail (pre-existing) |
| `qa-layout.spec.ts:291` 44px target | fail | fail (pre-existing) |
| `t1-chrome.spec.ts:82` footer | fail | fail (pre-existing) |
| `t1-catalogue.spec.ts:177` spec table | — | **fail, unexplained** |

The three I caused are gone and the three pre-existing ones remain. The last row
is a name that had never failed before. It passes 3/3 in isolation, and
Playwright had already cleared its artefacts by the time I looked, so it is
recorded as **unexplained rather than as a flake** — calling it a flake without
its error text is exactly the reasoning this section argues against.

## What this machine could and could not verify

Stated because a verification section that quietly omits the tests that did not
run is worse than one that says so.

This box has **7.7 GB of physical memory**. For most of this session another
project on the same machine — `D:\ahmed-adel-project` — has had a `next dev`
server up and, for part of it, its own full unit suite running: seven worker
processes and roughly 500 MB. Free physical memory measured between **0.6 and
1.4 GB** throughout, with none of this repository's processes running.

The browser suites do not fit in that. The admin suite alone starts three
servers — the API plus two `next dev` instances, the second existing so the
unreachable-API specs have something to point at — and each Next server is
configured to be allowed a 4 GB heap. Runs were killed repeatedly, and the
failures they produced were not test results:

- `not-found.spec.ts:92` reported `Expected 404, Received 500`, and the browser
  console named the cause: `Jest worker encountered 2 child process exceptions,
  exceeding retry limit` — Next's dev compile worker being killed, so the dev
  server answered 500.
- The last attempt did not reach a test at all: `Process from config.webServer
  was not able to start. Exit code: 3221225794` — `0xC0000142`,
  `STATUS_DLL_INIT_FAILED`. `nest build` could not initialise.

None of that is attributable to the code, and reading it as a regression would
have been the same mistake as reading a count instead of a name.

**Not touched:** the other project's processes. They are somebody's work in
flight, and killing them to make a test run green is not a trade this repository
gets to make. Only orphans belonging to this repository's own killed runs were
reaped.

**Verified anyway, without a browser:** `tsc --noEmit` and `eslint` clean across
all three workspaces, and a full `next build` of the admin — which is what
proves `/session/renew` is a legal, registered Route Handler rather than merely
legal TypeScript.

**Verified against hand-started servers:** the session-renewal behaviour, twelve
assertions, zero failures — after that run found two real bugs in the redirect.
Two of the three web servers the admin config needs did start; only the
unreachable-API one, which these specs do not use, could not.

**Left unverified:** the storefront browser suite, and the spec FILES themselves
under Playwright's own runner. They are written, they type-check, and the
behaviour they describe has been driven end-to-end — but nothing has executed
them as specs.

---

# Phase 7 Part 2 groundwork — a spec should depend on what it uses

## The flaw

`playwright.config.ts` listed three web servers. One of them exists for four
specs: the same admin application pointed at a port nothing listens on, so
`readAdminIdentity()`'s third outcome — *the API could not be asked* — can be
reached at all. It cannot be reached any other way, because `GET /auth/me` is
issued SERVER-side by the Next process, so `page.route()` cannot intercept it,
and stopping the real API would break every other spec in the run.

Playwright has no per-project web server: `webServer` belongs to the CONFIG, so
every server listed is started for every spec in it. A server four specs needed
was therefore a hard dependency of all thirty-seven.

**That is a design flaw, not a machine limit**, and the machine only revealed
it. The third server failed to start with `STATUS_DLL_INIT_FAILED` and the whole
admin suite became unrunnable — including the thirty-three specs that never
touch it. The first two servers had started fine and `/login` was answering 200.

## The split

| Configuration | Specs | Servers |
|---|---|---|
| `playwright.config.ts` | 33 in 5 files | API + admin |
| `playwright.unreachable-api.config.ts` | 4 in 1 file | API + admin + unreachable-API |

33 + 4 = 37, which is what the single config selected before. Verified with
`playwright test --list` on both, which loads configs and resolves specs without
starting a single server — the one form of verification this machine could still
give.

The four specs moved into `e2e/admin-identity-unreachable.spec.ts` **verbatim**;
not one assertion changed. They needed their own file because selection is by
file, and `admin-identity.spec.ts` held both kinds: one describe that only needs
a healthy console, and one that needs all three servers.

Note that the unreachable-API run still starts all three, and correctly — those
specs sign in against the healthy server, because a session cannot be obtained
from a broken one, and then navigate to the dead one carrying the same cookies.
They use three servers, so they get three. The point was never to have fewer
servers; it was that thirty-three specs should not pay for a dependency they do
not have.

## What is shared, and why that mattered more than it looks

Two configurations mean two places for the origin, the scratch database, the
rate-limit relaxation, the build directories and the teardown to drift apart.
`playwright.shared.ts` defines all of it once and both configs spread it.

The two files differ in exactly three properties — `webServer`, and the
`testIgnore`/`testMatch` pair — and the pair is written against **one exported
constant**, so a spec cannot fall into both runs or out of both. A spec silently
in neither run is the failure this shape is most likely to produce, and it would
look exactly like a passing suite.

One TypeScript detail worth recording because the obvious version does not
compile: the three servers are annotated individually rather than as one array.
An array literal makes TypeScript unify their `env` objects, which adds every
other server's keys as `?: undefined` — and `undefined` is not assignable to the
`{ [key: string]: string }` index signature Playwright declares.

## The storefront was checked for the same shape and does not have it

Two web servers, the API and the storefront's own `next dev`, and every spec
uses both. There is no server there that only some specs need, so there is
nothing to split. Reported rather than assumed.

---

# Phase 7 Part 2 — the order queue, on the API side

`GET /admin/orders` took `status`, `page` and `limit`, so search, date filtering
and sorting were removed from the console in Phase 6 rather than left pointing
at a Supabase query. Fine at twenty orders; painful at two hundred.

## What it takes now

| Parameter | Behaviour |
|---|---|
| `q` | Order number and email match from the start; customer name matches anywhere; phone matches on digits alone |
| `placedFrom` / `placedTo` | Inclusive bounds. A DATE with no time as `placedTo` means the end of that day, in UTC |
| `sort` | `newest` (default), `oldest`, `total_high`, `total_low` |

Plus `GET /admin/orders/stats` — every status and its count, in one request.

## Search does not become a query language

The rule this repository already applies to `status` is that a client string is
narrowed to an enum before it reaches a query operator. Free text cannot be
narrowed to an enum, so it is **escaped** instead: `parseOrderSearch` turns
every character with a meaning in a regular expression into itself, and the
repository is typed to accept only the parsed form. There is no overload that
takes the raw string, which is what makes "no client string becomes part of a
query expression" a property of the types rather than a habit.

Escaping also disposes of the ReDoS question without a second mechanism.
Catastrophic backtracking needs nested quantifiers; a pattern built only from
literals has none. `(a+)+$` escaped is nine ordinary characters.

The test that matters asserts the escaping **can fail**: an unescaped `a.b`
matches `axb`, and the escaped one must not. Without that line the escaping
could be a no-op and every other search test would still pass.

A blank term is `null` rather than an empty pattern, because an empty pattern
matches everything — `?q=%20` would return the unfiltered queue while the caller
believed it was narrowed.

## Two bugs the tests found, both of which looked like working code

**The date filter validated and then vanished.** `?placedFrom=2026-02-01` was
accepted, a malformed date was still correctly rejected with a 400, and the
filter was never applied. The transform runs more than once per request: the
validation pipe converts the string to a `Date`, and a later pass hands that
`Date` back in — at which point `typeof value !== 'string'` returned `undefined`
and the parameter disappeared between validating and being read. The transform
is idempotent now. The symptom was the worst kind: every visible signal said the
parameter was wired up.

**Phone search found nothing, for anybody.** The order snapshots
`customer.phone` from the account profile, and registration never asks for one,
so it is routinely null. The number an operator is actually holding is on the
delivery note — `shippingAddress.phone`, which is required at checkout. Search
covers both now. This was only visible because the fixture created a customer
the way the API really does, rather than writing an order with a phone on it.

## The end-of-day rule, which is wrong by default

`?placedTo=2026-09-03` means "up to and including the third". Parsed as a plain
instant it is midnight at the START of the third, so every order placed that day
is silently excluded — fewer rows, no error, and it looks like it worked. A
date-only upper bound is therefore widened to the end of that day; a full
timestamp is taken literally, because widening a precise query would be the
opposite mistake. Both halves are tested.

UTC, in line with the order-number counter, which is the only other place in
this system that turns an instant into a day. No timezone is configured
anywhere, and inventing one in a DTO would put a business rule in a parser.

## Counting: one request instead of seven

The console asked for seven pages of one order each and read `meta.total` off
every response. Seven index scans to draw one row of tiles — but the real defect
was that the seven numbers were taken at seven different instants, so an order
confirmed midway through could be counted twice or not at all, and the tiles
would not add up to the total beside them. One `$group` fixes both, and the test
asserts the property that used not to hold: **the parts sum to the whole.**

Every status is present, including the ones nothing is in. `$group` cannot
produce a bucket for a value it never saw, so the service fills the gaps with
`0` — a console that renders a missing key as an em dash and a zero as "0" would
otherwise show "no cancelled orders" and "the count could not be read"
identically, and on a fulfilment screen those are very different sentences.

`@Get('stats')` is declared **before** `@Get(':id')`. Nest matches in
declaration order, so the other way round this path binds `id = 'stats'`, fails
the 24-hex check, and answers a documented endpoint with a validation error
about an order id. There is a test for that ordering.

## Indexes, and the gap that would have hidden them

Two new ones: `order_admin_total` on `{ pricing.grandTotal, _id }`, and
`order_customer_email`. Both are asserted to be in the readiness probe's
expected list, which `IndexHealthService` derives from `model.schema.indexes()`
— so declaring on the schema is what registers them, and the test says so rather
than assuming it.

Every sort ends in `_id`. Two orders can share a placement instant or a grand
total exactly, and a sort without a unique tail is unstable — which makes offset
pagination silently skip one row and repeat another. That bug looks like missing
orders and reproduces on nobody's machine. There is a test that pages a
money-ordered queue and asserts the two pages are disjoint.

**Search is honest about its cost.** Two of the four `$or` branches can use an
index; "the name contains" and "the phone contains" are unanchored patterns and
no B-tree answers those. Search is a bounded scan, narrowed by whatever status
and date range accompany it. At this console's scale that is the right trade —
the alternative is a denormalised search field maintained on the order-writing
path, which is a migration and a change to the money path. **Recorded for the
owner rather than taken here.**

### And a gap in the harness this exposed

The scratch database's baseline fingerprints the seed DATA. It says nothing
about the indexes the schemas declare, so adding one did not make a clean
database look dirty: the next run would reuse it, `autoIndex` is off, and every
test of the new index would fail for a reason unrelated to the code. Index
synchronisation now runs on the fast path too — `syncIndexes()` converges, so
running it always costs one context boot and removes the whole class.

Index names are deliberately NOT tracked in the baseline instead. That would
catch a hand-dropped index, but `index-health.spec.ts` drops `brand_visibility`
on purpose and puts it back, so a baseline that tracked indexes would report
that suite's own fixture as residue.

## The residue check earned itself again

The new suite placed three orders, which write inventory events, and deleting an
order does not delete the event that refers to it. Three orphaned ledger rows
per run, invisible, until the teardown named them.

### A self-inflicted failure, recorded so it is not read as a regression

The first full run after this work reported two failures:

```
POST /auth/reset-password › sets the new password, and the old one stops working
the rest of the API is unaffected › leaves the seeded catalogue intact
   Expected: 34   Received: 35
```

Neither was real. I had written the command as
`pnpm --filter api lint | tail -3; pnpm --filter api test > log` — with a
semicolon rather than `&&` — so when lint failed I started a second run
believing the first had not begun. **Two jest runs against the same scratch
database at the same time**, both writing to the same log.

`cart.spec.ts` counts the products that are not its own and asserts the seeded
34; it saw the other run's fixture product and reported 35. The reset-password
failure is the same collision on a shared account.

Two things worth keeping from it:

- The per-suite database confines a mistake like this to one database, but it
  does not make two runs of the SAME suite safe against each other. Nothing in
  the harness prevents that, and nothing here claims to.
- Both killed runs left 23 orphaned accounts behind. The next run's
  `ensure-clean` found the drift and rebuilt, which is the design working
  under exactly the abnormal termination it was written for — this time caused
  by me rather than by memory pressure.

## Part 2 — the console side

`components/orders/QueueFilters.tsx` is new: search, a placed-from/placed-to
range, and a sort selector. The status tiles and the table are unchanged.

**Every filter value lives in the URL and nowhere else.** No local state for
them. That is what makes a filtered queue linkable, bookmarkable, survivable
across a reload and correct under the back button — and it means the server
component reads exactly what the operator is looking at, rather than a second
copy that can disagree.

**An empty value removes its parameter rather than setting it blank.** `?q=` is
"no filter" to the API, so sending it would work; it would also leave a cleared
search box looking like an active filter in the address bar and put an
indistinguishable entry in the back-button history.

**Every filter change returns to page one**, the same rule the status tiles
already followed. Staying on page 4 of a filter that now has two pages shows an
empty table, and an empty table on a fulfilment queue reads as "no orders"
rather than "you are past the end".

The search control is a real `<form>`, so Enter submits it and it works before
the bundle has arrived. The queue is the first screen an operator opens.

The sort narrowing happens in the page, not the API client: a hand-typed
`?sort=createdAt` renders the default queue rather than a 400. The API would
correctly reject it — this is about not turning a mistyped URL into an error
page on a screen somebody is working from.

### The tiles are one request now

`orderStatusCounts()` calls `GET /admin/orders/stats` instead of fanning out
seven `limit=1` requests. The `null`-not-zero rule is unchanged and unchanged
for the same reason: zero is a claim — "no orders are awaiting confirmation" —
and a fulfilment console must not make it because a request failed.

One thing did change and is worth stating: the failure is now all-or-nothing
rather than per-status. That is a simplification in the right direction, because
a partial answer was never rendered as one anyway — the total was already `null`
unless every count arrived.

The count map is still built from **this console's** status list rather than
from the response, so a status the API stopped sending renders as an em dash
instead of the tile silently disappearing. A missing tile is an invisible change
to what the operator is looking at.

### Browser-unverified

The machine could not run a browser tonight — another project's dev server and
test suite were resident on 8 GB throughout, and the admin suite needs two
servers. Everything in this section is **built and type-checked and not seen
working**:

- the search box, including that Enter submits it
- the two date inputs
- the sort selector
- "Clear search and dates"
- the tiles reading from the single stats request

The API beneath all of it is covered by 41 jest tests that do run.

### A killed jest run leaves a 1 GB process behind, and it keeps working

Full jest runs stopped completing part-way through this part. Three of them were
killed by memory pressure, and each time the next run behaved strangely: a
polluted baseline, `CHK-TEST-*` products appearing in a batch that does not run
`checkout.spec.ts`, and once a genuine-looking failure —
`authorization › refuses a CUSTOMER on the admin queue and the admin detail read`.

The cause was one process:

```
2916   1,011 MB   apps/api/node_modules/.bin/../jest/bin/jest.js
```

**Killing the run does not kill jest.** The survivor kept executing suites
against the scratch database — writing fixtures, deleting them, and being
counted by whatever else was running. It also held a gigabyte on a machine with
1.3 GB free, which is what killed the run that replaced it.

Two consequences worth keeping:

- **Reap before re-running.** After any killed run, check for surviving
  `node` processes under this repository before starting another. A stray one
  makes the next run's evidence worthless in a way that looks like a code
  failure. The `refuses a CUSTOMER` failure was exactly that, and it would have
  been an hour of chasing an authorization bug that did not exist.
- **Run jest in batches on this machine.** Four batches of ten-ish suites each
  complete reliably where one run of forty-four does not. The residue check
  runs per batch, which is if anything stricter.

The per-suite database confines all of this to one database. It does not make
two runs of the SAME suite safe against each other, and nothing here claims it
does.

---

# CHECKPOINT — Phase 7 Parts 1 and 2

Written mid-phase, before Part 3 builds on the audit decision below. If the
owner disagrees with that decision the correction is at the call sites, not in
the mechanism.

## 1. The audit model, and a conflict that needs the owner

`AUDIT-MODEL.md` §1 opens with the decision it calls the most important one in
the document: **business history and security audit are not the same thing and
must not share a mechanism.**

| | Business history | Security audit |
|---|---|---|
| Answers | *what happened to this order* | *who did this, and were they allowed to* |
| Audience | customers and staff | staff and investigators |
| Storage | **embedded** in the entity | separate `auditLogs` collection |
| Retention | lifetime of the entity | two years, then TTL |
| Failure handling | part of the business transaction | post-commit, loudly alerted |

### The `statusHistory` decision, stated plainly

`statusHistory` on the order is **business history**. §6.1 says so explicitly,
preserves the legacy design, and lists the three fixes it required — the actor
comes from the JWT rather than the caller, status is mutable only through the
service so the history append is in the same transaction, and one status axis
replaces the three legacy columns. All three of those hold in the API today,
and Phase 6 exposed the trail through `AdminOrderDto` so a screen can read it.

**That is the business half, and only the business half.**

### The conflict

`AUDIT-MODEL.md` §3 lists **"Order interventions — admin status transition"**
under ✅ Audited. So an admin confirming, shipping or delivering an order owes
*two* records: a `statusHistory` entry (business, customer-visible) **and** an
`auditLogs` row (security, staff-only).

The `auditLogs` collection **does not exist on the API**. Phase 6 correctly
stopped writing to Supabase `admin_audit_logs` — its `admin_id` had a foreign
key to Supabase `profiles.id`, so every insert would have violated it once
identity moved — and recorded that lifecycle actions were "unaffected and
strictly better off" because the actor is on the order.

Measured against the frozen document, **that reasoning was half right and the
conclusion was wrong.** The actor on the order satisfies §6.1. It does not
satisfy §3. Since Phase 6, every admin status transition has been unaudited in
the security sense — which is precisely the legacy failure §2 was written
against, where `admin_audit_logs` held **zero rows** despite eight live status
transitions and the empty screen read as "no admin activity yet" rather than
"this subsystem is broken".

**This is reported, not decided.** The frozen document wins, so the API needs an
`auditLogs` mechanism; what needs the owner is whether the gap since Phase 6
gets backfilled from `statusHistory` (the actor, action and time are all there
for lifecycle transitions) or is simply recorded as a known blind period.

### What Part 3 will build on

Part 3's brief says every write emits an audit row, which is impossible without
the mechanism. So the first unit of Part 3 is the audit foundation itself, built
to §4 and §5:

- `auditLogs`, `strict: 'throw'` so an unknown field raises rather than being
  dropped — the exact legacy defect, where a non-existent `user_agent` column
  was silently discarded by PostgREST and the surrounding `try/catch` never
  fired.
- Written **by the system, post-commit, never by the acting principal**. There
  is no API that accepts an audit record.
- Failure logged at `error` and never swallowed.
- Append-only; no update or delete path; TTL is the only remover.

## 2. What the queue can now do

`GET /admin/orders` — `q`, `placedFrom`, `placedTo`, `sort`, alongside the
existing `status`, `page` and `limit`. `GET /admin/orders/stats` — every status
and its count in one aggregation.

Search covers the order number and the customer snapshot on the order: name,
email, and **both** phone numbers, because the one an operator is holding is on
the delivery note rather than in the account profile. The term is escaped before
it reaches the database and the repository is typed to take only the parsed
form, so there is no path by which a client string becomes part of a query
expression.

Two new indexes, both asserted to be in the readiness probe's expected list.
Every ordering ends in `_id`, so paging cannot skip or repeat a row.

The console has the controls back — search, date range, sort — with every value
in the URL and nothing in local state. **None of it has been seen in a browser**;
that list is below and in the browser-unverified section.

## 3. Part 1, for completeness

Part 1 was the admin session-renewal fix, chosen by the owner ahead of the
catalogue work because every screen Phase 7 adds would otherwise inherit it:
the console 500'd when an access token expired mid-render, and then silently
signed the operator out because the rotation it had already performed was never
persisted. Renewal now happens in a Route Handler reached by one redirect.
Verified end to end in a real browser — twelve assertions, zero failures — after
that verification found two further bugs in the redirect itself.

## 4. Needs owner

1. **The audit gap above.** Backfill from `statusHistory`, or record a known
   blind period?
2. **A denormalised search field.** Two of the four search branches cannot use
   an index — "name contains" and "phone contains" are unanchored patterns. At
   this scale a bounded scan is right; the alternative is a `searchText` field
   maintained on the order-writing path, which is a migration and a change to
   the money path. Not taken here.

---

# Phase 7 Part 3a — the security audit trail exists

Part 3's brief requires every catalogue write to emit an audit row. Nothing
could, because `auditLogs` did not exist on the API. This is that mechanism,
built to `AUDIT-MODEL.md` §4 and §5, and it closes the gap the checkpoint
reported.

## What was actually missing

Not "auditing for the new endpoints". **Every admin status transition since
Phase 6 was unaudited.** `statusHistory` records the same event as business
history — §6.1, customer-visible, answering *what happened to this order* — and
Phase 6 concluded that covered it. §3 lists admin status transitions under
audited, which asks a different question for a different audience with a
different retention. The order lifecycle now writes both, and the second is the
one that was missing.

## The four rules, and where each lives

1. **Written by the system, never by the acting principal.** No DTO, no
   endpoint and no parameter accepts an audit record; callers say what they did
   and the service decides what is written. The legacy defect was that rows were
   written with the caller's own credentials, so an audited principal could in
   principle suppress their own trail. A test asserts the surface does not exist
   — a 404, not a guarded 403.
2. **Post-commit.** `record()` runs after the transaction has committed and
   cannot throw, so an audit failure cannot roll back a delivered order.
3. **Failure is loud.** `AUDIT_WRITE_FAILED` at `error`, carrying every field an
   investigator would need to reconstruct the entry that could not be written.
   The legacy failure mode was a silent swallow producing an empty table that
   looked healthy and was read sixty-one times in that state.
4. **Immutable.** No update path, no delete path, no repository export. The TTL
   at two years is the only remover.

`strict: 'throw'` answers the legacy root cause directly: a write of a
`user_agent` column that did not exist, which PostgREST returned rather than
threw, so the surrounding `try/catch` never fired. An unknown field now raises.
`userAgent` — that exact field — is declared, captured from the transport, and
asserted by a test.

## Where this deviates from the document, stated rather than chosen quietly

§5's diagram names an `AuditInterceptor`. This is a service called from the
application layer instead, for a mechanical reason: an interceptor sees the
request and the response, while `changes.before/after` is a field-level diff
between two states of an entity that only the service performing the write ever
holds. An interceptor could record *that* something happened, never *what
changed*, and §4 requires the second.

All four rules hold either way. **The deviation is from the illustration, not
from the rules — recorded for the owner rather than decided silently.**

## The diff, and the two ways it can be wrong

`changes` holds only the fields that actually changed, as dotted paths. Whole
documents were rejected for two reasons, and the second is the one that bites:
an audit row carrying the whole entity carries every secret it holds, forever,
whether or not that secret was part of the action being recorded.

Values that must never be stored are **replaced, not omitted**. "The password
hash changed" is exactly what an investigator needs; an omitted field says
"nothing changed", which is a lie. The test asserts both halves — that the
marker is there, and that the real value is genuinely absent from the serialised
record, because a marker appended beside the real value would otherwise pass
every other assertion.

`costPrice` is deliberately NOT redacted. §4's phrase is "`costPrice` in a
customer-visible context", and `auditLogs` is not one — §8 restricts it to
`ADMIN`. Redacting it would hide the before and after of a margin change from
the only people entitled to see it, which is the opposite of what auditing a
money-affecting change is for. Stated because the phrase reads like a blanket
ban.

Redaction matches the last path segment rather than a substring: a substring
rule would swallow `tokenCount` and `resetTokenSentAt`, which are facts an
investigator wants, while protecting nothing extra.

## Indexes

Four, all declared on the schema so the readiness probe expects them: the TTL on
`createdAt`; `{entity.type, entity.id, createdAt}` for "what happened to this
thing"; `{actor.id, createdAt}` for "what has this person done" — the question
an investigation actually starts from, and the reason the actor is snapshotted
rather than joined, because that index still answers it after the account is
gone; and `{action, createdAt}` for "every role change".

## Not built here

The admin audit-log SCREEN. Reading the trail is an admin surface and belongs
with the rest of Part 3; writing it correctly had to come first, because every
administrative action taken before the mechanism exists is unrecoverable.

23 tests, all passing.

---

# Phase 7 Part 3b — slugs, and a uniqueness check that could not say "I don't know"

## The defect

`apps/admin/src/app/api/check-slug/route.ts` answered `{ exists: false }` on
**every** failure path — a database error, a missing service, any thrown
exception. `exists: false` means *the slug is free*.

The product form is built to trust that answer. So a check that could not reach
the database told the operator to carry on, and the create then failed on the
unique index — after they had filled in the name, the price, the category, the
specs and the images.

**A uniqueness check that answers "available" when it does not know is worse
than no check**, because the form treats silence and certainty identically. The
old route had four `return NextResponse.json({ exists: false })` statements and
only one of them meant "free".

## What replaces it

`GET /admin/catalog/slug-availability?type=&slug=&excludeId=` on the API, staff
only, and **nothing in the path catches anything**. A failure propagates and the
endpoint answers 5xx. The admin route forwards `available: null` with a non-200
status, and the form must render that as unknown — neither a tick nor a cross,
because both are claims the route cannot support.

Per `CATALOG-MODEL.md` §2, a taken slug comes back with the next free suffix.
Suffixes start at **2**, because the unsuffixed slug is the first one and
`esp32-devkit-1` beside `esp32-devkit` reads as though there were a zeroth.

Three details that are each a bug if got wrong:

- **`excludeId`.** Without it, opening a product and saving it unchanged reports
  its own slug as taken, and every edit to any other field becomes impossible.
- **A soft-deleted entity still holds its slug.** `CATALOG-MODEL.md` says SKUs
  and slugs must not be silently reusable, and the reason is that reusing one
  repoints every existing link — every bookmark, every search result, every
  message someone sent a customer — at a different product, silently.
- **The answer is scoped to the type.** A brand and a product may share a slug;
  they are different collections with different URL spaces. Answering across all
  three would refuse a perfectly valid brand slug because some product uses it.

The generator refuses to produce an empty slug. Arabic text reduces to nothing
under an ASCII rule and so does a name of pure punctuation — `!!!` is a
plausible typo, not an adversarial input — and an empty slug goes into a URL and
a unique index.

A malformed manual edit is a **400, not a silent rewrite**. §2 rule 6 makes the
slug admin-editable; rewriting it quietly leaves the operator looking at one
value in the form and another in the URL, and neither is wrong enough to notice.

23 tests. type-check, lint and the drift gate clean.

## NOT done, and it is part of the same section

`slugRedirects`. §2 rules 3 to 6 say that on rename the old slug is written to a
redirect collection, that product resolution reads it and answers 301, and that
chains are collapsed at write time. **None of that exists.** The collection is
not in the codebase, and a rename today changes the slug and leaves the old URL
a 404 — which is precisely legacy defect K4, where redirects were written and
nothing ever read them.

It belongs with the product UPDATE path, which is not built yet, so nothing is
half-done: there is no rename endpoint to leave broken. It is on the handoff.

## Needs owner — the `attributes` handler

`CATALOG-MODEL.md` §7 replaces the three-table EAV with an embedded `specs[]`
array plus "a separate small `specDefinitions` collection holding the canonical
`key → label/unit/filterable` dictionary used by the admin editor".

**That collection does not exist**, and what belongs in it is owner data: which
spec keys are canonical, what each is labelled, which unit it carries, and which
are filterable. I could derive a dictionary from the keys currently used by
seeded products, but that would be inventing a taxonomy and calling it frozen.

So the admin's `attributes` route is **untouched** and still reads Supabase. It
is listed under Needs owner rather than guessed at.

---

# Phase 7 Part 3c — the catalogue can be written to at last

**Session note, and it is now standing practice: strays were reaped before every
test run in this section.** Four `node.exe` processes were resident throughout —
`scripts/run-tests.mjs unit`, a `--test test\admin*.test.mjs` batch and two
helpers — and every one belongs to `D:\ahmed-adel-project`, not to this
repository. None was killed. **No orphaned jest runner of this repository's was
ever found**, checked by matching command lines against `jest` *and*
`nest-electronics` rather than by process name, because a `node.exe` at 1 GB is
indistinguishable from any other until you read its arguments.

## What was missing

`POST /admin/catalog/products` did not exist. Neither did any other catalogue
write. The admin console created products in **Supabase** while the storefront
and the Flutter client read them from **Mongo** — F-09, and the reason PLAN.md
§3 has said "DUPLICATED" against products since Phase 0. Every product an
operator entered was invisible to every customer, and the two catalogues could
not converge because there was nowhere for the console to write.

This is the write half of closing that.

## The refusals are the feature

A create endpoint that accepts what it is sent is not the hard part. Five of the
thirty-three tests assert something is stored; the rest assert something is
refused, and each refusal is a named legacy defect.

**`stock` is rejected — 400 `UNKNOWN_FIELD`.** `CATALOG-MODEL.md` §4 makes
InventoryModule the sole writer of stock *because every mutation must produce a
ledger event*. Legacy defect M7 is exactly an admin changing stock through a
generic product update with nothing written to the ledger. With
`forbidNonWhitelisted` on globally, the field's ABSENCE from the DTO is the
enforcement — and the 400 matters more than silence would: an operator who sends
`stock` and gets a 200 believes their edit landed.

New products therefore start at `onHand: 0` and receive stock through an
inventory adjustment, which ledgers it. That is Part 5.

**`effectivePrice` is rejected.** It is `salePrice ?? basePrice`, maintained
server-side (ADR-SEARCH-002). A caller able to set it independently could make
the indexed, sortable price disagree with the price charged at checkout — the
catalogue would then be ordered by a number nobody pays.

**`images` is rejected.** Attaching an asset is a reference-counted operation.
An image descriptor accepted here would point a product at an asset nothing had
retained, and `refCount: 0` is precisely the state from which `DELETE
/admin/media` destroys a picture a live page is showing. The attach endpoints
land in Part 4, with `retain()`.

**`rating` and `salesCount` are rejected** — owned by ReviewsModule and
OrdersModule respectively.

**`salePrice >= basePrice` is a 400.** Not expressible in class-validator: it is
a relation between two fields and `@Min` on each cannot see the other. The
storefront renders a struck-through "was" price beside a sale price, so a sale
at or above list shows the customer a discount that is not one.

**A malformed slug is a 400, never a silent rewrite** — §2 rule 6, and the same
rule Part 3b applied to the availability check.

## Created UNPUBLISHED, against the schema default

The schema defaults `isActive` to `true`. This endpoint defaults it to `false`,
and that disagreement is deliberate: a product created through this route has no
images and no stock, so publishing it at the instant it is named puts a bare row
in a customer's search results. Publishing is a separate action with its own
audit code (`PRODUCT_PUBLISHED`), which is also why `isActive` is absent from
the update DTO — a general edit that could flip visibility would record the
wrong thing in the trail.

## The snapshot is built from the parent, never accepted from the caller

§6 stores category and brand as reference **plus** a denormalised snapshot, so a
product grid is one collection read. That makes the snapshot derived data, and
derived data a client can write is data that can disagree with its source: a
caller able to POST `category.name` could label a product with a category name
no category has.

One detail is load-bearing and is asserted directly. The product's
`category.path` is `[...ancestors, self]`; `categories.path` is ancestors-ONLY,
because a breadcrumb wants ancestors. Without the trailing self, a subtree query
for a leaf category matches none of its own products — the legacy defect where a
parent-category page omitted every child category's products. The fixture
therefore builds a root and a child rather than one root, because a root-only
fixture cannot tell the two shapes apart.

**A soft-deleted category or brand is refused, 404.** Nothing in the schema
forbids the reference. The result would be a product filed under a category that
renders nowhere: present in the database, invisible in navigation, and
indistinguishable from a bug when somebody eventually looks for it.

## Two new error codes, and why not one

`DUPLICATE_SKU` and `DUPLICATE_SLUG`, both 409, both raised by the same write.
A single `DUPLICATE` would force the form to guess which box to mark, and an
operator would see one message against a product whose SKU and slug are both
plausible. `details[0].field` names the collided field.

The **unique index is the authority**, not a pre-flight check: two operators can
both pass a check and only one can pass the index. `GET
/admin/catalog/slug-availability` — Part 3b — is advice, and the 409 is what
happens when the advice was overtaken. A slug held by a **soft-deleted** product
also collides, asserted directly, because §9 says slugs must not be silently
reusable: reusing one repoints every bookmark, search result and message
somebody sent a customer at a different product.

## The audit row

One `PRODUCT_CREATED` per successful create, post-commit, with the actor read
from the **database profile** rather than the JWT claim — a token minted before
a demotion still carries the old role, and an audit record is the last place
that should be believed.

`changes` is `null` on a creation. §4 defines `changes` as a diff of the fields
that actually changed, "not whole documents", and a diff against nothing IS the
whole document — the thing §4 forbids storing. The reconstructable facts go in
`metadata` instead: slug, name, category, both prices, and whether it went live.

A refused create writes **no** audit row, asserted by counting before and after
a 400 and a 404. Without that assertion, an implementation that audited before
the write would be indistinguishable from a correct one.

## The admin read surface

`GET /admin/catalog/products` includes drafts and **excludes soft-deleted rows
by default**, with `?state=deleted` to find them. Both halves matter: a
recoverable deletion has to be findable, and mixing deleted rows into the
working list is how somebody edits a product no customer can reach and does not
notice for a week.

Search matches **mid-token** — an operator typing `esp32` expects
`ESP32-WROOM-32` — which is why it is an escaped `$regex` and not the text
index, whose tokenisation would not return it. `?q=.*` returning nothing is
asserted, because that is what proves the escaping.

`GET /admin/catalog/products/:id` resolves a soft-deleted product on purpose:
the restore action is reached from its own page, and a 404 there would make it
unreachable.

`ProductAdminService` is a SEPARATE class from `ProductsService`, not a flag on
it. The public one has no parameter that can turn the `{isActive, deletedAt}`
filter off; legacy defect Z6 was seven child tables leaking unreleased products
through exactly such a gap.

## Verification

33 new tests, 56 in `test/catalog` including Part 3b's, all passing. Zero
residue — the scratch database ends "exactly as this run found it".
`type-check`, `lint` clean. The OpenAPI artifact was regenerated and the drift
gate is green.

**Browser-unverified:** nothing here has a UI yet. The admin console still
writes products to Supabase; re-pointing it is a later unit in this part.

## NOT in this unit, and each is deliberate

- **Update, delete, publish/unpublish.** Next units. `slugRedirects` lands with
  the update path, in the same unit as the first rename, so there is never a
  rename endpoint without the redirect behind it.
- **`specDefinitions`.** Still absent, still owner data. `label` and `unit`
  therefore arrive from the form, which is stated in the DTO rather than
  hidden — and is why the admin's `attributes` route is still on Supabase.

---

# Phase 7 Part 3d — the rename that stops producing a 404

**Strays reaped before every run in this unit.** Checked by command line for
`jest` *and* `nest-electronics`; none found. The four resident `node.exe`
processes remain `D:\ahmed-adel-project`'s and were not touched.

## K4, and which half was actually missing

Legacy wrote a `slugRedirects` row on every product rename. **Nothing ever read
one.** So each rename produced a permanent 404 at the old URL — every bookmark,
every indexed search result, every link somebody had sent a customer — while a
database row sat there recording exactly where the page had gone. The fix was
already stored and unused.

That is why `BEHAVIOR-DECISIONS.md` K4, `BUSINESS-RULES.md` RULE-CAT-002,
`CATALOG-MODEL.md` §2 rule 4 and ADR-CATALOG-005 all say **must be read** in
bold. Writing the row is the easy half and is the half legacy had.

`GET /products/:slug` now falls through to the redirect table on a miss and
answers **301** with a `Location` header. The tests that matter in this unit are
the ones that request an old slug and expect a 301.

### Four details, each a defect if got wrong

**A live slug always wins.** The redirect is consulted only when nothing
resolves. Rename a product away, create a different product on the freed slug,
and that slug must serve the new product — not redirect to where the previous
holder went. Asserted directly, because the natural implementation (look up the
redirect first) would make the new product permanently unreachable at its own
URL.

**Chains are collapsed at write time.** Rename A→B then B→C and the stored row
for A points straight at C. §2 rule 5 asks for this, and the reason is a loop:
following chains at read time needs a cycle guard, because renaming a product
back and forth builds one — on a public endpoint. Collapsing costs one
`updateMany` on a rename, which happens rarely and is done by a person who is
waiting.

**The redirect is written after the product is renamed, never before.** A
rename refused by the unique index would otherwise leave a redirect pointing at
a slug nothing holds, and a collision is the single most likely way a rename
fails. Asserted: a 409'd rename leaves zero redirect rows and the product keeps
its own slug.

**The live slug is cleared from the redirect table.** If a product takes a slug
that used to redirect elsewhere, that row is deleted. Resolution would never
reach it, but an unreachable row contradicting reality is what somebody debugs
for an hour, and it holds the unique key against a later legitimate rename.

The 301 body carries `{ movedTo }`. Not for browsers, which follow `Location`,
but for a Dart client with `followRedirects: false` and for a server-side fetch
that wants to issue its *own* 301 to the customer rather than proxy the target.

## The update endpoint

`PATCH /admin/catalog/products/:id`. Absent key means "leave it"; explicit
`null` means "clear it" — which is how a sale ends and how a brand is removed.
A partial update that could not express "clear this" would need a second
endpoint for it.

**The `$set` is built from named fields, never from the body.** `{ $set: body }`
is shorter and is a write-anything bug: with a DTO this wide, a field added to
the class later becomes a field written to the document with nobody having
decided it should be. `forbidNonWhitelisted` is the second line of defence, not
this one.

**`sku` is not accepted** — §2 makes it immutable after creation. It is printed
on labels and quoted to suppliers; a system that lets it change is one where two
people hold different names for one part.

**`isActive` is not accepted either**, and this is the one worth stating.
Publishing has its own endpoints because AUDIT-MODEL.md §3 audits publication
state separately, with its own two action codes. A visibility flip buried in a
general edit would be recorded as `PRODUCT_UPDATED`, and *"when did this go live
and who put it there"* would stop being one indexed query on
`{action, createdAt}` and become a scan of every product update ever made,
reading diffs.

**Prices are validated against the resulting pair, not against what was sent.**
The trap: `salePrice` sits untouched at 32 000 and the request lowers
`basePrice` to 30 000. Both fields are individually valid, the request mentions
only one of them, and the product ends up "on sale" above list — which the
storefront renders as a struck-through "was" price beside a higher number. It is
a 400 naming `salePrice`.

`pricing` is written as a whole rather than field by field, so `effectivePrice`
cannot be left behind by a partial write. A derived field that some paths
recompute and others do not is worse than one that is always recomputed.

**Editing a soft-deleted product is refused**, 409 `PRODUCT_DELETED` — a new
code, distinct from `PRODUCT_UNAVAILABLE`, which answers a *customer* trying to
buy something hidden. This one answers an operator and names the remedy:
restore it first. An edit nobody can see is the same class of problem as the
deleted rows the listing keeps out of its default view.

## Publish / unpublish

Two endpoints, idempotent, and **silent when they are no-ops** — publishing an
already-published product succeeds and writes no audit row, because
`recordChange` writes nothing when the diff is empty. A row recording that
nothing changed is noise in a log kept for two years.

Publishing a soft-deleted product is refused. Restore is the operation that
means "put this back", and it is audited as one.

## One audit row per operator action

The `action` names the most consequential change; `changes` carries every
changed field regardless. A request that alters both a price and a name writes
ONE `PRODUCT_PRICE_CHANGED` row whose diff contains both — asserted, because
two rows for one action would double-count the `{action, createdAt}` index that
exists so "every price change" is a single query.

`costPrice` appears **unredacted** in the diff. §4's phrase is "`costPrice` in a
customer-visible context" and §8 restricts `auditLogs` to ADMIN; redacting it
would hide the before and after of a margin change from the only people
entitled to see it.

The diff is computed over a **projection**, not the whole document. `stock`,
`rating` and `salesCount` are written by other modules, and a concurrent sale
landing between the read and the write would otherwise appear as a change inside
a catalogue edit's audit row — an investigator would read it as the operator
having moved stock.

## Verification

30 new tests; 86 in `test/catalog`, all passing. Regression: `test/journey`,
`test/cart`, `test/checkout` — 123 passing, and `test/infrastructure` — 51
passing, which is the one that would notice the two new indexes. Zero residue in
every run. `type-check` and `lint` clean, OpenAPI regenerated, drift gate green.

**Browser-unverified:** all of it. The admin console still writes products to
Supabase. The 301 has been exercised by supertest against the real route, not by
a browser following it, so *that a browser follows this particular redirect* is
assumed rather than seen — the header and status are asserted, the following is
not.

## NOT in this unit

- **Delete and restore.** Next. `PRODUCT_DELETED` is already emitted by the two
  endpoints that refuse a deleted product, and the test fixture makes deleted
  products directly, so the refusals are proven before the endpoint that causes
  them exists.
- **Category and brand renames.** `SlugRedirectEntityType` declares all three
  and only `product` is written. The enum is whole so adding the other two
  changes no contract.
- **`forgetEntity`** is written and unused: it belongs to a HARD delete, which
  is the one operation after which the destination genuinely stops existing. A
  soft delete deliberately must not call it — the product is recoverable, its
  slug is still held, and dropping the redirects would make a restore silently
  lose every old URL that worked the day before.

---

# Phase 7 Part 3e — deletion that can be undone, and two numbers nothing was maintaining

**Strays reaped before every run in this unit**, including before each of the
four regression batches. Command lines matched against `jest` and
`nest-electronics`; none found on any check. The four `node.exe` processes
belonging to `D:\ahmed-adel-project` were left alone throughout.

## Soft delete and restore

`DELETE /admin/catalog/products/:id` sets `deletedAt` **and** `isActive: false`.
Both, because they answer different questions and a restore has to tell them
apart: after a delete, "was this published?" is unambiguously no, so bringing it
back in front of customers becomes a separate decision rather than something a
restore does silently.

`POST /admin/catalog/products/:id/restore` clears `deletedAt` and **leaves the
product a draft**. That is the design decision worth arguing with, so here is
the argument: putting a product back in front of customers is a publication
decision, and AUDIT-MODEL.md §3 audits publication separately with its own
codes. A restore that also republished would write "restored" while doing the
thing the `PRODUCT_PUBLISHED` index exists to be the record of. It also means
the operator looks at the product before customers do — which is usually why it
was deleted.

Three consequences of §9, each asserted rather than asserted-about:

- **The slug is still held.** Creating a product on a deleted one's slug is a
  409. Reusing it would repoint every existing link at a different product.
- **The `slugRedirects` rows are kept.** A restore would otherwise silently lose
  every old URL that worked the day before. The test renames, deletes, restores,
  republishes, and checks the original URL still answers 301.
- **A second delete is a 409, not a 200.** A caller that receives success twice
  cannot tell whether it deleted once or twice, and the second answer would
  carry a `deletedAt` belonging to somebody else's action. Same reasoning as a
  repeated order transition.

One new audit action, `PRODUCT_RESTORED`. Additive, and it earns its place: §3
audits destructive operations because an investigator asks who did them, and the
inverse is asked about for the same reason. Without it the trail would record a
product's removal and be silent about its return.

## The part that was a defect the earlier units introduced

`categories.productCount` and `brands.productCount` are **public**. They are on
`CategoryResponseDto` and `BrandResponseDto`, and the storefront renders them.

The only thing that had ever computed them was `seed.ts`. So every product
created, published, moved or deleted through the endpoints added in 3c and 3d
left both counts reporting the number they held at seed time — and a stale count
looks exactly like a real one, which is why this needed tests rather than a note
in the handoff.

**It recomputes; it does not adjust by ±1.** The thing being counted is not
"products" but "products that are published, not deleted, and in this subtree",
and a single write can move a product across all three axes at once: a create
can be published or a draft, an edit can move a product between subtrees of
different depths, and publish/unpublish/delete/restore each flip its
countability without touching its category. An increment scheme has to get every
combination right, and every one it gets wrong is permanent drift that nothing
detects. Recomputation cannot drift; the cost is one indexed `countDocuments`
per affected document on an action an operator performs a few times an hour,
and both counts are served by an existing index prefix.

The category count is a **subtree** count, so the whole inclusive
`category.path` is recomputed rather than just the leaf — a parent legitimately
counts its children's products, which is ADR-CATALOG-004's whole point. The test
uses a two-level fixture so that half is actually exercised.

Both directions are asserted: moving a product between categories corrects the
one it **left** as well as the one it arrived at.

## The 15-minute stale window, closed

`TtlCache.invalidate()` has carried the comment *"Called by catalogue writes
once they exist"* since it was written. They exist now.

The public category and brand lists are cached in-process for fifteen minutes
(SEARCH-MODEL.md §11) and `productCount` is on both. Without invalidation an
operator publishes a product, refreshes the storefront, sees the old count for a
quarter of an hour and reasonably concludes the save did not work. `recount` now
clears both caches.

**Named honestly:** the cache is in-process, so this clears one instance. On a
second instance the stale window returns. That is a Redis trigger
(REDIS-DECISION.md), not something to pre-build, but it is a real limit and not
a hypothetical one.

## What I got wrong, and it is worth recording

The first version of the count suite asserted `productCount` was zero for the
shared fixture category. It passed nothing — the describes above it had already
stocked that category with four published products, so the assertion was about
test ORDER, not about the count. It failed on the first run.

The fix was not to move the test. It was to give it a category of its own, so
the assertion is order-independent — the failing version would have passed until
somebody added a test earlier in the file, which is the worse outcome.

## Verification

19 new tests; 105 in `test/catalog`. Full regression in four batches, strays
reaped before each:

```
test/orders test/database test/audit test/catalog     17 suites   391 passed
test/auth test/users test/cart                        10 suites   290 passed
test/checkout test/journey test/fulfilment ...        10 suites   238 passed
test/infrastructure test/media test/import ... src    13 suites   209 passed, 15 skipped
```

**1128 passed, 15 skipped, 1143 total, 49 suites. No failing names** — compared
by name against the handoff's list, which was also empty. The previous baseline
was 1046 passed / 1061 total / 46 suites, so this session has added 82 tests and
3 suites and removed none. Zero residue in all four batches. `type-check` and
`lint` clean, OpenAPI regenerated, drift gate green.

**Browser-unverified:** everything in Part 3 so far. No admin screen calls any
of it yet.

## NOT in this unit

**Hard delete.** §9 defines it as a `SUPER_ADMIN` operation on a product never
referenced by any order, and says *"it destroys the associated Cloudinary
assets"*. Both halves are blocked on work that has not landed:

- the order-reference check needs CatalogModule to read `orders`, and
  `OrdersModule → CartModule → CatalogModule` means the naive import is a
  cycle — it needs `forwardRef` or an exported predicate, decided deliberately;
- destroying the assets needs the attach/detach path from Part 4. Shipping a
  hard delete before it would leave orphaned Cloudinary objects with no ledger
  row pointing at them, which is precisely the state `reconcile()` exists to
  report and nobody would be reporting yet.

It lands in Part 4, beside `retain()` and `release()`. Recorded here rather than
discovered as an absence later.

---

# Phase 7 Part 3f — categories and brands, and the snapshot that has to follow them

**Strays reaped before every run.** None found; the four `node.exe` processes on
this machine remain `D:\ahmed-adel-project`'s.

## The two frozen documents disagree, and here is the reading taken

`MONGODB-DESIGN.md` §5: *"Max depth 3 is enforced."* Names the field, states a
number — `depth <= 3`.

`CATALOG-MODEL.md` §6: *"Max 3 levels enforced — the live tree uses 2."* Read as
levels, three levels is `depth <= 2`, and the live tree would already be at the
ceiling.

**They reconcile, and §5 is the precise one.** §6's own table records the live
shape as "27 categories, 17 roots, **max depth 2**" — Phase 0.5 measured it — so
"the live tree uses 2" in the very next row means depth 2, and "3 levels" is
loose phrasing for the depth §5 names. `depth <= 3` is the rule both describe.
`category.schema.ts` had already written that reading into a comment; this is
the first code to enforce it.

Recorded here rather than settled quietly. If the owner meant three levels
(`depth <= 2`), it is a one-constant change and one test.

## Three things move when one category does

This is the whole reason the category service is the longest file in Part 3.

**1. The tree.** `path[]` is materialised because MongoDB has no recursive CTE
(ADR-CATALOG-004). The price of that decision is that a reparent has to rewrite
the subtree by hand — every descendant's `path` and `depth`, not just the
category that moved. The rewrite splices at the *position of the moved id* in
each descendant's path rather than assuming a direct child, which is what makes
it correct more than one level down.

**2. Every product's snapshot.** §6 names the mechanism outright —
`updateMany({'category.id': X}, …)` — and nothing else in the system ever
rewrites that field. A rename that skipped it leaves every product card showing
the old category name indefinitely, and a card showing a stale label looks
exactly like a correct one. On a reparent the products' snapshot `path` moves
too, for every moved descendant: that array is what a subtree query matches, so
missing it is a subtree query answering from the tree's *old shape* — F-MED-10,
the defect `path[]` exists to fix.

That one is asserted end to end through the public route: a product under a
child category, the child moved to a new root, and `GET /products?category=<new
root>` finds it where it found nothing a moment before.

**3. The cached list.** Fifteen minutes, in-process. The test reads the public
category endpoint *before* the rename specifically to warm the cache, so it
fails if the write does not invalidate — the state an operator would otherwise
experience as "my save did nothing".

## Cycle detection

Mandatory per §6, and not for tidiness: a cycle makes `path[]` unwritable —
there is no finite ancestor chain — so every tree read afterwards either loops
or silently drops the branch. Both shapes are refused: a category as its own
parent, and a category moved underneath one of its own descendants at any depth.

The depth limit is checked against the **deepest descendant**, not against the
category being moved. Moving a two-level subtree down one level is legal only if
the bottom of it still fits; checking the moved category alone would pass and
leave a leaf at depth 4.

## Delete: refused for categories, cascading for brands

The asymmetry is deliberate and both directions follow from one fact —
`product.category` is required and `product.brand` is nullable.

A **category** deletion is refused while products or live subcategories point at
it, and the message names both counts so the refusal is a work list rather than
a wall. A cascade would soft-delete a subtree in one click with no way to know
what went with it, and would leave products filed under a category that renders
nowhere — the state `POST /admin/catalog/products` already refuses to create.
Allowing it here would make that state reachable by another door.

A **brand** deletion clears the snapshot on every product instead. 53 of 85 live
products have no brand and every listing already renders without one, so an
un-branded product is in a state the whole system handles. Leaving the snapshot
would put a filter in the brand facet that returns products whose brand page
404s. How many products were un-branded goes in the audit metadata, because it
is the consequence the operator did not explicitly ask for.

Both renames write `slugRedirects` rows, so `SlugRedirectEntityType`'s other two
members stop being declarations and start being used.

## Three new error codes

`CATEGORY_DELETED` and `BRAND_DELETED` mirror `PRODUCT_DELETED` — three codes
rather than one shared "entity is deleted", matching the shape the catalogue
already uses for the three not-found codes, because a console showing three
different forms wants to say which of the three things is gone.

`CATEGORY_NOT_EMPTY` carries the counts in `details[0].message`.

## Verification

27 new tests; **132 in `test/catalog`**, all passing on the first run. Zero
residue. `type-check` and `lint` clean, OpenAPI regenerated, drift gate green.

**Browser-unverified:** all of it. The admin console's `category-brand.actions.ts`
still writes to Supabase; re-pointing it is not in this unit.

## Part 3 is now complete on the API side

Products, categories and brands are all creatable, editable, publishable and
deletable through the API, every write audited, every rename leaving a redirect,
every snapshot and count maintained. What Part 3 does **not** include, each
recorded rather than left to be discovered:

- **The admin console still writes to Supabase.** Every endpoint above has no
  caller. F-09 is closed on the API side and open on the console side.
- **Hard delete** — deferred to Part 4 with the media work (see 3e).
- **`specDefinitions`** — still owner data, still unbuilt, and still the reason
  the console's `attributes` route is untouched.
- **The audit-log screen.** The trail now records catalogue writes as well as
  order transitions, and nothing reads any of it.

---

# Phase 7 Part 4a — `retain()` gets its first caller, and the count starts meaning something

**Strays reaped before every run in this unit.** None found. The resident
`node.exe` processes belong to `D:\ahmed-adel-project` and were not touched.

## What the count was before this

`MediaService.retain()` and `release()` were built in Phase 4 alongside the
ledger and **nothing had ever called either of them.** Every asset in the system
carried `refCount: 0`.

That is not an unused feature. `refCount === 0` is the exact condition under
which `DELETE /admin/media` destroys the stored object, so the count was
harmless only for as long as no product had an image — and the endpoint that
gives a product an image is this one. Shipping the attach path without the
retain would have been the defect arriving fully formed.

So the assertion this unit exists for is not "an image can be attached". It is:

- **an asset a live product page is showing cannot be deleted** — `DELETE
  /admin/media` answers 409 `MEDIA_ASSET_IN_USE` and the object is still in the
  store afterwards; and
- **an asset two products share is not destroyed when one lets go** — which is
  W4 in its original form: legacy duplication copied the URL string, deleting
  from either destroyed it for both, and the surviving product rendered a broken
  image with no indication of why.

Both are asserted directly, and so is the round trip: attach → deletion refused
→ detach → deletion succeeds → the object is gone from the store.

## Three endpoints, and one of them exists to be restrictive

`POST /admin/catalog/products/:id/images` takes a `publicId` and, at most, an
`alt`. **Every other field comes from the ledger** — width, height, format,
bytes, version. MEDIA-MODEL.md §4: the browser is never the authority for media
metadata. A client that could send dimensions could make a product page reserve
the wrong space; one that could send a version could point the delivery URL at a
generation the CDN has replaced. The DTO has no such fields, so sending one is a
400, and the test asserts both halves — the rejection, and that the descriptor
which lands carries the numbers sharp measured on the server.

Attaching the same asset twice is a **409, not a no-op**. A silent second attach
would either double-count — stranding the asset undeletable forever — or skip
the retain and leave the count one short, making it deletable while a live page
shows it. Both are silent failures in opposite directions.

`DELETE /admin/catalog/products/:id/images?publicId=…` releases and removes.
**It never destroys the asset**: one that falls to zero is a candidate reported
by `GET /admin/media/reconciliation`, and §9 is explicit that reconciliation
reports rather than deletes, because an automated deleter that misreads state
destroys production assets irreversibly. Asserted: after a detach the object is
still in the store and now appears in the report's `unreferenced` list.

`publicId` is a query parameter, not a path segment, because it contains
slashes. A path segment would need double-encoding by every caller, and a caller
that forgot would silently address a different route.

`PUT /admin/catalog/products/:id/images` closes **K9 and K10 together**, because
both were the same defect — the array written in pieces. K9: reordering was an
N+1 update loop, so an interrupted reorder left an order that was neither the
old one nor the new. K10: "make this primary" was unset-then-set, so an
interruption between them left a product with images and NO primary, and every
grid rendering a placeholder for it. The whole array is written in one `$set`,
which is what §8 asks for, and every method here writes it whole — attach and
detach included. The extra cost is re-sending descriptors that did not change;
the benefit is that there is no interleaving to reason about.

Arrange **cannot add or remove an image**. That restriction is the design: it
makes the operation incapable of moving a reference count, so attach and detach
are the only two places that touch the ledger and there is one thing to be right
about rather than three. Asserted by sending one image too many and one too few
and checking that no count moved.

## `version` moved into the ledger

A small schema addition with a specific job: it is what lets attach take nothing
from the client but a `publicId`. Every other field a `ProductImage` needs was
already on the ledger row; without `version` the one remaining field would have
had to be accepted from the caller, and §4 says it must not be. It is in the
`$set` rather than the `$setOnInsert`, because a re-upload to the same id bumps
it and a ledger holding the old one would hand every page a URL for a generation
the CDN has replaced.

## Hard delete, deferred from 3e and now landed

`DELETE /admin/catalog/products/:id/permanent`. §9's sentence is *"Hard delete
exists only as a `SUPER_ADMIN` operation for a product **never referenced by any
order**, and it destroys the associated Cloudinary assets."* Every clause is a
separate guard and all three are tested:

- **SUPER_ADMIN only** — an ADMIN gets 403 here and 200 on the soft delete
  beside it, asserted in the same test so the difference is visible.
- **Never ordered** — refused with the count. Orders embed snapshots so the
  commercial record survives, but every line keeps `productId` for traceability
  and reorder, and destroying the document turns that into a dangling id.
- **Destroys the assets, except the shared ones** — each image is released and
  only those falling to zero are destroyed. The response names both lists, and
  the test proves the shared one survives on the other product's page.

Its `slugRedirects` rows are forgotten **here and only here**. A soft delete
keeps them because the product is coming back; this is the one operation after
which the destination genuinely stops existing, and a redirect to a 404 is worse
than a 404 — it costs a round trip to reach the same answer.

### The module cycle, and how it was resolved rather than worked around

The order-reference check needs to read `orders` from CatalogModule, and
importing OrdersModule closes a cycle: `OrdersModule → CartModule →
CatalogModule → OrdersModule`.

`forwardRef` was available and was not used. Instead the `Order` model is
registered on the shared connection inside CatalogModule — the precedent
InventoryModule already sets for the same kind of reason (it registers `Product`
because it writes `stock`, ADR-INVENTORY-002). Mongoose resolves both
registrations to the one compiled model, so `indexes:sync` still sees exactly
one `orders` collection. It is a **read, and the only one**: nothing in the
catalogue writes an order. That is stated in the module so the next person does
not read it as ownership.

## Three docstrings were wrong the moment this landed, and are now corrected

`MediaService`'s class comment said *"Nothing here attaches an image to a
product. Product CRUD is Phase 7"*; `retain()` said Phase 7's UI *"is the
second"* consumer; `MediaAsset`'s said the ledger *"is untriggered today —
nothing duplicates a product yet"*. All three described the world before this
commit. They now say what is true and point at the suite that proves it. A
comment that describes a plan the code has overtaken is worse than no comment,
because it is read as a statement of fact.

## Verification

27 new tests in `test/catalog/product-images.spec.ts`, all passing on the first
run. `test/catalog` + `test/media`: **233 passed, 15 skipped, 11 suites**, zero
residue. `type-check` and `lint` clean, OpenAPI regenerated, drift gate green.

Everything below the store is real in these tests — multer, the MIME allow-list,
magic-byte sniffing, sharp, the ledger, MongoDB. Only the STORE is the in-memory
adapter, and the suite asserts that rather than assuming it: if it ever resolved
to the Cloudinary adapter it would start making authenticated calls against the
owner's real account.

**Browser-unverified:** all of it. There is no upload UI yet — that is 4b.

## One residual window, stated rather than hidden

`retain` is called **after** the product document is written, which is
`MediaService.retain`'s own documented contract: if the product write fails the
count stays at zero and the asset is an ordinary unattached upload that
reconciliation can offer for cleanup, whereas incrementing first would leave a
count nothing references and nothing can ever delete.

The opposite window is real and smaller: the product write lands and the `$inc`
does not. That is one atomic statement against the same database in the same
request, so it happens only if the database goes away between two adjacent
calls — after which the count is one short and `reconcile()` reports the asset
as unreferenced while it is in use. Closing it properly means a transaction
spanning `products` and `mediaAssets`, and the ledger repository is not written
to take a session. Recorded, not fixed.

---

# Phase 7 Part 5 — stock moves, and for the first time the ledger can prove it

**Strays reaped before every run.** None found.

## A note on ordering, taken deliberately and stated rather than slipped in

The brief says Parts 3, 4, 5, 6 in order. Part 4's **API** half is done and
committed — the attach path, `retain()`'s first caller, and the proof that a
referenced asset cannot be deleted, which is the thing the brief singled out.
Part 4's **UI** half is not, and it is sitting behind this part rather than in
front of it, for a concrete reason.

The console's product screen is one form. It carries a stock field, prices in
major units, Supabase snake_case field names and UUID ids. Re-pointing its image
picker at the API while the product itself still writes to Supabase would
produce a screen whose images live in Mongo under an ObjectId the Supabase
product does not have — coherent in neither direction. And the form cannot be
re-pointed as a whole without an inventory adjustment endpoint to receive its
stock field, because `POST /admin/catalog/products` refuses `stock` by design.

So the console migration is one unit, and it needed this part first. That unit
is next. This is a reordering *within* the parts the brief named, not a
substitution, and no part has been dropped.

## What is being replaced

The console's inventory screen calls Supabase's `adjust_stock_v2`. Two things
are true of that function and both are in the frozen record:

1. **`EXECUTE` was granted to `anon`** — F-CRIT-1. Anybody who could reach the
   database could move stock.
2. **Zero `adjustment` events exist in production.** It never once completed
   successfully.

Its *semantics* are preserved here because they were well designed — a signed
delta, a required reason, a floor at zero. The execution path is new because the
old one never worked, and every route in the new controller is
`ADMIN`/`SUPER_ADMIN`.

## `delta` is a movement, not a target

`-3` removes three; it does not set the balance to three. That distinction is
the reason §5.3 says "PRESERVED from `adjust_stock_v2`, whose semantics were
correct": an absolute value silently overwrites whatever landed between the
operator reading the screen and pressing save, and a delta composes with it. The
test that proves it just posts `+5` twice and expects 10.

`delta: 0` is a 400 — legacy F-MED-9 permitted a ledger row recording nothing
happening, and the ledger's whole value is that every row is a movement.

## The floor is inside the update, which is the difference between a rule and a hope

```
{ _id, 'stock.onHand': { $gte: -delta } }
```

Read-then-compare is the legacy TOCTOU shape: two operators both pass the check
and the second takes the balance negative. The predicate lives in the same
atomic update, so the second one matches nothing and gets a 409 naming what is
actually there — both numbers, because the operator's next action is to post the
difference they actually counted.

The predicate is applied **only when `delta` is negative**. A positive
adjustment cannot underflow, and a `$gte` against a negative number would read
as though it were guarding something while guarding nothing — worse than no
filter, because a reader would believe it.

Removing exactly the whole balance is allowed, and tested. An off-by-one there
would make the last unit of every product permanently unremovable.

## Unlike a sale, an adjustment does NOT filter on `isActive`

The same reasoning `incrementForRestore` already uses, and it closed F-HIGH-2.
Goods physically exist whether or not the product is listed. Refusing to record
a count on a delisted product would make delisting a way to lose stock silently,
and an operator counting a shelf is describing reality rather than asking to
sell anything. Tested directly on a draft product.

## Three types, and three that are refused

`RESTOCK`, `ADJUSTMENT` and `DAMAGE` are accepted. "We received 100 units" and
"the count was wrong" are different business events and reporting has to tell
them apart — §5.4's reasoning, not a mechanical difference.

`SALE`, `CANCELLATION` and `RETURN` are **refused**: they are consequences of an
order, written inside the order's transaction. An operator able to hand-write a
`SALE` could move stock with no order behind it, and the ledger would stop
reconciling against `orders`.

`OPENING_BALANCE` is refused for a different reason — §9 makes initial stock a
seed, "not a migration". An opening balance an operator can post at any time is
an adjustment wearing another name, and reporting that told them apart would be
lying.

## The actor cannot be named by the caller

§5.3: "Actor — from the JWT, **never** a request parameter (fixes the legacy
`p_admin_id` forgery vector)". There is no actor field on the DTO, so sending
one is a 400 `UNKNOWN_FIELD` — asserted. The role and name come from the
database profile rather than the JWT claim, so a token minted before a demotion
cannot move stock as an admin.

Legacy left `created_by` NULL on **every** sale event (F-MED-2), so no stock
movement in production could be attributed to anybody at all. Every event this
writes carries a snapshotted actor.

## Both doors are now closed

`CATALOG-MODEL.md` §4 makes InventoryModule the sole writer of `stock` *because*
every mutation must produce a ledger event. The test asserts both refusals in
one place: `POST /admin/catalog/products` and `PATCH .../products/:id` each
answer 400 `UNKNOWN_FIELD` for `stock`. That is legacy defect M7 closed from
both sides, and it is what makes "every movement in the system is ledgered" a
statement rather than a hope.

## Reconciliation — §7's "New. Impossible in legacy."

`Σ quantityDelta` per product must equal `stock.onHand`. A difference proves an
out-of-band mutation: stock moved without an event, or an event was written
without stock moving. Nothing else detects either.

The test that matters reaches **past the application** to the collection and
`$inc`s the stock directly — because nothing in the application can produce the
condition, and a report nobody can make fire is a report nobody should trust.
The discrepancy comes back as `{ onHand: 17, ledgerSum: 10, difference: 7 }`.

**It reports; it does not correct**, and that is asserted too — the stock is
still 17 afterwards. Same rule as the media reconciliation and the same reason:
an automated corrector that misreads state writes a wrong number into the only
record anyone could have used to find the right one.

**A caveat that is not a false positive:** a product seeded with stock and no
`OPENING_BALANCE` event reports a discrepancy equal to its whole balance,
because the ledger genuinely does not account for it. That is the seed's
omission, correctly reported, and it is documented on the endpoint.

## One index added, and the comment that forbade it updated rather than ignored

`inventory-event.schema.ts` said there was "deliberately NO `{productId,
createdAt}` index" because "movement history per product is an admin screen that
does not exist". The screen exists now — `GET /admin/inventory/:productId/events`
— so the reason for the absence has ended rather than been overruled. The rule
it was applying is intact and restated: an index nothing reads is pure write
cost, the legacy defect where a GIN index recorded 0 scans against 1,282
sequential ones.

Descending on `createdAt` because that is the only order a history is read in,
with `_id` closing the key so a page boundary is stable when two events share a
timestamp — which they do, because every line of one order is written in a
single `insertMany`.

## Why a second service rather than methods on `InventoryService`

`commitSale` and `restoreStock` take a session **from their caller**, because
both are steps inside an order's transaction and must commit or abort with it.
An adjustment is its own unit of work and **owns** its transaction. Merging them
would produce methods that sometimes open a transaction and sometimes join one,
decided by whether an argument was null — which is precisely the ambiguity that
lets a ledger write end up outside the transaction that moved the stock. That
divergence is what made legacy's ledger decorative.

## Verification

33 new tests, all passing on the first run. Regression: `test/infrastructure`,
`test/orders`, `test/checkout` — 13 suites, 288 passing, which covers the
transaction path and the index-health probe that would notice the new index.
Zero residue. `type-check` and `lint` clean, OpenAPI regenerated, drift gate
green.

**Browser-unverified:** the console's inventory screen still calls Supabase.
Re-pointing it lands with the console migration unit.
