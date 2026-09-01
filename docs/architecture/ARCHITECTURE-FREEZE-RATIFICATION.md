# ARCHITECTURE FREEZE RATIFICATION

**Project:** Nest Electronics · **Date:** 2026-08-30 · **Supersedes:** nothing — this is the final consistency record for Phase 1 + Phase 1.1

---

## 1. Purpose

This phase exists **only** to resolve the three documentation inconsistencies identified by the architecture review, apply the clean-database/no-migration correction consistently across the architecture documents, and establish the final authoritative sources.

> **No architecture redesign was performed.**
> **No implementation code was written.**

Specifically, nothing in this pass changed: module membership, tier assignment, the port design, the MongoDB model, the order lifecycle, inventory rules, provider architecture, DTO strategy, template architecture, money representation, or any Phase 1 business decision. Every edit falls into exactly one of R1, R2, R3 or C1.

**Corrections applied:** 20 edits across 8 documents. Every edit was a count correction, a reference alignment, or a supersession notice.

---

## 2. Final architecture freeze decision

```
ARCHITECTURE FREEZE
APPROVED
```

**Phase 1 and Phase 1.1 are the frozen architectural baseline.**

All remaining open decisions are **non-blocking for Phase 2**. Four are blocking before *production* (not before implementation begins), and nine are fully non-blocking. Every one has a recorded, safe default — see §10.

| Category | Count | Blocks Phase 2? |
|---|---|---|
| Phase 2 blocking | **0** | — |
| Production blocking | 4 | No |
| Non-blocking | 9 | No |

---

## 3. Ratification R1 — Module tier counts

### Previous inconsistency

`CODEBASE-STRUCTURE.md` §7 contains a 15-row tier table which, counted, yields **4 Tier-1 / 7 Tier-2 / 4 Tier-3**. The prose immediately below the table stated *"Six Tier-1, five Tier-2, four Tier-3."*

### Root cause

The prose treated `brands` and `categories` as standalone Tier-1 modules. The architecture places both **inside the Tier-2 `catalog` module** as flat sub-areas — as §3 of the same document already stated parenthetically. They follow the flat Tier-1 *shape* but are not separate modules and must not be counted as such.

### Authoritative source

> **The tier table in [`CODEBASE-STRUCTURE.md`](./CODEBASE-STRUCTURE.md) §7 is the authoritative Module Tier Classification.**

### Final counts

```
Tier 1:  4   —  content, fulfilment, audit, health
Tier 2:  7   —  catalog, users, cart, reviews, media, notifications, search
Tier 3:  4   —  orders, inventory, auth, pricing

TOTAL:  15 modules
```

### Exactly what was corrected

| # | Document | Location | Before | After |
|---|---|---|---|---|
| 1 | `CODEBASE-STRUCTURE.md` | §3, Tier-1 "Assigned" line | `brands`, `categories` (inside `catalog`), `content`, `fulfilment`, `audit`, `health` | **Assigned (4 modules):** `content`, `fulfilment`, `audit`, `health` — with an explicit note that `brands`/`categories` are sub-areas inside the Tier-2 `catalog` module and are **not counted** as Tier-1 modules |
| 2 | `CODEBASE-STRUCTURE.md` | §7, totals prose | "Six Tier-1, five Tier-2, four Tier-3." | "**Four Tier-1, seven Tier-2, four Tier-3 — 15 modules total.**" |
| 3 | `CODEBASE-STRUCTURE.md` | §9, summary row | Tier 1 modules: `brands`, `categories`, `content`, `fulfilment`, `audit`, `health` | Tier 1 modules: `content`, `fulfilment`, `audit`, `health` (4) |
| 4 | `PHASE-1.1-REPORT.md` | §3, tier table | Tier-1 row listed `brands`, `categories` | Tier-1 row lists `content`, `fulfilment`, `audit`, `health` |
| 5 | `PHASE-1.1-REPORT.md` | §3 | *(no totals line)* | Added: "**Totals: 4 Tier-1 · 7 Tier-2 · 4 Tier-3 — 15 modules.**" + pointer to the authoritative table |
| 6 | `PHASE-1.1-REPORT.md` | §22, quality check | "6 of 15 modules are 5 flat files" | "4 of 15 modules are 5 flat files" |
| 7 | `PHASE-1.1-REPORT.md` | §23, handoff | Tier 1 list included brands, categories | Corrected, with the sub-area note inline |
| 8 | `ARCHITECTURE-REVIEW-DOSSIER.md` | §0.2 conflict C1 | Recorded as unresolved | Marked ✅ **RESOLVED (R1)** |

