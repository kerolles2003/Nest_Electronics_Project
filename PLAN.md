# Nest Electronics — Completion Plan

**Date:** 2026-09-01 · **Baseline commit:** `b344173` (`main`, dirty tree: 64 staged / 119 modified / 166 untracked)
**Revision:** updated 2026-09-01 with owner decisions D-1…D-10 (all RESOLVED — §25); **corrected 2026-09-02** (media→Phase 4, frozen `shippingRates` model, `shippingFee` semantics into Phase 2, catalogue timing). Changelogs in §26 (latest) and §27.
**Phase:** forensic audit + planning only. No product code was modified to produce or revise this document.

**Evidence tags used throughout:**

| Tag | Meaning |
|---|---|
| `[V]` | Verified during this audit — live probes, running browser, running API, database inspection, or direct source reads on the current tree |
| `[P]` | Established in a prior phase of this engagement and re-checked to still exist in the current tree (docs, staged work) |
| `[A]` | Assumption or unverified lead — must be confirmed during the phase that touches it |
| `[O]` | Owner statement of 2026-09-01 — authoritative business input, not independently verifiable from the tree |

---

## 1. Executive Verdict

The repository contains **two parallel e-commerce systems that share one visual shell**:

1. A **legacy Supabase system** — the designed, styled, navigable storefront (home, products, categories, search, auth, checkout) plus the entire admin app, all reading and writing Supabase Postgres, Supabase Auth and Supabase Storage. `[V]`
2. A **new NestJS + MongoDB system** — a frozen-architecture API (40 endpoints, 527 passing tests, transactions, idempotency, rate limits, structured errors) plus a complete but unstyled customer slice under `/shop/*` that was browser-verified end-to-end: register → verify → login → browse → cart → address → quote → order → confirmation → history, with zero console errors. `[V]`

**The customer can only reach system 1. Only system 2 is production-grade.** Nothing links to `/shop` and it is not in the sitemap `[V]`. The admin never calls the API at all — `grep` for `API_BASE_URL|/api/v1|3002` across `apps/admin/src` returns nothing `[V]`. An order placed through `/shop` is **invisible to the admin**, because the admin reads Supabase `orders` while the API writes Mongo `orders` `[V]`.

Two owner rulings reshape the road out (§25):

- **All existing data — in Supabase *and* in Mongo — is mock development data with no business value** `[O]` (D-6). There is no catalogue import from Supabase, no customer migration, no order archival, no retention window. Real data enters fresh through the new admin, plus a small temporary bulk-import tool (§7, Phase 4). This deletes an entire class of migration work and risk.
- **Email is no longer the #1 blocker.** The project is in development, and the full verification chain is proven working on the console provider `[V]`. What remains splits into a small dev-hygiene phase (test stubbing, config coherence, honest logging — Phase 1) and a **long-lead, parallel production line** (Brevo key, owner-domain sender, SPF/DKIM, EG/SA deliverability discovery — Phase E) that must start early but blocks only the production go-live (D-2).

**Therefore the completion strategy is not a rewrite.** It is:

> Keep the API and its architecture (it is the best-engineered thing in the repository). Keep the designed legacy UI. **Migrate the legacy UI's data layer onto the API, route by route**, using the `/shop` slice's integration layer (`lib/api/*`) as the foundation (D-1). Build the missing admin-facing API surface, swap the admin's data layer, **rebuild coupons/reviews/wishlist/blog on the API** (D-5), then decommission Supabase by **code deletion** — no data leaves it (D-6).

Remaining work: 12 numbered phases plus one parallel track (§22). The critical path is **baseline → crash-class fixes → storefront cutover → domain rebuilds → cleanup → production**, with admin migration and the Brevo production line running in parallel lanes.

---

## 2. Current Architecture

### 2.1 Workspace `[V]`

```
apps/
  api/          NestJS 11 · Mongoose 8 · MongoDB Atlas (replica set) · Jest (19 suites, 527 tests)
  storefront/   Next.js 16.2.4 (App Router, Turbopack) · React 19 · two data layers (see below)
  admin/        Next.js · 100% Supabase (Auth + Postgres + Storage) · never calls the API
packages/
  config/       constants (ROUTES, SITE, EGYPTIAN_GOVERNORATES), env helper, tailwind preset
  providers/    Supabase browser/server client factories
  repositories/ Supabase data access (auth, cart, order, product, search, storage)
  services/     business logic over the Supabase repositories (blog, cart, order, product, search, storage)
  types/        Supabase-generated Database types + zod schemas + domain types + DTOs
  ui/           shared React components (button, card, table, toast, product-card, …)
docs/
  architecture/ 40+ FROZEN design documents governing the API (contract, money, orders, inventory, testing…)
  db/           Supabase forensics: schema.sql, policies, triggers, functions + analyses
  storage/      Supabase Storage forensics (4 buckets: products/avatars/blog/reviews — 2 objects total)
  migration/    supabase-to-nest-mapping.md (incl. the decision “Storage → Cloudinary”)
  deployment/   DEPLOYMENT-DECISION.md (recommends Vercel + Render + Atlas, eu-central-1)
  audit/ auth/ phase-2/  phase reports and earlier audits
.github/workflows/ci.yml   lint / type-check / build / Mongo transaction-gate + api tests (staged, uncommitted)
docker-compose.dev.yml     local Mongo 8 as a single-node replica set (transactions requirement)
```

### 2.2 Storefront: two data layers in one app `[V]`

| Layer | Where | Session | Data |
|---|---|---|---|
| Legacy | all navigable routes (`/`, `/products`, `/login`, `/checkout`, `/account/*`, …) | Supabase Auth cookies, enforced by `src/proxy.ts` | `@nest/services` → `@nest/repositories` → Supabase; Zustand stores (`cart-store`, `wishlist-store`, `ui-store`, `orderTrackingStore`) persisted to localStorage |
| API slice | `/shop/*` (10 routes) | `nest_at`/`nest_rt` httpOnly cookies (`lib/api/session.ts`), SameSite=Lax, single-retry refresh with rotation | `lib/api/client.ts` → NestJS; server components + server actions only; no client-readable tokens |

The two session authorities **never overlap**: the proxy guards only `/account`, `/checkout`, `/login`, `/register`, `/forgot-password`; `/shop` guards itself per-page via `readSession()` `[V]`. Zero browser→Supabase requests were observed during the whole `/shop` journey `[V]`. But the **root layout wraps `/shop` too**, so every `/shop` page renders the legacy Navbar (server-side Supabase category query), Footer, CartDrawer, MobileBottomNav — producing two nested `<main>` landmarks per page `[V]`.

### 2.3 API (NestJS) `[V]`

Modules: `auth`, `users`, `catalog`, `cart`, `orders`, `inventory`, `fulfilment`, `notifications` + `health`, `database` (transactions, seed, index sync), `providers` (email adapters: console/resend/brevo behind `EmailSenderPort`).

Cross-cutting, all observed live: `/api/v1` URI versioning; `{data}` / `{error:{code,…}}` envelope; helmet CSP/HSTS/DENY; CORS allow-list with credentials; per-route rate limits with `X-RateLimit-*` headers; `x-request-id` correlation; unknown-field rejection (`400 UNKNOWN_FIELD`); `Idempotency-Key` on `POST /orders`; Mongo multi-document transactions with a CI "transaction gate"; Swagger at `/api/v1/docs`.

`FulfilmentService` deserves special mention after D-8: it already exists as THE shipping authority (`quote(governorate, postDiscountSubtotal)`), already implements a config-driven free-shipping threshold, and currently returns a flat configured fee with the governorate parameter accepted but unused — its own docstring records the per-governorate rates as "unsupplied business input" (`OPEN-001`) `[V]`. **D-8 supplies that input.** The service was explicitly designed so the per-governorate lookup "changes the body of one method" and no caller `[V]`.

### 2.4 Data layer

| Store | Domains | Written by | Read by | Verdict |
|---|---|---|---|---|
| **MongoDB Atlas** (replica set) | users (+embedded addresses), refresh tokens, products, categories, brands, carts, orders (+counter), idempotency keys, inventory events `[V]` (schema files) | API only | API only | **Authoritative target** for every commerce domain. Current contents are seed/dev data `[O]`; the seed remains dev/test tooling (§27 open question 1). |
| **Supabase Postgres** | 19 tables in active source: `orders, order_items, order_status_history, products, product_images, product_attribute_values, profiles, coupons, reviews, categories, brands, admin_audit_logs, blog_posts, wishlists, carts, cart_items, addresses, inventory_transactions, slug_redirects` `[V]` | legacy storefront actions + admin actions + `create_order_v2` RPC | legacy storefront + admin | **Legacy. All contents are disposable mock data** `[O]` — decommission is code deletion, not migration (§18). |
| **Supabase Auth** | users, sessions, Google OAuth | legacy storefront + admin | same | Legacy; population disposable `[O]` |
| **Supabase Storage** | buckets `products/avatars/blog/reviews` — 2 objects, ~204 KB total `[P]` docs/storage | admin product image upload | storefront image URLs | Legacy; objects disposable `[O]`; replacement is Cloudinary (D-4), pipeline only, **no migration** |
| **localStorage (Zustand persist)** | guest cart, wishlist, UI state | storefront client | storefront client | Guest-side convenience; must stop being an order-input authority (Phase 5) |

---

## 3. Current Source of Truth by Domain

Classification values: `AUTHORITATIVE` / `LEGACY` / `TEMPORARY COMPATIBILITY` / `MIGRATION TARGET` / `DUPLICATED AUTHORITY` / `UNKNOWN`.

| Domain | Today | Target | Notes |
|---|---|---|---|
| Users / identity | **DUPLICATED** — Supabase Auth (legacy + admin) vs Mongo `users` (API) `[V]` | API/Mongo | Two disjoint user populations; the legacy one is disposable dev data `[O]`. No migration. |
| Sessions | **DUPLICATED** (disjoint) — Supabase cookies vs `nest_at/nest_rt` `[V]` | API cookies | Never conflict at runtime, by route prefix. Legacy sessions simply die at T2 — no real users exist to invalidate `[O]`. |
| Roles | **DUPLICATED** — Supabase `profiles.role` (admin proxy checks `admin/super_admin` `[V]`) vs JWT `role: CUSTOMER/ADMIN/SUPER_ADMIN` + RolesGuard `[V]` | API | API `admin/orders` endpoints already enforce roles; no staff user provisioning path exists yet `[A]` (verify seed/manual path in Phase 6). |
| Products / categories / brands | **DUPLICATED** — Supabase (admin writes, legacy reads) vs Mongo seed (26 products; `/shop` + Flutter read) `[V]` | API/Mongo | Both catalogues are mock `[O]`. Real catalogue is entered fresh: temporary bulk-import tool (Phase 4) + admin CRUD (Phase 7). No Supabase import. |
| Product images | **LEGACY** — Supabase Storage via admin upload `[V]` | Cloudinary behind an API media endpoint (D-4; ADR-MEDIA-001 `[P]`) | The 2 existing objects are disposable `[O]` — pipeline work only, zero migration. |
| Inventory | **DUPLICATED** — Supabase `inventory_transactions` (admin) vs Mongo `inventoryEvents` + `stock.onHand` (API, transactional) `[V]` | API/Mongo | The API side is the engineered one (events, transactions, idempotent replay). |
| Cart | **DUPLICATED** — Zustand+Supabase (`carts`, `cart_items`, merge-on-login `syncCartToDatabase`) vs Mongo cart (auth-only, re-priced per read) `[V]` | API/Mongo (+ client-side guest cart that merges at login) | API cart is bearer-auth only `[V]`; guest checkout is FROZEN-removed (`GUEST-CHECKOUT.md` `[P]`), guest *browsing* cart remains a UX requirement. |
| Addresses | **DUPLICATED** — Supabase `addresses` vs Mongo embedded addresses with default-invariant `[V]` | API/Mongo | |
| Shipping | **LANDED (5a)** — `shippingRates` seeded with 27 rows, `quote()` reads it, a miss raises `[V]` | API/Mongo — **rate DECIDED (D-8), representation RATIFIED**: **27 rows in the frozen `shippingRates` collection, one per governorate** — Cairo and Giza 5 000 pt, the other 25 governorates 10 000 pt, each row independently admin-editable. **No default row, no fallback, no sentinel**; a lookup miss **raises** (`MONEY-MODEL.md` §6, `MONGODB-DESIGN.md` §11, both adopted unchanged) | Quote-side lookup ships with Phase 5 (closes F-13); admin editor ships with Phase 7. The no-fallback design is safe because the governorate is a closed, server-validated list on both sides `[V]`. Free-shipping threshold already implemented, config-driven `[V]` — stays off until the owner sets it. |
| Checkout | **DUPLICATED** — legacy `supabase.rpc('create_order_v2')` + `reservations` vs API quote + transactional order placement `[V]` | API | |
| Orders | **DUPLICATED — the most dangerous one.** Legacy+admin on Supabase `orders`; `/shop`+Flutter on Mongo `orders` `[V]` | API/Mongo | Admin cannot see or fulfil a Mongo order today. Legacy Supabase orders are discarded outright (D-6) — no archive, no read-only view. |
| Payments | Nowhere — no provider code in any app (`stripe/paymob/paytabs/fawry/paypal` grep: no source hits) `[V]` | **COD at launch — CONFIRMED (D-7)**, a time-driven interim choice; provider integration is a recorded future project | “Cash on delivery” is asserted in checkout UI `[V]`. |
| Coupons | **LEGACY, admin-only** — admin UI + Supabase `coupons`; zero storefront consumers `[V]`; no API model | **API/Mongo — REBUILD (D-5)**, Phase 8 | The Mongo model is already frozen-specified: `DISCOUNT-MODEL.md` §3 (code normalisation, validity window, usage limits, `couponRedemptions` with unique `{couponId, orderId}`) `[V]` — implementation, not design. |
| Reviews | **LEGACY** — admin moderation UI + Supabase `reviews`; rendered on 6 legacy storefront pages `[V]`; no API model | **API/Mongo — REBUILD (D-5)**, Phase 8 | Moderation flow required **before** public exposure (owner requirement). |
| Wishlist | **DUPLICATED (client/legacy)** — Zustand store + Supabase `wishlists` `[V]`; no API model | **API/Mongo — REBUILD (D-5)**, Phase 8 | Authenticated, server-side; replaces both duplicates. |
| Blog | **LEGACY** — `blog.service` → Supabase `blog_posts` `[V]` | **API/Mongo — REBUILD (D-5)**, Phase 8 | Content model + admin authoring + storefront rendering. |
| Notifications / email | **AUTHORITATIVE architecture, broken configuration** — `EmailSenderPort` + console/resend/brevo adapters, templates, taxonomy `[V]`; delivery dead (§6-F01/F02) | API | Two-track resolution per D-2: dev hygiene (Phase 1) + Brevo production line (Phase E). |
| Admin audit trail | **LEGACY** — Supabase `admin_audit_logs` `[V]` | API (`AUDIT-MODEL.md` `[P]`) | Old rows discarded (D-6); new trail starts in Mongo. |
| Analytics / campaigns / UTM / ads | **Nothing exists** — no admin route, no tracking code `[V]` | **DEFERRED — out of scope by decision (D-9)** | Recorded decision, not a silent gap. Do not invent. |

