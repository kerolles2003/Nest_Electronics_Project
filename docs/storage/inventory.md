# Supabase Storage Forensics — Phase 0.5

**Source:** live production project `quhllllvwwuizjfrxvdz`.
**Extraction:** 2026-08-29 via read-only queries against `storage.buckets`, `storage.objects` and `pg_policies`.
**No file was downloaded, uploaded, moved or deleted.**

---

## 1. Buckets (VERIFIED — 4 exist, not 1)

Phase 0 could only see bucket names referenced in code (`products` in live code, `images` in dead code). The live project has **four** buckets, and **`images` is not one of them**.

| Bucket | Public | Size limit | Allowed MIME types | Objects | Bytes | Created |
|---|---|---|---|---|---|---|
| **`products`** | ✅ **public** | 5 MB | `image/jpeg`, `image/png`, `image/webp` | **2** | 208,756 | 2026-04-29 |
| `avatars` | ✅ **public** | 2 MB | `image/jpeg`, `image/png`, `image/webp` | **0** | — | 2026-04-29 |
| `blog` | ✅ **public** | 5 MB | `image/jpeg`, `image/png`, `image/webp` | **0** | — | 2026-04-29 |
| `reviews` | ✅ **public** | 5 MB | `image/jpeg`, `image/png`, `image/webp` | **0** | — | 2026-04-29 |

**Total live storage: 2 objects, ~204 KB.**

### Resolutions of Phase 0 unknowns

| Phase 0 question | Answer |
|---|---|
| Which buckets exist? | `products`, `avatars`, `blog`, `reviews` |
| Does the `images` bucket (referenced by dead `StorageService`) exist? | **No.** `packages/services/src/storage.service.ts` targets a bucket that has never existed. Had it ever been called it would have failed. |
| Are the buckets public? | **All four are `public = true`** |
| Are there size/MIME limits? | **Yes — enforced at bucket level**, 5 MB (2 MB for avatars), and a 3-type image allow-list |

> The bucket-level MIME allow-list is a **second, server-side** enforcement layer that Phase 0 did not know about. It already blocks SVG at the platform level, independently of the application's `validate-upload.ts`.

---

## 2. Object naming & path structure (VERIFIED)

Both live objects are in `products`, `image/png`, and follow:

```
products/<productId-uuid>/<sanitised-filename>
```

Observed first path segments: `73ab6348-ea9a-4ebc-8550-5e1c6a280746`, `3b64d2b1-112c-4f6e-9554-4ebe90d2418c` — both valid UUIDs, matching `generateStoragePath(productId, name)` in `apps/admin/src/lib/upload/`.

**Confirmed:** the upload pipeline described in Phase 0 §9 W1 is exactly what produced these files. The `<productId>/` prefix is what makes the `Admin CRUD Access` policy and the delete-by-URL-split logic work at all.

### Object metadata available

`storage.objects.metadata` holds `size` and `mimetype`. It does **not** hold width/height — confirming Phase 0 **P16**: image dimensions are recorded nowhere, so `next/image` cannot avoid layout shift and duplicate detection is impossible.

---

## 3. Access control (VERIFIED)

Two layers apply, and they disagree in an important way.

### 3.1 Bucket-level: all four buckets are public

`public = true` means objects are served from `/storage/v1/object/public/<bucket>/<path>` **without consulting RLS**. Anyone with a URL can read any object in any of the four buckets.

### 3.2 RLS on `storage.objects` (governs the authenticated API path)

| Policy | Cmd | Roles | Expression |
|---|---|---|---|
| `Public Read Access` | SELECT | public | `bucket_id = 'products'` |
| `Admin Insert Products` | INSERT | public | `bucket_id='products' AND is_admin()` |
| `Admin Insert Blog` | INSERT | public | `bucket_id='blog' AND is_admin()` |
| `Users Insert Avatars` | INSERT | public | `bucket_id='avatars' AND auth.uid()::text = (storage.foldername(name))[1]` |
| `Users Insert Reviews` | INSERT | public | `bucket_id='reviews' AND auth.uid()::text = (storage.foldername(name))[1]` |
| `Admin CRUD Access` | ALL | authenticated | `bucket_id='products' AND EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND role IN ('admin','super_admin'))` |

