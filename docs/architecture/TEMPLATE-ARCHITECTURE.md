# Email Template Architecture — Phase 1.1

**Status:** FROZEN pending review · **Date:** 2026-08-30 · **ADR:** ADR-CODE-011, 012

---

## 1. The governing rule

> **Templates are application content. They belong to the application, never to a provider.**

```
❌ providers/email/resend/templates/     — lost on a provider switch
❌ Resend dashboard / vendor UI          — un-versioned, un-reviewable, un-testable
✅ src/templates/email/                  — versioned with the code that uses it
```

Templates stored in a vendor's dashboard are the worst case: they are invisible to code review, absent from git history, impossible to test in CI, and **gone the day the provider changes**. Templates under `providers/` are only marginally better — they survive in git but must be physically moved and re-verified on a switch.

---

## 2. The pipeline

```
Business event                 Order transitions to CONFIRMED
    ↓
Capability method              NotificationsService.sendOrderConfirmed(order)
    ↓
Template selection             'orders/order-confirmed'
    ↓
Template data                  OrderConfirmedData  (typed contract)
    ↓
TemplateRendererPort.render()  layout + template + data
    ↓
RenderedEmail                  { subject, html, text }
    ↓
EmailSenderPort.send()         content, not a template reference
    ↓
Provider adapter               Resend / Zoho / SES
```

**Rendering completes before the port is called.** `OutboundEmail.html` is already-rendered HTML ([`PROVIDER-ARCHITECTURE.md`](./PROVIDER-ARCHITECTURE.md) §5.6). This single decision is what makes templates provider-independent — a swap changes who transmits the bytes, never how they were produced.

---

## 3. Location and structure

```
src/templates/
└── email/
    ├── layouts/
    │   └── base.hbs                  # shell: header, footer, brand, responsive tables
    │
    ├── partials/
    │   ├── button.hbs
    │   ├── order-items-table.hbs
    │   ├── address-block.hbs
    │   └── price-summary.hbs
    │
    ├── auth/
    │   ├── verify-email.hbs
    │   ├── password-reset.hbs
    │   └── password-changed.hbs
    │
    ├── orders/
    │   ├── order-placed.hbs
    │   ├── order-confirmed.hbs
    │   ├── order-shipped.hbs
    │   ├── order-delivered.hbs
    │   ├── order-delivery-failed.hbs
    │   ├── order-cancelled.hbs
    │   └── order-returned.hbs
    │
    ├── admin/
    │   ├── new-order-alert.hbs
    │   └── low-stock-alert.hbs
    │
    └── contact/
        └── contact-received.hbs
```

Template inventory derives directly from Phase 1's notification table ([`ORDER-LIFECYCLE.md`](./ORDER-LIFECYCLE.md) §12) and auth flows — **14 templates**, each corresponding to a real business event. No speculative marketing or newsletter templates.

### Why root `src/templates/`, not `modules/notifications/templates/`

Both satisfy provider independence. Root placement is chosen for three practical reasons:

1. **Templates are content, not code.** They are the artifact most likely to be edited by someone who is not modifying business logic — copy changes, a corrected phone number, a new footer link. Making them findable without navigating module internals matters.
2. **They are cross-domain.** `order-shipped.hbs` renders data owned by `OrdersModule` and `FulfilmentModule`; `verify-email.hbs` belongs to `AuthModule`. No single module owns the set.
3. **They are build assets.** `.hbs` files are not compiled by `tsc` and must be explicitly copied into `dist/`. A single root path makes that build rule one line instead of a per-module glob.

The `TemplateRendererPort` and the *selection logic* remain inside `NotificationsModule` — only the content files sit at the root.

---

## 4. Format decision

> **Handlebars (`.hbs`) with a shared layout and partials, producing inline-styled HTML plus a hand-written plain-text alternative.**

| Option | Verdict | Reasoning |
|---|---|---|
| **Handlebars** | ✅ **CHOSEN** | Logic-less by design, so business rules cannot creep in. Editable by anyone who knows HTML. Layouts and partials are native. Mature, tiny, no build step. |
| React Email / MJML-React | ❌ | Pulls React and a JSX build pipeline into a backend that has neither. Templates become code, requiring a developer for a copy change. |
| MJML | ⏸ **Deferred** | Genuinely solves email-client CSS inconsistency, but adds a compile step. For ~14 transactional emails on a well-tested table layout, a single hand-built `base.hbs` is proportional. **Revisit if rendering defects appear across clients.** |
| Template literals in TS | ❌ | Unreadable at length; invites logic; no partials; no separation from code. |
| Provider-hosted templates | ❌ | The coupling this document exists to prevent. |