---

## 4. What Is Actually Working Today `[V]`

Everything below was exercised live during this audit, not inferred.

- **The complete `/shop` customer journey**, in a real instrumented browser (24 steps across 3 runs): register → “Check your email” state → unverified login refused with explanation → verification link consumed server-side → token proven single-use on replay → login → product page → add to cart → cart with server-priced totals → address create (auto-default) → checkout quote → place order (`303` + `x-action-redirect`) → “Order placed” confirmation with order number → history → detail with address snapshot → cart emptied → anonymous access redirected to login. **Zero console errors, zero page errors, zero unhandled rejections, zero ≥400 responses, zero failed requests.**
- **The API test suite:** 19 suites, 527 tests, green on a clean database (the single observed failure was audit-inflicted fixture residue; the affected spec passes 49/49 clean).
- **API hardening:** register throttle (3/h) returns `429 RATE_LIMIT_EXCEEDED`; unknown query params rejected; helmet headers; CORS allow-list; request IDs; health `/health` + readiness `/health/ready` with a real Mongo ping.
- **Email architecture** (not delivery): with `EMAIL_PROVIDER=console` a correct, fully rendered verification URL is emitted and the whole verification chain works end-to-end; failures with the broken vendor config are correctly classified `EmailConfigurationError`, never thrown into the request path, and registration still succeeds with a recoverable “resend” path. **This is why email no longer gates development (D-2).**
- **`FulfilmentService`** computes the fee as the single shipping authority, including a working free-shipping threshold — it only lacks the business rates, now supplied by D-8.
- **Legacy catalogue browsing** (`/`, `/products`, `/categories`, `/search`, product pages) renders against Supabase.
- **Admin UI** exists for products (create/edit + image upload with MIME/size/extension validation), categories, brands, coupons, customers, inventory, orders (status/payment/fulfilment transition maps), reviews, audit log, settings — against Supabase. Functional depth per capability is **not** verified (§12; Phases 6/7 audit each screen as it migrates); the pages and actions exist and are wired to real tables.

## 5. What Is Reachable by a Real Customer Today `[V]`

Only the legacy system. The navigation, sitemap, and every link path lead to Supabase-backed routes. `/shop/*` is reachable **only by typing the URL**. Consequently, today’s real visitor:

- browses the legacy catalogue (works),
- registers via Supabase — currently failing intermittently with `429 over_email_send_rate_limit` (Supabase built-in SMTP) `[V]`, and when it succeeds is dumped on `/login` with no explanation `[V]`,
- receives a Supabase verification email whose link lands on the **home page** (no `emailRedirectTo` passed) `[V]`,
- can hit the unhandled-rejection crash from the proxy redirecting Server Action POSTs (`/login` with a non-empty guest cart; `/checkout` after session lapse) `[V]`,
- checks out through `create_order_v2` into Supabase orders — data that is now formally disposable (D-6).

Operational weight of these failures changed with D-6: there are **no real customers or data behind the legacy flows** `[O]`, so the broken legacy auth is an embarrassment, not a data-loss risk. The routes still must die (Phase 5) — they remain the only thing a visitor can reach.

## 6. Critical Failures and Blockers

IDs are stable and referenced across the document. New column records the effect of the 2026-09-01 decisions.

| ID | Sev | Finding | Evidence | Status after decisions |
|---|---|---|---|---|
| F-01 | P0 | Brevo API key rejected: every send fails `401 unauthorized: Key not found`; API accounts cannot be completed | live register + API log `[V]` | OPEN — re-ranked to **production gate only** (D-2). Dev unblocked by Phase 1 (console provider). Resolved in Phase E. |
| F-02 | P0 | `EMAIL_FROM_ADDRESS=onboarding@resend.dev` (Resend sandbox) configured with `EMAIL_PROVIDER=brevo` — fails even with a valid key | `.env` keys (values not reproduced) `[V]` | OPEN — config coherence fixed in Phase 1 (dev flips to console + placeholder sender); real sender lands in Phase E. |
| F-03 | P0 | `/shop` unreachable: no inbound link, absent from sitemap | greps `[V]` | OPEN — closes at Phase 5 (T2/T3) under the approved D-1 strategy. |
| F-04 | P0 | Legacy register strands customer on `/login` (pushes to guarded route with no session) | source + proxy behaviour `[V]` | OPEN — **resolved by deletion at T2.** Interim patch dropped: D-6 means no real users are being harmed meanwhile, so patching a page scheduled for deletion buys nothing. |
| F-05 | P1 | `proxy.ts` 307-redirects Server Action POSTs → Next throws “An unexpected response was received from the server.” — unhandled at `app/login/form.tsx:51` and `CheckoutStepper` | curl + in-browser probe `[V]` | OPEN — Phase 2 (infrastructure fix; the class, not the page). |
| F-06 | P1 | Supabase verification lands on Home: `signUp()` lacks `emailRedirectTo`; `/auth/callback` orphaned and PKCE-only | source `[V]` | OPEN — **resolved by deletion at T2**; no fix planned (same D-6 reasoning as F-04). |
| F-07 | P1 | API integration tests never stub `EmailSenderPort` → **225 live Brevo calls in one jest run**; with a valid key the suite would send real mail | jest log count `[V]` | OPEN — Phase 1, first item, deliberately **before** any valid key exists. |
| F-08 | P1 | **Admin blind to API orders** (Supabase-only admin vs Mongo orders) | greps + admin actions `[V]` | OPEN — Phase 6. |
| F-09 | P1 | **Two catalogues**: admin edits Supabase products; `/shop`/Flutter read Mongo products | schema + action reads `[V]` | OPEN — reframed by D-6: both catalogues are mock. Closes via Phase 4 (reads + import tool) and Phase 7 (admin CRUD on API). No Supabase import. |
| F-10 | P2 | `EmailVerificationService.deliver()` logs “dispatched” after a failed send | API log `[V]` | OPEN — Phase 1. |
| F-11 | P2 | Expired/replayed verification link shows generic “Validation failed.”; useful detail unused in `error.details` | browser + `customerMessage()` `[V]` | OPEN — Phase 1. |
| F-12 | P2 | Two nested `<main>` landmarks on every `/shop` page; legacy chrome (incl. server-side Supabase queries) wraps the API slice | browser count + layout source `[V]` | OPEN — Phase 5 route-group split. |
| F-13 | P2 | Checkout shows “Delivery — Not yet calculated” + “Total to pay” excluding delivery | browser `[V]` | OPEN — now closes **properly** via the D-8 shipping rule in Phase 5, not via wording. Note: `shippingFee === 0` currently doubles as “unpriced” in UI and email (`shippingUnpriced` `[V]`); once real fees exist, 0 means “free”. **The representation decision moved to Phase 2 (was Phase 5)** — it must land *before* the Phase 3 contract freeze, because changing the meaning of an existing value is a silent break no drift gate can catch. Consumers updated in Phase 2; the real fees that make it matter still arrive in Phase 5. |
| F-14 | P2 | e2e suite: zero console/pageerror listeners; `/shop`-only; runs with `AUTH_REQUIRE_EMAIL_VERIFICATION=false` so the “Check your email” assertion proves nothing about email | grep + config `[V]` | OPEN — fixture built in Phase 2, adoption completed in Phase 10. |
| F-15 | P2 | CI has **no seed step**; `pnpm --filter api test` includes specs requiring seeded catalogue → the pipeline cannot pass as written | ci.yml grep `[V]` + prior root-cause `[P]` | OPEN — Phase 2. |
| F-16 | P3 | Storefront `.env.local` lacks `API_BASE_URL`; works only via the `127.0.0.1:3002` code fallback | env + client.ts `[V]` | OPEN — Phase 2. |
| F-17 | P3 | Supabase built-in SMTP rate-limited (`429 over_email_send_rate_limit`) — legacy registration currently failing | live probe `[V]` | **CLOSED BY DECISION** — D-1/D-6: legacy auth is deleted at T2 and no real users depend on it meanwhile. No work will be done. |
| F-18 | P3 | Zustand cart is a dormant duplicate authority mounted on `/shop` pages | source `[V]` | OPEN — Phase 5 guest-cart rebuild. |
| F-19 | P3 | Repo hygiene: root-level junk (`fix_hero*.js`, `rewrite*.js`, `adjust_images.js`, `seed.js`, `seed_data.json`, `cinematic`, `DESIGN copy.md`, `testsprite_tests/`, stray `.tsbuildinfo`), empty `app/orders/` dir, orphaned `/auth/callback` | listings `[V]` | OPEN — Phase 0. |
| F-20 | P3 | 349 files of completed phase work (incl. CI, email architecture, `/shop` slice, docs) sit uncommitted on a dirty tree — one bad `git` command from loss | `git status` `[V]` | OPEN — Phase 0. |
| G-01 | gap | API missing: password reset, profile update, guest order tracking (promised by frozen `GUEST-CHECKOUT.md`), **shipping-rule model + admin editor (new, D-8)**, admin catalog CRUD, media upload, admin inventory ops, admin customers, **coupons/reviews/wishlist/blog (now REQUIRED builds, D-5)**. Google OAuth removed from this list — **deferred post-launch by D-3**. | controller inventory `[V]` | OPEN — distributed across Phases 5, 7, 8. |

---

## 7. Route Migration / Cutover Plan

**Strategy — D-1 APPROVED as recommended:** keep the designed legacy UI shells, replace their data layer with `lib/api/*`, using the `/shop` implementations as reference code, then delete the `/shop` scaffold at parity. Do **not** ship the unstyled `/shop` UI as the storefront.

**Sequencing insight (unchanged):** reads can migrate incrementally; the **session-carrying cluster must flip atomically**. A state where `/login` issues Supabase cookies but `/checkout` expects `nest_rt` is incoherent.

| Tranche | Routes | Mechanics |
|---|---|---|
| T1 — catalogue reads (incremental, low risk) | `/`, `/products`, `/products/[slug]`, `/categories`, `/categories/[slug]`, `/brands/[slug]`, `/search`, Navbar category tree, sitemap | Swap `getServices()`/repository calls for `lib/api/endpoints` catalog calls. No session involved. Ship page-by-page. **T1 now depends only on Phases 0 + 2** — the former catalogue-import prerequisite is gone (D-6). The storefront serves whatever Mongo holds: seed data until the owner loads the real catalogue via the **temporary CSV/JSON import tool (Phase 4, ~1 day)** or the migrated admin (Phase 7). Interim note: from T1 onward, edits made in the old (Supabase) admin are invisible to customers and pointless — the owner should stop entering data there once T1 ships. |
| T2 — identity + money cluster (atomic flip) | `/login`, `/register`, `/forgot-password`, `/account/*`, `/checkout`, cart UI (Navbar cart button, CartDrawer), wishlist button (server-side wishlist arrives in Phase 8) | One release: auth pages call `api-auth.actions`; **Google OAuth buttons removed (D-3)**; proxy guard rewritten around `nest_rt`; cart UI reads the API cart when authenticated and a client guest cart when not, merging at login (replaces `syncCartToDatabase`); checkout uses quote + `placeOrderAction` **with the D-8 shipping fee live**; `/account/orders` reads API orders. Legacy Supabase auth/cart/checkout actions deleted in the same change. |
| T3 — collapse | `/shop/*` | Redirect `/shop/*` → canonical routes (301), delete slice + duplicate pages, remove root-layout/shop layout nesting (fixes F-12), update sitemap. |

---

## 8. Storefront Completion Plan

Beyond the cutover itself (§7), completion requires:

- **Guest cart, properly bounded** — keep a client-side cart for anonymous browsing (guest *checkout* stays removed per frozen decision `[P]`), re-implemented as a thin store holding `{productId, qty}` only, priced by the API at render, merged into the API cart at login via `POST /cart/items`. Retire the Supabase `carts/cart_items` sync and the price-carrying Zustand items (client-held prices are an integrity risk — legacy sync sends `price` from the client today `[V]`).
- **Fix F-05 at the infrastructure level** — the rewritten proxy must never answer a Server Action POST (`Next-Action` header present) with a redirect; return `NextResponse.next()` and let per-action auth produce a typed error, plus `.catch`/error-state handling at the two call sites while they still exist.
- **Shipping fee, real (D-8)** — quote and checkout render the governorate-based fee from `FulfilmentService`; “Not yet calculated” disappears; `0` is rendered as “Free” only when it genuinely is (threshold), and the email template’s `shippingUnpriced` flag is retired or re-derived (F-13 note).
- **Error/loading states** — the API slice’s `tryApi`/`customerMessage` pattern extends to every migrated route; F-11 fixed in Phase 1.
- **`API_BASE_URL` set explicitly** in every environment (F-16).
- **SEO** — migrated pages keep their URLs (no redirect debt except `/shop/*` → 301s in T3); sitemap regenerated from API catalogue. Legacy `slug_redirects` are **not** preserved (D-6 — the underlying data is mock, so old URLs carry no value).

## 9. API Completion Plan

The existing 40-endpoint surface `[V]` is sound and consumed by `/shop` (verified shape-by-shape — zero contract mismatches `[V]`). Missing surface, by consumer:

