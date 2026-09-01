# Money & Financial Representation — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADR:** ADR-MONEY-001

---

## 1. Decision

> **All monetary amounts are stored, transmitted and computed as signed 64-bit integers in EGP minor units (piastres), accompanied by an explicit ISO-4217 currency code.**
> **Floating-point types are forbidden for money anywhere in the system.**

```jsonc
{ "amount": 15075, "currency": "EGP" }   // = 150.75 EGP
```

**1 EGP = 100 piastres.** All amounts are integral piastres. There are no fractional piastres anywhere.

---

## 2. Context

| Fact | Source |
|---|---|
| Legacy storage type | `numeric(10,2)` on every money column | Phase 0.5 `schema.sql` |
| Currency in use | EGP only — hardcoded `'EGP'`, Egyptian market | `PRODUCT.md`, `PROJECT_OVERVIEW.md` |
| Payment method | Cash on Delivery only in MVP | `PROJECT_OVERVIEW.md` |
| Live money data | 10 orders, Σ total 7,367.00; discount/shipping/tax all 0.00 | Phase 0.5 `data-integrity.md` |
| Max observed magnitude | 3,400.00 EGP (single order) | Phase 0.5 |
| Legacy JS handling | `numeric` arrived as a JS `number` (IEEE-754 double) through PostgREST and was summed in React components | Phase 0 B2/B3 |

**The concrete legacy hazard:** PostgreSQL stored exact decimals, but every value crossed into JavaScript as a double. Cart subtotals were computed in `CheckoutStepper.tsx` and `CartDrawer.tsx` with floating-point arithmetic. `0.1 + 0.2 !== 0.3` applies to piastres just as it does to cents. The database's exactness was discarded the moment a value left it.

MongoDB offers `Decimal128`, which would preserve exactness. It is rejected in §4.

---

## 3. Currency scope: SINGLE CURRENCY

**Decision: the system is single-currency (EGP) for MVP, with a currency code carried explicitly anyway.**

| Consideration | Finding |
|---|---|
| Target market | Egypt only (`PRODUCT.md`) |
| Payment | COD in EGP; a courier cannot collect foreign cash |
| Multi-currency demand | None in any requirement document |
| Cost of carrying `currency` | One 3-character field |
| Cost of adding it later | Rewriting every money field, DTO and calculation |

So: **no multi-currency logic** (no FX rates, no conversion, no per-currency pricing), but **every money value carries `currency: "EGP"`** so that:

1. an amount is never ambiguous in a log, an API response, or a Flutter client;
2. a future second currency is an additive change, not a migration;
3. mixing currencies in a sum can be *detected* rather than silently producing nonsense.

**Invariant:** any arithmetic across two `Money` values with differing `currency` throws. It cannot occur today; the guard is what keeps it impossible tomorrow.

---

## 4. Options considered

| Option | Verdict | Reasoning |
|---|---|---|
| **A. IEEE-754 double** (`number`) | ❌ **Rejected** | Cannot represent 0.1 exactly. Accumulates error over line items. This is what legacy effectively did in the browser. Explicitly forbidden by the brief. |
| **B. MongoDB `Decimal128`** | ❌ **Rejected** | Exact and correct, but every read requires marshalling to a JS type with no native decimal support — so application code needs a decimal library anyway, and a careless `Number(x)` silently reintroduces float error. Serialising to JSON for Flutter has no canonical form. It moves the problem to the boundary rather than removing it. |
| **C. Decimal string** (`"150.75"`) | ❌ **Rejected** | Not arithmetic-capable; requires parsing everywhere; sorting and range queries in MongoDB are lexicographic, breaking price filters and sorts. |
| **D. Integer minor units + currency code** | ✅ **CHOSEN** | Exact by construction. Native to BSON `Long`/`Int32`, JSON, JS `number` (within safe range), and Dart `int`. Sorts and range-queries correctly. Universal industry practice (Stripe, PayPal, Adyen). |

### Safety of JS `number` for integer piastres

`Number.MAX_SAFE_INTEGER` = 9,007,199,254,740,991 ≈ 9.0 × 10¹⁵ piastres ≈ **90 trillion EGP**. The largest live order is 340,000 piastres. Integers remain exact in JS by ~11 orders of magnitude of headroom. Dart's `int` is 64-bit natively. **No precision risk.**

Storage: BSON `Int32` holds up to ±21 million EGP — sufficient for any single order, but **`Long` (Int64) is mandated** for all money fields to remove any ceiling concern on aggregates (lifetime revenue, `stats.totalSpent`).

---

## 5. The `Money` value object

Conceptual shape — persisted, transmitted and computed identically.

```
Money {
  amount:   int64      // minor units (piastres). May be negative for deltas.
  currency: string     // ISO-4217, "EGP". Immutable in MVP.
}
```

**Rules:**

