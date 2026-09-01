# External Provider Architecture — Phase 1.1

**Status:** FROZEN pending review · **Date:** 2026-08-30 · **ADR:** ADR-CODE-009, 010

---

## 1. The distinction

| | **Business module** | **Provider** |
|---|---|---|
| Is | A business capability | A replaceable external implementation |
| Lives in | `src/modules/` | `src/providers/` |
| Contains | Domain rules, orchestration, persistence | Vendor SDK calls, mapping, vendor error translation |
| Examples | `orders`, `catalog`, `notifications`, `media` | `resend`, `cloudinary` |
| Replaceable? | No — it *is* the product | **Yes, by design** |
| May import a vendor SDK? | **Never** | **Only here** |

> `NotificationsModule` is a business module: it decides *that* an order confirmation is sent, what it contains, and who receives it.
> `ResendEmailSender` is a provider: it knows *how* bytes reach an inbox.

---

## 2. The layering

```
Business module            OrdersModule / AuthModule
   │                       calls a business method
   ▼
Capability module          NotificationsService.sendOrderConfirmation(order)
   │                       owns templates, recipients, business meaning
   ▼
Port                       EmailSenderPort.send(message)
   │                       application vocabulary, no vendor types
   ▼
Provider adapter           ResendEmailSender
   │                       the ONLY place the SDK is imported
   ▼
Vendor SDK                 resend
```

**Note the two-step separation.** `OrdersModule` does not inject `EmailSenderPort`; it injects `NotificationsService`. The port sits one module deeper.

This is deliberate. If Orders injected the port directly, it would have to know about subjects, recipients and templates — so a change in email *semantics* (a provider requiring pre-registered template ids, say) would ripple into order logic. Keeping the port inside `NotificationsModule` means the blast radius of any email change is exactly one module.

The same applies to media: `CatalogModule` calls `MediaService.uploadProductImage(...)`, never `MediaStoragePort`.

---

## 3. Directory layout

```
src/providers/
├── providers.module.ts              # @Global — the ONLY composition point
│
├── email/
│   ├── resend/
│   │   ├── resend-email-sender.ts   # implements EmailSenderPort
│   │   ├── resend.mapper.ts         # OutboundEmail -> Resend payload
│   │   └── resend.config.ts
│   └── console/
│       └── console-email-sender.ts  # dev: logs instead of sending
│
└── storage/
    ├── cloudinary/
    │   ├── cloudinary-media-storage.ts
    │   ├── cloudinary.mapper.ts
    │   ├── cloudinary-url.builder.ts   # ImagePreset -> transformation URL
    │   └── cloudinary.config.ts
    └── in-memory/
        └── in-memory-media-storage.ts  # tests
```

**Rules for anything under `providers/`:**

| MUST | MUST NOT |
|---|---|
| Implement a port defined by a module | Contain business rules |
| Import its vendor SDK | Import from `src/modules/**` except that module's port and its input/output types |
| Translate vendor errors into the port's error types | Import a Mongoose schema |
| Map application types ↔ vendor types | Contain email templates |
| Read only its own config namespace | Be imported by a business module (only `ProvidersModule` references it) |

---

## 4. Composition — one file, one switch

```ts
// providers/providers.module.ts   (conceptual)
@Global()
@Module({
  providers: [
    {
      provide: EmailSenderPort,
      useClass: config.email.provider === 'resend'
        ? ResendEmailSender
        : ConsoleEmailSender,
    },
    {
      provide: MediaStoragePort,
      useClass: CloudinaryMediaStorage,
    },
  ],
  exports: [EmailSenderPort, MediaStoragePort],
})
export class ProvidersModule {}
```

**This is the only file in the codebase that names both a port and a vendor.** Grepping for `ResendEmailSender` outside `providers/` must return zero results — a lint rule enforces it ([`DEPENDENCY-RULES.md`](./DEPENDENCY-RULES.md)).

### What this is not

The brief is explicit, and these are all rejected:

| Rejected | Why |
|---|---|
| Provider **registry** (`Map<string, Provider>`) | One active provider. A registry is indirection over a single value. |
| Provider **factory class** | `useClass` with a conditional is the factory. A dedicated class adds a file and a test. |
| **Simultaneous** multi-provider routing | No requirement. Routing rules, per-recipient selection and quota logic are pure speculation. |
| **Failover** chains | No requirement. Failover needs health checks, retry budgets and duplicate-send protection — none of which is asked for. |
| **Runtime** provider switching | Configuration is read at boot. Switching means a redeploy, which is correct for a change of this magnitude. |