### What was NOT changed

Module membership · tier assignment · `catalog` boundaries · `brands` ownership · `categories` ownership. `brands` and `categories` remain flat sub-areas inside `CatalogModule` exactly as designed.

---

## 4. Ratification R2 — Ports inventory

### Previous inconsistency

Two documents independently described the port inventory, and they disagreed:

- **`PORTS-AND-CONTRACTS.md` §3** — six ports: `EmailSenderPort`, `MediaStoragePort`, `TemplateRendererPort`, `OrderRepositoryPort`, `InventoryRepositoryPort`, `CouponRepositoryPort`.
- **`CODEBASE-STRUCTURE.md` §7 "Ports?" column** — implied a different set: `auth` had a *"Token store port"* (not among the six), `inventory` had *"Ledger + stock ports"* (two, not one), and `pricing` showed *"—"* (none, contradicting `CouponRepositoryPort`).

### Authoritative source

> **[`PORTS-AND-CONTRACTS.md`](./PORTS-AND-CONTRACTS.md) is the single authoritative port inventory.**
> **No other document may independently define a competing port inventory.**

The tier table's "Ports?" column was loose shorthand. It has been corrected to reflect the authority, and the table now carries an explicit note naming `PORTS-AND-CONTRACTS.md` as the source.

### The authoritative six ports

| # | Port | Owner module | Justification | Used by |
|---|---|---|---|---|
| 1 | `EmailSenderPort` | `notifications` | **J1** — vendor replaceability (Resend → Zoho/SES/SMTP) | `notifications` only |
| 2 | `MediaStoragePort` | `media` | **J1** — vendor replaceability (Cloudinary → S3/R2) | `media` only |
| 3 | `TemplateRendererPort` | `notifications` | **J1 (weak) + J2** | `notifications` only |
| 4 | `OrderRepositoryPort` | `orders` | **J2** — state machine testable without MongoDB | `orders` only |
| 5 | `InventoryRepositoryPort` | `inventory` | **J2** — ledger invariant + stock guard testable | `inventory` only |
| 6 | `CouponRepositoryPort` | `pricing` | **J2** — coupon validation + atomic redemption testable | `pricing` only |

Consumers outside an owning module call **business methods**, never ports.

### Auth Token Store Port

```
NO AUTH TOKEN STORE PORT
```

**Not part of the approved architecture.** It was implied only by loose shorthand in a tier table. It has **not** been created, is **not** counted, and is **not** implied anywhere.

Introducing it would require its own independent **J1 or J2 justification**, which it does not currently have — refresh tokens are stored in a MongoDB collection with a TTL index because durability is required, and there is no second implementation and no rule needing isolated testing. Any future proposal must be recorded as a new architecture decision.

### Inventory ports

Aligned with the authoritative inventory: **one** port, `InventoryRepositoryPort` — not a separate "Ledger port" and "Stock port". **The actual port design was not altered**; only the inconsistent documentation reference was corrected.

### Pricing / Coupon port

Aligned: `pricing` owns **`CouponRepositoryPort`**. The tier table previously showed no port for `pricing`, which contradicted the authoritative inventory. **No port was removed or redesigned.**

### Exactly what was corrected