1. `amount` is always an **integer**. Any operation producing a fraction must round (§7) before construction.
2. Two `Money` values may only be added/compared when `currency` matches.
3. `Money` is immutable; operations return a new value.
4. A bare number is never a money value. Every persisted money field is a `Money` sub-document or, where the currency is fixed at the parent level, an integer field explicitly suffixed and documented as minor units.

### Persistence convention

For **compactness inside high-volume documents**, money is stored as a plain integer field alongside a single `currency` at the document root, rather than repeating `{amount, currency}` on every line:

```jsonc
// orders document
{
  "currency": "EGP",              // once per order
  "pricing": {
    "itemsSubtotal": 736700,      // int64 minor units
    "discountTotal": 0,
    "shippingFee":  5000,
    "grandTotal":   741700
  },
  "items": [
    { "unitPrice": 12500, "lineTotal": 25000, "quantity": 2 }
  ]
}
```

At the **API boundary** the same values are returned in a self-describing form so a Flutter client never has to infer scale — see §8.

---

## 6. Where money appears

| Domain | Field | Type | Notes |
|---|---|---|---|
| Catalog | `pricing.basePrice` | int64 minor | Required, > 0 |
| Catalog | `pricing.salePrice` | int64 minor \| null | If set: `0 < salePrice < basePrice` |
| Catalog | `pricing.costPrice` | int64 minor \| null | **Admin-only. Never serialised to a public DTO.** |
| Cart | `items[].unitPriceSnapshot` | int64 minor | **Display only.** Never used to compute a payable amount. |
| Cart | `totals.*` | int64 minor | Recomputed server-side on every read |
| Orders | `items[].unitPrice`, `lineTotal` | int64 minor | **Immutable snapshot** |
| Orders | `pricing.itemsSubtotal`, `discountTotal`, `shippingFee`, `grandTotal` | int64 minor | Immutable after placement |
| Orders | `coupon.discountApplied` | int64 minor | Snapshot |
| Pricing | `coupons.value` | int64 minor **or** basis points | Discriminated by `type` — see §7.3 |
| Pricing | `coupons.minOrderAmount`, `maxDiscountAmount` | int64 minor \| null | |
| Fulfilment | `shippingRates[].fee`, `freeShippingThreshold` | int64 minor | |
| Users | `stats.totalSpent` | int64 minor | Maintained aggregate |

---

## 7. Calculation & rounding rules

### 7.1 Canonical order total

The **only** formula permitted to produce a payable amount:

```
lineTotal(i)   = effectiveUnitPrice(i) × quantity(i)          // exact, integers
itemsSubtotal  = Σ lineTotal(i)
discountTotal  = clamp(couponDiscount, 0, itemsSubtotal)
shippingFee    = FulfilmentService.quote(governorate, itemsSubtotal - discountTotal)
grandTotal     = itemsSubtotal - discountTotal + shippingFee
```

**Invariants (asserted in code, not merely documented):**
- `itemsSubtotal ≥ 0`
- `0 ≤ discountTotal ≤ itemsSubtotal`
- `shippingFee ≥ 0`
- `grandTotal ≥ 0` — **a discount can never make an order negative or pay for shipping**
- `grandTotal == itemsSubtotal - discountTotal + shippingFee` (recomputed and asserted before persistence)

There is **no tax term** — see §7.4.

### 7.2 Rounding

Multiplication of an integer price by an integer quantity is exact; **no rounding occurs in line totals.** Rounding is required in exactly one place: **percentage discounts.**

- **Rule:** `ROUND_HALF_UP` to the nearest piastre.
- **Rationale:** the conventional retail expectation in Egypt, and it never rounds a discount *up* past the cap because the cap is applied after rounding.
- **Implementation:** `Math.round(subtotal * bps / 10000)` where `bps` is the discount in basis points — a single integer expression with no intermediate float beyond one division that stays well within safe-integer range.

```
Example: subtotal 15075 piastres, 15% coupon
  raw      = 15075 × 1500 / 10000 = 2261.25
  rounded  = 2261 piastres (2261.25 → HALF_UP on .25 → 2261)
  capped   = min(2261, maxDiscountAmount)
```

**Rounding happens exactly once per order, on the coupon discount.** Every other value is exact.

### 7.3 Percentage representation

Percentages are **basis points (integer, 1/100 of a percent)**, never floats.

```
15%    -> 1500 bps
7.5%   -> 750  bps
100%   -> 10000 bps
```

`coupons.type` discriminates the meaning of `value`:

| `type` | `value` means | Range |
|---|---|---|
| `PERCENTAGE` | basis points | 1 … 10000 |
| `FIXED` | EGP minor units | ≥ 1 |

This removes the legacy ambiguity where a single `numeric` column meant "15" for both 15% and 15.00 EGP.

### 7.4 VAT — prices are tax-inclusive

**Decision: displayed and stored prices are VAT-inclusive. There is no additive tax term in the total.**