**Findings:**

| ID | Sev | Finding |
|---|---|---|
| **S1** | 🟡 | **No DELETE policy exists for `avatars`, `blog` or `reviews`.** Users and admins can create objects in those buckets but can never remove them through the API. Only `products` has delete coverage (via `Admin CRUD Access`). |
| **S2** | 🟡 | `Admin CRUD Access` **re-implements `is_admin()` inline** instead of calling it — a duplicated definition of "who is an admin" that can drift from the function all 28 other policies use. |
| **S3** | 🟡 | Only `products` has a SELECT policy. Reads of `avatars`/`blog`/`reviews` work solely because those buckets are `public=true` and bypass RLS. If a bucket were ever flipped to private, those reads would break silently. |
| **S4** | 🔵 | The avatars/reviews policies correctly scope writes to `auth.uid()/...` folders — a sound ownership pattern that should be preserved conceptually in Cloudinary folder naming. |
| **S5** | 🔵 | `storage.protect_delete()` (BEFORE DELETE trigger) blocks **all** direct SQL deletion from `storage.objects`/`storage.buckets`. Any migration or cleanup script must use the Storage HTTP API. |

---

## 4. Application references (evidence-based)

| Reference | Bucket | Status |
|---|---|---|
| `apps/admin/src/actions/product.actions.ts:76,81,186,191` — `upload` + `getPublicUrl` | `products` | **Live** — produced both existing objects |
| `apps/admin/src/actions/product.actions.ts:272` — `remove`, path via URL string-split on `/products/` | `products` | Live, brittle (Phase 0 W2) |
| `packages/services/src/storage.service.ts` + `packages/providers/src/supabase/storage.provider.ts` | **`images`** | **Dead — and the bucket does not exist** |
| `categories.image_url`, `brands.logo_url`, `blog_posts.cover_image`, `profiles.avatar_url` | none | Free-text URL columns, no upload UI |

### Where product images actually point (VERIFIED)

| Destination | Rows | % |
|---|---|---|
| `placehold.co` (external placeholder) | **20** | 91% |
| `quhllllvwwuizjfrxvdz.supabase.co` (real Storage) | **2** | 9% |

Other media columns: `categories.image_url` populated on 7 of 27 rows (static paths / external), `blog_posts.cover_image` on 6 of 6, **`brands.logo_url` on 0 of 17**, **`profiles.avatar_url` on 0 of 4**.

**Signed URLs are not used anywhere.** Every reference is a public URL. Consistent with all four buckets being public.

---

## 5. Per-bucket migration assessment

### `products`
| | |
|---|---|
| **Purpose** | Admin-uploaded product gallery images |
| **Public/Private** | Public |
| **Application usage** | The only bucket the application actually writes to |
| **Access rules** | Public read; insert/update/delete restricted to `admin`/`super_admin` |
| **Migration complexity** | **Trivial** — 2 files, 204 KB |
| **Cloudinary recommendation** | `nest/products/<productId>/<slug>-<nanoid>`. Upload the 2 real files via Cloudinary remote-fetch. **Do not migrate the 20 `placehold.co` rows** — drop them and leave those products image-less, or replace as a content task. Capture `width`/`height`/`bytes`/`format` at upload (first time these will exist). Named transformations `t_product_card` (400×400), `t_product_detail` (1000×1000), `t_thumb` (96×96). |

### `avatars`
| | |
|---|---|
| **Purpose** | User profile pictures |
| **Public/Private** | Public |
| **Application usage** | **None.** No upload UI exists; 0 objects; `profiles.avatar_url` NULL on all 4 rows |
| **Access rules** | Insert scoped to own `auth.uid()` folder; **no delete policy**; no select policy |
| **Migration complexity** | **None — nothing to migrate** |
| **Cloudinary recommendation** | Create `nest/avatars/<userId>` **only if** avatar upload is a real requirement. Otherwise drop the bucket and the column. Preserve the owner-folder ownership rule. |

