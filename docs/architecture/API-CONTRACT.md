# API Contract — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADR:** ADR-API-001, 002

> **Two independent clients consume this API: the Next.js web app and a Flutter mobile app built in a separate repository by a separate developer.** The contract must therefore be complete, explicit and self-describing — a Flutter developer must be able to build against it without reading any backend code or asking questions.
>
> Conventions here are normative. Error format details live in [`API-STANDARDS.md`](./API-STANDARDS.md).

---

## 1. Foundations

| Concern | Decision |
|---|---|
| **Base path** | `/api/v1` |
| **Versioning** | URI path versioning. `v1` from day one. |
| **Protocol** | HTTPS only. HTTP → 301. |
| **Format** | JSON only. `Content-Type: application/json` (except multipart upload). |
| **Character set** | UTF-8 |
| **Dates** | **ISO 8601 UTC with `Z`** — `2026-08-30T14:22:31.000Z`. Never a local time, never a Unix epoch. |
| **IDs** | 24-character hex string (MongoDB ObjectId), e.g. `"652f1a9b3c4d5e6f7a8b9c0d"`. Opaque to clients. |
| **Money** | `{ amount: <int minor units>, currency: "EGP", formatted: "150.75 EGP" }` — [`MONEY-MODEL.md`](./MONEY-MODEL.md) §8 |
| **Booleans** | Real JSON booleans, never `"true"` |
| **Nulls** | Optional fields are `null`, not omitted — Dart null-safety benefits from a stable shape |
| **Enums** | `SCREAMING_SNAKE_CASE` strings |
| **Field naming** | `camelCase` |
| **Localised text** | Resolved to a plain string server-side per `Accept-Language`; clients never receive `{en, ar}` |

### Why URI versioning over headers

Header-based versioning is arguably cleaner, but URI versioning is trivially visible in logs, browser address bars, curl commands and Flutter's `Dio` base URL. With an independent mobile client shipping on its own schedule, the ability to run `v1` and `v2` side by side and see which is in use is worth more than elegance. Legacy had **no versioning at all**.

---

## 2. Authentication

| Client | Access token | Refresh token |
|---|---|---|
| **Web (Next.js)** | httpOnly `Secure` `SameSite=Lax` cookie | httpOnly `Secure` `SameSite=Strict` cookie |
| **Mobile (Flutter)** | `Authorization: Bearer <jwt>` | Response body → secure storage |

Both are issued by the same endpoints. The client signals its preference with `X-Client-Type: web | mobile`; `web` receives `Set-Cookie`, `mobile` receives tokens in the body.

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

- Access token: **15 minutes**. Refresh token: **30 days**, rotating.
- On `401 TOKEN_EXPIRED`, the client calls `POST /auth/refresh` once and retries. On a second `401`, it logs out.
- Every endpoint requires authentication **unless explicitly marked 🌐 Public**.

---

## 3. Response envelope

**Success — single resource**

```jsonc
{ "data": { … } }
```

**Success — collection**

```jsonc
{
  "data": [ … ],
  "meta": { "page": 1, "limit": 24, "total": 137,
            "totalPages": 6, "hasNext": true, "hasPrev": false }
}
```

**Error** — see [`API-STANDARDS.md`](./API-STANDARDS.md)

```jsonc
{ "error": { "code": "VALIDATION_ERROR", "message": "Validation failed",
             "details": [ { "field": "quantity", "message": "Must be at least 1" } ],
             "requestId": "01J…", "timestamp": "2026-08-30T14:22:31.000Z" } }
```

> **One envelope, always.** Legacy returned at least ten different shapes (`{success,error}`, `{success,productId}`, `{success,newStock}`, bare `Cart|null`, bare `string[]`, `{attributes:[]}`, `{exists:bool}`…), which is unusable for a generated client.

**Every response carries `X-Request-Id`.**

---

## 4. Collection conventions

### Pagination — offset-based

```
?page=1&limit=24
```

`page` ≥ 1 (default 1) · `limit` 1–100 (default 24). Offset pagination is chosen over cursors because catalogue and order lists need jump-to-page UI; the collections are small enough that deep-offset cost is irrelevant.

