# Media & Cloudinary Model — Phase 1 Architecture Freeze

**Status:** FROZEN · **Date:** 2026-08-30 · **ADRs:** ADR-MEDIA-001 … 004

---

## 1. Scale reality check

Phase 0.5 measured the actual media footprint:

| Metric | Value |
|---|---|
| Storage buckets provisioned | 4 (`products`, `avatars`, `blog`, `reviews`) |
| Buckets containing any file | **1** (`products`) |
| **Total objects** | **2** |
| **Total bytes** | **~204 KB** |
| `product_images` rows | 22 — of which **20 point at `placehold.co`** |
| Products with **no** image | **63 of 85 (74%)** |
| Max images on any product | **1** |

**There is NO image migration.** The system starts with a fresh database and an empty media store (Architecture Freeze Ratification, C1). Phase 0 risk R5 is **void**, not merely downgraded. The figures above are a *reference* for how little the legacy system held; the *architecture* is what needs work, because the legacy model stored absolute URLs, captured no dimensions, and deleted assets by string-splitting a URL.

Nothing is migrated. The catalogue starts with no images, and populating it is a content task.

> **This concerns the initial build only.** Once the live system holds real assets, a *future* provider replacement (Cloudinary → S3/R2) would still require moving those bytes — see §9.3 and [`REPLACEMENT-TESTS.md`](./REPLACEMENT-TESTS.md) §2. Provider abstraction protects business modules from code-level coupling; it does not make persisted external asset state free to move.

---

## 2. Upload flow decision

> ### **DECISION (ADR-MEDIA-001): `Client → NestJS → Cloudinary`. Not signed direct upload.**

```
Browser / Flutter
   │  multipart/form-data
   ▼
NestJS  MediaModule
   ├─ JwtAuthGuard + RolesGuard          ← authorization BEFORE any byte is accepted
   ├─ Multer memoryStorage, hard size limit
   ├─ MIME allow-list (declared type)
   ├─ MAGIC-BYTE sniffing (file-type)    ← NEW: never trust the declared MIME
   ├─ sharp: strip EXIF, read real dimensions, cap max edge
   ▼
Cloudinary  upload_stream(folder, public_id, overwrite:false)
   ▼
MongoDB: { publicId, version, format, width, height, bytes, alt, … }
```

| Option | Verdict | Reasoning |
|---|---|---|
| **A. Client → NestJS → Cloudinary** | ✅ **CHOSEN** | The server sees every byte, so validation, magic-byte sniffing, EXIF stripping and dimension capture are guaranteed rather than advisory. Metadata is written by the server, never reported by the client. Files are ≤ 5 MB and admin-only, so the bandwidth cost through the API is negligible. |
| **B. Signed direct upload** | ❌ Rejected for MVP | Keeps large files off the API, but the server never inspects the file. Validation degrades to whatever Cloudinary enforces, and the client must *report* the resulting metadata — reintroducing exactly the anti-pattern this design forbids (§4). Worth revisiting only if uploads become large or high-volume. |

**Revisit condition:** customer-submitted review images at scale, or product videos. At that point add signed uploads with a mandatory server-side *registration* step that fetches metadata from Cloudinary directly rather than trusting the client.

---

## 3. Asset identity — `publicId`, never a URL

> **DECISION (ADR-MEDIA-002): store `publicId` + `version`. Never persist a rendered URL.**

Legacy persisted absolute URLs (`https://<project>.supabase.co/storage/v1/object/public/products/...`) into `product_images.url`. Two concrete consequences:

1. **Deletion worked by string-splitting the stored URL** on `/products/` to recover the storage key (Phase 0 W2) — brittle, and silently wrong if a path ever contained that segment.
2. **Changing CDN, account or bucket becomes a data migration** rather than a config change. The Supabase project reference was literally baked into 22 database rows *and* into `next.config.ts`.

```jsonc
"images": [
  {
    "publicId": "nest/products/652f.../esp32-front-a1b2c3",
    "version": 1712345678,
    "format": "webp",
    "width": 1200, "height": 1200, "bytes": 84213,
    "alt": "ESP32 DevKit V1 front view",
    "sortOrder": 0,
    "isPrimary": true,
    "uploadedAt": ISODate,
    "uploadedBy": ObjectId
  }
]
```

URLs are **derived at read time** by the API:

```
https://res.cloudinary.com/<cloud>/image/upload/<transformation>/v<version>/<publicId>
```

`version` is included so a re-upload to the same `publicId` busts CDN caches deterministically.

---

## 4. Metadata authority

> **The browser is never the authority for media metadata.**

| Field | Source |
|---|---|
| `width`, `height`, `format`, `bytes` | **Server**, from `sharp` / the Cloudinary response |
| `publicId`, `version` | **Server**, from the Cloudinary response |
| `uploadedBy`, `uploadedAt` | **Server**, from the JWT and clock |
| `alt` | **Client** — the only client-supplied field; it is descriptive text, sanitised and length-capped |
| `sortOrder`, `isPrimary` | Client *intent*, validated and normalised server-side |