> The requirement is **replaceability**, not simultaneity. A conditional `useClass` delivers replaceability completely.

---

## 5. Email provider

### 5.1 Contract

```ts
// modules/notifications/application/ports/email-sender.port.ts
export abstract class EmailSenderPort {
  abstract send(message: OutboundEmail): Promise<EmailSendResult>;
}
```

**One method.** Everything a caller needs; nothing a vendor needs.

### 5.2 Input model — application-owned

```ts
export interface OutboundEmail {
  to: EmailRecipient[];          // { email, name? }
  subject: string;
  html: string;                  // ALREADY RENDERED — see §5.6
  text: string;                  // plain-text alternative, always provided
  replyTo?: string;
  tags?: Record<string, string>; // e.g. { type: 'order_confirmation' }
  idempotencyKey?: string;
}
```

**Deliberate omissions:**

| Omitted | Reason |
|---|---|
| `from` | An infrastructure concern. The adapter supplies it from config, so the business layer cannot accidentally send from the wrong address. |
| `templateId` | Vendor-specific. Rendering happens **before** the port (§5.6). |
| Attachments | No requirement. Add when one exists — the port grows deliberately, not speculatively. |
| CC / BCC | No requirement. |
| Scheduling | No requirement. |

### 5.3 Output model

```ts
export interface EmailSendResult {
  providerMessageId: string;   // opaque; for support correlation only
  acceptedAt: Date;
}
```

`providerMessageId` is deliberately typed as an opaque string and is **never parsed, matched or interpreted** — only logged and stored in the notification log. A provider change alters its format, and nothing breaks.

### 5.4 Error handling

The adapter translates every vendor failure into module-owned errors:

| Condition | Error | Retryable |
|---|---|---|
| Network / 5xx / timeout | `EmailTransportError` | ✅ |
| Provider rate limit | `EmailRateLimitError` | ✅ (with backoff) |
| Invalid recipient / rejected address | `EmailRecipientError` | ❌ |
| Auth failure (bad API key) | `EmailConfigurationError` | ❌ — alerts |

**No Resend exception type ever escapes `providers/email/resend/`.** `NotificationsService` catches `EmailTransportError` and does not know Resend exists.

Per Phase 1, email dispatch is **post-commit and failure-tolerant**: a failure is logged, recorded in the notification log, and alerted if the failure rate crosses threshold — it never rolls back an order ([`ORDER-LIFECYCLE.md`](./ORDER-LIFECYCLE.md) §12).

### 5.5 Configuration boundary

```
EMAIL_PROVIDER=resend            # selects the implementation
EMAIL_FROM_ADDRESS=...           # application-level, provider-agnostic
EMAIL_FROM_NAME=...
EMAIL_REPLY_TO=...

RESEND_API_KEY=...               # provider-specific, read ONLY by the Resend adapter
```

Application-level settings live in the `email` config namespace and are used by `NotificationsService`. Vendor credentials live in a provider-specific namespace that **only that adapter reads**. Adding Zoho adds `ZOHO_*` keys; nothing else moves.

### 5.6 Rendering happens before the port

> **`OutboundEmail.html` is already-rendered HTML. The port receives content, not a template reference.**

This is the decision that keeps templates provider-independent.

```
NotificationsService.sendOrderConfirmation(order)
    │
    ├─ selects template          'orders/order-confirmation'
    ├─ builds template data      OrderConfirmationData
    ├─ TemplateRendererPort.render(...)   →  { html, text, subject }
    │
    └─ EmailSenderPort.send({ to, subject, html, text })
```

The alternative — passing a `templateId` and letting the provider render — would put templates **inside the vendor's dashboard**, making them un-versioned, un-reviewable, un-testable, and lost on a provider switch. It is exactly the coupling the brief forbids. See [`TEMPLATE-ARCHITECTURE.md`](./TEMPLATE-ARCHITECTURE.md).

### 5.7 Switching provider: the procedure

1. Add `providers/email/zoho/zoho-email-sender.ts` implementing `EmailSenderPort`.
2. Add the `ZOHO_*` config namespace and extend the env schema.
3. Add `'zoho'` to the `EMAIL_PROVIDER` union and the branch in `providers.module.ts`.
4. Run the **shared port conformance suite** (§7) against the new adapter.
5. Set `EMAIL_PROVIDER=zoho`; deploy.
6. Delete the Resend adapter and its config once verified.

