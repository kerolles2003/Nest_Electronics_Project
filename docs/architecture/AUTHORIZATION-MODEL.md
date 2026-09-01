# Authentication & Authorization Model — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADRs:** ADR-AUTH-001 … 006

---

## 1. The governing principle

> **Every request passes through the same pipeline. There is no privileged path that bypasses it.**

```
Client (Next.js | Flutter)
   ↓  Authorization: Bearer <access token>   |   httpOnly cookie
JwtAuthGuard          — who are you?              → 401
RolesGuard            — what role do you hold?    → 403
OwnershipGuard        — is this resource yours?   → 404
ValidationPipe        — is the payload well-formed and whitelisted? → 400
Service layer         — do the business rules permit this?         → 409/422
Repository
   ↓
MongoDB
```

**The legacy failure this replaces.** Phase 0.5 found four `SECURITY DEFINER` PostgreSQL functions granted `EXECUTE` to `anon`, containing **no authorization checks at all**. Any holder of the public anon key could change any order's status, alter any product's stock, forge audit entries, and create orders for arbitrary users — bypassing 52 correctly-written RLS policies entirely (F-CRIT-1).

The architectural lesson is not "write better policies". It is that **a second, privileged access path existed at all**. The new system has exactly one path from client to data, and it runs through the guards above.

Forbidden by construction:
- ❌ Any client → database connection
- ❌ Any stored procedure, trigger, or database function containing business logic
- ❌ Any endpoint that accepts `userId`, `role`, `price`, or `status` from the request body as authoritative
- ❌ Any authorization decision made only in the frontend

---

## 2. Authentication

### 2.1 Method

**Email + password**, owned by the NestJS API. No third-party identity provider in MVP.

| Legacy | New | Reason |
|---|---|---|
| Supabase GoTrue, called **from the browser** with the anon key | NestJS `AuthModule`; the client never talks to an identity provider | Removes the last direct client→backend-service path |
| Google OAuth **advertised in the UI, disabled in the provider**; 0 Google identities ever created | **REMOVED from MVP** | A non-functional button. Not a requirement. Revisit as a real, tested feature (ADR-AUTH-005). |

### 2.2 Password storage

| Property | Decision |
|---|---|
| Algorithm | **bcrypt, cost factor 12** |
| Why bcrypt over argon2id | Legacy hashes are bcrypt `$2a$`; bcrypt is battle-tested, has a stable Node binding, and cost 12 is appropriate for this scale. argon2id is marginally stronger but adds a native dependency for no practical gain here. |
| Migration | **Not required.** There are no production users — the 4 development accounts are discarded. The Phase 0.5 finding that hashes are portable is therefore moot, though it remains true. |
| Rules | Hash never leaves `AuthModule`. No DTO, log, or response may contain it. Structurally enforced: no other module imports the credential repository. |

### 2.3 Password policy

Enforced **server-side** — legacy validated `min(8)` in the browser only, which is bypassable.

| Rule | Value |
|---|---|
| Minimum length | **10 characters** |
| Maximum length | 128 (bcrypt truncates at 72 bytes; reject beyond) |
| Composition rules | **None** — length beats forced symbol classes |
| Blocklist | Reject the ~10k most common passwords |
| Reuse of email as password | Rejected |

### 2.4 Registration

```
POST /api/v1/auth/register
{ "email", "password", "fullName", "phone"? }
```

1. Validate; normalise email to lowercase; reject duplicates with a **generic** message (no account enumeration).
2. Hash the password.
3. Create the `users` document in **one transaction** — `role: 'CUSTOMER'` set by the server, never from the payload.
4. Issue an email-verification token (32-byte random, hashed at rest, 24-hour TTL).
5. **Return `201` with no session.**

| Legacy defect | Fix |
|---|---|
| `handle_new_user` DB trigger created the profile | Explicit creation in the registration transaction; the 1:1 merge removes the trigger |
| `full_name` fell back to the **email address** | `fullName` is **required** — an email as a display name is a data-quality bug |
| Redirected to a guarded route with no session → bounced to `/login` with no explanation | Response explicitly states that verification is required; the UI shows "check your email" |
| `role` could theoretically be set at signup | `role` is absent from `RegisterDto`; `forbidNonWhitelisted` rejects it |

