# Audit & History Model — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADR:** ADR-AUDIT-001, 002

---

## 1. Two distinct kinds of record

The single most important decision here is that these are **not the same thing** and must not share a mechanism.

| | **Business history** | **Security / administrative audit** |
|---|---|---|
| Question it answers | *"What happened to this order?"* | *"Who did this, and were they allowed to?"* |
| Audience | **Customers** and staff | Staff and investigators only |
| Storage | **Embedded** in the entity | **Separate** `auditLogs` collection |
| Examples | Order status history · inventory ledger | Admin login · role change · price change · product deletion |
| Retention | Lifetime of the entity | **2 years**, then TTL |
| Exposure | Visible in customer-facing UI | `ADMIN` only |
| Failure handling | Part of the business transaction — failure aborts it | **Post-commit**, but failure is **loudly logged and alerted** |

Legacy conflated these: `order_status_history` (business) worked, while `admin_audit_logs` (security) silently never wrote a single row.

---

## 2. The legacy failure

| Finding | Evidence |
|---|---|
| `admin_audit_logs` row count | **0** — despite 10 orders, 8 status transitions, 85 products and an active `super_admin` |
| Root cause | `log-action.ts` inserted a **`user_agent` column that does not exist** |
| Why it was silent | PostgREST **returns** the error in the response object rather than throwing, so the surrounding `try/catch` never fired |
| Why RLS was not to blame | `audit_logs_admin_insert WITH CHECK (is_admin())` would have permitted the write |
| Visible symptom | The `/admin/audit-log` page rendered an empty table that read as *"no admin activity yet"* rather than *"this subsystem is broken"* — and it was viewed (61 sequential scans on an empty table) |
| Second defect | Audit rows were written **with the caller's own credentials**, so an audited principal could in principle suppress their own audit trail |

**Every administrative action in the system's history is unaudited.** Three design rules follow directly:

1. **Audit writes are validated against a schema** (`strict: 'throw'`) — an unknown field raises rather than being silently dropped.
2. **Audit failures are logged at `error` and alerted** — never swallowed.
3. **Audit is written by the system, never by the acting principal.**

---

## 3. What is audited

> **Not everything.** Auditing reads, or every write, drowns the signal and creates a second data-volume problem. Audit records **privileged and security-relevant** actions only.

### ✅ Audited

| Category | Actions |
|---|---|
| **Authorization changes** | Role change · user deletion · account disable/enable |
| **Authentication (security-relevant)** | Failed login (≥ 3 consecutive) · password reset completed · refresh-token reuse detected · logout-all |
| **Money-affecting catalogue changes** | Product price change (`basePrice`, `salePrice`) · coupon create/update/deactivate |
| **Inventory** | Every manual adjustment, restock, damage write-off (**in addition to** the ledger — the ledger records *what*, audit records *who and why it was allowed*) |
| **Order interventions** | Admin status transition · payment status change · refund marking · admin cancellation |
| **Destructive operations** | Product/category/brand soft-delete and hard-delete · review deletion · media deletion |
| **Publication state** | Product publish/unpublish · blog publish/unpublish |
| **Configuration** | Shipping-rate changes |

### ❌ Not audited

| Not audited | Reason |
|---|---|
| Any read operation | Enormous volume, negligible value at this scale |
| Successful customer login | Recorded as `lastLoginAt` on the user; a log line suffices |
| Customer cart mutations | Not privileged; high volume |
| Customer order placement | Captured by the order itself + `statusHistory` |
| Customer profile/address edits | Own data, not privileged |
| Product description/image edits | High volume, low risk — covered by `updatedAt` |
| Search queries | Analytics, not audit |

**Test:** would an investigator, or a regulator, ask *"who did this?"* If not, it is not audited.

---

## 4. The audit document

```jsonc
{
  "_id": ObjectId,
  "actor": {
    "id": ObjectId,
    "role": "ADMIN",
    "name": "…",
    "email": "…"                    // snapshot — survives actor deletion
  },
  "action": "PRODUCT_PRICE_CHANGED", // stable enum
  "entity": { "type": "PRODUCT", "id": ObjectId, "label": "ESP32 DevKit V1" },
  "changes": {
    "before": { "pricing": { "basePrice": 32500 } },
    "after":  { "pricing": { "basePrice": 29900 } }
  },
  "metadata": { "reason": "Seasonal promotion" },
  "ip": "197.x.x.x",
  "userAgent": "Mozilla/5.0 …",      // the field legacy tried and failed to write
  "requestId": "01JC8XQZ…",
  "createdAt": ISODate
}
```

| Field | Why |
|---|---|
| `actor` **snapshotted** | The record must remain readable after the actor is deleted or renamed |
| `action` | Stable enum, queryable |
| `entity.label` | A human-readable name so the log reads without joins |
| `changes.before/after` | **Only the fields that actually changed** — not whole documents |
| `ip`, `userAgent` | Forensic context. `userAgent` is the exact field whose absence silently broke legacy audit. |
| `requestId` | Correlates the audit entry with the request log line and the error response |

**Never stored in `changes`:** `passwordHash`, tokens, `costPrice` in a customer-visible context, or full PII. A diff is computed field-by-field with a redaction allow-list.

---

## 5. How it is written

