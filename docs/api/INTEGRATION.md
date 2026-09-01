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
| Password reset | `POST /auth/forgot-password`, `POST /auth/reset-password` |
| Profile | `PATCH /users/me` — `fullName` and `phone` only |
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
| `false` | **no address has been chosen yet**, so there is nothing to price; the `0` is a placeholder | "Delivery not yet calculated" |

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
| ~~Real shipping fee **values**~~ | ~~5~~ | **LANDED.** `shippingFee.amount` is now non-zero and `shippingPriced` is `true` once an address is chosen. Nothing changed shape. If you read `shippingPriced` rather than testing `amount === 0`, your code needed no edit — which was the point of shipping the field first. |
| ~~Password reset~~ | ~~5~~ | **LANDED.** See the SAFE table and the flow below. |
| ~~Profile update~~ | ~~5~~ | **LANDED.** `PATCH /users/me`. |
| ~~Media upload~~ | ~~4~~ | **LANDED, and not for you.** `POST /admin/media` is staff-only and needs an ADMIN or SUPER_ADMIN token; a customer app has no use for it. What it changes for you is downstream: product images will start appearing in `primaryImage` / `images`, as `{publicId, version, format, width, height, alt}`. **Build the delivery URL yourself** — `https://res.cloudinary.com/<cloud>/image/upload/<transformation>/v<version>/<publicId>` — because the API deliberately returns no URL (a stored URL makes a CDN change a data migration). Use `width`/`height` to reserve space before the image loads. **No product has an image yet**, so every one of those fields is `null` or empty today. |
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

### What the gate does NOT catch

Worth stating plainly, because "the drift gate is green" is easy to read as "nothing that
affects you changed". The gate compares two JSON documents. It sees names, types, required
flags and structure. It does not run your client, and it has no idea what any value means.

Four classes of change break a working client while the gate stays green:

| Change | Why the gate is blind to it | What it does to you |
|---|---|---|
| **Enum narrowing** — a value is removed from an allowed set | The property still exists, with the same name and the same type. Removing a member of an enum makes the document *smaller*, and the gate's additive/breaking split is about *properties*, not about the domain of a property. It classifies this as **additive**. | Requests you were making yesterday start returning `400`. |
| **Tightened validation** on an existing field | Length limits, regexes, `@IsIn`, trimming and normalisation are behaviour, not shape. Most never reach the document at all. | Same: a previously accepted payload is rejected. |
| **Changed meaning of an existing value** | Nothing about the field changes — not its name, not its type, not its presence. | The worst class: no error, no failure, wrong information shown to a customer. `shippingFee: 0` meaning "unpriced" and later "free" is the canonical example, and the reason `shippingPriced` exists. |
| **Newly-enforced constraints** — a field that was optional in practice becoming genuinely required, a uniqueness rule, a rate limit | Enforcement lives in the service, not the schema. | Intermittent failures under conditions your tests do not reproduce. |

