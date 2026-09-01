# Behavioural Test-Case Inventory — Phase 0.5

**Purpose.** The catalogue of behaviours that must be *consciously decided* during the NestJS migration — each either **preserved**, **fixed**, or **deliberately dropped**. These become the integration and E2E suites in Phase 11.

**Nothing here is implemented.** This is a specification, not a test suite.

Every case is derived from behaviour **verified against the live database** in Phase 0.5, not from the repository's intentions.

**Disposition legend**
- **PRESERVE** — current behaviour is correct; the new system must match it
- **FIX** — current behaviour is defective; the new system must differ, deliberately
- **DECIDE** — requires a product decision before it can be specified (see [`PHASE-0.5-REPORT.md`](./PHASE-0.5-REPORT.md) §9)

---

## 1. Order creation (`OrdersModule`) — highest priority

### OC-01 · Server-side pricing wins · **PRESERVE**
```
Given  a product with base_price = 100.00 and sale_price = 80.00
When   a client submits an order for quantity 2 and claims price = 1.00
Then   order_items.price = 80.00 and order.subtotal = 160.00
And    the client-supplied price is ignored entirely
```
*Baseline: VERIFIED — `create_order_v2` reads price from the DB.*

### OC-02 · Effective price is `sale_price ?? base_price` · **PRESERVE**
```
Given  product A (base 100, sale NULL) and product B (base 100, sale 80)
When   an order contains one of each
Then   line A = 100.00, line B = 80.00, subtotal = 180.00
```

### OC-03 · Total formula · **DECIDE**
```
Given  subtotal = 500.00
When   the order is created
Then   TODAY:  total = subtotal + shipping_fee, with discount/tax/shipping always 0
       FUTURE: total = subtotal - discount + shipping_fee + tax
```
*Baseline: VERIFIED — no discount or tax term exists. Requires the shipping-model and VAT decisions.*

### OC-04 · Insufficient stock aborts the entire order · **PRESERVE**
```
Given  product A has stock 5 and product B has stock 0
When   an order requests A×1 and B×1
Then   the order fails with "Insufficient stock for product <B.sku>"
And    NO order row exists
And    A's stock is still 5           <- full rollback
And    no inventory_transactions row was written
```
*Baseline: VERIFIED — plpgsql atomicity. **This is the single most important invariant to preserve.***

### OC-05 · Concurrent checkout must not oversell · **PRESERVE**
```
Given  a product with stock_quantity = 1
When   two orders for quantity 1 are placed simultaneously
Then   exactly one succeeds and one fails with insufficient stock
And    final stock = 0 (never negative)
```
*Baseline: VERIFIED — the `WHERE stock_quantity >= quantity` predicate makes this race-safe. MongoDB must reproduce it with a conditional update inside a transaction.*

### OC-06 · Negative quantity must be rejected · **FIX** 🔴
```
Given  a product with stock 10 priced 100.00
When   an order requests quantity = -5
Then   TODAY:  accepted — stock becomes 15, line total = -500.00, order total reduced
       FUTURE: rejected with a 400 validation error
```
*Baseline: VERIFIED defect **B-E2**. Not exploited in live data (0 rows with `quantity <= 0`).*

### OC-07 · Zero / empty order must be rejected · **FIX**
```
Given  an empty items array
When   an order is created
Then   TODAY:  a valid order with subtotal 0 and total = shipping_fee
       FUTURE: rejected with "Cart is empty"
```

### OC-08 · Inactive and soft-deleted products must not be purchasable · **FIX** 🟠
```
Given  a product with is_active = false (or deleted_at IS NOT NULL)
When   an order includes it
Then   TODAY:  succeeds — the function never checks either column
       FUTURE: rejected with "Product not available"
```
*Baseline: VERIFIED defect **B-E3**.*

### OC-09 · Order number format · **PRESERVE (format) / DECIDE (semantics)**
```
Given  an order is created on 2026-05-03
Then   order_number matches ^NE-20260503-\d{4}$
And    TODAY the numeric suffix is a GLOBAL counter, not a per-day counter
```
*Baseline: VERIFIED — live sequence `last_value = 10`; observed `NE-20260503-0006..0010`. A per-day reset would be a behaviour change; sequential numbers are also enumerable.*

