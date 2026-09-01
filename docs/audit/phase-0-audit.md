# PHASE 0 — ARCHITECTURE & MIGRATION AUDIT
## Nest Electronics

| | |
|---|---|
| **Repository** | `D:\eng-mina\nest-electronics` |
| **Audit date** | 2026-08-27 |
| **Basis** | Working tree at commit `dc7768b` (+111 uncommitted changes) |
| **Method** | 100% static inspection. No database connection, no build, no type-check, no runtime observation. |
| **Scope** | Read-only. No file was created, modified, renamed or deleted during the audit; no dependency installed. |
| **Secrets** | No secret value is reproduced in this document — names, file paths and line numbers only. |

**Legend**

- `FACT` — directly observed in a file
- `INFERENCE` — derived with reasoning
- `RECOMMENDATION` — proposal
- `UNKNOWN` — cannot be determined from the repository

---

# 1. Executive Summary

## 1.1 What the application does

`FACT` A two-app Egyptian B2C e-commerce platform for electronics/embedded-systems components (Arduino, ESP32, sensors, modules), Cash-on-Delivery only, English-only, in a pnpm + Turborepo monorepo:

- **`apps/storefront`** — customer store: catalog browse, search, product detail, guest cart, 3-step checkout, account (orders/profile/addresses), guest order tracking, blog, contact.
- **`apps/admin`** — admin dashboard mounted at `basePath: '/admin'`: dashboard KPIs, products CRUD + image upload, categories, brands, inventory, orders, coupons, customers, reviews moderation, audit log, settings (stub).
- **6 shared packages**: `@nest/ui`, `@nest/types`, `@nest/config`, `@nest/repositories`, `@nest/providers`, `@nest/services`.

## 1.2 Current architecture

`FACT` Next.js 16.2.4 / React 19.2.4 App Router, Turbopack, Tailwind v4, Zustand v5, nuqs v2, Zod v3, lucide-react. Backend is **Supabase only** — Auth, PostgreSQL (28 tables), Storage. No ORM; the Supabase JS SDK is called directly. No NestJS, no MongoDB, no Redis, no Cloudinary, no payment provider, no email provider, no analytics, no error tracking.

The repo *documents* a layered architecture (`AGENTS.md`, `.project_plan/PROJECT_OVERVIEW.md` §3):
`Pages → Services → Repositories (interfaces) → Providers (Supabase)`.

`FACT` **That layering is only partially real.** It is honoured for product/category/brand reads on the storefront. It is bypassed for: all admin writes (Server Actions call `supabase.from(...)` directly), checkout (`supabase.rpc('create_order_v2')` directly), wishlist, account profile/addresses (browser → Supabase directly), order tracking (browser → Supabase directly), blog (`BlogService` takes a raw `SupabaseClient`, not a repository).

## 1.3 Where business logic actually lives

`FACT` It is spread across **five** layers with no single source of truth:

| Location | Examples |
|---|---|
| **Database (PostgreSQL RPC)** — the real core | `create_order_v2` (pricing, stock, order number), `update_order_status_v2`, `adjust_stock_v2`, `search_products` |
| **Server Actions** | order status-transition matrices (`apps/admin/src/actions/order.actions.ts:35-51`), Zod validation, audit logging, slug redirects, product duplication |
| **Shared services package** | `CartService` quantity capping, `OrderService.createOrderFromCart` totals (**dead code — never invoked**), `BlogService` |
| **Client components / Zustand stores** | cart totals (`CheckoutStepper.tsx:44`, `CartDrawer.tsx:14`), stock capping (`cart-store.ts:98-102`), order-tracking phone check (`orderTrackingStore.ts:57-64`), "rate limiting" (`orderTrackingStore.ts:29`) |
| **RLS policies** | `UNKNOWN` — not in the repository |

## 1.4 How authentication works

`FACT` Supabase Auth (email+password, Google OAuth), cookie-based sessions via `@supabase/ssr`. Sign-in/sign-up/sign-out/reset are all executed **in the browser** with the anon key. Route protection uses Next.js 16 `proxy.ts` (the renamed middleware convention) in both apps. Roles live in `public.profiles.role` (`customer` | `admin` | `super_admin`), checked server-side by `requireAdmin()` using the **service-role** key.

## 1.5 How data is stored

`FACT` Supabase PostgreSQL, 28 tables, all-`text` status columns (no PG enums), soft deletes via `deleted_at`, tri-status orders, a normalized EAV attribute system, an inventory ledger with `reserved_quantity`. Zero views, zero materialized views declared in the generated types.

## 1.6 How files/images are handled

`FACT` Two conflicting conventions:

- Admin product images: browser → Server Action (FormData) → `supabase.storage.from('products').upload(...)` → public URL persisted into `product_images.url` (`apps/admin/src/actions/product.actions.ts:76-91`).
- `packages/services/src/storage.service.ts` uses a **different bucket, `'images'`**, with a different path scheme — and is **never called anywhere**.

Category images, brand logos, blog covers, review images and avatars are plain URL text fields with no upload UI (`UNKNOWN` how they are populated; the seed data and `public/images/**` suggest static files).

## 1.7 Major architectural strengths

1. `FACT` Real monorepo with clean package boundaries and a repository-interface layer (`packages/repositories`) — the *shape* of a portable domain layer already exists.
2. `FACT` Domain types, Zod schemas and enums are centralised in `@nest/types` and shared by both apps — directly reusable as NestJS DTO/validation seeds.
3. `FACT` Critical write paths (order creation, order status, stock adjustment) were already pushed into **atomic database functions**, so transactional intent is documented and recoverable.
4. `FACT` Admin mutations consistently follow `requireAdmin()` → Zod → mutate → `logAdminAction()` — a coherent, auditable pattern.
5. `FACT` Order model is mature: tri-status (`order_status`/`payment_status`/`fulfillment_status`), an append-only `order_status_history`, immutable `order_items` price snapshots.
6. `FACT` Server Components are the default for catalog pages; secrets are not leaked into client bundles (only `NEXT_PUBLIC_*` reach the browser).

## 1.8 Major architectural weaknesses

1. `FACT` **The most important business logic is not in this repository.** `create_order_v2`, `update_order_status_v2`, `adjust_stock_v2` are invoked but never defined here, and are absent from the generated `Database` type. Their behaviour must be extracted from the live database before migration.
2. `FACT` **No migrations, no `supabase/` directory, no SQL files.** The schema exists only as a generated TypeScript type and as an aspirational plan document. RLS policies, triggers, indexes and constraints are unverifiable from the repo.
3. `FACT` **Type drift is already causing broken writes** — code writes `updated_at` to `categories`/`brands` and `user_agent` to `admin_audit_logs`; none of those columns exist in the generated types.
4. `FACT` **Direct browser→database access on 4 surfaces** (profile, addresses, order tracking, auth-profile hydration). Every one of these is a hard blocker for the REST migration and is enforced solely by RLS.
5. `FACT` **Guest order tracking reads the full `orders` row into the browser and checks the phone number client-side.**
6. `FACT` **The persisted cart is write-only.** `syncCartToDatabase` writes on login; nothing ever reads it back. The cart of record is `localStorage`.
7. `FACT` **Search/listing is functionally degraded**: `search_products` returns 12 scalar columns with no images, brand, category or rating, and takes no sort argument — so every product grid renders imageless, brand-less, unsorted, and the `count` used for pagination is taken from an already-paginated RPC result.
8. `FACT` **Zero tests, zero CI/CD, zero Docker, zero deployment config, zero error tracking, zero rate limiting.**
9. `FACT` **A live Anthropic API key is committed to git** in `apps/admin/src/test.md`.
10. `FACT` Significant dead surface: 7 tables never touched, 2 duplicate components, 5 unused components, 3 unused Server Actions, an empty component file, unused service/provider methods.

## 1.9 Major migration risks

| # | Risk | Why |
|---|---|---|
| R1 | Undocumented DB functions hold the real checkout/inventory logic | Must be reverse-engineered from production before any port |
| R2 | Authorization model is invisible (RLS not in repo) | NestJS guards cannot be specified without it |
| R3 | Password migration | Supabase `auth.users` hashes are not accessible via the app; forced reset may be required |
| R4 | Direct client→Supabase surfaces | Four features must be rebuilt as REST endpoints, not merely repointed |
| R5 | Relational integrity → document model | 28 tables with 39 FKs collapsing into ~13 collections; the EAV attribute system needs a deliberate redesign |
| R6 | Storage URL rewrite | `product_images.url` stores absolute Supabase URLs; every one must be re-hosted and rewritten |
| R7 | Silent pre-existing bugs become "regressions" | Several features are already broken; without a baseline, post-migration testing will misattribute them |

## 1.10 Overall assessment

| Dimension | Rating | Justification |
|---|---|---|
| **Architecture maturity** | **Medium-Low** | Package structure, DI-by-constructor and a repository interface layer are genuinely good (Medium+). But no migrations, no tests, no CI, no schema source of truth, business logic in five places, and multiple broken write paths pull it down. |
| **Migration complexity** | **High** (not Very High) | Small surface (≈24 routes, 15 Server Actions, 3 route handlers), only ~11.5k LOC of admin + ~7.3k LOC of storefront app code, a single external dependency (Supabase), and a pre-existing repository-interface seam. Elevated to High — not Medium — by the missing DB functions, unknown RLS, auth migration, and 4 direct-client surfaces. |
| **Backend extraction difficulty** | **Moderate for the domain layer; Hard for the data/auth layer** | `packages/repositories` + `packages/services` + `@nest/types` port to NestJS with modest effort. The hard 70% is: recovering the 3 `_v2` RPCs, reproducing RLS as guards/policies, migrating Supabase Auth identities, and converting the relational schema to documents. |

---

# 2. Complete Application Map

## 2.1 Storefront routes (`apps/storefront/src/app`)

| Route | File | Rendering | Auth | Data sources | Business logic | Migration notes |
|---|---|---|---|---|---|---|
| `/` | `page.tsx` | RSC, `revalidate=3600` (ineffective, §11.3) | Public | `productService.getCategoryTree/getFeaturedProducts/getNewArrivals/getAllBrands` | `toDTO` mapping | → `GET /categories/tree`, `/products?featured`, `/products?sort=newest`, `/brands` |
| `/products` | `products/page.tsx` | RSC, `force-dynamic` | Public | `search_products` RPC + category tree + brands | URL→filter mapping, active-filter chips, price range from **current page only** | → `GET /products` with real server-side sort/facets |
| `/products/[slug]` | `products/[slug]/page.tsx` | RSC, `force-dynamic` | Public | `products` + `product_images` + `categories` + `brands` + `product_attribute_values` join | DTO mapping, JSON-LD, related products | → `GET /products/:slug`; reviews tab is a **static stub** |
| `/categories` | `categories/page.tsx` | RSC, `revalidate=3600` | Public | `getCategoryTree` | Tree build in JS | → `GET /categories/tree` |
| `/categories/[slug]` | `categories/[slug]/page.tsx` | RSC, `force-dynamic` | Public | category by slug + `search_products` | subcategory chips | → `GET /categories/:slug/products` |
| `/brands/[slug]` | `brands/[slug]/page.tsx` | RSC, `force-dynamic` | Public | brand by slug + `search_products` | — | → `GET /brands/:slug/products` |
| `/search` | `search/page.tsx` | RSC, `force-dynamic` | Public | `search_products` | — | Duplicates `/products` logic |
| `/blog` | `blog/page.tsx` | RSC, `revalidate=3600` | Public | `blog_posts` ×3 queries | filter/pagination | 3 sequential queries → 1 endpoint |
| `/blog/[slug]` | `blog/[slug]/page.tsx` | RSC, `revalidate=3600` | Public | `blog_posts` + `profiles` join | related posts | → `GET /blog/:slug` |
| `/checkout` | `checkout/page.tsx` | **Client** | Proxy-protected | Zustand cart | Empty-cart guard | Client component under an auth-gated route |
| `/wishlist` | `wishlist/page.tsx` | **Client** | **Public** (not in `protectedRoutes`) | **localStorage only** | — | Renders `Product #<uuid>`; **broken feature** |
| `/order-tracking` | `order-tracking/page.tsx` | RSC shell + client store | Public | **Browser → `orders` table directly** | Phone match client-side | **Security-critical rewrite** |
| `/contact` | `contact/page.tsx` | **Client** | Public | **none** | `setTimeout(1000)` fake submit | No backend exists |
| `/login`, `/register`, `/forgot-password` | `*/page.tsx` + `form.tsx` | RSC shell + client form | Redirects if authed | Supabase Auth (browser) | Zod validation client-side | → `POST /auth/*` |
| `/auth/callback` | `auth/callback/route.ts` | Route Handler | Public | `exchangeCodeForSession` | — | → NestJS OAuth callback |
| `/account` | `account/page.tsx` | RSC | Proxy | — | redirect → `/account/orders` | — |
| `/account/orders` | `account/orders/page.tsx` | RSC, `force-dynamic` | Proxy + `getUser()` | `orders` + `order_items` | **No pagination** — fetches all | → `GET /orders?page=` |
| `/account/orders/[id]` | `account/orders/[id]/page.tsx` | RSC, `force-dynamic` | Proxy + `.eq('user_id', user.id)` | `orders`+`order_items`+`order_status_history` | Ownership filter in the query | Ownership must become a guard |
| `/account/profile` | `account/profile/page.tsx` | **Client** | Proxy | **Browser → `profiles`** | Trim/require name | **Direct-client rewrite** |
| `/account/addresses` | `account/addresses/page.tsx` | **Client** | Proxy | **Browser → `addresses`** (CRUD) | `is_default` on first address; set-default does **not** unset others | **Direct-client rewrite** |
| `/sitemap.xml`, `/robots.txt` | `sitemap.ts`, `robots.ts` | RSC | Public | products/categories/brands | `limit: 5000` in one call | Blog URLs missing from sitemap |

**Layout/system files:** `layout.tsx` (Navbar + Footer + CartDrawer + MobileBottomNav + `ToastProvider` + `NuqsAdapter`), `template.tsx`, `loading.tsx`, `error.tsx`, `global-error.tsx`, `not-found.tsx`, and per-route `loading.tsx` for products/search/categories/brands/blog/account.

### Dead / unreachable / suspicious in storefront

`FACT`

- `components/CartSync.tsx` — **0 bytes**, imported nowhere.
- `components/home/BlogSection.tsx`, `CategoryCircles.tsx`, `PromoBanner.tsx`, `RecommendedProducts.tsx` — 0 importers. `RecommendedProducts` renders **hardcoded laptop dummy data** (`Xiaomi RedmiBook`, `ASUS ROG`) in a store that sells microcontrollers.
- `components/ThemeToggle.tsx` — 0 importers, though `ui-store.ts` implements full theme state.
- `actions/wishlist.actions.ts` (`toggleWishlistItem`, `getWishlist`) and `actions/cart.actions.ts#getCart` — **0 call sites**.
- `ROUTES.cart = '/cart'`, `ROUTES.compare = '/compare'`, `/vendors`, `/about`, `/faq`, `/account/notifications` — referenced in `packages/config/src/constants.ts` nav arrays; **no such routes exist** → live 404 links in the header/footer.
- `git status` shows the entire `(shop)` and `(auth)` route groups deleted and re-created as flat routes; **`(shop)/layout.tsx` was deleted and never replaced**, so shop pages now render directly under the root layout.

## 2.2 Admin routes (`apps/admin/src/app`, basePath `/admin`)

| Route | File | Auth | Data sources | Business logic | Notes |
|---|---|---|---|---|---|
| `/` (dashboard) | `(dashboard)/page.tsx` | proxy + `requireAdmin()` | `getDashboardStats()` — 8 parallel queries | Revenue sum, low-stock, top-products aggregation **all in JS** | Loads up to 500 `order_items` + all orders' statuses per page view |
| `/products` | `(dashboard)/products/page.tsx` | ✔ | `products` + joins, `getProductStats()` (5 count queries) | filters | Embedded-resource filter bug (§15 P21) |
| `/products/new`, `/products/[id]/edit` | — | ✔ | product + categories + brands | `ProductForm` (770 LOC) | Slug uniqueness via `/api/check-slug` |
| `/categories`, `/brands` | — | ✔ | cached tree/list | Stats in JS | `CategoriesManager` 527 LOC, `BrandsManager` 464 LOC |
| `/inventory` | — | ✔ | `products` + `getInventoryStats()` + `getInventoryTransactions(10)` | Low-stock in JS over **all** products | — |
| `/orders`, `/orders/[id]` | — | ✔ | `orders` + `orderService.getOrderById` | Date-range presets; `OrderDetail` drives transitions | — |
| `/coupons` | — | ✔ | `coupons` ×5 | Expiry filter | **Coupons are never consumable by customers** |
| `/customers` | — | ✔ | `profiles` + `orders` ×4 | Per-customer order aggregation in JS | — |
| `/reviews` | — | ✔ | `reviews` ×6 | Moderation | **No storefront review submission or display exists** |
| `/audit-log` | — | ✔ | `admin_audit_logs` ×4 | — | Table is fed by an insert that likely fails (§8 B32) |
| `/settings` | — | ✔ | none | — | `"Settings panel coming in Phase 7."` |
| `/login`, `/unauthorized` | — | public | Supabase Auth (browser) | — | — |
| `GET /api/attributes` | route handler | **proxy only** | `attributes` + `attribute_values` | — | No in-handler authz |
| `GET /api/check-slug` | route handler | **proxy only** | `products` | — | No in-handler authz |

### Dead / duplicated in admin

`FACT`

- `components/audit/AuditLogTable.tsx` (213 LOC) — **0 importers**; superseded by `components/audit-log/AuditLogTable.tsx` (315 LOC).
- `AdminHeader.tsx:26-30` — notifications dropdown is backed by `mockNotifications` hardcoded fake data while a real `notifications` table sits unused.
- `apps/admin/src/test.md` — a shell snippet containing a live API key, shipped inside `src/`.

## 2.3 Shared packages

| Package | Contents | Status |
|---|---|---|
| `@nest/types` | `database.ts` (1426 LOC generated), `domain.ts`, `enums.ts`, `schemas.ts` (Zod), `dtos.ts` | Active. `domain.ts` declares `BlogPost`/`BlogFilters` **twice** (lines 249/297 and 270/313) |
| `@nest/config` | `constants.ts` (ROUTES, governorates, nav), `env.ts`, `tailwind.preset.ts` | `env.ts` is **never imported** — its startup validation never runs |
| `@nest/repositories` | 6 interface files | Active as types; `IAttributeRepository` has **no implementation** |
| `@nest/providers` | 6 Supabase providers + browser client singleton | Partially used: product **write** methods, `adjustStock`, `SupabaseAuthProvider`, `SupabaseStorageProvider`, `SupabaseCartProvider.getCartBySession`, `SupabaseOrderProvider.create/update*` are all **unreferenced** |
| `@nest/services` | Product/Cart/Order/Search/Storage/Blog | `OrderService` and `StorageService` are **entirely dead**; `CartService` used only by `syncCartToDatabase` |
| `@nest/ui` | 23 primitives (Radix + CVA) | Active. `product-card.tsx` uses raw `<img>` (lines 94, 181), not `next/image` |

---

# 3. Feature Inventory

## 3.1 Core features

### F1 — Product catalogue & discovery

- **Purpose:** browse/filter/search products. **Roles:** public.
- **Frontend:** `/products`, `/categories`, `/categories/[slug]`, `/brands/[slug]`, `/search`, `/`, `FilterSidebar.tsx`, `ProductCard.tsx`.
- **Backend:** `ProductService` → `SupabaseProductProvider` → `search_products` RPC + direct `products` selects.
- **Tables:** `products`, `product_images`, `categories`, `brands`, `attributes`, `attribute_values`, `product_attribute_values`.
- **Storage:** `product_images.url` → public Supabase Storage URLs. **Auth:** none. **External:** none.
- **Business rules:** `available_stock = stock_quantity - reserved_quantity` (`product.provider.ts:127-131`); only `is_active AND deleted_at IS NULL`; category tree built in JS (`product.provider.ts:153-165`).
- **Known issues:** `FACT` list pages have no images/brand/rating because `search_products` doesn't return them; `FACT` sort is ignored; `INFERENCE` pagination totals are wrong; `FACT` attribute filtering is not implemented in the UI despite the EAV schema; `FACT` `findBestSelling` orders by non-existent `avg_rating`.
- **Migration complexity:** **Medium** (must rebuild search + facets properly).

### F2 — Cart

- **Frontend:** `cart-store.ts` (Zustand + localStorage), `CartDrawer`, `AddToCartButton`, `QuantitySelector`, `CartButton`, `MobileBottomNav`.
- **Backend:** `syncCartToDatabase` Server Action → `CartService.mergeGuestCart` → `carts`/`cart_items`.
- **Rules:** max qty 99 (defined **twice**: `cart-store.ts:5` and `@nest/config/constants.ts:11`); qty capped to `available_stock`; merge takes `existing + incoming` in the provider but `Math.max` in the store (`cart-store.ts:147`) — **two contradictory merge strategies**.
- **Known issues:** `FACT` cart is **write-only** server-side; `FACT` `CartService.mapToCart` sums `item.price`, but `cart_items` has **no price column**, so any server-side cart subtotal is always 0; `FACT` no `/cart` page though `ROUTES.cart` exists.
- **Migration complexity:** **Medium-High** (needs a real server cart with price snapshots).

### F3 — Checkout & order placement

- **Frontend:** `CheckoutStepper.tsx` (3 steps), `checkout/page.tsx`.
- **Backend:** `createOrderAction` → **`supabase.rpc('create_order_v2', ...)`** with `p_user_id`, `p_items`, `p_shipping_address`, `p_payment_method`, `p_shipping_fee: 0`; then a read-back sanity check on `orders`.
- **Rules:** login required; Egyptian phone regex (`schemas.ts:24`); COD only; shipping fee hardcoded `0`; **prices sent by the client are discarded** — the RPC prices server-side (good); RPC error strings mapped to "Product not available" (`checkout.actions.ts:7-14`).
- **Known issues:** `UNKNOWN` — the entire pricing/stock/order-number logic is inside an RPC not present in the repo; `FACT` no coupon application; `FACT` no saved-address selection; `FACT` no tax; `FACT` `OrderService.createOrderFromCart` is a competing, dead implementation with `discount = 0; shipping_fee = 0` hardcoded.
- **Migration complexity:** **Very High** — highest-risk item in the project.

### F4 — Authentication

See §4. **Migration complexity: Very High.**

### F5 — Customer account

- Orders list/detail (RSC, ownership via `.eq('user_id', ...)`), profile (client→DB), addresses (client→DB CRUD).
- **Known issues:** `FACT` orders list unpaginated; `FACT` set-default-address doesn't unset siblings server-side; `FACT` profile uses `upsert` on `profiles` from the browser.
- **Migration complexity:** **Medium** (mechanical, but 2 direct-client surfaces).

