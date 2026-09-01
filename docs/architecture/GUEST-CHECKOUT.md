# Guest Checkout Decision — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADR:** ADR-AUTH-006, ADR-ORDER-005

---

## 1. Decision

> ### **REMOVE guest checkout. An account is required to place an order.**
> ### **KEEP guest order tracking — completely redesigned as a secure server-side endpoint.**

These are two separate decisions that legacy conflated.

---

## 2. Guest checkout: it never existed

The first finding is that there is nothing to remove — only a misconception to correct.

| Evidence | Source |
|---|---|
| `orders.user_id` is **NOT NULL** | Phase 0.5 `schema.sql` |
| `createOrderAction` performs a `getUser()` null-check and rejects anonymous callers | `checkout.actions.ts:43` |
| `proxy.ts` protects `/checkout` | Phase 0 §4.6 |
| `PROJECT_OVERVIEW.md` lists *"Middleware: Route protection (auth required for /account, **/checkout**, /wishlist)"* | Roadmap |
| RLS `orders_own_insert WITH CHECK (auth.uid() = user_id)` | Phase 0.5 `policies-analysis.md` |
| Live data: 10 orders, **all** with a `user_id` | Phase 0.5 `data-integrity.md` |

**Guest checkout has never been supported at any layer.** The decision is therefore to *confirm and formalise* the existing requirement, not to withdraw a capability customers currently have.

### Why requiring an account is right for this business

| Reason | Detail |
|---|---|
| **COD fraud control** | Cash on Delivery has no pre-payment. The merchant ships real goods on trust. A verified email and an order history are the only levers against fake orders — which carry real courier and restocking costs in the Egyptian market. |
| **Order history is the product** | `PRODUCT.md` describes students and makers *"restocking a lab bench"* and *"comparing components"*. Reorder and purchase history are core value, and both require an account. |
| **Delivery contact must be reachable** | A failed COD delivery costs money. A verified account improves contactability. |
| **Removes an entire attack surface** | Anonymous order creation would need its own abuse controls, rate limits and identity heuristics. |
| **Simplifies the domain model** | `order.userId` is non-nullable. Ownership checks are uniform. No "claim your order" flow, no orphan orders, no guest→account merge. |

### Accepted cost

Registration is friction at the point of purchase, and some conversion is lost. This is accepted because for COD the fraud exposure is concrete and immediate, whereas the conversion loss is diffuse. Mitigations:

- Registration is **3 fields** (email, password, full name) — no address required up front.
- The cart survives registration via the merge flow ([`CART-MODEL.md`](./CART-MODEL.md) §7), so nothing is lost by signing up mid-checkout.
- 🔶 **Revisit condition (ADR-AUTH-006):** if analytics after launch show material checkout abandonment at the auth step, introduce guest checkout deliberately — with a distinct design (guest orders keyed to a verified phone/OTP, an explicit claim flow, and their own rate limits). Do **not** retrofit it by making `userId` nullable.

---

## 3. Guest order tracking: KEEP, fully redesigned

Separate question, different answer.

### 3.1 What legacy did

```
Browser (anon key)
   └─▶ SELECT orders + order_items + order_status_history
       WHERE order_number = <input>
   └─▶ compare phone in JavaScript, after the data arrived
   └─▶ "rate limit" = an in-memory counter reset by page reload
```

Two independent failures:

1. **Design failure.** The full order — including the customer's name, phone, full shipping address and order value — was to be transferred to the browser *before* the phone was checked. The phone gate was cosmetic; anyone reading the network response would have seen everything.
2. **It never worked.** RLS `orders_own_read USING ((auth.uid() = user_id) OR is_admin())` returns **zero rows** to an anonymous caller. Every guest lookup returned "not found".

> **Phase 0 rated this HIGH severity as a live PII breach. Phase 0.5 downgraded it: RLS blocked the read, so nothing ever leaked.** The feature was silently broken, not leaking. But the *design* was unsafe, and had the policy ever been loosened it would have become an enumeration oracle over customer PII.

### 3.2 Why keep the feature at all

Given that checkout requires an account, one could argue tracking should simply require login. Keeping it is a deliberate call:

| Reason | Detail |
|---|---|
| **COD deliveries are frequently received by someone else** | A parent, roommate or lab technician takes the package. They need delivery status, not account access. |
| **The UI already exists** and is a reasonable expectation for a COD store | `/order-tracking` |
| **The secure design is well understood and cheap** | Server-side match, minimal projection, throttling — a few hours of work |
| **It reduces support load** | "Where is my order?" is the most common enquiry |

The risk is manageable *precisely because* the response can be reduced to almost nothing sensitive.

### 3.3 The secure design

```
POST /api/v1/orders/track
{ "orderNumber": "NE-20260830-0042", "phone": "01012345678" }
```