### OC-10 · Initial statuses · **DECIDE**
```
When   an order is created
Then   TODAY: order_status='processing', payment_status='pending', fulfillment_status='unfulfilled'
```
*Baseline: VERIFIED. `'pending_payment'` is unreachable — the reservation design assumed it. For COD, starting at `processing` is arguably right; make it an explicit decision.*

### OC-11 · Ledger entry per line · **PRESERVE + FIX**
```
When   an order with 3 distinct products is created
Then   3 inventory_transactions rows exist, type='sale', quantity negative,
       reference_type='order', reference_id = order id
And    TODAY created_by is NULL          <- FIX: attribute the sale to the user
```

### OC-12 · Order ownership cannot be forged · **FIX** 🔴
```
Given  an authenticated user U
When   an order is created with a user_id belonging to a different user V
Then   TODAY:  succeeds — create_order_v2 never compares p_user_id to auth.uid()
       FUTURE: userId is taken from the JWT and the body field does not exist
```
*Baseline: VERIFIED defect **B-E1 / F-CRIT-2**.*

### OC-13 · Unauthenticated order creation · **FIX** 🔴
```
Given  no authentication, only the public anon key
When   POST /rest/v1/rpc/create_order_v2 is called directly
Then   TODAY:  succeeds — SECURITY DEFINER + EXECUTE granted to anon
       FUTURE: 401 Unauthorized
```

### OC-14 · Order prices are immutable afterwards · **PRESERVE**
```
Given  an order containing product P at 100.00
When   P's base_price later changes to 150.00
Then   the historical order still shows 100.00
```
*Baseline: VERIFIED by design — `order_items` snapshots name/sku/price.*

### OC-15 · Idempotency · **FIX (new capability)**
```
Given  a checkout submitted twice (double-click / retry)
When   both requests carry the same Idempotency-Key
Then   exactly one order is created and both responses are identical
```
*Baseline: no idempotency exists today; a double submit creates two orders and double-decrements stock.*

---

## 2. Order status transitions (`OrdersModule`)

### OS-01 · Legal transitions · **PRESERVE**
```
order_status:       pending_payment -> paid|cancelled|failed
                    paid -> processing|cancelled
                    processing -> shipped
                    shipped -> delivered
payment_status:     pending -> paid|failed ;  paid -> refunded
fulfillment_status: unfulfilled -> processing -> shipped -> delivered|returned
```
*Source: `apps/admin/src/actions/order.actions.ts:35-51` — the matrix exists **only** in app code.*

### OS-02 · Illegal transitions must be rejected server-side · **FIX** 🟠
```
Given  an order with order_status = 'delivered'
When   a transition to 'pending_payment' is requested
Then   TODAY:  the DB accepts it (any CHECK-valid value is allowed)
       FUTURE: 409 Conflict — invalid transition
```
*Baseline: VERIFIED defect **B-F3**. Live data already shows incoherent combinations (2 orders `shipped` + `payment_status='pending'`).*

### OS-03 · Every change writes history · **PRESERVE**
```
When   any of the three status fields changes
Then   exactly one order_status_history row is appended
       with field, from_value, to_value, changed_by, notes
```
*Baseline: VERIFIED — 8 live rows.*

### OS-04 · Tracking number must persist · **FIX** 🔴
```
Given  an order being shipped
When   a tracking number is supplied
Then   TODAY:  the ENTIRE call fails — status unchanged, no history row
       FUTURE: status updated, tracking number stored, history written
```
*Baseline: VERIFIED defect **B-F2** — `orders.tracking_number` does not exist.*

### OS-05 · Cancellation must restore stock · **FIX / DECIDE** 🟠
```
Given  a delivered-pending order that consumed 3 units of product P
When   the order is cancelled
Then   TODAY:  stock is NOT restored; no ledger entry
       FUTURE: stock restored and a compensating ledger row written (type='return')
```
*Baseline: VERIFIED defect **B-F4**. Confirm whether cancellation should restock in all cases or only pre-shipment.*

### OS-06 · Concurrent status updates · **PRESERVE + FIX**
```
Given  two admins acting on the same order simultaneously
When   both attempt processing -> shipped
Then   one succeeds; the other is rejected as an invalid transition
And    exactly one history row exists
```
*Baseline: the DB takes `FOR UPDATE`, but the app checks the matrix in a prior round trip — the TOCTOU window is real.*

