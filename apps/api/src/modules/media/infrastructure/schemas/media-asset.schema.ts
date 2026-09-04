import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * The reference-counting ledger for stored media.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §9.1, §11.
 *
 * ## Why a collection exists at all, when images are embedded
 *
 * Image DESCRIPTORS are embedded in the products, blog posts, categories and
 * brands that use them — bounded, always loaded with the parent, never queried
 * on their own. This collection is not a second copy of them. It answers one
 * question the embedded copies cannot: **how many documents point at this
 * stored object?**
 *
 * That question has a real, observed answer. Legacy product duplication copied
 * the URL STRING, so two products ended up sharing one storage object; deleting
 * the image from either destroyed it for both, and the surviving product
 * rendered a broken image with no indication of why (Phase 0 W4). Counting
 * references makes that impossible: destruction happens at zero and nowhere
 * else.
 *
 * It stayed untriggered until Phase 7: nothing attached an image, so nothing
 * retained one, and every count sat at zero — which is the exact condition
 * under which destruction is allowed. The attach and detach endpoints now
 * maintain it, and the guarantee is asserted directly: an asset a live product
 * page is showing is refused deletion, and one that two products share survives
 * either of them letting go. That second case is W4 in its original form.
 *
 * ## What it is NOT
 *
 * Not a media library, not a browsable asset list, and not the authority for
 * anything a page renders. `alt`, `sortOrder` and `isPrimary` are properties of
 * a USE of an asset, not of the asset, so they live with the use. Putting them
 * here would mean two products sharing an image could not caption it
 * differently.
 */
@Schema({
  collection: 'mediaAssets',
  timestamps: { createdAt: true, updatedAt: false },
  strict: 'throw',
  versionKey: false,
})
export class MediaAsset {
  /**
   * The provider-relative identifier — never a URL (ADR-MEDIA-002).
   *
   * Unique, because it is the identity of the stored object. Two ledger rows
   * for one asset would mean two independent counts, and destruction at "zero"
   * would fire while the other row still held a reference.
   */
  @Prop({ type: String, required: true })
  publicId!: string;

  /**
   * How many documents currently embed a descriptor for this asset.
   *
   * Zero is a legitimate, expected state: an upload that has not been attached
   * to anything yet. It is also the ONLY state from which destruction is
   * allowed, which makes "is this safe to delete?" a read rather than a scan of
   * every collection that might embed images.
   */
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  refCount!: number;

  /**
   * The store's version for this object, as it reported at upload.
   *
   * ## Why the LEDGER carries it, when the ledger is about counting
   *
   * Because it is what makes attaching an image take nothing from the client
   * but a `publicId`. MEDIA-MODEL.md §4 says the browser is never the authority
   * for media metadata — and every other field a `ProductImage` needs is
   * already here, so without `version` the one remaining field would have to be
   * accepted from the caller, and a caller that can set the version can point a
   * product's image URL at a cached generation that no longer exists.
   *
   * Defaulted rather than strictly required so that a ledger row written before
   * this field existed still loads. `1` is what Cloudinary reports for a first
   * upload, so the default is the truthful value for exactly the rows that
   * predate it.
   */
  @Prop({ type: Number, required: true, default: 1 })
  version!: number;

  @Prop({ type: Number, required: true })
  bytes!: number;

  @Prop({ type: String, required: true })
  format!: string;

  @Prop({ type: Number, required: true })
  width!: number;

  @Prop({ type: Number, required: true })
  height!: number;

  /**
   * The staff account that uploaded it (MEDIA-MODEL.md §4 — server-authored).
   *
   * Nullable so the ledger can also record assets adopted by reconciliation,
   * which have no uploader this system ever saw.
   */
  @Prop({ type: Types.ObjectId, default: null })
  uploadedBy!: Types.ObjectId | null;

  createdAt!: Date;
}

export type MediaAssetDocument = HydratedDocument<MediaAsset>;
export type MediaAssetLean = MediaAsset & { _id: Types.ObjectId };

export const MediaAssetSchema = SchemaFactory.createForClass(MediaAsset);

/**
 * Every lookup is by `publicId`, and it must be unique — see the class
 * docstring. Declared here rather than with `unique: true` on the `@Prop` so
 * the index has a NAME: an unnamed index is one nobody can talk about in an
 * incident, and `syncIndexes` compares by name.
 */
MediaAssetSchema.index({ publicId: 1 }, { unique: true, name: 'media_asset_public_id_unique' });

/**
 * The orphan-reconciliation query (§9.3): "assets nothing refers to, oldest
 * first". Partial, because rows with references are the overwhelming majority
 * and indexing them would be paying for the case that is never queried.
 */
MediaAssetSchema.index(
  { createdAt: 1 },
  {
    name: 'media_asset_unreferenced',
    partialFilterExpression: { refCount: { $lte: 0 } },
  },
);