**Dimensions are captured for the first time.** Legacy stored only `size` and `mimetype`, so `next/image` could never reserve space — guaranteeing cumulative layout shift on every grid (Phase 0 P16). Storing `width`/`height` fixes this at the source.

---

## 5. Validation

Legacy's `validate-upload.ts` was genuinely good (MIME + 5 MB + extension + filename sanitisation + path-traversal guard) and is **PRESERVED**. Three additions:

| # | Check | Status | Detail |
|---|---|---|---|
| 1 | Authorization | PRESERVED | Guard runs **before** the body is parsed |
| 2 | Declared MIME allow-list | PRESERVED | `image/jpeg`, `image/png`, `image/webp` |
| 3 | **Magic-byte sniffing** | **NEW** | `file-type` inspects actual bytes. A file declaring `image/png` whose content is not PNG is rejected. Legacy trusted the declared type. |
| 4 | Size limit | PRESERVED | 5 MB products/blog/reviews, 2 MB avatars — ported from the legacy **bucket-level** limits, which Phase 0 did not know existed |
| 5 | Dimension limits | **NEW** | Min 200×200; max edge 4000 px (downscaled, not rejected) |
| 6 | **SVG rejected** | **NEW (hard rule)** | Not in the allow-list, and `dangerouslyAllowSVG` is removed from both Next.js configs. SVG is executable markup; an SVG served from a whitelisted image host is a stored-XSS vector (Phase 0 M3). |
| 7 | EXIF stripped | **NEW** | Removes GPS/camera metadata — a privacy leak, especially for future customer review images |
| 8 | Filename sanitisation | PRESERVED | Server generates the `publicId`; the original filename never reaches storage |
| 9 | Count limit | PRESERVED | ≤ 8 images per product — now enforced **server-side** (legacy enforced it only in the React component) |

**Two-layer validation is deliberate:** Cloudinary's own upload preset restrictions act as a backstop if application validation is ever bypassed — mirroring the legacy bucket-level allow-list, which was the one media control that could not be circumvented from the client.

---

## 6. Folder structure & naming

```
nest/
├── products/<productId>/<slug>-<nanoid>
├── blog/<postId>/<slug>-<nanoid>
├── brands/<brandId>/logo-<nanoid>
├── categories/<categoryId>/cover-<nanoid>
├── avatars/<userId>/avatar-<nanoid>          (deferred)
└── reviews/<reviewId>/<nanoid>               (deferred)
```

**`<entityId>/` prefix is PRESERVED from legacy**, where product uploads already used `products/<productId>/<file>`. It makes ownership checks trivial (the path proves which entity an asset belongs to) and makes orphan detection a prefix scan.

`<nanoid>` guarantees uniqueness without a lookup and prevents guessable asset URLs. `overwrite: false` on upload means a collision fails loudly rather than silently destroying an existing asset.

---

## 7. Public vs private

**All media is public.** Product images, blog covers and brand logos are catalogue content served over a CDN — access control would defeat the purpose and break caching.

Two consequences to state explicitly:

1. **Assets belonging to a hidden product remain reachable if the URL is known.** Cloudinary does not consult application state. Mitigation: `publicId` contains a `nanoid`, so URLs are unguessable, and the **API never returns image data for a non-public product** — closing legacy defect Z6, where 7 child tables carried `SELECT USING (true)` and leaked the images of unreleased products to anyone querying directly.
2. **Deletion must be real.** Unpublishing a product does not hide its assets, so removing an asset means destroying it in Cloudinary (§9).

Customer review images, if built, will be public but only surfaced after moderation.

---

## 8. Transformations

> **Named transformation presets, defined once in Cloudinary. Never ad-hoc URL parameters.**

| Preset | Spec | Used for |
|---|---|---|
| `t_thumb` | 96×96, fill, `f_auto,q_auto` | Cart lines, order items, admin tables |
| `t_card` | 400×400, fill, `f_auto,q_auto` | Product grids |
| `t_detail` | 1000×1000, fit, `f_auto,q_auto` | PDP main image |
| `t_zoom` | 2000 max edge, `f_auto,q_auto:best` | PDP zoom |
| `t_og` | 1200×630, fill | Social/OG images |
| `t_blog_cover` | 1600×900, fill, `f_auto,q_auto` | Blog |

`f_auto` serves AVIF/WebP by browser support; `q_auto` picks quality per image.

**Legacy had no transformations at all** — full-size originals were served to 96px thumbnails (Phase 0 P17), and the shared `product-card.tsx` used a raw `<img>` rather than `next/image` (P15), so the highest-traffic image in the application was entirely unoptimised.

Named presets mean retuning quality is a Cloudinary configuration change, not a code deploy.

---

## 9. Deletion & replacement

**Deletion is a domain operation, not a storage operation.**

```
DELETE /admin/products/:id/images/:publicId
   1. Authorize (ADMIN)
   2. Remove the descriptor from products.images[]   ← one atomic $pull
   3. If isPrimary was removed and images remain, promote the next by sortOrder
   4. Decrement the asset reference count (§9.1)
   5. refCount === 0  →  cloudinary.destroy(publicId)
      failure         →  enqueue for retry; NEVER leave a dangling reference
```

