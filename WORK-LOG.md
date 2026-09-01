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
