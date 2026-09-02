# Mobile handoff — the customer app, screen by screen

**Audience:** the Flutter developer building the customer app against this API.
**Companions:** [`SANDBOX.md`](./SANDBOX.md) gets you a running environment.
[`INTEGRATION.md`](./INTEGRATION.md) is the stability contract — what is safe to
build on and what is not. [`openapi.v1.json`](./openapi.v1.json) is the frozen
artifact: **generate your models from it, not from this document.**

This document is the thing those three do not give you: **which endpoints feed
which screen, in what order, and what to do when each one fails.** Until now
that mapping existed only inside the Next.js storefront.

Base URL: `http://127.0.0.1:3002/api/v1` locally. Every path below is relative
to it.

---

## 1. Screen inventory

Every customer-facing screen in the MVP. The web route is given because the
storefront is the reference implementation — when this document and the
storefront disagree, the storefront's source is the tiebreaker, and both are
downstream of the API.

| # | Screen | Web route | Purpose | Auth |
|---|---|---|---|---|
| 1 | Home | `/` | Featured products, category entry points | no |
| 2 | Product list | `/products` | Browse, filter, sort, paginate | no |
| 3 | Search | `/search` | Full-text search with facets | no |
| 4 | Product detail | `/products/{slug}` | One product, images, specs, related | no |
| 5 | Category list | `/categories` | All categories | no |
| 6 | Category detail | `/categories/{slug}` | Products in a category, breadcrumb | no |
| 7 | Brand detail | `/brands/{slug}` | Products from a brand | no |
| 8 | Cart | `/cart` | The basket, priced live | **both** |
| 9 | Sign in | `/login` | Email + password | no |
| 10 | Register | `/register` | Create an account | no |
| 11 | Verify email | `/verify-email?token=` | Consume a verification link | no |
| 12 | Forgot password | `/forgot-password` | Request a reset link | no |
| 13 | Reset password | `/forgot-password/reset?token=` | Set a new password | no |
| 14 | Checkout | `/checkout` | Pick an address, see the total, place | yes |
| 15 | Order history | `/account/orders` | Paginated list of my orders | yes |
| 16 | Order detail | `/account/orders/{id}` | One order, and self-cancel | yes |
| 17 | Profile | `/account/profile` | Name and phone | yes |
| 18 | Addresses | `/account/addresses` | The address book | yes |

**"both"** on the cart is the important one: it renders for a signed-out visitor
too, from a different endpoint. §5.

---

## 2. Per screen: what to call, in what order

### 1 · Home

| Order | Call | Sends | Renders |
|---|---|---|---|
| 1 | `GET /products?featured=true&limit=8` | — | Product cards |
| 2 | `GET /categories/tree` | — | Category navigation |

Both public, both cacheable. Fire in parallel.

### 2 · Product list · 3 · Search · 6 · Category detail · 7 · Brand detail

One endpoint drives all four. They differ only in the parameters.

| Screen | Call |
|---|---|
| Product list | `GET /products?page=1&limit=24&sort=newest` |
| Search | `GET /products?q=esp32&page=1&limit=24` (default sort becomes `relevance`) |
| Category | `GET /categories/{slug}` then `GET /products?category={slug}` |
| Brand | `GET /brands/{slug}` then `GET /products?brand={slug}` |

Response: `{ data: ProductListItem[], meta: { total, page, limit, … }, facets }`.
`meta.total` is the **true** match count, not the page size.

The full parameter set, and nothing outside it:
`page` · `limit` · `q` · `category` · `brand` · `minPrice` · `maxPrice` ·
`inStock` · `featured` · `spec` · `sort`.

- **`facets`** carries the available filters (categories, brands, price range,
  spec values) with counts. Build the filter sheet from it rather than from a
  hardcoded list.
- **Take the names from the artifact, not from this table.** `featured`, for
  instance, is not `isFeatured` — an earlier draft of this document had it
  wrong, and the reward is a `400 UNKNOWN_FIELD` rather than a silently ignored
  parameter. That is the control working, and it is why the list above is worth
  checking against `openapi.v1.json` before you type it.
