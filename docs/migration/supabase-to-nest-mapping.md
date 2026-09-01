# Supabase → NestJS Migration Mapping — Phase 0.5

**Built from verified live behaviour**, not from the repository's intentions. Every "Actual current implementation" column below was extracted from the production database on 2026-08-29.

**Nothing here is implemented.** This is the specification handed to Phase 1.

**Risk key:** 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low

---

## 1. Authentication & identity

| Supabase capability | Actual current implementation (VERIFIED) | Business purpose | Future NestJS responsibility | MongoDB responsibility | Risk |
|---|---|---|---|---|---|
| GoTrue email/password | Browser-side `signUp` / `signInWithPassword` with the anon key; bcrypt `$2a$` hashes in `auth.users` | Customer & admin identity | `AuthModule`: `POST /auth/register`, `/login`, `/refresh`, `/logout`; argon2 or bcrypt in `UsersService` | `users.passwordHash` — **copy the existing bcrypt hashes verbatim** | 🔵 **Downgraded from 🟠.** Hashes are portable; **no forced reset**. Closes R3. |
| GoTrue Google OAuth | **Provider disabled**; 0 Google identities ever created; the UI button is non-functional | — | **New feature or drop** — not a port | `users.providers[]` | 🔵 No migration work; re-scope as new development |
| Email confirmation | `mailer_autoconfirm = false` — required; registration UI does not handle the no-session case | Verify ownership | Preserve; **fix the UX** (show "check your email") | `users.emailVerifiedAt` | 🟡 |
| Password reset | **Broken** — `ROUTES.auth.callback` undefined; never completed for any user | Account recovery | **Build**: forgot/reset endpoints + set-password page | `passwordResetTokens` or Redis | 🟡 Build, not port |
| `handle_new_user` trigger | AFTER INSERT on `auth.users` → creates `profiles`; `role` from column default; `full_name` falls back to email | Provision profile | Explicit creation inside the registration transaction | Single `users` document — trigger disappears | 🔵 |
| Session / JWT | GoTrue cookies via `@supabase/ssr`; TTLs **UNKNOWN** (project setting) | Session | JWT access (~15 min) + rotating refresh; httpOnly cookie for web, bearer for Flutter | `refreshTokens` or Redis denylist | 🟡 |
| Role resolution | `profiles.role` read **on every request** — `profiles_pkey` is the hottest index (2,719 scans); role is **not** in the JWT | Authorization | `role` as a **JWT claim** + `RolesGuard` | `users.role` | 🔵 Removes the hottest query in the system |
| `admin` vs `super_admin` | Treated identically by `is_admin()` and `requireAdmin()`; **no `admin` user has ever existed** | Privilege tiers | Introduce real separation: `@Roles('super_admin')` on role management | `users.role` | 🟡 Untested path — test both |
| Rate limiting | **None anywhere** | Abuse prevention | `@nestjs/throttler` + Redis | — | 🟠 New capability |

---

## 2. Authorization — RLS → guards

**Verified context:** RLS is enabled on all 28 tables with 52 coherent policies, hinging on `is_admin()`. **But four `SECURITY DEFINER` RPCs granted to `anon` bypass all of it** — so RLS is *not* the system's effective security boundary today.

