# DTO Strategy — Phase 1.1

**Status:** FROZEN pending review · **Date:** 2026-08-30 · **ADR:** ADR-CODE-005, 006

---

## 1. The governing principle

> **The API contract is a published interface. The domain model is an internal implementation detail. They must be free to change independently.**

Phase 1 established that the API is consumed by two independently-shipped clients — the Next.js web app and a Flutter app built in a separate repository ([`API-CONTRACT.md`](./API-CONTRACT.md)). That makes the boundary real: a field renamed in a Mongoose schema must not break a Flutter build already on real devices, and a Flutter feature request must not reshape the order aggregate.

The corollary is equally important:

> **A DTO is never a Mongoose document, and a Mongoose document is never a response.**

---

## 2. Full flow — and when to collapse it

The complete pipeline:

```
HTTP Request
    ↓  Request DTO          (validation, transport shape)
    ↓  Command / Query      (application input, domain-shaped)
    ↓  Business logic       (domain types)
    ↓  Result               (application output)
    ↓  Response DTO         (serialisation, transport shape)
HTTP Response
```

**Applying all five stages to every endpoint would be exactly the over-engineering the brief forbids.** `GET /brands` does not need a `ListBrandsQuery` object and a `BrandListResult`.

The strategy is therefore tiered, matching the module tiers in [`CODEBASE-STRUCTURE.md`](./CODEBASE-STRUCTURE.md) §3.

### Tier 1 & 2 — collapsed (the common case)

```
Request DTO  →  Service  →  Response DTO
```

The Request DTO *is* the application input. No command object, no result object. Used for all CRUD and read endpoints.

```
POST /admin/brands
  CreateBrandDto  →  BrandsService.create(dto)  →  BrandResponseDto
```

### Tier 3 — explicit (money, stock, state, credentials)

```
Request DTO  →  Command  →  Service  →  Result  →  Response DTO
```

```
POST /orders
  PlaceOrderDto            (HTTP: addressId?, shippingAddress?, couponCode?, note?)
      ↓  controller maps, injecting userId from the JWT
  PlaceOrderCommand        ({ userId, address, couponCode, idempotencyKey })
      ↓
  OrderPlacementService.execute(command)
      ↓
  PlacedOrderResult        ({ orderId, orderNumber, pricing, items })
      ↓
  OrderResponseDto
```

---

## 3. When a Command object is required

A Command is mandatory when **any** of these holds:

| # | Condition | Example |
|---|---|---|
| 1 | The input includes data **not present in the HTTP request** | `userId` from the JWT, `Idempotency-Key` from a header, actor identity |
| 2 | The operation is **transactional across collections** | Order placement, cancellation, stock adjustment |
| 3 | The operation has **more than one caller** | Cancellation is invoked by a customer route *and* an admin route with different guards |
| 4 | Money or stock is computed | Every pricing path |

**Condition 1 is the load-bearing one, and it is a direct answer to a Phase 0.5 finding.** Legacy `create_order_v2` accepted `p_user_id` as a parameter and never compared it to the caller (F-CRIT-2). A Command makes the provenance of `userId` explicit and structural: the DTO has no such field, and the controller is the only place that can populate it from the authenticated principal.

```ts
// PlaceOrderDto  — what the client MAY send
class PlaceOrderDto {
  addressId?: string;
  shippingAddress?: AddressInputDto;
  couponCode?: string;
  customerNote?: string;
  // NO userId. NO items. NO prices. NO totals.
}

// PlaceOrderCommand — what the service actually receives
type PlaceOrderCommand = {
  userId: UserId;            // ← from the JWT, never from the body
  idempotencyKey: string;    // ← from the header
  address: ShippingAddress;
  couponCode?: string;
  customerNote?: string;
};
```

A reviewer looking at these two types can see the entire trust boundary in fifteen lines.

**When a Command is NOT required:** the input is exactly the HTTP body plus a path parameter, the operation touches one collection, and no money or stock is involved. In that case, forcing a Command adds a file and a mapping function for zero benefit.

---

## 4. When a Result object is required

A Result is required when the service returns data that is **not** simply the persisted entity:

| Situation | Result object? |
|---|---|
| Order placement returns id + number + computed pricing | ✅ `PlacedOrderResult` |
| Cart read returns lines + computed totals + per-line status flags | ✅ `CartResult` |
| Coupon validation returns validity + discount + projected total | ✅ `CouponValidationResult` |
| Search returns items + meta + facets | ✅ `ProductSearchResult` |
| `create`/`update` returns the entity | ❌ Return the domain object; map in the controller |
| `findOne` returns the entity | ❌ Same |

**Rule:** if the service's return type is *the thing that was stored*, no Result object is needed. If it is *a computed view*, a Result object names it.

---

## 5. Request DTOs

### Naming

`<Verb><Noun>Dto` — matching the operation, not the entity.

```
CreateProductDto · UpdateProductDto · PlaceOrderDto · TrackOrderDto
AddCartItemDto · UpdateCartItemDto · AdjustStockDto · ValidateCouponDto
RegisterDto · LoginDto · ResetPasswordDto
```