- **Unknown query parameters are rejected with `400 UNKNOWN_FIELD`.** This is a
  security control, not a strictness setting. Send only what the artifact
  documents.
- Sorting outside the allow-list is `400 UNSUPPORTED_SORT` with the permitted
  values in the error — surface it in a bug report, never to a customer.
- Autocomplete: `GET /products/suggest?q=…`. Debounce it; it is a different,
  lighter shape (`ProductSuggestion`), not a full card.

### 4 · Product detail

| Order | Call | Notes |
|---|---|---|
| 1 | `GET /products/{slug}` | `404 PRODUCT_NOT_FOUND` if unknown **or not visible** |
| 2 | `GET /products/{slug}/related` | Non-blocking — render the page without it |
| 3 | `POST /cart/items` on "Add to cart" | Signed in only; see §5 for a guest |

`ProductDetail` adds `description`, all `images`, `specs`, `stockOnHand`,
`salesCount` and `weight` to the list shape.

**`availability` is an enum** (`IN_STOCK` · `LOW_STOCK` · `OUT_OF_STOCK`),
derived server-side from `stockOnHand` against the product's own low-stock
threshold. Render the enum. `stockOnHand` is there for "only 3 left" copy, not
for you to re-derive the band.

### 8 · Cart

Signed in and signed out are **different endpoints returning the identical
shape**, which is the point — one widget, one model, one screen.

| State | Read | Mutate |
|---|---|---|
| Signed in | `GET /cart` | `POST /cart/items` · `PATCH /cart/items/{productId}` · `DELETE /cart/items/{productId}` · `DELETE /cart` |
| Signed out | `POST /cart/preview` with your local basket | your own local store; §5 |

**Every mutation returns the whole cart.** Replace your state wholesale; never
merge a partial response. That is deliberate — a mutation can change more rows
than the one addressed (a clamp, a line going out of stock), and merging would
lose it.

Per-line `status` decides the badge. It is reported **most-blocking-first**, so
there is exactly one per line:

| `status` | Means | Show |
|---|---|---|
| `OK` | nothing to say | — |
| `PRICE_CHANGED` | live price differs from the price when the line was added; **the new price applies** | "Price updated" |
| `REDUCED_STOCK` | stock fell below the wanted quantity; `effectiveQuantity` < `quantity` | "Only N available" |
| `OUT_OF_STOCK` | zero on hand; kept visible, excluded from the subtotal | badge + blocks checkout |
| `UNAVAILABLE` | delisted or deleted; kept visible, excluded | badge + blocks checkout |

`hasBlockingIssues` is `true` when any line is `OUT_OF_STOCK` or `UNAVAILABLE`.
**Disable the checkout button on that field**, not on your own scan of the
statuses — it is computed once, server-side, so a future rule cannot make the
two disagree.

`quantity` is what the customer asked for and a read never reduces it;
`effectiveQuantity` is what will be charged. Show `quantity`, price with
`lineTotal`.

### 9 · Sign in

`POST /auth/login` → `{ accessToken, refreshToken, expiresIn, user, … }`. §3.2.

### 10 · Register · 11 · Verify email

§3.1.

### 12 · Forgot password · 13 · Reset password

§3.6.

### 14 · Checkout

| Order | Call | Sends | Notes |
|---|---|---|---|
| 1 | `GET /users/me/addresses` | — | Empty book → send them to add one first |
| 2 | `POST /checkout/quote` | `{}` | Before an address is chosen. `shippingPriced: false` |
| 3 | `POST /checkout/quote` | `{"addressId": "…"}` | Re-quote on **every** address change |
| 4 | `POST /orders` | `{"addressId": "…", "customerNote": null}` + `Idempotency-Key` header | §3.4 |

**A quote is not a lock.** It reserves nothing, promises nothing and has no id
to send back. Placement independently revalidates everything inside a
transaction and can still answer `409 OUT_OF_STOCK`. Never keep a quote and
submit its totals — placement ignores anything a client sends about money.

Re-quote when the address changes, when the cart changes, and when the screen is
resumed from the background. It is cheap and it is `no-store`.

### 15 · Order history

`GET /orders?page=1&limit=20`, newest first. Optional `statuses` filter.
`meta.total` is the true count.