### 2.5 Email verification

**Required before login** (preserves the legacy `mailer_autoconfirm = false` posture, which was correct).

```
POST /api/v1/auth/verify-email     { "token" }
POST /api/v1/auth/resend-verification  { "email" }   [rate-limited]
```

Unverified login attempts return `403 EMAIL_NOT_VERIFIED` — distinguishable from bad credentials so the UI can offer a resend, without revealing whether the address exists to an *unauthenticated* enumerator (the response is only reachable with a correct password).

### 2.6 Login

```
POST /api/v1/auth/login   { "email", "password" }
→ { accessToken, refreshToken, user: { id, fullName, email, role } }
```

- Constant-time comparison; identical generic error for unknown email and wrong password.
- **Rate-limited** (§7) — legacy had none anywhere.
- Records `lastLoginAt`.

### 2.7 Token model (ADR-AUTH-002)

| | Access token | Refresh token |
|---|---|---|
| Type | JWT (HS256) | Opaque 32-byte random |
| Lifetime | **15 minutes** | **30 days** |
| Storage (Web) | httpOnly, Secure, SameSite=Lax cookie | httpOnly, Secure, SameSite=Strict cookie |
| Storage (Flutter) | Response body → secure storage | Response body → secure storage |
| Revocable | No (short-lived by design) | **Yes** — hashed and stored server-side |

**Access-token claims:**

```jsonc
{ "sub": "<userId>", "role": "CUSTOMER", "tv": 3, "iat": …, "exp": … }
```

> **`role` is a claim (ADR-AUTH-003).** Legacy looked up `profiles.role` on **every single request** — `profiles_pkey` was the hottest index in the entire database at 2,719 scans. Putting the role in the token removes that query.
>
> **Accepted trade-off:** a role change takes effect at the next token refresh (≤ 15 minutes). Mitigated by `tv` (token version): incrementing `user.tokenVersion` invalidates all existing access tokens immediately for security-critical changes (role change, password change, forced logout). The guard compares `tv` against the user record **only** for privileged operations, so the common path stays lookup-free.

**Refresh rotation:** each refresh issues a new refresh token and revokes the old one. Presenting an already-revoked token is treated as theft: the entire token family is revoked and the event is audited.

**Dual transport is deliberate** — cookies for the web app (XSS-resistant), bearer tokens for Flutter (no cookie jar). Both are issued by the same endpoint; the client chooses via an `X-Client-Type` header or simply reads the body.

### 2.8 Password reset (currently completely broken)

Legacy: `forgot-password/form.tsx` referenced `ROUTES.auth.callback`, which **does not exist** in `constants.ts`, so the form threw a `TypeError` on submit. There was no set-password page. `auth.flow_state` is empty — **reset has never worked for any user**.

```
POST /api/v1/auth/forgot-password  { "email" }
    → ALWAYS 200 with a generic message (no account enumeration)
    → if the account exists: single-use token, hashed at rest, 1-hour TTL, emailed
POST /api/v1/auth/reset-password   { "token", "newPassword" }
    → validate, hash, set
    → increment tokenVersion  (invalidates all access tokens)
    → revoke ALL refresh tokens  (logout everywhere)
```

### 2.9 Logout

```
POST /api/v1/auth/logout        → revoke the presented refresh token
POST /api/v1/auth/logout-all    → revoke every refresh token for the user
```

Legacy had **three** client-side sign-out implementations, one of which navigated outside the admin `basePath`, and **no server-side invalidation at all**. One endpoint replaces them.

---

## 3. Roles

> **DECISION (ADR-AUTH-004): three roles, no permission system.**