**Never** one shared `ProductDto` for create and update. Create requires `sku`; update forbids it (SKU is immutable per [`CATALOG-MODEL.md`](./CATALOG-MODEL.md) §2). One class cannot express both without optional-everything, which defeats validation.

`UpdateXDto` is derived with `PartialType(CreateXDto)` **only** when every field is genuinely optional and none is create-only. Otherwise it is written out.

### Validation

**Location: the DTO, via `class-validator` decorators, enforced by the global `ValidationPipe`.**

```ts
new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,     // ← security control, not convenience
  transform: true,
  transformOptions: { enableImplicitConversion: false },
})
```

`forbidNonWhitelisted` is what makes these structurally impossible ([`API-STANDARDS.md`](./API-STANDARDS.md) §4):

| Injection attempt | Result |
|---|---|
| `role` in a profile update | `400 UNKNOWN_FIELD` |
| `stock` in a product update | `400 UNKNOWN_FIELD` |
| `userId` in an order body | `400 UNKNOWN_FIELD` |
| `price` / `total` at checkout | `400 UNKNOWN_FIELD` |

`enableImplicitConversion: false` is deliberate: implicit coercion would turn `"quantity": "-5"` into a number silently, and quantity validation is a Phase 0.5 critical fix (F-CRIT-3).

**Validation is layered, not duplicated:**

| Layer | Validates | Example |
|---|---|---|
| **DTO** | Shape, type, format, range | `@IsInt() @Min(1) @Max(99) quantity` |
| **Service** | Business invariants requiring state | Stock availability, coupon eligibility, transition legality |
| **Database** | Structural integrity | Unique indexes, `strict: 'throw'` |

The DTO answers *"is this a well-formed request?"*. The service answers *"is this allowed right now?"*. Neither substitutes for the other — quantity bounds are re-asserted in the service before the stock update, because the DTO is a transport concern and the service must be safe when called from a test or another service.

### Zod vs class-validator

> **Decision: `class-validator` + `class-transformer` for DTOs.**

Phase 0 noted `@nest/types` already contains Zod schemas, and `nestjs-zod` was a candidate. `class-validator` is chosen because:

1. It is the idiomatic NestJS path — `ValidationPipe`, `PartialType`, `@nestjs/swagger` integration all assume it.
2. **`@nestjs/swagger` generates the OpenAPI document from the same decorated classes that perform runtime validation.** Phase 1 requires that documentation cannot drift from behaviour ([`API-CONTRACT.md`](./API-CONTRACT.md) §8); this is the mechanism that guarantees it. A separate Zod schema would have to be kept in sync with a separate Swagger annotation.
3. The Flutter client is generated from that OpenAPI document, so decorator-derived accuracy has downstream value.

The existing Zod schemas remain useful as a **specification reference** when writing DTOs — they encode real rules such as the Egyptian phone regex — but they are not the runtime mechanism.

---

## 6. Response DTOs

### Naming

`<Noun>ResponseDto`, with explicit variants where audience differs:

```
ProductResponseDto          # public
ProductAdminResponseDto     # includes costPrice, stock detail
ProductListItemDto          # trimmed shape for grids
OrderResponseDto            # full, owner or admin
OrderTrackingResponseDto    # minimal public projection
```

### Audience separation is structural, not conditional

> **Different audiences get different classes — never one class with conditional field stripping.**

Phase 1 requires that `costPrice` never reaches a public consumer ([`CATALOG-MODEL.md`](./CATALOG-MODEL.md) §5), that `adminNote` never reaches a customer, and that order tracking returns no PII, no items and no money ([`GUEST-CHECKOUT.md`](./GUEST-CHECKOUT.md) §3.4).

Runtime stripping — `@Exclude()` plus a group, or deleting keys in a service — makes these guarantees depend on a decorator being present and a serialisation interceptor being wired. **Separate classes make them depend on the field not existing.** That is the difference between a policy and a structure.

```
OrderTrackingResponseDto  = { orderNumber, status, placedAt, itemCount,
                              statusHistory[{to, at}], estimatedDeliveryAt, carrier }
```

There is no `items`, no `pricing`, no `customer`, no `shippingAddress`, no `trackingNumber` — so no code path can leak them.

### Construction

Response DTOs are constructed by an explicit **static factory**, not by `plainToInstance` over a document:

```ts
class ProductResponseDto {
  static from(product: Product): ProductResponseDto { … }
  static fromList(products: Product[]): ProductListItemDto[] { … }
}
```

An explicit mapper is greppable, type-checked, and fails at compile time when a domain field is renamed. Automatic transformation silently passes through whatever the document happens to contain — which is precisely how `costPrice` leaks.

### Money and dates in responses

Per [`MONEY-MODEL.md`](./MONEY-MODEL.md) §8 and [`API-CONTRACT.md`](./API-CONTRACT.md) §1:

```jsonc
"grandTotal": { "amount": 741700, "currency": "EGP", "formatted": "7,417.00 EGP" }
"placedAt": "2026-08-30T14:22:31.000Z"
"id": "652f1a9b3c4d5e6f7a8b9c0d"
```

