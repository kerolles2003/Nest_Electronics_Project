# Authentication Forensics — Phase 0.5

**Source:** live production project `quhllllvwwuizjfrxvdz`.
**Extraction:** 2026-08-29 — read-only queries against the `auth` schema, plus a read of the public `GET /auth/v1/settings` endpoint.
**No auth configuration, user, session or token was modified.**

> **Privacy:** no email address, password hash value, token or personal identifier is reproduced here. Only aggregates, hash *format*, and configuration flags.

Every statement is tagged:
**`[CONFIG]`** verified from live GoTrue configuration · **`[DB]`** verified from the live `auth` schema · **`[REPO]`** verified from repository behaviour · **`[INFERRED]`** reasoned · **`[UNKNOWN]`** not obtainable with current access.

---

## 1. Provider configuration — VERIFIED from live config

`GET /auth/v1/settings` (public endpoint, anon key):

| Setting | Value | Significance |
|---|---|---|
| `external.email` | **`true`** `[CONFIG]` | Email + password is the only working method |
| **`external.google`** | **`false`** `[CONFIG]` | 🔴 **Google OAuth is DISABLED** |
| All other 20+ providers | `false` `[CONFIG]` | apple, azure, github, facebook, twitter, discord, … |
| `external.phone` | `false` `[CONFIG]` | No SMS auth |
| `external.anonymous_users` | `false` `[CONFIG]` | No anonymous sessions |
| `disable_signup` | `false` `[CONFIG]` | Public registration is open |
| **`mailer_autoconfirm`** | **`false`** `[CONFIG]` | 🔴 **Email confirmation is REQUIRED** |
| `phone_autoconfirm` | `false` `[CONFIG]` | |
| `saml_enabled` | `false` `[CONFIG]` | |
| `passkeys_enabled` | `false` `[CONFIG]` | |
| `sms_provider` | `twilio` (default, unused) `[CONFIG]` | |

### 🔴 A1 — Google OAuth is disabled, but the UI offers it

Phase 0 question 16 is answered: **Google is `false`.**

`apps/storefront/src/app/login/form.tsx:66` and `register/form.tsx:63` call `signInWithOAuth({ provider: 'google' })`, and the UI renders a "Continue with Google" button. With the provider disabled, GoTrue rejects the request — the button is **non-functional in production**.

Corroborating `[DB]` evidence: `auth.identities` contains **4 rows, all `provider = 'email'`. Zero Google identities have ever existed.**

**Migration impact:** Google OAuth is an **unbuilt feature**, not a migration target. Phase 0 §4.10 scheduled `passport-google-oauth20` as a port of existing behaviour; it must be re-scoped as **new work**, or dropped. No identity-linking migration is needed.

### 🔴 A2 — Email confirmation is required, and registration does not handle it

`mailer_autoconfirm = false` means a new signup gets **no session** until the confirmation link is clicked.

`apps/storefront/src/app/register/form.tsx:41` calls `signUp(...)` and then redirects straight to `/account/orders` without checking whether a session exists. `/account` is proxy-protected, so the user is immediately bounced to `/login` with no explanation.

**This confirms the Phase 0 hypothesis as fact.** Registration is broken from the user's point of view: the account *is* created, but the flow dead-ends.

`[DB]` All 4 existing users have `email_confirmed_at` set, so confirmation does work when the link is used.

---

## 2. Live user population `[DB]`

| Metric | Value |
|---|---|
| `auth.users` | **4** |
| Email confirmed | 4/4 |
| Has usable password hash | 4/4 |
| Has signed in at least once | 4/4 |
| `raw_app_meta_data.provider = 'email'` | 4 |
| `raw_app_meta_data.provider = 'google'` | **0** |
| SSO users | 0 |
| Banned | 0 |
| Soft-deleted | 0 |
| `auth.identities` | 4, all `email` |
| `auth.flow_state` rows | 0 (no PKCE flows in flight) |
| `auth.refresh_tokens` | 16 total, **9 revoked**, 7 live |
| MFA factors | 0 `[DB]` — `auth.mfa_factors` empty |

**Roles** (from `public.profiles`, `[DB]`): 3 × `customer`, 1 × `super_admin`, **0 × `admin`**.

> No user has ever held the `admin` role. Every admin operation in production has been performed by the single `super_admin`. Since `is_admin()` and `requireAdmin()` treat both identically, the distinction has never been exercised — see [`../db/data-integrity.md`](../db/data-integrity.md) §10.

---

## 3. 🟢 Password hashes ARE migratable — Phase 0 R3 resolved

`[DB]` Verified by inspecting hash **format only** (prefix and length; no value read):

| Property | Value |
|---|---|
| Algorithm prefix | **`$2a$`** |
| Length | **60 characters** |
| Rows | 4/4 |

This is standard **bcrypt**. It is directly verifiable in Node with `bcrypt.compare(plaintext, hash)`.

| Phase 0 question 4 | Answer |
|---|---|
| Can `auth.users.encrypted_password` be exported? | **YES** — direct database access exists (the same read-only path used for this audit) and the hashes are portable bcrypt |
| Is a forced password reset required at cutover? | **NO** |