| Role | Who | Capability |
|---|---|---|
| `CUSTOMER` | Default for every registration | Own cart, orders, profile, addresses, reviews |
| `ADMIN` | Staff | All catalogue, inventory, order and content operations |
| `SUPER_ADMIN` | Owner | Everything, **plus** role management, user deletion, hard deletes |

### Why roles and not permissions

A permission/ability system (CASL was proposed in Phase 0) was evaluated and **rejected for MVP**:

- The live system has **4 users** — 3 customers and 1 super-admin. **No `ADMIN`-role user has ever existed.**
- There are three actor classes and no evidence of a fourth.
- Granular permissions add a permission collection, assignment UI, evaluation layer and a whole test surface to model distinctions nobody has asked for.
- `PRODUCT.md` describes a small maker-focused store, not a multi-tenant marketplace.

Roles are declared with a decorator and checked by one guard. Simple, and completely auditable by reading the controller.

**Revisit condition:** if staff roles genuinely diverge (a "content editor" who may write blog posts but not touch inventory; a "fulfilment operator" who may ship but not price), introduce permissions then. The migration is additive — `@Roles()` becomes `@RequirePermission()` and roles become permission bundles.

### Real `ADMIN` / `SUPER_ADMIN` separation (new)

Legacy declared both roles but `is_admin()` and `requireAdmin()` treated them **identically** — the distinction existed in three places and was enforced in none.

| Operation | `ADMIN` | `SUPER_ADMIN` |
|---|---|---|
| Products, categories, brands, inventory, orders, reviews, content | ✅ | ✅ |
| Coupon management | ✅ | ✅ |
| View audit log | ✅ | ✅ |
| **Change a user's role** | ❌ | ✅ |
| **Delete a user** | ❌ | ✅ |
| **Hard-delete a product** | ❌ | ✅ |
| **Change another admin's account** | ❌ | ✅ |

A `SUPER_ADMIN` cannot demote or delete themselves — the last super-admin must always exist.

---

## 4. Ownership

Ownership is the second axis. Holding `CUSTOMER` is not sufficient; the resource must belong to *you*.

| Resource | Rule | Derivation |
|---|---|---|
| Profile | `user._id === jwt.sub` | `/users/me` — no id in the path at all |
| Addresses | Sub-resource of the user document | `/users/me/addresses/:addressId` |
| Cart | `cart.userId === jwt.sub` | `/cart` — no id in the path |
| Orders | `order.userId === jwt.sub` | Enforced in the query, not post-fetch |
| Reviews | `review.userId === jwt.sub` (edit only while `PENDING`) | |

**Three non-negotiable rules:**

1. **`userId` is always taken from the JWT, never from the request.** No DTO in the system contains a `userId` field. This is the direct structural fix for F-CRIT-2, where `create_order_v2` accepted `p_user_id` as a parameter and never compared it to the caller.
2. **Ownership is a query filter, not a post-fetch check.** `findOne({ _id, userId })`, never `findOne({_id})` followed by an `if`. This makes leaking a document by forgetting a check impossible.
3. **A resource owned by someone else returns `404`, not `403`.** A `403` confirms the resource exists and turns an id into an oracle.

Admins bypass ownership by role (`orders_own_read` in legacy was `(auth.uid() = user_id) OR is_admin()` — that intent is **PRESERVED**).

---

## 5. RLS → guard translation

The legacy RLS policy set was, per Phase 0.5, *largely sound* — it was simply bypassed. Its **intent** is preserved and made explicit.