```
1. Throttle FIRST — 10 requests / hour / IP, before any database access
2. Normalise the phone (strip spaces, +20 → 0, validate the Egyptian format)
3. Single query, BOTH conditions in the filter:
       findOne({ orderNumber, 'shippingAddress.phone': normalisedPhone })
4. No match  →  404 ORDER_NOT_FOUND          (generic — identical for a
                                              wrong number, wrong phone, or both)
5. Match     →  return the MINIMAL projection (§3.4)
6. Audit the lookup attempt (outcome only, no PII)
```

**Four properties that the legacy design lacked:**

| Property | How |
|---|---|
| **The phone is part of the query, not a post-fetch check** | A non-matching order is never loaded into memory, never serialised, never sent. This is the single most important change. |
| **Generic 404** | A wrong phone and a non-existent order are indistinguishable, so an attacker cannot confirm that an order number is real. |
| **Server-side throttling** | 10/hour/IP. Legacy's counter lived in a Zustand store and reset on reload. |
| **Minimal projection** | Even a *successful* lookup reveals almost nothing (§3.4). |

### 3.4 Response projection — PII protection

**Returned:**

```jsonc
{
  "orderNumber": "NE-20260830-0042",
  "status": "SHIPPED",
  "placedAt": "2026-08-28T10:22:00Z",
  "itemCount": 3,
  "statusHistory": [ { "to": "PLACED",     "at": "…" },
                     { "to": "CONFIRMED",  "at": "…" },
                     { "to": "SHIPPED",    "at": "…" } ],
  "estimatedDeliveryAt": "2026-09-01",
  "carrier": "Bosta"
}
```

**Deliberately NOT returned:**

| Withheld | Why |
|---|---|
| Customer name, email, phone | The caller supplied the phone; echoing PII back adds nothing and leaks on a lucky guess |
| **Full shipping address** | The highest-value PII in the record |
| **Line items** (names, SKUs, quantities) | Reveals purchasing behaviour |
| **Any monetary amount** | Order value is commercially sensitive and a fraud-targeting signal |
| **Tracking number** | Would allow interference with the shipment via the carrier's own portal |
| `userId`, `adminNote`, `coupon` | Internal |

The response answers exactly one question — *"where is my package?"* — and nothing else. A customer who wants the full record logs in.

> Legacy returned the entire `orders` row plus embedded `order_items` **and** `order_status_history`. This projection is roughly 5% of that surface.

### 3.5 Enumeration resistance

Order numbers are `NE-YYYYMMDD-NNNN`. Layered mitigation:

1. **Daily counter reset** ([`ORDER-LIFECYCLE.md`](./ORDER-LIFECYCLE.md) §7) — legacy used a *global* sequence, so `NE-20260503-0006` meant "the 6th order ever placed", leaking total order volume to anyone holding one order number.
2. **The phone is a required second factor.** Guessing an order number alone is useless.
3. **10 lookups/hour/IP** makes brute-forcing the phone space infeasible.
4. **Generic 404** yields no signal on which half was wrong.
5. **Minimal projection** caps the value of even a successful guess.

An attacker needs a valid order number **and** the matching phone, within 10 attempts per hour, to learn only a delivery status.

### 3.6 Authenticated tracking

A logged-in customer viewing `/account/orders/:id` gets the **full** record — items, address, totals, tracking number — through the normal ownership-checked endpoint. Tracking is a reduced public view, not a replacement.

---

## 4. What is explicitly NOT built

| Not built | Reason |
|---|---|
| Guest checkout | §2 |
| Guest order claim / merge into an account | Nothing to claim — every order has an owner |
| Guest carts on the server | [`CART-MODEL.md`](./CART-MODEL.md) §3 — localStorage is sufficient |
| Magic-link order access via email | Adds a token lifecycle for marginal benefit over login |
| OTP-verified guest identity | Only needed if guest checkout is introduced later |

---

## 5. Summary

| Question | Answer |
|---|---|
| **Guest checkout?** | **REMOVED** (confirming an existing requirement — it never existed) |
| Why | COD fraud exposure; order history is core value; simpler domain model |
| Cost | Registration friction at purchase — mitigated by a 3-field signup and cart merge |
| **Guest order tracking?** | **KEPT, REDESIGNED** |
| Identity | Order number **+** matching shipping phone |
| Matching | **Server-side, inside the query** — never a post-fetch comparison |
| Failure response | Generic `404`, identical for every failure mode |
| Rate limit | **10/hour/IP, server-side**, applied before database access |
| Response | Status, timestamps, item **count**, carrier — **no PII, no items, no money, no tracking number** |
| Enumeration | Daily counter reset + required phone + throttle + generic 404 + minimal projection |
| Audit | Lookup attempts recorded (outcome only) |
| Revisit | Introduce guest checkout only with a purpose-built OTP/claim design, never by making `userId` nullable |