Every field a history card needs comes from the order's own immutable snapshot.
**No catalogue call is needed or wanted** — a renamed, repriced or deleted
product must not change what a past order says it sold.

The list returns a **summary**, not the full order:
`{id, orderNumber, status, placedAt, itemCount, totalQuantity, pricing, payment,
previewImagePublicId}`. There are no `items` and no address — fetch
`GET /orders/{id}` for those. `previewImagePublicId` is the one image a card
needs, so a history screen costs exactly one request.

### 16 · Order detail

| Order | Call | Notes |
|---|---|---|
| 1 | `GET /orders/{id}` | `404 ORDER_NOT_FOUND` for somebody else's order — never `403` |
| 2 | `POST /orders/{id}/cancel` | **Requires a reason.** §3.5 |

### 17 · Profile

`GET /auth/me` to read; `PATCH /users/me` to write. **`fullName` and `phone`
only.** Email is not editable in v1 and there is no endpoint for it; do not
build the field. Password change goes through the reset flow (§3.6).

### 18 · Addresses

| Action | Call |
|---|---|
| List | `GET /users/me/addresses` |
| Read one | `GET /users/me/addresses/{addressId}` |
| Create | `POST /users/me/addresses` |
| Edit | `PATCH /users/me/addresses/{addressId}` |
| Delete | `DELETE /users/me/addresses/{addressId}` |
| Make default | `POST /users/me/addresses/{addressId}/default` |

Three rules that will bite otherwise:

1. **`governorate` is a closed enum of 27 values**, case-sensitive, not free
   text. Build the picker **from the enum in the artifact** so a future
   governorate arrives with the contract rather than with a support ticket. A
   bad value is `400 VALIDATION_ERROR` with `details[0].field === 'governorate'`.
2. **Exactly one address is the default**, maintained server-side in one atomic
   update. `POST …/default` returns **the whole book** — replace your list.
3. **Editing an address changes nothing about an order already placed.** Orders
   carry their own address snapshot. Say so in the UI if you offer editing from
   an order screen.

**The book is capped at 10 addresses.** The eleventh is
`409 ADDRESS_LIMIT_REACHED`, with the maximum in the message. Show the count
before they hit it.

---

## 3. Flows, end to end

### 3.1 Registration and verification

| Step | Call | Success | What can go wrong |
|---|---|---|---|
| 1 | `POST /auth/register` `{email, password, fullName, phone?}` | `201`, **no session** | `409 DUPLICATE_EMAIL` · `400 VALIDATION_ERROR` (password policy) · `429` |
| 2 | — | the customer opens the emailed link | — |
| 3 | `POST /auth/verify-email` `{token}` | `200` | `400 VALIDATION_ERROR` — token invalid, expired or **already used** |
| 4 | `POST /auth/login` | a session | `403 EMAIL_NOT_VERIFIED` if step 3 was skipped |

**Registration returns no tokens.** Do not build a screen that expects one — the
correct next screen is "check your email".

**Tokens are single-use and the link is one-shot.** A customer who taps the link
twice, or whose mail client prefetched it, sees the same
`400 VALIDATION_ERROR`. The actionable sentence is in
`error.details[0].message` ("verification token is invalid or has expired"), not
in `error.message`, which is only the category `Validation failed.` **Offer
"resend" on that error** — it is the only recovery, and a customer who is shown
"Validation failed." has no idea it exists.

`POST /auth/resend-verification` answers **identically for known and unknown
addresses**. That is deliberate: anything else is an account-existence oracle.
Never render a different outcome for the two, and do not try to detect one.

### 3.2 Login and silent refresh

```
POST /auth/login  →  accessToken (15 min)  +  refreshToken (30 days)
```

| On | Do |
|---|---|
| `401 TOKEN_EXPIRED` | `POST /auth/refresh` **once**, store the new pair, retry the original request |
| a second `401` | sign out |
| `401 REFRESH_TOKEN_REUSED` | **terminal.** Clear tokens, go to sign-in. Do not retry |

`REFRESH_TOKEN_REUSED` means the rotation chain has been revoked as suspected
theft. It is not a transient error and retrying makes it worse.