### OS-07 · Actor identity cannot be forged · **FIX** 🔴
```
When   a status change is requested with an arbitrary admin id
Then   TODAY:  recorded verbatim in order_status_history.changed_by
       FUTURE: actor derived from the JWT; a body-supplied id is ignored/rejected
```

### OS-08 · Non-admin cannot change status · **FIX** 🔴
```
Given  an anonymous caller with only the public key
When   update_order_status_v2 is invoked directly
Then   TODAY:  succeeds
       FUTURE: 401/403
```

---

## 3. Inventory (`InventoryModule`)

### IN-01 · Signed-delta semantics · **PRESERVE**
```
Given  a product with stock 50
When   an adjustment of -10 is applied
Then   stock = 40, and a ledger row records quantity = -10 (not 40)
```

### IN-02 · Stock floor at zero · **PRESERVE**
```
Given  stock 5
When   an adjustment of -10 is applied
Then   rejected with "Stock cannot go below 0"; stock unchanged; no ledger row
```

### IN-03 · Reason is mandatory · **PRESERVE**
```
When   an adjustment is submitted with a reason shorter than 3 characters
Then   rejected
```
*Source: `inventory.actions.ts:13` (Zod). The DB does not enforce it.*

### IN-04 · Adjustment attributes the actor · **PRESERVE**
```
Then   inventory_transactions.created_by = the acting admin
```
*Baseline: VERIFIED — `adjust_stock_v2` does populate `created_by` (the sale path does not).*

### IN-05 · Ledger must reconcile to stock · **FIX (new invariant)**
```
Given  a product with an opening balance and subsequent movements
Then   sum(ledger.quantity) == current stock
```
*Baseline: VERIFIED broken — only 4 of 85 products have any ledger history, and none reconciles, because opening stock was seeded with no ledger row. Requires synthetic opening-balance entries at migration.*

### IN-06 · Every stock change writes a ledger row · **FIX**
```
Given  any code path that changes stock
Then   a ledger row is always written
```
*Baseline: VERIFIED broken — no trigger enforces this; a direct `UPDATE products SET stock_quantity` writes no ledger row.*

### IN-07 · Reservation lifecycle · **DECIDE** 🟠
```
TODAY:  reserved_quantity is never incremented by any code path;
        the pg_cron job that releases reservations has run 35,309 times as a no-op
FUTURE: either implement reservations properly, or drop the concept and the column
```

### IN-08 · Non-admin cannot adjust stock · **FIX** 🔴
```
Given  an anonymous caller with only the public key
When   adjust_stock_v2 is invoked directly
Then   TODAY: succeeds        FUTURE: 401/403
```

---

## 4. Authentication (`AuthModule`)

### AU-01 · Existing passwords must keep working · **PRESERVE** ⭐
```
Given  a user migrated from Supabase with a bcrypt $2a$ hash
When   they log in with their original password
Then   authentication succeeds without any reset
```
*Baseline: VERIFIED — hashes are portable bcrypt. **This is the acceptance test for closing risk R3.***

### AU-02 · Registration creates user + profile atomically · **PRESERVE**
```
When   a user registers
Then   a user record exists with role='customer'
And    full_name falls back to the email address when not supplied
And    the operation is atomic — no half-created user
```

### AU-03 · Registration cannot set a privileged role · **PRESERVE**
```
When   a registration payload includes role='admin'
Then   the created user has role='customer'
```

### AU-04 · Email confirmation is required · **PRESERVE + FIX UX**
```
When   a user registers
Then   TODAY:  no session is issued, and the UI redirects into a guarded route -> bounced to /login
       FUTURE: no session, and the UI shows "check your email"
```

### AU-05 · Password reset works end to end · **FIX** 🔴
```
When   a user requests a password reset
Then   TODAY:  the form throws (ROUTES.auth.callback is undefined)
       FUTURE: email -> token -> set-new-password page -> login with the new password
And    the response must not reveal whether the email exists
```

### AU-06 · Role self-escalation is impossible · **PRESERVE**
```
Given  an authenticated customer
When   they submit a profile update containing role='admin'
Then   the role remains 'customer'
```
*Baseline: VERIFIED — enforced today by `profiles_update_own WITH CHECK (role='customer')`. Must be preserved via DTO whitelisting.*