> Legacy pagination totals were **wrong by construction** — `count:'exact'` applied to an already-paginated RPC result. `meta.total` here is the true match count.

### Sorting

`?sort=<field>` with a documented allow-list per endpoint. Unknown values → `400`.

### Filtering

Explicit named parameters only. **No generic query-language passthrough** — legacy interpolated user input into PostgREST `.or()`/`.ilike()` filter strings in 6 places, allowing a caller to restructure the filter tree.

### Search

`?q=<text>`, max 100 chars.

---

## 5. Endpoint catalogue

🌐 = public (no auth) · 🔒 = authenticated · 👤 = owner-scoped · 🛡 = ADMIN · 👑 = SUPER_ADMIN

### 5.1 Authentication — `/auth`

| Method | Path | Auth | Request | Response | Purpose |
|---|---|---|---|---|---|
| POST | `/auth/register` | 🌐 | `{email, password, fullName, phone?}` | `{message, emailVerificationRequired: true}` | Create account. **No session issued** — verification required. |
| POST | `/auth/verify-email` | 🌐 | `{token}` | `{message}` | Complete verification |
| POST | `/auth/resend-verification` | 🌐 | `{email}` | `{message}` | Rate-limited; generic response |
| POST | `/auth/login` | 🌐 | `{email, password}` | `{accessToken, refreshToken, user}` | Rate-limited 5/15min |
| POST | `/auth/refresh` | 🌐 | `{refreshToken}` | `{accessToken, refreshToken}` | Rotating |
| POST | `/auth/logout` | 🔒 | `{refreshToken?}` | `{message}` | Revoke this session |
| POST | `/auth/logout-all` | 🔒 | — | `{message}` | Revoke every session |
| POST | `/auth/forgot-password` | 🌐 | `{email}` | `{message}` | **Always 200** — no account enumeration |
| POST | `/auth/reset-password` | 🌐 | `{token, newPassword}` | `{message}` | Revokes all sessions |
| GET | `/auth/me` | 🔒 | — | `{user}` | Current principal |

**No OAuth endpoints in v1** — Google was advertised in the UI but disabled in the provider, with 0 identities ever created.

### 5.2 Catalog — `/products`, `/categories`, `/brands`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/products` | 🌐 | **The main discovery endpoint.** Full query surface in [`SEARCH-MODEL.md`](./SEARCH-MODEL.md) §4. Returns `data`, `meta`, `facets`. |
| GET | `/products/suggest?q=` | 🌐 | Autocomplete, ≤ 8 lightweight results |
| GET | `/products/:slug` | 🌐 | Detail. Unknown slug → checks `slugRedirects` → **301** |
| GET | `/products/:slug/related` | 🌐 | Same category, by `salesCount` |
| GET | `/products/:id/reviews` | 🌐 | Approved only, paginated |
| GET | `/categories` | 🌐 | Flat list |
| GET | `/categories/tree` | 🌐 | Nested tree (cached) |
| GET | `/categories/:slug` | 🌐 | Detail + breadcrumb |
| GET | `/brands` | 🌐 | List |
| GET | `/brands/:slug` | 🌐 | Detail |
| GET | `/specs` | 🌐 | Filterable spec definitions for facet UI |

**Admin:**

| Method | Path | Auth |
|---|---|---|
| GET/POST | `/admin/products` | 🛡 |
| GET/PATCH/DELETE | `/admin/products/:id` | 🛡 (DELETE = soft) |
| DELETE | `/admin/products/:id/permanent` | 👑 |
| POST | `/admin/products/:id/duplicate` | 🛡 |
| PATCH | `/admin/products/:id/publish` | 🛡 |
| POST | `/admin/products/:id/images` | 🛡 multipart |
| DELETE | `/admin/products/:id/images/:publicId` | 🛡 |
| PATCH | `/admin/products/:id/images/order` | 🛡 (one atomic reorder) |
| PATCH | `/admin/products/:id/images/:publicId/primary` | 🛡 |
| GET/POST/PATCH/DELETE | `/admin/categories[/:id]` | 🛡 |
| GET/POST/PATCH/DELETE | `/admin/brands[/:id]` | 🛡 |