**Worked example — the governorate narrowing.** `CreateAddressDto.governorate` was free text
and became a 27-value enum ([above](#governorate-is-a-closed-list-of-27-values)). The
regenerated artifact gained an `enum` array on an existing `string` property: no property
removed, no type changed, nothing newly required. **The gate classified it as additive and
the build passed** — while any client sending `"cairo"`, `"Cairo "` or `"Kairo"` went from
`201` to `400` on the same request. That is a breaking change by every definition that
matters to a caller, and the gate could not have known.

We are not building a semantic differ for this. The tool that catches it is a person who
knows what the change means, so the policy is a review obligation rather than a check:

> **Contract policy checklist — required on any pull request that touches an enum, a
> validator, or the meaning of an existing field.** The description must state the client
> impact explicitly: which previously-valid inputs stop being valid, which previously-correct
> client interpretations stop being correct, and what a consumer has to change. "The drift
> gate passed" is not an answer to this — the gate cannot see any of it. If the impact is
> non-trivial, it also belongs in this document before the PR merges.


If you hit something that contradicts this page, quote the `X-Request-Id` from the response:
the server-side cause can be found directly from it.

---

## Readiness is a deployment gate, not a dashboard

`GET /api/v1/health/ready` returns `503` when any index the schemas declare is absent from
the database. **Wire it as the readiness probe before the first deploy**, or the guarantee it
provides is not in force.

### Why an unindexed database is a correctness problem, not a slow one

`autoIndex` is off by design: index creation is an explicit release step, never a side effect
of booting. The cost of that correct decision is that a database with no indexes is a
*silent* state — the driver connects, every query returns the right answer, and the service
serves traffic looking healthy.

Several unique indexes are not optimisations. They are the entire enforcement mechanism
behind an invariant, and **four call sites delegate their concurrency control to them
completely** — `CredentialRepository`, `CartRepository`, `IdempotencyRepository` and
`CheckoutService` each catch MongoDB error `11000` and translate it. **With no index there is
no error, the `catch` never runs, and the race quietly succeeds** — no exception, no log line,
nothing to notice.

That catch reads exactly like ordinary defensive error handling, which is why the index
underneath it looks removable. Each site now says so in a comment.

| Index | Enforced at | What is no longer prevented |
|---|---|---|
| `users.user_email_unique` | `CredentialRepository.create` | two accounts registered on one email address |
| `idempotencyKeys.idempotency_key_unique` | `IdempotencyRepository.reserve` | **a retried checkout placing a second order** |
| `orders.order_idempotency_key_unique` | `CheckoutService.place` | the same, one layer deeper |
| `orders.order_number_unique` | the daily counter | two orders sharing one customer-facing number |
| `inventoryEvents.inventory_event_reference_unique` | the write itself | one order line decrementing stock twice |
| `carts.cart_user_unique` | `CartRepository.addLine` | a customer holding two carts at once |
| `products.product_sku_unique` | `ImportRunner` | catalogue import creating duplicates instead of upserting |
| `mediaAssets.media_asset_public_id_unique` | `MediaAssetRepository.record` | two ledger rows for one stored asset |

`OrderCounterRepository` catches the same error code and is deliberately absent from this
table: its key is the document's `_id`, the one index MongoDB always creates and
`syncIndexes()` cannot drop.

TTL indexes (`refresh_token_ttl`, `cart_ttl`, `idempotency_ttl`) are a different class: their
absence corrupts nothing, it just means expired documents are never reclaimed. They are
reported alongside the rest because unbounded growth is still a fault, but they are not what
makes this a gate.

### What the check does and does not do

| | |
|---|---|
| **Catches** | an index that was never created — a fresh database where `indexes:sync` was skipped |
| **Catches** | an index present under the declared name but with the **wrong options** — e.g. one created without `unique`. Measured: such a collection accepted two duplicate documents while a name-only check reported it healthy |
| **Catches** | a schema that declares a new index which no deploy step has created yet |
| **Reports, does not fail** | an index in the database that the schemas no longer declare. It wastes write throughput but breaks no invariant, and refusing traffic over it would turn a tidy-up into an outage |
| **Does not catch** | an index that exists and is correct but is not *used* by a query — that is a query-plan question, and the order suites assert `winningPlan` for it |
| **Does not catch** | data that already violates an invariant because the index was missing earlier. Creating the index later **fails** on the duplicates rather than resolving them; that is a data-repair job, and the failure is loud |

The check uses Mongoose's own `diffIndexes()` — the same primitive `syncIndexes()` uses — so
the probe can never disagree with the command it tells you to run.

### A breaking change was accepted once, deliberately

The gate exists to stop exactly this, so the one time it was overruled is
recorded here rather than left in a commit message.

**Phase 5a cleanup renamed two endpoints**, and the gate reported it correctly:

```
drift gate: BREAKING CHANGE. This removes or changes something clients already use.

  - path removed: /api/v1/auth/password-reset/request
  - path removed: /api/v1/auth/password-reset/confirm
  - schema removed: PasswordResetRequestDto
  - schema removed: PasswordResetConfirmDto
```

It was accepted for one reason, and it is a reason with an expiry date:
**nothing consumes those endpoints.** Verified rather than assumed — the
storefront's `/forgot-password` page still calls Supabase, there is no admin
client for auth, and the Flutter application does not exist yet. The endpoints
had existed for hours.

The alternative was leaving a public contract that contradicts a frozen
architecture document, or serving both pairs forever — two URLs for one
operation, which is worse contract design than one rename made before anyone
was watching.

**This does not generalise.** Once `/forgot-password` calls the API in Phase 5b,
the same rename would break a shipped client and the answer becomes "add a new
path, deprecate the old one". The gate is not advisory; this was a window, and
it is closed.

### Operational notes

- **Liveness (`GET /health`) is unaffected**, and must stay that way. A missing index means
  *stop sending traffic*; it never means *restart*, because restarting cannot create an
  index. Failing liveness here would put an orchestrator into a restart loop while the actual
  remedy went unrun.
- **No cache.** The check is one `listIndexes` per collection, issued in parallel. Caching a
  healthy verdict would keep reporting green after an index was dropped and — worse — keep
  reporting red after the remedy was run, sending an operator to reach for a restart.
- **Cloudinary is deliberately not a readiness check.** Readiness failing drains traffic; a
  Cloudinary outage would then take the whole storefront down because a dependency that only
  *admin image upload* needs was unavailable. A dependency belongs in readiness only if the
  instance genuinely cannot serve without it.

---

## Password reset, end to end

```
POST /api/v1/auth/forgot-password   { "email" }
    -> ALWAYS 200, with the same body, whether or not the address has an account
POST /api/v1/auth/reset-password    { "token", "newPassword" }
    -> 200, and the account is signed out on EVERY device
```

### The request endpoint tells you nothing, on purpose

It answers identically for an address that has an account, one that does not,
one that is unverified and one that is disabled. **Do not build a "no account
with that address" message from this response** — there is nothing in it to
build one from, and that is deliberate: anything else would make an
unauthenticated endpoint an account-existence oracle.

Your UI should say *"if that address has an account, a link is on its way"* and
mean it.

### The confirm endpoint ends every session

On success the API increments `tokenVersion` (invalidating every outstanding
access token) and revokes every refresh token, in one transaction with the
credential change. **The client that called it is signed out too** — including
the one the customer is looking at.

So: after a `200`, discard your tokens and send the customer to sign in with the
new password. Calling `POST /auth/refresh` afterwards returns `401`, and a
client that treats that as a session bug rather than the expected outcome will
show a confusing error at the worst moment.

### Failure is one shape

Unknown, expired and already-used tokens all return `400 VALIDATION_ERROR` with
the same message. There is no way to tell them apart, and no code should try:
the only useful UI is "that link is no longer valid, request another".

A **refused password** is also `400 VALIDATION_ERROR`, distinguishable by
`error.details[0].field` being `newPassword` rather than `token`. The token
survives a refused password, so the customer can try again on the same link
rather than starting over. The policy is server-side and includes rules a client
cannot check — it refuses a password containing the account's own email address.

### Timing

The token is 32 random bytes, single-use, and valid for **one hour** — a
twenty-fourth of the verification token's life, because a reset link is a live
credential that replaces a password rather than a convenience that can wait
until tomorrow. Requesting a second link invalidates the first.

Both endpoints are throttled at 3 requests per hour per IP **and** per email
(request) and 10 per hour (confirm).

> **These paths were renamed once, before anything consumed them.** They shipped
> briefly as `/auth/password-reset/request` and `/auth/password-reset/confirm`,
> which `PLAN.md` §9 named and which contradicted the frozen
> `AUTHORIZATION-MODEL.md` §2.8. The frozen document won. If you integrated
> against the old pair in the few hours they existed, the bodies and behaviour
> are identical — only the two URLs changed.

---

## `PATCH /users/me`

```jsonc
// every field optional; an omitted key is left unchanged
{ "fullName": "Nadia Hassan", "phone": "01012345678" }
```

Returns the whole profile, in the same shape as `GET /auth/me`.

- **`phone: null` clears the number.** Omitting the key and sending `null` are
  different instructions, and only the second one removes it.
- **`email` and `role` are refused** with `400 UNKNOWN_FIELD`, not ignored.
  Changing a login identifier needs the new address proven; role is server-owned.
- **CUSTOMER only.** A staff token gets `403`.
- `404 RESOURCE_NOT_FOUND` means the account was disabled while your access token
  was still valid — the token is genuine, the subject is gone. Sign the customer
  out rather than retrying.

There is no `GET /users/me`: `GET /auth/me` already returns this and is what
every client already calls.