### `blog`
| | |
|---|---|
| **Purpose** | Blog cover images |
| **Application usage** | **None.** 0 objects; the 6 `cover_image` values point elsewhere; no authoring UI exists |
| **Access rules** | Admin insert only; **no delete policy**; no select policy |
| **Migration complexity** | **None — nothing to migrate** |
| **Cloudinary recommendation** | `nest/blog/<postId>`, to be built alongside the blog-authoring UI that Phase 0 identified as missing. |

### `reviews`
| | |
|---|---|
| **Purpose** | Customer review photos |
| **Application usage** | **None.** 0 objects; `review_images` table empty; no storefront review submission exists |
| **Access rules** | Insert scoped to own `auth.uid()` folder; **no delete policy**; no select policy |
| **Migration complexity** | **None — nothing to migrate** |
| **Cloudinary recommendation** | `nest/reviews/<reviewId>` only if review submission is built (Phase 0 open question 11). Moderation must gate publication. |

---

## 6. Consolidated storage findings

| ID | Sev | Finding |
|---|---|---|
| **S6** | 🔵 | **Storage migration is effectively a non-event: 2 files, 204 KB.** Phase 0 R5 ("image migration breaks product galleries", High/Medium) should be **downgraded to Low**. |
| **S7** | 🟠 | 91% of `product_images` rows are `placehold.co` placeholders. The catalogue is not backed by real assets, and 74% of products have no image row at all. This is a **content problem**, not a migration problem — but it must not be mistaken for a migration regression. |
| **S8** | 🔵 | Bucket-level MIME allow-lists already block SVG server-side. Phase 0 **M3** (`dangerouslyAllowSVG: true`) remains valid for *rendering* arbitrary external URLs (`placehold.co` is whitelisted), but uploads were never a viable SVG vector. |
| **S9** | 🟡 | Three of four buckets are configured, policied and entirely unused — features that were provisioned but never built. |
| **S10** | 🟡 | No object carries width/height metadata (Phase 0 P16 confirmed). Cloudinary migration is the opportunity to capture it for the first time. |
| **S11** | 🔵 | The dead `StorageService` targets bucket `images`, which **does not exist**. Delete the code rather than porting it (already Phase 0 §25.C item 5). |

---

## 7. Target model (recommendation only — nothing executed)

```
Client (Next.js / Flutter)
   │  multipart  OR  signed-params request
   ▼
NestJS UploadsModule
   ├─ JwtAuthGuard + RolesGuard          (replaces the storage RLS policies)
   ├─ MIME allow-list  (port the bucket-level list: jpeg/png/webp)
   ├─ size limit       (port: 5 MB, 2 MB avatars)
   ├─ magic-byte sniffing (file-type)    — NEW; neither layer does this today
   ├─ sharp: strip EXIF, cap dimensions, capture width/height
   ▼
Cloudinary  folder: nest/<entity>/<entityId>
   ▼
MongoDB: { publicId, version, format, width, height, bytes,
           alt, sortOrder, isPrimary, uploadedAt, uploadedBy }
```

Carry forward deliberately:

1. **`<entityId>/` path prefix** — already the live convention; keeps ownership checks simple.
2. **Owner-folder write scoping** for avatars/reviews (`auth.uid()` → JWT subject).
3. **Bucket MIME + size limits** — move into `UploadsModule` config so they survive the platform change.
4. **Store `publicId` + `version`, never a full URL** (Phase 0 §9.3) — fixes the brittle URL-split delete (W2) and makes CDN migration a config change.
5. **Add a DELETE path for every bucket** — S1 shows three of four have none today.
6. **Refcount duplicated images** — Phase 0 W4: product duplication copies URL strings, so two products share one object. Untriggered today (2 objects), but the defect is real.