| Consumer | Needed endpoints | Notes |
|---|---|---|
| ~~Storefront T2~~ | ~~`PATCH /users/me`; `POST /auth/forgot-password`; `POST /auth/reset-password`~~ **LANDED (5a) `[V]`** — all three exist with the §2.8 discipline: hashed at rest, single-use, 1-hour TTL, neutral responses, `tokenVersion` bump and full refresh-token revocation in one transaction. | The API half of `/account/profile` and `/forgot-password` is done; the PAGES are 5b. **This row named the reset pair wrongly** — `password-reset/request` and `/confirm` — and the wrong names were built before the mistake was caught. **`AUTHORIZATION-MODEL.md` §2.8 is the authority and the paths above are its.** Corrected in the source rather than aliased: see changelog 28. |
| Storefront T2 (D-8) | Shipping-rate read inside the existing quote (no new public endpoint — `FulfilmentService` body change + the frozen Mongo **`shippingRates`** collection) | See §3 shipping row and Phase 5. **Name and field shape are taken from the frozen `MONEY-MODEL.md` §6 / `MONGODB-DESIGN.md` §11, not invented here.** |
| Storefront (frozen promise) | Guest order tracking endpoint per `GUEST-CHECKOUT.md` (“secure server-side endpoint”) `[P]` — order number + email/phone proof, heavily throttled | `/order-tracking` page exists with a client store today `[V]`. Built in Phase 8. |
| Admin | products/categories/brands CRUD (+slug rules per `CATALOG-MODEL.md`); media upload (§13, ADR-MEDIA-001); inventory adjustment/restock (§14); customers list/detail/role change; **shipping-rules CRUD (D-8)**; admin audit trail per `AUDIT-MODEL.md` | The admin/orders lifecycle surface already exists `[V]` — the admin UI just doesn’t call it. |
| Rebuild domains (D-5 — required) | coupons (per the already-frozen `DISCOUNT-MODEL.md` spec `[V]`: model, redemptions collection, validation codes, checkout apply/remove), reviews (+ moderation endpoints), wishlist, blog | Phase 8; the discount envelope already exists in pricing (`discountTotal` `[V]`). |
| Deferred | ~~Google OAuth~~ — **post-launch by D-3** | Recorded, not scheduled. |

### 9.1 Where the implemented surface disagrees with a frozen document

Audited in Phase 5a cleanup: every endpoint path named in any frozen document,
against the 49 operations the API actually serves. **These five are listed, not
fixed** — each is a deliberate earlier decision or a conflict between two frozen
documents, and changing any of them is a contract break that needs a reason
better than tidiness.

| # | Frozen document says | Implemented as | Note |
|---|---|---|---|
| 1 | `GET /users/me` — `AUTHORIZATION-MODEL.md` §12 RLS-mapping table | `GET /auth/me` | Same payload, different path. `docs/api/INTEGRATION.md` documents the deviation explicitly, so no client is misled. A second read endpoint would be a second thing to keep in step. |
| 2 | `PATCH /api/v1/orders/:id/cancel` — `ORDER-LIFECYCLE.md` §6 | `POST /orders/{id}/cancel` | Method only. A cancellation is an action, not a partial update of a field the client names. |
| 3 | `PATCH /api/v1/admin/orders/:id/status` — `ORDER-LIFECYCLE.md` §6 | seven `POST /admin/orders/{id}/<action>` endpoints (`confirm`, `ship`, `deliver`, `delivery-failed`, `retry-shipment`, `return`) | The largest of the five. One status-patch endpoint would let a client name any target status and rely on the server to refuse; separate action endpoints make the permitted edges the URL space itself. `OrdersService.transition()` is still the single enforcement point §6 requires. |
| 4 | `DELETE /admin/products/:id/images/:publicId` — `MEDIA-MODEL.md` §7 | `DELETE /admin/media?publicId=…` | The media endpoint is entity-agnostic (products, categories, brands, blog), and a `publicId` contains slashes, so it cannot be a path segment. |
| 5 | `PATCH /cart/items/:id` — `BUSINESS-RULES.md` vs `PATCH /cart/items/:product` — `CART-MODEL.md` | `PATCH /cart/items/{productId}` | **Two frozen documents disagree with each other.** The implementation follows `CART-MODEL.md`, which owns the cart. Worth reconciling in the documents rather than the code. |

Nothing else disagrees: every other doc-named path that is not served belongs to
a later phase (coupons, reviews, wishlist, blog, audit logs, admin CRUD, guest
order tracking, `POST /cart/merge`) or is deferred by decision (`/auth/google`,
D-3).

Rules for all additions: additive within `/api/v1`, same envelope, DTO validation with unknown-field rejection, OpenAPI annotations, tests at the HTTP boundary, and idempotency where a retry could duplicate money/stock effects — **coupon redemption explicitly included** (D-5 classifies it money-touching; `DISCOUNT-MODEL.md`’s unique `{couponId, orderId}` index is the structural guard `[V]`).

## 10. Authentication Completion Plan

- **Authority end-state:** API JWT (15-min access, 30-day rotating refresh, reuse-detection terminal) — verified working including silent refresh discipline `[V]`.
- **Work:** ~~password reset + profile endpoints (§9)~~ **LANDED (5a) `[V]`**; staff provisioning (a documented, seed- or CLI-based path to mint the first `SUPER_ADMIN` — none found `[A]`, Phase 6); the T2 proxy rewrite (guard `/account`+`/checkout` on `nest_rt`, never redirect action POSTs); removal of Supabase Auth usage and `@nest/providers` clients (Phase 9).
- **Google login: NOT required (D-3).** The OAuth buttons are removed during T2; an API OAuth flow is recorded as post-launch work. No `GET /auth/google` is planned in v1.
- **Session cookie hardening for production:** `secure` flips on `NODE_ENV=production` already `[V]`; the deployment topology keeps cookies first-party to the storefront `[P]` — preserve that property when deploying (§21).
- **Verification UX:** keep the API’s neutral-response / single-use semantics `[V]`; F-11 wording fix in Phase 1.

## 11. Email and Notification Completion Plan

Architecture is done and tested (73 provider/rendering/service tests `[P]`, behaviour observed live `[V]`). Per **D-2**, the remaining work splits into two tracks:

**Track 1 — now, blocking development (Phase 1):**
1. **Stub `EmailSenderPort` in the API test bootstrap** (or force `EMAIL_PROVIDER=console` in jest setup) — F-07, deliberately *before* any valid key exists (225 live calls/run today).
2. Make the dev configuration coherent (F-02): `EMAIL_PROVIDER=console` in dev, sender set to a placeholder on the owner’s future domain, the Resend-sandbox address removed so the mismatch cannot leak toward production. The env schema already forbids the console provider in production `[P]`, so production cannot ship accidentally without Track 2.
3. Outcome-based logging (F-10): `deliver()` logs what `NotificationsService` reports, not the attempt.
4. F-11 message fix (prefer `error.details[0].message` for validation kinds).

**Track 2 — Brevo production line (Phase E — long lead, parallel, blocks only go-live):**
1. Valid **Brevo** key (owner decision D-2).
2. Sender address on an **owner-controlled domain verified with Brevo**; SPF/DKIM published. A domain verified with one vendor is not verified with another `[P]`.
3. **Deliverability discovery** — a test matrix to real Egyptian and Saudi inboxes (Gmail, Outlook, local ISPs). This is a *discovery* item, not an execution task: the outcome is unknown and may force sender/domain/warm-up changes. Start early precisely because it cannot be scheduled precisely.
4. Prove end-to-end on staging: real registration → real inbox → link → verified; real order → confirmation email matching the persisted order snapshot.

Keep: console provider for dev, env-schema production guards `[P]`, at-most-once post-commit dispatch, four-category error taxonomy.

## 12. Admin Completion Plan

Current state `[V]`: 14 dashboard pages + `attributes`/`check-slug` route handlers; Supabase Auth login; proxy role-gate via service-role `profiles.role` lookup; six server-action files (product, category-brand, coupon, inventory, order, review) all on Supabase; upload validation lib → Supabase Storage; audit writes to `admin_audit_logs`.

Capability classification (pages exist and are wired; production-grade depth unverified `[A]` per capability until Phase 6/7 touches it):

| Capability | Today | Target |
|---|---|---|
| Orders view/filter/detail/transitions | Supabase-backed legacy (transition maps in `order.actions.ts` `[V]`) | **MIGRATE first** — API `admin/orders` endpoints already exist and are tested `[V]`; swap the data layer, drive UI state from the API’s allowed transitions. No legacy-orders view of any kind — Supabase orders are discarded (D-6). |
| Admin auth + roles | Supabase | **MIGRATE with orders** — JWT login + `ADMIN/SUPER_ADMIN` guard; needs staff provisioning (§10) |
| Products / categories / brands CRUD | Supabase | **MIGRATE** after API CRUD exists (§9), Phase 7 |
| Images | Supabase Storage | **REPLACE** with the Cloudinary pipeline (§13) — no object migration (D-4). **Split `[O]`: the upload API lands in Phase 4 (empty, test-exercised only); this admin upload UI stays in Phase 7.** |
| Inventory | Supabase `inventory_transactions` | **MIGRATE** onto API inventory ops (§14) |
| Customers | Supabase profiles | **MIGRATE** onto API customers endpoints |
| Shipping rates | *(does not exist)* | **BUILD** — editor over the frozen `shippingRates` collection (one row per governorate, `fee` in minor units), Phase 7 |
| Coupons / reviews | Supabase | **REBUILD on the API models** (D-5) — management screens re-pointed in Phase 8 |
| Blog authoring | *(storefront-only legacy render; no admin screen found `[A]` — confirm in Phase 8)* | **BUILD** with the blog model (D-5), Phase 8 |
| Audit log | Supabase `admin_audit_logs` | **MIGRATE** to API audit trail (`AUDIT-MODEL.md`); old rows discarded (D-6) |
| Settings / dashboard widgets | Supabase | audit content in Phase 7; keep/trim per widget |

The admin app itself (Next.js shell, components, validation UX): **KEEP**. Only its data layer and auth move.

## 13. Product and Image Management Plan

- **Decision — D-4 CONFIRMED and CLOSED (5a) `[V]`:** the credentials arrived and the pipeline is proven end to end against the real account, including the response mapping that was the one unproven item at the end of Phase 4. **The account is SHARED with an unrelated application** (108 assets under `partners/` and `users/avatars/`), so `MEDIA_FOLDER_ROOT` is configurable and every listing, upload and orphan report is prefix-scoped — a bulk delete without a prefix would destroy somebody else's content. Cloudinary, via the already-frozen **ADR-MEDIA-001**: `Client → NestJS → Cloudinary`, not signed direct upload — the server sees every byte, validates, sniffs magic bytes, strips EXIF, captures dimensions `[V]` (MEDIA-MODEL.md).
- **No migration (D-4/D-6):** the 2 existing Supabase Storage objects are disposable dev data. The work is the pipeline only — and, per the owner’s Phase-4 decision `[O]`, **the pipeline is built before there is any content for it to carry.** That is deliberate: the endpoint is unblocked engineering, the catalogue is owner content work (§25 risk 1).
- **Work — SPLIT ACROSS TWO PHASES `[O]`.** The owner moved the *upload API* earlier; the *admin UI* stays put.
  - **Phase 4 — the API endpoint only, and it ships EMPTY.** API media endpoint per ADR-MEDIA-001 (`Client → NestJS → Cloudinary`); server-side validation rules adopted from the admin’s existing client-side validation (5 MB, jpeg/png/webp `[V]`); **magic-byte sniffing** (never trust the declared MIME); **EXIF strip** + real-dimension capture via sharp; ordering + primary-image invariant; delete/replace with orphan cleanup; **store provider-relative identifiers, not absolute URLs** — MEDIA-MODEL.md records the legacy baked-URL defect explicitly `[V]`.
    **No products and no images are loaded `[O]`: the real catalogue does not exist yet.** The endpoint ships with an empty `mediaAssets` collection and is **exercised only by tests** (fixture bytes, not business content). Building it early buys the capability without pretending there is anything to put in it.
  - **Phase 7 — the admin upload UI**, which is the half that needs an operator and a catalogue to attach images to.
- **Slug management:** admin `check-slug` behaviour re-implemented against Mongo. Legacy `slug_redirects` are **dropped** (D-6) — mock catalogue URLs have no SEO equity to preserve.

## 14. Inventory Management Plan

The API side is authoritative and already handles: transactional decrement on order placement, `inventoryEvents` trail, idempotent replay protection — all exercised by tests and by the audit’s own cleanup accounting `[V]`.

Missing for operations `[V]`: admin-facing endpoints — manual adjustment (restock, correction, damage) writing typed `inventoryEvents`; low-stock listing (a `LOW_STOCK_THRESHOLD` constant exists `[V]`); negative-stock prevention on adjustments; concurrency via the same transaction service. `INVENTORY-MODEL.md` governs `[P]`. The admin inventory UI then swaps its actions from `inventory_transactions` to these endpoints (Phase 7).

## 15. Orders and Operations Plan

- Customer side: complete and verified `[V]` (placement, idempotent replay, history, detail; the self-cancel endpoint exists `[V]` but is **not surfaced in `/shop` UI** `[A]` — add it in T2 account pages).
- Operations side: the eight `admin/orders` endpoints (confirm/ship/deliver/delivery-failed/retry-shipment/return) exist with tests `[V]`; Phase 6 wires the admin UI to them.
- Refunds: no payment provider ⇒ refund = COD return flow, already modelled by `return` `[V]`; no money movement to build.
- Historical Supabase orders: **discarded entirely (D-6).** No archive, no import, no read-only view. All order-lifecycle logic operates only on Mongo orders from Phase 6 onward.

## 16. Campaigns / Marketing / Promotions Plan

Verified reality: no campaign system exists anywhere — no admin route, no tracking pixels, no ads integration, no UTM handling `[V]`.

