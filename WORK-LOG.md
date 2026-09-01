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
