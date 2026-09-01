# Provider Replacement Tests — Phase 1.1

**Status:** FROZEN pending review · **Date:** 2026-08-30

> An **architecture validation exercise**, not an implementation. Each scenario walks a hypothetical vendor change file by file and states exactly what would move, what would not, and what would remain stable.
>
> A replaceability claim that has never been traced is an assumption. These traces are how the claim is checked — and §3.5 records where the guarantee is genuinely weaker than the headline.

---

## Test 1 — Resend → Zoho Mail

### Files that would be **ADDED**

```
src/providers/email/zoho/
├── zoho-email-sender.ts        # implements EmailSenderPort
├── zoho.mapper.ts              # OutboundEmail -> Zoho payload
└── zoho.config.ts              # ZOHO_* namespace
```

### Files that would be **MODIFIED** — three

| File | Change | Lines |
|---|---|---|
| `src/config/env.schema.ts` | Add `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_ACCOUNT_ID`, conditionally required when `EMAIL_PROVIDER=zoho` | ~6 |
| `src/config/email.config.ts` | Extend the provider union: `'resend' \| 'console'` → `'resend' \| 'zoho' \| 'console'` | 1 |
| `src/providers/providers.module.ts` | Add one branch to the `useClass` conditional | ~3 |

### Files that would be **DELETED** (after verification)

```
src/providers/email/resend/**     # 3 files
```
Plus the `RESEND_API_KEY` entry in the schema.

### What would **NOT** change

| Untouched | Why |
|---|---|
| **`src/modules/**` — every business module** | None imports a vendor. `AuthModule` and `OrdersModule` call `NotificationsService`; they do not even see `EmailSenderPort`. |
| `modules/notifications/application/notifications.service.ts` | Depends on `EmailSenderPort`, an abstract class it never resolves |
| `modules/notifications/application/ports/email-sender.port.ts` | The contract is the fixed point |
| **`src/templates/email/**` — all 14 templates + layouts + partials** | Rendering completes **before** the port is called |
| `HandlebarsTemplateRenderer` | Rendering is unrelated to transmission |
| Every template data contract | — |
| `common/`, `database/`, every DTO, controller, schema, repository | — |
| **Every business test** | Fakes implement the port, not the vendor |

### Traceable count

| | |
|---|---|
| Files added | **3** |
| Files modified | **3** (~10 lines total) |
| Files deleted | **3** |
| Business modules changed | **0** |
| Templates changed | **0** |
| Business tests changed | **0** |

### What makes this work

1. **`OutboundEmail` and `EmailSendResult` are application-owned.** No Resend type appears in the port ([`PROVIDER-ARCHITECTURE.md`](./PROVIDER-ARCHITECTURE.md) §5.2).
2. **Rendering happens before the port.** Templates never reach a vendor as a template *reference*, only as rendered HTML — the decision that keeps §1's "0 templates changed" true.
3. **`from` is adapter-supplied.** The business layer never names a sender identity.
4. **`providerMessageId` is opaque** — logged and stored, never parsed. Its format changing breaks nothing.
5. **Vendor errors are translated at the adapter boundary.** `NotificationsService` catches `EmailTransportError`; Zoho's error types never surface.

### Acceptance

The **port conformance suite** ([`TESTING-ARCHITECTURE.md`](./TESTING-ARCHITECTURE.md) §7) runs unchanged against `ZohoEmailSender`. If it passes without modification, the swap is complete. **If the suite must be edited to accommodate Zoho, the port was vendor-shaped** and the design has failed — that is the real signal this exercise is testing for.

### Procedure

1. Add the adapter + config namespace
2. Extend the schema and the provider union
3. Add the branch in `ProvidersModule`
4. Run the conformance suite against the new adapter
5. Deploy to staging with `EMAIL_PROVIDER=zoho`; verify real delivery
6. Promote to production
7. Delete the Resend adapter and its config once verified

**No code freeze, no data migration, no template rework.** Steps 5–6 are a configuration change.

---

## Test 2 — Cloudinary → AWS S3 + CloudFront

Deliberately the harder case: S3 has **no equivalent of Cloudinary's on-the-fly URL transformations**.

### Files that would be **ADDED**

```
src/providers/storage/s3/
├── s3-media-storage.ts          # implements MediaStoragePort
├── s3-derivative.generator.ts   # generates thumb/card/detail at upload time
├── s3-url.builder.ts            # ImagePreset -> CloudFront key
└── s3.config.ts
```

