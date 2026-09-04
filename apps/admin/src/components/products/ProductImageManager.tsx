'use client';

import { useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { useToast } from '@nest/ui';
import {
  uploadProductImageAction,
  detachProductImageAction,
  arrangeProductImagesAction,
} from '@/actions/product-image.actions';
import { imageUrl, CDN_CONFIGURED } from '@/lib/images';
import type { AdminProduct, AdminProductImage } from '@/lib/api/types';
import {
  Upload, X, Star, Loader2, ImageOff, AlertTriangle, ArrowLeft, ArrowRight, Info,
} from 'lucide-react';

/**
 * The image manager, on the API's media pipeline.
 *
 * ## What it replaces
 *
 * `ProductImageUpload`, which posted files to Supabase Storage and wrote rows
 * into `product_images` — a table nothing reads any more. It also did its own
 * client-side "validation" before the upload, which is a courtesy at best:
 * anything not going through that component skipped it entirely.
 *
 * ## The server sees every byte, and the client is never the authority
 *
 * Size, MIME allow-list, magic-byte sniffing, decode, EXIF strip, long-edge
 * cap, real dimensions — all server-side (ADR-MEDIA-001). This component checks
 * nothing about the file except that one was chosen, and shows what the server
 * says. The two limits printed below the drop zone are stated so an operator is
 * not surprised, not to gate anything.
 *
 * ## Uploading is not attaching
 *
 * A fresh asset sits at `refCount: 0` until the product retains it, and
 * `refCount === 0` is exactly the state from which `DELETE /admin/media`
 * destroys the object. So "add image" is two calls, in that order, and the
 * failure between them leaves an unreferenced orphan the reconciliation report
 * lists — the safe direction.
 *
 * ## MAX_IMAGES is not enforced here
 *
 * It is the API's rule (CATALOG-MODEL.md §8) and is stated here so an operator
 * knows before choosing eleven files. Legacy "enforced" 8 client-side, which is
 * to say it did not enforce it.
 *
 * ## Removing an image never destroys it
 *
 * Detach releases a reference. If another product shows the same asset, its
 * count stays above zero and it remains undeletable — legacy defect W4, where
 * two products shared one object and deleting from either broke the other.
 */

const MAX_IMAGES = 8;
const MAX_MB = 5;

export function ProductImageManager({ product }: { product: AdminProduct }) {
  const { addToast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [isBusy, startBusy] = useTransition();
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  /*
   * The product prop IS the state. Every mutation returns the whole product
   * from the API and the page re-reads; nothing here keeps a local copy of the
   * array to drift from it. That is what makes "the order on screen" and "the
   * order stored" the same fact.
   */
  const images = [...product.images].sort((a, b) => a.sortOrder - b.sortOrder);
  const atLimit = images.length >= MAX_IMAGES;

  const upload = (files: FileList | null) => {
    if (files === null || files.length === 0) return;

    if (atLimit) {
      addToast(`A product may have at most ${String(MAX_IMAGES)} images.`, 'error');
      return;
    }

    /*
     * One at a time, deliberately. The endpoint stores one asset per call, and
     * a parallel batch that half-succeeds is a partial-failure story with no
     * correct answer — the operator would be told "3 of 5 uploaded" and have to
     * work out which two.
     */
    const queue = Array.from(files).slice(0, MAX_IMAGES - images.length);

    startBusy(async () => {
      for (const file of queue) {
        setUploadingName(file.name);

        const form = new FormData();
        form.set('file', file);

        const result = await uploadProductImageAction(product.id, form);

        if (!result.ok) {
          addToast(result.error ?? `${file.name} was not uploaded.`, 'error');
          break;
        }
      }

      setUploadingName(null);
    });
  };

  const detach = (image: AdminProductImage) => {
    startBusy(async () => {
      const result = await detachProductImageAction(product.id, image.publicId);

      if (!result.ok) {
        addToast(result.error ?? 'The image was not removed.', 'error');
        return;
      }

      addToast('Image removed. The file itself is kept.', 'success');
    });
  };

  /** One arrange call carrying the whole array — order, captions and the primary flag. */
  const arrange = (next: AdminProductImage[], message: string) => {
    startBusy(async () => {
      const result = await arrangeProductImagesAction(
        product.id,
        next.map((image) => ({
          publicId: image.publicId,
          alt: image.alt,
          isPrimary: image.isPrimary,
        })),
      );

      if (!result.ok) {
        addToast(result.error ?? 'The change was not applied.', 'error');
        return;
      }

      addToast(message, 'success');
    });
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;

    const next = [...images];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved as AdminProductImage);
    arrange(next, 'Order saved');
  };

  const makePrimary = (publicId: string) => {
    arrange(
      images.map((image) => ({ ...image, isPrimary: image.publicId === publicId })),
      'Primary image set',
    );
  };

  const setAlt = (publicId: string, alt: string) => {
    const current = images.find((image) => image.publicId === publicId);
    if (current === undefined || (current.alt ?? '') === alt) return;

    arrange(
      images.map((image) => (image.publicId === publicId ? { ...image, alt } : image)),
      'Caption saved',
    );
  };

  return (
    <div className="space-y-4">
      {!CDN_CONFIGURED && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="text-foreground">
            {/*
              An absence with a cause, said plainly. The upload works; only the
              preview cannot be rendered, because the delivery URL is derived
              from a cloud name that is not configured.
            */}
            No image CDN is configured, so previews cannot be rendered here.{' '}
            <span className="text-muted-foreground">
              Uploading still works and the files are stored — the storefront will show them once{' '}
              <span className="font-mono">NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME</span> is set.
            </span>
          </span>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          upload(event.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragActive ? 'border-primary bg-primary/5' : 'border-border bg-background'
        } ${atLimit ? 'opacity-60' : ''}`}
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(event) => {
            upload(event.target.files);
            event.target.value = '';
          }}
        />

        {isBusy && uploadingName !== null ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-xs font-semibold text-foreground">Uploading {uploadingName}</p>
            <p className="text-[10px] text-muted-foreground">
              The server is checking, stripping metadata and resizing it.
            </p>
          </div>
        ) : (
          <>
            <Upload className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <button
              type="button"
              disabled={atLimit || isBusy}
              onClick={() => fileInput.current?.click()}
              className="text-sm font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            >
              {atLimit ? `Limit of ${String(MAX_IMAGES)} images reached` : 'Choose images'}
            </button>
            <p className="mt-1 text-[11px] text-muted-foreground">
              or drop them here — JPEG, PNG or WebP, up to {MAX_MB} MB each, {images.length} of{' '}
              {MAX_IMAGES} used
            </p>
          </>
        )}
      </div>

      {/* Tiles */}
      {images.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          No images yet. The first one added becomes the primary.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image, index) => {
            const src = imageUrl(image, 'tile');

            return (
              <div
                key={image.publicId}
                className={`overflow-hidden rounded-xl border bg-background ${
                  image.isPrimary ? 'border-primary ring-1 ring-primary/30' : 'border-border'
                }`}
              >
                <div className="relative aspect-square bg-muted">
                  {src !== null ? (
                    <Image
                      src={src}
                      alt={image.alt ?? ''}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 50vw, 200px"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground/50">
                      <ImageOff className="h-5 w-5" />
                      <span className="px-2 text-center text-[10px] leading-tight">
                        {image.width}×{image.height} {image.format}
                      </span>
                    </div>
                  )}

                  {image.isPrimary && (
                    <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-primary px-1.5 py-[2px] text-[10px] font-bold text-primary-foreground">
                      <Star className="h-2.5 w-2.5 fill-current" />
                      Primary
                    </span>
                  )}

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => detach(image)}
                    aria-label="Remove image"
                    title="Remove from this product. The file itself is kept."
                    className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white transition-colors hover:bg-destructive disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                <div className="space-y-2 p-2">
                  <input
                    defaultValue={image.alt ?? ''}
                    onBlur={(event) => setAlt(image.publicId, event.target.value.trim())}
                    placeholder="Describe the image"
                    maxLength={200}
                    className="h-8 w-full rounded-md border border-border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/10"
                  />

                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        disabled={isBusy || index === 0}
                        onClick={() => move(index, -1)}
                        aria-label="Move earlier"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowLeft className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || index === images.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label="Move later"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>

                    {!image.isPrimary && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => makePrimary(image.publicId)}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        <Star className="h-2.5 w-2.5" />
                        Make primary
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        {/*
          The one thing an operator would otherwise learn the hard way: removing
          an image here does not free the file, and a file two products share is
          not destroyed when one of them lets go.
        */}
        Removing an image detaches it from this product; the file is kept and can be reused. A file
        another product also uses is never destroyed when this one lets go. Captions and order save
        as you change them.
      </p>
    </div>
  );
}