**Refresh tokens rotate on every use.** Store the new one atomically with
clearing the old, and serialise refreshes — two requests racing a refresh will
have one of them present a spent token, which is exactly what
`REFRESH_TOKEN_REUSED` is looking for. One in-flight refresh, queue the rest.

`POST /auth/logout` ends this session; `POST /auth/logout-all` ends every
session on every device.

### 3.3 Browse → cart → address → quote → place

```
GET  /products                     browse
POST /cart/items                   add          (signed in)
POST /cart/preview                 price        (signed out — §5)
GET  /users/me/addresses           choose
POST /checkout/quote  {addressId}  the total
POST /orders          {addressId}  + Idempotency-Key
```

Between the quote and the placement, **nothing is held**. Stock can move. That
is a deliberate design choice, not a gap — see §3.4 for what to do about it.

### 3.4 Placing an order

`POST /orders` **requires an `Idempotency-Key` header.** Generate a UUID when
the customer first taps "Place order", keep it for the life of that attempt, and
send the same one on every retry.

| Response | Means | Do |
|---|---|---|
| `201` | this request created the order | show the confirmation |
| `200` | an earlier attempt already created it; the body is **identical** | show the confirmation |
| `400 MISSING_IDEMPOTENCY_KEY` | you did not send the header | a client bug |
| `409 IDEMPOTENCY_KEY_REUSED` | same key, **different** request body | a client bug — you reused a key for a different order |
| `409 OUT_OF_STOCK` | stock moved since the quote | re-read the cart, show the flagged lines, let them adjust |
| `409 CART_EMPTY` | nothing to buy | send them to the catalogue |
| `404 ADDRESS_NOT_FOUND` | unknown, or not theirs | re-read the address book |
| `500 SHIPPING_RATE_MISSING` | no rate row for that governorate | not recoverable in-app; report it |

**Treat any 2xx as success.** A client that distinguishes 201 from 200 will
eventually show a customer an error for an order that exists.

Placement clears the cart in the same transaction that writes the order, so
"order created, cart still full" is not a state that exists. Refresh your cart
from the response or re-read it; do not clear it locally on faith.

### 3.5 Self-cancellation

`POST /orders/{id}/cancel`

> ### **A reason is REQUIRED. 3 to 500 characters.**
>
> ```json
> { "reason": "Ordered the wrong board." }
> ```
>
> Sending `{}` is `400 VALIDATION_ERROR`. This is the single most likely thing
> to get wrong on this endpoint, because "cancel this order" reads like it needs
> no body.

**Do not default it.** A reason nobody typed reads on the permanent record like
something the customer said. Collect it, require it in the UI, and let the API
own the length policy.

| Response | Means |
|---|---|
| `200` | cancelled; the body is the updated order |
| `400 VALIDATION_ERROR` | no reason, or outside 3–500 characters |
| `409 ORDER_NOT_CANCELLABLE` | past the self-service window — the order has been confirmed or shipped |
| `404 ORDER_NOT_FOUND` | not theirs |

Cancellation is only available while the order is unconfirmed. Read the order's
`status` and hide the button rather than letting a customer discover the rule
from an error.

### 3.6 Password reset

| Step | Call | Answers |
|---|---|---|
| 1 | `POST /auth/forgot-password` `{email}` | **`200` always** |
| 2 | — | the customer opens the emailed link |
| 3 | `POST /auth/reset-password` `{token, password}` | `200`, or `400 VALIDATION_ERROR` |

**Step 1 tells you nothing, on purpose.** A known address and an unknown one get
the same `200` and the same body. Render "if that address has an account, we
have sent a link" and nothing else. Do not add a "no account found" state; there
is no way to reach it and building one implies the API leaks something it does
not.

**Step 3 ends every session on every device**, including the one that asked. The
token version is bumped and every refresh token is revoked in one transaction.
So after a successful reset: **clear stored tokens and send them to sign in.** Do
not assume the current session survived — it did not.

Failure is one shape. An invalid token, an expired token and a re-used token all
answer `400 VALIDATION_ERROR` with the same sentence in `details[0].message`.
Do not try to tell them apart; offer "request a new link".