| # | Document | Location | Before | After |
|---|---|---|---|---|
| 1 | `CODEBASE-STRUCTURE.md` | §7 table, `auth` row | "Token store port" | "—" |
| 2 | `CODEBASE-STRUCTURE.md` | §7 table, `inventory` row | "Ledger + stock ports" | "`InventoryRepositoryPort`" |
| 3 | `CODEBASE-STRUCTURE.md` | §7 table, `pricing` row | "—" | "`CouponRepositoryPort`" |
| 4 | `CODEBASE-STRUCTURE.md` | §7, above the totals | *(none)* | Added an explicit **port inventory authority** note naming `PORTS-AND-CONTRACTS.md` §3, stating the six-port total, and recording that `auth` has no port |
| 5 | `ARCHITECTURE-REVIEW-DOSSIER.md` | §0.2 conflict C2 | Recorded as unresolved | Marked ✅ **RESOLVED (R2)** |

### Post-correction agreement

All documents now agree on which ports exist (**six**), which modules own them, why each exists (J1/J2), and which modules use them. Verified: no occurrence of "Token store port" or "Ledger + stock" remains outside the historical conflict log; eleven separate assertions of "six ports" across the architecture are now mutually consistent.

---

## 5. Ratification R3 — Money consumer count

### Final count

```
5 MONEY CONSUMERS
```

`pricing` · `orders` · `cart` · `catalog` · **`users`**

The fifth consumer is **`users.stats.totalSpent`**, which is a money field and was omitted from one table while the prose in the same section correctly said five.

### Corrected references

| # | Document | Location | Before | After |
|---|---|---|---|---|
| 1 | `CROSS-CUTTING-STANDARDS.md` | §A3, "Value objects" row | "`Money` — used by pricing, orders, cart, catalog" (four) | "`Money` — used by pricing, orders, cart, catalog, users (5)" |
| 2 | `ARCHITECTURE-REVIEW-DOSSIER.md` | §17 | "used by ~5 modules" | "used by five modules … the fifth being `users.stats.totalSpent`" |
| 3 | `ARCHITECTURE-REVIEW-DOSSIER.md` | §0.2 conflict C3 | Recorded as unresolved | Marked ✅ **RESOLVED (R3)** |

The prose in `CROSS-CUTTING-STANDARDS.md` §A3, `PHASE-1.1-DECISIONS.md` ADR-CODE-014, `DEPENDENCY-RULES.md` E3 and `PHASE-1.1-REPORT.md` §13 already said five and required no change.

### What was NOT changed

Money representation (integer EGP minor units) · currency model (single currency, code carried) · rounding (HALF_UP, once per order) · pricing logic · the set of money consumers themselves · any domain behaviour. This was a documentation count correction only.

---

## 6. Correction C1 — Clean database / no migration

### The position

> **The new NestJS + MongoDB system starts with a fresh database.**

```
Legacy Next.js + Supabase
        ↓
Behavioural / Domain / Architecture Reference ONLY

New NestJS Application
        ↓
Fresh MongoDB Database
        ↓
Fresh Seed / Development Data
```

Explicitly, there is:

```
NO legacy data migration
NO Supabase data migration
NO user migration
NO order migration
NO product migration
NO password migration
NO image migration
NO ledger migration
NO database reconciliation against legacy data
```

All existing project data is disposable development/fake data.

### How migration verification requirements were superseded

`baseline-test-cases.md` §13 defined six migration verification cases — **MG-01 through MG-06** — including a zero-delta reconciliation asserting legacy historical values (`SUM(orders.total) = 7367.00`, `users 4`, `products 85`, `orders 10`, and so on), plus image-migration and password-migration assertions.

**These are no longer implementation requirements.** The section now carries an explicit supersession banner stating that MG-01…MG-06 are retained **only as a historical record** of what a migration would have had to prove, that the legacy reconciliation figures describe disposable development data, and that they must never be asserted. The coverage summary row for "Migration" is struck through and zeroed.

### Exactly what was corrected