### AU-07 · `super_admin` is distinguishable from `admin` · **FIX / DECIDE**
```
Given  a user with role='admin'
When   they attempt to change another user's role
Then   TODAY:  permitted — is_admin() treats both identically
       FUTURE: 403; only super_admin may manage roles
```
*Baseline: VERIFIED — no `admin`-role user has ever existed, so this path is entirely untested.*

### AU-08 · Google OAuth · **DECIDE**
```
TODAY:  provider disabled in GoTrue; the UI button is non-functional; 0 Google identities
FUTURE: build it properly, or remove the button
```

### AU-09 · Auth endpoints are rate-limited · **FIX (new)**
```
When   N failed login attempts occur from one IP
Then   further attempts are throttled
```
*Baseline: no rate limiting exists anywhere.*

### AU-10 · Server-side password policy · **FIX**
```
When   a registration is submitted directly to the API with a 3-character password
Then   TODAY:  client-only Zod is bypassed
       FUTURE: 400 from the server-side DTO
```

---

## 5. Authorization matrix (`RolesGuard` / ownership)

**The direct replacement for RLS.** Run every endpoint against every principal: **anon × customer × other-customer × admin × super_admin**.

### AZ-01 · Order ownership (IDOR) · **PRESERVE**
```
Given  customer A owns order X
When   customer B requests order X
Then   404 (not 403 — do not confirm existence)
```
*Baseline: VERIFIED enforced today by `orders_own_read`.*

### AZ-02 · Address ownership · **PRESERVE**

### AZ-03 · Cart ownership · **PRESERVE**

### AZ-04 · Admin-only resources · **PRESERVE**
```
Given  a customer
When   they request /admin/orders, /admin/inventory, /admin/customers, /admin/audit-logs
Then   403
```

### AZ-05 · Public catalogue hides inactive/deleted · **PRESERVE**
```
Then   products, categories and brands are filtered by is_active AND deleted_at IS NULL
```

### AZ-06 · Child resources inherit parent visibility · **FIX** 🟡
```
Given  a product with is_active = false
When   an anonymous caller requests its images or attributes
Then   TODAY:  returned — those tables have SELECT USING (true)
       FUTURE: not returned
```

### AZ-07 · Reviews expose only approved content · **PRESERVE**

### AZ-08 · Coupons are never publicly listable · **PRESERVE**
```
Then   only POST /coupons/validate is public; the coupon table is never exposed
```

### AZ-09 · Audit log is not writable by the audited principal · **FIX**

---

## 6. Guest order tracking (`OrdersModule`)

### GT-01 · Correct order number + phone · **FIX (build the feature)** 🔴
```
Given  an order NE-20260503-0006 with shipping phone P
When   a guest submits that order number and P
Then   TODAY:  zero rows — RLS excludes anonymous callers; the guest always sees "not found"
       FUTURE: the order summary is returned
```

### GT-02 · Wrong phone · **FIX**
```
When   the correct order number is submitted with the wrong phone
Then   a generic 404 — never a different message, never partial data
```

### GT-03 · Phone check happens server-side · **FIX** 🔴
```
Then   the order row must NEVER reach the client before the phone matches
```
*Baseline: today the browser fetches first and compares in JS — moot only because RLS returns nothing.*

### GT-04 · Rate limiting · **FIX**
```
When   more than N tracking attempts come from one IP
Then   throttled server-side
And    a page reload must NOT reset the counter
```
*Baseline: today's limiter is in-memory client state.*

### GT-05 · Enumeration resistance · **DECIDE**
```
Given  order numbers are globally sequential and guessable
Then   consider a non-sequential public identifier
```

---

## 7. Cart (`CartModule`)

### CA-01 · Server cart computes a subtotal · **FIX** 🟠
```
Given  a cart with 2 × 100.00
When   the cart is fetched
Then   TODAY:  subtotal is always 0 — cart_items has no price column
       FUTURE: subtotal = 200.00 from stored snapshots
```

### CA-02 · Merge strategy on login · **DECIDE** 🟠
```
Given  a guest cart with product P × 2 and a server cart with product P × 3
When   the guest logs in
Then   TODAY:  ambiguous — store says max (3), provider says sum (5)
       FUTURE: one documented strategy
```
*Baseline: never exercised — 0 guest carts exist.*