**Zero files change in `modules/`.** Full file-level analysis in [`REPLACEMENT-TESTS.md`](./REPLACEMENT-TESTS.md).

---

## 6. Media storage provider

### 6.1 Contract

```ts
// modules/media/application/ports/media-storage.port.ts
export abstract class MediaStoragePort {
  abstract upload(input: UploadInput): Promise<StoredAsset>;
  abstract delete(assetId: string): Promise<void>;
  abstract getUrl(asset: StoredAsset, preset: ImagePreset): string;
}
```

### 6.2 Models — application-owned

```ts
export interface UploadInput {
  buffer: Buffer;
  contentType: string;      // already validated by MediaService
  folder: string;           // 'products/652f...' — application taxonomy
  publicName: string;       // 'esp32-front-a1b2c3'
}

export interface StoredAsset {
  assetId: string;          // opaque provider identifier
  version: string | null;   // opaque cache-busting token, may be null
  format: string;
  width: number;
  height: number;
  bytes: number;
}

export type ImagePreset = 'thumb' | 'card' | 'detail' | 'zoom' | 'original';
```

**`assetId` and `version` are opaque.** Phase 1 stores Cloudinary's `publicId` + `version` ([`MEDIA-MODEL.md`](./MEDIA-MODEL.md) §3); those map onto `assetId`/`version` and **are never parsed by business code**. An S3 adapter stores an object key in `assetId` and `null` in `version`, and the media module is unaffected.

> **Phase 1 clarification:** [`MEDIA-MODEL.md`](./MEDIA-MODEL.md) names the persisted fields `publicId` and `version`. Phase 1.1 keeps that persisted shape but renames the *port* field to `assetId`, because "publicId" is Cloudinary vocabulary. The mapping is one line in the media repository. Recorded in §11.

### 6.3 The transformation question

`getUrl(asset, preset)` asks for **intent**, not mechanism — the resolution described in [`PORTS-AND-CONTRACTS.md`](./PORTS-AND-CONTRACTS.md) §10.

- **Cloudinary adapter:** composes a transformation URL from the preset (`c_fill,w_400,h_400,f_auto,q_auto`).
- **A future S3 adapter:** returns a pre-generated derivative key, or a CloudFront/imgproxy URL.

`ImagePreset` is a **closed, application-owned union**. It is not a passthrough for vendor transformation strings, which would make the port Cloudinary-shaped in everything but name.

**Not in the port:** quality settings, format negotiation, eager transformation, EXIF handling. Those live inside the adapter or, where they are business rules (magic-byte validation, SVG rejection, dimension caps), inside `MediaService` — where they belong, because they must survive a provider change.

### 6.4 Validation stays in the business module

An important division:

| Concern | Lives in | Why |
|---|---|---|
| MIME allow-list, magic-byte sniffing, size limit, dimension caps, EXIF stripping, SVG rejection | **`MediaService`** (business) | These are Phase 1 **security rules** ([`MEDIA-MODEL.md`](./MEDIA-MODEL.md) §5). They must hold regardless of provider. |
| Upload mechanics, URL composition, retry, vendor errors | **Adapter** | Vendor-specific |

If validation lived in the Cloudinary adapter, switching to S3 would silently drop SVG rejection and magic-byte checks. Keeping it in the business module means the security posture is provider-independent — the whole point.

### 6.5 Reference counting stays in the business module

Phase 1 requires refcount-aware deletion ([`MEDIA-MODEL.md`](./MEDIA-MODEL.md) §9.1). `mediaAssets` is a MongoDB collection owned by `MediaModule`; the port's `delete()` is called only when the count reaches zero. The provider never knows refcounts exist.

---

## 7. Port conformance suite

Each vendor port has **one shared test suite run against every implementation**, including fakes.

```
test/contract/email-sender.contract.spec.ts
    run against: ResendEmailSender (integration, sandbox key)
                 ConsoleEmailSender
                 FakeEmailSender
```

It asserts port semantics, not vendor behaviour:

- A valid message resolves with a non-empty `providerMessageId`
- An invalid recipient throws `EmailRecipientError`, not a vendor error
- A transport failure throws `EmailTransportError`
- `html` and `text` are both delivered
- No vendor type appears in any resolved or rejected value