| RLS policy (verified) | Business meaning | Future NestJS responsibility | Risk |
|---|---|---|---|
| `products/categories/brands_public_read USING (is_active AND deleted_at IS NULL)` | Public sees live catalogue only | Repository always applies the filter on public routes; separate admin route returns all | 🔵 |
| `product_images/attributes/... _public_read USING (true)` (7 tables) | — | **Tighten:** child visibility must inherit the parent's | 🟡 Currently leaks hidden products' images/attributes |
| `profiles_select_own USING (auth.uid()=id OR is_admin())` | Read own profile | `GET /users/me`; userId from JWT only | 🔵 |
| `profiles_update_own WITH CHECK (auth.uid()=id AND role='customer')` | **Blocks self-escalation** | `PATCH /users/me` with a DTO that has no `role` field | 🔵 Preserve — this works today |
| *(no INSERT policy on `profiles`)* | — | Removing browser DB access fixes the broken profile save | 🟠 Live defect |
| `addresses_own ALL` | Own addresses | `/users/me/addresses/*` | 🔵 |
| `orders_own_read USING (auth.uid()=user_id OR is_admin())` | Own orders; **anon gets nothing** | `OrdersService.findForUser(userId, id)` | 🔵 Preserve |
| `orders_own_insert WITH CHECK (auth.uid()=user_id)` | Can only create own order | userId from JWT; **body field must not exist** | 🔴 Today bypassed by `create_order_v2` |
| `orders_admin_update USING (is_admin())` | Admin-only status changes | `@Roles('admin')` **+ server-side transition matrix** | 🔴 Today bypassed |
| `reviews_public_read USING (moderation_status='approved')` | Only approved shown | Public list filters `approved` | 🔵 |
| `reviews_own_update USING (... AND moderation_status='pending')` | Edit only while pending | Preserve as a service rule | 🔵 |
| `coupons_admin_all` (no public read) | Coupons never publicly listable | Only `POST /coupons/validate` is public | 🔵 |
| `inventory_admin_all`, `audit_logs_admin_*` | Admin-only | `@Roles('admin')`; audit written by an interceptor | 🟡 |
| `recently_viewed_own USING (auth.uid()=user_id OR session_id IS NOT NULL)` | — | **Do not port the predicate** — it is world-writable | 🔵 Table empty; redesign or drop |
| `is_admin()` (backs 28 policies) | The authorization hinge | `RolesGuard` | 🟠 R2 — needs a traceability table |

> **Phase 4 deliverable:** one row per policy above, each with a passing authorization test (anon × customer × other-customer × admin × super_admin). That table is the only credible evidence R2 is discharged.

---

## 3. Database functions → services

| Function (verified) | Actual behaviour | Business purpose | Future NestJS responsibility | MongoDB responsibility | Risk |
|---|---|---|---|---|---|
| `create_order_v2` | Prices server-side ✅; decrements `stock_quantity` directly; `total = subtotal + shipping`; **no** discount/tax/coupon; **no** active/deleted check; **no** quantity floor; fully atomic ✅ | Place an order | `OrdersService.create()` — port the good parts, **fix** OC-06/07/08/12/13 | Multi-document transaction across `orders`, `products`, `inventoryTransactions` | 🔴 **R1 — now fully specified.** The unknown is resolved; the risk is now *correct reimplementation*, not *discovery* |
| `create_order_v1` | **Orphaned legacy.** Trusts client-supplied prices and totals; still granted to `anon` | — | **Do not port.** Revoke/drop. | — | 🔴 Active vulnerability |
| `update_order_status_v2` | Row-locks ✅; writes history ✅; **no transition validation**; **no stock restoration**; **any tracking number breaks the call** | Change order state | `OrdersService.updateStatus()` with an atomic, server-side transition matrix; **persist trackingNumber** | `orders.status`, `orders.statusHistory[]`, `orders.trackingNumber` | 🔴 |
| `adjust_stock_v2` | Row-locks ✅; signed delta; floor 0; ledger with `created_by` ✅; ignores `reserved_quantity`; **has never succeeded in production** | Manual stock correction | `InventoryService.adjust()` | `products.stock`, `inventoryTransactions` | 🟡 |
| `search_products` | Fixed sort; no total; exact category slug; returns 12 scalars (no images/brand/rating); GIN index **unusable** | Catalogue & search | `SearchModule` with real sort, facets, correct totals, subtree categories | Atlas Search / `$text` + `$facet` | 🟠 Rewrite, not port — the bar is low |
| `generate_order_number` | `NE-YYYYMMDD-NNNN`, **global** sequence | Human-readable id | `OrdersService` counter or a collision-safe generator | `orders.orderNumber` unique | 🟡 Decide per-day reset vs global; consider non-enumerable |
| `is_admin()` | `profiles.role IN ('admin','super_admin')`; backs 28 policies | Authorization | `RolesGuard` | `users.role` (JWT claim) | 🔵 |
| `release_expired_reservations` | Cron every 5 min, **35,309 no-op runs**; targets an unreachable status | Reservation expiry | **Do not port.** Design deliberately or drop. | — | 🔵 Unimplemented spec, not behaviour |
| `handle_new_user` | Profile provisioning | Registration | Explicit, in the registration transaction | — | 🔵 |
| `handle_updated_at` | 5 of 28 tables (the only 5 with the column) | Timestamps | Mongoose `timestamps: true`, applied **uniformly** | — | 🔵 |
| `adjust_product_stock` | **Does not exist** — Phase 0 listed it as dead; it was never created. `product.provider.ts:121` would fail | — | Nothing to port | — | 🔵 |

