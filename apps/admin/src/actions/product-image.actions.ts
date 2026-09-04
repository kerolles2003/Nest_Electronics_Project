'use server';

import { revalidatePath } from 'next/cache';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { requireAdminActor } from '@/lib/api/identity';
import type { AdminProduct } from '@/lib/api/types';

/**
 * Product images: upload, attach, detach, arrange.
 *
 * ## Two calls, not one, and the order is the whole design
 *
 * Adding an image is `POST /admin/media` and then
 * `POST /admin/catalog/products/:id/images`. They are separate because they do
 * different things: the first puts bytes in the store and opens a ledger row at
 * `refCount: 0`; the second is what RETAINS that asset for this product.
 *
 * Reference counting is not bookkeeping. `refCount === 0` is the exact
 * condition under which `DELETE /admin/media` destroys the object and the
 * reconciliation report offers it for cleanup — so an asset attached without
 * being retained is a photograph a live product page is showing, waiting to be
 * deleted by a tool doing its job. That is legacy defect W4.
 *
 * If the attach fails after the upload succeeded, what is left is an asset at
 * zero references that nothing points at: an ordinary orphan, which the
 * reconciliation report lists and an operator can destroy. That is the SAFE
 * direction of failure, and it is why these are ordered this way rather than
 * the other.
 *
 * ## Nothing here validates the file
 *
 * The API sees every byte: the size limit, the MIME allow-list, magic-byte
 * sniffing, the decode, the EXIF strip, the long-edge cap and the real
 * dimensions. `lib/upload/validate-upload.ts` used to do a client-side version
 * of some of that before a Supabase Storage upload, which is a courtesy at
 * best — a caller that skipped the console skipped the check. The browser is
 * never the authority for media, so this module forwards bytes and reports what
 * the server says about them.
 *
 * ## And nothing here destroys anything
 *
 * Detach RELEASES a reference; it never deletes the asset. One that falls to
 * zero is a CANDIDATE for cleanup, reported by reconciliation — MEDIA-MODEL.md
 * §9 is explicit that reconciliation reports rather than deletes, because an
 * automated deleter that misreads state destroys production assets
 * irreversibly. And the same asset may still be attached to another product.
 */

export interface ImageActionResult {
  ok: boolean;
  error?: string;
  product?: AdminProduct;
}

function revalidateProduct(productId: string): void {
  revalidatePath(`/products/${productId}/edit`);
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath('/products');
  revalidatePath('/admin/products');
}

/**
 * Uploads one file and attaches it to the product.
 *
 * One operator action, two API calls. The `alt` is optional and is the only
 * thing besides the bytes that the caller contributes: width, height, format,
 * bytes and version all come from the ledger server-side, because a client that
 * could supply dimensions could make a product page reserve the wrong space,
 * and one that could supply a version could point the URL at a generation the
 * CDN has replaced.
 */
export async function uploadProductImageAction(
  productId: string,
  form: FormData,
): Promise<ImageActionResult> {
  await requireAdminActor();

  const file = form.get('file');

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose an image file to upload.' };
  }

  const alt = typeof form.get('alt') === 'string' ? (form.get('alt') as string).trim() : '';

  /*
   * A fresh FormData rather than forwarding the one that arrived. The API's
   * DTO is strict — `entity`, `entityId`, `file` and nothing else — so passing
   * an `alt` field through to the upload would be a 400 UNKNOWN_FIELD. The alt
   * belongs to the ATTACH, which is where it is sent.
   */
  const upload = new FormData();
  upload.set('file', file);
  upload.set('entity', 'products');
  upload.set('entityId', productId);

  const stored = await tryApi(() => api.uploadMedia(upload));

  if (!stored.ok) return { ok: false, error: operatorMessage(stored.error) };

  const attached = await tryApi(() =>
    api.attachProductImage(productId, {
      publicId: stored.data.data.publicId,
      ...(alt === '' ? {} : { alt }),
    }),
  );

  if (!attached.ok) {
    /*
     * The bytes are stored and nothing references them. Deliberately NOT
     * cleaned up here: destroying an asset because one request failed is how an
     * automated deleter that misreads state loses a photograph. It is at
     * `refCount: 0`, so `GET /admin/media/reconciliation` lists it and an
     * operator decides — which is the trade MEDIA-MODEL.md §9.3 makes on
     * purpose.
     */
    return {
      ok: false,
      error: `${operatorMessage(attached.error)} The file was uploaded but not attached; it will appear in the media reconciliation report.`,
    };
  }

  revalidateProduct(productId);

  return { ok: true, product: attached.data.data };
}

/**
 * Removes an image from the product and releases its reference.
 *
 * The asset survives. If another product shows it, its count is still above
 * zero and it stays undeletable — which is the entire point of the ledger, and
 * the legacy defect W4 in its original form: two products sharing one storage
 * object, and deleting from either broke the other.
 */
export async function detachProductImageAction(
  productId: string,
  publicId: string,
): Promise<ImageActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.detachProductImage(productId, publicId));

  if (!res.ok) return { ok: false, error: operatorMessage(res.error) };

  revalidateProduct(productId);

  return { ok: true, product: res.data.data };
}

/**
 * Reorders, re-captions and re-primaries in ONE write.
 *
 * This is where legacy defects K9 and K10 died. Reordering was an update per
 * image, so an interrupted reorder left an order that was neither the old one
 * nor the new; "make this primary" was unset-then-set, so an interruption
 * between them left a product with NO primary and every grid rendering a
 * placeholder for it. The API writes the whole array in one `$set`, and the
 * request must name exactly the images the product already has — which is what
 * keeps this operation incapable of moving a reference count.
 */
export async function arrangeProductImagesAction(
  productId: string,
  images: { publicId: string; alt?: string | null; isPrimary?: boolean }[],
): Promise<ImageActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.arrangeProductImages(productId, images));

  if (!res.ok) return { ok: false, error: operatorMessage(res.error) };

  revalidateProduct(productId);

  return { ok: true, product: res.data.data };
}