**Coupons — BUILD (D-5), Phase 8.** Not an open question any more, and not a green-field design: `DISCOUNT-MODEL.md` already freezes the model `[V]` — coupon collection (uppercase-normalised code, percentage/fixed value, validity window, usage limits), a separate `couponRedemptions` collection whose unique `{couponId, orderId}` index makes double-redemption structurally impossible, a specified validation table (`COUPON_NOT_FOUND`, `COUPON_INACTIVE`, …), composition with sale prices, and `RULE-COUPON-010` (discount never applies to shipping). Work: implement the frozen model + checkout entry field + admin management on the API. Treated as **money-touching**: same idempotency and validation discipline as order placement, and the coupon interacts with the D-8 fee through the frozen formula (`shippingFee = quote(governorate, itemsSubtotal − discountTotal)` `[V]` — already how `FulfilmentService` is called).

**Banner campaigns, product campaigns, analytics attribution, UTM, Google/Meta Ads — DEFERRED (D-9).** Explicitly out of scope by decision, recorded here; no requirements exist and none are invented.

## 17. Google Authentication and External Providers

| Provider | Today | Plan |
|---|---|---|
| Google OAuth | Legacy Supabase `signInWithOAuth` on `/login`+`/register` only `[V]`; nothing in the API | **DEFERRED post-launch (D-3).** Buttons removed at T2. No v1 API work. |
| Email | §11 | **Brevo (D-2)** — dev on console now; Brevo production line runs as parallel Phase E |
| Storage/CDN | Supabase Storage (legacy) | **Cloudinary (D-4 CONFIRMED)** — pipeline only, no migration |
| MongoDB | Atlas replica set; transactions gated in CI; index sync script exists (`sync-indexes.ts` `[V]`) | KEEP; production checklist in §21 |
| Supabase (Auth/Postgres/Storage/SMTP) | Load-bearing for legacy + admin | TEMPORARY COMPATIBILITY until Phase 9, then **decommission by code deletion**; project paused, then deleted at the owner’s convenience — nothing in it has value (D-6) |
| Payments | None `[V]` | **COD-only launch CONFIRMED (D-7)** — a time-driven interim choice; provider integration recorded as a separate future project |

## 18. Database and Source-of-Truth Migration Plan

**There is no data migration. (D-6: every byte in Supabase — and every business record currently in Mongo — is disposable development data.)** This section reduces to two things:

**Fresh data entry paths** — real business data enters the authoritative store through:
1. the **temporary CSV/JSON catalogue import tool** (Phase 4, ~1 day) — spreadsheet → Mongo products/categories/brands, upsert-by-SKU, schema-validated, count-reported; independent of phase ordering and still useful for bulk additions after launch;
2. the migrated **admin** (Phase 7 onward) for everything else.

**Supabase decommission — a code-deletion sequence (Phase 9):**
1. Verify nothing in `apps/storefront` reads Supabase (post-Phase 5/8) and nothing in `apps/admin` does (post-Phase 7/8).
2. Delete `@nest/providers`, the Supabase parts of `@nest/repositories` and `@nest/services`, the Supabase-generated types in `@nest/types`, Supabase env keys from every app, and the admin’s service-role usage.
3. Pause the Supabase project; delete it when convenient. No retention window, no export, no restore drill — there is nothing to retain (D-6).

Each step is a reviewable diff; the only irreversible act is the final project deletion, which carries no data value by owner ruling.

## 19. Flutter / Mobile API Readiness Plan

- **Safe to integrate now** `[V]`: catalogue, login/refresh/logout/me, cart, addresses, checkout quote, orders + idempotent placement, error envelope (`code`-switching), rate-limit + request-id headers.
  - **⚠ One carve-out, closed in Phase 2:** `pricing.shippingFee` was **not** safe to integrate against as shipped, because `0` currently means **“not priced”** and would have come to mean **“free”** after Phase 5 `[V]`. A client that coded `0 → "not calculated"` at Phase 3 would misreport every free-shipping order, and **no drift gate can catch it — the field, its type and its name never change.** Phase 2 therefore lands the explicit representation (`shippingPriced`) *before* this contract freezes, so “safe to integrate now” is true of the money block as well. Contract conventions are documented in Swagger (`/api/v1/docs`, OpenAPI JSON at `/docs-json`) `[V]`.
- **Register / verify / resend**: shapes stable; in development the documented recipe is `EMAIL_PROVIDER=console` (+ optional verification toggle) — the audit proved the console-emitted link completes the chain `[V]`. Real delivery arrives with Phase E and is a **production** concern, not an integration blocker.
- **Must not integrate**: anything Supabase; the legacy web flows.
- **Coming additions** (password reset, real shipping-fee *values* in quotes — the *representation* is already final as of Phase 2 — coupons/reviews/wishlist/blog) are additive within v1 and enter the same doc + drift gate as they land.
- **Work (Phase 3):** export a **frozen OpenAPI v1 artifact** into `docs/api/openapi.v1.json`; declare the additive-only policy as the compatibility contract; CI drift gate (generated vs frozen; breaking = fail); sandbox recipe doc; a short safe/unstable/forbidden integration page.

## 20. Testing and CI Plan

What exists `[V]`: 19 jest suites (527 tests) mixing unit and real-Mongo integration; one Playwright journey (`/shop` only) + verify-email error-path test; global teardown with stock-reversal; CI with lint/type-check/build + Mongo-replica transaction gate.

Gaps → work items:

1. **Provider isolation (F-07)** — Phase 1, before a valid key exists. Acceptance: a full jest run makes zero vendor calls (asserting fake or blackholed network).
2. **CI seed step (F-15)** — run `pnpm --filter api seed` (script exists `[V]`) against the CI Mongo before `pnpm --filter api test`. Acceptance: green CI from a fresh clone with no local state. **Measured correction:** seeding alone is *not* sufficient — a fresh database also needs `pnpm --filter api indexes:sync`, without which 19 tests fail (index-usage, idempotency, transaction-atomicity and concurrency suites) because `autoIndex` is off. The CI step is therefore **seed + indexes:sync**.
2b. **Shipping-fee representation (from open question 2)** — an explicit `shippingPriced` boolean, shipped in **Phase 2** before the Phase 3 freeze, with both consumers (checkout UI, order email) updated. Acceptance: a priced `0` renders as free, an unpriced fee renders as not-calculated, and the two are distinguishable without inspecting the amount.
3. **Browser-health assertions (F-14)** — shared Playwright fixture failing any test on `pageerror`, `console.error`, unhandled rejection, or unexpected ≥500; adopted by the existing journey and every new spec. This fixture would have caught the reported production bug class.
4. **Real-verification e2e** — one spec that runs with `AUTH_REQUIRE_EMAIL_VERIFICATION=true` + console provider, harvests the emitted link (the audit proved this technique), and completes verify→login.
5. **Cutover regression specs** — as each T1/T2 route migrates, a journey spec on the *canonical* URL joins the suite; the audit’s browser matrix (auth, store, failure paths incl. 401/404/409/429) is the checklist.
6. **New-domain specs (D-5/D-8)** — shipping-fee table tests over the frozen `shippingRates` collection (Cairo/Giza 5 000 pt, every other governorate 10 000 pt, an unlisted-governorate miss, threshold interplay, coupon-then-fee ordering per the frozen formula) **plus explicit `shippingPriced` tests — a priced-zero fee must render as free, never as “not calculated”**; coupon validation table from `DISCOUNT-MODEL.md` incl. double-redemption; review moderation gating (unmoderated content never publicly readable); wishlist auth boundaries; blog rendering; import-tool report tests.
7. **Test isolation debt** `[A→low]`: suites share one database; parallel runs collide (observed when audit runs raced). Either enforce `--runInBand` in CI (current reality) or per-run database names.
8. Full pipeline target (CI’s shape + seed): `fresh clone → pnpm install --frozen-lockfile → env per .env.example → seed → type-check → lint → build → test → e2e`.

## 21. Production Readiness Plan

**Provisioning decisions are OPEN (D-10 — deferred until the build is complete).** `DEPLOYMENT-DECISION.md` (Vercel + Render + Atlas, eu-central-1) remains the standing recommendation `[P]` but is **not approved**; nothing in Phases 0–10 depends on the choice. The one long-lead exception: **the Brevo sender domain + SPF/DKIM + deliverability discovery (Phase E) must not wait for provisioning** — DNS and inbox reputation move on calendar time, not engineering time.

Checklist derived from verified state (targets to be bound once D-10 is taken):

- **Environments:** dev/staging/prod separation with per-env values from the classified `.env.example`s `[P]`; `API_BASE_URL` server-side (runtime-injected — the code deliberately avoids `NEXT_PUBLIC_` inlining `[V]`); `SITE_URL` per env (email links depend on it `[V]`); `CORS_ORIGINS` allow-list per env; secrets only in platform secret stores.
- **Security:** helmet suite verified `[V]`; cookies `secure` in prod `[V]`; admin role guard on the API (Phase 6); media upload validated server-side (Phase 7); the env schema already refuses foot-guns (console mail in prod, vendor without key, localhost SITE_URL in prod) `[P]`.
- **Reliability:** liveness + readiness split exists `[V]`; provider timeouts bounded (8 s adapter / 10 s service `[P]`); email failure non-fatal by design `[V]`; order idempotency verified `[V]`; Atlas backup policy + `indexes:sync` as a release step `[A]` (confirm index parity in staging).
- **Observability:** structured logs with request IDs exist `[V]`; add platform log retention + alerts on `email NOT sent` and readiness failures; no heavy observability vendor per prior decision `[P]`.
- **Runbooks:** deploy/rollback per app; email-vendor swap (adapter switch + DNS caveat `[P]`); Supabase decommission (§18).
- **Staging gate:** the full e2e matrix runs against staging on real subdomains before go-live — the cookie topology must be re-validated off localhost `[P]`.

---

## 22. Ordered Execution Phases

Priorities follow the mandated rule: reachability → checkout/account blockers → duplicate authority → money/inventory correctness → frontend dev → Flutter dev → production → enhancements. **Phase E is a parallel long-lead track, not a step on the numbered path.**

---

### Phase 0 — Land the baseline

**Goal** — the 349 uncommitted files (staged phase work + `/shop` slice + docs + CI) become durable commits; junk leaves the tree.
**Why this phase exists** — F-20: months of verified work is one `git checkout .` from gone; every later phase diffs against this baseline.
**Current state** — dirty tree at `b344173`: 64 staged / 119 modified / 166 untracked `[V]` (+ this `PLAN.md`).
**Files/systems involved** — whole tree; `.gitignore`s; root junk list (F-19).
**Work required** — review-and-commit the staged/modified/untracked work in coherent commits (api baseline, email architecture, `/shop` slice, docs, CI, admin/ui edits, PLAN.md); delete or relocate root junk (F-19) in its own commit; tag the result.
**Dependencies** — owner authorisation to commit (this plan commits nothing).
**Risks** — accidentally committing secrets → pre-commit scan for key patterns (`.env` files verified ignored today `[V]`).
**Acceptance criteria** — clean `git status`; `pnpm install --frozen-lockfile && pnpm type-check && pnpm lint && pnpm build` green from a fresh clone.
**Automated verification** — the root pipeline above.
**Manual/browser verification** — none.
**Definition of done** — tagged baseline commit(s) pushed to `origin/main` (push itself needs explicit approval).

---

### Phase 1 — Email correctness in development

**Goal** — the email subsystem is honest and safe in development: no live vendor calls from tests, coherent dev config, truthful logs, useful failure messages.
**Why** — F-07 is a live-fire hazard the moment a valid key exists; F-02/F-10/F-11 are small and in the same area. Per D-2 this is deliberately **decoupled from vendor delivery** — dev runs on the proven console provider `[V]`.
**Current state** — tests made 225 live Brevo calls in one run `[V]`; `.env` pairs `EMAIL_PROVIDER=brevo` with a Resend-sandbox sender `[V]`; “dispatched” logged after failed sends `[V]`; bad tokens read “Validation failed.” `[V]`.
**Files/systems involved** — `apps/api/test` bootstrap; `apps/api/.env` (values only, never committed); `email-verification.service.ts`; `notifications.service.ts`; `apps/storefront/src/lib/api/errors.ts` (`customerMessage`).
**Work required** — (1) stub `EmailSenderPort` in the jest bootstrap; (2) dev env flips to `EMAIL_PROVIDER=console` with a placeholder sender on the owner’s future domain, Resend-sandbox address removed; (3) outcome-based logging; (4) validation-detail message fix.
**Dependencies** — Phase 0.
**Risks** — minimal; the env-schema production guards `[P]` prevent the console provider leaking to production.
**Acceptance criteria** — full jest run with zero vendor calls (asserted); register on `/shop` in dev prints a working console link `[V]`-style; a failed send logs `NOT sent`, never “dispatched”; a replayed token shows the token-specific message.
**Automated verification** — jest (≥527 green) + a bootstrap test asserting the fake sender.
**Manual/browser verification** — dev register → console link → verify → login.
**Definition of done** — F-07, F-02 (dev half), F-10, F-11 closed.

---

### Phase E (parallel, long-lead — start alongside Phase 1) — Brevo production line

**Goal** — production email delivery is real, from an owner-controlled domain, with known deliverability to the target markets.
**Why** — D-2: Brevo confirmed; DNS verification and inbox reputation are calendar-bound and must not sit behind the build. Blocks **only** Phase 11.
**Current state** — Brevo key rejected (`401 Key not found` `[V]`); no owner sender domain chosen `[A]`; deliverability to EG/SA inboxes unknown — a **discovery risk**, not an execution task.
**Files/systems involved** — Brevo account + DNS (outside the repo); staging `.env` when it exists; no code changes expected (adapter verified `[V]`).
**Work required** — valid Brevo key; sender on an owner-controlled domain **verified with Brevo**; SPF/DKIM published; deliverability matrix to real Egyptian and Saudi inboxes (Gmail / Outlook / local ISPs) with findings recorded; staging end-to-end proof (register → real inbox → verify; order → confirmation matching the persisted snapshot).
**Dependencies** — owner supplies the account and DNS control. Phase 1 first (so no test can ever fire the live key).
**Risks** — deliverability failure discovered late → that is *why* this track starts now; possible outcomes include domain warm-up, sender changes, or vendor reassessment.
**Acceptance criteria** — the staging proof above, plus documented deliverability results per target inbox provider.
**Automated verification** — none beyond existing adapter tests (network-isolated).
**Manual verification** — the real-inbox matrix.
**Definition of done** — F-01 and F-02 (production half) closed; Phase 11’s email prerequisite met.