| # | Document | Location | Correction |
|---|---|---|---|
| 1 | `baseline-test-cases.md` | §13 heading + banner | Marked **SUPERSEDED**; MG-01…MG-06 explicitly demoted to a historical record; replacement direction (seed integrity validation) recorded |
| 2 | `baseline-test-cases.md` | Coverage summary | "Migration \| 6 \| 6" → struck through and zeroed |
| 3 | `MEDIA-MODEL.md` | §1 | "Migration is two files… Phase 0 risk R5 downgraded to Low" → "**There is NO image migration**… risk R5 is **void**, not merely downgraded" |
| 4 | `MEDIA-MODEL.md` | §1 | Placeholder-row note → "Nothing is migrated" **plus an explicit preserved distinction** between initial build and future provider replacement |
| 5 | `PHASE-1-REPORT.md` | §18 | "Migration is 2 files, 204 KB… R5 downgraded to Low" → "**There is NO media migration**… R5 is **void**", with a pointer to the future-replacement analysis |
| 6 | `INVENTORY-MODEL.md` | §9 | Heading "Migration from legacy" → "**Initial data — seed, not migration**"; opening restated as a seed with no legacy migration |
| 7 | `ARCHITECTURE-REVIEW-DOSSIER.md` | §0.1 | Added a pointer to this ratification record and to the seed-integrity direction |

### Preserved deliberately — future provider replacement

The clean-database correction applies to the **initial build only**. The architecture's documented limitation about *future* provider replacement is **retained unchanged** in `REPLACEMENT-TESTS.md` §2, `MEDIA-MODEL.md` §9.3 and `PHASE-1.1-REPORT.md` §19:

```
INITIAL CLEAN REBUILD          ≠          FUTURE PROVIDER REPLACEMENT
no media migration                        real media data work required
```

Once the live system holds real assets, a Cloudinary → S3/R2 switch would still require copying assets, generating derivatives, transforming persisted provider-specific references, and updating referencing documents.

> **Provider abstraction protects business modules from code-level vendor coupling. It does not guarantee that persisted external asset state can be moved without data work.** That distinction is deliberate and must not be erased.

---

## 7. Seed integrity direction

```
Legacy Migration Verification
            ↓
   SEED INTEGRITY VALIDATION
```

Migration verification validated *imported legacy data against legacy totals*. That question no longer exists. The replacement question is: **does the fresh seed/development data satisfy the new domain architecture?**

Conceptually in scope:

| Dimension | Question it answers |
|---|---|
| **Schema validity** | Does every seeded document satisfy its schema under `strict: 'throw'`? |
| **Reference integrity** | Do all cross-collection references resolve? |
| **Money validity** | Are all monetary values integer minor units with a currency, and non-negative where required? |
| **Stock validity** | Is `stock.onHand ≥ 0`, and does `Σ inventoryEvents.quantityDelta == stock.onHand` for every seeded product? |
| **Order invariant validity** | Does `grandTotal = itemsSubtotal − discountTotal + shippingFee` hold, and is it ≥ 0? |
| **Lifecycle validity** | Is every seeded order in a legal status with a coherent payment state and a well-formed status history? |

**Scope limits, deliberately observed in this phase:**

- No seed tests are implemented.
- No seed scripts are created.
- No test framework, fixture format or assertion library is specified here.

This section records the **architectural direction** only. Implementation belongs to Phase 2 and later.

---

## 8. Documents updated

| Document | Correction type | Exact reason |
|---|---|---|
| `CODEBASE-STRUCTURE.md` | **R1** ×3, **R2** ×4 | Tier-1 assignment list, totals prose and summary row corrected to 4/7/4/15; `brands`/`categories` clarified as `catalog` sub-areas. Ports column aligned to the authoritative inventory (`auth` → none, `inventory` → one port, `pricing` → `CouponRepositoryPort`) plus an explicit authority note. |
| `PHASE-1.1-REPORT.md` | **R1** ×4 | Tier table, added totals line, quality-check count (6→4), and handoff tier list corrected. |
| `CROSS-CUTTING-STANDARDS.md` | **R3** ×1 | `Money` consumer table row corrected from four to five, adding `users`. |
| `ARCHITECTURE-REVIEW-DOSSIER.md` | **R1/R2/R3** ×4, **C1** ×1, **R3** ×1 | All three §0.2 conflicts marked RESOLVED with their ratified resolutions; §17 `Money` count made explicit; §0.1 linked to this record. |
| `baseline-test-cases.md` | **C1** ×2 | §13 marked SUPERSEDED with MG-01…MG-06 demoted to a historical record; coverage row zeroed. |
| `MEDIA-MODEL.md` | **C1** ×2 | Image migration removed entirely (R5 void); initial-build vs future-replacement distinction made explicit and preserved. |
| `PHASE-1-REPORT.md` | **C1** ×1 | §18 media-migration claim replaced; risk R5 marked void. |
| `INVENTORY-MODEL.md` | **C1** ×1 | §9 retitled "Initial data — seed, not migration"; restated as a seed. |

