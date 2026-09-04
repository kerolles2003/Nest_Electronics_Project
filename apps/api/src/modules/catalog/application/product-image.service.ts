import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import { AuditService, type AuditContext } from '../../audit/application/audit.service';
import { AuditAction, AuditEntityType } from '../../audit/domain/audit-action';
import { toAuditActor } from '../../audit/domain/audit-actor';
import { MediaService } from '../../media/application/media.service';
import { MediaAssetRepository } from '../../media/infrastructure/repositories/media-asset.repository';
import { UsersService, type UserProfile } from '../../users/application/users.service';
import { Product, type ProductLean } from '../infrastructure/schemas/product.schema';

/**
 * The bound from CATALOG-MODEL.md §8.
 *
 * The array is EMBEDDED, so it is loaded with the product on every read; the
 * bound is what keeps that affordable. Legacy already enforced 8 client-side,
 * which is to say it did not enforce it.
 */
export const MAX_PRODUCT_IMAGES = 8;

export interface AdminWriteContext {
  readonly actorId: Types.ObjectId;
  readonly forensics: AuditContext;
}

/** One entry of a reorder request. */
export interface ArrangeEntry {
  readonly publicId: string;
  readonly alt?: string | null;
  readonly isPrimary?: boolean;
}

/**
 * Attaching, detaching and arranging a product's images.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §8; MEDIA-MODEL.md §9.1.
 *
 * ## This is the first thing that has ever called `retain()`
 *
 * `MediaService.retain` and `release` were built in Phase 4 with the ledger and
 * have had **no caller since**. The count therefore sat at zero on every asset
 * in the system — harmless while nothing had an image, and a live defect the
 * moment something did, because `refCount === 0` is precisely the state from
 * which `DELETE /admin/media` destroys an object.
 *
 * So the guarantee this class exists to establish is not "images can be
 * attached". It is: **an asset a product is showing cannot be deleted.**
 *
 * ## Two legacy defects, both fixed by writing the whole array at once
 *
 * K9 — reordering was an N+1 update loop, one statement per image, so an
 * interrupted reorder left an order that was neither the old one nor the new.
 * K10 — "make this the primary" was two statements, unset then set, so an
 * interruption between them left a product with NO primary image and every
 * grid rendering a placeholder for it.
 *
 * Both disappear if the array is only ever written whole, in one `$set`. Every
 * method here does that, including attach and detach: the extra cost is
 * re-sending seven descriptors that did not change, and the benefit is that
 * there is no interleaving to reason about.
 *
 * ## Ordering: the document first, the ledger second
 *
 * `MediaService.retain`'s own contract — "called AFTER the referencing document
 * is written, never before". If the product write fails, the count stays at
 * zero and the asset is an ordinary unattached upload that reconciliation can
 * offer for cleanup. The reverse order would leave a count nothing references
 * and nothing can ever delete.
 *
 * The residual window is the opposite one: the product write lands and the
 * `$inc` does not. That is one atomic statement against the same database in
 * the same request, so it fails only if the database has gone away between two
 * adjacent calls — in which case the count is one short and `reconcile()`
 * reports the asset as unreferenced while it is in use. It is recorded rather
 * than hidden; closing it properly means a transaction across `products` and
 * `mediaAssets`, which the ledger repository is not written for.
 */
@Injectable()
export class ProductImageService {
  private readonly logger = new Logger(ProductImageService.name);