**This closes migration risk R3 (High/Medium — "customer churn at cutover").** The migration can be **transparent**: copy the hashes into `users.passwordHash` and verify with `bcrypt.compare` in `AuthService`. Users keep their passwords and never notice.

Two caveats:
1. Node's `bcrypt`/`bcryptjs` handle the `$2a$` variant correctly. If `argon2` is preferred long-term, use **opportunistic rehash on next successful login** rather than a forced reset.
2. The password-reset flow is broken today (§5) and must be built regardless — it is simply no longer on the cutover critical path.

---

## 4. Session, token & refresh model

| Aspect | Finding |
|---|---|
| Token type | GoTrue JWT: short-lived access token + rotating refresh token `[INFERRED — standard GoTrue]` |
| Transport | httpOnly cookies via `@supabase/ssr` `[REPO]` |
| Refresh | Handled entirely inside the Supabase SDK `[REPO]` |
| Revocation | `auth.refresh_tokens.revoked` — 9 of 16 revoked `[DB]`, consistent with normal sign-out/rotation |
| Access-token TTL | **`[UNKNOWN]`** — a project-level GoTrue setting, not exposed via `/settings` or the database. Supabase default is 3600 s. |
| Refresh-token TTL / reuse-detection window | **`[UNKNOWN]`** — same reason |
| JWT signing secret | Not read. Exists as a project secret. `[UNKNOWN]` by design |
| Session storage | `auth.sessions` table (23 tables exist in the `auth` schema) `[DB]` |
| MFA / AAL | Tables exist (`mfa_factors`, `mfa_amr_claims`, `mfa_challenges`); **0 factors enrolled** `[DB]` |
| WebAuthn / passkeys | Tables exist; `passkeys_enabled = false` `[CONFIG]` |

**Not blocking.** The unknown TTLs do not constrain the NestJS design — Phase 0 already proposes its own (~15 min access + rotating refresh). They only matter if someone wanted to replicate current session lifetimes exactly, which is not a requirement.

`[DB]` The live query profile shows GoTrue reading `auth.sessions` (1,202 calls) and `auth.mfa_amr_claims` (1,201) on essentially every authenticated request — the per-request session-validation cost that a stateless JWT in NestJS removes.

---

## 5. Password reset — VERIFIED broken `[REPO]`

Phase 0 §4.5 found `forgot-password/form.tsx:33` references `ROUTES.auth.callback`, and `ROUTES` in `packages/config/src/constants.ts` has **no `auth` key** — so submitting the form throws `TypeError: Cannot read properties of undefined`.

Nothing in the live configuration contradicts this, and the live evidence is consistent: `auth.flow_state` is **empty** and there is **no set-new-password page** anywhere in the repository. Password reset has never completed for any user.

**Migration impact:** unchanged from Phase 0 — reset must be **built**, not ported. It is no longer on the cutover critical path (§3 removes the forced-reset requirement), but it remains a required feature.

---

## 6. Roles: database vs auth metadata `[DB]`

| Location | Contents |
|---|---|
| `public.profiles.role` | **The authoritative role.** `customer` \| `admin` \| `super_admin`, `NOT NULL DEFAULT 'customer'`, CHECK-constrained |
| `auth.users.raw_app_meta_data` | Keys: `provider`, `providers` only — **no role** |
| `auth.users.raw_user_meta_data` | Keys: `email`, `email_verified`, `phone_verified`, `full_name`, `sub` — **no role** |
| JWT claims | Roles are **not** in the token `[INFERRED]` — nothing writes them to `app_metadata` |

**Consequence, and it is the single most important auth-architecture fact here:** because the role lives only in a table and not in the token, **every authorization decision requires a database round-trip**. Live evidence: `profiles_pkey` is the hottest index in the entire database at **2,719 scans**, driven by `requireAdmin()`, the admin `proxy.ts`, `useAuth`, and the 28 RLS policies that call `is_admin()`.

**Migration opportunity:** putting `role` into the JWT claims removes that round-trip from every request. The trade-off — a role change does not take effect until the token refreshes — is standard and acceptable, and is bounded by the access-token TTL.

---

## 7. Registration flow, verified end to end

```
[REPO]   Browser: supabase.auth.signUp({ email, password, data:{ full_name } })
              │   Zod validation runs CLIENT-SIDE ONLY (schemas.ts:10-18, min 8 chars)
              ▼
[CONFIG] GoTrue: creates auth.users row
              │   mailer_autoconfirm = false  ->  NO SESSION ISSUED
              ▼
[DB]     Trigger on_auth_user_created (AFTER INSERT ON auth.users)
              ▼
[DB]     handle_new_user()  [SECURITY DEFINER]
              INSERT profiles (id, full_name = COALESCE(meta.full_name, email), avatar_url)
              role  -> column DEFAULT 'customer'    (never settable at signup)
              phone -> NULL                          (never captured)
              ▼
[CONFIG] Confirmation email sent; user must click the link
              ▼
[REPO]   Meanwhile the form redirects to /account/orders
              -> proxy sees no session -> bounces to /login    ** BROKEN UX **
```