---

## 4. Triggers & automation → explicit service logic

| Trigger (verified) | Business purpose | Future NestJS responsibility | Risk |
|---|---|---|---|
| `on_auth_user_created` → `handle_new_user` | Auto-create profile | Explicit user creation; preserve `full_name → email` fallback and `role='customer'` default | 🔵 |
| `set_updated_at_*` (5 tables) | Timestamps | Mongoose `timestamps` on **all** collections | 🔵 Fixes the current 5-of-28 inconsistency |
| **Absent:** rating rollup | — | `ReviewsService` maintains `products.rating` on approve/reject/delete | 🟡 Fixes ratings-always-zero |
| **Absent:** stock/ledger consistency | — | `InventoryService` is the **only** writer of stock; every change writes a ledger row | 🟠 Today any direct UPDATE bypasses the ledger |
| **Absent:** order-status history on direct UPDATE | — | `OrdersService` is the only writer of status | 🟡 |
| **Absent:** audit logging | — | Audit interceptor | 🟠 |
| `pg_cron` reservation job | Reservation expiry | `@nestjs/schedule` job **only if** reservations are implemented | 🔵 |
| `storage.protect_delete` | Blocks SQL deletion of objects | N/A — Cloudinary SDK | 🔵 Migration scripts must use the Storage API |

---

## 5. Storage → Cloudinary

| Supabase capability | Actual current implementation (VERIFIED) | Business purpose | Future responsibility | Cloudinary responsibility | Risk |
|---|---|---|---|---|---|
| Bucket `products` (public, 5 MB, jpeg/png/webp) | **2 objects, 204 KB**; path `<productId>/<sanitised-name>`; absolute public URLs stored in `product_images.url` | Product images | `UploadsModule`: guard + MIME allow-list + magic bytes + size + sharp | `nest/products/<productId>/…`; store `publicId`+`version`+dimensions | 🔵 **Downgraded from 🟠 (R5).** Two files. |
| Buckets `avatars`, `blog`, `reviews` | **Provisioned, policied, 0 objects, no upload UI** | — | Build only if the corresponding feature is approved | — | 🔵 Nothing to migrate |
| Bucket `images` (dead `StorageService`) | **Does not exist** | — | Delete the code | — | 🔵 |
| `product_images.url` | **20 of 22 rows are `placehold.co`**; 2 are real Storage URLs; 63 of 85 products have no image | Gallery | Store `publicId`, never a URL | Remote-fetch upload for the 2 real files | 🔵 Do **not** copy placeholders |
| Image metadata | `size` + `mimetype` only — **no width/height** | Rendering | Capture dimensions at upload | `width`/`height`/`bytes`/`format` | 🔵 Fixes CLS (P16) |
| Transformations | **None** | — | Named transforms `t_product_card` / `t_product_detail` / `t_thumb` | Cloudinary | 🔵 |
| Delete | URL string-split; **no delete policy** on 3 of 4 buckets | Remove image | Domain operation; refcount-aware | `destroy` by `publicId` | 🟡 Fixes W2/W4 |

---

## 6. Data model → MongoDB

**Live volume: ≈200 business rows across 28 tables; 12 tables entirely empty.**

