# What is safe to integrate against

**Audience:** the Flutter developer.
**Source:** `PLAN.md` §19, kept in step with it.

Three lists. Build freely against the first, expect churn in the second, do not touch the
third. If something is not on any list, ask before you depend on it.

The contract itself is [`openapi.v1.json`](./openapi.v1.json) — the frozen artifact, checked
into git and guarded in CI by a drift gate. Build against **that file**, not against a
running server's `/docs-json`, which is whatever happens to be deployed at that moment.

---

## ✅ SAFE — stable, build on it now

| Area | Endpoints |
|---|---|
| Catalogue | products (list, detail, search, suggestions, related), categories (list, tree, detail), brands |
| Identity | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` |
| Verification | `POST /auth/verify-email`, `/auth/resend-verification` |
| Cart | the signed-in cart; re-priced on every read |
| Addresses | the address book, including the single-default invariant |
| Checkout | `POST /checkout/quote` — no side effects, no reservation |
| Orders | placement (idempotent), history, detail, self-service cancellation |
| Cross-cutting | the `{data}` / `{error}` envelope, `error.code`, rate-limit headers, `X-Request-Id` |

**The conventions that will not change inside v1:**

- **Envelope** — success is `{ "data": … }` (+ `meta` on collections, `facets` on search);
  every error is `{ "error": { code, message, … } }`. Branch on which key is present.
- **`error.code` is a stable enum — switch on it. `error.message` is human-facing and may
  change between releases; never parse it.** For a validation failure the useful sentence is
  in `error.details[0].message`, not in `error.message` (which is only `Validation failed.`).
- **Money is always `{ amount, currency, formatted }`**, `amount` an integer in **minor units
  (piastres)**. `formatted` is display-only. **Never do money arithmetic on the client** —
  every total comes from the server.
- **`POST /orders` requires an `Idempotency-Key`** and is safe to retry with the same key:
  `201` if that retry created the order, `200` if an earlier attempt already did. The body is
  identical — treat any 2xx as success.
- **IDs** are 24-character ObjectId hex strings, opaque.
- **Dates** are ISO 8601 UTC with `Z`.
- **Optional fields are `null`, never omitted** — so your Dart models stay stable.
- **Enums** are `SCREAMING_SNAKE_CASE`.
- **Localised text is resolved server-side** from `Accept-Language` (`en` or `ar`). You
  receive plain strings, never `{en, ar}`.
- **Unknown query parameters are rejected with `400 UNKNOWN_FIELD`** — a security control.
  Send only documented parameters.

### Auth, in the order you will implement it

1. `POST /auth/login` → an access token (**15 minutes**) and a refresh token (**30 days**).
2. On `401 TOKEN_EXPIRED`, call `POST /auth/refresh` **once**, store the new pair, retry the
   original request. A second 401 means sign out.
3. `401 REFRESH_TOKEN_REUSED` is **terminal**. The rotation chain has been revoked as a
   suspected theft. Clear stored tokens and send the user to sign in. Do not retry.
4. The whole catalogue is public and needs no token.

### `governorate` is a closed list of 27 values

`CreateAddressDto.governorate` and its update counterpart are an **enum**, not free text.
Send one of the 27 strings exactly as the schema spells them — case-sensitive. Surrounding
whitespace is trimmed for you; internal spelling is not corrected.

This changed after the first freeze. It was free text while the shipping rate table was
unresolved; D-8 settled that table as **one row per governorate with no fallback row**, so an
unrecognised value would reach a rate lookup at checkout with nothing to find. Rejecting it at
the address form is what makes that design safe.

**Build your picker from the enum in the artifact**, not from a hardcoded list — that way a
future governorate arrives with the contract instead of with a support ticket. A rejected
value returns `400 VALIDATION_ERROR` with `details[0].field === 'governorate'`.

### Read `shippingPriced`, never `shippingFee.amount === 0`

The one place where the obvious client-side shortcut is wrong.

`pricing.shippingFee` can be `0` for **two unrelated reasons**, and `pricing.shippingPriced`
is the field that tells them apart:

| `shippingPriced` | Meaning | Show |
|---|---|---|
| `true` | the fee is what the customer owes — **including when it is `0`** because a free-shipping threshold was met | the amount, or "Free" |
| `false` | no delivery rate has been supplied yet; the `0` is a placeholder | "Delivery not yet calculated" |

Today `shippingPriced` is `false` for every order. When real per-governorate rates land it
becomes `true` **without any other field changing**. A client that branches on the amount
will keep compiling, keep passing its tests, and start telling every free-shipping customer
that their delivery has not been worked out.

This field exists specifically so the code you write today still tells the truth then.

---

## ⚠️ UNSTABLE — coming, additively; do not design around them yet

These are planned inside v1 and will arrive as **new optional fields or new endpoints**,
entering this document and the drift gate as they land.

| Coming | Phase | What changes for you |
|---|---|---|
| Real shipping fee **values** | 5 | `shippingFee.amount` becomes non-zero and `shippingPriced` becomes `true`. **The shape is already final** — if you read `shippingPriced` today, nothing in your code changes. |
| Password reset (`request` / `confirm`) | 5 | new endpoints |
| Profile update (`PATCH /users/me`) | 5 | new endpoint |
| Media upload | 4 | new endpoint; **ships empty** — no product images exist yet |
| Coupons | 8 | `discountTotal` starts being non-zero; the field already exists |
| Reviews, wishlist, blog | 8 | new endpoints |
| Guest order tracking | 8 | new endpoint |

**The catalogue you see is seed data** — 26 development products. The real catalogue does not
exist yet and arrives later from a supplier feed. Do not hardcode product ids, slugs, SKUs or
category names; do not screenshot it for store listings.

---

## 🚫 FORBIDDEN — never integrate against these

- **Anything Supabase.** The legacy web app still talks to Supabase for some pages. That is a
  second, disjoint user population and a second catalogue, both scheduled for deletion. A
  mobile client must never hold a Supabase key or call a Supabase URL.
- **The legacy web flows** (`/login`, `/register`, `/checkout` on the storefront). They are
  server-rendered pages being retired, not an API.
- **`/shop/*` storefront routes.** Reference implementation only; deleted at parity.
- **Google OAuth.** Deferred post-launch (D-3). There is no `GET /auth/google` in v1 — if you
  find one anywhere, it is not real.
- **Payment endpoints.** None exist. Launch is **cash on delivery** (D-7). Do not build a
  payment sheet against a placeholder.
- **`/docs-json` on a deployed server, as your build target.** Use the frozen artifact.
- **Parsing `error.message`.** Switch on `error.code`.
- **Computing any total on the client.** Including shipping, discount and grand total.

---

## How this stays true

`docs/api/openapi.v1.json` is regenerated from the live decorators in CI and compared to the
committed file on every pull request:

- **breaking** (a path, operation, schema or property removed, retyped, or newly required) →
  the build fails and the change must be redesigned as an additive one;
- **additive** → the build still fails until the regenerated artifact is committed **in the
  same pull request**, so the file can never quietly fall behind the API.

The gate protects *shape*. It cannot see a value whose **meaning** changes — which is exactly
why `shippingPriced` was added before this contract froze rather than after.

If you hit something that contradicts this page, quote the `X-Request-Id` from the response:
the server-side cause can be found directly from it.