### F6 — Guest order tracking

- `order-tracking/page.tsx` → `OrderTracker` → `orderTrackingStore.fetchOrder` → **browser** selects `orders` embedding `order_items` and `order_status_history`, filtered by `order_number` only; the phone is then compared **in JS** (`orderTrackingStore.ts:57-64`).
- **Known issues:** `FACT` full order (incl. address + phone) is transferred to the browser before the phone check; `FACT` "rate limit" is in-memory client state (`attempts >= 5`), trivially bypassed by reload; `FACT` tracking number is never stored or displayed.
- **Migration complexity:** **Medium** (rewrite as one guarded endpoint) — **Security priority: High.**

## 3.2 Secondary features

| Feature | Status | Evidence |
|---|---|---|
| **Wishlist** | **Broken/duplicated.** localStorage store + a page listing `Product #<uuid>`; Server Actions writing to `wishlists` exist but are never called; `WishlistButton` takes no props yet PDP passes `productId`. | `wishlist-store.ts`, `wishlist/page.tsx:57`, `WishlistButton.tsx:9`, `products/[slug]/page.tsx:254` |
| **Blog** | Working, read-only. No authoring UI anywhere. | `blog.service.ts`, `blog/**` |
| **Reviews** | **Admin-only.** Moderation queue + stats exist; storefront has a static "Reviews" tab with no fetch and no submit form. | `reviews/page.tsx`, `products/[slug]/page.tsx:289-292` |
| **Coupons** | **Admin-only.** Full CRUD; zero customer-facing redemption. `orders.coupon_id` never populated. | `coupon.actions.ts`; grep "coupon" in storefront = 0 hits |
| **Contact** | **Fake.** Submit is a 1-second `setTimeout`, no network call. | `contact/page.tsx:27` |
| **SEO** | Working: JSON-LD (Product, Breadcrumb, Organization), sitemap, robots, canonical + OG. Blog omitted from sitemap. | `json-ld.ts`, `sitemap.ts` |
| **Theming** | Store + toggle implemented; toggle not mounted. | `ui-store.ts`, `ThemeToggle.tsx` |

## 3.3 Admin features

Products (CRUD, images, attributes, duplicate, soft-delete, status toggle, slug redirect), Categories, Brands, Inventory (adjust + ledger drawer), Orders (tri-status transitions), Coupons, Customers (read-only), Reviews (moderate/delete), Audit Log, Dashboard, Settings (stub). **Migration complexity: Medium** — well-structured, but every mutation must become a guarded REST endpoint.

## 3.4 Infrastructure features