| Current | Rows | Future collection | Rationale | Risk |
|---|---|---|---|---|
| `auth.users` + `profiles` + `addresses` | 4 + 4 + 1 | **`users`** (addresses embedded) | 1:1 merge removes the trigger; addresses bounded | 🔵 |
| `products` + `product_images` + `product_attribute_values` + `product_tags` + `product_variants` + `product_compatibility` | 85 + 22 + 0 + 0 + 0 + 0 | **`products`** (all embedded) | **EAV tables are entirely empty** — redesign is unconstrained by data | 🔵 |
| `categories` | 27 (17 roots, 10 children, depth 2) | **`categories`** + materialised `path[]` | Shallow tree; fixes the missing-subtree bug | 🔵 |
| `brands` | 17 | **`brands`** | | 🔵 |
| `attributes` + `attribute_values` | 9 + 0 | **`attributes`** (values embedded) | | 🔵 |
| `orders` + `order_items` + `order_status_history` | 10 + 7 + 8 | **`orders`** (all embedded, immutable) | Point-in-time contract | 🟡 3 orders have totals but no items — migrate verbatim |
| `carts` + `cart_items` | 2 + 4 | **`carts`** (items embedded **with price snapshots**) | **Do not migrate rows** — ephemeral and price-less | 🔵 |
| `inventory_transactions` | 7 | **`inventoryTransactions`** | Add synthetic opening balances so `Σ ledger = onHand` | 🟡 |
| `reviews` + `review_images` + `review_votes` | 0 + 0 + 0 | **`reviews`** — only if the feature is approved | Nothing to migrate | 🔵 |
| `coupons` | 0 | **`coupons`** — only if approved | Nothing to migrate | 🔵 |
| `blog_posts` | 6 | **`blogPosts`** | | 🔵 |
| `admin_audit_logs` | **0** | **`auditLogs`** | **Nothing to migrate — audit has never worked.** Start fresh | 🔵 |
| `slug_redirects` | 0 | **`slugRedirects`** | Must actually be **read** | 🔵 |
| `notifications`, `recently_viewed`, `wishlists` | 0, 0, 0 | Conditional / drop | No feature exists | 🔵 |
| `numeric(10,2)` money | — | **DECIDE:** integer minor units (piastres) vs Decimal128 | Blocks schema authoring | 🟠 |
| UUID PKs | — | Keep as `_id` **strings** | No ID map needed | 🔵 |
| `*_ar` columns | **100% NULL on all 85 products** | **DECIDE:** commit to i18n or drop | Evidence now exists | 🔵 |

### Index requirements carried over

Live statistics justify: `users{email}`, `products{slug}`/`{sku}`/`{isActive,deletedAt,category.id}`/`{isActive,isFeatured}`, `categories{slug}`/`{path}`, `brands{slug}`, `orders{orderNumber}`/`{userId,placedAt}`/`{shippingAddress.phone}`, `inventoryTransactions{productId,createdAt}`, `reviews{productId,status}`.

**Deliberately dropped:** `order_items(order_id)`, `order_status_history(order_id)`, `product_images(product_id)`, `addresses(user_id)` — all four become embedded arrays. Notably these are exactly the four **missing** indexes causing sequential scans today (`product_images`: 51,128 seq scans), so embedding fixes a real performance defect rather than merely relocating it.

---

## 7. Other Supabase services

| Service | Exists? | Used? | Migration requirement |
|---|---|---|---|
| **Realtime** | Publication `supabase_realtime` exists | **No — 0 tables published** | None |
| **Edge Functions** | **No** — `supabase_functions` schema absent, no `supabase/functions/` dir | No | None |
| **Database webhooks** | **No** — `pg_net`/`http` extensions not installed | No | None |
| **Scheduled jobs** | **Yes** — `pg_cron` v1.6.4, 1 job | Yes, but a **no-op** | Do not port as-is |
| **GraphQL** (`pg_graphql`) | Installed (platform default) | No | None |
| **Vault** | Installed (platform default) | No | None |
| **`pg_stat_statements`** | Installed | Diagnostics only | Replace with APM |