```
Request → Guards → Controller → Service → Repository → MongoDB
                                   │
                                   ▼ (business transaction COMMITS)
                        AuditInterceptor  [system privilege]
                                   ▼
                            auditLogs.insertOne()
                                   │
                            failure → log.error + alert
                                    (business operation is NOT rolled back)
```

Four rules:

1. **Written by an interceptor, with system privilege.** The acting principal has no write path to `auditLogs`. There is no API that accepts an audit record. This closes the legacy defect where audit was written with the caller's own credentials.
2. **Post-commit.** An audit write must never roll back a successful business operation. A completed order is more important than its audit line.
3. **Failure is loud.** `log.error({ event: 'AUDIT_WRITE_FAILED', … })` plus an alert. The legacy failure mode — a silent swallow producing an empty table that *looked* healthy — is the specific thing being engineered against.
4. **Immutable.** No update or delete API exists. `auditLogs` is append-only; only the TTL removes records.

---

## 6. Business history — embedded

### 6.1 Order status history — PRESERVED

```jsonc
"statusHistory": [
  { "from": null,      "to": "PLACED",    "actor": {id, role, name}, "note": null, "at": … },
  { "from": "PLACED",  "to": "CONFIRMED", "actor": {…}, "note": "Phone confirmed", "at": … }
]
```

Legacy's design was sound (8 live rows, append-only). Three fixes:

| Legacy | Fix |
|---|---|
| `changed_by` accepted **from the caller**, unverified → forgeable | Actor from the JWT |
| Only written by the RPC; a direct `UPDATE orders` (permitted to admins by RLS) changed status with **no history row** | Status is mutable *only* through `OrdersService.transition()`; the history append is in the same transaction |
| Recorded a `field` name because three status columns existed | One status axis → `from`/`to`. Payment changes are their own entries. |

**Customer-visible.** This is what the order tracking timeline renders.

### 6.2 Inventory ledger — PRESERVED + COMPLETED

`inventoryEvents` (see [`INVENTORY-MODEL.md`](./INVENTORY-MODEL.md) §4) is business history in a separate collection because it is unbounded and queried across products.

| Legacy | Fix |
|---|---|
| No opening balances → `Σ ledger ≠ onHand` for every product | `OPENING_BALANCE` event per product makes the invariant assertable |
| `created_by` NULL on every sale | Actor always populated |
| Nothing enforced ledger/stock consistency | Ledger write is in the **same transaction** as the stock change |
| No `before`/`after` | `balanceBefore`/`balanceAfter` make each entry self-verifying |

**Staff-visible** (admin inventory drawer), not customer-visible.

---

## 7. Retention

| Record | Retention | Mechanism |
|---|---|---|
| `orders.statusHistory` | Lifetime of the order (**forever**) | Embedded |
| `inventoryEvents` | **Forever** | Append-only; archive to cold storage if volume ever demands |
| `auditLogs` | **2 years** | TTL index on `createdAt` |
| Request logs | 30 days | Log platform |

Two years for audit balances investigative value against storage and privacy (audit records contain IP addresses — personal data that should not be retained indefinitely without cause).

---

## 8. Access

| Operation | Role |
|---|---|
| Read `auditLogs` | `ADMIN`, `SUPER_ADMIN` |
| Read own `statusHistory` | Order owner |
| Read any `statusHistory` | `ADMIN` |
| Read `inventoryEvents` | `ADMIN` |
| **Write any audit record via API** | **Nobody** — system only |
| **Delete/modify any audit record** | **Nobody** |

```
GET /api/v1/admin/audit-logs
    ?actorId=&action=&entityType=&entityId=&from=&to=&page=&limit=
```

Indexes: `{createdAt:-1}` · `{'entity.type':1,'entity.id':1}` · `{'actor.id':1, createdAt:-1}` · `{action:1, createdAt:-1}` · TTL.

> Legacy already had `idx_audit_entity` and `idx_audit_admin`. The index design was correct — the table was simply never written to.

---

## 9. Alerting

| Event | Severity |
|---|---|
| **Audit write failure** | 🔴 Critical — the condition that hid every legacy defect |
| Role change | 🟠 High |
| User deletion | 🟠 High |
| Refresh-token reuse detected | 🟠 High |
| Repeated failed admin logins | 🟠 High |
| Hard delete of any entity | 🟡 Medium |
| Inventory adjustment > 100 units | 🟡 Medium |

---

## 10. Summary

| # | Decision | Fixes |
|---|---|---|
| 1 | **Business history and security audit are separate mechanisms** | Legacy conflated them; one worked, one silently did not |
| 2 | Audit written by a **system-privileged interceptor** | Audited principal could write/suppress their own trail |
| 3 | **Post-commit**, never rolling back the business operation | — |
| 4 | **Audit failure is logged loudly and alerted** | Silent swallow → 0 rows, page looked healthy |
| 5 | `strict: 'throw'` schema | The `user_agent` type-drift class of bug |
| 6 | `userAgent` is a **real field** | The exact field legacy failed to write |
| 7 | **Selective auditing** — privileged actions only | Auditing everything drowns the signal |
| 8 | Actor **snapshotted**; `requestId` recorded | Readable after actor deletion; correlates with logs |
| 9 | **Immutable**, append-only, 2-year TTL | — |
| 10 | Status history: actor from JWT, single mutation path | Forgeable `changed_by`; direct updates bypassing history |
| 11 | Ledger: opening balances + `balanceBefore/After` | `Σ ledger == onHand` becomes assertable |
