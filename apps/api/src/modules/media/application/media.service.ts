import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import { mediaConfig, type MediaConfig } from '../../../config/media.config';
import { MediaAssetRepository } from '../infrastructure/repositories/media-asset.repository';
import { sniffImageFormat, mimeTypeForFormat } from './image-format';
import { ImageProcessingError, processUploadedImage } from './image-processing';
import { MediaStoragePort, type StoredMediaAsset } from './ports/media-storage.port';

/**
 * The upload pipeline, in the order ADR-MEDIA-001 specifies it.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §2, §4, §5, §6, §9.
 *
 * ```
 * authorize (guard, before the body is parsed)
 *   ├─ size            declared, then actual
 *   ├─ declared MIME   allow-list
 *   ├─ MAGIC BYTES     the file is what it says it is
 *   ├─ sharp           orientation applied, EXIF stripped, long edge capped,
 *   │                  real dimensions read, bytes re-encoded
 *   ├─ publicId        server-generated; the original filename never travels
 *   ├─ store           upload, no overwrite
 *   └─ ledger          record with refCount 0
 * ```
 *
 * ## Why the order matters
 *
 * Each step is cheaper than the one after it and rejects a different lie. The
 * size check costs nothing and stops the largest waste. Sniffing costs a few
 * bytes of comparison and stops a file that is not an image before a decoder
 * touches it — which matters, because image decoders are the classic place for
 * a malicious file to find a memory bug. The decode is last among the checks
 * because it is the only expensive one.
 *
 * ## What this phase deliberately does NOT do
 *
 * Nothing here attaches an image to a product. Product CRUD is Phase 7, and
 * inventing a half-endpoint for it now would ship an untested write path
 * against a schema that phase may still change. What ships is the pipeline, the
 * ledger, and the invariant functions Phase 7 will call — all exercised by
 * tests, because with no catalogue and no admin UI, tests are the only thing
 * exercising them at all (Phase 4 risk note).
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly storage: MediaStoragePort,
    private readonly ledger: MediaAssetRepository,
    @Inject(mediaConfig.KEY) private readonly config: MediaConfig,
  ) {}

  /**
   * Validates, normalises, stores and records one image.
   *
   * `owner` names the entity the asset is FOR — `products/<id>`, `brands/<id>`
   * — and becomes the folder (MEDIA-MODEL.md §6). The `<entityId>/` prefix is
   * preserved from legacy because it makes ownership a property of the path: an
   * asset's location proves which entity it belongs to, and orphan detection is
   * a prefix scan rather than a join.
   */
  async upload(input: {
    readonly buffer: Buffer;
    readonly declaredMimeType: string;
    readonly owner: MediaOwner;
    readonly uploadedBy: Types.ObjectId | null;
  }): Promise<StoredMediaAsset> {
    const { buffer, declaredMimeType } = input;

    if (buffer.length === 0) {
      throw AppException.invalidUpload('the uploaded file is empty');
    }

    // Multer's own limit rejects most oversize uploads before they reach here.
    // This is not redundant: the limit belongs to the rule, not to the
    // framework wiring, and a future caller that does not go through that
    // interceptor must still be refused.
    if (buffer.length > this.config.maxBytes) {
      throw AppException.invalidUpload(
        `the file is ${describeBytes(buffer.length)}; the limit is ${describeBytes(this.config.maxBytes)}`,
      );
    }

    if (!(this.config.allowedMimeTypes as readonly string[]).includes(declaredMimeType)) {
      throw AppException.invalidUpload(
        `${declaredMimeType} is not an accepted image type — send ${this.config.allowedMimeTypes.join(', ')}`,
      );
    }

    const actualFormat = sniffImageFormat(buffer);

    if (actualFormat === null) {
      throw AppException.invalidUpload(
        'the file contents are not a JPEG, PNG or WebP image, whatever the request declared',
      );
    }

    // The declared type and the bytes must AGREE. Either alone is insufficient:
    // trusting the declaration is the legacy defect, and trusting only the
    // bytes would let a caller mislabel a file and have the server quietly
    // correct it — which hides a client bug rather than reporting it.
    if (mimeTypeForFormat(actualFormat) !== declaredMimeType) {
      throw AppException.invalidUpload(
        `the request declared ${declaredMimeType} but the file contents are ${actualFormat}`,
      );
    }

    let processed;
    try {
      processed = await processUploadedImage(buffer, {
        minEdge: this.config.minEdge,
        maxEdge: this.config.maxEdge,
      });
    } catch (error) {
      if (error instanceof ImageProcessingError) {
        throw AppException.invalidUpload(error.message);
      }
      throw error;
    }

    const publicId = this.publicIdFor(input.owner);

    const stored = await this.storage.upload({
      publicId,
      bytes: processed.bytes,
      format: processed.format,
    });

    // Ledger AFTER the store, never before. A row for an asset that does not
    // exist would make a later destroy fail forever and would report a phantom
    // in the orphan reconciliation; an asset with no row is a real orphan the
    // report is designed to find. Of the two failure modes, only the second is
    // recoverable.
    await this.ledger.record({
      publicId: stored.publicId,
      bytes: stored.bytes,
      format: stored.format,
      width: stored.width,
      height: stored.height,
      uploadedBy: input.uploadedBy,
    });

    this.logger.log(
      `media stored  publicId=${stored.publicId}  ${String(stored.width)}x${String(stored.height)}  ` +
        `${describeBytes(stored.bytes)}  from=${describeBytes(buffer.length)}`,
    );

    return stored;
  }

  /**
   * Destroys an asset — but only one nothing points at.
   *
   * The refusal is the feature. Legacy deletion destroyed the storage object
   * regardless of who else referenced it, which is how one product's edit broke
   * another product's page. Here the ledger is consulted first and a referenced
   * asset is refused with a count, so the operator learns *why* rather than
   * discovering the consequence later.
   */
  /**
   * Records that one more document now references this asset.
   *
   * ## Why this exists on the service rather than only on the repository
   *
   * Reference counting is the rule that makes `destroy` safe: an asset with
   * references is refused, which is the whole defence against deleting a
   * photograph a live product page is showing. Until now nothing in production
   * ever ATTACHED an image, so nothing ever retained one and the count sat at
   * zero everywhere — harmless while no product had an image, and a live defect
   * the moment one did.
   *
   * The catalogue import is the first real consumer. Phase 7's admin upload UI
   * is the second, and it needs exactly this.
   *
   * Called AFTER the referencing document is written, never before. If the
   * write fails, the count stays at zero and the asset is an ordinary
   * unreferenced upload the reconciliation report can offer for cleanup —
   * whereas a count incremented first would leave an asset nothing references
   * and nothing can delete.
   */
  async retain(publicId: string): Promise<number> {
    return this.ledger.retain(publicId);
  }

  /**
   * Records that one fewer document references this asset.
   *
   * The counterpart of `retain`, and the operation a Phase 7 "remove this
   * image" action performs. It never destroys anything: an asset that falls to
   * zero references is a candidate for cleanup, reported by
   * `reconcile()`, and MEDIA-MODEL.md §9 is explicit that reconciliation
   * reports rather than deletes.
   */
  async release(publicId: string): Promise<number> {
    return this.ledger.release(publicId);
  }

  async destroy(publicId: string): Promise<void> {
    const asset = await this.ledger.find(publicId);

    if (asset === null) {
      throw AppException.mediaAssetNotFound();
    }

    if (asset.refCount > 0) {
      throw AppException.mediaAssetInUse(asset.refCount);
    }

    // Store first, ledger second — the reverse of upload, and for the same
    // reason. If the store call fails the row survives and the operation can be
    // retried; if the row were removed first, a failed destroy would leave an
    // asset nothing knows about and nothing can ever reach.
    await this.storage.destroy(publicId);
    await this.ledger.forget(publicId);

    this.logger.log(`media destroyed  publicId=${publicId}`);
  }

  /**
   * The orphan reconciliation REPORT (MEDIA-MODEL.md §9.3).
   *
   * Both directions, and neither is acted upon:
   *
   *   inStoreOnly    an upload reached the store and the ledger write failed
   *   inLedgerOnly   an asset was destroyed out of band
   *
   * > "Deliberately not automated. An automated deleter that misreads state
   * > destroys production assets irreversibly."
   *
   * The `unreferenced` list is a third, softer category: nothing is wrong with
   * those, they are simply uploads nobody attached to anything, and they are
   * what an operator would actually clean up.
   */
  async reconcile(limit = 100): Promise<MediaReconciliation> {
    const [inStore, known, unreferenced] = await Promise.all([
      this.storage.list(this.config.folderRoot),
      this.ledger.knownPublicIds(),
      this.ledger.unreferenced(limit),
    ]);

    const storeSet = new Set(inStore);

    return {
      inStoreOnly: inStore.filter((publicId) => !known.has(publicId)).slice(0, limit),
      inLedgerOnly: [...known].filter((publicId) => !storeSet.has(publicId)).slice(0, limit),
      unreferenced: unreferenced.map((asset) => ({
        publicId: asset.publicId,
        bytes: asset.bytes,
        createdAt: asset.createdAt.toISOString(),
      })),
    };
  }

  /**
   * `nest/<entity>/<entityId>/<random>` (MEDIA-MODEL.md §6).
   *
   * ## Why the server generates this and the client never contributes to it
   *
   * The original filename never reaches storage. A filename is attacker-
   * controlled text that has historically been a path-traversal vector, an
   * encoding problem and a duplicate-key source all at once; none of those
   * questions has to be answered if the answer is simply not to use it.
   *
   * ## Why random rather than a slug or a counter
   *
   * A counter needs a lookup and races. A slug is guessable, and §7 is explicit
   * that all media is public: an unguessable id is what stops the images of an
   * unreleased product being enumerated by anyone who can guess a name. 12
   * random bytes is 96 bits — collision is not a scenario worth handling, which
   * is also why `overwrite: false` at the adapter turns the impossible case
   * into a loud failure rather than silent destruction.
   *
   * The extension is deliberately absent: Cloudinary derives delivery formats
   * from the stored object, and baking one into the id would make `f_auto`
   * (§8) argue with the identity.
   */
  private publicIdFor(owner: MediaOwner): string {
    const suffix = randomBytes(12).toString('base64url');

    return `${this.config.folderRoot}/${owner.entity}/${owner.entityId}/${suffix}`;
  }
}

/**
 * Which entity an asset belongs to.
 *
 * A closed set, not free text: `entity` becomes a path segment, and a path
 * segment a caller controls is a path-traversal question nobody needs to have.
 */
export const MEDIA_ENTITIES = ['products', 'categories', 'brands', 'blog'] as const;
export type MediaEntity = (typeof MEDIA_ENTITIES)[number];

export interface MediaOwner {
  readonly entity: MediaEntity;
  /** A 24-character ObjectId hex string, validated at the DTO. */
  readonly entityId: string;
}

export interface MediaReconciliation {
  /** In the store, absent from the ledger — an upload whose DB write failed. */
  readonly inStoreOnly: readonly string[];
  /** In the ledger, absent from the store — destroyed out of band. */
  readonly inLedgerOnly: readonly string[];
  /** Known to both, referenced by nothing — safe to destroy, if intended. */
  readonly unreferenced: readonly { publicId: string; bytes: number; createdAt: string }[];
}

/** Bytes as a person reads them, so a limit message is actionable. */
function describeBytes(value: number): string {
  return value < 1024 * 1024
    ? `${String(Math.round(value / 1024))} KB`
    : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