### Files that would be **MODIFIED** — three

Identical in shape to Test 1: the env schema, `media.config.ts`, and one branch in `providers.module.ts`.

### What would **NOT** change

| Untouched | Why |
|---|---|
| `modules/media/application/media.service.ts` | **All validation lives here** — MIME allow-list, magic-byte sniffing, size limits, dimension caps, EXIF stripping, SVG rejection |
| `modules/media/application/ports/media-storage.port.ts` | The contract is the fixed point |
| **Reference counting and the `mediaAssets` collection** | A business concern owned by `MediaModule` |
| **`modules/catalog/**`** | Calls `MediaService.uploadProductImage(...)`, never the port |
| `modules/content/**`, `modules/reviews/**` | Same |
| Product/blog schemas storing `assetId` + `version` | Both are **opaque strings**; S3 stores an object key in `assetId` and `null` in `version` |
| Every Response DTO returning image URLs | URLs come from `getUrl(asset, preset)` |
| Every business test | `InMemoryMediaStorage` implements the port |

### The transformation problem, honestly

Cloudinary answers `getUrl(asset, 'card')` by composing `c_fill,w_400,h_400,f_auto,q_auto` into the URL. S3 cannot.

**Resolution:** the port asks for **intent**, not mechanism ([`PORTS-AND-CONTRACTS.md`](./PORTS-AND-CONTRACTS.md) §10). Satisfying that intent is adapter work:

| Adapter | How it answers `getUrl(asset, 'card')` |
|---|---|
| Cloudinary | Composes a transformation URL — no extra storage |
| S3 | Returns a CloudFront key for a **pre-generated derivative** created at upload |

So `S3MediaStorage.upload()` does more work than `CloudinaryMediaStorage.upload()`: it generates four derivatives with `sharp` and uploads five objects. That complexity is **entirely inside the adapter**, which is exactly the outcome the port is designed to produce.

`ImagePreset` is a closed application-owned union (`thumb | card | detail | zoom | original`) — not a passthrough for vendor transformation strings, which would have made the port Cloudinary-shaped in everything but name.

### Traceable count

| | |
|---|---|
| Files added | **4** (one more than email — the derivative generator) |
| Files modified | **3** |
| Business modules changed | **0** |
| Business tests changed | **0** |
| **Data migration required** | **Yes** — see below |

### The honest asymmetry

Unlike email, **media has persisted state**. Existing assets live in Cloudinary and every product document references them. A real switch requires:

1. Copy every asset to S3, generating derivatives
2. Rewrite `assetId` on every referencing document
3. Run both adapters during transition, or accept a maintenance window
4. Verify every image resolves before deleting from Cloudinary

**This is a data migration, not an architecture failure** — no abstraction can make stored bytes move for free. What the architecture guarantees is that the migration touches **data and one adapter**, never business logic.

**Scale note:** Phase 0.5 measured the live media footprint at **2 objects, 204 KB**, of which 20 of 22 `product_images` rows are `placehold.co` placeholders that are not migrated at all. Today this migration is trivial. It will not stay that way, which is why the boundary matters now rather than later.

---

## Test 3 — MongoDB → PostgreSQL (the deliberate failure case)

Included because a replaceability document that only shows successes is marketing.

### What would change

| Area | Impact |
|---|---|
| Every schema | **Rewritten** — embedded arrays become tables |
| Every repository | **Rewritten** |
| `orders.items[]`, `statusHistory[]` | Become `order_items`, `order_status_history` tables |
| `categories.path[]` | Becomes a recursive CTE or `ltree` |
| `products.specs[]` multikey index | Becomes a join or `jsonb` GIN index |
| `$facet` search aggregation | Rewritten as SQL |
| Conditional `$inc` overselling guard | Rewritten as `UPDATE … WHERE stock >= qty` |
| `TransactionService` | Rewritten |
| Tier 3 `domain/` layers | **Unchanged** — they import nothing framework-shaped |
| Business rules in application services | **Mostly unchanged**, but every persistence call changes |

### Verdict: **NOT replaceable, by design**

Phase 1's model is MongoDB-specific. A `DatabasePort` promising portability would be a **dishonest abstraction** — imposing ceremony on every query while pushing code toward a lowest-common-denominator surface, losing exactly the constructs the design depends on ([`ANTI-OVERENGINEERING.md`](./ANTI-OVERENGINEERING.md) §14).

