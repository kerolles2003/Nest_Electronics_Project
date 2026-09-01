# API Standards & Error Model — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADR:** ADR-API-003

> Legacy returned at least **ten different response shapes** and leaked raw PostgREST/PostgreSQL error text to clients in ~20 places. Both are unacceptable for an API consumed by an independently-shipped Flutter client.

---

## 1. Error response format

**Every error, from every endpoint, uses exactly this shape.**

```jsonc
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "quantity", "message": "Must be at least 1", "code": "MIN" },
      { "field": "email",    "message": "Must be a valid email address", "code": "FORMAT" }
    ],
    "requestId": "01JC8XQZ2N4K5M6P7R8S9T0V1W",
    "timestamp": "2026-08-30T14:22:31.000Z"
  }
}
```

| Field | Type | Presence | Purpose |
|---|---|---|---|
| `code` | string enum | **always** | **Machine-readable.** Stable across versions — clients switch on this. |
| `message` | string | **always** | Human-readable, English, safe to display. **May change between releases** — never parse it. |
| `details` | array \| absent | validation errors only | Per-field errors for form binding |
| `requestId` | string | **always** | Correlates with server logs; show it in support UI |
| `timestamp` | ISO 8601 UTC | **always** | Clock-skew diagnosis |

The HTTP status code is authoritative for the *class* of error; `code` identifies the *specific* condition.

### Why not RFC 7807 `application/problem+json`

Phase 0 recommended RFC 7807. It is rejected in favour of the envelope above:

- The success envelope is already `{data, meta}`; `{error}` is symmetric and lets a client branch on the presence of one key.
- RFC 7807's `type` URI adds a documentation-hosting obligation for no practical gain here.
- Code generators produce cleaner Dart/TypeScript models from a flat, consistent object.

Consistency with the success shape is worth more than standards compliance for a two-client private API.

---

## 2. Error code catalogue

Stable enum. Adding a code is additive; **removing or repurposing one is a breaking change.**

### Authentication — 401

| Code | Meaning |
|---|---|
| `UNAUTHENTICATED` | No credentials supplied |
| `TOKEN_EXPIRED` | Access token expired — **the client should refresh once and retry** |
| `TOKEN_INVALID` | Malformed, tampered, or wrong signature |
| `REFRESH_TOKEN_INVALID` | Refresh token unknown, expired, or already rotated |
| `REFRESH_TOKEN_REUSED` | A revoked token was replayed — **all sessions revoked**, treated as theft |
| `INVALID_CREDENTIALS` | Wrong email or password (deliberately identical for both) |

### Authorization — 403

| Code | Meaning |
|---|---|
| `FORBIDDEN` | Authenticated but insufficient role |
| `EMAIL_NOT_VERIFIED` | Verification required before this action |
| `ACCOUNT_DISABLED` | Account deactivated |

### Validation — 400

| Code | Meaning |
|---|---|
| `VALIDATION_ERROR` | One or more fields invalid — always carries `details` |
| `MALFORMED_REQUEST` | Unparseable body |
| `UNKNOWN_FIELD` | A field not in the DTO was supplied (`forbidNonWhitelisted`) |
| `MISSING_IDEMPOTENCY_KEY` | `POST /orders` without `Idempotency-Key` |
| `UNSUPPORTED_SORT` | `sort` value outside the allow-list |

> `UNKNOWN_FIELD` is a first-class code because it is a **security signal**: it fires when a client attempts to inject `role`, `stock`, `userId` or `price` into a DTO that does not accept them. These attempts are logged at `warn`.

### Not found — 404

| Code | Meaning |
|---|---|
| `RESOURCE_NOT_FOUND` | Generic |
| `PRODUCT_NOT_FOUND` · `ORDER_NOT_FOUND` · `CATEGORY_NOT_FOUND` · `BRAND_NOT_FOUND` · `REVIEW_NOT_FOUND` · `ADDRESS_NOT_FOUND` | Specific |

**A resource owned by another user returns `404`, never `403`** — a `403` would confirm existence and turn an id into an oracle.

### Conflict — 409