---

### Phase 2 — Kill the crash class + CI truthfulness

**Goal** — no route can produce “An unexpected response was received from the server”; CI can actually pass; **and the checkout money block says what it means before anyone freezes a contract against it.**
**Why** — F-05 is the reported production bug class; F-15 makes CI a false signal; and the `shippingFee === 0` ambiguity (open question 2) must be resolved **here**, because Phase 3 freezes the contract and a change of meaning in an existing value is invisible to a drift gate.
**Current state** — proxy 307s action POSTs (proven `[V]`); two live triggers; CI lacks seed `[V]`.
**Files/systems involved** — `apps/storefront/src/proxy.ts`, `app/login/form.tsx`, `components/CheckoutStepper.tsx`, `.github/workflows/ci.yml`, dev env files; **for the fee representation:** `fulfilment.service.ts` / checkout pricing DTOs, `components/shop/CheckoutForm.tsx` (`:88` `[V]`), `notifications.service.ts` (`:299` `shippingUnpriced` `[V]`) and the `price-summary` email partial.
**Work required** — proxy passes requests bearing `Next-Action` through untouched (per-page/per-action auth answers instead); defensive `.catch` + error state at both trigger sites (they live until T2); CI seed step (F-15); explicit `API_BASE_URL` in dev env files (F-16); build the shared **browser-health Playwright fixture** (used from here on, completed in Phase 10); **and implement the open-question-2 decision — an explicit `shippingPriced` representation — updating both consumers (checkout UI and the order-email `shippingUnpriced` flag).** *The former “optional F-04 interim patch” is dropped — D-6 removed its value; F-04 dies with the page at T2.*

**On the fee representation (why it is in this phase and not Phase 5):** adding a field is additive and a drift gate reports it. **Redefining `0` from “not priced” to “free” changes no field, no name and no type — the gate sees nothing, and every client that already shipped `0 → "not calculated"` silently misreports free-shipping orders.** The bug is also *already reachable*: `FulfilmentService.quote` returns `0` on a met free-shipping threshold today `[V]`. Phase 5 supplies the fee *values*; this phase fixes the *meaning*, and it must precede the Phase 3 freeze.
**Dependencies** — Phase 0.
**Risks** — proxy change affects every route → e2e + manual matrix on guarded routes.
**Acceptance criteria** — the curl probe (`POST /checkout` with `Next-Action`, no session) no longer yields a 307; login-with-full-guest-cart shows no console error; CI green from scratch; **a priced fee of `0` displays as free (never “Not yet calculated”) in both the checkout UI and the order email, and an unpriced fee remains distinguishable from it without reading the amount.**
**Automated verification** — new Playwright spec: guest cart → login → zero page/console errors (health fixture); CI run.
**Manual/browser verification** — the audit failure matrix on `/login`, `/checkout`.
**Definition of done** — F-05, F-15, F-16 closed; health fixture merged; **open question 2 answered in code, so Phase 3 can freeze a money block whose values mean one thing only.**

---

### Phase 3 — Flutter contract freeze

**Goal** — the mobile developer integrates today against a stable, documented v1.
**Why** — unblocks a parallel workstream immediately; the API is already safe, and the dev email recipe (console provider) is proven `[V]` — delivery is a production concern (Phase E), not an integration blocker.
**Current state (2026-09-02)** — **DONE.** Swagger live with conventions text `[V]`; frozen artifact at `docs/api/openapi.v1.json` (37 paths, 43 operations, 84 schemas) `[V]`; CI `contract-gate` job runs the drift check `[V]`; `docs/api/SANDBOX.md` and `docs/api/INTEGRATION.md` written `[V]`. The `DocumentBuilder` chain was extracted from `main.ts` into `src/openapi/openapi.document.ts` so the served document and the frozen artifact cannot diverge.
**Files/systems involved** — `apps/api` Swagger config, `docs/api/` (new artifact), CI.
**Work required** — export OpenAPI JSON to `docs/api/openapi.v1.json`; CI job diffing generated vs frozen (breaking = fail, additive = update artifact in the same PR); sandbox recipe doc (compose + seed + console mail + verification toggle); a short safe/unstable/forbidden integration page (§19).
**Dependencies** — Phase 1 (test/provider hygiene; honest recipe) **and Phase 2's `shippingPriced` decision** — freezing the money block while `shippingFee === 0` is still ambiguous would export the ambiguity to every mobile client.
**Risks** — freezing mistakes → additive-only, not immutable. **Note the limit of that policy: additive-only protects *shape*, not *meaning*. A value whose semantics change later passes the drift gate untouched — which is exactly why open question 2 is settled in Phase 2 rather than here.**
**Acceptance criteria** — the Flutter dev completes the 18-step contract journey `[P]` from the docs alone, on a fresh machine.
**Automated verification** — the drift gate.
**Manual verification** — a walkthrough with the mobile developer.
**Definition of done** — signed-off contract doc; drift gate green.

---

### Phase 4 — Storefront catalogue reads cutover (T1) + catalogue entry tooling + media upload API

**Goal** — the designed storefront pages render the API catalogue; the owner has a working path to load the real catalogue, independent of admin readiness; **and the Cloudinary upload API exists, empty, so nothing later waits on it.**
**Why** — F-09 and F-03 both shrink; reads are the low-risk half. **This phase shrank substantially under D-6**: the Supabase→Mongo import is gone; T1 depends only on Phases 0 + 2.
**Current state (2026-09-02)** — **DONE.**
- **Media upload API merged, empty** `[V]` — `POST/DELETE /admin/media` + reconciliation report, `mediaAssets` ledger, `MEDIA_PROVIDER` switch through `ProvidersModule`. **The Cloudinary account (D-4) was NOT supplied** — no `CLOUDINARY_*` value exists anywhere in the repo — so the adapter is written and unit-tested against the SDK contract but **integration-unproven**, and every environment runs the in-memory adapter. Recorded, not worked around.
- **Catalogue import tool merged** `[V]` — `pnpm --filter api catalogue:import`, declarative mapping profiles, two shipped profiles proving a new supplier costs only a profile, `--dry-run`, per-run created/updated/**unchanged**/skipped/errored report. Idempotency proven at the CLI, not only in tests. Documented for a non-developer in `docs/api/CATALOGUE-IMPORT.md`. **Image import refuses** pending the Cloudinary account.
- **T1 routes all API-backed** `[V]` — `/`, `/products`, `/products/[slug]`, `/categories`, `/categories/[slug]`, `/brands/[slug]`, `/search`, the navbar tree and the sitemap. **No `@nest/services` import remains in any of them**; only `/blog` still reads Supabase, and blog is a Phase 8 domain. The footer needed no migration — it has no data dependency at all.
- **Dev seed extended** `[V]` — 34 products / 13 categories / 7 brands, because four states the T1 pages render were unreachable from the old seed (any image at all, a product with no reviews, an empty brand page, a category deeper than two levels).
- Playwright **37/37** green under the health fixture; jest green; build, type-check, lint and the drift gate green.
**Files/systems involved** — new import tool in `apps/api` tooling (beside `seed.ts`); storefront T1 routes (§7); `lib/api/endpoints.ts`; sitemap; **new API `MediaModule` (Cloudinary, ADR-MEDIA-001) + `mediaAssets` collection.**
**Work required** —
1. **CSV/JSON catalogue import tool, driven by a declarative column-mapping profile (~1–2 days).** Spreadsheet-shaped input → products/categories/brands; upsert by SKU/slug; validated against the Mongo schemas; per-run count/skip/error report. **Kept after launch for bulk additions** — it is not a throwaway migration aid, because there is no legacy catalogue to migrate (D-6).
   - **Column mapping is configuration, not code `[O]`.** The real catalogue will arrive later from a supplier feed or another external source whose columns are **unknown at design time**, so the tool must not hardcode a schema. It reads a **mapping profile** — a small declarative config that says which input column feeds which model field (plus per-field type coercion, required/optional, and a default) — and a new supplier format costs a new profile, not a new parser.
   - **Ships with a profile for the seed shape so it is testable on day one**, and its tests assert the *mapping mechanism* (a profile correctly rewires columns; a missing required column reports rather than throws), not one fixed layout.
   - **This phase is where it stays.** *The former “may be pulled forward to run right after Phase 0” language is removed:* per the owner `[O]`, **the real catalogue does not exist and is deferred until after the build**, so there is no data for an early run to act on. Pulling the tool forward would buy nothing but an earlier untested surface.
2. Migrate T1 routes to `lib/api` catalog calls, page by page, preserving URLs and design.
3. Navbar/Footer category data from the API; sitemap from API data.
4. **Media upload API per ADR-MEDIA-001 (moved here from Phase 7 by owner decision `[O]`) — build only, no data.** `Client → NestJS → Cloudinary`: authorization before any byte is accepted, hard size limit, MIME allow-list, **magic-byte sniffing**, **EXIF strip** + dimension capture, **provider-relative identifiers persisted (never absolute URLs)**. **It ships EMPTY — no products and no images are loaded, because the real catalogue does not exist yet `[O]` — and is exercised only by tests** using fixture bytes. **The admin upload UI is NOT in this phase; it stays in Phase 7** (§13). Landing the endpoint here also **satisfies Phase 8's blog-cover dependency earlier** — blog covers no longer wait on Phase 7.
**Dependencies** — Phases 0, 2. The media item additionally needs the **Cloudinary account credentials (owner-supplied, D-4)**; without them it is written and unit-tested but cannot be integration-proven — recorded, not worked around. Real catalogue *content* is an **owner deliverable** deferred until after the build `[O]` — the code does not wait for it, but launch does (§25 risk 1).
**Risks** — **the storefront runs on the 26-product dev seed for the whole build, by design `[O]`** — visible in dev, harmless, and **blocking launch only, never engineering** (§25 risk 1); owner comms: stop entering catalogue data in the old admin after T1 (edits there are invisible and disposable). Media: an upload endpoint with no real content can rot unnoticed → its tests are the only thing exercising it, so they must cover the rejection paths (bad magic bytes, oversize, wrong MIME), not just the happy path.
**Acceptance criteria** — **structural parity** on every T1 route: same layout, same components, every state still handled (image / no image, sale / no sale, in stock / out of stock, brand / no brand, empty result), and no visual regression in the shell. **Not pixel-equivalence — that criterion was wrong and is withdrawn.** The Supabase catalogue and the Mongo catalogue hold *different mock data* (D-6), so identical content is impossible by construction and a page differing in content proves nothing; demanding it would have made the criterion either unmeetable or quietly ignored. What must not change is the *structure* the design specifies. No `@nest/services` import remains in T1 pages; the import tool round-trips a sample spreadsheet with a correct report **and round-trips a second, deliberately different column layout using only a new mapping profile**; the media endpoint accepts a valid fixture image, persists a provider-relative identifier, strips EXIF, and **refuses** a file whose magic bytes contradict its declared MIME.
**Automated verification** — Playwright specs per T1 route (health fixture); jest green; import-tool report tests.
**Manual/browser verification** — visual pass on all T1 routes, mobile + desktop; one real spreadsheet import.
**Definition of done** — T1 list in §7 fully API-backed; import tool documented for the owner **including how to write a mapping profile for a supplier's format**; media upload API merged, empty, green, and recorded as satisfying Phase 8's blog-cover dependency.

---

### Phase 5 — Identity + money cutover (T2), shipping fees live, `/shop` collapse (T3)