> `PATCH /admin/products/:id` **rejects** `stock` and `rating` with `400` — those fields belong to Inventory and Reviews. This closes the legacy path where a generic product update changed stock with no ledger entry.

### 5.3 Cart — `/cart`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/cart` | 🔒👤 | **Re-priced on every read**, with per-line status flags |
| POST | `/cart/items` | 🔒👤 | `{productId, quantity}` |
| PATCH | `/cart/items/:productId` | 🔒👤 | `{quantity}` |
| DELETE | `/cart/items/:productId` | 🔒👤 | Idempotent |
| DELETE | `/cart` | 🔒👤 | Clear |
| POST | `/cart/merge` | 🔒👤 | `{items:[{productId, quantity}]}` — called once at login |

No `userId` anywhere — it comes from the token.

### 5.4 Checkout & orders — `/orders`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/checkout/quote` | 🔒👤 | `{addressId?, governorate?, couponCode?}` → full price breakdown, **no side effects** |
| POST | `/coupons/validate` | 🔒 | `{code}` → `{valid, discountAmount, grandTotal}` \| `{valid:false, reason}` |
| **POST** | **`/orders`** | 🔒👤 | **Place an order.** Requires `Idempotency-Key`. Body: `{addressId \| shippingAddress, couponCode?, customerNote?}` — **no items, no prices, no userId** |
| GET | `/orders` | 🔒👤 | Own orders, paginated |
| GET | `/orders/:id` | 🔒👤 | Own order; another user's → **404** |
| PATCH | `/orders/:id/cancel` | 🔒👤 | `{reason}` — only while `PLACED`/`CONFIRMED` |
| POST | `/orders/track` | 🌐 | `{orderNumber, phone}` — rate-limited 10/h, **minimal projection** ([`GUEST-CHECKOUT.md`](./GUEST-CHECKOUT.md) §3.4) |

**Admin:**

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/orders` | 🛡 filter by status, date, search |
| GET | `/admin/orders/:id` | 🛡 |
| PATCH | `/admin/orders/:id/status` | 🛡 `{status, note?, carrier?, trackingNumber?, reason?}` |
| PATCH | `/admin/orders/:id/payment` | 🛡 `{status, refundedAmount?, refundNote?}` |
| GET | `/admin/dashboard/stats` | 🛡 **One aggregated endpoint** replacing 8 queries + JS reduction |

`carrier` and `trackingNumber` are **required** when transitioning to `SHIPPED` — otherwise `400`.

### 5.5 Users — `/users`

| Method | Path | Auth |
|---|---|---|
| GET / PATCH | `/users/me` | 🔒👤 (PATCH accepts only `fullName`, `phone`, `avatar`) |
| POST | `/users/me/change-password` | 🔒👤 |
| GET / POST | `/users/me/addresses` | 🔒👤 |
| PATCH / DELETE | `/users/me/addresses/:addressId` | 🔒👤 |
| POST | `/users/me/addresses/:addressId/default` | 🔒👤 (atomically unsets siblings) |
| GET | `/admin/customers` | 🛡 |
| GET | `/admin/customers/:id` | 🛡 |
| PATCH | `/admin/users/:id/role` | 👑 **only** |
| DELETE | `/admin/users/:id` | 👑 **only** |

### 5.6 Inventory — `/admin/inventory`

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/inventory` | 🛡 stock levels, low-stock filter |
| POST | `/admin/inventory/:productId/adjust` | 🛡 `{delta, reason, type}` |
| GET | `/admin/inventory/:productId/events` | 🛡 ledger history |
| GET | `/admin/inventory/reconciliation` | 🛡 asserts `Σ events == onHand` |

### 5.7 Reviews, content, coupons, media, health

| Method | Path | Auth |
|---|---|---|
| POST | `/products/:id/reviews` | 🔒 (one per user per product) |
| PATCH / DELETE | `/reviews/:id` | 🔒👤 (edit only while `PENDING`) |
| GET / PATCH / DELETE | `/admin/reviews[/:id]` | 🛡 moderation |
| GET | `/blog`, `/blog/:slug`, `/blog/categories` | 🌐 |
| GET/POST/PATCH/DELETE | `/admin/blog[/:id]` | 🛡 |
| GET/POST/PATCH/DELETE | `/admin/coupons[/:id]` | 🛡 |
| GET | `/admin/coupons/:id/redemptions` | 🛡 |
| POST | `/admin/media/upload` | 🛡 multipart |
| GET | `/admin/audit-logs` | 🛡 |
| POST | `/contact` | 🌐 rate-limited |
| GET | `/health`, `/health/ready` | 🌐 |