| Code | Meaning |
|---|---|
| `OUT_OF_STOCK` | Insufficient stock; `details` names the SKU and available quantity |
| `PRODUCT_UNAVAILABLE` | Inactive or soft-deleted at checkout |
| `INVALID_STATE_TRANSITION` | Not permitted by the order state machine |
| `CONCURRENT_MODIFICATION` | The resource changed between read and write |
| `DUPLICATE_SLUG` · `DUPLICATE_SKU` · `DUPLICATE_EMAIL` · `DUPLICATE_COUPON_CODE` | Uniqueness violation |
| `REVIEW_ALREADY_EXISTS` | One review per user per product |
| `COUPON_USAGE_EXCEEDED` | Global limit reached |
| `IDEMPOTENCY_KEY_REUSED` | An `Idempotency-Key` was replayed for a materially different request, or by a different account |

> `IDEMPOTENCY_KEY_REUSED` was **added** when checkout was implemented, under the additive rule at the top of this section. The catalogue enumerated `MISSING_IDEMPOTENCY_KEY` but had no code for a key that is present and conflicting. `CONCURRENT_MODIFICATION` was rejected for the case: that code tells a client to retry, and retrying a conflicting key never succeeds. The same code answers both the wrong-body and the wrong-account variants, so the header cannot be used to probe for other users' keys.

### Business rule — 422

| Code | Meaning |
|---|---|
| `CART_EMPTY` | Checkout with no items |
| `INSUFFICIENT_STOCK` | Adjustment would drive stock below zero |
| `COUPON_NOT_FOUND` · `COUPON_INACTIVE` · `COUPON_EXPIRED` · `COUPON_NOT_STARTED` · `COUPON_BELOW_MINIMUM` · `COUPON_USER_LIMIT_REACHED` · `COUPON_NO_EFFECT` | Coupon validation ([`DISCOUNT-MODEL.md`](./DISCOUNT-MODEL.md) §4) |
| `ORDER_NOT_CANCELLABLE` | Already dispatched |
| `TRACKING_REQUIRED` | Shipping without carrier/tracking |
| `INVALID_FILE_TYPE` · `FILE_TOO_LARGE` | Upload rejected |

### Rate limiting — 429

`RATE_LIMIT_EXCEEDED`, with a `Retry-After` header in seconds.

### Server — 5xx

| Code | Status |
|---|---|
| `INTERNAL_ERROR` | 500 — **never** carries detail |
| `SERVICE_UNAVAILABLE` | 503 — dependency down |
| `TRANSACTION_FAILED` | 503 — transaction aborted after retries |

---

## 3. The leakage rule

> **No database driver message, stack trace, collection name, index name, file path, or internal identifier may ever appear in a client response.**

Legacy violated this in roughly 20 places (`product.actions.ts:58`, `coupon.actions.ts:52`, `addresses/page.tsx:126`, …), returning raw PostgREST text that disclosed schema and constraint names. `adjust_stock_v2` would even have surfaced `violates check constraint "chk_available_stock"` directly to an admin UI.

The global `AllExceptionsFilter` enforces this:

```
Known domain exception   →  mapped code + safe message  →  logged at info/warn
Validation error         →  VALIDATION_ERROR + field details
Mongo duplicate key      →  DUPLICATE_* (index name inspected SERVER-SIDE only)
Any other exception      →  INTERNAL_ERROR, generic message
                            →  full detail + stack logged with requestId
```

The `requestId` is the bridge: a client reports it, and support finds the complete detail in the logs. Nothing sensitive crosses the boundary.

---

## 4. Validation

Global pipe configuration — non-negotiable:

```ts
new ValidationPipe({
  whitelist: true,             // strip unknown properties
  forbidNonWhitelisted: true,  // ...and REJECT the request instead
  transform: true,
  transformOptions: { enableImplicitConversion: false },
})
```

**`forbidNonWhitelisted: true` is a security control, not a convenience.** It is what makes these structurally impossible:

| Attempted injection | Result |
|---|---|
| `role` in a profile update | `400 UNKNOWN_FIELD` |
| `stock` in a product update | `400 UNKNOWN_FIELD` |
| `userId` in an order body | `400 UNKNOWN_FIELD` |
| `price` / `total` in a checkout body | `400 UNKNOWN_FIELD` |
| `isVerifiedPurchase` in a review | `400 UNKNOWN_FIELD` |