### CA-03 · Quantity capped at available stock · **PRESERVE (move server-side)**

### CA-04 · Max quantity 99 · **PRESERVE (single constant)**
*Baseline: defined in 4 places today.*

### CA-05 · Prices re-derived server-side, never trusted from the client · **PRESERVE**

### CA-06 · Cart survives login · **PRESERVE**

---

## 8. Catalogue & search (`CatalogModule` / `SearchModule`)

### SE-01 · Sorting actually works · **FIX** 🟠
```
When   sort=price_asc | price_desc | newest | rating | name_asc
Then   TODAY:  ignored — search_products has no sort parameter
       FUTURE: honoured
```

### SE-02 · Pagination totals are correct · **FIX** 🟠
```
Given  120 matching products, page size 24
Then   TODAY:  total is derived from an already-paginated result — wrong
       FUTURE: total = 120, totalPages = 5
```

### SE-03 · Category pages include descendants · **FIX** 🟠
```
Given  parent category C with child C1, and a product assigned to C1
When   /categories/C is viewed
Then   TODAY:  the product is absent — exact slug match only
       FUTURE: present (materialised path[])
```

### SE-04 · Listings include images, brand and rating · **FIX** 🟠

### SE-05 · Visibility filter · **PRESERVE**

### SE-06 · Price filters use the effective price · **PRESERVE**
*Baseline: VERIFIED — filters apply to `COALESCE(sale_price, base_price)`, consistent with checkout.*

### SE-07 · In-stock filter · **PRESERVE / DECIDE**
```
TODAY: (stock_quantity - reserved_quantity) > 0 — reserved is always 0
FUTURE: depends on the IN-07 reservation decision
```

### SE-08 · Text search matches name, description and SKU · **PRESERVE (reimplement)**

### SE-09 · Ratings are real · **FIX** 🟠
```
Then   TODAY:  always 0 — avg_rating/review_count do not exist
       FUTURE: maintained aggregate over approved reviews
```

### SE-10 · Slug redirects are honoured · **FIX**
```
Given  a product renamed from old-slug to new-slug
When   /products/old-slug is requested
Then   TODAY:  404 — slug_redirects is written but never read
       FUTURE: 301 to /products/new-slug
```

---

## 9. Profile & addresses (`UsersModule`)

### PR-01 · A customer can save their profile · **FIX** 🟠
```
Given  an authenticated customer
When   they update their full name and phone
Then   TODAY:  fails — no INSERT policy on profiles, and the app uses upsert
       FUTURE: succeeds
```
*Baseline: INFERRED (high confidence). The `super_admin` would not reproduce it.*

### PR-02 · Setting a default address unsets the others · **FIX**
```
Given  addresses A (default) and B
When   B is set as default
Then   TODAY:  both are default — the client sets true and never unsets siblings
       FUTURE: exactly one default, in one atomic update
```
*Baseline: untested by data — only 1 address exists.*

### PR-03 · First address becomes default · **PRESERVE**

### PR-04 · Email is immutable via the profile endpoint · **PRESERVE**

### PR-05 · Egyptian phone validation is enforced server-side · **FIX**
```
Then   TODAY: the checkout UI skips the regex the schema defines
       FUTURE: enforced in the DTO
```

---

## 10. Audit (`AuditModule`)

### AD-01 · Every admin mutation produces exactly one audit record · **FIX** 🔴
```
When   an admin creates, updates or deletes any entity
Then   TODAY:  nothing is written — admin_audit_logs has 0 rows
       FUTURE: one record with actor, action, entity, before/after, ip, userAgent, requestId
```

### AD-02 · Audit-write failure is loud · **FIX**
```
Given  an audit write fails
Then   TODAY:  swallowed silently
       FUTURE: logged at error level and alerted
```

### AD-03 · Audit records are immutable and not writable by the audited principal · **FIX**

---

## 11. Coupons (`CouponsModule`) — **DECIDE: build or drop**

Only if the feature is approved (Phase 0 open question 10). No redemption path exists today and there are 0 coupons.

- **CO-01** valid code applies the discount · **CO-02** expired rejected · **CO-03** below `min_order` rejected · **CO-04** `usage_limit` exhausted rejected · **CO-05** percentage capped by `max_discount` · **CO-06** fixed discount never exceeds subtotal · **CO-07** `used_count` increments atomically inside the order transaction · **CO-08** inactive rejected · **CO-09** invalid code gives a generic error · **CO-10** the coupon snapshot is stored on the order