---

## 8. Application layer

| Current | Future | Risk |
|---|---|---|
| 15 Server Actions | REST endpoints under a single response envelope | 🟡 |
| 3 route handlers (`/api/attributes`, `/api/check-slug`, `/auth/callback`) | `GET /attributes`, `GET /products/slug-available`, NestJS OAuth callback (if OAuth is built) | 🔵 |
| **4 browser→DB surfaces** (profile, addresses, order tracking, `useAuth`) | REST endpoints — **rewrites, not repoints** | 🟠 R8 |
| `packages/providers` (Supabase) | Generated typed OpenAPI client | 🟡 |
| `packages/repositories` interfaces | Port to NestJS repository interfaces | 🔵 Most valuable existing asset |
| `@nest/types` Zod schemas | Seed DTOs (`nestjs-zod` or class-validator) | 🔵 |
| Both `proxy.ts` files | `JwtAuthGuard` + `RolesGuard` | 🟠 |
| Raw PostgREST errors returned to clients | Global exception filter, RFC 7807 | 🟡 |

---

## 9. Risk register — updated by live evidence

| Phase 0 risk | Original | **Now** | Why it changed |
|---|---|---|---|
| **R1** — undocumented `_v2` RPCs | 🔴 Critical / High probability | 🔴 **Critical / probability reduced** | **Fully recovered and specified.** Risk shifts from *discovery* to *correct reimplementation* — mitigated by the differential tests in `baseline-test-cases.md` |
| **R2** — RLS → guards | 🔴 Critical / High | 🟠 **High** | Policies fully extracted (52) and translated in §2. Traceability table still required |
| **R3** — password migration | 🟠 High / Medium | 🔵 **Low** | **bcrypt `$2a$` hashes are portable — no forced reset.** RESOLVED |
| **R5** — image migration | 🟠 High / Medium | 🔵 **Low** | **2 files, 204 KB** |
| **R6** — order/stock integrity | 🔴 Critical / Medium | 🔵 **Low** | 10 orders, no referential corruption, exact reconciliation figures captured |
| **R8** — 4 client-side rewrites | 🟠 High / High | 🟠 **High** | Unchanged — still rewrites |
| **R9** — pre-existing defects misattributed | 🟡 Medium / High | 🔵 **Low** | `baseline.md` lists 20 known-broken features |
| **R11** — MongoDB replica set | 🟠 High / Low | 🟠 **High (unchanged)** | Order creation is genuinely transactional — confirmed |
| **R14** — exposed secrets | 🟠 High / Medium | 🔴 **Critical** | The documented Supabase PAT is already revoked (HTTP 401) — **evidence that credential exposure has had real consequences**. The DB password and service-role key remain live |
| **R15** — zero tests | 🟠 High / Certain | 🟠 **High (unchanged)** | 103 specified cases now exist, but none implemented |
| **NEW — F-CRIT-1** | — | 🔴 **Critical** | Four `SECURITY DEFINER` RPCs granted to `anon` with no authz. **Not a migration risk — a live production vulnerability.** |

---

## 10. Sequencing implications

Phase 0.5 changes the recommended order in three ways:

1. **The F-CRIT-1 RPC exposure must be remediated immediately**, independently of the migration. It is a four-statement `REVOKE` plus an authorization check in each function. Waiting for Phase 6 leaves an unauthenticated write path open for months.
2. **Phase 3 (MongoDB) can start earlier than planned.** The data model is now unconstrained by data — the EAV tables are empty, `*_ar` is 100% NULL, and 12 of 28 tables have no rows.
3. **Phase 10 (data migration rehearsals) can be compressed.** ~200 rows and 2 files, with zero referential corruption. The elaborate ETL pipeline in Phase 0 §22 is over-engineered for this dataset; a single idempotent script with the §MG-01 reconciliation assertions is sufficient.

**Unchanged:** Phases 4 (auth/authz) and 6 (commerce core) remain the highest-effort, highest-risk work — but both are now *specified* rather than *unknown*.