**Goal** — the navigable storefront’s auth, cart, checkout (with real D-8 delivery fees), and account run on the API; `/shop` scaffold retired; single session authority.
**Why** — the working system becomes *the* system: F-03, F-04, F-06, F-12, F-13, F-18 all close here.
**Current state** — `/shop` implementations proven `[V]`; legacy equivalents styled; API gaps: profile update, password reset, shipping-rule lookup (G-01). `FulfilmentService` is ready to receive the rule — governorate already a parameter, threshold already implemented `[V]`; `EGYPTIAN_GOVERNORATES` (27 values incl. Cairo and Giza) verified present in `packages/config` `[V]` and is reused as the rule vocabulary.
**Files/systems involved** — API: auth/users modules (new endpoints §9), `fulfilment.service.ts` + the frozen `shippingRates` collection + seed of the two D-8 rates, `notifications.service.ts` (`shippingUnpriced` retirement); storefront: T2 routes, proxy, Navbar/CartDrawer, Zustand stores, legacy `actions/*`; `/shop/*` (redirects then deletion); root layout route-group split.
**Work required** —
1. **Shipping rate model (D-8) — the FROZEN shape, not a parallel one.** `MONEY-MODEL.md` §6 already reserves `shippingRates[].fee` and `freeShippingThreshold` (int64 minor units), and `MONGODB-DESIGN.md` §11 already fixes the collection as `shippingRates`, keyed `{governorate:1}` **unique**. **The frozen documents win; the earlier `shippingRules` / `{ governorates: string[], fee, isDefault }` sketch in this plan is withdrawn.** Adopt exactly:

   - **Collection** — `shippingRates` (frozen name; *not* `shippingRules`).
   - **Key** — `governorate: string`, **one document per governorate**, unique index `{governorate:1}` (frozen). *Not* an array of governorates.
   - **Fee** — `fee: number`, **int64 minor units (piastres)**, per `MONEY-MODEL.md` §6. *Not* EGP, *not* a float.
   - **Threshold** — **global configuration only** (`FREE_SHIPPING_THRESHOLD`), and **off**. `MONGODB-DESIGN.md` §11 describes the collection as "Governorate → fee, free-shipping threshold"; that is a one-line PURPOSE summary, and reading it as a per-row field produced a column nothing wrote, nothing read and nothing tested — plus an invented precedence rule ("a row beats the config") that no frozen document specifies. Both were removed in the 5a cleanup `[V]`. **Per-governorate free shipping is a reasonable later feature and needs a WRITTEN RULE before a field**: what beats what, and what a row saying `0` means against a global saying `50 000`. Adding the column first is how an unexercised rule becomes folklore.
   - **Seed (D-8 values) — exactly 27 rows, and no twenty-eighth.** `Cairo` → `5000`, `Giza` → `5000`, and each of the other 25 governorates in `EGYPTIAN_GOVERNORATES` (27 values, verified `[V]`) → `10000`. Because the frozen key is one row per governorate, the D-8 rule is expressed as **27 rows**, not two — and every one of them is **independently editable in admin**, which two rules would not have been.
   - `FulfilmentService.quote(governorate, postDiscountSubtotal)` swaps its flat-config read for a `shippingRates` lookup. Signature, callers, DTOs and the order schema are unchanged — the service was explicitly designed for this substitution `[V]`.
   - Update fulfilment/checkout specs, and the `FulfilmentService`/`fulfilment.config.ts` docstrings that currently justify *not* having the collection (§27 note 2).

   - **The miss path — RATIFIED by the owner `[O]`: a lookup miss RAISES. It never invents a fee.** There is **no default row, no fallback and no sentinel**, and **no frozen document is amended**: `MONGODB-DESIGN.md` §11 and `MONEY-MODEL.md` §6 are adopted exactly as written.

   **Why this is safe, and why it is more than D-8 asked for.** The earlier draft of this plan flagged the absence of a fallback slot as a gap and proposed a `"*"` sentinel row to fill it. The owner rejected the premise rather than the proposal, and was right to: 27 individually-priced rows are **more** of what D-8 asks for than two rules, because “admin-editable” then means every governorate can be repriced on its own without touching any other. The fallback was only ever needed to answer *“what do we charge for a governorate we do not have a row for?”* — and since **B3 closed `governorate` to a validated 27-value list on the storefront, on the admin and in the API `[V]`**, no such governorate can reach a quote. A miss is therefore not an unpriced region; it is **bad data** — a deleted or corrupted row — and the honest response to bad data is to fail loudly, not to silently charge a made-up amount to a real customer. That is exactly the outcome `fulfilment.config.ts` warns about: “the miss path — not the data — would decide what every customer is charged” `[V]`.

   **What this obliges the implementation to do.** `quote` raises on a miss (a 5xx-class internal error, not a validation error — the customer supplied a legal value); the 27 rows are seeded as a release step alongside `indexes:sync`; Phase 7's editor may **edit** a rate but must **refuse to delete a row**, since deleting one is the only way to manufacture the miss the design assumes is impossible; and a test asserts that every member of `EGYPTIAN_GOVERNORATES` resolves to a rate.

   > **LANDED (Phase 5a, 2026-09-01) `[V]`.** `shippingRates` exists with the frozen shape and the unique `{governorate:1}` index; 27 rows seeded by `pnpm --filter api shipping:seed` (Cairo/Giza 5 000 pt, the other 25 at 10 000 pt), `$setOnInsert` so a re-seed adds missing rows and never overwrites an edited one. `quote()` is now `async` and reads the table; a miss logs the governorate and raises `SHIPPING_RATE_MISSING` (500), disclosing nothing to the caller. **`SHIPPING_FLAT_FEE` was removed, not deprecated** — a knob nothing reads is worse than an absent one — and `.env.example` carries a tombstone pointing at `shipping:seed`. The threshold stays implemented and off; a row may carry its own, which wins for that governorate, and none does. 38 tests across `fulfilment.spec.ts` (policy, over a stand-in) and `shipping-rates.spec.ts` (the collection, the real index proven by a rejected duplicate, seed idempotency, and the no-cache property).
2. Password-reset + profile endpoints.
3. Guest cart rebuild per §8; T2 route migration as one atomic release train; **Google buttons removed (D-3)**; proxy guard rewritten around `nest_rt`; order self-cancel surfaced in account pages; T3: 301 `/shop/*`, delete slice + legacy Supabase auth/cart/checkout actions; route-group split (F-12).
**Dependencies** — Phases 1, 2, 4.
**Risks** — biggest phase; the flip logs out legacy sessions — **zero-cost by D-6** (no real users), noted for completeness; guest-cart merge edge cases → dedicated tests; quote display for a customer with no address yet (rare — checkout requires a selected address today `[V]`) → show the default-rule fee labelled as such, or defer fee display to address selection: decide in implementation review.
**Acceptance criteria** — a new customer completes the audit’s 14-step journey **on canonical URLs** with the health fixture silent, and the checkout shows 50 EGP delivery for a Cairo/Giza address, 100 EGP otherwise, with `grandTotal` including it; no Supabase import remains under `apps/storefront/src` except the four Phase 8 domains, each listed and dated; exactly one `<main>` per page.
**Automated verification** — full Playwright matrix (auth incl. real verification, store, failure paths incl. expired-session action POST); fulfilment fee table tests; jest green.
**Manual/browser verification** — full manual pass incl. reload/back/forward, cookie inspection, mobile; fee spot-checks per governorate.
**Definition of done** — legacy customer commerce paths deleted; storefront talks only to the API (Phase 8 domains excepted, listed); F-13 closed by real fees. **The `shippingPriced` representation is NOT work in this phase — it landed in Phase 2 (open question 2); this phase only supplies the values it reports.**

---

### Phase 6 — Admin on API, part 1: orders + staff identity

**Goal** — operations staff see and fulfil **real (Mongo) orders**; admin authenticates against the API.
**Why** — F-08 is a money-path authority split: from Phase 5 on, every new order is invisible to today’s admin.
**Current state** — API `admin/orders` surface exists + tested `[V]`; admin UI on Supabase `[V]`; no staff provisioning path `[A]`.
**Files/systems involved** — admin login/proxy, `actions/order.actions.ts` → new admin `lib/api` client (reuse the storefront pattern), staff provisioning (seed/CLI in `apps/api`).
**Work required** — staff provisioning; admin JWT login + role-guarded proxy; orders list/detail/transition UI onto the eight endpoints, UI driven by the API’s allowed transitions (not local maps); decommission Supabase order actions. **No legacy-orders view — Supabase orders are discarded (D-6).**
**Dependencies** — Phases 1, 2. Can run in parallel with Phases 4–5.
**Risks** — state-machine mismatches between old UI expectations and API transitions → server-driven UI resolves it.
**Acceptance criteria** — an order placed on the storefront appears in admin within seconds and can be walked confirm→ship→deliver; a forbidden transition is refused server-side and rendered correctly.
**Automated verification** — API transition tests exist `[V]`; add an admin e2e happy path + forbidden transition (health fixture).
**Manual verification** — fulfil a dev/staging order end-to-end.
**Definition of done** — no Supabase read/write in admin auth or orders; F-08 closed.

---

### Phase 7 — Admin on API, part 2: catalogue, media UI, inventory, customers, shipping rates

**Goal** — the whole business is manageable through the API.
**Why** — F-09 fully closes; the admin becomes the fresh-data entry system D-6 assumes.
**Current state** — API lacks CRUD/media/inventory-ops/customers/shipping-rules endpoints (G-01); admin UIs exist `[V]`; per-capability depth `[A]` resolved screen-by-screen here.
**Files/systems involved** — API catalog/inventory/users/fulfilment modules (**the media module itself is no longer here — it shipped in Phase 4 `[O]`**); admin actions for product/category-brand/inventory + the admin **upload UI** onto the existing Phase-4 endpoint; `check-slug`/`attributes` handlers re-pointed; new `shippingRates` editor screen.
**Work required** — endpoints per §9 with tests; **the admin upload UI** per §13 — the API pipeline already exists and is proven against the real Cloudinary account from Phase 5a, so this is the operator-facing half only. **Note for the attach/detach actions:** `MediaService.retain()` and `release()` now exist and MUST be called — reference counting is what stops `DELETE /admin/media` destroying an image a live product page is showing, and until Phase 5a nothing in production had ever attached an image, so nothing had ever retained one (picker, progress, ordering, primary-image selection, replace/delete), with **no server-side validation rewritten here**; inventory ops per §14; customers list/detail/role; **`shippingRates` editing + admin editor (D-8 second half)** over the frozen collection, with guardrails from the ratified Phase 5 design: **every governorate in `EGYPTIAN_GOVERNORATES` must remain resolvable**, `fee` a non-negative integer in minor units, and — because there is **no fallback row and a miss raises** — **row deletion is refused** and creation is restricted to the 27 known governorates. Editing a rate is the whole feature; the row set is fixed; audit-trail events per `AUDIT-MODEL.md`; swap admin data layer; classify settings/dashboard widgets KEEP/REMOVE as they migrate.
**Dependencies** — Phase 6 (admin auth); **Phase 4 for the media endpoint**; D-4 Cloudinary account (owner supplies credentials — needed as early as Phase 4 now).
**Risks** — scope creep in settings/dashboard → explicit KEEP/REMOVE pass; upload security → **already settled server-side in Phase 4** per ADR-MEDIA-001, and this phase must not re-implement or weaken it client-side.
**Acceptance criteria** — create a product with images in admin → purchasable on the storefront and correct via the API within one refresh; a stock adjustment produces a typed inventory event and correct availability; editing a shipping rule changes the next checkout quote.
**Automated verification** — endpoint tests; admin e2e for product-create, stock-adjust, and shipping-rule edit.
**Manual verification** — full admin walkthrough by the owner — this doubles as the start of real catalogue entry.
**Definition of done** — admin has zero Supabase imports outside the Phase 8 domains; F-09 closed.

---

### Phase 8 — Rebuild the four domains: wishlist → blog → reviews → coupons (+ guest order tracking)

**Goal** — coupons, reviews, wishlist and blog run on the API end-to-end (model + endpoints + tests + admin screen + storefront UI), per D-5. No feature is dropped.
**Why** — these are the last customer-visible legacy surfaces after T2, and D-5 rules out removal. **This phase grew**: honest estimate **~13–16 working days (~2.5–3 weeks)**, reflected here rather than absorbed silently.
**Current state** — all four are Supabase- or client-backed (§3) `[V]`; coupons and the discount math are already frozen-specified (`DISCOUNT-MODEL.md` `[V]`) which materially derisks the hardest item; blog admin authoring screen existence unconfirmed `[A]` (§12).
**Files/systems involved** — new API modules/collections per domain; admin screens (coupons/reviews re-pointed, blog possibly built); storefront UI (wishlist button/page, PDP reviews, blog pages, checkout coupon field); `orders` pricing path for coupon application.
**Work required — in this internal order, cheapest-and-safest first so the owner can defer the tail under schedule pressure:**
1. **Wishlist (~2 days).** Authenticated server-side model (`userId`+`productId`, unique), 3–4 endpoints, button + page swap; retires the Zustand+Supabase duplicates. No money, no UGC — cheapest, ship first.
2. **Blog (~3–4 days).** Content model (slug, title, body, cover via the **Phase-4** media pipeline `[O]`, publish state), admin authoring, storefront list/detail rendering. Read-mostly, no money.
3. **Reviews (~4–5 days).** UGC: model (user, product, rating, body, status), submit endpoint (verified-purchase rule per owner preference — confirm in implementation review `[A]`), **moderation endpoints + admin screen wired BEFORE any public read exposes content** (owner requirement), PDP rendering + rating aggregates.
4. **Coupons (~4–5 days).** Implement the frozen `DISCOUNT-MODEL.md` spec: collections + unique redemption index, validation table, checkout apply/remove field, application inside the quote/placement path via the existing `discountTotal` envelope and the frozen fee formula; admin management re-pointed. **Money-touching:** same idempotency/validation discipline as order placement; last position is deliberate — riskiest, most deferrable.
5. **Guest order tracking (small, independent):** the `GUEST-CHECKOUT.md`-promised endpoint (order number + contact proof, heavily throttled) + re-point the `/order-tracking` page.
**Dependencies** — Phase 5 (storefront layer, quote path), Phase 7 (admin layer). **The media pipeline for blog covers / review images is NO LONGER a Phase 7 dependency — the upload API ships in Phase 4 `[O]`, so blog covers are unblocked as soon as Phase 4 lands.** Only the *admin authoring screen* still waits on Phase 7. Wishlist needs only Phase 5.
**Risks** — coupons interact with money → mitigated by the frozen spec, ordering (last), and §20 item 6 tests; reviews expose UGC → moderation-first gate; deferral of items 3–4 is an owner checkpoint, recorded in §25 if taken.
**Acceptance criteria** — per domain: journey works end-to-end on canonical URLs with the health fixture silent; coupon order shows correct `discountTotal`, fee computed on the post-discount subtotal, and double-redemption structurally refused; unmoderated review content is never publicly readable.
**Automated verification** — §20 item 6 spec set.
**Manual verification** — owner walkthrough per domain, incl. redeeming a coupon on a Cairo and a non-Cairo address.
**Definition of done** — §3 shows all four domains AUTHORITATIVE on the API; last Supabase reads outside dead code are gone.

---

### Phase 9 — Supabase decommission (code deletion)

**Goal** — one database; Supabase gone from the codebase and then from the world.
**Why** — duplicate authority ends when the old authority is unreachable from code. **This collapsed from a data-migration phase to a cleanup phase (D-6).**
**Current state** — §18; after Phases 5–8, only dead imports and env keys should remain `[A]` (verified by the greps below).
**Work required** — the §18 deletion sequence: delete `@nest/providers`, Supabase parts of `@nest/repositories`/`@nest/services`, Supabase-generated types, Supabase env keys, admin service-role usage; pause the project; delete it at the owner’s convenience — no retention obligations (D-6).
**Dependencies** — Phases 5, 6, 7, 8 complete.
**Risks** — a missed runtime dependency → the acceptance grep + full e2e before pausing; the pause step is the safety valve (reversible until deletion, which by ruling destroys nothing of value).
**Acceptance criteria** — `grep -ri supabase apps/*/src packages/*/src --include='*.ts*'` returns nothing; workspace installs, builds, tests, and full e2e green with Supabase paused.
**Automated verification** — full pipeline + e2e with the project paused.
**Manual verification** — smoke pass of storefront + admin.
**Definition of done** — Supabase project paused; deletion scheduled at owner’s convenience.

---

### Phase 10 — Test and CI hardening (continuous, finishes here)