---

## 4. Shipping semantics — the trap the contract freeze exists to prevent

`pricing.shippingFee` can be `0` for **two completely different reasons**.
`pricing.shippingPriced` is the field that tells them apart, and it is the only
correct thing to branch on.

| `shippingPriced` | `shippingFee.amount` | Means | Show |
|---|---|---|---|
| `false` | `0` | **No address chosen yet.** Nothing has been calculated | "Delivery calculated at checkout" |
| `true` | `5000` | The fee is 50.00 EGP | "50.00 EGP" |
| `true` | `10000` | The fee is 100.00 EGP | "100.00 EGP" |
| `true` | `0` | **FREE.** A threshold was met, or the rate is genuinely zero | "Free" |

### Worked examples, against the sandbox account

```jsonc
// POST /checkout/quote  {}                      — no address yet
"pricing": { "shippingPriced": false, "shippingFee": { "amount": 0, "formatted": "0.00 EGP" } }
// -> "Delivery calculated at checkout".  NOT "Free".

// POST /checkout/quote  {"addressId": "<Home — Cairo>"}
"pricing": { "shippingPriced": true,  "shippingFee": { "amount": 5000, "formatted": "50.00 EGP" } }

// POST /checkout/quote  {"addressId": "<Work — Alexandria>"}
"pricing": { "shippingPriced": true,  "shippingFee": { "amount": 10000, "formatted": "100.00 EGP" } }
```

**Rates today (D-8):** Cairo and Giza **50.00 EGP**; the other 25 governorates
**100.00 EGP**. There is no default row and no fallback — an unrecognised
governorate raises rather than inventing a fee, which is safe only because the
governorate is a closed enum on both sides.

**The fourth row does not occur yet.** No free-shipping threshold exists today,
so `shippingPriced: true` with `amount: 0` cannot currently happen. Handle it
anyway. That is the entire reason the field exists: the day a threshold lands,
a client that wrote `if (fee.amount === 0) show("not calculated")` keeps
compiling, keeps passing its tests, and starts telling every free-shipping
customer their delivery has not been worked out.

> **Never do money arithmetic on the client.** `amount` is an integer in minor
> units (piastres). `formatted` is display-only. Every total —
> `itemsSubtotal`, `discountTotal`, `shippingFee`, `grandTotal` — comes from
> the server, already correct.

### VAT is already inside every price. Do not add a tax line.

`pricing` also carries `vatInclusive: true` and `vatRateBps: 1400` (14%, in
basis points). **They are informational.** There is no additive tax line
anywhere in this API, and `grandTotal` is exactly
`itemsSubtotal - discountTotal + shippingFee`.

If you want to show "includes X VAT", the amount already inside the total is
`round(grandTotal × vatRateBps / (10000 + vatRateBps))`. That is a display
calculation on a number the server gave you, and it is the only arithmetic on
this page you are invited to do. **Adding `vatRateBps` to `grandTotal` would
overcharge every customer** — the field exists so nobody has to guess whether
prices are inclusive.

---

## 5. The guest cart

A visitor with no account still has a basket, and it lives on the device.

### What to store

**`{productId, quantity}` and nothing else.** No price, no name, no image, no
stock. A price that round-trips through local storage is a price the customer
can edit, and a name stored on device is a name that goes stale when the product
is renamed.

### How to render it

`POST /cart/preview` with the whole basket, on every render that shows it:

```json
{ "items": [ { "productId": "652f…", "quantity": 2 } ] }
```

It returns **the identical shape as `GET /cart`**, so one widget renders both
states. Nothing is stored server-side: no cart document, no reservation, no
trace of the call.

Two differences from a signed-in cart, both deliberate:

1. **No line can be `PRICE_CHANGED`.** That status compares the live price
   against the price shown when the line was added, and a device basket keeps no
   such snapshot. The comparison genuinely cannot be made, so it is not faked.
2. **A product it will not price says nothing about itself.** Delisted,
   soft-deleted and never-existed all produce the same line: `UNAVAILABLE`, an
   empty `name`, `sku` and `slug`, a zero price and zero stock. The endpoint is
   public, and answering differently for a hidden product would make it a way to
   enumerate the unpublished catalogue.
   **So: an `UNAVAILABLE` line with an empty `name` means "no longer for sale" —
   offer to remove it rather than rendering a blank row.**