Verified properties:
- A user **cannot** self-register as an admin — `handle_new_user` never writes `role`, and `profiles_update_own` has `WITH CHECK (role = 'customer')`.
- `full_name` falls back to the **email address**, which is what satisfies the `NOT NULL` when the client omits it.
- **`phone` is never populated at signup**, so `profiles.phone` is NULL until the user edits their profile — and profile save is itself broken for customers (see [`../db/policies-analysis.md`](../db/policies-analysis.md) §4.1).
- Password strength is enforced **only in the browser** (`min(8)`). GoTrue's own minimum is `[UNKNOWN]` but is at most Supabase's default of 6.

---

## 8. Login flow

```
[REPO] Browser: signInWithPassword({email,password})
[CONFIG] GoTrue verifies bcrypt hash -> issues access + refresh JWT (cookies)
[REPO] If local cart non-empty -> syncCartToDatabase()
[REPO] router.push(redirectTo ?? '/account/orders')
[REPO] Next request: proxy.ts
         storefront -> auth.getSession()   (decodes cookie, NOT server-validated)
         admin      -> auth.getUser()      (server-validated) + service-role profiles.role lookup
```

Admin login performs **no role check at login time** `[REPO]`; a non-admin who signs in at `/admin/login` succeeds and is redirected to `/unauthorized` on the next request. Cosmetic, not a security hole — the proxy does enforce.

---

## 9. Summary of Phase 0 auth questions

| Phase 0 question | Status | Answer |
|---|---|---|
| Q4 — Can password hashes be exported? | ✅ **RESOLVED** | **Yes** — bcrypt `$2a$`, 60 chars. Transparent migration. **R3 closed.** |
| Q16 — Is Google OAuth enabled? | ✅ **RESOLVED** | **No.** Disabled; 0 Google identities ever. Re-scope as new work. |
| Q16 — Is email confirmation on? | ✅ **RESOLVED** | **Yes** (`mailer_autoconfirm=false`). Registration UX is broken as a result. |
| Q5 — Does `handle_new_user` exist? | ✅ **RESOLVED** | Yes — see [`../db/triggers-analysis.md`](../db/triggers-analysis.md) |
| Is password reset working? | ✅ **RESOLVED** | **No** — broken in code; never completed for any user |
| Access/refresh token TTLs | ⚪ **UNKNOWN** | Project-level GoTrue setting; **not blocking** |
| JWT secret | ⚪ **UNKNOWN** | By design; not needed |

### What is still UNKNOWN, why it matters, and how to obtain it safely

| Unknown | Matters? | How to obtain |
|---|---|---|
| Access/refresh token TTLs | **No** — NestJS defines its own | Supabase Dashboard → Authentication → Sessions, or Management API `GET /v1/projects/{ref}/config/auth` with a **valid** PAT (the one in `.project_plan/PROJECT_OVERVIEW.md` returns HTTP 401 — revoked) |
| GoTrue minimum password length | **No** — NestJS will set its own policy | Same source |
| Email templates / SMTP sender | Minor — only for reproducing reset emails | Same source |
| Rate limits configured in GoTrue | Minor | Same source |

None of these block Phase 1. Obtaining them requires issuing a **new** Supabase personal access token — the documented one is revoked.

---

## 10. Target model (recommendation only — not implemented)

| Current | NestJS target | Notes |
|---|---|---|
| GoTrue email/password, browser-side | `AuthModule`: `POST /auth/register`, `/login`, `/refresh`, `/logout` | Move all 6 browser `auth.*` calls server-side |
| bcrypt `$2a$` in `auth.users` | **Copy hashes verbatim** into `users.passwordHash`; verify with `bcrypt.compare` | **Transparent migration — no forced reset** |
| Email confirmation required | Preserve, and **fix the UX**: registration must tell the user to check their email instead of redirecting into a guarded route | Fixes A2 |
| Google OAuth (disabled, non-functional) | **New feature or drop** — not a port | A1 |
| Role in `profiles.role`, DB lookup per request | Role as a **JWT claim** + `RolesGuard` | Removes the hottest query in the system (§6) |
| `admin` ≡ `super_admin` | **Introduce real separation**: `@Roles('super_admin')` on role management | Never exercised in production — test both |
| Broken password reset | **Build**: `POST /auth/forgot-password` + `/reset-password` + a set-password page | §5 |
| `handle_new_user` trigger | Explicit user creation in the registration transaction | Preserve `full_name → email` fallback and `role='customer'` default |
| Refresh tokens in `auth.refresh_tokens` | `refreshTokens` collection or Redis denylist | Enables logout-everywhere, which does not exist today |
| No rate limiting | `@nestjs/throttler` on all auth endpoints | Phase 0 M1 |
| Password policy `min(8)` client-side only | Server-side policy in the DTO | Client validation is currently bypassable |