  constructor(
    @InjectModel(Product.name) private readonly products: Model<Product>,
    private readonly media: MediaService,
    private readonly ledger: MediaAssetRepository,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Attaches an already-uploaded asset to a product.
   *
   * The client sends a `publicId` and, at most, an `alt`. **Every other field
   * comes from the ledger** — width, height, format, bytes and version — which
   * is MEDIA-MODEL.md §4's rule that the browser is never the authority for
   * media metadata. A client that could supply dimensions could make a product
   * page reserve the wrong space; one that could supply a version could point
   * the URL at a generation the CDN has replaced.
   */
  async attach(
    productId: Types.ObjectId,
    publicId: string,
    alt: string | null,
    context: AdminWriteContext,
  ): Promise<ProductLean> {
    const actor = await this.resolveActor(context.actorId);
    const product = await this.load(productId);

    if (product.images.length >= MAX_PRODUCT_IMAGES) {
      throw AppException.productImageLimit(MAX_PRODUCT_IMAGES);
    }

    if (product.images.some((image) => image.publicId === publicId)) {
      throw AppException.productImageAlreadyAttached();
    }

    const asset = await this.ledger.find(publicId);

    if (asset === null) {
      // Not in the ledger means it was never uploaded through this API — or it
      // was destroyed. Either way there is nothing to reference-count, and
      // attaching would put a descriptor on a product for an object the system
      // cannot manage.
      throw AppException.mediaAssetNotFound();
    }

    const images = [
      ...product.images,
      {
        publicId: asset.publicId,
        version: asset.version,
        format: asset.format,
        width: asset.width,
        height: asset.height,
        bytes: asset.bytes,
        alt,
        sortOrder: product.images.length,
        // The first image on a product is its primary. §8 requires exactly one
        // when the array is non-empty, and leaving the first upload
        // non-primary would mean every new product renders a placeholder until
        // somebody notices a radio button.
        isPrimary: product.images.length === 0,
      },
    ];

    const updated = await this.writeImages(productId, images);

    // AFTER the write. See the class docstring.
    const refCount = await this.media.retain(publicId);

    this.logger.log(
      `image attached  product=${productId.toHexString()}  publicId=${publicId}  refCount=${String(refCount)}`,
    );

    await this.audit.record({
      actor: toAuditActor(actor),
      action: AuditAction.PRODUCT_UPDATED,
      entity: { type: AuditEntityType.PRODUCT, id: productId, label: updated.sku },
      changes: {
        before: { imageCount: product.images.length },
        after: { imageCount: updated.images.length },
      },
      metadata: { attached: publicId, refCount },
      context: context.forensics,
    });

    return updated;
  }

  /**
   * Removes an image from a product and releases its reference.
   *
   * It never destroys anything. An asset that falls to zero references is a
   * CANDIDATE for cleanup, reported by `reconcile()` — MEDIA-MODEL.md §9 is
   * explicit that reconciliation reports rather than deletes, because an
   * automated deleter that misreads state destroys production assets
   * irreversibly. The same asset may still be attached to another product.
   */
  async detach(
    productId: Types.ObjectId,
    publicId: string,
    context: AdminWriteContext,
  ): Promise<ProductLean> {
    const actor = await this.resolveActor(context.actorId);
    const product = await this.load(productId);

    if (!product.images.some((image) => image.publicId === publicId)) {
      throw AppException.productImageNotFound();
    }

    const remaining = product.images
      .filter((image) => image.publicId !== publicId)
      .map((image, index) => ({ ...image, sortOrder: index }));

    /*
     * If the primary was the one removed, the first remaining image becomes
     * primary. §8's invariant is "exactly one when `images` is non-empty" —
     * leaving none would render a placeholder on every grid for a product that
     * has photographs, which is K10's symptom arrived at by a different route.
     */
    if (remaining.length > 0 && !remaining.some((image) => image.isPrimary)) {
      remaining[0] = { ...remaining[0], isPrimary: true } as (typeof remaining)[number];
    }

    const updated = await this.writeImages(productId, remaining);
    const refCount = await this.media.release(publicId);

    this.logger.log(
      `image detached  product=${productId.toHexString()}  publicId=${publicId}  refCount=${String(refCount)}`,
    );

    await this.audit.record({
      actor: toAuditActor(actor),
      action: AuditAction.PRODUCT_UPDATED,
      entity: { type: AuditEntityType.PRODUCT, id: productId, label: updated.sku },
      changes: {
        before: { imageCount: product.images.length },
        after: { imageCount: updated.images.length },
      },
      metadata: { detached: publicId, refCount },
      context: context.forensics,
    });

    return updated;
  }

  /**
   * Reorders, re-captions and re-primaries in ONE atomic write.
   *
   * The request must name exactly the images the product already has — no
   * additions, no removals. That restriction is what keeps this operation
   * incapable of changing a reference count: attach and detach are the only two
   * things that touch the ledger, so there is one place to be right about it
   * rather than three.
   *
   * Position in the array IS the order. `sortOrder` is assigned from the index
   * rather than accepted, because two entries a client numbered identically
   * would otherwise produce an order the database resolves arbitrarily.
   */
  async arrange(
    productId: Types.ObjectId,
    entries: readonly ArrangeEntry[],
    context: AdminWriteContext,
  ): Promise<ProductLean> {
    const actor = await this.resolveActor(context.actorId);
    const product = await this.load(productId);

    const existing = new Map(product.images.map((image) => [image.publicId, image]));

    if (entries.length !== existing.size) {
      throw AppException.validation([
        {
          field: 'images',
          message:
            `This product has ${String(existing.size)} image(s) and the request listed ` +
            `${String(entries.length)}. Arranging cannot add or remove — use the attach and ` +
            'detach endpoints, which are the only two that touch the reference count.',
          code: 'SET_MISMATCH',
        },
      ]);
    }

    const seen = new Set<string>();

    for (const entry of entries) {
      if (!existing.has(entry.publicId)) throw AppException.productImageNotFound();
      if (seen.has(entry.publicId)) {
        throw AppException.validation([
          {
            field: 'images',
            message: `${entry.publicId} appears more than once.`,
            code: 'DUPLICATE',
          },
        ]);
      }
      seen.add(entry.publicId);
    }

    const primaryCount = entries.filter((entry) => entry.isPrimary === true).length;

    if (primaryCount > 1) {
      throw AppException.validation([
        {
          field: 'images',
          message: 'Exactly one image may be the primary.',
          code: 'PRIMARY',
        },
      ]);
    }

    const images = entries.map((entry, index) => {
      const current = existing.get(entry.publicId) as NonNullable<ReturnType<typeof existing.get>>;

      return {
        ...current,
        alt: entry.alt === undefined ? current.alt : entry.alt,
        sortOrder: index,
        // No primary named? The first one is it. §8's invariant is not optional
        // and a client that omits the flag must not be able to produce a
        // product with none.
        isPrimary: primaryCount === 0 ? index === 0 : entry.isPrimary === true,
      };
    });

    const updated = await this.writeImages(productId, images);

    await this.audit.recordChange({
      actor: toAuditActor(actor),
      action: AuditAction.PRODUCT_UPDATED,
      entity: { type: AuditEntityType.PRODUCT, id: productId, label: updated.sku },
      before: { images: summarise(product) },
      after: { images: summarise(updated) },
      context: context.forensics,
    });

    return updated;
  }

  /**
   * Releases every image a product holds — the media half of a hard delete.
   *
   * Returns the `publicId`s that fell to zero references, which is the caller's
   * cue about what may now be destroyed. It does NOT destroy them itself:
   * deciding is the caller's business and §9's rule about reconciliation
   * reporting rather than deleting is easier to keep when only one place
   * destroys anything.
   */
  async releaseAll(product: ProductLean): Promise<readonly string[]> {
    const unreferenced: string[] = [];

    for (const image of product.images) {
      const refCount = await this.media.release(image.publicId);

      if (refCount === 0) unreferenced.push(image.publicId);
    }

    return unreferenced;
  }

  /**
   * The one write path for `images`, and deliberately the only one.
   *
   * Whole-array `$set`, always. K9 and K10 are both "the array was written in
   * pieces"; a codebase with one function that writes it whole cannot
   * reintroduce either.
   */
  private async writeImages(
    productId: Types.ObjectId,
    images: readonly object[],
  ): Promise<ProductLean> {
    const updated = await this.products
      .findOneAndUpdate({ _id: productId }, { $set: { images } }, { new: true })
      .lean<ProductLean>()
      .exec();

    if (updated === null) throw AppException.productNotFound();

    return updated;
  }

  private async load(productId: Types.ObjectId): Promise<ProductLean> {
    const product = await this.products.findById(productId).lean<ProductLean>().exec();

    if (product === null) throw AppException.productNotFound();
    if (product.deletedAt !== null) throw AppException.productDeleted();

    return product;
  }

  private async resolveActor(actorId: Types.ObjectId): Promise<UserProfile> {
    const profile = await this.users.findById(actorId);

    if (profile === null) throw AppException.accountDisabled();

    return profile;
  }
}

/** The order and the primary flag, which is all an arrange can change. */
function summarise(product: ProductLean): { publicId: string; isPrimary: boolean }[] {
  return product.images.map((image) => ({ publicId: image.publicId, isPrimary: image.isPrimary }));
}