---

## 6. Endpoints that will NOT exist

| Not built | Reason |
|---|---|
| Guest checkout | [`GUEST-CHECKOUT.md`](./GUEST-CHECKOUT.md) |
| `POST /orders` with items or prices in the body | Client must never influence what it pays |
| Anything accepting `userId` in a body | Always from the token |
| `PATCH` on stock via product update | Inventory owns stock |
| `DELETE /orders/:id` | Orders are financial records |
| Wishlist endpoints | Client-side in MVP |
| In-app notification endpoints | Feature removed |
| OAuth endpoints | Removed from v1 |
| Generic filter/query passthrough | Legacy's PostgREST filter injection |
| `/search` | Merged into `/products?q=` |

---

## 7. Standard status codes

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 204 | No content (delete) |
| 301 | Moved permanently (slug redirect) |
| 400 | Validation error / malformed request |
| 401 | Missing, expired or invalid token |
| 403 | Authenticated but not permitted |
| 404 | Not found **or not yours** |
| 409 | Conflict — out of stock, invalid transition, duplicate slug |
| 422 | Semantically invalid business operation |
| 429 | Rate limited (`Retry-After` header) |
| 500 | Internal error (never leaks details) |
| 503 | Dependency unavailable |

**`404` for another user's resource, never `403`.** A `403` confirms existence.

---

## 8. Contract publication

| Artifact | Source |
|---|---|
| `openapi.json` | Generated by `@nestjs/swagger` from DTO decorators |
| Interactive docs | `/api/v1/docs` (Swagger UI) — non-production, or auth-gated |
| TypeScript client | `openapi-typescript` → `packages/api-client` for Next.js |
| Dart client | `openapi-generator` → the Flutter repository |

**The OpenAPI document is the acceptance artifact of the contract freeze.** It is generated from the same decorators that perform runtime validation, so drift between documentation and behaviour is structurally impossible — unlike legacy, which had **no contract, no OpenAPI and no versioning**.

Once published, `v1` is **additive-only**: new optional fields and new endpoints are allowed; removing a field, renaming one, changing a type, or tightening validation requires `v2`. This matters because the Flutter app ships independently and older versions remain installed on real devices.

---

## 9. Flutter-specific guarantees

Because the mobile client is built by a separate developer in a separate repository:

1. **Stable shapes** — optional fields are `null`, never absent, so Dart models are generated once.
2. **No implicit locale** — text is resolved server-side; the client sends `Accept-Language`.
3. **Money is never parsed from a string** — `amount` is an integer; `formatted` is display-only.
4. **Bearer tokens supported first-class** — no cookie jar required.
5. **All enums documented in OpenAPI** — generated as Dart enums.
6. **No endpoint requires a browser feature** — no redirects for auth, no cookies mandatory, no HTML.
7. **Errors are machine-readable** — `error.code` is a stable enum, safe to switch on; `error.message` is human-facing and may change.
8. **Pagination is uniform** — one `meta` shape everywhere.

---

## 10. Summary

| Aspect | Decision |
|---|---|
| Base path / versioning | `/api/v1`, URI-versioned, additive-only within v1 |
| Envelope | `{data, meta?}` / `{error}` — one shape |
| Auth | JWT 15 min + rotating refresh 30 d; cookies for web, bearer for mobile |
| IDs / dates / money | ObjectId hex · ISO 8601 UTC · integer minor units + currency |
| Pagination | Offset, uniform `meta`, **true totals** |
| Ownership | `userId` always from the token; foreign resources → **404** |
| Public surface | Catalogue, blog, auth, tracking, coupon validation, contact, health |
| Contract | OpenAPI generated from DTOs; TS + Dart clients generated from it |
| Removed | Guest checkout · OAuth · wishlist · in-app notifications · `/search` · filter passthrough |