Deleting by `publicId` — not by parsing a URL — fixes the brittle legacy path derivation.

### 9.1 Reference counting (fixes a real data-integrity defect)

Legacy product duplication copied **URL strings**, so two products shared one storage object. Deleting an image from either product destroyed it for both (Phase 0 W4).

```jsonc
// mediaAssets — small bookkeeping collection
{ "_id": ObjectId, "publicId": "nest/products/…", "refCount": 2,
  "bytes": 84213, "format": "webp", "createdAt": ISODate }
```

Duplication increments `refCount`; deletion decrements it; Cloudinary destruction happens only at zero. Untriggered today (2 assets), but the defect is real and cheap to prevent.

### 9.2 Ordering and primary image

Both were legacy defects:

| Legacy | New |
|---|---|
| Reorder = **one UPDATE per image** in a loop (N+1) | **One atomic `$set`** of the whole `images` array |
| Set-primary = two sequential UPDATEs (unset all, then set one), non-atomic | **One atomic update** that rewrites the array with exactly one `isPrimary: true` |

**Invariant:** a non-empty `images[]` has exactly one `isPrimary`. Live data satisfies this (0 violations) because the path was barely exercised; now it is structurally guaranteed.

### 9.3 Orphan cleanup

Two directions, both real:

| Orphan | Cause | Detection | MVP handling |
|---|---|---|---|
| Cloudinary asset with no DB reference | Upload succeeded, DB write failed | Reconciliation job listing the `nest/` prefix against `mediaAssets` | **Manual admin report**, not automated deletion |
| DB reference with no Cloudinary asset | Deleted out-of-band | Same job, reverse direction | Report + admin resolution |

> **Deliberately not automated.** An automated deleter that misreads state destroys production assets irreversibly. A report an admin acts on is the right trade-off at 2 assets. Revisit above ~10,000 assets.

---

## 10. Other media surfaces

| Surface | Legacy | Decision |
|---|---|---|
| **Category images** | Free-text URL column, 7/27 populated | Managed asset via `MediaModule` |
| **Brand logos** | Free-text URL, **0/17 populated** | Managed asset, optional |
| **Blog covers** | Free-text URL, 6/6 populated | Managed asset |
| **User avatars** | Free-text URL, **0/4 populated**, bucket empty | **DEFERRED** — no upload UI ever existed and no requirement |
| **Review images** | Bucket + table, **0 rows** | **DEFERRED** with reviews |
| **Static assets** (`public/images/**`, 30+ hero/banner files) | Committed to the repo | **Stay in the repo.** Design assets, not catalogue content; versioning them with the code is correct. |
| **Dead `StorageService`** targeting bucket `images` | The bucket **does not exist** | **REMOVE the code** |

---

## 11. Data model summary

```jsonc
// Embedded in products, blogPosts, categories, brands
"images": [ { publicId, version, format, width, height, bytes,
              alt, sortOrder, isPrimary, uploadedAt, uploadedBy } ]

// Single-asset fields
"logo":  { publicId, version, format, width, height, bytes, alt } | null
"cover": { … } | null

// Bookkeeping collection
mediaAssets: { publicId (unique), refCount, bytes, format, createdAt }
```

Assets are **embedded**, not a separate collection: bounded (≤ 8), always loaded with the parent, never queried independently. `mediaAssets` exists solely for reference counting and orphan reconciliation.

---

## 12. Configuration

| Setting | Value |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | Public identifier |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | **Server-only.** Never `NEXT_PUBLIC_*`. |
| Upload preset | Signed, server-side, with a MIME/size backstop |
| `next.config.ts` `remotePatterns` | `res.cloudinary.com` only |
| `dangerouslyAllowSVG` | **Removed from both apps** |

---

## 13. Summary of decisions

| # | Decision | Fixes |
|---|---|---|
| 1 | **Client → NestJS → Cloudinary** | Guarantees validation and server-authored metadata |
| 2 | Store **`publicId` + `version`**, never a URL | Brittle URL-split deletion; CDN change = data migration |
| 3 | **Capture width/height** at upload | Layout shift on every grid |
| 4 | **Magic-byte sniffing** | Declared MIME was trusted |
| 5 | **SVG rejected**; `dangerouslyAllowSVG` removed | Stored-XSS vector |
| 6 | **EXIF stripped** | GPS/privacy leak |
| 7 | Preserve legacy size/MIME limits **in application config** | They survive the platform change |
| 8 | `<entityId>/` folders + `nanoid` | Ownership checks; unguessable URLs |
| 9 | **Named transformation presets** | No transformations existed at all |
| 10 | **Reference counting** on delete | Duplication made two products share one asset |
| 11 | Reorder and set-primary are **single atomic updates** | N+1 loop; non-atomic primary flip |
| 12 | Orphan reconciliation **reports**, does not auto-delete | Irreversible deletion risk |
| 13 | Avatars and review images **deferred** | Provisioned but never built |
| 14 | Migrate **2 files**; drop 20 `placehold.co` rows | Risk R5 downgraded to Low |
