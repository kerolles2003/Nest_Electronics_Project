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