| Legacy RLS policy | New enforcement | Status |
|---|---|---|
| `products/categories/brands_public_read USING (is_active AND deleted_at IS NULL)` | Public repository always applies the filter; `@Public()` route | **PRESERVE** |
| `product_images/attributes/... _public_read USING (true)` (7 tables) | **Child visibility inherits the parent's** — embedded in the product document, so it is automatic | **FIX** — legacy leaked images/specs of hidden products |
| `profiles_select_own USING (auth.uid() = id OR is_admin())` | `GET /users/me`; `GET /admin/customers/:id` | **PRESERVE** |
| `profiles_update_own WITH CHECK (role = 'customer')` | `UpdateProfileDto` has **no `role` field**; `forbidNonWhitelisted: true` | **PRESERVE (strengthened)** — a whitelist beats a check |
| *(no INSERT policy on `profiles`)* → customer profile save failed | `PATCH /users/me` | **FIX** — the defect disappears with browser DB access |
| `addresses_own ALL` | `/users/me/addresses/*` | **PRESERVE** |
| `orders_own_read USING (auth.uid() = user_id OR is_admin())` | `OrdersService.findForUser(userId, id)` | **PRESERVE** |
| `orders_own_insert WITH CHECK (auth.uid() = user_id)` | `userId` from the JWT | **PRESERVE (was bypassed)** |
| `orders_admin_update USING (is_admin())` | `@Roles('ADMIN','SUPER_ADMIN')` + server-side transition matrix | **FIX** — was bypassed by the RPC |
| `reviews_public_read USING (moderation_status = 'approved')` | Public list filters `APPROVED` | **PRESERVE** |
| `reviews_own_update USING (... AND moderation_status = 'pending')` | Service rule | **PRESERVE** |
| `coupons_admin_all` (no public read) | Only `POST /coupons/validate` is public; the coupon collection is never listed publicly | **PRESERVE** |
| `inventory_admin_all` | `@Roles('ADMIN')`; writes only via `InventoryService` | **PRESERVE** |
| `audit_logs_admin_*` | Written by a system-privileged interceptor, never by the acting principal | **FIX** |
| `carts_own` / `cart_items_own` | `/cart` bound to the JWT subject | **PRESERVE** |
| `recently_viewed_own USING (auth.uid() = user_id OR session_id IS NOT NULL)` | **Not ported** — feature removed | **REMOVE** — the predicate constrained the *row*, not the *caller*, making it world-writable |
| `is_admin()` (28 policies) | `RolesGuard`, with `ADMIN`/`SUPER_ADMIN` finally distinguished | **PRESERVE + FIX** |

**Phase 2 deliverable:** this table becomes a **traceability matrix** — one row per policy, each with a passing authorization test. That matrix is the only credible evidence that migration risk **R2** is discharged.

---

## 6. Authorization test matrix

Every endpoint is tested against every principal. This is the direct replacement for RLS and the primary regression net.

| Principal | Description |
|---|---|
| `anonymous` | No token |
| `customer_a` | Owns the resource |
| `customer_b` | Authenticated, owns nothing relevant — **the IDOR probe** |
| `admin` | `ADMIN` |
| `super_admin` | `SUPER_ADMIN` |
| `expired` | Valid signature, expired |
| `tampered` | Modified payload |

**Mandatory cases** (from `baseline-test-cases.md` §5):

| Case | Expected |
|---|---|
| `customer_b` reads `customer_a`'s order | **404** |
| `customer_b` reads `customer_a`'s address | **404** |
| `customer_b` cancels `customer_a`'s order | **404** |
| `anonymous` places an order | **401** |
| `anonymous` calls any admin endpoint | **401** |
| `customer` calls any admin endpoint | **403** |
| `admin` changes a user's role | **403** |
| `super_admin` changes a user's role | **200** |
| Any principal sets `role` in a profile update | **400** (`forbidNonWhitelisted`) |
| Any principal sets `stock` via product update | **400** |
| Any principal sets a price on an order | **400** |
| `tampered` / `expired` token on any protected route | **401** |
| Anonymous reads an inactive product's images | **404** |

---

## 7. Rate limiting

Legacy had **none anywhere**, and its one "rate limit" was in-memory client state reset by a page reload.

| Endpoint group | Limit | Key |
|---|---|---|
| `POST /auth/login` | 5 / 15 min | IP + email |
| `POST /auth/register` | 3 / hour | IP |
| `POST /auth/forgot-password` | 3 / hour | IP + email |
| `POST /auth/resend-verification` | 3 / hour | email |
| `POST /orders/track` | **10 / hour** | IP |
| `POST /orders` | 10 / hour | userId |
| `POST /contact` | 5 / hour | IP |
| Global authenticated | 300 / min | userId |
| Global anonymous | 100 / min | IP |