| Evidence | Finding |
|---|---|
| Legacy `orders.tax` | Exists, **always 0** across all 10 orders |
| Product detail page | Already states *"Price includes VAT"* (Phase 0 §25.H q9) |
| Egyptian retail convention | Consumer prices are quoted VAT-inclusive |

Consequences:
- `grandTotal` has no `+ tax` term. The legacy `tax` column is **not** carried forward as a component of the total.
- The order document stores `vatInclusive: true` and `vatRateBps` (default `1400` = 14%, Egypt's standard rate) **as informational metadata**, so a VAT component can be *derived* for an invoice without changing what the customer pays:
  ```
  vatComponent = round(grandTotal × vatRateBps / (10000 + vatRateBps))
  ```
- 🔶 **OPEN (non-blocking):** whether invoices must display the VAT breakdown, and the correct rate for electronic components, is a business/accounting input. Recording `vatRateBps` on each order now means the answer can change later without rewriting historical orders.

### 7.5 Forbidden operations

- ❌ Any `float`/`double`/`Number` intermediate in a money calculation
- ❌ `parseFloat`, `toFixed`, or `Number(x)` on a money value
- ❌ Currency conversion (no second currency exists)
- ❌ Dividing money by money
- ❌ Computing a payable amount anywhere outside `PricingService`
- ❌ Accepting any money value from a client as authoritative

---

## 8. API representation

The wire format is **self-describing**, so neither the Next.js client nor the Flutter client can misinterpret scale.

```jsonc
{
  "grandTotal": {
    "amount": 741700,          // int64 minor units — the authoritative value
    "currency": "EGP",
    "formatted": "7,417.00 EGP" // server-rendered, presentation only
  }
}
```

**Rules for clients:**
- `amount` is authoritative for any comparison or display logic.
- `formatted` is a convenience for direct rendering; clients must not parse it.
- **Clients never perform money arithmetic.** Every total the UI shows comes from the server. The cart endpoint returns computed totals precisely so the client has nothing to add up — directly closing the legacy defect where `CheckoutStepper.tsx` and `CartDrawer.tsx` each summed the cart independently.

Locale for `formatted`: `en-EG`, grouped thousands, always 2 decimal places.

---

## 9. Historical snapshots

Money on an order is **immutable after placement**. It is a record of a commercial agreement, not a projection of current catalogue state.

| Snapshotted on the order | Why |
|---|---|
| `items[].unitPrice` | A later price change must never alter a past order |
| `items[].lineTotal` | Stored, not derived, so a rounding-rule change cannot retroactively alter history |
| `pricing.*` | The exact totals the customer agreed to |
| `coupon.{code, type, value, discountApplied}` | Editing or deleting the coupon must not rewrite the order |
| `currency`, `vatInclusive`, `vatRateBps` | The tax regime in force at the time |

**Recomputation of a historical order is forbidden.** Phase 0.5 found 3 seeded orders whose totals do not match their (absent) line items; the rule holds even there — such records are preserved as-is, never "corrected".

---

## 10. Consequences

**Positive**
- Money arithmetic is exact by construction; a rounding bug becomes structurally impossible outside the single discount rounding step.
- Native to BSON, JSON, TypeScript and Dart — no decimal library, no marshalling layer.
- Sorting and range filters on price work correctly in MongoDB (a real legacy defect: price filters were computed from the current page only).
- The Flutter developer receives an unambiguous contract.

**Negative / accepted**
- Every developer must internalise "amounts are piastres". Mitigated by naming (`amountMinor` in internal types), the self-describing API shape, and lint rules against float operations on money fields.
- Seed and fixture data must be written in minor units (`12500`, not `125.00`).
- A future currency with a different exponent (e.g. a 3-decimal currency) needs an explicit `exponent` field. Not a concern for EGP.

---

## 11. Revisit conditions

| Trigger | Action |
|---|---|
| A second currency is introduced | Add `exponent` per currency; add FX rate handling; keep integer minor units |
| A payment provider (Paymob) is integrated | Verify its minor-unit convention matches; it does for EGP |
| Per-item tax rates become necessary | Revisit §7.4; the per-order `vatRateBps` snapshot makes this additive |
| Amounts approach 9 × 10¹⁵ piastres | Not foreseeable — 90 trillion EGP |

---

## 12. Summary

| Question | Answer |
|---|---|
| Representation | **Integer minor units (piastres), int64** |
| Currency | **Single currency, EGP**, with the code carried explicitly |
| Percentages | **Basis points (integer)** |
| Rounding | **HALF_UP, exactly once**, on percentage discounts only |
| Tax | **Prices are VAT-inclusive; no additive tax term** |
| Total formula | `itemsSubtotal − discountTotal + shippingFee` |
| Negative totals | **Impossible** — discount clamped to `[0, itemsSubtotal]` |
| Client arithmetic | **Forbidden.** All totals are server-computed. |
| Historical orders | **Immutable.** Never recomputed. |
| Floats | **Forbidden anywhere in the money path** |