**This suite is the acceptance test for a provider swap.** A new adapter is ready when it passes unchanged. Detail in [`TESTING-ARCHITECTURE.md`](./TESTING-ARCHITECTURE.md).

---

## 8. Dev and test implementations

Not multi-provider routing — these are **development affordances** selected by the same single switch.

| Implementation | Used when | Behaviour |
|---|---|---|
| `ConsoleEmailSender` | Local dev (`EMAIL_PROVIDER=console`) | Logs subject, recipient and a rendered-HTML path; sends nothing |
| `FakeEmailSender` | Tests | Records sent messages for assertion |
| `InMemoryMediaStorage` | Tests | Stores buffers in a Map; returns deterministic ids |

`ConsoleEmailSender` matters practically: it means local development never needs an API key, never sends real mail to a real address by accident, and works offline.

---

## 9. Providers deliberately not created

| Not created | Why | Trigger |
|---|---|---|
| Payment provider | COD only; no vendor exists (ADR-ORDER-004) | Paymob integration |
| SMS provider | No requirement | OTP or SMS delivery notifications |
| Push notification provider | Flutter push is outside this repository | Mobile push requirement |
| Analytics provider | No requirement | — |
| Search provider adapter | The engine change is contained in `SearchService` ([`PORTS-AND-CONTRACTS.md`](./PORTS-AND-CONTRACTS.md) §4.1) | Two engines must coexist |
| Object-storage provider **for MongoDB** | The database is not honestly swappable | Never |

---

## 10. Review red flags

Any of these in a pull request is an architecture violation:

- 🚩 `import { Resend } from 'resend'` outside `providers/email/resend/`
- 🚩 `import { v2 as cloudinary } from 'cloudinary'` outside `providers/storage/cloudinary/`
- 🚩 A vendor type in a port signature
- 🚩 A business module injecting `EmailSenderPort` or `MediaStoragePort` directly (only the owning capability module may)
- 🚩 An email template under `providers/`
- 🚩 A vendor name (`resend`, `cloudinary`) appearing in `modules/`
- 🚩 `process.env.RESEND_API_KEY` outside the Resend config namespace
- 🚩 A provider registry, factory class or failover chain
- 🚩 A business rule (validation, refcounting, retry policy) inside an adapter

The first three are lint-enforced; the rest are review items.

---

## 11. Phase 1 clarifications

Phase 1.1 does not change any Phase 1 decision. Two clarifications are recorded:

| Phase 1 statement | Phase 1.1 clarification |
|---|---|
| [`NESTJS-MODULE-MAP.md`](./NESTJS-MODULE-MAP.md): *"`MediaModule` — Responsibilities: … Cloudinary upload/destroy"* | `MediaModule` owns validation, metadata, refcounting and the `MediaStoragePort`. **The Cloudinary SDK lives in `providers/storage/cloudinary/`.** Capability unchanged; code location specified. |
| [`NESTJS-MODULE-MAP.md`](./NESTJS-MODULE-MAP.md): *"`NotificationsModule` — Depends on an email provider"* | It depends on `EmailSenderPort`. **The vendor adapter lives in `providers/email/<vendor>/`.** |
| [`MEDIA-MODEL.md`](./MEDIA-MODEL.md): persisted fields `publicId`, `version` | Persisted shape unchanged. The **port** uses `assetId`/`version` to avoid vendor vocabulary at the boundary; mapping is one line in the media repository. |

---

## 12. Summary

| Question | Answer |
|---|---|
| Business module vs provider | Capability vs replaceable implementation |
| Vendor SDK location | **`src/providers/` only** — lint-enforced |
| Composition point | **One file** — `providers.module.ts`, driven by config |
| Multi-provider routing | **None** — one active provider |
| Registries / factories / failover | **None** — explicitly rejected |
| Email port | **One method**, `send(OutboundEmail)` |
| Rendering | **Before the port** — templates never live with a vendor |
| `from` address | Adapter-supplied from config |
| Media port | `upload` / `delete` / `getUrl(preset)` |
| Transformation | Expressed as **intent** via a closed `ImagePreset` union |
| Upload validation & refcounting | **Business module** — must survive a provider change |
| Vendor errors | Translated at the adapter boundary |
| Provider identifiers | **Opaque**, never parsed |
| Swap acceptance test | The shared **port conformance suite** |