**8 documents, 20 edits.** No other architecture document was touched. No unrelated improvements, refactors or stylistic rewrites were made.

---

## 9. New conflicts discovered

```
None
```

The consistency sweep after applying R1, R2, R3 and C1 found no further contradictions. Verified across all 38 architecture documents:

- No occurrence of "Six Tier-1", "6 of 15 modules", or any Tier-1 list containing `brands`/`categories` as standalone modules.
- No occurrence of "Token store port" or "Ledger + stock ports" outside the historical conflict log; all eleven "six ports" assertions are mutually consistent.
- No remaining four-consumer `Money` reference.
- No legacy migration presented as a Phase 2 requirement.
- The future-provider-replacement limitation remains documented in all three places it appeared.

---

## 10. Open decisions

### Phase 2 blocking

```
NONE
```

### Production blocking (do not block Phase 2 start)

| ID | Question | Default | Blocking status | Decision trigger |
|---|---|---|---|---|
| **OPEN-006** | Will production run more than one API instance? | Single instance assumed | **Production blocking** | ⚠️ **Must be answered before launch.** If more than one, **Redis is required before go-live** — in-memory rate-limit counters become per-instance and silently multiply every limit by N, a correctness failure in a security control. |
| **OPEN-001** | Shipping rate table — EGP per governorate, free-shipping threshold | Flat rate, configurable in `shippingRates`; mechanism fully specified | Production blocking | Before commerce-core completion |
| **OPEN-004** | Transactional email provider (Resend / SES / SMTP / Zoho) | Provider-agnostic port; `ConsoleEmailSender` usable in development | Production blocking | Before the auth phase ships verification email |
| **OPEN-005** | Carrier list and tracking-URL templates | Free-text carrier + optional URL template | Production blocking | Before shipping goes live |

### Non-blocking

| ID | Question | Default | Blocking status | Decision trigger |
|---|---|---|---|---|
| **OPEN-002** | Must invoices display a VAT breakdown, at what rate? | VAT-inclusive; `vatRateBps = 1400` snapshotted per order | Non-blocking | Accounting requirement; snapshotting means the answer can change without rewriting history |
| **OPEN-003** | Is the blog launching, or is `ContentModule` deferred? | Build last; fully independent | Non-blocking | Product scope |
| **OPEN-007** | Should reviews require a verified purchase, or merely flag it? | Anyone may review; `isVerifiedPurchase` computed and displayed | Non-blocking | Product decision |
| **OPEN-008** | Wishlist server-side persistence | Client-side localStorage | Non-blocking | Post-MVP scope |
| **OPEN-1.1-A** | Handlebars vs MJML | **Handlebars (closed choice)** | Non-blocking | Revisit only on measured cross-client rendering defects |
| **OPEN-1.1-B** | Port for `SearchModule` when Atlas Search arrives | No port | Non-blocking | Only if both engines must coexist |
| **OPEN-1.1-C** | Does `CatalogModule` split into products/taxonomy? | One module | Non-blocking | Split above ~15 files |
| **OPEN-1.1-D** | `EventEmitter2` for `Reviews → Orders` | Direct read-only call | Non-blocking | Only if the edge must reverse |
| **OPEN-1.1-E** | Formal `ClockPort` vs injected `now()` | Injected function | Non-blocking | Ceremony not yet warranted |

**None has an unsafe default.** Each records what happens if it is never answered.