**Goal** — the suite catches what the audit caught, across old and new domains.
**Why** — F-14 and §20; green must mean working.
**Work required** — §20 items 3–8 completed and enforced (health-fixture adoption mandatory for merged specs; real-verification spec; failure-path matrix; new-domain specs incl. shipping/coupons; isolation policy documented).
**Dependencies** — fixture from Phase 2; specs accumulate through Phases 4–8.
**Acceptance criteria** — deliberately breaking any of: proxy action-pass-through, verification link, checkout redirect, shipping-fee lookup, or coupon double-redemption guard turns the suite red.
**Definition of done** — those mutation spot-checks pass; CI required for merge.

---

### Phase 11 — Production deployment

**Goal** — customers on the real domain.
**Why** — last, because deploying the split system would ship the broken half.
**Current state** — **provisioning decisions OPEN (D-10 deferred until the build is complete).** `DEPLOYMENT-DECISION.md` stands as the recommendation `[P]`; nothing deployed `[V]` (no deploy configs beyond docs). The email production line (Phase E) is the long-lead prerequisite and is already running in parallel — it must not wait for D-10.
**Work required** — take D-10 (targets, budget, domains); provision staging; bind §21 checklist to the chosen platforms; staging soak with the full e2e matrix on real subdomains (cookie topology re-validated); DNS cutover; production go-live; post-launch smoke (register with a real address, place a COD order with a real shipping fee, fulfil it in admin).
**Dependencies** — Phases 1–9 (10 ongoing), Phase E complete, D-10 taken, and the **real catalogue entered by the owner** — the top schedule risk to go-live (§25 risk 1).
**Risks** — provisioning unknowns surfacing late because D-10 is deferred → mitigated by keeping the recommendation current and by the staging gate; cookie topology differences → staging on real subdomains before go-live.
**Acceptance criteria** — the §23 definition holds on production infrastructure.
**Definition of done** — launch checklist signed; monitoring quiet for the agreed soak window.

---

## 23. Definition of 100% Complete

Every statement below must be demonstrably true, on production infrastructure, with evidence:

1. A new customer completes: register → receive real email (Phase E sender) → verify → login → browse the designed storefront → cart (incl. guest cart merged at login) → address → quote **showing the correct governorate-based delivery fee (50 EGP Cairo/Giza, 100 EGP otherwise, admin-editable)** → order → confirmation email → history → detail → self-cancel where allowed — **on canonical URLs, with zero browser errors** (health-fixture standard).
2. Every storefront route is API-backed, deliberately static, or deliberately removed; no route reads Supabase; exactly one session authority; exactly one `<main>` per page.
3. Admin staff authenticate via the API and can manage products (with Cloudinary images), categories, brands, inventory, orders (full lifecycle), customers, and **shipping rules**; every admin write lands in Mongo and is visible to customers and Flutter.
4. §3’s table contains only `AUTHORITATIVE` rows (with D-9’s deferral recorded, not hidden).
5. **Coupons, reviews (moderation-gated), wishlist and blog work end-to-end on the API** — or, if the owner exercised the Phase 8 deferral checkpoint on the tail items, that deferral is recorded as an updated decision in §25, not left as a silent gap.
6. Email: verification + order confirmation delivered by a Brevo-verified owner-domain sender with documented EG/SA deliverability results; failures logged truthfully; tests provably provider-isolated.
7. Flutter: frozen OpenAPI v1 + drift gate; the documented sandbox recipe works from scratch.
8. CI green from fresh clone (install → seed → type-check → lint → build → test → e2e) and red under the Phase-10 mutation checks.
9. Deployed: staging + production per the taken D-10, secrets managed, readiness-probed, logged with request IDs, alerting on send-failures and readiness; runbooks exist.
10. Supabase decommissioned: zero source references, project paused/deleted. (No archives — D-6.)
11. Scoped-out items — payments beyond COD (D-7), Google login (D-3), campaigns/ads/analytics (D-9) — are recorded decisions in §25, not silent gaps.
    **The real catalogue has been entered by the owner** (via the Phase 4 import tool and/or the Phase 7 admin) **and the store therefore has real products to sell.** To be unambiguous: **items 1–10 above can every one of them be true while this item is false.** The catalogue does not exist today, is expected later from a supplier feed or another external source, and is deferred until after the build `[O]`. Throughout development the storefront runs on the 26-product dev seed `[V]`. **This item blocks LAUNCH ONLY — it never blocks engineering**, and no phase may be held open waiting on it.

## 24. Final Dependency Graph

```
P0 baseline
 ├─► P1 dev-email hygiene ──► P3 Flutter freeze (parallel lane thereafter)
 │        │
 │        ├─(parallel, long-lead)──► PE Brevo production line ─────────────┐
 │        ▼                                                                │
 │      P2 crash class + CI                                                │
 │        ├────────────► P4 T1 reads + import tool ─► P5 T2/T3 + shipping ─┤
 │        └─► P6 admin orders + staff auth ─► P7 admin part 2 ─────────────┤
 │                                              (Cloudinary, shipping      │
 │                                               editor, catalogue CRUD)   │
 │                       P5 + P7 ──► P8 rebuild (wishlist→blog→reviews→    │
 │                                    coupons, + guest tracking) ──► P9 ───┼─► P11 production
 │                                                       Supabase deletion │      (needs D-10 +
 └── P10 test/CI hardening: starts in P2, gates every merge, ends after P8 ┘       real catalogue)
```

**Longest path:** `P0 → P1 → P2 → P4 → P5 → P8 → P9 → P11`, with the admin rail (`P2 → P6 → P7 → P8`) converging at P8 — the two rails are the same length, so **P8 is the merge point and the schedule’s pinch**; its internal cheapest-first order exists to keep the pinch flexible. Phase E runs on calendar time and must overlap everything.

## 25. Risks and Decisions

### Decisions — all RESOLVED 2026-09-01 by the product owner

| ID | Decision | Resolution (2026-09-01) | Landed in |
|---|---|---|---|
| D-1 | Cutover strategy | **APPROVED as recommended** — rewire the designed legacy UI onto the API; `/shop` is reference code, deleted at parity | §7, Phases 4–5 |
| D-2 | Email vendor + posture | **Brevo.** Dev runs on the console provider now (proven `[V]`); the Brevo key + owner-domain sender + SPF/DKIM + EG/SA deliverability discovery run as a parallel long-lead track blocking only go-live | §11, Phase 1 + Phase E |
| D-3 | Google login at launch | **NOT required.** Buttons removed at T2; API OAuth recorded as post-launch work | §10, §17, Phase 5 |
| D-4 | Image storage | **Cloudinary CONFIRMED** (per ADR-MEDIA-001). **No media migration** — the 2 existing objects are disposable; pipeline work only | §13, Phase 7 |
| D-5 | Coupons / reviews / wishlist / blog | **BUILD API replacements for all four.** Coupons per the frozen `DISCOUNT-MODEL.md`, money-discipline; reviews moderation-first; wishlist authenticated server-side; blog with admin authoring. ~2.5–3 weeks, ordered cheapest-first with a deferral checkpoint | §16, Phase 8 |
| D-6 | Legacy data | **THROWN AWAY ENTIRELY** — all data in Supabase *and* Mongo is mock; no import, no archival, no retention, no restore drills, no slug-redirect preservation. Real data entered fresh (import tool + admin) | §18 and throughout |
| D-7 | Payments | **COD-only launch CONFIRMED** as a time-driven interim choice; provider integration is a recorded future project | §17 |
| D-8 | Shipping pricing | **DECIDED:** 50 EGP Cairo & Giza, 100 EGP all other governorates; **admin-editable**. **Modelled on the FROZEN `shippingRates` collection** (`MONEY-MODEL.md` §6 `shippingRates[].fee` + `freeShippingThreshold`, int64 minor units; `MONGODB-DESIGN.md` §11 key `{governorate:1}` unique) — i.e. **one row per governorate, 27 rows**, over `EGYPTIAN_GOVERNORATES` (verified present `[V]`). The earlier `{ governorates[], fee, isDefault }` sketch is **withdrawn**: the frozen document wins. **Representation RATIFIED 2026-09-02 `[O]`: 27 seeded rows, one per governorate, no default row, no fallback, no sentinel — a lookup miss RAISES rather than inventing a fee, which is safe because B3 closed the governorate to a validated list on both sides `[V]`. No frozen document is amended.** Free-shipping threshold stays off. Quote-side in Phase 5; per-row admin editing in Phase 7 | §3, Phases 5, 7 |
| D-9 | Campaigns / ads / analytics | **DEFERRED — out of scope by decision.** No requirements invented | §16 |
| D-10 | Deployment targets | **DEFERRED until the build is complete.** Production phase stays; provisioning decisions open; the Brevo/DNS long-lead item explicitly does not wait | §21, Phase 11 |

### Risks — rewritten after the decisions

**Eliminated by decision (stated, not silently dropped):**
- ~~Dual-write window between catalogue cutover and admin migration~~ — **eliminated by D-6**: with all Supabase data disposable and no import pipeline, there is nothing to diverge from. The only residue is operational: old-admin edits become pointless after T1 (noted in §7).
- ~~Legacy-session invalidation at T2~~ — **eliminated by D-6**: no real users exist to log out or migrate.

**Current top risks:**

1. **⚠ TOP SCHEDULE RISK TO GO-LIVE — there is no real catalogue, and it is owner content work, not code `[O]`.** The catalogue **does not exist today**; it is expected later from a **supplier feed or another external source**, and the owner has **deferred it until after the build**. With no Supabase import either (D-6), the storefront runs on the **26-product dev seed for the entire build** `[V]`.
   **This outranks every other schedule risk because it is the one item on the launch list that no amount of engineering can retire.** Phases 0–11 can all be complete, green and deployed — §23 items 1–10 all true — and the store still cannot open, because it has nothing real to sell.
   It is also the risk with the **longest and least controllable lead time**: sourcing, negotiating and cleaning a supplier feed is a business process on calendar time, like Phase E's DNS work, and unlike Phase E it has not started.
   *Mitigations, and their honest limits:* the Phase 4 import tool lands early and reads a **declarative column-mapping profile**, so an unknown supplier format costs a profile rather than a rewrite — that removes the *engineering* lead time, not the *content* lead time. **Nothing here blocks engineering; it blocks launch only, and no phase may be held open waiting on it** (§23 item 11).
   *Owner action, the earliest useful one:* obtain **one representative sample file** from the intended source — not the full catalogue — early enough for the Phase 4 tool to be built and tested against a real column layout instead of an assumed one.
2. **The T2 atomic flip** remains the largest single release — mitigated by the feature-branch train, the health fixture, and the fact that verified target implementations already exist in `/shop`.
3. **Brevo deliverability to Egyptian/Saudi inboxes is a discovery risk on calendar time.** A late failure slips launch with no engineering countermeasure — which is why Phase E starts alongside Phase 1 and reports findings, not just completion.
4. **Coupons introduce new money math into the pricing envelope.** Mitigated by the pre-existing frozen spec (`DISCOUNT-MODEL.md` `[V]`), last position in Phase 8, the structural double-redemption index, and §20 item 6 tests.
5. **Phase 8 is the schedule pinch** (~2.5–3 weeks where both rails converge). The cheapest-first internal order exists so the owner can defer reviews/coupons with a recorded decision rather than schedule slip.
6. **Admin capability depth is still unverified per screen** `[A]` — budgeted as screen-by-screen audits inside Phases 6/7; estimates there may move.
7. **Shared dev/test database** — parallel test runs collide (observed `[V]`); enforce the §20 isolation policy before team size grows.
8. **D-10 deferral** — provisioning unknowns (cookie topology, platform quirks) surface only at Phase 11; mitigated by the staging-on-real-subdomains gate and by keeping `DEPLOYMENT-DECISION.md` current.

---

## 26. Changelog — 2026-09-02 overnight corrections

Four corrections applied on branch `phase-1-2-overnight`. Documentation only — no code
changed in this commit. Two are owner decisions `[O]`, two are correctness fixes to this
plan's own reasoning.

**26a — Media pipeline moves to Phase 4; build only, no data `[O]`.**
The Cloudinary **upload API** (ADR-MEDIA-001: `Client → NestJS → Cloudinary`, server-side
validation, magic-byte sniffing, EXIF strip, provider-relative identifiers) moves from
Phase 7 to **Phase 4**. It **ships empty and is exercised only by tests** — no products and
no images are loaded, because the real catalogue does not exist yet. **The admin upload UI
stays in Phase 7.** Updated §12, §13, Phase 4, Phase 7. **Phase 8's blog-cover dependency
on Phase 7 is now satisfied earlier** and is recorded as such.

**29 — The per-row free-shipping threshold is withdrawn.**
Phase 5a gave `shippingRates` a `freeShippingThreshold` column and a precedence
rule — a row's threshold beating the configured one. Neither was specified.
Nothing set the column, nothing read it and nothing tested the rule, which makes
it future confusion rather than future flexibility. Removed from the schema, the
seed, the service and the tests, and `$unset` from the 27 development rows;
production is unaffected because the collection has never been deployed.
The global `FREE_SHIPPING_THRESHOLD` is unchanged and still off. Updated Phase 5.

**28 — The plan contradicted a frozen document on the password-reset paths, and lost.**
§9 named the reset pair `POST /auth/password-reset/request` and `/confirm`. The
frozen **`AUTHORIZATION-MODEL.md` §2.8** specifies **`POST /auth/forgot-password`**
and **`POST /auth/reset-password`**. The Phase 5a brief took the names from §9 —
a planning document, not a governing one — and they were built that way.

**The frozen document wins, exactly as it did for `shippingRates` (26b).** The
endpoints are renamed, §9 is corrected at the source so the wrong names cannot
propagate again, and the DTOs went with them (`ForgotPasswordDto`,
`ResetPasswordDto`). The BEHAVIOUR was already §2.8's and is unchanged.

**This is a BREAKING contract change and the gate said so** — two paths removed,
two schemas removed. It is safe only because nothing consumes them: the
storefront's `/forgot-password` page still calls Supabase, and no admin or
Flutter client exists. That window closes in 5b. Recorded in
`docs/api/INTEGRATION.md` beside the gate's own rules.

Added **§9.1**, an audit of every endpoint path any frozen document names
against the 49 operations actually served. Five disagreements are recorded there
— listed deliberately, not fixed.