---

## 12. Reviews (`ReviewsModule`) — **DECIDE: build or drop**

Only if approved (Phase 0 open question 11). 0 reviews exist; no storefront submission or display.

- **RV-01** one review per user per product · **RV-02** new reviews default to `pending` · **RV-03** only `approved` are publicly visible · **RV-04** a user may edit only while `pending` (VERIFIED as today's RLS rule) · **RV-05** `isVerifiedPurchase` computed from delivered orders · **RV-06** approving updates `products.rating` · **RV-07** deleting recomputes it · **RV-08** one helpfulness vote per user per review

---

## 13. Migration-specific verification — **SUPERSEDED**

> ### ⛔ SUPERSEDED by the clean-database correction (Architecture Freeze Ratification, C1)
>
> **The project starts with a fresh MongoDB database. There is no legacy data migration** — no users, orders, products, passwords, images or ledger entries are carried over, and there is **no reconciliation against legacy data**.
>
> **MG-01 … MG-06 below are NOT implementation requirements.** They are retained only as a historical record of what a migration would have had to prove. In particular, the legacy reconciliation figures (`SUM(orders.total) = 7367.00` etc.) describe disposable development data and must never be asserted.
>
> **Replaced by: SEED INTEGRITY VALIDATION** — fresh seed/development data is validated against the new domain architecture (schema validity, reference integrity, money validity, stock validity, order invariants, lifecycle validity). See [`architecture/ARCHITECTURE-FREEZE-RATIFICATION.md`](./architecture/ARCHITECTURE-FREEZE-RATIFICATION.md) §7. No seed tests or scripts are defined in this phase.

### Historical record (not requirements)

### MG-01 · Reconciliation is zero-delta · **MUST PASS**
```
Then   users 4 · products 85 · categories 27 · brands 17 · orders 10
       order_items 7 · order_status_history 8 · inventory_transactions 7
       blog_posts 6 · addresses 1 · carts 2 · cart_items 4
       SUM(orders.total) = 7367.00 · SUM(orders.subtotal) = 7367.00
       SUM(order_items.total) = 1867.00 · SUM(order_items.quantity) = 11
       SUM(products.stock_quantity) = 58503 · SUM(reserved_quantity) = 0
```

### MG-02 · Migration is idempotent · **MUST PASS**

### MG-03 · Historical orders are not recomputed · **MUST PASS**
```
Then   the 3 seeded orders with totals but no line items are preserved verbatim
```

### MG-04 · Images · **MUST PASS**
```
Then   exactly 2 real files are migrated to Cloudinary
And    the 20 placehold.co URLs are NOT copied
```

### MG-05 · Passwords · **MUST PASS**
```
Then   all 4 users authenticate with their original passwords
```

### MG-06 · Pre-existing defects are not counted as regressions · **MUST PASS**
```
Then   every item in baseline.md "Known-broken features" is either fixed
       (recorded as an improvement) or still broken (recorded as pre-existing)
```

---

## Coverage summary

| Area | Cases | PRESERVE | FIX | DECIDE |
|---|---|---|---|---|
| Order creation | 15 | 6 | 6 | 3 |
| Order status | 8 | 2 | 5 | 1 |
| Inventory | 8 | 4 | 3 | 1 |
| Authentication | 10 | 3 | 5 | 2 |
| Authorization | 9 | 6 | 3 | 0 |
| Guest tracking | 5 | 0 | 4 | 1 |
| Cart | 6 | 4 | 1 | 1 |
| Catalogue & search | 10 | 4 | 5 | 1 |
| Profile & addresses | 5 | 2 | 3 | 0 |
| Audit | 3 | 0 | 3 | 0 |
| Coupons | 10 | — | — | all |
| Reviews | 8 | — | — | all |
| ~~Migration~~ *(superseded — see §13)* | ~~6~~ | — | — | — |
| **Total** | **103** | **37** | **38** | **28** |

> Roughly **as many behaviours need fixing as need preserving.** That is the defining characteristic of this migration: it is not a port. Any plan that assumes "reproduce current behaviour" will reproduce a large set of defects — which is precisely why this inventory, not the old code, should be the specification.