Legacy's `create_order_v2` accepted `p_user_id` as a parameter and never compared it to the caller (F-CRIT-2). Here the field does not exist in the DTO, so the attack has no surface to land on.

`enableImplicitConversion: false` is deliberate: implicit coercion would turn `"quantity": "-5"` into a number silently. Types must be correct on the wire.

---

## 5. Request standards

| Header | Direction | Purpose |
|---|---|---|
| `Authorization: Bearer <jwt>` | → | Mobile auth |
| `X-Client-Type: web \| mobile` | → | Selects cookie vs body token delivery |
| `Idempotency-Key: <uuid v4>` | → | **Required** on `POST /orders` |
| `Accept-Language: en \| ar` | → | Localised text resolution (defaults `en`) |
| `X-Request-Id` | ↔ | Client may supply; server generates if absent; **always echoed** |
| `Retry-After` | ← | On 429/503 |
| `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` | ← | Rate-limit state |

**Method semantics:** `GET` safe and idempotent · `POST` creates (non-idempotent except with `Idempotency-Key`) · `PATCH` partial update, idempotent · `PUT` **not used** (no full-replacement semantics anywhere) · `DELETE` idempotent, returns `204` even if already absent.

---

## 6. Security headers & CORS

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` (API returns only JSON) |
| `Cache-Control` | `no-store` on all authenticated responses |

Applied via Helmet. Legacy configured **no security headers at all** (Phase 0 L7).

**CORS:** explicit origin allow-list (storefront and admin domains), `credentials: true`, methods `GET, POST, PATCH, DELETE, OPTIONS`. **No wildcard.** Flutter is not subject to CORS but the allow-list must not be loosened on its account.

---

## 7. Caching

| Resource | Header |
|---|---|
| Product list / detail, categories, brands, blog | `public, max-age=60, stale-while-revalidate=300` |
| Category tree | `public, max-age=900` |
| Any authenticated response | `no-store` |
| Auth endpoints | `no-store` |

`ETag` on catalogue detail endpoints; `304` on `If-None-Match`.

---

## 8. Rate limiting

Per [`AUTHORIZATION-MODEL.md`](./AUTHORIZATION-MODEL.md) §7. On rejection:

```
HTTP 429
Retry-After: 900
{ "error": { "code": "RATE_LIMIT_EXCEEDED",
             "message": "Too many requests. Try again in 15 minutes.",
             "requestId": "…", "timestamp": "…" } }
```

Legacy had **no rate limiting anywhere**, and its only "limiter" was in-memory client state reset by a page reload.

---

## 9. Logging & correlation

Every request logs one structured line:

```jsonc
{ "level":"info", "requestId":"01JC8X…", "method":"POST", "path":"/api/v1/orders",
  "status":201, "durationMs":143, "userId":"652f…", "role":"CUSTOMER", "ip":"…" }
```

**Always redacted:** `authorization`, `cookie`, `password`, `newPassword`, `token`, `refreshToken`, `passwordHash`, `apiSecret`.

The same `requestId` appears in the log line, the error response and any audit entry — so a customer's screenshot leads directly to the server-side cause.

---

## 10. Health

```
GET /api/v1/health        → 200 { status: "ok" }                    (liveness)
GET /api/v1/health/ready  → 200 { status, checks: { mongo, cloudinary } }  (readiness)
                          → 503 when a dependency is down
```

Neither requires authentication; neither reveals versions or internal hostnames.

---

## 11. Summary

| Aspect | Decision |
|---|---|
| Error shape | **One** `{error:{code, message, details?, requestId, timestamp}}` |
| `code` | Stable machine-readable enum — clients switch on it |
| `message` | Human-facing, may change — never parsed |
| Driver errors | **Never** cross the boundary; correlated by `requestId` |
| Validation | `whitelist` + **`forbidNonWhitelisted`** — rejects `role`/`stock`/`userId`/`price` injection |
| Implicit conversion | **Disabled** |
| Foreign resources | **404**, never 403 |
| Idempotency | Required on `POST /orders` |
| Security headers | Helmet; strict CORS allow-list |
| Rate limits | Enforced server-side with `Retry-After` |
| Correlation | `X-Request-Id` in every response, log line and audit entry |