**Why logic-less matters here specifically.** Handlebars cannot express arbitrary conditionals or computation. A developer tempted to write "if the order total exceeds X, show free-shipping copy" **cannot** — that decision must move into `NotificationsService`, where it is testable. Phase 0.5 found business rules scattered across five layers, including presentation components; a logic-less template engine makes that class of drift structurally impossible in the email path.

Allowed helpers are a **closed set**: `{{#if}}`, `{{#each}}`, and registered formatters (`formatMoney`, `formatDate`, `t`). No custom helper may contain a business rule.

### Plain text

Every template has a `.txt.hbs` sibling. Plain text is **hand-written, not auto-derived** — HTML-to-text conversion produces unreadable output with table layouts, and plain text materially improves deliverability. `OutboundEmail.text` is always populated.

---

## 5. Template data contracts

> **Every template has a typed data contract. Templates never receive a domain entity.**

```ts
// modules/notifications/application/templates/order-shipped.data.ts
export interface OrderShippedData {
  customerName: string;
  orderNumber: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl: string | null;
  estimatedDeliveryAt: string | null;   // pre-formatted
  items: Array<{ name: string; quantity: number; lineTotal: string }>;
  grandTotal: string;                    // pre-formatted "7,417.00 EGP"
  orderUrl: string;
}
```

Four rules:

| # | Rule | Why |
|---|---|---|
| 1 | **Never pass a domain entity or Mongoose document** | An entity change silently alters emails; internal fields (`costPrice`, `adminNote`, `userId`) become one typo away from a customer inbox |
| 2 | **Money and dates arrive pre-formatted as strings** | Formatting is a business decision — the Phase 1 rule is `{amount, currency, formatted}` with server-side formatting. A template must not compute or format money. |
| 3 | **One contract per template**, colocated with selection logic | Renaming a template field is a compile error, not a silently blank email |
| 4 | **No optional-by-accident fields** | Optionality is explicit (`string | null`), and the template handles null deliberately |

Rule 1 is a direct consequence of Phase 1's data-protection rules ([`AUTHORIZATION-MODEL.md`](./AUTHORIZATION-MODEL.md) §10). The same reasoning that forbids returning a Mongoose document from a controller applies to handing one to a template.

---

## 6. Rendering boundary

```ts
// modules/notifications/application/ports/template-renderer.port.ts
export abstract class TemplateRendererPort {
  abstract render<T>(templateId: string, data: T, locale: Locale)
    : Promise<RenderedEmail>;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}
```

`templateId` is a path-like identifier: `'orders/order-shipped'`. The renderer resolves it to files, applies the layout, and returns all three parts.

**The subject lives with the template**, in front-matter at the top of the `.hbs` file:

```hbs
{{!-- subject: Your order {{orderNumber}} has shipped --}}
```

Subjects are content and are localised alongside the body. Scattering them as string literals in a service guarantees they drift from the body copy.

**Templates are pre-compiled and cached at boot** — compiling on every send is wasteful and hides syntax errors until a customer would have received the mail. Boot-time compilation makes a broken template a **startup failure**, which is the correct time to discover it.

---

## 7. Missing-variable behaviour

> **A missing required variable is an error, not a blank.**

Handlebars silently renders `{{missingField}}` as an empty string. That default is unacceptable for transactional email — a customer receiving *"Your order  has shipped"* is worse than an alert.

| Environment | Behaviour |
|---|---|
| **Development / test** | **Throw.** `strict: true` — an unresolved variable fails loudly. |
| **Production** | **Throw before sending**, log at `error`, record a failed notification, alert. **Never send a partially-rendered email.** |

Justification: a template variable is missing only because of a programming error. Sending a broken email compounds it and damages trust; failing loudly surfaces it in the alert channel Phase 1 already specifies. A missed order-confirmation email is recoverable; a garbled one sent to every customer is not.

`{{#if}}` remains the correct way to express genuinely optional content — `strict` mode applies to unresolved *lookups*, not to explicit conditionals.

---

## 8. Localisation readiness

Phase 1 established `{en, ar?}` localized text with English-only content in MVP, and Arabic on the roadmap (ADR-CATALOG-003). Templates follow the same posture: **structured for Arabic, not implemented for it.**