MVP uses `@nestjs/throttler` with in-memory storage (single instance). **This is the trigger condition for Redis** — see [`REDIS-DECISION.md`](./REDIS-DECISION.md): the moment the API runs on more than one instance, in-memory counters become per-instance and the limit silently multiplies.

---

## 8. Public endpoints

Authentication is **global by default** (`APP_GUARD`); public routes are explicitly opted out with `@Public()`. This is deliberately the safe direction: forgetting the decorator makes a route *inaccessible*, not *unprotected*. Legacy's admin `/api/*` handlers relied on a route-matcher with no in-handler check — a matcher regression would have silently exposed them (M6).

| Public | Notes |
|---|---|
| `GET /products`, `/products/:slug`, `/categories`, `/brands`, `/attributes` | Active, non-deleted only |
| `GET /products/:id/reviews` | Approved only |
| `GET /blog`, `/blog/:slug` | Published only |
| `POST /auth/*` (register, login, refresh, forgot, reset, verify) | Rate-limited |
| `POST /orders/track` | Rate-limited, minimal projection |
| `POST /coupons/validate` | Rate-limited |
| `POST /contact` | Rate-limited |
| `GET /health` | |

Everything else requires authentication.

---

## 9. Guest users

Guests may **browse, search, read approved reviews, read the blog, hold a client-side cart, and track an order with an order number + matching phone**.

Guests may **not** check out. See [`GUEST-CHECKOUT.md`](./GUEST-CHECKOUT.md) for the decision and the secure tracking design.

---

## 10. Data-protection rules

| Rule | Enforcement |
|---|---|
| `passwordHash` never leaves `AuthModule` | Separate credential repository; no other module imports it |
| `costPrice` never in a public DTO | Separate `ProductPublicDto` / `ProductAdminDto` types |
| `adminNote` never in a customer DTO | Separate order DTOs |
| Customer PII never in a public tracking response | Minimal projection ([`GUEST-CHECKOUT.md`](./GUEST-CHECKOUT.md)) |
| No driver/database error text reaches a client | Global exception filter ([`API-STANDARDS.md`](./API-STANDARDS.md)) — legacy leaked raw PostgREST errors in ~20 places |
| Tokens, passwords and `authorization` headers redacted in logs | Pino redaction |
| Email enumeration prevented | Generic responses on register, login and forgot-password |

---

## 11. Summary of decisions

| # | Decision | Fixes |
|---|---|---|
| 1 | **One request pipeline; no privileged bypass** | F-CRIT-1 — four `anon`-executable `SECURITY DEFINER` RPCs |
| 2 | All auth server-side; no client→identity-provider calls | 6 browser `auth.*` call sites |
| 3 | JWT access (15 min) + rotating opaque refresh (30 d) | No revocation existed |
| 4 | **`role` as a JWT claim** + `tokenVersion` escape hatch | Removes the hottest query in the system |
| 5 | bcrypt cost 12; server-side policy, ≥ 10 chars | Client-only `min(8)` |
| 6 | Email verification required; registration explains it | Flow dead-ended at `/login` |
| 7 | **Working password reset** + logout-everywhere | Threw a `TypeError`; never worked |
| 8 | Google OAuth **removed** from MVP | Advertised but disabled; 0 identities |
| 9 | **3 roles, no permission system** | Avoids overengineering for 4 users |
| 10 | **Real `SUPER_ADMIN` separation** | Declared in 3 places, enforced in none |
| 11 | `userId` **always** from the JWT; no DTO carries it | F-CRIT-2 — ownership forgery |
| 12 | Ownership as a **query filter**; cross-user → **404** | Prevents IDOR and existence oracles |
| 13 | Auth **global by default**, `@Public()` opt-out | Matcher-only protection (M6) |
| 14 | Rate limiting on all sensitive endpoints | None existed |
| 15 | Audit written by the **system**, never the audited principal | M12 |