### Limits

| | |
|---|---|
| Products per request | **50** — `400 VALIDATION_ERROR` beyond it |
| Requests | **120 per minute per IP** |

Generous for a basket, deliberately not generous for a bulk price lookup.

### Merging at sign-in

The rules, as implemented. These are **product decisions**, not obvious ones,
and a mobile app needs equivalent behaviour.

| Device basket | Account cart | Result |
|---|---|---|
| 3 | product absent | 3 — the line moves |
| 3 | a *different* product | both survive |
| 3 | **2 of the same product** | **5 — the quantities SUM** |
| 60 | 60 of the same product | 99 — capped, then the API clamps again to live stock |

Summing is the decision. A customer who put two of something in their basket
while signed out, having already left two in their account, wants four. `max()`
silently discards the smaller intent; "server wins" throws away the basket they
just built.

**Stock is never consulted on the device.** The API clamps every write to
`min(99, onHand)` and is the only thing that knows the live number.

### The merge order, and why it survives being interrupted

```
1. plan     read the account cart, compute ABSOLUTE target quantities   (no writes)
2. FREEZE   persist the plan to disk BEFORE a single write happens
3. apply    PATCH each line to its absolute target                      (repeatable)
4. confirm  empty the device basket — only now
```

**Step 2 is the one that is easy to leave out and the one the guarantee rests
on.** Without it, a retry re-plans against a cart that already holds some of the
guest quantities and adds them a second time — the basket silently doubles. With
the plan frozen, a retry re-applies the *same* absolute numbers, and converging a
line to five twice leaves five.

On the next sign-in, **a plan already on disk means a previous attempt was
interrupted**: re-apply those targets rather than making a new plan.

**The basket is cleared as one unit.** If three lines merge and the fourth fails,
all four stay and the retry re-applies all four. That is safe because the targets
are absolute, and the cost is bounded: a stale badge until the next
authenticated read. Clearing per line would mean mutating the frozen plan as the
writes land — mutating the one thing that must not change — to close a window one
page load wide.

**A merge must never block sign-in.** It is a convenience attached to logging in,
not part of it. If it fails, leave the basket exactly as it was, let the customer
in, and try again next time. Nothing a delisted product does may stop somebody
reaching their account.

**Tell the customer what moved.** Compare the plan against the cart the API
actually returned — not against what the writes claimed — and report a line that
arrived smaller (`clamped`) or vanished (`unavailable`). A basket that quietly
loses two of something between signing in and checking out is a customer who
finds out at the payment screen, or when the parcel arrives.

---

## 6. Errors

### The envelope

```jsonc
// success
{ "data": … , "meta": { … }, "facets": { … } }
// failure — ALWAYS this shape
{ "error": { "code": "…", "message": "…", "details": [ … ], "requestId": "…", "timestamp": "…" } }
```

Branch on which key is present. **`error.code` is a stable enum — switch on it.
`error.message` is human-facing and may change between releases; never parse
it.**

For a validation failure the useful sentence is **`error.details[0].message`**,
not `error.message` (which is only the category, `Validation failed.`). Details
are ordered most-fundamental-first, so `details[0]` is the one worth showing;
`details[n].field` gives you form binding for the rest.

Log `requestId` with every failure you report. It is the only thing that ties a
customer's screenshot to a server log line.

### Code → what the web UI shows → recoverable

The storefront's mapping, which is the reference implementation.