---

## 11. Phase 2 architecture gates

| # | Gate | Status |
|---|---|---|
| 1 | **Architecture freeze is complete** | ✅ Approved (this record) |
| 2 | **No legacy data migration** — the system starts fresh | ✅ Ratified (C1) |
| 3 | **Fresh MongoDB database**, fresh seed/development data | ✅ Ratified (C1) |
| 4 | **MongoDB replica set available before any transaction-dependent implementation or testing** | 🔶 **Reclassified by [`ENVIRONMENT-RATIFICATION.md`](./ENVIRONMENT-RATIFICATION.md) §4 (Phase 2.5.1).** Split into (a) **transaction implementation — APPROVED**, proven once by executed rollback and commit evidence, and (b) **per-environment verification**, a provisioning obligation discharged when each environment is built. Status: Local ✅ VERIFIED · Development/Atlas — see Phase 2.5.1 report · CI ⬜ READY · Staging ⬜ NOT PROVISIONED · Production ⬜ NOT PROVISIONED. **No environment may be marked verified without executed database-state evidence.** |
| 5 | **No vendor SDK imports inside business modules** — vendor SDKs only under `src/providers/` | ⬜ Lint-enforced (`no-restricted-imports`) |
| 6 | **Business services do not read `process.env` directly** — one read, in `config/env.schema.ts` | ⬜ Lint-enforced (`no-restricted-properties`) |
| 7 | **Provider replacement boundaries remain intact** — ports use application vocabulary; provider identifiers stay opaque; vendor errors translated at the adapter boundary | ⬜ Verified by the port conformance suite |
| 8 | **Templates remain provider-independent** — `src/templates/email/`, rendered before the port, never under `providers/` or in a vendor dashboard | ⬜ Review + template-inventory test |
| 9 | **Module tiering must not be violated** — no Tier-1 module forced into four layers; no Tier-3 module flattened; demotion permitted when a layer proves empty | ⬜ Review against `CODEBASE-STRUCTURE.md` §4 |
| 10 | **No unnecessary abstractions** — no interface-per-class, no `BaseRepository<T>`, no provider registry/factory/failover, no `DatabasePort`, no premature Redis, no CQRS buses, no speculative ports | ⬜ Review against `ANTI-OVERENGINEERING.md` |
| 11 | **CI from day one** — lint, type-check across **all** workspaces, test, build; architecture boundary rules are CI errors | ⬜ Phase 2 deliverable |
| 12 | **Vendor credentials absent in CI**, so no default-suite test can silently reach a real provider | ⬜ Phase 2 deliverable |

**Authoritative sources for Phase 2 review:**

| Topic | Authority |
|---|---|
| **Environment model · CI transaction harness · gate classification** | [`ENVIRONMENT-RATIFICATION.md`](./ENVIRONMENT-RATIFICATION.md) — Phase 2.5.1 |
| Module Tier Classification | [`CODEBASE-STRUCTURE.md`](./CODEBASE-STRUCTURE.md) §7 |
| Port Inventory | [`PORTS-AND-CONTRACTS.md`](./PORTS-AND-CONTRACTS.md) §3 |
| Architecture Freeze Decision | **this document** |
| Clean Database / No Migration | [`ARCHITECTURE-REVIEW-DOSSIER.md`](./ARCHITECTURE-REVIEW-DOSSIER.md) §0.1 + **this document** §6 |
| Order transition matrix | [`ORDER-LIFECYCLE.md`](./ORDER-LIFECYCLE.md) §5 |
| Business rules | [`BUSINESS-RULES.md`](./BUSINESS-RULES.md) |
| Dependency rules | [`DEPENDENCY-RULES.md`](./DEPENDENCY-RULES.md) |

---

## 12. Final statement

```
ARCHITECTURE FREEZE: APPROVED

Phase 1 and Phase 1.1 are frozen as the architectural baseline.

Phase 2 may begin after this ratification is complete.

No implementation architecture decisions may be silently changed during Phase 2.
Any material deviation requires an explicit architecture decision.
```