`FACT` Structured JSON console logger with domain helpers (`lib/logger.ts` in both apps; storefront's carries a TODO to install `pino`). Audit logging (`log-action.ts`). Upload validation (`validate-upload.ts`: MIME + 5 MB + extension + filename sanitisation + path-traversal guard). Error boundaries. Zod validation. **No** rate limiting, caching layer, queue, cron, email, metrics or tracing.

## 3.5 Experimental / unfinished

`RecommendedProducts` (dummy laptops), `CartSync` (empty), `notifications`/`recently_viewed`/`product_variants`/`product_compatibility`/`product_tags`/`review_votes`/`review_images` tables (never touched), `slug_redirects` (written, never read), `IAttributeRepository` (no implementation), Settings page, `AdminHeader` mock notifications, `.prompts/` and `.project_plan/` planning docs, root-level one-off codemods (`fix_hero*.js`, `rewrite*.js`, `adjust_images.js`), `cinematic` (empty 0-byte file), `DESIGN copy.md` (byte-identical duplicate of `DESIGN.md`).

---

# 4. Authentication & Authorization Audit

## 4.1 Registration

`FACT` `apps/storefront/src/app/register/form.tsx:41` — **client-side** `supabase.auth.signUp` with `full_name` in user metadata. Zod `registerSchema` (min 8 chars, confirm match) validated **only in the browser** (`schemas.ts:10-18`).

`INFERENCE` A `handle_new_user` trigger must create the `profiles` row (nothing in app code does), because `profiles.full_name` is `NOT NULL` and `profiles.id` FKs `auth.users`. **`UNKNOWN` — trigger not in repo.**

`FACT` The form redirects straight to `/account/orders` after sign-up **without checking whether a session exists** — if email confirmation is enabled, the user is bounced back to `/login` by the proxy. `UNKNOWN` whether confirmation is on.

## 4.2 Login

`FACT` `login/form.tsx:38` — client `signInWithPassword`. On success, if the local cart is non-empty, `syncCartToDatabase` is called, then `router.push(redirectTo ?? '/account/orders')`.

`FACT` Google OAuth: `signInWithOAuth` with provider `google` and `redirectTo` = origin + `/auth/callback` (`login/form.tsx:66`, `register/form.tsx:63`). `UNKNOWN` whether the provider is enabled in the Supabase project.

`FACT` Admin login: `apps/admin/src/app/login/form.tsx:22` — identical mechanism, **no role check at login**; role enforcement happens on the next request in `proxy.ts`.

## 4.3 Logout

`FACT` Three separate client-side implementations: `hooks/useAuth.ts:83`, `admin/components/layout/Sidebar.tsx:19` (→ `router.push('/login')`), `admin/components/layout/AdminHeader.tsx:206` (→ `window.location.href = '/login'`, which **escapes the `/admin` basePath**). No server-side session invalidation.

## 4.4 Session / token / refresh

`FACT` Supabase GoTrue JWT (access + refresh) stored in cookies by `@supabase/ssr`. Server clients are built per request in `lib/supabase.ts` (both apps) with `getAll`/`setAll` cookie adapters; the storefront's `setAll` swallows the Server Component write error and relies on the proxy to refresh. Refresh is fully handled by the SDK. `UNKNOWN` — token TTLs are project settings, not in the repo.

## 4.5 Password handling & reset

`FACT` No password is ever handled by application code — it goes browser → Supabase Auth. Hashing/storage is Supabase's (`INFERENCE`: bcrypt in `auth.users.encrypted_password`).

`FACT` Reset: `forgot-password/form.tsx:33` → `resetPasswordForEmail(email, { redirectTo: origin + ROUTES.auth.callback + '?next=/account/profile' })`.

**`FACT` BUG — `ROUTES` in `packages/config/src/constants.ts` has no `auth` key.** `ROUTES.auth.callback` throws `TypeError: Cannot read properties of undefined` at submit. **Password reset is broken.** Additionally, `/auth/callback/route.ts` ignores the `next` param and always redirects to `/account/orders`; there is **no set-new-password page** anywhere.

## 4.6 Route protection

**Storefront — `apps/storefront/src/proxy.ts`**

`FACT` `protectedRoutes = ['/account','/checkout']`; `authRoutes = ['/login','/register','/forgot-password']`. All other paths short-circuit with no auth work. Uses **`supabase.auth.getSession()`** (line 55) — this decodes the cookie without revalidating against the auth server; Supabase's own guidance is to use `getUser()` on the server. `/wishlist` is **not** protected (contradicting `PROJECT_OVERVIEW.md` §5).

**Admin — `apps/admin/src/proxy.ts`**

`FACT` Everything except `/login`, `/unauthorized`, `/_next/*`, `/favicon*` requires: (1) `supabase.auth.getUser()` — correct, server-validated; (2) a **service-role** lookup of `profiles.role`, requiring `admin`/`super_admin`, else redirect `/unauthorized`. Matcher covers `/api/*`.

## 4.7 Server-side authorization

| Surface | Enforcement | File |
|---|---|---|
| All 15 admin Server Actions | `await requireAdmin()` first line | `lib/services.ts:17-34` |
| All admin pages | `await requireAdmin()` + proxy | `(dashboard)/**` |
| `/api/attributes`, `/api/check-slug` | **proxy only** — no in-handler check | `app/api/**/route.ts` |
| `createOrderAction` | `getUser()` null-check | `checkout.actions.ts:43` |
| `syncCartToDatabase`, `getCart`, `toggleWishlistItem`, `getWishlist` | `getUser()` null-check | `cart/wishlist.actions.ts` |
| Order detail ownership | `.eq('user_id', user.id)` in the query | `account/orders/[id]/page.tsx:39` |
| Profile / addresses / order-tracking | **none in app code — RLS only** | client components |

`FACT` `requireAdmin()` accepts both `admin` and `super_admin` identically. **There is no privilege separation anywhere** — `super_admin` is defined in `enums.ts`, the DB check constraint and `SupabaseAuthProvider.isAdmin`, but never distinguished in any authorization decision.

## 4.8 Client-side-only authorization

`FACT` `UserMenu.tsx:78` shows the "Admin Dashboard" link when `user.role` is admin — cosmetic only, the admin proxy re-checks. `FACT` `account/layout.tsx` renders the account chrome with no auth check of its own (the proxy covers it). `FACT` `orderTrackingStore.ts:61` — the **phone-number authorization check for guest order access runs in the browser**, after the data has already been delivered. `FACT` `wishlist/page.tsx` performs no auth at all.

## 4.9 Security risks (auth-specific)

| ID | Severity | Finding |
|---|---|---|
| A1 | **High** | Guest order lookup returns the whole order to any client that knows or guesses an order number; the phone gate is client-side. If RLS blocks anon `SELECT` on `orders`, the feature is instead simply broken. Order numbers are `NE-YYYYMMDD-NNNN` (sequential) → enumerable. |
| A2 | **Medium** | Storefront proxy uses `getSession()` instead of `getUser()`. |
| A3 | **Medium** | Admin `/api/*` handlers rely solely on the proxy matcher; a matcher change silently opens them. |
| A4 | **Medium** | Service-role Supabase client is a module-level singleton (`lib/supabase.ts:32`) used in `proxy.ts` and `requireAdmin()`; every admin request performs a full RLS-bypassing lookup. Correct today, but a single accidental client-side import would be catastrophic. |
| A5 | **Medium** | Password reset is broken (§4.5) and no password-update page exists. |
| A6 | **Low** | No password complexity beyond `min(8)`, no MFA, no lockout, no login rate limiting, no session revocation. |
| A7 | **Low** | Admin sign-out from the header leaves the admin app entirely. |
| A8 | **Info** | `profiles.role` is client-readable via `useAuth`; DB function `is_admin()` exists but is never called from app code. |

## 4.10 Mapping to the future NestJS model

| Today | NestJS target |
|---|---|
| Supabase GoTrue, browser-side | `AuthModule`: register / login / refresh / logout / forgot-password / reset-password, plus `GET /auth/me` |
| Cookie session managed by SDK | JWT access (~15 min) + rotating refresh token; httpOnly cookie for web, bearer for Flutter |
| `signInWithOAuth('google')` | `passport-google-oauth20` strategy + `GET /auth/google/callback` |
| Supabase-managed bcrypt | `bcrypt`/`argon2` in `UsersService`; hash never leaves the module |
| `proxy.ts` route matcher | `JwtAuthGuard` (global via `APP_GUARD`) + `@Public()` decorator |
| `requireAdmin()` | `RolesGuard` + `@Roles('admin','super_admin')`; introduce real `super_admin`-only routes |
| `.eq('user_id', user.id)` | `OwnershipGuard` / service-level `findOneForUser(id, userId)` |
| RLS row filters | Explicit `where` clauses in repositories + policy guards (CASL recommended) |
| Client-side phone check | `POST /orders/track` — server-side compare, generic error, rate-limited |
| No refresh-token revocation | `refreshTokens` collection or Redis denylist |

---

# 5. Supabase Dependency Audit

## 5.1 Usage inventory — AUTHENTICATION

| File | Function / Component | Operation | Client/Server | Business logic | Complexity |
|---|---|---|---|---|---|
| `storefront/app/register/form.tsx:41` | `RegisterForm.handleSubmit` | `auth.signUp` | **Client** | Zod validation | High |
| `storefront/app/login/form.tsx:38,66` | `LoginForm` | `signInWithPassword`, `signInWithOAuth` | **Client** | cart merge trigger | High |
| `storefront/app/forgot-password/form.tsx:33` | `ForgotPasswordForm` | `resetPasswordForEmail` | **Client** | — | Medium |
| `storefront/app/auth/callback/route.ts:17` | `GET` | `exchangeCodeForSession` | Server | — | Medium |
| `storefront/hooks/useAuth.ts:67,72,83` | `useAuth` | `getSession`, `onAuthStateChange`, `signOut` | **Client** | initials, role default | Medium |
| `storefront/proxy.ts:55` | `proxy` | `getSession` | Server (edge) | route guard | Medium |
| `storefront/app/{login,register}/page.tsx:15,11` | page | `getUser` | Server | redirect if authed | Low |
| `storefront/actions/*.ts` (5 sites) | actions | `getUser` | Server | authn gate | Low |
| `storefront/app/account/orders*/page.tsx` | page | `getUser` | Server | authn + ownership | Low |
| `storefront/app/account/{profile,addresses}/page.tsx` | page | `getSession` | **Client** | authn gate | Medium |
| `admin/app/login/form.tsx:22` | `LoginForm` | `signInWithPassword` | **Client** | — | High |
| `admin/proxy.ts:57` | `proxy` | `getUser` | Server | authn + role | High |
| `admin/lib/services.ts:19` | `requireAdmin` | `getUser` | Server | authz | High |
| `admin/components/layout/{Sidebar,AdminHeader}.tsx` | sign-out | `signOut` | **Client** | — | Low |

## 5.2 Usage inventory — DATABASE

28 tables; ~120 call sites across 30 files. Condensed by table:

| Table | Ops | Where | Client/Server | Complexity |
|---|---|---|---|---|
| `products` | select/insert/update | `product.provider.ts`, admin `product.actions.ts`, admin pages, `lib/services.ts`, `search.provider.ts` | Server | High |
| `product_images` | select/insert/update/delete | `product.actions.ts`, joins | Server | Medium |
| `product_attribute_values` | select/insert/delete | `product.actions.ts`, joins | Server | Medium |
| `categories`, `brands` | select/insert/update (soft-del) | `product.provider.ts`, `category-brand.actions.ts` | Server | Medium |
| `attributes`, `attribute_values` | select | `/api/attributes` | Server | Low |
| `orders` | select/insert/update | `order.provider.ts`, admin pages+actions, `account/orders*`, **`orderTrackingStore.ts:46`** | Server + **Client** | Very High |
| `order_items`, `order_status_history` | select/insert | providers, dashboards | Server | High |
| `carts`, `cart_items` | select/insert/update/delete | `cart.provider.ts` | Server | Medium |
| `profiles` | select/upsert | `auth.provider.ts`, `requireAdmin`, `proxy.ts`, customers page, **`useAuth.ts:35`**, **`account/profile/page.tsx:38,79`** | Server + **Client** | High |
| `addresses` | select/insert/update/delete | **`account/addresses/page.tsx` (client only)** | **Client** | High |
| `wishlists` | select/insert/delete | `wishlist.actions.ts` (**dead**) | Server | Low |
| `reviews` | select/update/delete | admin reviews | Server | Medium |
| `coupons` | select/insert/update/delete | admin coupons | Server | Medium |
| `inventory_transactions` | select | `inventory.actions.ts`, `lib/services.ts` | Server | Medium |
| `admin_audit_logs` | select/insert | `log-action.ts`, audit page | Server | Medium |
| `blog_posts` | select | `blog.service.ts` | Server | Low |
| `slug_redirects` | insert only | `product.actions.ts:525` | Server | Low |
| `notifications`, `recently_viewed`, `product_variants`, `product_tags`, `product_compatibility`, `review_images`, `review_votes` | **none** | — | — | **Zero** |

## 5.3 Usage inventory — STORAGE

| File | Operation | Bucket | Notes |
|---|---|---|---|
| `admin/actions/product.actions.ts:76,81` | `upload`, `getPublicUrl` | **`products`** | create path |
| `admin/actions/product.actions.ts:186,191` | `upload`, `getPublicUrl` | **`products`** | update path |
| `admin/actions/product.actions.ts:272` | `remove` | **`products`** | path derived by splitting the stored URL on `/products/` — brittle |
| `packages/services/storage.service.ts` + `providers/storage.provider.ts` | upload / getPublicUrl / deleteFile | **`images`** | **never invoked** |

## 5.4 Usage inventory — RPC

| RPC | Caller | In generated types? | Notes |
|---|---|---|---|
| `search_products` | `product.provider.ts:43`, `search.provider.ts:10` | Yes | 8 args, returns 12 scalar cols, **no sort arg** |
| `create_order_v2` | `checkout.actions.ts:88` | **No** | **The entire checkout transaction** |
| `update_order_status_v2` | `order.actions.ts:78,130,182` | **No** | Status change + history + side effects |
| `adjust_stock_v2` | `inventory.actions.ts:33` | **No** | Stock + ledger |
| `adjust_product_stock` | `product.provider.ts:121` | **No** | **Never called** — dead |
| `generate_order_number`, `is_admin`, `release_expired_reservations` | — | Yes | **Never called from app code** |

## 5.5 Realtime / Edge Functions / Other

- **Realtime:** `FACT` **Not used.** Zero occurrences of `.channel(`, `.on(`, `subscribe(` on a Supabase client anywhere.
- **Edge Functions:** `FACT` **Not used.** No `supabase/functions/` directory, no `functions.invoke(`.
- **Other:** `FACT` Supabase Storage public URLs are whitelisted in both `next.config.ts` image `remotePatterns` — `**.supabase.co` for admin, and the literal project host for storefront (a hardcoded environment identifier in committed source).

## 5.6 Summary

- **Supabase Auth:** used for 100% of identity. 6 distinct browser-side auth calls, 2 proxy guards, ~10 server `getUser`/`getSession` calls. **Highest-coupling area.**
- **Supabase Database:** used for 100% of persistence. 28 tables, 21 actively touched, 7 dead. ~120 call sites across 30 files. 4 of them execute **in the browser**.
- **Supabase Storage:** used for product images only, bucket `products`, public URLs persisted into the DB. A second, unused abstraction targets a bucket named `images`.
- **Supabase RPC:** 4 functions called; **3 of the 4 are undocumented and hold the core transactional business logic**.
- **Supabase Realtime:** **Not used.**
- **Supabase Edge Functions:** **Not used.**
- **Custom wrappers:** `getSupabaseBrowserClient()` (`packages/providers/src/supabase/client.ts` — module-level singleton), `createClient()` (per-request SSR client, duplicated in both apps), `createAdminClient()` (service-role singleton, admin only), and the 6 provider classes.

---

# 6. Database Forensic Audit

## 6.1 Source-of-truth caveat

`FACT` The repository contains **no migrations, no `.sql` files, no `supabase/` directory, no seed DDL**. The only machine-derived schema artifact is `packages/types/src/database.ts` (byte-identical to `.project_plan/database.ts`), generated by `supabase gen types` against PostgREST v14.5. The DDL blocks in `.project_plan/plan_database_supabase_mcp.md` are a **plan**, and already diverge from the generated types.

Therefore: **column names/types/nullability = `FACT`**; **PKs, unique constraints, indexes, defaults, check constraints, triggers, RLS = `UNKNOWN`** except where the generated types or the plan imply them.

## 6.2 Table catalogue (28 tables)

| # | Table | Purpose | Important fields | Relationships | Used by | Migration complexity |
|---|---|---|---|---|---|---|
| 1 | `profiles` | User profile, extends `auth.users` | `id`, `full_name`(NN), `phone`, `avatar_url`, `role`(NN) | ← addresses, orders, carts, reviews, wishlists, blog_posts, notifications, audit, inventory_tx, order_status_history, recently_viewed, review_votes | `requireAdmin`, `proxy`, `useAuth`, profile page, customers page | **High** (merges with auth) |
| 2 | `addresses` | Saved shipping addresses | `user_id`, `label`, `full_name`, `phone`, `street`, `city`, `governorate`, `postal_code`, `is_default` | → profiles | addresses page (client) | **Low** → embed in user |
| 3 | `categories` | Self-referencing tree | `slug`, `name_en/ar`, `parent_id`, `image_url`, `sort_order`, `is_active`, `deleted_at` | → self; ← products | catalogue, admin | **Medium** (tree) |
| 4 | `brands` | Manufacturers | `slug`, `name_en/ar`, `logo_url`, `is_active`, `deleted_at` | ← products | catalogue, admin | **Low** |
| 5 | `products` | Catalogue core | `sku`, `slug`, `name_en/ar`, `description_*`, `base_price`, `sale_price`, `cost_price`, `stock_quantity`(NN), `reserved_quantity`(NN), `low_stock_threshold`, `weight`, `dimensions`(Json), `is_active`, `is_featured`, `seo_*`, `deleted_at` | → categories, brands; ← 8 tables | everywhere | **High** |
| 6 | `product_images` | Gallery | `product_id`, `url`, `alt_text`, `sort_order`, `is_primary` | → products | PDP, admin | **Low** → embed |
| 7 | `product_variants` | Variants | `product_id`, `name`, `sku`, `price_modifier`, `stock_quantity`, `reserved_quantity`, `attributes`(Json), `is_active` | → products; ← cart_items, order_items, inventory_tx | **NONE** | **Low** (dead) |
| 8 | `product_tags` | Tag junction | `product_id`, `tag` | → products | **NONE** | **Low** (dead) |
| 9 | `attributes` | EAV definitions | `slug`, `name_en/ar`, `type`, `unit`, `is_filterable`, `is_comparable`, `sort_order`, `category_ids`(uuid[]) | ← attribute_values, PAV | `/api/attributes` | **Medium** |
| 10 | `attribute_values` | Allowed values | `attribute_id`, `value_en/ar`, `sort_order` | → attributes | joins | **Low** → embed |
| 11 | `product_attribute_values` | EAV assignment | `product_id`, `attribute_id`, `attribute_value_id`, `custom_value` | → products, attributes, attribute_values | PDP, admin | **Medium** → embed |
| 12 | `product_compatibility` | "works with" graph | `product_id`, `compatible_product_id`, `compatibility_type`, `notes` | → products ×2 | **NONE** | **Low** (dead) |
| 13 | `carts` | Cart header | `user_id`, `session_id` | → profiles; ← cart_items | `cart.provider` (write-only) | **Medium** |
| 14 | `cart_items` | Cart lines | `cart_id`, `product_id`, `variant_id`, `quantity`(NN) | → carts, products, variants | `cart.provider` | **Medium** — **no price column** |
| 15 | `orders` | Order header | `user_id`, `order_number`, `order_status`(NN), `payment_status`(NN), `fulfillment_status`(NN), `subtotal`(NN), `discount`, `shipping_fee`, `tax`, `total`(NN), `coupon_id`, `shipping_address`(Json NN), `billing_address`(Json), `payment_method`, `payment_provider_id`, `notes` | → profiles, coupons; ← items, history | checkout, account, admin, **browser tracking** | **Very High** |
| 16 | `order_items` | Immutable lines | `order_id`, `product_id`, `variant_id`, `name`, `sku`, `price`, `quantity`, `total` | → orders, products, variants | order views, dashboard | **Low** → embed |
| 17 | `order_status_history` | Audit trail | `order_id`, `field`, `from_value`, `to_value`, `changed_by`, `notes` | → orders, profiles | order detail, activity feed | **Low** → embed |
| 18 | `coupons` | Discounts | `code`, `type`, `value`, `min_order`, `max_discount`, `usage_limit`, `used_count`, `starts_at`, `expires_at`, `is_active` | ← orders | admin only | **Low** |
| 19 | `inventory_transactions` | Stock ledger | `product_id`, `variant_id`, `type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_by` | → products, variants, profiles | inventory admin | **Medium** |
| 20 | `reviews` | Product reviews | `user_id`, `product_id`, `rating`(NN), `title`, `comment`, `is_verified_purchase`, `moderation_status`, `helpful_count` | → profiles, products; ← images, votes | admin only | **Medium** |
| 21 | `review_images` | Review photos | `review_id`, `url`, `sort_order` | → reviews | **NONE** | **Low** (dead) |
| 22 | `review_votes` | Helpfulness | `user_id`, `review_id`, `is_helpful` | → profiles, reviews | **NONE** | **Low** (dead) |
| 23 | `wishlists` | Saved products | `user_id`, `product_id` | → profiles, products | dead actions only | **Low** |
| 24 | `recently_viewed` | View history | `user_id`, `session_id`, `product_id`, `viewed_at` | → profiles, products | **NONE** | **Low** (dead) |
| 25 | `blog_posts` | CMS | `author_id`, `title_en/ar`, `slug`, `content_en/ar`, `excerpt`, `cover_image`, `category`, `tags`(text[]), `is_published`, `published_at`, `deleted_at` | → profiles | blog | **Low** |
| 26 | `notifications` | In-app notifications | `user_id`, `type`, `title`, `message`, `data`(Json), `is_read` | → profiles | **NONE** | **Low** (dead) |
| 27 | `slug_redirects` | SEO 301s | `entity_type`, `old_slug`, `new_slug` | — | insert-only | **Low** |
| 28 | `admin_audit_logs` | Admin audit | `admin_id`, `action`, `entity_type`, `entity_id`, `changes`(Json), `ip_address`(inet) | → profiles | `log-action`, audit page | **Medium** |

## 6.3 Types, keys, constraints, enums

- `FACT` All 39 declared foreign keys are enumerated in the `Relationships` blocks of `database.ts`; every one is `isOneToOne: false`. The `profiles.id → auth.users` link does not appear (cross-schema).
- `FACT` **Zero PostgreSQL enum types** (`Enums: { [_ in never]: never }`). Every status is `text`; the value sets live in `packages/types/src/enums.ts` and (per the plan) in DB `CHECK` constraints.
- `FACT` **Zero views and zero materialized views** (`Views: { [_ in never]: never }`).
- `INFERENCE` PKs are `id uuid default gen_random_uuid()` everywhere except `product_tags` (`product_id,tag`) and `review_votes` (`user_id,review_id`) — both lack an `id` in the generated Row type, consistent with composite PKs.
- `INFERENCE` Unique constraints (from the plan + application behaviour): `products.sku`, `products.slug`, `categories.slug`, `brands.slug`, `product_variants.sku`, `attributes.slug`, `orders.order_number`, `coupons.code`, `blog_posts.slug`, `(cart_id,product_id,variant_id)`, `(product_id,attribute_id)`, `(user_id,product_id)` on reviews and wishlists, `(entity_type,old_slug)`. **`UNKNOWN` whether all were actually applied.**
- `FACT` Non-nullable of note: `products.stock_quantity`, `products.reserved_quantity`, `orders.{order,payment,fulfillment}_status`, `orders.shipping_address`, `orders.subtotal`, `orders.total`, `profiles.full_name`, `profiles.role`, `cart_items.quantity`.
- `UNKNOWN` Defaults, `CHECK` constraints (e.g. `stock_quantity >= reserved_quantity`), triggers (`updated_at`, `handle_new_user`, rating rollup), indexes, `pg_cron` jobs.

## 6.4 Database-level business logic

`FACT` Four RPCs are invoked from app code; three are **absent from the generated type**, meaning they were created after the last type generation or live in a non-public schema.

| Function | Signature as called | What it must do (`INFERENCE`) |
|---|---|---|
| `create_order_v2(p_user_id, p_items, p_shipping_address, p_payment_method, p_shipping_fee)` | returns a row with `.id` | Validate product active + stock, price server-side, compute subtotal/discount/total, generate order number, insert `orders` + `order_items`, adjust `reserved_quantity`, write `inventory_transactions` — all in one transaction. Raises errors matched by `/insufficient stock/i` and similar patterns. |
| `update_order_status_v2(p_order_id, p_field, p_new_value, p_admin_id, p_notes, p_tracking_number?)` | returns `{success, error}` | Update the status column, insert `order_status_history`, likely release/commit stock. **`p_tracking_number` has no destination column in `orders`.** |
| `adjust_stock_v2(p_product_id, p_quantity, p_reason, p_admin_id, p_reference_type)` | returns `{success, error, newStock}` | Update `products.stock_quantity`, insert `inventory_transactions`. |
| `adjust_product_stock(p_product_id, p_delta, p_reserved_delta)` | void | Legacy; **no caller**. |

`FACT` Declared-but-uncalled: `generate_order_number()`, `is_admin()`, `release_expired_reservations()`. `UNKNOWN` whether a `pg_cron` job invokes `release_expired_reservations` — the 30-minute reservation-expiry rule described in `plan_business_logic.md` §4 has **no application-side implementation**.

## 6.5 MongoDB collection candidates (analysis, not a design)

**Do not map 1 table → 1 collection.** Analysis by relationship shape:

**Embed** (child is bounded, never queried independently, always loaded with the parent):

- `addresses` → `users.addresses[]` (bounded ~1–10; only ever read for one user)
- `product_images` → `products.images[]` (≤8 enforced in `ProductImageUpload.tsx:26`)
- `product_attribute_values` + attribute/value names → `products.attributes[]` (denormalised `{slug, name, value, unit}` — enables display and multikey-index filtering in one read)
- `product_tags` → `products.tags[]`
- `product_variants` → `products.variants[]` (bounded; currently unused)
- `order_items` → `orders.items[]` (**immutable snapshot** — the strongest embedding case in the system)
- `order_status_history` → `orders.statusHistory[]` (append-only, bounded by workflow length)
- `cart_items` → `carts.items[]`
- `review_images` → `reviews.images[]`
- `attribute_values` → `attributes.values[]`

**Reference** (unbounded, independently queried, or many-to-many):

- `products.categoryId` / `brandId` — reference **plus** a denormalised `{id, slug, name}` snapshot to avoid a `$lookup` on every product card
- `orders.userId`, `reviews.{userId, productId}`, `inventory_transactions.productId`
- `categories.parentId` + a materialised `path`/`ancestors[]` array (Mongo has no recursive CTE; `$graphLookup` is expensive for a nav tree read on every page)
- `product_compatibility` — many-to-many self-reference → keep as `products.compatibility[]` (bounded in practice) or a small join collection

**One-to-one:** `profiles` ↔ `auth.users` → **merge into a single `users` document**.

**High-read aggregates → denormalise:**

- `reviews` → `products.rating {avg, count, histogram}` maintained on write (currently `avg_rating`/`review_count` are read by the UI but **do not exist** in the DB — this fixes a real bug)
- `order_items` → `products.salesCount` for the dashboard's "top products", which today aggregates 500 rows in JS on every page load
- Cart/order line items → embed `{name, sku, price, imageUrl}` snapshots

**Transactional data** (needs multi-document transactions): order placement — order insert + product stock decrement + ledger insert. This **requires a replica set / Atlas** — a hard infrastructure constraint.

**Immutable historical data** (append-only, archivable): `inventory_transactions`, `admin_audit_logs`, `order_status_history`, `slug_redirects`, `recently_viewed`.

**Indexing requirements** derived from actual query patterns: see §19.

---

# 7. RLS & Database Security Audit

## 7.1 UNKNOWN — the critical gap

`FACT` **No RLS policy is defined anywhere in this repository.** The only artifact is the intent matrix in `.project_plan/plan_database_supabase_mcp.md` (reproduced below), which is a plan, not verified state.

> **`UNKNOWN` — requires clarification.** Before Phase 1, run against the live database:
> `select schemaname, tablename, rowsecurity from pg_tables where schemaname='public';`
> `select * from pg_policies where schemaname='public';`
> plus `pg_indexes`, `pg_trigger`, `information_schema.check_constraints`, and `pg_get_functiondef` for the four RPCs.

## 7.2 Planned policy matrix (from `plan_database_supabase_mcp.md`)

| Table | Anon | Auth (own) | Admin |
|---|---|---|---|
| `profiles` | — | read/update own | full |
| `products` / `categories` / `brands` | read active | read active | full CRUD |
| `carts` | — | own only | read |
| `orders` | — | own only | full |
| `reviews` | read approved | create/edit own | full + moderate |
| `wishlists` | — | own only | — |
| `admin_audit_logs` | — | — | read + create |
| `inventory_transactions` | — | — | full |

## 7.3 Behaviour the code *requires* of RLS

| Table | Required for the app to work | Conflict with the plan |
|---|---|---|
| `orders` | `orderTrackingStore.ts:46` runs as **anon or any authenticated user** and selects by `order_number` alone | **Direct contradiction.** Plan says "own only" / no anon. **Either the feature is dead, or a permissive policy was added and any user can read any order.** |
| `orders`, `order_items`, `profiles`, `order_status_history`, `admin_audit_logs`, `inventory_transactions`, `reviews`, `coupons` | Every admin dashboard read uses the **user-scoped anon-key client** (`getCachedClient`), not the service-role client | Requires broad admin `SELECT` policies keyed on `is_admin()` |
| `products`, `product_images`, `product_attribute_values`, `categories`, `brands`, `coupons`, `slug_redirects`, `reviews` | Admin **writes** also use the user-scoped client | Requires admin `INSERT/UPDATE/DELETE` policies |
| `admin_audit_logs` | `log-action.ts` inserts with the user-scoped client | Requires admin `INSERT` |
| `profiles` | `useAuth.ts:35` selects own profile from the **browser**; `account/profile` **upserts** from the browser | `upsert` needs both INSERT and UPDATE policies. An INSERT policy on `profiles` lets a user forge a row; the `role` column must be protected by a column-level rule or trigger, else **a user could self-escalate to `admin`** |
| `addresses` | Full CRUD from the **browser** | Requires all four verbs scoped to `auth.uid()` |
| `wishlists` | Server-side only (dead code) | Fine |

## 7.4 Dangerous / inconsistent patterns

| ID | Severity | Finding |
|---|---|---|
| P1 | **Critical (pending verification)** | Anon/any-user `SELECT` on `orders` implied by the tracking store. If present → full order + PII disclosure by order-number enumeration. |
| P2 | **High (pending verification)** | Browser `upsert` on `profiles` — if the UPDATE policy does not exclude the `role` column, **privilege escalation to admin is possible from the browser**. |
| P3 | **High** | Authorization is **split** between RLS (invisible) and app code (`requireAdmin`). Two independent systems must agree; nothing tests that they do. |
| P4 | **Medium** | Admin reads go through the anon-key client while `requireAdmin`'s role lookup goes through service-role. If an admin RLS policy is dropped, pages silently render **empty** rather than erroring. |
| P5 | **Medium** | `admin_audit_logs` writes are RLS-dependent **and** silently swallowed on failure (§8 B32) — the audit trail can be empty with no signal. |
| P6 | **Medium** | Service-role key present in `apps/storefront/.env.local` although the storefront never uses it. |
| P7 | **Low** | `is_admin()` exists in the DB but no app code calls it; policies presumably do, so role logic is duplicated in SQL and TypeScript. |

## 7.5 Conceptual translation to NestJS

| Current RLS intent | NestJS equivalent |
|---|---|
| `products`: anon reads active only | Public controller; repository always applies `{isActive:true, deletedAt:null}`; a separate `@Roles('admin')` route returns everything |
| `orders`: user reads own | `JwtAuthGuard` + `OrdersService.findForUser(userId, id)`; **never** accept a raw `userId` from the request body |
| `orders`: admin full | `@Roles('admin')` on `/admin/orders/*` |
| `profiles`: update own, role immutable | `PATCH /users/me` with a whitelisted DTO (`fullName`, `phone`, `avatarUrl`); `role` only via `PATCH /admin/users/:id/role` guarded by `@Roles('super_admin')` |
| `addresses`: own only | Sub-resource of `/users/me/addresses`; userId taken from the JWT |
| `reviews`: read approved, write own | Public list filters `status:'approved'`; review creation requires auth **and** a verified-purchase check; moderation under `@Roles('admin')` |
| `carts`: own only | `/cart` bound to JWT subject or a signed guest-cart cookie |
| `admin_audit_logs`: admin read, system write | Written by an interceptor/service, **never** by the request principal; read-only admin endpoint |
| `inventory_transactions`: admin only | `@Roles('admin')`; writes only from `InventoryService`, never from a controller DTO |
| Guest order tracking | `POST /orders/track` — server-side compare, generic 404, **rate-limited** |

`RECOMMENDATION` Use CASL (`@casl/ability`) with a `PoliciesGuard` so the ability definitions become the single readable replacement for the RLS matrix, and are unit-testable.

---

# 8. Business Logic Audit

| # | Rule | Where implemented | Classification | Notes |
|---|---|---|---|---|
| B1 | `available_stock = stock_quantity − reserved_quantity` | `product.provider.ts:127-131`, `search.provider.ts:22`, `admin/lib/services.ts:148,263`, admin products/inventory pages | **Duplicated** (5×) | Must become one computed field |
| B2 | Effective price = `sale_price ?? base_price` | `CheckoutStepper.tsx:44,72`, `CartDrawer.tsx:14,64`, `products/[slug]/page.tsx:229`, `ProductCard` | **Frontend-only** (4×) | Server ignores client prices at checkout (good) but no server-side price formatter exists |
| B3 | Cart subtotal | `CheckoutStepper.tsx:44`, `CartDrawer.tsx:14`, `CartService.mapToCart:54` | **Duplicated** (frontend + dead service) | Service version always yields 0 (no price in `cart_items`) |
| B4 | Order totals (`subtotal − discount + shipping`) | **`create_order_v2` (DB)**; dead duplicate in `OrderService:11-14` | **Database-side** + dead duplicate | **`UNKNOWN` actual formula** |
| B5 | Discount = 0, shipping = 0, tax = 0 | `OrderService:12-13` (dead), `checkout.actions.ts:97` (`p_shipping_fee: 0`) | **Hardcoded** | No shipping-cost model exists |
| B6 | Coupon validation | **Nowhere.** Algorithm specified in `plan_business_logic.md` §7 | **Not implemented** | Admin can create coupons that can never be used |
| B7 | Order number `NE-YYYYMMDD-XXXX` | `generate_order_number()` (DB) | **Database-side** | Sequential → enumerable |
| B8 | Order status transition matrix | `admin/actions/order.actions.ts:35-51` | **Server-side** | Read-then-write, **not atomic** → TOCTOU race with concurrent admins |
| B9 | Status change side effects (history, stock) | `update_order_status_v2` (DB); duplicate in `order.provider.ts:52-74` | **Database-side + duplicated dead code** | Provider version is non-atomic |
| B10 | Order convenience workflows (`confirmOrder`/`shipOrder`/`deliverOrder`/`cancelOrder`) | `OrderService:49-66` | **Dead** | Bypasses the transition matrix entirely |
| B11 | Stock adjustment + ledger | `adjust_stock_v2` (DB) | **Database-side** | `UNKNOWN` |
| B12 | Inventory reservation + 30-min expiry | Planned only; `release_expired_reservations()` exists but nothing calls it | **Unknown/absent** | Stock may be permanently reserved by abandoned orders |
| B13 | Max cart qty 99 | `cart-store.ts:5,50`, `constants.ts:11`, `CartService:19,36`, `cartItemSchema.max(99)` | **Duplicated** (4 constants) | |
| B14 | Qty capped at available stock | `cart-store.ts:98-102`, `QuantitySelector max` | **Frontend-only** | Server relies on the RPC |
| B15 | Cart merge strategy | `cart.provider.ts:118` (`existing + incoming`) vs `cart-store.ts:147` (`Math.max`) vs plan (`Math.max`) | **Duplicated & contradictory** | |
| B16 | Guest order phone authorization | `orderTrackingStore.ts:57-64` | **Frontend-only** | Security defect |
| B17 | Client order-tracking rate limit | `orderTrackingStore.ts:29` | **Frontend-only** | In-memory, reset on reload |
| B18 | Admin authorization | `requireAdmin()` + `proxy.ts` + **RLS** | **Server + Database (duplicated)** | |
| B19 | Product/coupon/category/brand validation | Zod in `@nest/types/schemas.ts` and inline in each action; **also** in DB CHECKs | **Duplicated (server + DB)** | Coupon schema exists **twice** with different rules: `schemas.ts:80` (`value.positive()`, `code.min(3)`) vs `coupon.actions.ts:10` (`value.min(0)`, `code.min(1)`) |
| B20 | Upload validation (MIME/size/ext/filename) | `admin/lib/upload/validate-upload.ts` **and** `ProductImageUpload.tsx:33-41` | **Duplicated (client + server)** | Correctly duplicated |
| B21 | Slug uniqueness | `/api/check-slug` | **Server-side (advisory)** | Race-prone; real guarantee is the DB unique index |
| B22 | Slug redirect on rename | `product.actions.ts:512-543` writes `slug_redirects` | **Server-side, write-only** | **Nothing ever reads it** — no 301 handler exists |
| B23 | First address becomes default | `addresses/page.tsx:157` | **Frontend-only** | |
| B24 | Set-default address | `addresses/page.tsx:186-200` sets `true`, never unsets others | **Frontend-only, incorrect** | Multiple defaults possible |
| B25 | Primary image = first uploaded; only one primary | `product.actions.ts:89,200,384-395` | **Server-side** | Two-statement non-atomic update |
| B26 | Product duplication (slug/SKU suffix, inactive, copy images/attrs) | `product.actions.ts:412-510` | **Server-side** | Uses a 4-char base-36 timestamp suffix — collision-prone |
| B27 | Soft delete semantics | product/category/brand actions + every read filter | **Duplicated (server + provider)** | |
| B28 | Dashboard KPIs (revenue, low stock, top products, status breakdown) | `admin/lib/services.ts:73-203` — **all in JavaScript** | **Server-side, in-memory** | Won't scale (§15) |
| B29 | Review moderation | `review.actions.ts` | **Server-side** | No storefront counterpart |
| B30 | `is_verified_purchase` | **Nowhere** | **Not implemented** | Column exists, filter exists in admin |
| B31 | Rating aggregation (`avg_rating`, `review_count`) | Read by 6 UI mappers; **no such columns and no computation** | **Missing** | Always renders 0 |
| B32 | Audit logging | `log-action.ts` | **Server-side, silently failing** | Inserts `user_agent` (no such column); `insert()` returns an error object rather than throwing, so the `catch` never fires |
| B33 | Notifications on status change | Planned; **not implemented** | **Absent** | `notifications` table unused |

**Summary:** Frontend-only rules: **9** (B2, part of B3, part of B5, B14, B16, B17, B23, B24, plus price display). Server-side: **12**. Database-side: **5** (the most important ones). Duplicated: **10**. Missing/unknown: **7**.

---

# 9. File & Image Storage Audit

## 9.1 Current workflows

**W1 — Product image upload (the only real workflow)**

1. `ProductImageUpload.tsx` — client validates type (`jpeg|png|webp`), size (≤5 MB), count (≤8), builds preview URLs, supports drag-reorder and primary selection; passes `File[]` up to `ProductForm`.
2. `ProductForm` appends files to `FormData` under `images` and submits to `createProductAction`/`updateProductAction`.
3. Server Action: `requireAdmin()` → `validateUpload(file)` (MIME + size + extension + `sanitizeFilename`, which strips path separators, replaces non-alphanumerics, and appends a timestamp) → `generateStoragePath(productId, name)` (regex-guards `productId`).
4. `supabase.storage.from('products').upload(path, file)` (**user-scoped client**, so subject to Storage RLS).
5. `getPublicUrl(path)` → **absolute URL persisted** into `product_images.url`.
6. `sort_order` = loop index; `is_primary` = index 0 (create) / only when no existing images (update).

**W2 — Delete:** `deleteProductImageAction` derives the storage key by splitting the stored URL on `/products/` — `FACT` fragile: it splits on the **first** occurrence, and the Supabase public URL contains `/storage/v1/object/public/products/<path>`, so this works today but breaks if the bucket is renamed or a product path itself contains that segment. Storage removal is not verified, and the DB row is deleted regardless → orphaned objects on failure.

**W3 — Reorder / set primary:** `reorderProductImagesAction` issues **one UPDATE per image in a loop**; `setPrimaryImageAction` issues two sequential UPDATEs (unset-all, then set-one) with no transaction.

**W4 — Product duplication:** copies **URL strings only** — the duplicate shares the original's storage objects. Deleting an image from either product breaks the other. `FACT` real data-integrity defect.

**W5 — Dead abstraction:** `StorageService`/`SupabaseStorageProvider` target bucket `images` with a different path scheme. Never invoked.

**W6 — Non-uploadable media:** `categories.image_url`, `brands.logo_url`, `blog_posts.cover_image`, `profiles.avatar_url`, `review_images.url` are free-text URLs; admin forms accept a URL string (`categorySchema.image_url: z.string().url()`). `apps/storefront/public/images/**` holds 30+ static category/hero/banner assets committed to the repo.

## 9.2 Buckets, access control, transformations

- `FACT` Bucket in use: **`products`**. A second name, **`images`**, appears in dead code. `UNKNOWN` which buckets actually exist and whether they are public.
- `INFERENCE` The bucket must be **public** — `getPublicUrl()` is used and the URLs are rendered directly by `next/image`.
- `FACT` Access control on upload/delete is **entirely Storage RLS** (user-scoped client), never the service role. `UNKNOWN` what those policies are.
- `FACT` **No image transformations.** No Supabase `transform` options, no resizing, no format conversion. Optimisation relies solely on `next/image` — and `@nest/ui`'s `product-card.tsx` uses raw `<img>`, so the highest-traffic images are not optimised at all.
- `FACT` **No metadata** beyond `alt_text`, `sort_order`, `is_primary`. No width/height/bytes/mime/checksum → `next/image` cannot avoid CLS, and duplicate detection is impossible.
- `FACT` `dangerouslyAllowSVG: true` in **both** `next.config.ts` files, with `**.supabase.co` whitelisted in the admin config.

## 9.3 Recommended target (recommendation only)

```
Client (Next.js / Flutter)
   │  multipart/form-data  or  signed-upload-params request
   ▼
NestJS  UploadsModule
   ├─ AuthGuard + RolesGuard
   ├─ Multer memoryStorage, fileFilter (MIME allow-list), 5 MB limit
   ├─ magic-byte sniffing (file-type) — do NOT trust client MIME
   ├─ optional sharp: strip EXIF, cap dimensions, reject SVG entirely
   ▼
Cloudinary SDK ── upload_stream(folder: nest/products/<productId>,
                   public_id: <slug>-<nanoid>, overwrite:false,
                   resource_type:'image', invalidate:true)
   ▼
MongoDB  products.images[] = {
   publicId, version, format, width, height, bytes,
   alt, sortOrder, isPrimary, uploadedAt, uploadedBy
}
```

Key recommendations:

1. **Store `publicId` + `version`, never a full URL.** URLs are derived at read time (`f_auto,q_auto,w_<n>`), which makes CDN/account migration a config change instead of a data migration.
2. **Signed uploads for large files:** a signature endpoint returns short-lived Cloudinary params so the browser uploads directly, then a register endpoint records the returned `publicId` server-side. Keeps NestJS off the file path while retaining authorization.
3. **Named transformations** (`t_product_card` 400×400, `t_product_detail` 1000×1000, `t_thumb` 96×96) instead of ad-hoc URL params — one place to retune.
4. **Never accept SVG.** Remove `dangerouslyAllowSVG` at the same time.
5. **Delete is a domain operation:** remove from `images[]`, then destroy the Cloudinary asset; on failure enqueue for retry rather than orphaning.
6. **Duplication copies references, not objects** — but mark `sharedFrom` so deletion is refcounted, or explicitly copy the asset. This fixes W4.
7. **Reorder/primary become one atomic document update** (`$set images: [...]`), eliminating the N+1 update loop and the non-atomic primary flip.
8. Migration of existing assets: Cloudinary can fetch by remote URL, so the transfer is a single pass over `product_images` — see §22.

---

# 10. API & Communication Audit

## 10.1 HTTP route handlers (3)

| Method | Endpoint | Purpose | Auth | Input | Output | Supabase dep | Consumer |
|---|---|---|---|---|---|---|---|
| GET | `/admin/api/attributes?categoryId=` | Attributes for a category | proxy only | query `categoryId` | `{attributes: []}` | `attributes`+`attribute_values` | `AttributeEditor.tsx:67` |
| GET | `/admin/api/check-slug?slug=` | Slug availability | proxy only | query `slug` | `{exists: boolean}` | `products` | `ProductForm.tsx:181` |
| GET | `/auth/callback?code=` | OAuth/PKCE exchange | public | query `code` | 302 | `auth.exchangeCodeForSession` | Supabase redirect |

## 10.2 Server Actions (15 files' worth of exports)

| Action | File | Purpose | Auth | Input | Output | Supabase | Consumer |
|---|---|---|---|---|---|---|---|
| `createOrderAction` | `storefront/checkout.actions.ts` | Place order | `getUser` | FormData (address, method, items[]) | `{success, orderNumber?, orderId?, error?}` | `rpc create_order_v2` + `orders` | `CheckoutStepper` |
| `syncCartToDatabase` | `storefront/cart.actions.ts` | Merge guest cart | `getUser` | `CartItem[]` | `{success, error?}` | `carts`/`cart_items` | `LoginForm` |
| `getCart` | `storefront/cart.actions.ts` | Read cart | `getUser` | — | `Cart \| null` | `carts` | **none** |
| `toggleWishlistItem` | `storefront/wishlist.actions.ts` | Toggle | `getUser` | `productId` | `{success, isInWishlist?}` | `wishlists` | **none** |
| `getWishlist` | `storefront/wishlist.actions.ts` | List ids | `getUser` | — | `string[]` | `wishlists` | **none** |
| `createProductAction` | `admin/product.actions.ts` | Create + images + attrs | `requireAdmin` | FormData | `{success, productId?, error?}` | products, storage, images, PAV, audit | `ProductForm` |
| `updateProductAction` | ″ | Update | `requireAdmin` | FormData | ″ | ″ | `ProductForm` |
| `softDeleteProductAction` | ″ | Soft delete | `requireAdmin` | `productId` | ″ | products, audit | `ProductForm`, `ProductTable` |
| `toggleProductStatusAction` | ″ | Activate/deactivate | `requireAdmin` | `productId, isActive` | ″ | products, audit | `ProductTable` |
| `duplicateProductAction` | ″ | Clone | `requireAdmin` | `productId` | ″ | products, images, PAV, audit | `ProductForm`, `ProductTable` |
| `deleteProductImageAction` | ″ | Delete image | `requireAdmin` | `imageId, productPath` | `{success, error?}` | storage, images, audit | `ProductImageUpload` |
| `reorderProductImagesAction` | ″ | Reorder | `requireAdmin` | `productId, orders[]` | ″ | images, audit | `ProductImageUpload` |
| `setPrimaryImageAction` | ″ | Set primary | `requireAdmin` | `productId, imageId` | ″ | images, audit | `ProductImageUpload` |
| `createSlugRedirectAction` | ″ | 301 record | `requireAdmin` | `old, new, entityType` | ″ | slug_redirects, audit | `ProductForm` |
| `createCategoryAction` / `updateCategoryAction` / `softDeleteCategoryAction` | `category-brand.actions.ts` | Category CRUD | `requireAdmin` | FormData / id | `{success, categoryId?, error?}` | categories, audit | `CategoriesManager` |
| `createBrandAction` / `updateBrandAction` / `softDeleteBrandAction` | ″ | Brand CRUD | `requireAdmin` | ″ | ″ | brands, audit | `BrandsManager` |
| `createCouponAction` / `updateCouponAction` / `toggleCouponActiveAction` / `deleteCouponAction` | `coupon.actions.ts` | Coupon CRUD | `requireAdmin` | FormData / id | ″ | coupons, audit | `CouponsTable` |
| `updateOrderStatusAction` / `updatePaymentStatusAction` / `updateFulfillmentStatusAction` | `order.actions.ts` | Status transitions | `requireAdmin` | ids + status + notes | `{success, error?}` | orders, `rpc update_order_status_v2`, audit | `OrderDetail`, `OrdersTable` |
| `adjustStockAction` | `inventory.actions.ts` | Stock adjust | `requireAdmin` | FormData | `{success, newStock?, error?}` | `rpc adjust_stock_v2`, audit | `InventoryAdjustDialog` |
| `getInventoryTransactionsAction` | ″ | Ledger page | `requireAdmin` | `productId, page, limit` | `{success, data, total, …}` | inventory_transactions | `InventoryTransactionDrawer` |
| `updateReviewStatusAction` / `deleteReviewAction` | `review.actions.ts` | Moderation | `requireAdmin` | FormData / id | `{success, error?}` | reviews, audit | `ReviewsTable` |

## 10.3 Direct browser→database "endpoints" (no API at all)

`profiles` select/upsert · `addresses` select/insert/update/delete · `orders` + `order_items` + `order_status_history` select by order_number · all `auth.*` calls.

## 10.4 Findings

- `FACT` **Response formats are inconsistent**: `{success, error}` (most), `{success, productId}`, `{success, couponId}`, `{success, categoryId}`, `{success, newStock}`, `{success, data, total, page, limit, totalPages}`, bare `Cart | null`, bare `string[]`, `{attributes: []}`, `{exists: boolean}`. Errors are sometimes a Zod message string, sometimes a raw PostgREST message, sometimes `'Internal server error'`.
- `FACT` **Raw database errors are returned to the client** in ~20 places (e.g. `product.actions.ts:58,159`, `coupon.actions.ts:52`, `addresses/page.tsx:126`) → schema/constraint names leak to the UI.
- `FACT` **Missing validation**: `toggleProductStatusAction`, `softDeleteProductAction`, `duplicateProductAction`, `deleteProductImageAction`, `reorderProductImagesAction`, `setPrimaryImageAction`, `deleteCouponAction`, `toggleCouponActiveAction`, `softDeleteCategoryAction`, `softDeleteBrandAction`, `deleteReviewAction` accept **unvalidated string ids** (no UUID check). They are admin-gated, so impact is low, but it is inconsistent with the actions that do validate.
- `FACT` `deleteProductImageAction(imageId, productPath)` takes a caller-supplied `productPath` and feeds it to `revalidatePath` — an admin-controlled cache-invalidation primitive.
- `FACT` **Duplicated APIs**: `/products` vs `/search` (same query, two pages); `syncCartToDatabase` vs `CartService.addItem`; `order.provider` status methods vs `update_order_status_v2`; two coupon Zod schemas; two `AuditLogTable`s.
- `FACT` **Client-direct database access** on 4 surfaces (§5).
- `FACT` **Hidden Server Actions**: 3 exported actions with zero call sites are still compiled into the bundle and remain **remotely invocable** via the Server Action protocol.
- `FACT` **No versioning, no OpenAPI/Swagger, no documented contract, no pagination convention, no correlation IDs, no rate limiting.**

## 10.5 Proposed public NestJS REST surface

**Public / customer**

```
POST   /auth/register              POST /auth/login          POST /auth/refresh
POST   /auth/logout                POST /auth/forgot-password
POST   /auth/reset-password        GET  /auth/google         GET  /auth/google/callback
GET    /auth/me

GET    /products        ?q&category&brand&minPrice&maxPrice&inStock&attr[]&sort&page&limit
GET    /products/:slug             GET /products/:slug/related
GET    /products/suggest?q=
GET    /categories                 GET /categories/tree      GET /categories/:slug
GET    /brands                     GET /brands/:slug
GET    /attributes?categoryId=

GET    /cart                       POST /cart/items          PATCH /cart/items/:itemId
DELETE /cart/items/:itemId         DELETE /cart              POST  /cart/merge

POST   /coupons/validate           { code, subtotal } -> { valid, discount, reason? }
POST   /checkout/quote             { items[], governorate, couponCode? } -> price breakdown

POST   /orders                     (idempotency-key header)
GET    /orders                     GET /orders/:id
POST   /orders/track               { orderNumber, phone }   [rate-limited]

GET    /users/me                   PATCH /users/me
GET    /users/me/addresses         POST /users/me/addresses
PATCH  /users/me/addresses/:id     DELETE /users/me/addresses/:id
POST   /users/me/addresses/:id/default

GET    /wishlist                   POST /wishlist/:productId   DELETE /wishlist/:productId

GET    /products/:id/reviews       POST /products/:id/reviews
POST   /reviews/:id/helpful

GET    /blog                       GET /blog/:slug           GET /blog/categories  GET /blog/tags
POST   /contact
GET    /health                     GET /health/ready
```

**Admin (`/admin/*`, `@Roles('admin','super_admin')`)**

```
GET|POST|PATCH|DELETE /admin/products[/:id]
POST /admin/products/:id/duplicate         PATCH /admin/products/:id/status
POST /admin/products/:id/images            DELETE /admin/products/:id/images/:imageId
PATCH /admin/products/:id/images/order     PATCH /admin/products/:id/images/:imageId/primary
GET|POST|PATCH|DELETE /admin/categories[/:id]
GET|POST|PATCH|DELETE /admin/brands[/:id]
GET|POST|PATCH|DELETE /admin/coupons[/:id]
GET  /admin/orders                         GET /admin/orders/:id
PATCH /admin/orders/:id/status             PATCH /admin/orders/:id/payment-status
PATCH /admin/orders/:id/fulfillment        (accepts trackingNumber)
GET  /admin/inventory                      POST /admin/inventory/:productId/adjust
GET  /admin/inventory/:productId/transactions
GET  /admin/customers                      GET /admin/customers/:id
GET  /admin/reviews                        PATCH /admin/reviews/:id/status   DELETE /admin/reviews/:id
GET  /admin/audit-logs
GET  /admin/dashboard/stats                (single aggregated endpoint)
GET|POST|PATCH|DELETE /admin/blog[/:id]
POST /admin/uploads/signature
PATCH /admin/users/:id/role                @Roles('super_admin')
```

`RECOMMENDATION` One envelope for every response (`{data, meta?}`; RFC 7807 for errors), a global `ValidationPipe({whitelist:true, forbidNonWhitelisted:true, transform:true})`, a global exception filter that never leaks driver messages, and cursor-or-offset pagination chosen once.

---

# 11. Frontend Architecture Audit

## 11.1 Router & component model

`FACT` **App Router** in both apps (no `pages/`). Server Components are the default for storefront catalogue/account-orders and all admin pages. Client Components (`'use client'`) number **~45**, including four *pages* that are entirely client-side: `checkout`, `wishlist`, `account/profile`, `account/addresses`, plus `contact` and `account/layout`.

`FACT` Next.js 16 conventions in use: `proxy.ts` (not `middleware.ts`), async `params`/`searchParams`, `template.tsx`, `global-error.tsx`, `loading.tsx`, `not-found.tsx`, per-route `error.tsx`.

`FACT` `basePath: '/admin'` on the admin app; `transpilePackages` lists all six workspace packages in both apps.

## 11.2 State management

`FACT` Zustand v5 with `persist`: `cart-store` (localStorage, with an `onRehydrateStorage` validator and a `cartVersion` counter), `wishlist-store` (localStorage), `ui-store` (no persist; writes `nest-theme` to localStorage manually and reads it at **module scope**, line 60 — runs on import, an SSR-hydration hazard), `orderTrackingStore` (no persist; **calls Supabase directly**). React `useState` elsewhere. No React Query/SWR — server state is fetched in RSCs.

## 11.3 Data fetching & caching

`FACT` RSC `async` components + `React.cache()` dedup helpers (`getCachedProductBySlug`, `getCachedCategoryBySlug`, `getCachedBrandBySlug`, `getCachedBlogPostBySlug`, `getCachedCategories`, `getCachedBrands`, `getCachedClient`, `buildServices`). `<Suspense>` streaming on the homepage. `revalidatePath`/`revalidateTag` after mutations.

`FACT` **Caching is effectively disabled.** Six routes declare `force-dynamic`; the four that declare `revalidate = 3600` (`/`, `/categories`, `/blog`, `/blog/[slug]`) all call `getServices()` → `createClient()` → `cookies()`, which `INFERENCE` (high confidence) opts the route into dynamic rendering and nullifies the ISR directive. `FACT` `revalidateTag('wishlist','default')` is called but **no fetch anywhere is tagged `'wishlist'`** — a no-op.

`FACT` The root layout renders `<Navbar />`, an async RSC that calls `productService.getCategoryTree()` — **every storefront page performs a category-tree query**, uncached.

## 11.4 Forms, validation, errors, loading, optimistic updates

- `FACT` **No form library.** Every form is manual `useState` + `onSubmit`. No `useFormState`/`useActionState`, no `useFormStatus` — `isSubmitting` is tracked manually.
- `FACT` Validation is split: Zod in `@nest/types` used **client-side** for auth; Zod used **server-side** in admin actions; `CheckoutStepper` uses **ad-hoc length checks** that duplicate `shippingAddressSchema` without the phone regex — so an invalid phone passes the UI gate and fails at the server.
- `FACT` Error handling: route `error.tsx` (account, checkout, root) + `global-error.tsx` + inline error strings. `account/orders/page.tsx` wraps its own body in `try/catch` and renders a fallback — duplicating the error boundary.
- `FACT` Loading: 8 `loading.tsx` skeleton files + inline skeletons in admin pages.
- `FACT` **No optimistic updates** (`useOptimistic` unused). Admin tables mutate local state after the action resolves.

## 11.5 Auth state on the client

`FACT` `useAuth()` (storefront) subscribes to `onAuthStateChange` and **fetches the profile row on every auth event**, from the browser. Used by `UserMenu` and `account/layout`. Admin has no equivalent hook — the header/sidebar render a hardcoded "Admin" identity.

## 11.6 Environment variables in the frontend

`FACT` `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are read in `packages/providers/src/supabase/client.ts` (browser), `lib/supabase.ts` (both apps), and both `proxy.ts` files. `SUPABASE_SERVICE_ROLE_KEY` is read only in `apps/admin/src/lib/supabase.ts:38` (server). `packages/config/src/env.ts` implements fail-fast validation but is **imported nowhere**. `SITE_URL` falls back to a hardcoded production domain.

## 11.7 Coupling to Supabase — the migration hot list

| Rank | Location | Coupling |
|---|---|---|
| 1 | `stores/orderTrackingStore.ts` | Zustand store issues a PostgREST query with a nested-join `select()` string |
| 2 | `app/account/addresses/page.tsx` | Full CRUD in a page component |
| 3 | `app/account/profile/page.tsx` | Select + upsert in a page component |
| 4 | `hooks/useAuth.ts` | Session lifecycle + profile query |
| 5 | `app/{login,register,forgot-password}/form.tsx` + `admin/login/form.tsx` | 6 direct `auth.*` calls |
| 6 | `stores/cart-store.ts:7` | `Product` type = `Database['public']['Tables']['products']['Row']` — **the Supabase-generated row type is the client-side domain model**, so any schema change ripples into the cart |
| 7 | `lib/services.ts` (both apps) | Manual DI wiring of Supabase providers per request |
| 8 | Every list page | `p.images?.[0]?.url`, `p.avg_rating`, `p.available_stock` — shapes dictated by PostgREST join syntax |
| 9 | `admin/lib/services.ts` | 30+ inline PostgREST queries with `.or()`, `.in()`, embedded-resource filters |
| 10 | `next.config.ts` (storefront) | Hardcoded Supabase project image host |

`RECOMMENDATION` The migration seam is `packages/services` + `packages/repositories`. Replace `packages/providers` with a generated typed HTTP client (from the NestJS OpenAPI doc), keep the service interfaces, and the RSC pages barely change. The 4 direct-client surfaces and `cart-store`'s use of the DB row type are the parts that must actually be rewritten.

---

# 12. Dependency Audit

## 12.1 Categorised

| Category | Package | Version | Where | Post-migration |
|---|---|---|---|---|
| **Core** | `next` | 16.2.4 | both apps | **Stays** |
| | `react`, `react-dom` | 19.2.4 | both | **Stays** |
| | `typescript` | ^5 | root + apps | **Stays** |
| | `turbo` | ^2 | root | **Stays** (add the `api` workspace) |
| | pnpm | 9.0.0 | root | **Stays** |
| **UI** | `lucide-react` | ^0.453.0 | both + ui | Stays |
| | `@radix-ui/react-{dialog,dropdown-menu,slot,tabs}` | ^1–2 | `@nest/ui` | Stays |
| | `class-variance-authority`, `clsx`, `tailwind-merge` | — | `@nest/ui` | Stays |
| | `tailwindcss` v4 + `@tailwindcss/postcss` | ^4 | both | Stays |
| **Database / Backend** | `@supabase/supabase-js` | ^2.45.4 / ^2.105.1 | root, both apps, providers, services | **REMOVED** |
| | `@supabase/ssr` | ^0.5.1 / ^0.4.0 | both apps, providers | **REMOVED** |
| **Auth** | *(none — provided by `@supabase/*`)* | | | Replaced by NestJS |
| **Storage** | *(none — provided by `@supabase/*`)* | | | Replaced by Cloudinary SDK |
| **State** | `zustand` | ^5.0.0 | storefront | **Stays** (cart/UI only) |
| **URL state** | `nuqs` | ^2.0.0 | storefront | **Stays** |
| **Validation** | `zod` | ^3.23.8 / ^3.23.0 | admin, `@nest/types` | **Stays** — reusable for DTOs |
| **Forms** | *(none)* | | | **Gap** — consider RHF |
| **Payments** | *(none)* | | | COD only |
| **Analytics** | *(none)* | | | Gap |
| **Monitoring** | *(none; `pino` is a TODO comment)* | | | Gap |
| **Build** | `eslint` ^9, `eslint-config-next` 16.2.4, `postcss`, `prettier` ^3.2 | | | Stays |
| **Testing** | *(none)* | | | **Gap** |

## 12.2 Findings

- `FACT` **Version inconsistency:** `@supabase/supabase-js` is `^2.105.1` at the root but `^2.45.4` in both apps and `^2.43.0` in `providers`; `@supabase/ssr` is `^0.5.1` in apps and `^0.4.0` in providers. Multiple copies can be hoisted.
- `FACT` **`@supabase/supabase-js` is a root-level runtime dependency** of the private monorepo root — used only by `seed.js`. Misplaced.
- `FACT` **`packages/services/package.json` depends on `"@supabase/supabase-js": "*"`** — an unpinned wildcard.
- `FACT` **`packages/config` devDepends on `tailwindcss: ^3.4.0`** while both apps use Tailwind **v4** — a stale major-version mismatch for the shared preset.
- `FACT` **Nested lockfiles**: `apps/admin/pnpm-lock.yaml` and `apps/storefront/pnpm-lock.yaml` exist alongside the root `pnpm-lock.yaml` in a `pnpm-workspace` repo. This is anomalous and can produce divergent installs.
- `FACT` **No test, lint-staged, husky, commitlint, changesets, or bundle-analyzer tooling.**
- `FACT` `apps/storefront/package.json` has **no `type-check` script**, while `apps/admin` does — so `turbo type-check` only covers the admin app.
- **Dependencies that disappear after migration:** `@supabase/supabase-js`, `@supabase/ssr` (5 declaration sites). **That is the entire backend dependency footprint** — a genuinely favourable position.
- **New dependencies required (recommendation):** `@nestjs/{common,core,platform-express,config,jwt,passport,swagger,throttler,terminus,schedule}`, `@nestjs/mongoose` + `mongoose`, `passport-jwt`, `passport-google-oauth20`, `bcrypt`/`argon2`, `class-validator` + `class-transformer` (or `nestjs-zod` to reuse the existing schemas), `cloudinary`, `multer`, `file-type`, `sharp`, `pino` + `nestjs-pino`, `ioredis` + `@nestjs/cache-manager` (if Redis is adopted), `@casl/ability`, `jest`/`vitest` + `supertest`, `mongodb-memory-server`, `@playwright/test`.

`RECOMMENDATION` **Do not remove anything now.** During Phase 9, the Supabase packages get deleted in one commit; that removal doubles as the migration's completion signal.

---

# 13. Environment & Secrets Audit

**No secret values are reproduced below — names and locations only.**

| Variable | Declared in | Read by | Classification | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `apps/admin/.env.local`, `apps/storefront/.env.local` | `providers/client.ts`, both `lib/supabase.ts`, both `proxy.ts`, `config/env.ts` | **Public** | Correct — project URL is not secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | both `.env.local` | same | **Public** | Correct **only if RLS is sound**; this key is the sole thing standing between the browser and the database |
| `SUPABASE_SERVICE_ROLE_KEY` | **both** `.env.local` | `apps/admin/src/lib/supabase.ts:38` **only** | **Secret (server-only)** | **Present in the storefront but never used** — unnecessary exposure in a second deployment target |
| `NEXT_PUBLIC_SITE_URL` | *(not declared anywhere)* | `config/constants.ts:3`, `config/env.ts:17` | **Public** | **Potentially misconfigured** — falls back to a hardcoded production domain, which is baked into sitemap, canonicals, JSON-LD and OG tags in every environment |
| `LOG_LEVEL` | *(not declared)* | both `lib/logger.ts` | **Public/config** | Defaults to `info` |
| `NODE_ENV` | Next.js-managed | logger comment | **Public** | — |
| `POSTGRES_URL` | `.mcp.json` | MCP server (dev tooling) | **Secret** | Full Postgres connection string **including the database password** |
| `API_KEY` (TestSprite) | `.mcp.json` | MCP server | **Secret** | Third-party API key |
| `SUPABASE_ACCESS_TOKEN` | `.project_plan/PROJECT_OVERVIEW.md` §9 | *(doc only)* | **Secret** | Supabase **personal access token** in plaintext prose — grants management-API control of the account |
| `SUPABASE_PROJECT_REF` | `PROJECT_OVERVIEW.md`, `.mcp.json.example`, `AGENTS.md`, `apps/storefront/next.config.ts:20` | — | **Public identifier** | Hardcoded in committed source |
| `ANTHROPIC_API_KEY` | **`apps/admin/src/test.md`** | *(none)* | **Secret** | **COMMITTED TO GIT** (`4673949`) |
| `ANTHROPIC_BASE_URL` | `apps/admin/src/test.md` | — | Public | Committed |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | `seed.js:8-9` | `seed.js` | **Secret (env-read)** | Correctly read from env with placeholder fallbacks |
| `loginUser` / `loginPassword` | `apps/storefront/testsprite_tests/tmp/config.json`, `testsprite_tests/tmp/mcp.log` | test tooling | **Secret (test account)** | Plaintext; **untracked but NOT gitignored** |

## Findings

1. `FACT` **`.gitignore` correctly ignores** `.env`, `.env.*`, `.mcp.json`, `.project_plan/`, `.prompts/`, `seed.js`, `seed_data.json`, `AGENTS.md`.
2. `FACT` **`.gitignore` does NOT ignore** `testsprite_tests/` or `apps/storefront/testsprite_tests/` — both are currently untracked and would be committed by a `git add .`, publishing the test account password.
3. `FACT` **`apps/admin/src/test.md` is tracked and committed**, and contains a live-format Anthropic API key.
4. `FACT` **No `.env.example`** exists for either app despite `.gitignore` explicitly whitelisting `!.env.example` — onboarding requires reading `AGENTS.md`.
5. `FACT` Root `.env` is a **0-byte** file.
6. `FACT` **No secret is exposed through `NEXT_PUBLIC_*`.** The two public vars are correctly public.
7. `FACT` `.mcp.json` is **malformed JSON** — the file terminates with a stray pair of backticks after the closing brace.

`RECOMMENDATION` (not executed): rotate the Anthropic key, the Supabase PAT, the database password, and the TestSprite key; purge `apps/admin/src/test.md` from git history; add `testsprite_tests/` to `.gitignore`; remove `SUPABASE_SERVICE_ROLE_KEY` from the storefront environment; add `.env.example` files; declare `NEXT_PUBLIC_SITE_URL` per environment.

---

# 14. Security Audit

## CRITICAL

| ID | Finding | Evidence | Impact |
|---|---|---|---|
| **C1** | **Anthropic API key committed to git history** | `apps/admin/src/test.md`, tracked, commit `4673949` | Anyone with repo access (now or later, including any clone/fork/backup) can bill the account. Deleting the file is insufficient — the key is in history and must be rotated. |

## HIGH

| ID | Finding | Evidence | Impact |
|---|---|---|---|
| **H1** | **Guest order data exposure / IDOR** | `stores/orderTrackingStore.ts:45-64` — browser selects `orders` + `order_items` + `order_status_history` by `order_number` alone; the phone check is client-side, **after** the data arrives | If RLS permits, order numbers (sequential) can be enumerated to harvest names, phones, addresses and order values. If RLS denies, the feature is silently broken. **Verify RLS immediately.** |
| **H2** | **Supabase PAT in a plaintext document** | `.project_plan/PROJECT_OVERVIEW.md` §9 | Management-API control of the Supabase account. Gitignored, but present on disk and in any backup. |
| **H3** | **Database password + third-party key in `.mcp.json`** | `.mcp.json` `POSTGRES_URL`, `API_KEY` | Direct Postgres access, bypassing RLS entirely. |
| **H4** | **Service-role key deployed with the storefront** | `apps/storefront/.env.local` | Unused by storefront code, but any future SSR bug or accidental import in that app yields full RLS bypass. Doubles the blast radius for no benefit. |
| **H5** | **Authorization model unverifiable** | No RLS in repo; 4 browser→DB surfaces | The application's entire data-access control depends on policies nobody can review, test, or version. |
| **H6** | **Possible privilege escalation via `profiles` upsert** | `account/profile/page.tsx:79-83` — browser `upsert({id, full_name, phone})` | If the UPDATE policy does not restrict the `role` column, a crafted browser request can set `role='admin'`, which the admin proxy then honours. **Verify.** |

## MEDIUM

| ID | Finding | Evidence |
|---|---|---|
| **M1** | **No rate limiting anywhere** — login, registration, password reset, checkout, order tracking, search | no throttle/limiter of any kind in the repo |
| **M2** | **Client-side-only "rate limit"** on order tracking | `orderTrackingStore.ts:29` — in-memory, reset by reload |
| **M3** | **`dangerouslyAllowSVG: true`** in both `next.config.ts`, with `**.supabase.co` and `placehold.co` whitelisted | Stored-XSS vector if any SVG reaches a whitelisted host and is rendered through the image optimizer. Product uploads block SVG, but categories/brands/blog/reviews accept **arbitrary URLs** |
| **M4** | **PostgREST filter injection** — unsanitised user input interpolated into `.or()`/`.ilike()` filter strings | `blog.service.ts:22`, `admin/customers/page.tsx:36`, `admin/products/page.tsx:64`, `admin/reviews/page.tsx:39`, `admin/audit-log/page.tsx:37`, `search.provider.ts:34`. Not SQL injection, but commas/parens/dots let a caller restructure the filter tree and potentially widen the result set |
| **M5** | **Raw database errors returned to clients** | ~20 sites, e.g. `product.actions.ts:58`, `addresses/page.tsx:126` — schema/constraint disclosure |
| **M6** | **Admin API routes lack in-handler authorization** | `api/attributes/route.ts`, `api/check-slug/route.ts` — defence-in-depth failure; a matcher regression silently exposes them |
| **M7** | **Storefront proxy uses `getSession()`** | `storefront/proxy.ts:55` — weaker than `getUser()`, contrary to Supabase server-side guidance |
| **M8** | **Non-atomic order status transitions** | `order.actions.ts:63-84` — read current status, then RPC. TOCTOU: two admins can drive an order into an invalid state |
| **M9** | **Audit trail fails silently** | `log-action.ts:30-43` inserts a non-existent `user_agent` column; PostgREST returns (not throws) the error, so the `catch` never fires and no log is emitted. Admin actions may be entirely unaudited while the UI shows a healthy Audit Log page |
| **M10** | **Unused Server Actions remain remotely invocable** | `getCart`, `toggleWishlistItem`, `getWishlist` |
| **M11** | **No CSRF hardening beyond framework defaults** | Server Actions carry Next.js's built-in protection; the 4 browser→DB surfaces rely on Supabase bearer tokens — acceptable, but the `GET /admin/api/*` handlers are unauthenticated at the handler level |
| **M12** | **`admin_audit_logs` written with the caller's own credentials** | `log-action.ts` uses the user-scoped client. An audit record should never be writable-or-suppressible by the audited principal |

## LOW

| ID | Finding |
|---|---|
| **L1** | Test-account credentials in plaintext (`testsprite_tests/tmp/config.json`, `mcp.log`), untracked but **not gitignored** |
| **L2** | Password policy is `min(8)` only; no complexity, MFA, lockout, or breach check |
| **L3** | No UUID validation on ~11 admin actions that accept ids |
| **L4** | `deleteProductImageAction` accepts a caller-supplied `revalidatePath` target |
| **L5** | Storage path derived by string-splitting the stored URL — brittle parsing on a security-relevant path |
| **L6** | `duplicateProductAction` slug/SKU suffix from a 4-char base-36 timestamp — collision-prone |
| **L7** | No security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy) configured in either `next.config.ts` |
| **L8** | Both apps ship `dangerouslySetInnerHTML` for JSON-LD (`products/[slug]/page.tsx:130-131`) — content is server-derived, so low risk, but it is unescaped |
| **L9** | `git status` shows an inconsistent working tree (111 changes incl. a deleted-and-recreated route structure) — an unreviewed state to migrate from |

## INFORMATIONAL

- `is_admin()` exists in the database but is never called from application code — role logic is duplicated across SQL and TypeScript.
- `profiles.role` is readable by the browser via `useAuth`.
- No dependency vulnerability scanning, SAST, or secret-scanning in CI (there is no CI).
- `apps/admin/tsconfig.tsbuildinfo`, `apps/storefront/tsconfig.tsbuildinfo` and `.turbo/` are present on disk but correctly gitignored.

---

# 15. Performance Audit

| # | Issue | Evidence | Recommendation |
|---|---|---|---|
| P1 | **Category tree fetched on every storefront page load** | `layout.tsx:42` renders `<Navbar/>` → `productService.getCategoryTree()` → `categories` select + JS tree build, uncached | Cache the tree (Redis or in-process TTL); serve from one endpoint |
| P2 | **Homepage issues 4 separate `getServices()` calls** | `page.tsx:46,52,58,70` — each builds a new Supabase client and 4 provider instances | One service instance per request; `React.cache` the client (admin already does this) |
| P3 | **Dashboard aggregates in JavaScript** | `admin/lib/services.ts:73-203`: pulls 100 products, **500 `order_items` with two joins**, and **every order's status**, then reduces in JS | Move to MongoDB aggregation pipelines / pre-computed counters |
| P4 | **Revenue computed by fetching every paid order's `total`** | `lib/services.ts:120-124`, `customers/page.tsx:85-90` (twice) | `$group`/`$sum` server-side |
| P5 | **Customers page: 6 queries + N-row rollup per page** | `customers/page.tsx:31-90`; `orderUsers` fetches **all** orders' `user_id` to count distinct | Single aggregation or maintained counters |
| P6 | **Product/inventory list pages: `select('*')` plus 3 embedded joins** | `admin/products/page.tsx:56-60` | Projection; only the fields the table renders |
| P7 | **Stats fan-out**: `getProductStats` = 5 count queries, `getOrderStats` = 9, reviews page = 6, coupons page = 5, audit page = 4 | listed files | One aggregation with `$facet` |
| P8 | **N+1 write loop** | `reorderProductImagesAction:353-359` — one UPDATE per image | Single document update |
| P9 | **Sequential awaits where parallel is possible** | `blog/page.tsx:53-55` (3 sequential); `deliverOrder`/`shipOrder` chains | `Promise.all` / single endpoint |
| P10 | **Pagination totals wrong** | `count:'exact'` applied to an RPC that already applied `limit/offset` (`product.provider.ts:52`, `search.provider.ts:19`) | Return `total` from the search endpoint explicitly |
| P11 | **Account orders unpaginated** | `account/orders/page.tsx:44-48` — no `.range()`, plus `order_items` embedded | Paginate |
| P12 | **Sitemap requests 5000 products in one call** | `sitemap.ts:9` | Chunked sitemap index |
| P13 | **ISR directives neutralised by `cookies()`** | §11.3 | Split public reads onto a cookie-free path (or the REST API) so ISR/CDN caching works |
| P14 | **6 routes are `force-dynamic`** including the highest-traffic catalogue pages | listed files | Most are public and cacheable |
| P15 | **`<img>` instead of `next/image` in the shared ProductCard** | `packages/ui/src/product-card.tsx:94,181` | Highest-frequency image in the app is unoptimised |
| P16 | **No image dimensions stored** | `product_images` has no width/height | CLS on every grid |
| P17 | **No image transformations** | §9 | Full-size originals served to 96px thumbnails |
| P18 | **`ProductTable.tsx` 837 LOC, `ProductForm.tsx` 770 LOC, `InventoryTable.tsx` 633 LOC as single client components** | file sizes | Large client bundles; split and memoise |
| P19 | **`FilterGroup` measures `scrollHeight` in an effect keyed on `children`** | `FilterSidebar.tsx:22-26` | Layout thrash on every render |
| P20 | **`ui-store.ts` reads localStorage at module scope** (line 60) | | Runs on import; hydration-mismatch risk |
| P21 | **Embedded-resource filter without `!inner`** | `admin/products/page.tsx:67-71`, `inventory/page.tsx:64-69`: `.eq('category.slug', …)` | `INFERENCE`: filters the embedded object, not the parent rows → category/brand filters return unfiltered lists with nulled embeds |
| P22 | **Missing indexes** | `UNKNOWN` — the plan lists 15 indexes incl. a GIN full-text index; none verifiable | Verify before migration; carry the list into MongoDB index design |
| P23 | **Client-side price-range computation** | `products/page.tsx:124-129` derives the filter's min/max from the **current page only** | Server-side facet |

---

# 16. Current Architecture Diagram (as-built)

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                       BROWSER                            │
                    │                                                          │
                    │  Zustand (localStorage)      React Client Components     │
                    │   ├── cart-store  ◄── source of truth for the cart       │
                    │   ├── wishlist-store ◄── source of truth for wishlist    │
                    │   ├── ui-store                                           │
                    │   └── orderTrackingStore ──────────────┐                 │
                    └───────┬──────────────────────┬─────────┼─────────────────┘
                            │                      │         │
              HTTP / RSC    │      Server Action   │         │  DIRECT PostgREST
              payload       │      (POST)          │         │  + GoTrue (anon key)
                            ▼                      ▼         │
   ┌────────────────────────────────────────────────────────┐│
   │            NEXT.JS 16 (2 apps, Turbopack)              ││
   │                                                        ││
   │  apps/storefront (:3000)      apps/admin (:3001,/admin)││
   │  ─────────────────────        ───────────────────────  ││
   │  proxy.ts                     proxy.ts                 ││
   │   /account,/checkout           everything except       ││
   │   via auth.getSession()        /login,/unauthorized    ││
   │                                via auth.getUser()      ││
   │                                + service-role role     ││
   │                                  lookup                ││
   │                                                        ││
   │  Server Components            Server Components        ││
   │   home, products, PDP,         dashboard, products,    ││
   │   categories, brands,          categories, brands,     ││
   │   search, blog, account/       inventory, orders,      ││
   │   orders, sitemap              coupons, customers,     ││
   │                                reviews, audit-log      ││
   │                                                        ││
   │  Server Actions (3 files)     Server Actions (6 files) ││
   │   createOrderAction            15 admin mutations,     ││
   │   syncCartToDatabase           each: requireAdmin()    ││
   │   [3 dead actions]                 → Zod → mutate      ││
   │                                    → logAdminAction()  ││
   │                                                        ││
   │  Route Handler                Route Handlers           ││
   │   /auth/callback               /api/attributes         ││
   │                                /api/check-slug         ││
   │                                                        ││
   │  Client Components            Client Components        ││
   │   4 full client PAGES          large tables/forms      ││
   │   (checkout, wishlist,                                 ││
   │    profile, addresses)                                 ││
   └────────────────────┬───────────────────────────────────┘│
                        │                                     │
   ┌────────────────────┴─────────────────────────────────┐   │
   │  packages/  (workspace, transpiled into both apps)   │   │
   │                                                      │   │
   │  @nest/services   ProductService · SearchService ·   │   │
   │                   CartService · BlogService ·        │   │
   │                   [OrderService, StorageService DEAD]│   │
   │        ▼                                             │   │
   │  @nest/repositories   6 interfaces (contracts only)  │   │
   │        ▼                                             │   │
   │  @nest/providers  SupabaseProduct/Category/Brand/    │   │
   │                   Order/Cart/Search/Storage/Auth     │   │
   │                   + getSupabaseBrowserClient()  ─────┼───┘
   │                                                      │
   │  @nest/types (Database + domain + Zod) · @nest/ui    │
   │  @nest/config (ROUTES, constants; env.ts UNUSED)     │
   └────────────────────┬─────────────────────────────────┘
                        │  @supabase/supabase-js  /  @supabase/ssr
                        ▼
   ╔══════════════════════════════════════════════════════════════════╗
   ║                       SUPABASE (eu-west-1)                       ║
   ║                                                                  ║
   ║  ┌── Auth (GoTrue) ──────────────────────────────────────────┐   ║
   ║  │  email+password · Google OAuth · JWT in cookies           │   ║
   ║  │  auth.users  ──1:1──►  public.profiles (role column)      │   ║
   ║  └───────────────────────────────────────────────────────────┘   ║
   ║  ┌── PostgreSQL 17 ─────────────────────────────────────────┐    ║
   ║  │  28 tables · 39 FKs · 0 enums · 0 views                  │    ║
   ║  │  RLS: UNKNOWN — not in repository                        │    ║
   ║  │  RPC: search_products             (typed)                │    ║
   ║  │       create_order_v2             UNDOCUMENTED           │    ║
   ║  │       update_order_status_v2      UNDOCUMENTED           │    ║
   ║  │       adjust_stock_v2             UNDOCUMENTED           │    ║
   ║  │       generate_order_number / is_admin /                 │    ║
   ║  │       release_expired_reservations  (never called)       │    ║
   ║  │  Triggers / indexes / cron: UNKNOWN                      │    ║
   ║  └──────────────────────────────────────────────────────────┘    ║
   ║  ┌── Storage ───────────────────────────────────────────────┐    ║
   ║  │  bucket "products"  (public URLs → product_images.url)   │    ║
   ║  │  bucket "images"    (referenced only by dead code)       │    ║
   ║  │  no transformations · no metadata                        │    ║
   ║  └──────────────────────────────────────────────────────────┘    ║
   ║     Realtime: NOT USED        Edge Functions: NOT USED           ║
   ╚══════════════════════════════════════════════════════════════════╝

   NOT PRESENT: CI/CD · Docker · tests · caching layer · queue · cron ·
                email · payments · analytics · error tracking · rate limiting
```

---

# 17. Target Architecture Proposal

```
   ┌──────────────────────────┐          ┌──────────────────────────┐
   │   Next.js Web (this repo)│          │  Flutter  (SEPARATE REPO)│
   │   storefront + admin     │          │  customer mobile app     │
   │   RSC render + client UI │          │                          │
   └────────────┬─────────────┘          └────────────┬─────────────┘
                │  HTTPS / REST / JSON                │
                │  Bearer JWT (admin, mobile)         │
                │  httpOnly cookie (web session)      │
                └───────────────┬─────────────────────┘
                                ▼
        ╔═══════════════════════════════════════════════════════╗
        ║              NestJS API  (apps/api)                   ║
        ║  Global: ValidationPipe · ExceptionFilter ·           ║
        ║          LoggingInterceptor · RequestId ·             ║
        ║          JwtAuthGuard · RolesGuard · Throttler ·      ║
        ║          Swagger (/docs) · Terminus (/health)         ║
        ║                                                       ║
        ║  Auth │ Users │ Catalog (Products/Categories/Brands/  ║
        ║       │       │         Attributes) │ Search │ Cart │ ║
        ║  Orders │ Inventory │ Coupons │ Reviews │ Blog │      ║
        ║  Uploads │ Audit │ Notifications │ Health │ Common    ║
        ╚═══╤════════════════╤═══════════════╤═══════════╤══════╝
            │                │               │           │
            ▼                ▼               ▼           ▼
      ┌───────────┐   ┌────────────┐  ┌───────────┐  ┌──────────────┐
      │  MongoDB  │   │ Cloudinary │  │  Redis*   │  │  External    │
      │ (replica  │   │  media +   │  │  cache ·  │  │  Email (SMTP │
      │  set —    │   │ transforms │  │ rate-limit│  │  /Resend) ·  │
      │  required │   │            │  │ · refresh │  │  SMS/WhatsApp│
      │  for txns)│   │            │  │   denylist│  │  (optional)  │
      └───────────┘   └────────────┘  └───────────┘  └──────────────┘
                                       * see §17.4
```

## 17.1 Layer responsibilities

**Next.js (this repository)** — UI and presentation only: rendering (RSC + client), routing, frontend state (cart draft, UI toggles, URL filter state), form UX and client-side *convenience* validation, SEO metadata/JSON-LD/sitemap, image rendering via Cloudinary URLs, calling the NestJS API through a generated typed client. **Zero database access. Zero business rules. Zero secrets beyond the public API base URL.**

**Flutter (separate repository — explicitly NOT part of this repo)** — mobile UI, mobile state, mobile navigation, secure token storage, calling the same REST API. Consumes the same OpenAPI contract. No shared code with this repository.

**NestJS** — the single source of truth: authentication (register/login/refresh/logout/reset/OAuth), authorization (guards + policies replacing RLS), **all** business logic and calculations (pricing, discounts, totals, shipping, stock, state machines, eligibility), request validation (DTOs), all database access, file management (Cloudinary), workflows and side effects (status transitions, notifications, audit), integrations, security (rate limiting, headers, sanitisation), and the versioned API contract (OpenAPI).

**MongoDB** — persistent application data only. No business logic in the database: no triggers, no stored procedures, no `_v2` functions. Aggregation pipelines are permitted as a *query* mechanism, invoked from services.

**Cloudinary** — media storage, transformation, and CDN delivery. MongoDB stores `publicId`/`version`/dimensions, never derived URLs.

**Redis (conditional)** — see §17.4.

## 17.2 Deployment shape (recommendation)

`apps/web` (Vercel) · `apps/admin` (Vercel, subdomain) · `apps/api` (containerised — Railway/Render/Fly/ECS) · MongoDB Atlas (M10+ for replica-set transactions and Atlas Search) · Cloudinary · Redis (Upstash/managed) if adopted.

## 17.3 Contract flow

`NestJS DTOs → @nestjs/swagger → openapi.json → openapi-typescript/orval → typed client consumed by Next.js` and (via openapi-generator) by Flutter. The OpenAPI document becomes the migration's acceptance artifact.

## 17.4 Is Redis justified? — evidence-based verdict

**Yes, but scoped, and only for three concrete needs the audit actually surfaced:**

1. **Rate limiting — JUSTIFIED, HIGH priority.** `FACT` there is none today, and `FACT` guest order tracking is an enumerable PII endpoint (H1) with a client-side-only limiter (M2). `@nestjs/throttler` with a Redis store is required the moment the API runs on more than one instance.
2. **Read caching — JUSTIFIED, MEDIUM priority.** `FACT` the category tree is queried on **every** storefront page render (P1), and `FACT` ISR is neutralised by `cookies()` (P13). Category tree, brand list, homepage blocks and product-detail documents are ideal 5–60 min cache entries.
3. **Refresh-token denylist / session revocation — JUSTIFIED, MEDIUM priority.** `FACT` there is no logout-everywhere or revocation capability today; JWTs cannot be revoked without one.

**Optionally justified:** inventory reservation TTL keys, to replace the never-invoked `release_expired_reservations()` cron (B12) with self-expiring keys.

**Not justified by this audit:** session storage (JWT is stateless), pub/sub (no realtime feature exists), job queues (no background work exists), full-text search (MongoDB Atlas Search covers it).

**Verdict:** adopt Redis at **Phase 6**, not Phase 2. It is a genuine requirement, not speculative — but the API must be correct before it is fast.

---

# 18. Proposed NestJS Module Map

Only modules justified by observed functionality. Admin capability is expressed as role-guarded controllers **inside** each domain module rather than a monolithic `AdminModule` — because every admin operation in this codebase is a privileged variant of a domain operation, and splitting them would duplicate the services.

### `CommonModule` (global)

- **Responsibilities:** typed `ConfigModule` (Joi/Zod-validated env), `pino` logger with request-id, global `ValidationPipe`, `AllExceptionsFilter` (RFC 7807), `TransformInterceptor`, `ThrottlerModule`, `MongooseModule.forRootAsync`, pagination/DTO base classes, `@Public()`/`@Roles()`/`@CurrentUser()` decorators.
- **Replaces:** `lib/logger.ts` (both apps), scattered `{success,error}` shapes, the unused `packages/config/src/env.ts`.

### `AuthModule`

- **Responsibilities:** register, login, refresh (rotating), logout, forgot/reset password, email verification, Google OAuth, password hashing, JWT issue/verify, `JwtAuthGuard` + `RolesGuard` (+ `PoliciesGuard`).
- **Documents:** `users` (owned by UsersModule), `refreshTokens` (or Redis).
- **Controllers:** `AuthController`. **Services:** `AuthService`, `TokenService`, `PasswordResetService`. **Depends on:** UsersModule, NotificationsModule (reset email), CommonModule.
- **Rules:** min-8 password (from `schemas.ts:6`) — recommend strengthening; email unique; `role` **never** settable via any auth or profile endpoint (fixes H6); generic responses on forgot-password to avoid account enumeration; **rate-limit login and reset** (fixes M1).
- **Replaces:** all 6 browser `auth.*` calls, both `proxy.ts` files, `requireAdmin()`, and the broken reset flow (§4.5).

### `UsersModule`

- **Responsibilities:** profile read/update, embedded address CRUD, admin customer list/detail with order rollups, role management (`super_admin` only).
- **Documents:** `users` (embedding `addresses[]`).
- **Controllers:** `UsersController` (`/users/me/*`), `AdminUsersController` (`/admin/customers`, `/admin/users/:id/role`).
- **Rules:** exactly one default address — **setting a default unsets siblings in one atomic update** (fixes B24); first address is default (B23); phone must satisfy the Egyptian regex (`schemas.ts:24`); email immutable via profile.
- **Replaces:** `account/profile`, `account/addresses`, `useAuth` profile fetch, `admin/customers`, `SupabaseAuthProvider`.

### `CatalogModule` (facade over `ProductsModule`, `CategoriesModule`, `BrandsModule`, `AttributesModule`)

- **Responsibilities:** product CRUD + soft delete + duplicate + status toggle + image management delegation; category tree (materialised path); brand CRUD; attribute definitions and per-category applicability; slug uniqueness and slug-redirect emission; **rating/stock/sales denormalisation maintenance**.
- **Documents:** `products`, `categories`, `brands`, `attributes`, `slugRedirects`.
- **Controllers:** `ProductsController` (public), `AdminProductsController`, `CategoriesController`/`AdminCategoriesController`, `BrandsController`/`AdminBrandsController`, `AttributesController`.
- **Rules:** `availableStock = stock.onHand − stock.reserved` **computed in exactly one place** (fixes B1's 5-way duplication); public reads always filter `isActive && !deletedAt`; slug unique + `slugRedirects` written on rename **and consumed by a redirect endpoint** (fixes B22); `salePrice < basePrice`; duplication copies image **references with refcounting** (fixes W4); primary-image invariant enforced in one atomic update (fixes B25).
- **Replaces:** `ProductService`, all three product providers, `product.actions.ts`, `category-brand.actions.ts`, `/api/attributes`, `/api/check-slug`.

### `SearchModule`

- **Responsibilities:** product search with **real** sorting, faceting (category, brand, price buckets, filterable attributes, stock) and suggestions.
- **Implementation:** MongoDB `$text`/Atlas Search + `$facet`.
- **Rules:** relevance + explicit sorts (`price_asc|price_desc|newest|rating|name_asc` — the sort list `products/page.tsx:40-47` already advertises but cannot honour); **`total` must be the true match count** (fixes P10); attribute facets (the schema supports it, the UI never did).
- **Replaces:** `search_products` RPC, `SearchService`, `PostgresSearchProvider`, and unifies `/products` with `/search`.

### `CartModule`

- **Responsibilities:** server-side cart per user (and optionally per guest token), item add/update/remove, guest-cart merge on login, live re-pricing and stock validation, cart TTL.
- **Documents:** `carts` (embedding `items[]` **with price/name/image snapshots** — fixes B3's always-zero subtotal).
- **Rules:** one merge strategy, chosen explicitly (fixes B15's contradiction); one max-quantity constant (fixes B13's 4 copies); quantity capped by available stock server-side (moves B14 off the client); prices always re-derived server-side, never trusted from the client.
- **Replaces:** `cart-store` persistence half, `CartService`, `SupabaseCartProvider`, `cart.actions.ts`.

### `OrdersModule` — highest-risk

- **Responsibilities:** checkout quote, order placement (transactional), customer order list/detail, **guest order tracking**, admin order list/detail, the three status state machines, tracking numbers.
- **Documents:** `orders` (embedding `items[]`, `statusHistory[]`, `shippingAddress`, `couponSnapshot`).
- **Controllers:** `OrdersController`, `AdminOrdersController`.
- **Rules — this is where `create_order_v2` must be reimplemented in TypeScript:** re-price server-side; validate active + available stock; apply coupon; compute `subtotal − discount + shipping + tax = total`; generate `NE-YYYYMMDD-XXXX`; write order + items; decrement/reserve stock; write the inventory ledger — **all inside one MongoDB transaction**; enforce the transition matrix from `order.actions.ts:35-51` **atomically** (fixes M8/B8); write `statusHistory` on every change; guest tracking compares the phone **server-side** with a generic 404 and a rate limit (fixes H1/B16/B17); **persist the tracking number** (fixes the current dead parameter).
- **Replaces:** `create_order_v2`, `update_order_status_v2`, `checkout.actions.ts`, `order.actions.ts`, `OrderService`, `SupabaseOrderProvider`, `orderTrackingStore`'s data layer, `account/orders*`, `admin/orders*`.

### `InventoryModule`

- **Responsibilities:** append-only stock ledger, manual adjustments with reasons, reservations + expiry, low-stock reporting.
- **Documents:** `inventoryTransactions`; owns the `products.stock` sub-document.
- **Rules:** every stock mutation writes a ledger entry (`adjust_stock_v2` reimplemented); `onHand >= reserved` invariant; **reservation expiry actually implemented** — `@nestjs/schedule` job or Redis TTL (fixes B12); adjustments require a reason ≥3 chars (`inventory.actions.ts:13`).
- **Replaces:** `adjust_stock_v2`, `inventory.actions.ts`, `getInventoryStats`, `getInventoryTransactions`.

### `CouponsModule`

- **Responsibilities:** admin CRUD **plus the customer-facing validation/redemption that does not exist today**.
- **Documents:** `coupons`, `couponRedemptions` (only if per-user limits are required).
- **Rules:** implement `validateCoupon` exactly as specified in `plan_business_logic.md` §7 (active, window, usage limit, minimum order, percentage vs fixed, `max_discount` cap); atomic `usedCount` increment inside the order transaction; **one** coupon schema (today there are two, with different rules — B19).
- **Replaces:** `coupon.actions.ts` and closes feature gap B6.

### `ReviewsModule`

- **Responsibilities:** public approved-review listing, authenticated submission, helpfulness votes, admin moderation, **rating aggregate maintenance**.
- **Documents:** `reviews`; maintains `products.rating {avg, count}`.
- **Rules:** one review per user per product; `isVerifiedPurchase` **computed** from delivered orders (implements B30); reviews default to `pending`; `avg`/`count` recomputed on approve/reject/delete — **this is what makes the ratings that six UI mappers already read stop being permanently zero** (fixes B31); one vote per user per review.
- **Replaces:** `review.actions.ts`, `admin/reviews`, and activates `review_images`/`review_votes`.

### `BlogModule`

- **Responsibilities:** public list/detail/related/categories/tags; admin authoring (currently missing entirely).
- **Documents:** `blogPosts`.
- **Rules:** published + `publishedAt <= now`; slug unique; author snapshot embedded.
- **Replaces:** `BlogService`; adds the missing authoring surface; adds blog URLs to the sitemap.

### `UploadsModule`

- **Responsibilities:** Cloudinary integration, signed-upload issuance, server-side validation (MIME allow-list, magic bytes, size, dimensions), image registration/deregistration, transformation presets.
- **Rules:** port `validate-upload.ts` verbatim and add magic-byte sniffing; **reject SVG** and drop `dangerouslyAllowSVG` (fixes M3); store `publicId`+`version`+dimensions, never URLs (fixes P16); delete is refcount-aware.
- **Replaces:** `StorageService`, `SupabaseStorageProvider`, and the storage half of `product.actions.ts`.

### `AuditModule`

- **Responsibilities:** write admin audit entries (via an interceptor, not caller-supplied), query them for the admin UI.
- **Documents:** `auditLogs`.
- **Rules:** written by the system with elevated privileges, never by the audited principal (fixes M12); **failures are logged as errors, never swallowed** (fixes M9/B32); capture actor, action, entity, before/after diff, IP, **user agent** (the field the current code tries and fails to write).
- **Replaces:** `log-action.ts`, `admin/audit-log`.

### `NotificationsModule` (build only if the feature is actually wanted)

- **Responsibilities:** transactional email (order confirmation, status change, password reset, review moderation), optional in-app notifications, admin low-stock alerts.
- **Documents:** `notifications`.
- **Justification:** the `notifications` table exists and is **completely unused**; `AdminHeader` renders **mock** notifications; password reset **requires** email. **`UNKNOWN` — needs a product decision** (see §25.H).

### `HealthModule`

`GET /health` (liveness), `GET /health/ready` (Mongo + Cloudinary + Redis pings) via `@nestjs/terminus`.

### Modules deliberately **not** created

`PaymentsModule` — COD only; no payment provider exists in the codebase (`payment_provider_id` is an unused column). Add when Paymob is actually adopted. `AdminModule` — superseded by role-guarded controllers inside each domain module. `RealtimeModule`, `QueueModule` — no observed requirement.

---

# 19. Proposed MongoDB Data Model

**28 relational tables → 13 collections (+2 conditional).** Design is driven by the access patterns actually observed in the code.

### `users` (from `auth.users` + `profiles` + `addresses`)

```
_id, email(unique, lowercase), passwordHash, emailVerifiedAt,
fullName, phone, avatar {publicId, version} | null,
role: 'customer'|'admin'|'super_admin',
providers: [{provider:'google', providerId, linkedAt}],
addresses: [{ _id, label, fullName, phone, street, city,
              governorate, postalCode, isDefault }],
stats: { orderCount, totalSpent, lastOrderAt },
createdAt, updatedAt, deletedAt
```

- **Why:** a profile is 1:1 with an auth identity; splitting them is the current model's single most annoying artifact (a trigger is required just to keep them in sync).
- **Embedded:** `addresses` — bounded (~1–10), only ever read for one user (`addresses/page.tsx:64`), never queried globally.
- **Access patterns:** by email (login), by `_id` (JWT subject), by role+createdAt (admin customer list), text search on name/phone.
- **Indexes:** `{email:1}` unique · `{role:1, createdAt:-1}` · `{phone:1}` sparse · text `{fullName, phone}` · `{'providers.providerId':1}` sparse.

### `categories`

```
_id, slug(unique), name{en,ar}, parentId|null,
path: [ancestorIds…], depth, image{publicId,version}|null,
sortOrder, isActive, productCount, createdAt, deletedAt
```

- **Why separate:** referenced by products, rendered as a tree on **every page** (P1).
- **`path[]` is the key decision** — Mongo has no recursive CTE; a materialised ancestor array turns "all products in this subtree" into one indexed `$in`, and the whole nav tree into one `find()` + in-memory assembly (which `product.provider.ts:153-165` already does).
- **Indexes:** `{slug:1}` unique · `{parentId:1, sortOrder:1}` · `{path:1}` · `{isActive:1, deletedAt:1}`.

### `brands`

```
_id, slug(unique), name{en,ar}, logo{publicId,version}|null,
isActive, productCount, createdAt, deletedAt
```

**Indexes:** `{slug:1}` unique · `{isActive:1, deletedAt:1, 'name.en':1}`.

### `products` — the central document

```
_id, sku(unique), slug(unique),
name{en,ar}, description{en,ar},
category: { id, slug, name },        // reference + denormalised snapshot
brand:    { id, slug, name } | null,
pricing:  { base, sale|null, cost|null, currency:'EGP' },
stock:    { onHand, reserved, lowThreshold },
images:   [{ publicId, version, format, width, height, bytes,
             alt, sortOrder, isPrimary }],
attributes: [{ attributeId, slug, name, value, valueId|null, unit|null,
               isFilterable }],
tags: [string],
variants: [{ _id, name, sku, priceModifier, stock{onHand,reserved},
             attributes{}, isActive }],
compatibility: [{ productId, type, notes }],
rating: { avg, count, histogram:{1..5} },
salesCount,
isActive, isFeatured, seo{title,description},
weight|null, dimensions{l,w,h}|null,
createdAt, updatedAt, deletedAt
```

- **Embedded and why:** `images` (≤8, enforced client-side today) · `attributes` (**the big win** — the current 3-table EAV join is why `search_products` returns no attributes and why attribute faceting was never built; flattened + multikey-indexed, faceting becomes trivial) · `variants` (bounded, currently unused) · `tags` · `compatibility`.
- **Referenced and why:** `category`/`brand` by id **with a name/slug snapshot** — because every product card renders the brand name and today that requires a join the search RPC cannot do. Snapshot updates are a rare admin operation, easily handled by a targeted `updateMany`.
- **Access patterns:** by slug (PDP) · faceted list (category/brand/price/stock/attributes + 5 sort orders) · text search · featured · newest · admin list with filters · sitemap bulk.
- **Indexes:** `{slug:1}` unique · `{sku:1}` unique · `{isActive:1, deletedAt:1, 'category.id':1, 'pricing.base':1}` · `{isActive:1, deletedAt:1, 'brand.id':1}` · `{isActive:1, isFeatured:1}` · `{isActive:1, createdAt:-1}` · `{isActive:1, 'rating.avg':-1}` · `{'attributes.slug':1, 'attributes.value':1}` (multikey, for facets) · `{'stock.onHand':1}` · text `{name.en, name.ar, sku, description.en}` with weights.

### `attributes`

```
_id, slug(unique), name{en,ar}, type, unit|null,
isFilterable, isComparable, sortOrder,
categoryIds:[…], values:[{_id, value{en,ar}, sortOrder}]
```

Dictionary for the admin editor and facet labels; `attribute_values` embedded. **Indexes:** `{slug:1}` unique · `{categoryIds:1}` · `{isFilterable:1}`.

### `carts`

```
_id, userId|null, guestToken|null,
items: [{ _id, productId, variantId|null, quantity,
          snapshot:{ name, sku, slug, price, imagePublicId, maxStock },
          addedAt }],
totals: { subtotal, itemCount },
updatedAt, expiresAt
```

`snapshot` fixes the always-zero server subtotal (B3). **Indexes:** `{userId:1}` unique sparse · `{guestToken:1}` unique sparse · `{expiresAt:1}` TTL.

### `orders` — immutable transaction record

```
_id, orderNumber(unique),
userId, customer:{ fullName, email, phone },      // snapshot
items: [{ productId, variantId|null, name, sku, price, quantity, total,
          imagePublicId }],                        // immutable snapshot
pricing: { subtotal, discount, shippingFee, tax, total, currency },
coupon: { id, code, type, value, discountApplied } | null,
status: { order, payment, fulfillment },
statusHistory: [{ field, from, to, changedBy, changedByName, notes, at }],
shippingAddress: {…}, billingAddress: {…}|null,
paymentMethod:'cod', paymentProviderId|null,
trackingNumber|null, notes|null,
placedAt, updatedAt
```

- **Everything is embedded because an order is a point-in-time contract.** Prices must not change when a product's price changes (already the intent behind `order_items`). The `customer` snapshot means the admin order list needs **zero joins** — today `customers/page.tsx` performs a 6-query rollup.
- **Indexes:** `{orderNumber:1}` unique · `{userId:1, placedAt:-1}` · `{'status.order':1, placedAt:-1}` · `{'status.payment':1}` · `{placedAt:-1}` · `{'shippingAddress.phone':1}` (guest tracking) · `{'items.productId':1}` (sales rollups).
- **Aggregations:** revenue by period, order-status breakdown, top products by units, per-customer totals — all four currently computed in JavaScript over full result sets (P3–P5).

### `inventoryTransactions` (append-only ledger)

```
_id, productId, variantId|null, type, quantity,
before:{onHand,reserved}, after:{onHand,reserved},
reference:{type:'order'|'manual'|'import', id|null},
reason|null, createdBy, createdByName, createdAt
```

**Indexes:** `{productId:1, createdAt:-1}` · `{'reference.type':1,'reference.id':1}` · `{createdAt:-1}` · optional TTL/archival.

### `reviews`

```
_id, productId, product:{slug,name},
userId,  author:{fullName, avatarPublicId},
rating, title|null, comment|null,
isVerifiedPurchase, orderId|null,
status:'pending'|'approved'|'rejected', moderatedBy|null, moderatedAt|null,
images:[{publicId,version,sortOrder}],
helpful:{ count, userIds:[…] },
createdAt, updatedAt
```

Separate collection (unbounded per product). `helpful.userIds` embedded for MVP scale; promote to its own collection only if a review can plausibly exceed a few thousand votes. **Indexes:** `{productId:1, status:1, createdAt:-1}` · `{userId:1, productId:1}` unique · `{status:1, createdAt:-1}` (moderation queue) · `{isVerifiedPurchase:1}`.

### `coupons`

```
_id, code(unique, uppercase), type, value,
minOrder|null, maxDiscount|null,
usageLimit|null, usedCount, perUserLimit|null,
startsAt|null, expiresAt|null, isActive, createdAt
```

**Indexes:** `{code:1}` unique · `{isActive:1, expiresAt:1}`. `couponRedemptions {couponId, userId, orderId, at}` — **only if** per-user limits are required.

### `blogPosts`

```
_id, slug(unique), title{en,ar}, excerpt,
content{en,ar}, coverImage{publicId,version}|null,
category|null, tags:[…],
author:{ id, fullName, avatarPublicId },
isPublished, publishedAt|null, createdAt, updatedAt, deletedAt
```

**Indexes:** `{slug:1}` unique · `{isPublished:1, publishedAt:-1}` · `{tags:1}` · `{category:1}` · text `{title.en, excerpt}`.

### `auditLogs`

```
_id, actor:{id, name, role}, action, entity:{type, id},
changes:{before,after}, ip, userAgent, requestId, createdAt
```

**Indexes:** `{createdAt:-1}` · `{'entity.type':1,'entity.id':1}` · `{'actor.id':1, createdAt:-1}` · `{action:1}` · optional TTL (e.g. 2 years).

### `slugRedirects`

```
_id, entityType, oldSlug, newSlug, createdAt
```

**Indexes:** `{entityType:1, oldSlug:1}` unique. **Must actually be read** by a redirect handler — today it is write-only (B22).

### Conditional collections

- **`notifications`** — build only if NotificationsModule is approved. `{userId:1, isRead:1, createdAt:-1}`, TTL.
- **`refreshTokens`** — `{tokenHash:1}` unique, `{userId:1}`, `{expiresAt:1}` TTL — unless Redis is used.
- **`recentlyViewed`** — only if the feature is ever built; TTL + `{userId:1, viewedAt:-1}`.

### Collections deliberately **not** created

`addresses`, `product_images`, `product_variants`, `product_tags`, `product_attribute_values`, `attribute_values`, `product_compatibility`, `cart_items`, `order_items`, `order_status_history`, `review_images`, `review_votes` — **all embedded** for the reasons stated above.

### Important aggregations to build

1. Dashboard: revenue / order count / status breakdown / top products / low stock — a single `$facet` pipeline replacing 8 queries + JS reduction (P3).
2. Product facets: `$facet` over categories, brands, price buckets and `attributes` — enabling the filtering the schema always supported but the UI never had.
3. Customer rollups: `$group` by `userId` over orders, or maintained `users.stats` counters (P5).
4. Rating rollup on review approval → `products.rating` (fixes B31).
5. Sales counters on order placement → `products.salesCount`.

### Transaction requirement

Order placement mutates `orders`, `products` and `inventoryTransactions` atomically. **MongoDB multi-document transactions require a replica set** — this is a non-negotiable infrastructure constraint (Atlas M10+ or a self-hosted RS).

---

# 20. Migration Strategy

Adapted to what this repository actually is: a small, feature-shallow but logic-scattered app whose critical logic lives in **inaccessible database functions**. The sequence therefore front-loads *discovery*, not scaffolding.

### Phase 0 — Audit (complete)

**Deliverable:** this document. **Validation:** stakeholder review; open questions in §25.H answered.

### Phase 0.5 — Database Forensics & Baseline — **NEW, MANDATORY BLOCKER**

- **Objective:** eliminate the four `UNKNOWN`s that make the rest of the plan unplannable.
- **Tasks:** dump `pg_get_functiondef` for `create_order_v2`, `update_order_status_v2`, `adjust_stock_v2`, `adjust_product_stock`, `search_products`, `generate_order_number`, `is_admin`, `release_expired_reservations`; export `pg_policies`, `pg_indexes`, `pg_trigger`, all CHECK constraints, `cron.job`; list Storage buckets + their policies; record row counts and object counts; regenerate `database.ts` and diff it against the committed version; check Auth settings (email confirmation, OAuth providers, JWT TTLs); manually record a **behavioural baseline** of every user-facing flow (which are broken *today*, per §8/§14).
- **Dependencies:** production DB credentials.
- **Risks:** without this the migration is guesswork.
- **Deliverables:** `docs/db/schema.sql`, `docs/db/policies.sql`, `docs/db/functions.sql`, `docs/db/inventory.md`, `docs/baseline.md`.
- **Validation:** every RPC has a written pseudocode spec; every table has its RLS documented; the baseline lists every known-broken feature so post-migration testing does not misattribute them.

### Phase 1 — Domain Modelling & Contract Design

- **Objective:** freeze the domain model and the API contract before writing implementation code.
- **Tasks:** finalise the collection design (§19); write the `openapi.yaml` (or NestJS DTO skeletons) for the full surface (§10.5); decide ID strategy (recommend: keep the existing UUID **strings** as `_id`); write the business-rule catalogue — the canonical successor to §8 — resolving every duplication and contradiction (B15 merge strategy, B13 constants, B19 coupon schemas, B2 pricing).
- **Deliverables:** `docs/domain-model.md`, `openapi.yaml`, `docs/business-rules.md`.
- **Validation:** every §8 rule maps to exactly one module; every current route/action maps to at least one endpoint; no endpoint is unmapped.

### Phase 2 — NestJS Foundation

- **Objective:** a deployable, empty-but-correct API.
- **Tasks:** `apps/api` in the existing Turborepo; `CommonModule` (config validation, pino + request-id, global pipes/filters/interceptors, throttler); Swagger at `/docs`; Terminus health; Dockerfile; **CI pipeline (lint + type-check + test + build) — the repository has none today**; deploy a hello-world to staging.
- **Validation:** `/health` green in staging; CI blocks a deliberately broken PR.

### Phase 3 — MongoDB Foundation *(before Auth — Auth needs a user store)*

- **Tasks:** Mongoose schemas for all 13 collections; every index from §19 declared in code; `mongodb-memory-server` test harness; seed script derived from `seed_data.json`; verify replica-set transactions work in every environment.
- **Validation:** a scripted transaction rollback demonstrably leaves no partial writes; `explain()` confirms index usage for the top 10 queries.

### Phase 4 — Authentication & Authorization

- **Tasks:** `AuthModule` + `UsersModule`; JWT access/refresh with rotation; bcrypt/argon2; Google OAuth; **password reset that actually works** (fixes §4.5); guards (`JwtAuthGuard`, `RolesGuard`, `PoliciesGuard`); translate every RLS policy from Phase 0.5 into a policy/guard, with a **traceability table**; introduce real `super_admin` separation; rate-limit auth endpoints.
- **Risks:** **highest single risk after checkout.** Password migration is the crux — see §22.
- **Validation:** an authorization test matrix (anon / customer / other-customer / admin / super_admin × every endpoint) is green; every Phase-0.5 policy has a corresponding passing test.

### Phase 5 — Catalog, Search & Uploads (Cloudinary)

- **Tasks:** `CatalogModule`, `SearchModule` (with **working sort, correct totals, and attribute facets**), `UploadsModule` + Cloudinary; migrate images (§22).
- **Validation:** catalogue responses match the current storefront's rendered data **plus** the fields it wanted but never received (images/brand/rating in list views); p95 latency ≤ current.

### Phase 6 — Commerce Core: Cart, Orders, Inventory, Coupons

- **Objective:** reimplement the three undocumented RPCs as tested TypeScript.
- **Tasks:** `CartModule` (with price snapshots), `OrdersModule` (transactional placement, status machines, **server-side guest tracking**), `InventoryModule` (ledger + **working reservation expiry**), `CouponsModule` (**customer-facing redemption — new capability**); introduce Redis for rate limiting + caching + refresh denylist (§17.4).
- **Risks:** money and stock. Highest defect cost.
- **Validation:** side-by-side test — the same cart through the old RPC and the new service produce identical totals/order numbers/stock deltas; concurrency tests prove no oversell and no invalid status transition; guest tracking with a wrong phone returns a generic 404 and is rate-limited.

### Phase 7 — Reviews, Blog, Audit, Notifications

Secondary modules. **Reviews closes the ratings-always-zero defect (B31) and adds the missing storefront review UI.** Blog gains authoring. Audit becomes reliable (fixes M9). Notifications only if approved.
**Validation:** approving a review updates `products.rating`; every admin mutation produces exactly one audit record.

### Phase 8 — API Contract Freeze & Client Generation

Freeze `openapi.json`; generate the TS client for Next.js and hand the spec to the Flutter developer.
**Deliverables:** published `openapi.json`, `packages/api-client` (generated), a versioning policy (`/v1`).
**Validation:** the generated client type-checks against every existing call site's needs; the Flutter developer can scaffold from the spec without asking questions.

### Phase 9 — Next.js Migration (storefront + admin)

- **Objective:** remove `@supabase/*` from both apps.
- **Order (lowest risk first):** (1) catalogue reads → API; (2) auth forms + both `proxy.ts` → API + JWT cookie; (3) cart + checkout; (4) account (profile/addresses — **rewritten, not repointed**); (5) order tracking; (6) admin pages; (7) admin Server Actions → API calls; (8) delete `packages/providers` and the Supabase deps.
- **Validation:** a repo-wide search for `supabase` in `apps/` and `packages/` returns zero hits; every route in §2 renders equivalently.

### Phase 10 — Data Migration & Verification

See §22.

### Phase 11 — Testing & Hardening

See §23 — includes the first tests this project will ever have.

### Phase 12 — Production Cutover

Freeze writes → final delta sync → DNS/env switch → smoke suite → monitor. Supabase kept read-only as the rollback target.

### Phase 13 — Flutter Integration

Separate repo; parallel from Phase 8.

### Phase 14 — Supabase Decommission

Only after ≥2 weeks stable + a verified independent backup. Rotate every credential in §13 as part of decommission.

**Parallelisation:** Phase 13 runs alongside 9–11. Phase 11 test-writing starts at Phase 4 and runs continuously.

---

# 21. Migration Risk Register

| ID | Risk | Severity | Probability | Impact | Mitigation |
|---|---|---|---|---|---|
| **R1** | The 3 `_v2` RPCs cannot be recovered or are misread; checkout/inventory logic is reimplemented incorrectly | **Critical** | **High** | Wrong prices, oversold stock, corrupt orders | **Phase 0.5 is a hard gate.** Dump `pg_get_functiondef`, write pseudocode specs, then run old-vs-new differential tests on a copy of production data before cutover |
| **R2** | RLS policies are not fully translated → an endpoint is more permissive than today | **Critical** | **High** | Data breach (esp. `orders`, `profiles`) | Export `pg_policies`; build a policy→guard traceability table; automated authorization-matrix tests as a CI gate |
| **R3** | Password hashes cannot be migrated → every user must reset | **High** | **Medium** | Customer churn at cutover | Attempt direct bcrypt export from `auth.users` (§22.2); if impossible, plan a communicated forced-reset with a pre-cutover email campaign and a working reset flow (which must be **built**, since it is broken today) |
| **R4** | Business rules currently in the frontend are lost when the frontend is rewritten | **High** | **Medium** | Silent behaviour changes (cart caps, price selection, default address, phone gate) | §8 is the checklist; each of the 9 frontend-only rules must appear in `docs/business-rules.md` with an owning module and a test |
| **R5** | Image migration breaks product galleries | **High** | **Medium** | Catalogue renders imageless | Migrate by remote-URL fetch, keep Supabase Storage live during transition, store both `publicId` and `legacyUrl`, verify count + HTTP 200 for every image before deleting anything |
| **R6** | Order/stock data integrity lost in the relational→document transform | **Critical** | **Medium** | Financial discrepancy | Migrate orders **immutably as-is**; reconcile row counts, sum of `total`, sum of stock, ledger balances; freeze writes during the final delta |
| **R7** | Hidden Supabase dependencies missed | **Medium** | **Medium** | Runtime failure after decommission | The §5 inventory is the checklist; final search gate for `supabase`, `createClient`, `.from(`, `.rpc(`, `.storage.` |
| **R8** | Frontend regressions — 4 client pages must be rewritten, not repointed | **High** | **High** | Broken account/tracking/checkout | Rewrite behind feature flags, page by page; E2E tests written **before** each rewrite |
| **R9** | Pre-existing defects (§8, §14, §15) are attributed to the migration | **Medium** | **High** | Wasted debugging, lost trust | `docs/baseline.md` from Phase 0.5 records what is already broken |
| **R10** | API incompatibility with Flutter (contract churn) | **Medium** | **Medium** | Mobile rework | Freeze OpenAPI at Phase 8; version from day one; contract tests |
| **R11** | MongoDB transactions unavailable (standalone deployment) | **High** | **Low** | Non-atomic order placement | Mandate a replica set / Atlas M10+ in Phase 3; fail the phase if transactions do not work in **every** environment |
| **R12** | Production downtime at cutover | **Medium** | **Medium** | Lost revenue | Write-freeze window during low traffic; blue-green; Supabase retained read-only as rollback for ≥2 weeks |
| **R13** | Search quality regression (relevance, facets) | **Medium** | **Medium** | Conversion drop | Current search is already degraded (no images/sort/correct totals) — the bar is low; still, benchmark a fixed query set before/after |
| **R14** | Secrets already exposed (§14 C1/H2/H3) are exploited during the long migration | **High** | **Medium** | Account compromise | **Rotate now, before Phase 1** — do not wait for decommission |
| **R15** | No tests exist, so no regression safety net | **High** | **Certain** | Every change is unverified | Testing starts at Phase 4 and is a gate for each subsequent phase |
| **R16** | Scope creep — the migration becomes "also build coupons, reviews, notifications, blog authoring" | **Medium** | **High** | Timeline collapse | Explicitly classify each as *migrate* vs *build new* (§25.B/D) and schedule new work **after** cutover unless it is a defect fix |
| **R17** | Type-drift bugs (`updated_at`, `user_agent`) recur because the schema had no source of truth | **Medium** | **Medium** | Silent write failures | Mongoose schemas with `strict: 'throw'`; DTO whitelisting; CI type-check across all workspaces (the storefront currently has no `type-check` script) |
| **R18** | Two competing merge/pricing implementations are both ported | **Medium** | **Medium** | Inconsistent behaviour | Delete the dead `OrderService`/`StorageService`/provider write-paths rather than porting them (§25.C) |

---

# 22. Data Migration Strategy *(recommendation only — nothing executed)*

## 22.1 Approach

One-time, script-driven, idempotent ETL — **not** dual-write. Volume is `UNKNOWN` but the shape (a young MVP, 28 tables, a single 53 KB seed file) implies a dataset small enough for a single offline pass with a short write-freeze.

**Pipeline:** `pg_dump`/`COPY` → JSONL staging → transform (Node + TypeScript, reusing `@nest/types`) → `insertMany` (ordered:false, batched) → verify → reconcile.

## 22.2 Identity & passwords

- `RECOMMENDATION` **Keep the existing UUIDs as `_id` strings.** Every FK becomes a literal copy; no ID map is needed; existing URLs, order numbers and support references stay valid. The cost is 36-byte keys instead of 12-byte ObjectIds — irrelevant at this scale, and it removes an entire class of migration bugs.
- **Passwords:** `INFERENCE` Supabase stores bcrypt hashes in `auth.users.encrypted_password`. If direct DB access is available (it is — `.mcp.json` holds a Postgres URL), those hashes can be copied verbatim and verified with `bcrypt.compare` in NestJS, giving a **transparent** migration. **`UNKNOWN` — must be confirmed in Phase 0.5.** Fallback: import users without a hash, flag `mustResetPassword`, and run a communicated reset campaign. OAuth identities migrate as `providers[]` entries with no secret material.

## 22.3 Per-collection transformation

| Target | Sources | Key transforms |
|---|---|---|
| `users` | `auth.users` + `profiles`, `addresses` | Merge 1:1; embed addresses; **enforce exactly one `isDefault`** (current data may contain several — B24); normalise phone; derive `stats` from orders |
| `categories` | `categories` | Compute `path[]`/`depth` by walking `parent_id`; **detect and break cycles** |
| `brands` | `brands` | Direct |
| `products` | `products` + `product_images` + `product_attribute_values` + `attributes` + `attribute_values` + `product_tags` + `product_variants` + `product_compatibility` | Heaviest transform: flatten EAV into `attributes[]`; embed images (Cloudinary `publicId` from §22.5); denormalise category/brand snapshots; **compute `rating` from `reviews`** (a field that has never existed); compute `salesCount` from `order_items`; `dimensions` text→object |
| `attributes` | `attributes` + `attribute_values` | Embed values |
| `orders` | `orders` + `order_items` + `order_status_history` + `profiles` + `coupons` | Embed items and history **verbatim**; snapshot customer; **do not recompute any total** — orders are historical fact |
| `inventoryTransactions` | `inventory_transactions` | Direct; `before`/`after` cannot be reconstructed → leave null for historical rows |
| `reviews` | `reviews` + `review_images` + `review_votes` + `profiles` + `products` | Embed images; fold votes into `helpful`; snapshot author/product |
| `coupons`, `blogPosts`, `auditLogs`, `slugRedirects` | direct | Minor renames |
| `carts`/`cart_items` | — | **Do not migrate.** Carts are ephemeral, the current DB cart is write-only and price-less. Users keep their localStorage cart. |
| `notifications`, `recently_viewed` | — | **Do not migrate** (empty; features do not exist) |

## 22.4 Field-level rules

- **Timestamps:** Postgres `timestamptz` → BSON `Date` (UTC). Preserve `created_at`; where a table lacks `updated_at` (categories, brands), set it to `created_at` rather than "now".
- **Enums:** all statuses are `text` today; validate every distinct value against `packages/types/src/enums.ts` and **fail loudly on any unexpected value** rather than coercing.
- **Nullable fields:** omit the key entirely rather than storing `null`, except where the domain distinguishes "unset" from "explicitly none" (`sale_price`, `parent_id`, `deleted_at`).
- **Numerics:** `DECIMAL(10,2)` → **integer minor units (piastres)** is the safe choice for money; `RECOMMENDATION` decide in Phase 1 and apply uniformly — a mid-migration change here is expensive. If `Double` is chosen instead, all money comparisons need an epsilon.
- **Arrays:** `text[]`/`uuid[]` map directly.
- **JSONB:** `shipping_address`, `billing_address`, `dimensions`, `changes`, `variant.attributes` map directly; validate against the DTO schema.
- **`inet`:** `ip_address` → string.
- **Soft deletes:** keep `deletedAt`; every repository read filters it.

## 22.5 Media migration

1. Enumerate `product_images` + any non-null `categories.image_url` / `brands.logo_url` / `blog_posts.cover_image` / `profiles.avatar_url`.
2. For each, upload to Cloudinary **by remote URL** (Cloudinary fetches it; no local download required), with `overwrite:false`.
3. Record `{publicId, version, format, width, height, bytes, legacyUrl}` — **width/height are captured for the first time**, fixing P16.
4. Verify: uploaded count == source count; spot-check HTTP 200 on derived URLs.
5. Keep `legacyUrl` in the document for one release as a rollback path; Supabase Storage stays live until decommission.

## 22.6 Validation, duplicates, integrity

- **Pre-flight:** referential check for every FK (orphan `product_id`, `user_id`, `order_id`…); duplicate check on every unique key (`sku`, `slug`, `order_number`, `code`, `(user_id, product_id)`); constraint check `stock_quantity >= reserved_quantity`; multi-default addresses; unknown enum values.
- **Idempotency:** every write is an upsert on the preserved `_id`; the script is safely re-runnable — mandatory for the rehearsal→delta→final sequence.
- **Post-migration reconciliation (must all be zero-delta):** document counts per collection vs table counts; `SUM(orders.total)`; `SUM(order_items.total)` vs embedded items; `SUM(products.stock_quantity)` and `SUM(reserved_quantity)`; per-product inventory-ledger balance; user count; review count per product vs the new `rating.count`; image count.
- **Sampling:** deep-diff 50 random orders, 50 products, 20 users field-by-field against the source.

## 22.7 Rollback

- Supabase is **not modified** by the migration and remains the authoritative system until cutover +2 weeks (read-only after cutover).
- Rollback = revert the frontend env/deploy to the Supabase build. Valid only while no new writes have landed in MongoDB — hence the write-freeze and a **short** cutover window.
- Take a `pg_dump` immediately before the freeze and an Atlas snapshot immediately after the load.
- Define the abort criteria **before** the window (e.g. any non-zero reconciliation delta, any failed smoke test).

## 22.8 Sequence

Rehearsal on a production copy → fix → rehearse again until zero-delta and timed → announce window → freeze writes → final delta run → reconcile → smoke → switch → monitor.

---

# 23. Testing Strategy

`FACT` **The project currently has zero test files and zero CI.** This is simultaneously the largest risk (R15) and the cleanest opportunity — there is no legacy test suite to fight.

| Layer | Tool | Scope | Priority |
|---|---|---|---|
| **Unit** | Jest/Vitest | Pricing, totals, discount, coupon validation (`plan_business_logic.md` §7), status-transition matrices, stock math, cart merge, slug/SKU generation, phone/address validators, `validate-upload`, JWT/password services | **P0** |
| **Integration (module)** | Jest + `mongodb-memory-server` | Each service against a real Mongo: repositories, transactions, index usage, aggregation correctness | **P0** |
| **API (e2e)** | Supertest against the Nest app | Every endpoint in §10.5: status codes, response envelope, validation rejection, pagination | **P0** |
| **Authentication** | Supertest | Register/login/refresh/rotation/logout/reset/OAuth; expired, tampered and replayed tokens; rate limiting | **P0** |
| **Authorization** | Supertest matrix | **anon × customer × other-customer × admin × super_admin** against **every** endpoint. The direct replacement for RLS and the only proof that R2 is mitigated. Explicit IDOR cases: another user's order, another user's address, order-tracking with a wrong phone | **P0 — highest value** |
| **Database** | Jest | Schema validation, unique-index enforcement, TTL behaviour, **transaction rollback leaves no partial writes**, concurrent-decrement no-oversell | **P0** |
| **Migration** | Node scripts | Idempotency (run twice → identical), reconciliation assertions (§22.6), deep-diff sampling, orphan/duplicate detection, image count + reachability | **P0** |
| **Differential (old vs new)** | Custom harness | Same input through `create_order_v2` and `OrdersService.create` → identical subtotal/discount/total/order-number-format/stock delta/ledger entries. **The only credible mitigation for R1.** | **P0** |
| **Contract** | Dredd / schemathesis / openapi-typescript diff | Responses conform to `openapi.json`; breaking-change detection in CI (protects Flutter) | **P1** |
| **E2E (web)** | Playwright | Guest browse → add to cart → register → checkout → order appears in account → admin sees it → admin ships it → customer sees the status. Plus login/logout, password reset, product search+filter, guest order tracking, admin product create-with-image | **P0 for the critical path** |
| **Regression** | Playwright + baseline | Re-run the §2 route map; compare against `docs/baseline.md` so pre-existing defects are not misread as regressions (R9) | **P1** |
| **Load** | k6/autocannon | Catalogue list, product detail, search, checkout — establish p95 before cutover | **P2** |
| **Security** | dependency audit, secret scanning, OWASP-style checks | CI gate; would have caught C1 | **P1** |

## Flows that MUST be covered before production cutover

1. **Order placement** — pricing, stock decrement, ledger, order number, transaction atomicity, concurrency (no oversell).
2. **Authentication** — every path, including the currently-broken password reset.
3. **Authorization / IDOR** — the full matrix; specifically another user's order, another user's address, and guest order tracking with a mismatched phone (H1).
4. **Admin order status transitions** — legal and illegal, concurrent.
5. **Stock adjustment + ledger balance.**
6. **Cart merge on login** — with the single, decided strategy.
7. **Product create/update with image upload and deletion.**
8. **Catalogue list/detail/search** — including the fields that were previously missing.
9. **Data-migration reconciliation.**

`RECOMMENDATION` Coverage targets: ≥90% on `OrdersModule`, `InventoryModule`, `CouponsModule`, `AuthModule`; ≥70% overall. CI gates: lint + type-check (**all** workspaces — add the missing storefront `type-check` script) + unit + integration + e2e + contract diff.

---

# 24. Observability & Production Requirements

Scoped to what this project's complexity actually justifies — a single-region, COD-only, low-to-moderate-traffic store with a two-person-scale team.

| Capability | Recommendation | Justification from the audit |
|---|---|---|
| **Structured logging** | `nestjs-pino` — JSON, level from env, redaction of `authorization`/`password`/`token` | Both apps already ship a hand-rolled JSON logger with a TODO to adopt pino (`storefront/lib/logger.ts:1`). Finish that intent in one place. |
| **Request IDs** | `x-request-id` in/out, bound to the async context, echoed in every log line and error response | Today an error surfaces as a raw PostgREST string with no trace (M5) |
| **Error tracking** | Sentry (API + both web apps), release-tagged | **Zero error tracking exists.** M9 shows a failure mode where a core feature silently does nothing. |
| **Health checks** | `@nestjs/terminus`: `/health` (liveness), `/health/ready` (Mongo + Cloudinary + Redis) | Required by any container platform; none exists today |
| **Metrics** | Prometheus via `@willsoto/nestjs-prometheus` **or** the hosting platform's built-ins: request rate/latency/error rate per route, Mongo pool, order-placement success rate, stock-conflict rate | Justified — but do **not** build a bespoke metrics stack at this scale |
| **Audit logging** | `AuditModule` written by an interceptor, never swallowed on failure, capturing actor/action/entity/diff/ip/**userAgent**/requestId | The existing design is sound; the implementation silently fails (M9/B32) |
| **Alerting** | Small and specific: API error rate, checkout failure rate, Mongo connection loss, disk/quota, failed audit writes | Anything broader will be ignored at this team size |
| **Backups** | Atlas continuous backup + PITR; **restore rehearsed at least once**; Cloudinary is the media system of record | No backup strategy exists today |
| **Database monitoring** | Atlas Performance Advisor, slow-query log, index-usage review | §15 lists 20+ query issues that would surface immediately |
| **Uptime monitoring** | External check on `/health` and the storefront home | — |
| **Deployment** | Docker image for the API; Vercel for both web apps; migrations and index creation as an explicit, idempotent startup/CI step; staging that mirrors production incl. replica set; blue-green or rolling with health gating | No Dockerfile, no CI/CD, no deployment config exists |
| **Secrets management** | Platform secret store; **rotation runbook**; `.env.example` per app; secret scanning in CI | §13/§14 — a key is already in git history |
| **Rate limiting** | `@nestjs/throttler` + Redis: strict on auth and order-tracking, moderate globally | M1/M2/H1 |
| **Security headers** | Helmet on the API; CSP/HSTS/X-Frame-Options/Referrer-Policy on both web apps | L7 |

**Explicitly not recommended at this stage:** distributed tracing (single service), APM beyond Sentry + platform metrics, a log-aggregation cluster (use the platform's), feature-flag SaaS, chaos engineering. Revisit if traffic or team size grows materially.

---

# 25. Final Decision Report

## A. What should be PRESERVED

1. **The monorepo and Turborepo setup** — add `apps/api` alongside; the structure already supports it.
2. **`@nest/types`** — `domain.ts`, `enums.ts`, `schemas.ts`, `dtos.ts` are a genuine head start on NestJS DTOs. (`database.ts` is discarded with Supabase; the duplicate `BlogPost`/`BlogFilters` declarations get cleaned.)
3. **`@nest/ui`** — 23 framework-agnostic primitives; keep as-is (swap `<img>` for `next/image` in `product-card.tsx`).
4. **`@nest/config`** — `ROUTES`, `EGYPTIAN_GOVERNORATES`, constants; `env.ts`'s fail-fast idea should be adopted (it is currently never imported).
5. **`packages/repositories` interfaces** — the conceptual contracts port almost directly to NestJS repository interfaces. This is the migration's most valuable existing asset.
6. **The tri-status order model + `order_status_history` + immutable `order_items`** — a mature design; carry it into the document model.
7. **The status-transition matrices** (`order.actions.ts:35-51`) — correct domain knowledge; move them into `OrdersModule` and make them atomic.
8. **The admin mutation pattern** (`requireAdmin` → Zod → mutate → audit) — reproduce as guard → DTO → service → audit interceptor.
9. **`validate-upload.ts`** — solid; port and strengthen with magic-byte sniffing.
10. **The inventory ledger concept** and `available = onHand − reserved`.
11. **SEO work** — JSON-LD generators, sitemap, robots, canonical/OG metadata.
12. **All UI/UX, design tokens, and page layouts** — this is a presentation-layer-preserving migration.
13. **The planning documents** — `plan_business_logic.md` §7 (coupon algorithm) and §4 (reservation lifecycle) are the specs for features that were never built.

## B. What should be REWRITTEN

1. **The entire data-access layer** — `packages/providers` → a generated typed API client; `packages/services` → NestJS services.
2. **Authentication end-to-end** — including a password-reset flow that works (it currently throws).
3. **Authorization** — RLS → guards/policies, with real `super_admin` separation.
4. **Checkout/order placement** — `create_order_v2` reimplemented in TypeScript under test.
5. **Order status management** — `update_order_status_v2` + atomic transition enforcement.
6. **Stock management** — `adjust_stock_v2` + **actually implemented** reservation expiry.
7. **Search** — with working sort, correct totals, images/brand/rating in results, and attribute facets.
8. **The four direct-client surfaces** — profile, addresses, order tracking, `useAuth` profile fetch.
9. **The cart** — server-side with price snapshots; one merge strategy.
10. **Wishlist** — currently two disconnected half-implementations.
11. **Dashboard analytics** — JS rollups → aggregation pipelines.
12. **Image pipeline** — Supabase Storage → Cloudinary with real metadata.
13. **Error/response handling** — one envelope, no driver-message leakage.

## C. What should be REMOVED (not migrated)

1. `apps/admin/src/test.md` — **and its key rotated, and the file purged from git history**.
2. `apps/storefront/src/components/CartSync.tsx` (0 bytes).
3. `components/home/RecommendedProducts.tsx` (dummy laptop data), `BlogSection.tsx`, `CategoryCircles.tsx`, `PromoBanner.tsx` — 0 importers.
4. `apps/admin/src/components/audit/AuditLogTable.tsx` — superseded duplicate.
5. `OrderService`, `StorageService`, `SupabaseAuthProvider`, the unused product/order provider write-methods, `SupabaseCartProvider.getCartBySession` — dead, and in several cases *contradictory* to the live implementation.
6. The 3 uncalled Server Actions (`getCart`, `toggleWishlistItem`, `getWishlist`) — they remain remotely invocable.
7. RPC `adjust_product_stock` — no caller.
8. Root-level one-off codemods: `fix_hero.js`, `fix_hero2.js`, `fix_hero3.js`, `rewrite.js`, `rewrite2.js`, `adjust_images.js`; the empty `cinematic` file; `DESIGN copy.md`.
9. Nested `apps/*/pnpm-lock.yaml` files.
10. `testsprite_tests/` artifacts (and add them to `.gitignore`).
11. `dangerouslyAllowSVG: true` in both `next.config.ts`.
12. `SUPABASE_SERVICE_ROLE_KEY` from the storefront environment.
13. Dead nav links (`/cart`, `/compare`, `/vendors`, `/about`, `/faq`, `/account/notifications`) — either build the routes or remove the entries.

## D. What should be REDESIGNED

1. **The EAV attribute system** → flattened `products.attributes[]`, unlocking the faceted filtering the schema always supported and the UI never had.
2. **The category tree** → materialised `path[]`, removing the per-page-render tree query.
3. **Ratings** → maintained `products.rating {avg,count}` — six UI mappers already read fields that have never existed.
4. **The cart** → server-side with snapshots (today's server cart cannot compute a subtotal).
5. **Guest order tracking** → a single server-side, rate-limited endpoint.
6. **Media metadata** → `publicId` + dimensions instead of absolute URLs.
7. **Coupons** → complete the loop: admin CRUD already exists, customer redemption does not.
8. **Reviews** → complete the loop: moderation exists, submission and display do not.
9. **Dashboard** → one aggregated endpoint instead of eight queries plus JS reduction.
10. **Notifications** → decide: build it or drop the table and the mock UI.
11. **Caching** → deliberate ISR/CDN/Redis strategy instead of `force-dynamic` everywhere.
12. **Config/secrets** → validated env at startup, `.env.example`, rotation runbook.

## E. What should NOT be migrated

1. `carts`/`cart_items` rows — ephemeral, price-less, write-only.
2. `notifications`, `recently_viewed` — empty, no feature.
3. `product_variants`, `product_tags`, `product_compatibility`, `review_votes`, `review_images` **as data** — schema is carried forward (embedded), but there is nothing to move.
4. `admin_audit_logs` history — **`UNKNOWN`/likely empty** given M9; migrate if non-empty, else start fresh.
5. Supabase Auth *sessions* — everyone re-authenticates at cutover.
6. Supabase RLS policies **as artifacts** — their *intent* is translated; the SQL is not.
7. The Supabase RPC functions themselves — reimplemented, not ported.
8. `.project_plan/` and `.prompts/` — historical planning; extract the two useful specs and archive the rest.

## F. Highest-risk areas (ranked)

1. **`create_order_v2`** — unknown logic governing money and stock. *(R1)*
2. **RLS → guards translation** — unknown authorization model. *(R2)*
3. **Guest order tracking** — an active PII exposure whose behaviour depends on a policy nobody has seen. *(H1)*
4. **Password/identity migration.** *(R3)*
5. **Committed secrets** — exploitable today, throughout a multi-month migration. *(C1/H2/H3, R14)*
6. **Zero tests** — no safety net for any of the above. *(R15)*
7. **The 4 direct-client surfaces** — rewrites, not repoints. *(R8)*
8. **Inventory reservation expiry** — specified, never implemented; stock may already be silently locked. *(B12)*

## G. Recommended implementation order

```
0.  ROTATE SECRETS + purge test.md from history   ← first, independent of everything
0.5 Database forensics & behavioural baseline      ← HARD GATE
1.  Domain model + OpenAPI contract + business-rule catalogue
2.  NestJS foundation + CI/CD (first CI this repo has had)
3.  MongoDB foundation (replica set, schemas, indexes)
4.  Auth + Users + authorization matrix tests
5.  Catalog + Search + Uploads/Cloudinary + image migration
6.  Cart + Orders + Inventory + Coupons + Redis
7.  Reviews + Blog + Audit (+ Notifications if approved)
8.  Contract freeze + client generation → hand off to Flutter
9.  Next.js migration (catalog → auth → cart/checkout → account → tracking → admin)
10. Data migration rehearsals until zero-delta
11. Testing & hardening (continuous from Phase 4)
12. Production cutover (write-freeze, delta, reconcile, switch)
13. Flutter integration (parallel from Phase 8, separate repo)
14. Supabase decommission (+2 weeks minimum) + final credential rotation
```

## H. Questions / ambiguities requiring human decision

**Blocking (cannot proceed past Phase 0.5 without answers):**

1. What exactly do `create_order_v2`, `update_order_status_v2` and `adjust_stock_v2` do? *(Requires DB access.)*
2. What are the actual RLS policies — in particular on `orders` (anon SELECT?) and `profiles` (can a user UPDATE `role`?)
3. Is guest order tracking currently working in production, or silently failing? *(Determines whether H1 is an active breach or a dead feature.)*
4. Can `auth.users.encrypted_password` be exported? *(Decides transparent migration vs forced reset.)*
5. Do triggers exist for `handle_new_user`, `updated_at`, and any rating rollup? Is a `pg_cron` job running `release_expired_reservations()`?
6. Which Storage buckets exist (`products`? `images`?) and are they public?

**Blocking (product/business decisions):**

7. Money representation: integer minor units or decimal? *(Must be decided before any schema is written.)*
8. Shipping cost model — currently hardcoded to 0. Flat rate? Per governorate? Free over a threshold?
9. Tax — the column exists and is always 0. Is VAT to be applied? The PDP already tells customers "Price includes VAT."
10. Coupons: admin can create them but no customer can use one. Build redemption, or drop the feature?
11. Reviews: moderation UI exists but customers cannot submit or read reviews. Build it, or drop it?
12. Notifications: table + mock UI exist, feature does not. Build it? Email provider?
13. Product variants: full schema, zero usage. Real requirement or speculative?
14. Wishlist: localStorage-only today. Should it persist server-side and sync across devices?
15. Are Arabic fields (`name_ar`, `description_ar`, …) going to be used? They exist throughout and are never rendered.
16. Is Google OAuth actually enabled? Is email confirmation on?

**Non-blocking but needed before Phase 3/6:**

17. Expected data volumes (users, products, orders) — sizing and index strategy.
18. Hosting targets for the API and MongoDB; is Atlas M10+ (replica set) acceptable? *(Hard requirement for transactions.)*
19. Acceptable cutover downtime window.
20. Is Paymob (or any payment provider) planned? `payment_provider_id` exists but is unused.
21. Who owns the Flutter app, and what is its target timeline relative to Phase 8?
22. Should the admin remain a separate Next.js app, or merge into one app with role-based routing?

---

# 26. ARCHITECT HANDOFF

> Read this section alone to understand the project without redoing the audit.

## CURRENT STACK

Next.js 16.2.4 (App Router, Turbopack) · React 19.2.4 · TypeScript 5 · Tailwind v4 · Zustand v5 · nuqs v2 · Zod v3 · Radix UI · lucide-react · **Supabase (Auth + PostgreSQL 17 + Storage)** · pnpm 9 + Turborepo 2. **No** tests, CI, Docker, cache, queue, email, payments, monitoring, or rate limiting.

## TARGET STACK

Next.js (web) · Flutter (mobile, **separate repo**) · **NestJS** REST API · **MongoDB** (replica set — required for transactions) · **Cloudinary** · **Redis** (justified: rate limiting, read cache, refresh-token denylist) · Sentry + pino + Prometheus/Terminus.

## CURRENT ARCHITECTURE

Two Next.js apps (`storefront`, `admin` at basePath `/admin`) + 6 shared packages. Reads mostly via Server Components → `@nest/services` → `@nest/providers` → Supabase. Writes via 15 Server Actions. **Plus 4 surfaces where the browser talks to Supabase directly** (profile, addresses, order tracking, auth+profile hydration). Route protection via `proxy.ts` in each app. The most important logic lives in **PostgreSQL functions that are not in this repository**.

## TARGET ARCHITECTURE

`Next.js (UI only) ──REST──▶ NestJS (auth, authz, all business logic, validation, data access, media) ──▶ MongoDB / Cloudinary / Redis ◀──REST── Flutter`. Zero database access from any client.

## CORE DOMAINS

Identity & Access · Catalog (products, categories, brands, attributes) · Search & Discovery · Cart · Ordering & Fulfilment · Inventory · Promotions (coupons) · Reviews & Ratings · Content (blog) · Media · Audit · (Notifications — pending decision).

## CURRENT DATABASE

Supabase PostgreSQL, **28 tables**, 39 FKs, **0 enums** (all statuses are `text`), **0 views**, soft deletes (`deleted_at`), EAV attributes (3 tables), tri-status orders, inventory ledger with `reserved_quantity`.

**7 tables are entirely unused:** `notifications`, `recently_viewed`, `product_variants`, `product_tags`, `product_compatibility`, `review_votes`, `review_images`. `slug_redirects` is written but never read.

**No migrations, no SQL, no RLS in the repo.** Schema is known only from `packages/types/src/database.ts`.

**RPCs called:** `search_products` (typed) · `create_order_v2`, `update_order_status_v2`, `adjust_stock_v2` (**undocumented — hold the core logic**) · `adjust_product_stock` (dead).

## PROPOSED MONGODB MODEL

**13 collections (+2 conditional):** `users` (⊂ addresses) · `categories` (materialised `path[]`) · `brands` · `products` (⊂ images, attributes, variants, tags, compatibility; + category/brand snapshots, `rating`, `salesCount`, `stock`) · `attributes` (⊂ values) · `carts` (⊂ items **with price snapshots**) · `orders` (⊂ items, statusHistory, addresses, coupon — fully immutable) · `inventoryTransactions` · `reviews` (⊂ images, helpful) · `coupons` · `blogPosts` · `auditLogs` · `slugRedirects` · *(conditional: `notifications`, `refreshTokens`)*.

**Keep existing UUIDs as `_id` strings.** 12 relational tables become embedded documents. Order placement requires a multi-document transaction.

## CURRENT AUTH

Supabase GoTrue, cookie JWT. Sign-in/up/out/reset all execute **in the browser** with the anon key. `proxy.ts` guards `/account`+`/checkout` (storefront, via the weaker `getSession()`) and everything (admin, via `getUser()` + a **service-role** role lookup). `requireAdmin()` gates all admin Server Actions. **`admin` and `super_admin` are never distinguished.** **Password reset is broken** — `forgot-password/form.tsx:34` references `ROUTES.auth.callback`, which does not exist in `constants.ts`; there is also no set-new-password page.

## PROPOSED AUTH

NestJS `AuthModule`: JWT access (~15 min) + rotating refresh; argon2/bcrypt; Google OAuth via Passport; working reset + verification; global `JwtAuthGuard` with `@Public()`; `RolesGuard` + CASL `PoliciesGuard` replacing RLS; real `super_admin` separation; rate-limited auth endpoints; refresh denylist in Redis. httpOnly cookie for web, bearer for Flutter.

## CURRENT STORAGE

Supabase Storage bucket **`products`**; upload via admin Server Action (validated: MIME/5 MB/extension/filename); **absolute public URLs persisted** into `product_images.url`. No transformations, no dimensions, no metadata. A second bucket name (`images`) exists only in dead code. Product duplication copies URLs, so two products share one object. `dangerouslyAllowSVG: true` in both apps.

## PROPOSED CLOUDINARY MODEL

`Client → NestJS UploadsModule (guard + MIME allow-list + magic bytes + size + sharp/EXIF-strip, SVG rejected) → Cloudinary (folder nest/products/<id>) → MongoDB stores {publicId, version, format, width, height, bytes, alt, sortOrder, isPrimary}`. URLs derived at read time via named transformations (`t_product_card`, `t_product_detail`, `t_thumb`). Signed direct uploads for large files. Refcounted deletes.

## CRITICAL BUSINESS RULES

1. `available = stock_quantity − reserved_quantity` *(currently duplicated in 5 places)*
2. Effective price = `sale_price ?? base_price` *(frontend-only, 4 places)*
3. `total = subtotal − discount + shipping_fee + tax` *(inside `create_order_v2` — **exact formula UNKNOWN**)*
4. Order number `NE-YYYYMMDD-XXXX` *(DB sequence — sequential, enumerable)*
5. Order transitions: `pending_payment → paid|cancelled|failed` · `paid → processing|cancelled` · `processing → shipped` · `shipped → delivered` *(server-side, **non-atomic**)*
6. Payment: `pending → paid|failed` · `paid → refunded`. Fulfilment: `unfulfilled → processing → shipped → delivered|returned`
7. Max cart quantity 99 *(defined in 4 places)*; quantity capped at available stock *(frontend-only)*
8. Cart merge on login *(**two contradictory strategies**: `sum` in the provider, `max` in the store)*
9. Coupon validation algorithm — **specified in `plan_business_logic.md` §7, never implemented**
10. Inventory reservation, 30-minute expiry — **specified, never implemented**; `release_expired_reservations()` exists but nothing calls it
11. Soft deletes filter every public read
12. Every stock change writes an `inventory_transactions` row
13. Guest order access = order number **+ phone match** *(currently checked **in the browser**)*
14. Admin actions must be audited *(currently **silently failing** — writes a non-existent `user_agent` column)*
15. `is_verified_purchase` and `avg_rating`/`review_count` — **read by the UI, never computed anywhere**

## CRITICAL SECURITY ISSUES

| Sev | Issue |
|---|---|
| **CRITICAL** | Anthropic API key committed to git (`apps/admin/src/test.md`, commit `4673949`) — **rotate + purge history** |
| **HIGH** | Guest order tracking: browser reads full `orders` row by order number; phone gate is client-side; order numbers are sequential |
| **HIGH** | Supabase personal access token in `.project_plan/PROJECT_OVERVIEW.md` §9 |
| **HIGH** | Postgres password + TestSprite key in `.mcp.json` |
| **HIGH** | Service-role key deployed with the storefront, which never uses it |
| **HIGH** | Possible `role` self-escalation via the browser `profiles` upsert *(depends on unverified RLS)* |
| **HIGH** | Authorization model unverifiable — no RLS in the repo |
| **MEDIUM** | No rate limiting anywhere · `dangerouslyAllowSVG` · PostgREST filter injection via `.or()`/`.ilike()` · raw DB errors returned to clients · admin `/api/*` unauthorised at handler level · storefront proxy uses `getSession()` · non-atomic status transitions · audit trail silently empty |

## CRITICAL MIGRATION RISKS

R1 undocumented `_v2` RPCs (money + stock) · R2 RLS→guard translation · R3 password migration · R5 image migration · R6 order/stock integrity · R8 four client-side rewrites · R11 MongoDB transactions require a replica set · R14 already-exposed secrets · R15 zero tests.

## PROPOSED NESTJS MODULES

`CommonModule` · `AuthModule` · `UsersModule` · `CatalogModule` (Products · Categories · Brands · Attributes) · `SearchModule` · `CartModule` · **`OrdersModule`** · `InventoryModule` · `CouponsModule` · `ReviewsModule` · `BlogModule` · `UploadsModule` · `AuditModule` · `HealthModule` · *(`NotificationsModule` — pending decision)*. **No `PaymentsModule`** (COD only). **No `AdminModule`** — admin controllers live inside each domain module behind `@Roles()`.

## PROPOSED API SURFACE

**Public:** `/auth/*` · `/products`, `/products/:slug`, `/products/:slug/related`, `/products/suggest` · `/categories`, `/categories/tree`, `/categories/:slug` · `/brands`, `/brands/:slug` · `/attributes` · `/cart`, `/cart/items/*`, `/cart/merge` · `/coupons/validate` · `/checkout/quote` · `/orders` (POST/GET), `/orders/:id`, `/orders/track` · `/users/me`, `/users/me/addresses/*` · `/wishlist/*` · `/products/:id/reviews`, `/reviews/:id/helpful` · `/blog/*` · `/contact` · `/health`.

**Admin (`/admin/*`, role-guarded):** products (+images, duplicate, status), categories, brands, coupons, orders (+status/payment/fulfilment), inventory (+adjust, transactions), customers, reviews, audit-logs, blog, uploads/signature, `dashboard/stats`, `users/:id/role` (super_admin).

## MIGRATION PHASES

`0 Audit (done)` → **`0.5 DB forensics + baseline (HARD GATE)`** → `1 Domain model + OpenAPI` → `2 Nest foundation + CI` → `3 MongoDB` → `4 Auth/Users + authz matrix` → `5 Catalog/Search/Cloudinary` → **`6 Cart/Orders/Inventory/Coupons + Redis`** → `7 Reviews/Blog/Audit` → `8 Contract freeze` → `9 Next.js migration` → `10 Data migration rehearsals` → `11 Testing & hardening` → `12 Cutover` → `13 Flutter (parallel, separate repo)` → `14 Supabase decommission`.

## BLOCKERS

1. **No access to the 3 `_v2` RPC definitions** — the core of checkout and inventory.
2. **No visibility of RLS policies** — the entire authorization model.
3. **Unknown whether Supabase password hashes can be exported.**
4. **Unknown Storage bucket names/visibility.**
5. **MongoDB replica set is mandatory** (order transactions) — infrastructure approval needed.
6. **Money representation undecided** — blocks schema authoring.
7. **Product scope undecided** — coupons/reviews/notifications/variants/Arabic are half-built; migrate vs build vs drop must be settled before Phase 1.
8. **Committed secrets must be rotated now**, independent of the migration timeline.

## OPEN QUESTIONS

See §25.H — 22 numbered questions: 6 requiring production database access, 10 requiring product decisions, 6 requiring infrastructure/ownership decisions.

---

## Notes on this audit

- **Read-only guarantee.** During the audit no file was created, modified, renamed or deleted; no dependency was installed; no build, type-check or migration was executed; no database was contacted. All findings derive from reading the working tree plus `git status` / `git ls-files` / `git log`. This document itself was written afterwards, on explicit request.
- **No secret values appear anywhere in this report** — only names, file paths and line numbers.
- Every claim is tagged `FACT`, `INFERENCE`, `RECOMMENDATION` or `UNKNOWN`, with file paths and line numbers wherever a specific artifact is cited.
- **The single most important next action is Phase 0.5.** This audit can characterise everything the repository contains, but the three `_v2` database functions and the RLS policies are the load-bearing parts of the system and they are not in the repository. Any migration plan written without them is provisional.