```
templates/email/
├── en/
│   ├── layouts/base.hbs
│   ├── auth/verify-email.hbs
│   └── orders/order-shipped.hbs
└── ar/                          ← added when Arabic launches
```

Three properties make Arabic additive rather than a rewrite:

1. **The renderer already accepts `locale`** and falls back to `en` when a template is absent. No signature changes later.
2. **No user-facing string is hard-coded in a service.** Everything renderable lives in a template.
3. **The base layout reserves `dir="{{textDirection}}"`** on the root element, so RTL is a data value rather than a second layout.

**Not built now:** an Arabic directory, a translation workflow, or per-locale subject tables. Building a translation pipeline before any Arabic content exists would repeat the legacy mistake of provisioning `name_ar` columns that were 100% NULL across all 85 products.

---

## 9. Testing

| Level | What is asserted | Vendor needed? |
|---|---|---|
| **Render unit test** | Every template renders with valid fixture data; output contains expected values | ❌ |
| **Missing-variable test** | Incomplete data **throws** rather than rendering a blank | ❌ |
| **Snapshot test** | Rendered HTML matches an approved snapshot; unintended copy changes surface in review | ❌ |
| **Data-contract test** | A template's placeholders are all present in its TypeScript contract | ❌ |
| **Delivery test** | `NotificationsService` calls the renderer then the sender, in order, with the right template id | ❌ (`FakeEmailSender`) |
| **Visual check** | Manual, pre-launch, across Gmail / Outlook / Apple Mail on mobile | ❌ |

**No test in the normal suite touches a real email provider.** The `ConsoleEmailSender` and `FakeEmailSender` cover development and CI ([`TESTING-ARCHITECTURE.md`](./TESTING-ARCHITECTURE.md)).

A **template-inventory test** asserts that every value in the `TemplateId` union has corresponding `.hbs` and `.txt.hbs` files — so a renamed file fails CI rather than production.

---

## 10. Naming

| Artifact | Convention | Example |
|---|---|---|
| Template file | `<kebab-event>.hbs` | `order-delivery-failed.hbs` |
| Plain-text sibling | `<kebab-event>.txt.hbs` | `order-delivery-failed.txt.hbs` |
| Template id | `<domain>/<kebab-event>` | `'orders/order-delivery-failed'` |
| Data contract | `<PascalEvent>Data` | `OrderDeliveryFailedData` |
| Contract file | `<kebab-event>.data.ts` | `order-delivery-failed.data.ts` |
| Partial | `<kebab-noun>.hbs` | `order-items-table.hbs` |
| Layout | `<kebab-name>.hbs` | `base.hbs` |

Template ids mirror the directory path exactly, so the id in a service leads directly to the file.

---

## 11. Ownership

| Concern | Owner |
|---|---|
| Template **content** (copy, layout, styling) | `src/templates/email/` — editable without touching module code |
| Template **selection** (which event → which template) | `NotificationsService` |
| Template **data contracts** | `modules/notifications/application/templates/` |
| **Rendering mechanism** | `HandlebarsTemplateRenderer` in `modules/notifications/infrastructure/` |
| **Transmission** | `providers/email/<vendor>/` |

The renderer lives in `NotificationsModule`'s infrastructure — **not** under `providers/` — because Handlebars is a rendering library, not a replaceable external service. There is no vendor account, no API key, no network call. It sits behind a port for testability and for the possible MJML/React-Email migration, not for vendor replaceability.

---

## 12. Summary

| Question | Answer |
|---|---|
| Location | **`src/templates/email/`** — never under `providers/`, never in a vendor dashboard |
| Format | **Handlebars `.hbs`**, logic-less, with layouts and partials |
| MJML | Deferred; revisit on cross-client rendering defects |
| HTML + text | Both always; plain text **hand-written** |
| Rendering timing | **Before** the email port — the port receives content |
| Subject | In template front-matter, localised with the body |
| Data contracts | **Typed per template**; never a domain entity or document |
| Money / dates | **Pre-formatted strings** — templates never compute |
| Missing variable | **Throws.** Never sends a partial email. |
| Compilation | **At boot** — a broken template is a startup failure |
| Localisation | Locale directories with `en` fallback; **Arabic structured, not built** |
| Testing | Render, snapshot, contract, inventory — **no real provider** |
| Provider swap impact | **Zero template changes** |