**What the repository ports *do* buy** is visible even here: the transition matrix, pricing rules and coupon ladder in `domain/` are untouched, because they were never allowed to know a database exists. That is testability (J2) paying off — not portability, which was never claimed.

**Stating the limit is the point.** "MongoDB is not swappable" is a decision with a reason, not an oversight.

---

## Test 4 — Handlebars → React Email

A secondary, lower-probability swap, included because `TemplateRendererPort` exists partly for it.

| | |
|---|---|
| **Added** | `ReactEmailTemplateRenderer` in `modules/notifications/infrastructure/` |
| **Modified** | One provider binding in `NotificationsModule`; the build pipeline (JSX compilation) |
| **Rewritten** | **All 14 templates** — `.hbs` → `.tsx` |
| **Unchanged** | `TemplateRendererPort`, every template **data contract**, `NotificationsService`, every business module, every email provider |

**The port limits the blast radius to templates and one renderer.** But the templates themselves are rewritten — the port abstracts the *mechanism*, not the *content format*.

This is why [`TEMPLATE-ARCHITECTURE.md`](./TEMPLATE-ARCHITECTURE.md) §4 defers MJML/React Email rather than adopting it speculatively: the migration is real work, and the trigger (cross-client rendering defects) has not occurred.

---

## Test 5 — Adding a payment provider (future, additive)

Not a replacement — a **new capability**, included to check the architecture accommodates growth.

| | |
|---|---|
| **Added** | `PaymentPort` in `modules/payments/application/ports/`; `providers/payment/paymob/`; a `PaymentsModule`; `PAYMENT_*` config |
| **Modified** | `OrdersModule` gains a payment dependency; the order state machine gains `AWAITING_PAYMENT`; `orders.payment` gains provider fields |
| **Unchanged** | Catalog, inventory, cart, media, notifications, auth |

**Two consequences already anticipated in Phase 1:**

1. `PaymentPort` is designed **with** its first implementation, never before it ([`PORTS-AND-CONTRACTS.md`](./PORTS-AND-CONTRACTS.md) §11) — a port written against zero implementations encodes guesses the first integration contradicts.
2. Online payment reintroduces a **payment gap**, which is the trigger for reconsidering inventory reservations (ADR-INVENTORY-001) — and, critically, for adding the order status that makes an expiry job's query reachable. That last step is precisely what legacy omitted, producing a cron job that ran 35,309 times against a status no order could ever hold.

---

## Summary

| Scenario | Business modules changed | Templates changed | Files modified | Data migration | Verdict |
|---|---|---|---|---|---|
| Resend → Zoho | **0** | **0** | 3 | No | ✅ **Clean** |
| Cloudinary → S3 | **0** | **0** | 3 | **Yes** | ✅ **Clean code, real data migration** |
| Handlebars → React Email | **0** | **All 14** | 2 | No | ⚠️ **Bounded, but templates rewritten** |
| Add Paymob | Orders only | 2 new | several | No | ✅ **Additive** |
| MongoDB → PostgreSQL | **All persistence** | 0 | ~everything | **Yes** | ❌ **Not replaceable — by design** |

### The invariants that hold across every clean case

1. **Vendor SDKs appear only in `src/providers/`** — lint-enforced, zero exceptions.
2. **Ports use application vocabulary**, never vendor types.
3. **Provider identifiers are opaque** — stored, logged, never parsed.
4. **Vendor errors are translated at the boundary.**
5. **Rendering precedes transmission**, so templates are provider-independent.
6. **Business rules live in business modules**, never adapters — so upload validation survives a storage change and email semantics survive a provider change.
7. **Composition happens in one file**, driven by configuration.
8. **The conformance suite is the acceptance test** — and the detector for a port that has quietly become vendor-shaped.

### Where the guarantee is weaker than the headline

Stated plainly rather than buried:

- **Media carries persisted state.** Code is unaffected; data is not. No abstraction fixes that.
- **A template *format* change rewrites templates.** The port bounds the blast radius; it does not eliminate the work.
- **The database is not swappable**, and the architecture does not pretend otherwise.
- **A provider with fundamentally different semantics** — say, one requiring pre-registered template ids server-side — would need a rendering strategy decision inside `NotificationsModule`, not just a new adapter. It is still one module, which is the guarantee that matters, but it is not a zero-thought swap.