| `code` | HTTP | Web UI shows | Recoverable |
|---|---|---|---|
| `NETWORK_ERROR` *(client-side)* | — | "We could not reach the server. Check your connection and try again." | retry |
| `UNAUTHENTICATED` | 401 | "Please sign in to continue." | sign in |
| `TOKEN_EXPIRED` | 401 | *nothing* — refresh and retry silently | automatic |
| `TOKEN_INVALID` | 401 | "Please sign in to continue." | sign in |
| `REFRESH_TOKEN_INVALID` | 401 | "Please sign in to continue." | sign in |
| `REFRESH_TOKEN_REUSED` | 401 | "Please sign in to continue." | **terminal** — clear everything |
| `INVALID_CREDENTIALS` | 401 | the server's message, on the form | retry |
| `EMAIL_NOT_VERIFIED` | 403 | the server's message + **a resend action** | verify |
| `ACCOUNT_DISABLED` | 403 | the server's message | no — support |
| `FORBIDDEN` | 403 | the server's message | no |
| `VALIDATION_ERROR` | 400 | **`details[0].message`**, plus per-field errors | fix and retry |
| `UNKNOWN_FIELD` | 400 | generic failure | no — **a client bug** |
| `UNSUPPORTED_SORT` | 400 | generic failure | no — a client bug |
| `MALFORMED_REQUEST` | 400 | generic failure | no — a client bug |
| `MISSING_IDEMPOTENCY_KEY` | 400 | generic failure | no — a client bug |
| `RESOURCE_NOT_FOUND` | 404 | an empty state — the generic 404, when nothing more specific applies | navigate away |
| `PRODUCT_NOT_FOUND` | 404 | an empty state, not an error dialog | navigate away |
| `CATEGORY_NOT_FOUND` · `BRAND_NOT_FOUND` | 404 | an empty state | navigate away |
| `ORDER_NOT_FOUND` | 404 | "Order not found" | navigate away |
| `ADDRESS_NOT_FOUND` | 404 | re-read the address book | refresh |
| `CART_ITEM_NOT_FOUND` | 404 | re-read the cart | refresh |
| `DUPLICATE_EMAIL` | 409 | the server's message, on the email field | use sign-in |
| `OUT_OF_STOCK` | 409 | re-read the cart and show the flagged lines | adjust |
| `PRODUCT_UNAVAILABLE` | 409 | re-read the cart | adjust |
| `CART_EMPTY` | 409 | send to the catalogue | — |
| `ORDER_NOT_CANCELLABLE` | 409 | the server's message | no |
| `IDEMPOTENCY_KEY_REUSED` | 409 | generic failure | no — a client bug |
| `ADDRESS_LIMIT_REACHED` | 409 | the server's message | delete one |
| `CONCURRENT_MODIFICATION` | 409 | "Please try again" | **retry** |
| `RATE_LIMIT_EXCEEDED` | 429 | "Too many attempts. Try again shortly." | wait — §7 |
| `SHIPPING_RATE_MISSING` | 500 | generic failure | no — report it |
| `TRANSACTION_FAILED` | 500 | "Please try again" | **retry** |
| `SERVICE_UNAVAILABLE` | 503 | "Please try again in a moment" | **retry** |
| `INTERNAL_ERROR` | 500 | "Something went wrong on our side." | retry once |

**"Generic failure" means a client bug reached production.** `UNKNOWN_FIELD`,
`UNSUPPORTED_SORT`, `MALFORMED_REQUEST`, `MISSING_IDEMPOTENCY_KEY` and
`IDEMPOTENCY_KEY_REUSED` are never the customer's fault and never fixable by
them. Show a generic apology, log loudly, and fix the client.

**Three are genuinely worth an automatic retry** — `CONCURRENT_MODIFICATION`,
`TRANSACTION_FAILED`, `SERVICE_UNAVAILABLE`. Once, with a short backoff. The
others are not.

**A non-2xx that is *not* this envelope** means something upstream answered — a
proxy, a gateway, an HTML error page. Treat it as a server failure rather than
pretending to know a code.

---

## 7. Rate limits

Every throttled route, at its production limit. Everything not listed shares the
default allowance of **300 requests per minute**.

| Route | Limit | Keyed on |
|---|---|---|
| `POST /auth/register` | **3 per hour** | IP |
| `POST /auth/login` | **5 per 15 minutes** | IP **and** email |
| `POST /auth/resend-verification` | **3 per hour** | IP **and** email |
| `POST /auth/forgot-password` | **3 per hour** | IP **and** email |
| `POST /auth/reset-password` | 10 per hour | IP |
| `POST /auth/verify-email` | 20 per hour | IP |
| `POST /auth/refresh` | 60 per hour | IP |
| `POST /cart/preview` | 120 per minute | IP |
| *everything else* | 300 per minute | IP |

