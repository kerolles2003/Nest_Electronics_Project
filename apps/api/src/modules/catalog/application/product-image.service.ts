import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type ClientSession } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import { TransactionService } from '../../../database/transaction.service';
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
 * ## The document and the ledger commit TOGETHER
 *
 * Ordering used to be the whole of the argument here: write the product first,
 * `$inc` second, because a failed product write then leaves the count at zero
 * and the asset is an ordinary unattached upload. That reasoning is sound and
 * it closes one window while leaving the opposite one open — the product write
 * lands and the `$inc` does not, which leaves an asset a product REFERENCES
 * sitting at `refCount: 0`.
 *
 * That residual is not a smaller version of the same bug. It is **the original
 * defect**, reached by a different path: `refCount === 0` is the exact
 * condition under which `DELETE /admin/media` destroys the object and under
 * which `reconcile()` lists it as safe to clean up. Two adjacent statements
 * against a database that can go away between them is not a rare enough event
 * to trade an irreversible deletion against.
 *
 * The two directions are not symmetric, which is why only one of them was
 * worth a transaction:
 *
 *   detach  document written, `$inc` lost  →  count too HIGH  →  an asset
 *           nothing can delete. A leak. Recoverable by hand, visible in the
 *           report, harms nobody.
 *   attach  document written, `$inc` lost  →  count too LOW   →  a photograph
 *           a live product page is showing, deletable by a tool doing its job.
 *           Irreversible.
 *
 * So both now run inside ONE `TransactionService.run`, the way the order path
 * does: `products` and `mediaAssets` are collections in the same database on
 * the same connection, the session is threaded into every statement, and the
 * document and the count commit together or neither does. A reconciliation
 * report was the alternative and is the weaker answer — it DETECTS after the
 * fact, and what it would have detected is a deletion that already happened.
 *
 * The callback is RE-ENTRANT (`withTransaction` re-runs it after a transient
 * write conflict), so every read is inside it and no state survives an attempt.
 * Nothing external happens in there: the bytes were uploaded before this
 * endpoint was called and no store call is made here, so CONSISTENCY-MODEL.md
 * §7's "no external I/O in a transaction" holds without effort.
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
    private readonly transactions: TransactionService,
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

    /*
     * Everything that reads or writes is inside the session, INCLUDING the
     * loads. The image count validated below and the array the `$set` is built
     * from must come from the same snapshot the write lands on, or two
     * concurrent attaches can each read seven images and each write an eighth.
     */
    const { before, updated, refCount } = await this.transactions.run(async (session) => {
      const product = await this.load(productId, session);

      if (product.images.length >= MAX_PRODUCT_IMAGES) {
        throw AppException.productImageLimit(MAX_PRODUCT_IMAGES);
      }

      if (product.images.some((image) => image.publicId === publicId)) {
        throw AppException.productImageAlreadyAttached();
      }

      const asset = await this.ledger.find(publicId, session);

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

      const written = await this.writeImages(productId, images, session);

      /*
       * The document and the count, in ONE commit. If this throws — the ledger
       * row was destroyed by a concurrent operation, a write conflict, anything
       * — the `$set` above is rolled back with it, so the product never
       * references an asset the ledger has not counted.
       */
      const count = await this.media.retain(publicId, session);

      return { before: product, updated: written, refCount: count };
    });

    const product = before;

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

    const { before, updated, refCount } = await this.transactions.run(async (session) => {
      const product = await this.load(productId, session);

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

      const written = await this.writeImages(productId, remaining, session);

      /*
       * This direction already failed safe — a lost decrement leaves an asset
       * nothing can delete, which is a leak rather than a loss. It shares the
       * transaction anyway, because two paths through one pair of collections
       * with two different consistency stories is how the next person gets it
       * wrong.
       */
      const count = await this.media.release(publicId, session);

      return { before: product, updated: written, refCount: count };
    });

    const product = before;

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
    session?: ClientSession,
  ): Promise<ProductLean> {
    const updated = await this.products
      .findOneAndUpdate({ _id: productId }, { $set: { images } }, { new: true, session: session ?? null })
      .lean<ProductLean>()
      .exec();

    if (updated === null) throw AppException.productNotFound();

    return updated;
  }

  private async load(productId: Types.ObjectId, session?: ClientSession): Promise<ProductLean> {
    const product = await this.products
      .findById(productId)
      .session(session ?? null)
      .lean<ProductLean>()
      .exec();

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
