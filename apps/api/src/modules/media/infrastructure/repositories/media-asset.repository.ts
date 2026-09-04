import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MediaAsset, type MediaAssetLean } from '../schemas/media-asset.schema';

/**
 * The reference-count ledger, and nothing else.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §9.1.
 *
 * Every method here is a SINGLE atomic statement. That is not stylistic: a
 * reference count updated by read-then-write loses increments under
 * concurrency, and the concurrency here is real — two operators attaching the
 * same duplicated product's images at the same time is exactly the scenario the
 * ledger exists for. `$inc` is atomic in the server; a `find` followed by a
 * `save` is not.
 */
@Injectable()
export class MediaAssetRepository {
  constructor(@InjectModel(MediaAsset.name) private readonly assets: Model<MediaAsset>) {}

  /**
   * Records a newly stored asset with no references yet.
   *
   * Upsert rather than insert, and deliberately so: a retried upload that
   * already reached the store must not fail here with a duplicate key. The
   * `$setOnInsert` on `refCount` is what makes the retry safe — re-running this
   * for an asset that has since been attached to three products must not reset
   * its count to zero.
   */
  async record(asset: {
    publicId: string;
    version: number;
    bytes: number;
    format: string;
    width: number;
    height: number;
    uploadedBy: Types.ObjectId | null;
  }): Promise<void> {
    await this.assets
      .updateOne(
        { publicId: asset.publicId },
        {
          $set: {
            // `version` is in the $set rather than the $setOnInsert: a re-upload
            // to the same id bumps it, and a ledger holding the old one would
            // hand every page a URL for a generation the CDN has replaced.
            version: asset.version,
            bytes: asset.bytes,
            format: asset.format,
            width: asset.width,
            height: asset.height,
          },
          $setOnInsert: { publicId: asset.publicId, refCount: 0, uploadedBy: asset.uploadedBy },
        },
        { upsert: true },
      )
      .exec();
  }

  find(publicId: string): Promise<MediaAssetLean | null> {
    return this.assets.findOne({ publicId }).lean<MediaAssetLean>().exec();
  }

  /** One atomic `$inc`. Returns the count AFTER the change. */
  async retain(publicId: string): Promise<number> {
    const updated = await this.assets
      .findOneAndUpdate({ publicId }, { $inc: { refCount: 1 } }, { new: true })
      .lean<MediaAssetLean>()
      .exec();

    if (updated === null) throw new Error(`media asset ${publicId} is not in the ledger`);

    return updated.refCount;
  }

  /**
   * One atomic `$inc`, floored at zero by the filter rather than by a check.
   *
   * `refCount: { $gt: 0 }` in the FILTER means an over-release matches nothing
   * and changes nothing, instead of driving the count negative and making a
   * later `=== 0` test — the test that authorises destruction — unreachable. A
   * negative reference count is the one state from which the ledger can never
   * recover on its own.
   */
  async release(publicId: string): Promise<number> {
    const updated = await this.assets
      .findOneAndUpdate({ publicId, refCount: { $gt: 0 } }, { $inc: { refCount: -1 } }, { new: true })
      .lean<MediaAssetLean>()
      .exec();

    if (updated !== null) return updated.refCount;

    // Either the row is gone or it was already at zero. Both are "no references
    // remain", which is what the caller asked about.
    const current = await this.find(publicId);
    return current?.refCount ?? 0;
  }

  /** Removes the ledger row. Called only after the store confirms destruction. */
  async forget(publicId: string): Promise<void> {
    await this.assets.deleteOne({ publicId }).exec();
  }

  /**
   * Assets nothing refers to, oldest first — the DB half of the orphan report.
   *
   * Bounded, because a reconciliation report is read by a person: an unbounded
   * list of every unreferenced asset in a large account is not a report, it is
   * a dump.
   */
  unreferenced(limit: number): Promise<MediaAssetLean[]> {
    return this.assets
      .find({ refCount: { $lte: 0 } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean<MediaAssetLean[]>()
      .exec();
  }

  /** Every `publicId` the ledger knows, for comparison against the store. */
  async knownPublicIds(): Promise<Set<string>> {
    const rows = await this.assets.find({}, { publicId: 1 }).lean<{ publicId: string }[]>().exec();

    return new Set(rows.map((row) => row.publicId));
  }
}