**27 — Phase 5a: the additive half of Phase 5. No cutover; the session cluster is untouched.**
The additive half of Phase 5. Readiness (`GET /health/ready`) now **refuses traffic when a
declared index is missing**, names each one and prints the remedy — because several unique
indexes are not optimisations but the entire enforcement behind an invariant, and two
repositories delegate their concurrency control to MongoDB error 11000. On its first run it
found `mediaAssets.media_asset_public_id_unique` genuinely absent from the development
database. `shippingRates` landed with the frozen shape and its 27 ratified rows, `quote()`
reads it, and a miss raises. Open question 3 is resolved by D-8 rather than answered.

The three endpoints G-01 listed as missing for T2 also landed: password reset
(`request`/`confirm`) and `PATCH /users/me`. A reset now ends every session —
`tokenVersion` bump plus full refresh-token revocation, in ONE transaction with
the credential change, because a reset that leaves an intruder's refresh token
alive has not reset anything. The two token kinds live in separate fields and are
looked up separately, and a test proves a verification token cannot be redeemed
at the reset endpoint or the reverse.

**The blank 404 is half fixed, and the half that is not is measured.** Every
dead product, category and brand URL answered `200` — a soft 404. Removing the
`loading.tsx` boundaries above the existence check restores the `404`; the
listing page kept its skeleton by moving into a `(listing)` route group. The
BODY is still empty, and no in-page arrangement can fix it: Next renders
`notFound()` as an empty document whenever it is thrown after an `await`, which
a data-driven 404 always is. The remedy is the existence check in `proxy.ts`,
which is 5b's. `e2e/not-found.spec.ts` carries the measurement table and a
`test.fail()` that goes red the day it starts working.

**D-4 is CLOSED.** The Cloudinary credentials arrived and the whole pipeline is
proven against the real account — upload, refusals, delete, orphan report,
response mapping. One field was mapped on an assumption that turned out wrong
(`format: "jpg"` rather than `jpeg`) and is now normalised in the adapter. The
catalogue import's `--images` path is unblocked and idempotent. **The account is
shared with an unrelated application** (108 assets), so `MEDIA_FOLDER_ROOT` is
now configurable and prefix-scoping is load-bearing rather than tidy.

Updated Phase 5, Phase 7, D-4, D-8, §3, §9, §10, open questions.

**26b — Shipping model realigned to the frozen `MONEY-MODEL.md`. The frozen document wins.**
This plan had proposed a `shippingRules` collection shaped `{ governorates[], fee, isDefault }`.
`MONEY-MODEL.md` §6 already reserves **`shippingRates[].fee`** and `freeShippingThreshold`
(int64 minor units) and `MONGODB-DESIGN.md` §11 already fixes the key as `{governorate:1}`
**unique** — one row per governorate. **The `shippingRules` sketch is withdrawn**; the frozen
names, shape and units are adopted verbatim, which makes the D-8 rule **27 rows, not two**.
Updated §3, §9, §12, §20, Phase 5, Phase 7, D-8.
**Stated explicitly rather than papered over:** the frozen shape **cannot express the
default fallback** D-8 asks for — a unique scalar key has no slot for "every governorate
without a row". A **minimal extension is proposed** (a reserved `governorate: "*"` sentinel
row: no new field, no schema change, no index change; the `isDefault` + partial-index
alternative is recorded as the larger amendment). It **amends a frozen document and
therefore awaits owner ratification**; until then a lookup miss must raise, never invent a
fee. **→ Superseded by 26e: the owner ratified *no* fallback, so the extension is withdrawn
and no frozen document is amended. The "miss must raise" rule survives, permanently.**

**26c — `shippingFee === 0` semantics resolved in Phase 2, before the Phase 3 freeze.**
A correctness fix. §19 told the Flutter developer the quote was "safe to integrate now"
while open question 2 deferred the meaning of `0` to Phase 5. Today `0` means **"not
priced"** — `CheckoutForm.tsx:88` renders it "Not yet calculated" and
`notifications.service.ts:299` sets `shippingUnpriced` from it `[V]`. After Phase 5 it means
**"free"**. A client integrating at Phase 3 codes `0 → "not calculated"` and then
misreports every free-shipping order.
**Adding a field is additive and the drift gate reports it; changing the meaning of an
existing value changes no name, no type and no shape, so the gate sees nothing.** That is
why this cannot wait for Phase 5. Worse, it is **already reachable**: `FulfilmentService.quote`
returns `0` whenever the free-shipping threshold is met `[V]`.
Recommended representation: an explicit **`shippingPriced` boolean** (nullable fee as the
alternative). Moved into **Phase 2** with both consumers updated. Updated §19, §20, Phase 2,
Phase 3, Phase 5, F-13, open question 2.

**26d — Catalogue timing `[O]`.**
The real catalogue **does not exist**, will come later **from a supplier feed or another
external source**, and is **deferred until after the build**. Therefore: the import tool
**stays in Phase 4** and the "may be pulled forward to run right after Phase 0" language is
**removed** — there is no data for an early run to act on. Its spec now requires a
**declarative column-mapping profile** (configuration declaring which input column feeds
which field) instead of a hardcoded schema, because the input format is unknown at design
time; a new supplier format costs a profile, not a parser.
**§25 risk 3 is escalated to risk 1 — the top schedule risk to go-live**, on the grounds
that it is the only launch-list item no engineering can retire and it has the longest
uncontrolled lead time. **§23 item 11 is made unambiguous:** items 1–10 can all be true
while the store has nothing real to sell. Recorded throughout that the storefront runs on
the 26-product dev seed for the whole build, and that this **blocks launch only, never
engineering**.

**26e — D-8 shipping representation RATIFIED; the proposed extension is withdrawn `[O]`.**
26b left one item open: the frozen `shippingRates` shape has no slot for the default
fallback D-8 asks for, and this plan proposed a reserved `governorate: "*"` sentinel row to
fill it, pending ratification. **The owner ratified a different and better answer: there is
no fallback.** The collection holds **27 seeded rows, one per governorate** — Cairo and Giza
5 000 pt, the other 25 at 10 000 pt, each independently editable in admin — with **no
default row, no fallback and no sentinel**. `MONGODB-DESIGN.md` §11 and `MONEY-MODEL.md` §6
are adopted **unchanged**; **no frozen document is amended**, so the extension 26b flagged
for ratification is withdrawn rather than approved.
**The reasoning, recorded because it is not obvious from the shape alone:** 27
individually-priced rows are *more* of what D-8 asks for than two rules — “admin-editable”
becomes per-governorate rather than per-rule. And the fallback existed only to answer
“what do we charge for a governorate with no row?”, a question **B3 made unaskable** by
closing `governorate` to a validated 27-value list on the storefront, in the admin and in
the API `[V]`. A miss is therefore not an unpriced region but **bad data**, and **failing
loudly beats silently charging a made-up fee to a real customer**. Updated §3, D-8, Phase 5,
Phase 7; the corresponding open item is removed from `HANDOFF.md` §4.

**Not changed, deliberately** — nothing in `docs/architecture/` was edited, by 26b or by
26e. 26b resolved a plan-vs-frozen-doc conflict in the frozen doc's favour, which is what
the owner directed; 26e settles the one item that would have *amended* a frozen doc by
removing the need for the amendment entirely.

---

## 27. Changelog — 2026-09-01 decision update

Applied owner decisions D-1…D-10 to the 2026-09-01 audit plan. Same evidence discipline; new `[O]` tag introduced for owner statements (data value, business rules) that cannot be verified from the tree.

**Changed**
- §1: email demoted from #1 blocker to a two-track item (dev hygiene now; Brevo production line parallel); migration language replaced by fresh-data-entry language; critical path restated.
- §3: Shipping row rewritten around the decided 50/100 EGP rule and the discovery that `FulfilmentService` + a config-driven free-shipping threshold **already exist** `[V]` (re-verified this session by reading `fulfilment.service.ts`); coupons/reviews/wishlist/blog targets flipped from “owner decision” to **REBUILD (D-5)**; payments and analytics rows now record confirmed/deferred decisions; every archive reference removed.
- §6: added a status column. F-01 re-ranked to production-gate; F-04/F-06 resolved-by-deletion (interim patches dropped as valueless under D-6); F-13 now closes via the real fee rule; G-01 gains the shipping-rule model and the four required rebuilds, loses Google OAuth (deferred).
- §7: T1’s catalogue-import dependency removed; T1 now depends on Phases 0 + 2 only; old-admin-edits-are-pointless note added; wishlist button timing clarified (server wishlist arrives Phase 8).
- §11: restructured into the two D-2 tracks; deliverability explicitly framed as discovery.
- §12: no legacy-orders view; coupons/reviews become rebuilds; shipping-rules editor and blog-authoring rows added (blog admin screen existence flagged `[A]`).
- §13: media migration deleted; slug-redirect question resolved (dropped, D-6).
- §15: order archival deleted outright.
- §16: rewritten — coupons are a build against an already-frozen spec; ads/analytics recorded as deferred (D-9).
- §18: collapsed from a data-migration plan to fresh-entry paths + a code-deletion sequence; all volume signals, retention windows and restore drills removed.
- §19: email framed as a production concern; console recipe is the dev/integration path.
- §20: new-domain and shipping/coupon spec requirements added (item 6).
- §21: provisioning marked OPEN per D-10; Brevo/DNS called out as the long-lead exception.
- §22: phases re-derived — Phase 1 shrank to dev hygiene; new parallel **Phase E**; Phase 4 shrank (no import) and gained the CSV/JSON tool; Phase 5 grew (shipping rule quote-side, Google-button removal); Phase 7 gained the shipping-rates editor (**renamed to the frozen `shippingRates` 2026-09-02, §26b**); Phase 8 grew into the four-domain rebuild (~13–16 working days, cheapest-first: wishlist → blog → reviews → coupons) plus guest tracking; old Phase 9 collapsed into code-deletion cleanup.
- §23: archive/restore clauses removed; shipping-fee correctness and the four rebuilt domains added; owner catalogue entry added.
- §24: graph redrawn; longest path restated with P8 identified as the merge point/pinch.
- §25: decisions table converted to RESOLVED with answers dated 2026-09-01; risk list rewritten — two risks explicitly marked eliminated (dual-write window; legacy-session invalidation), three new ones surfaced (deliverability discovery, owner catalogue entry on the critical path, Phase 8 pinch).

**Removed**
- Supabase→Mongo catalogue import; customer migration options; order archival and read-only legacy views; audit-log export; retention window and restore drill; slug-redirect preservation; the optional interim F-04 patch; `GET /auth/google` from the §9 gap table.

**Added**
- `[O]` evidence tag; §6 status column; the temporary CSV/JSON catalogue import tool (Phase 4, pull-forwardable to post-Phase 0 — **the pull-forward was revoked 2026-09-02, §26d**); Phase E (Brevo production line); shipping-rule model + seed + admin editor work items; Phase 8 internal build order with per-domain effort signals; this changelog.

**Contradictions checked against frozen docs — none found; three alignments worth recording**
1. D-5 coupons: `DISCOUNT-MODEL.md` turns out to already freeze the exact model, validation table and double-redemption guard the decision asks for `[V]` — Phase 8’s coupon item is implementation of an existing spec, which lowers its risk.
2. **[Acted on 2026-09-02 — see §26b.]** D-8 shipping: `MONEY-MODEL.md` already reserves `shippingRates[].fee` and `freeShippingThreshold`, `BUSINESS-RULES.md` RULE-PRICE-009 already mandates server-computed governorate-based fees, and `FulfilmentService`’s own docstring records the rates as “unsupplied business input” (`OPEN-001`) awaiting exactly this decision `[V]`. D-8 *supplies* the frozen architecture’s missing input; the service’s in-code note “no `shippingRates` collection” was an anti-overengineering guard pending that input and is superseded by the admin-editability requirement — update that docstring during Phase 5.
3. D-4 media: ADR-MEDIA-001 already specifies `Client → NestJS → Cloudinary` with server-side validation — D-4 confirms rather than changes it.

**Open questions for the owner (non-blocking, resolve in the phase noted)**
1. **D-6 scope clarification (interpretation recorded):** “throw away all Mongo data” is read as *business* data only — the seeded dev catalogue and test fixtures remain as tooling, because the jest suite and CI seed step depend on them `[V]`. Flag if the stricter reading was intended.
2. **`0`-fee semantics — RESOLVED INTO PHASE 2 (was: deferred to Phase 5).** `shippingFee === 0` today encodes **“not priced”** in both consumers — the checkout UI (`CheckoutForm.tsx:88` renders `amount === 0` as “Not yet calculated” `[V]`) and the order email (`notifications.service.ts:299` sets `shippingUnpriced: order.pricing.shippingFee === 0` `[V]`). After Phase 5 the same `0` will mean **“free”**.
   **This is not merely a future ambiguity — it is already live.** `FulfilmentService.quote` *already* returns `0` when the free-shipping threshold is met `[V]`; the moment a threshold is configured, a genuinely free order renders as “Not yet calculated” and emails “Calculated before dispatch”. Recommendation: an explicit **`shippingPriced: boolean`** on the pricing block (additive, and the drift gate can see it arrive), with a nullable fee as the alternative. **Decided and shipped in Phase 2, before the Phase 3 freeze** — see Phase 2 item 5.
3. ~~**Quote before address selection (Phase 5):** with per-governorate fees, what does the quote show when no address is chosen?~~ **RESOLVED by D-8 itself, Phase 5a `[V]`.** The recommendation on the table was "show the default-rule fee labelled *estimated*" — and D-8 removed the thing it depended on. There is **no default rule**, so there is no fee to estimate from; picking one governorate's rate to show would be inventing a number, which is the exact failure the no-fallback design exists to prevent. The quote returns `{ fee: 0, shippingPriced: false }`, which is what that field was introduced to express. **This is not the miss path and must not raise:** quoting before choosing an address is an ordinary step of checkout, whereas a miss is a governorate that should have a row and does not.
4. **Reviews: verified-purchase requirement? (Phase 8)** — the moderation-first rule is decided; whether submission requires a delivered order is not.
5. **Blog admin authoring:** no admin blog screen was found in the route inventory `[V]` — Phase 8 assumes it must be **built**, not migrated; confirm no screen exists elsewhere before estimating.