**IP *and* email** matters: it means one address cannot lock out everyone else
behind the same NAT, and a targeted attack on one account does not deny service
to the rest.

### On a 429

```jsonc
{ "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "…", "requestId": "…" } }
```

with a **`Retry-After` header in seconds**. Read it, disable the action for that
long, and show the remaining time. Do not retry automatically and do not
exponential-backoff into the limit — for `register` at 3/hour, `Retry-After`
can legitimately be most of an hour, and a client that retries silently will
simply burn the budget.

Every response also carries `X-RateLimit-Limit-global`,
`X-RateLimit-Remaining-global` and `X-RateLimit-Reset-global` (seconds until the
window rolls). Useful in a debug screen; do not build product behaviour on them
— `Retry-After` on the 429 is the field to obey.

> **While developing:** use the seeded sandbox account
> (`SANDBOX.md` §4) rather than registering. Three registrations an hour is
> nothing, and the resulting `429` reads like a broken API. There is a
> `RATE_LIMIT_RELAXED` switch for automated runs — SANDBOX.md §6 — but it is
> refused in production, and one spec deliberately runs against the real numbers.

---

## 8. What is NOT in v1

**Absent by decision, not by oversight.** Do not design around any of these, and
do not read their absence as something to work around.

| Not in v1 | Status |
|---|---|
| **Wishlist** | Rebuild planned — PLAN.md Phase 8. No endpoint exists. |
| **Reviews and ratings** | Rebuild planned — Phase 8. `product.rating` **is** in the contract and populated, but there is no endpoint to read or write individual reviews. |
| **Coupons / discount codes** | Rebuild planned — Phase 8. `pricing.discountTotal` exists and is always `0` today: the envelope shipped first so the shape will not change when coupons land. |
| **Blog** | Rebuild planned — Phase 8. Still on the legacy stack; not part of this API. |
| **Guest order tracking** | **WITHDRAWN.** Not deferred — see PLAN.md §9.3. Guest checkout was removed, every order belongs to an account, so the feature has no user. `/orders/track` does not exist and is not coming. Order status lives behind sign-in, at `GET /orders/{id}`. |
| **Guest checkout** | **Removed by a frozen decision.** An account is required to place an order. |
| **Google / social sign-in** | Post-launch (D-3). Recorded, not scheduled. There is no OAuth callback and no provider field. |
| **Payments** | **Cash on delivery only.** No card, no wallet, no gateway. `payment.method` is in the contract so the shape survives; today it has one value. |
| **Editing your email address** | No endpoint. `PATCH /users/me` is `fullName` and `phone` only. |
| **Changing a password while signed in** | No endpoint. Use the reset flow (§3.6). |
| **Notifications / push** | Not in v1. |
| **Multi-currency** | One currency system-wide (EGP) and conversion is forbidden. `currency` is on the wire so the shape survives, not because it varies. |

`discountTotal`, `payment.method` and `currency` are the pattern worth noticing:
**the field ships before the feature**, so the day the feature lands nothing
about the response shape changes and your models still compile. Read them; do
not assume their current values are permanent.

---

## 9. Before you write a line of Dart

1. **Generate your models from [`openapi.v1.json`](./openapi.v1.json)**, not
   from this document and not from a live server. It is the frozen artifact and
   a CI gate fails if the running API drifts from it.
2. **Optional fields are `null`, never omitted.** Your models stay stable.
3. **IDs are opaque 24-character hex strings.** Do not parse them.
4. **Dates are ISO 8601 UTC with `Z`.**
5. **Enums are `SCREAMING_SNAKE_CASE`.** Handle an unknown value rather than
   crashing — new enum members are an additive change and are allowed inside v1.
6. **Localised text is resolved server-side** from `Accept-Language` (`en` or
   `ar`). You receive plain strings, never `{en, ar}`. Send the header.
7. **Read [`INTEGRATION.md`](./INTEGRATION.md)'s SAFE / UNSTABLE / FORBIDDEN
   table** before building on anything not listed here.