A shared `MoneyDto` in `common/dto/` produces this shape. **No response ever returns a bare number for money**, and no client is ever expected to compute a total.

### Localised text

Resolved server-side. Clients receive `"name": "ESP32 DevKit V1"`, never `{en, ar}` ([`CATALOG-MODEL.md`](./CATALOG-MODEL.md) §3). Resolution happens in the Response DTO factory using the request locale.

---

## 7. Shared DTOs in `common/dto/`

Only genuinely universal transport shapes:

| DTO | Purpose |
|---|---|
| `PaginationQueryDto` | `page`, `limit` with bounds — used by every list endpoint |
| `PaginatedResponseDto<T>` | `{ data, meta: { page, limit, total, totalPages, hasNext, hasPrev } }` |
| `MoneyDto` | `{ amount, currency, formatted }` |
| `IdParamDto` | Validated ObjectId path parameter |
| `SlugParamDto` | Validated slug path parameter |

**Filtering and sorting DTOs are module-local**, extending `PaginationQueryDto`. `ProductSearchQueryDto` has nothing in common with `OrderListQueryDto` beyond pagination, and forcing a shared base would create a fake abstraction.

Each module declares its own `sort` allow-list as a union type; an unlisted value yields `400 UNSUPPORTED_SORT`. This is a direct fix for the legacy defect where the UI advertised five sort options that the backend had no parameter to receive.

**Explicitly forbidden: a generic filter DTO accepting arbitrary field/operator pairs.** Legacy interpolated user input into PostgREST `.or()`/`.ilike()` filter strings in six places, letting a caller restructure the filter tree. Filters are always named, typed parameters.

---

## 8. Anti-patterns

| Anti-pattern | Why it is harmful | Rule |
|---|---|---|
| Returning a Mongoose document | Leaks `__v`, `_id` shape, `costPrice`, internal fields; couples the wire format to the schema | Always a Response DTO |
| One DTO for create + update | Forces every field optional, destroying validation | Separate classes |
| DTO used as a domain type | The API contract becomes the domain model; a Flutter request reshapes the aggregate | Command/domain types are separate at Tier 3 |
| Command object for trivial CRUD | Two files and a mapper for zero benefit | Collapse at Tier 1/2 |
| Response DTO that mirrors the schema 1:1 | The mapping exists but adds no value | Acceptable *only* where audience separation or field renaming is real; otherwise reconsider the tier |
| Conditional field stripping by role | Security depends on a decorator being remembered | Separate classes per audience |
| Business logic in a DTO | Rules become untestable without HTTP | DTOs carry validation decorators only |
| Generic filter/query passthrough | Reproduces the legacy filter-injection surface | Named typed parameters |
| Deep DTO inheritance chains | The effective shape of a request becomes unreadable | Max one level (`PartialType` counts as that level) |

---

## 9. Worked examples

### Trivial — `POST /admin/brands`

```
CreateBrandDto { name, slug?, logo? }
    → BrandsService.create(dto)          // Tier 1: dto IS the input
    → Brand
    → BrandResponseDto.from(brand)
```

**Files: 2 DTOs.** No command, no result, no mapper class.

### Complex — `POST /orders`

```
PlaceOrderDto { addressId?, shippingAddress?, couponCode?, customerNote? }
    → controller: + userId (JWT), + idempotencyKey (header)
    → PlaceOrderCommand
    → OrderPlacementService.execute(cmd)
        · loads authoritative products (never the cart's snapshot)
        · PricingService computes totals
        · InventoryService consumes stock
        · transaction
    → PlacedOrderResult { orderId, orderNumber, pricing, items }
    → OrderResponseDto.from(result)
```

**Files: 2 DTOs + 1 command + 1 result.** Justified by conditions 1, 2 and 4 in §3.

### Audience-separated — order tracking

```
TrackOrderDto { orderNumber, phone }
    → OrderTrackingService.track(orderNumber, phone)     // both in the QUERY filter
    → OrderTrackingResult                                 // minimal by construction
    → OrderTrackingResponseDto
```

The Result type itself contains no PII, so even an accidental change to the Response DTO cannot leak customer data. The projection is enforced twice — in the query and in the type.

---

## 10. Summary

| Question | Answer |
|---|---|
| Full 5-stage flow always? | **No** — collapsed at Tier 1/2, explicit at Tier 3 |
| Command object required when | External data (userId, idempotency key) · transactional · multiple callers · money/stock |
| Result object required when | The return is a computed view, not the stored entity |
| Request DTO naming | `<Verb><Noun>Dto` |
| Response DTO naming | `<Noun>ResponseDto`, with explicit audience variants |
| Validation location | DTO (shape) → service (state) → database (integrity) |
| Validation library | **`class-validator`** — feeds the OpenAPI document that generates the Flutter client |
| Audience separation | **Separate classes**, never conditional stripping |
| Response construction | Explicit static factory, never automatic transformation |
| Documents in responses | **Never** |
| Shared DTOs | Pagination, Money, id/slug params — nothing else |
| Filters | Named typed parameters; **no generic passthrough** |
