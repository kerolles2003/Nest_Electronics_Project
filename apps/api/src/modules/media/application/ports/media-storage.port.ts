/**
 * The media-storage boundary.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §4–§5;
 *            docs/architecture/MEDIA-MODEL.md §2 (ADR-MEDIA-001).
 *
 * An abstract CLASS rather than an interface, for the same reason as
 * `EmailSenderPort`: Nest resolves providers by runtime token, and an interface
 * disappears at compile time.
 *
 * ## What crosses this boundary, and what deliberately does not
 *
 * The port receives bytes that are **already validated and already normalised**
 * — checked against the MIME allow-list, sniffed for magic bytes, stripped of
 * EXIF, downscaled — and a `publicId` the application has already chosen. That
 * split is the whole point of ADR-MEDIA-001: the server sees every byte, so
 * validation is guaranteed rather than delegated to whatever the vendor happens
 * to enforce. An adapter that skipped a check could not make the system less
 * safe, because no adapter is asked to perform one.
 *
 * Nothing below this line knows what a product is. Nothing above it knows what
 * an `upload_stream` call looks like.
 */
export abstract class MediaStoragePort {
  /**
   * Stores bytes at `publicId` and reports what was actually stored.
   *
   * MUST NOT overwrite. A `publicId` collision is a bug — they carry a random
   * suffix precisely so collisions cannot happen — and silently replacing
   * somebody else's asset is the worst available response to one.
   */
  abstract upload(request: MediaUploadRequest): Promise<StoredMediaAsset>;

  /**
   * Permanently destroys the asset.
   *
   * Idempotent by contract: destroying something already gone is a success, not
   * an error, because the caller's intent — "this must not exist" — is
   * satisfied either way, and because a retry after a partial failure must be
   * safe.
   */
  abstract destroy(publicId: string): Promise<void>;

  /**
   * Every `publicId` the store holds under a prefix.
   *
   * Exists for orphan reconciliation (MEDIA-MODEL.md §9.3) and for nothing
   * else. It REPORTS; it never deletes. An automated deleter that misreads
   * state destroys production assets irreversibly, which is why the frozen
   * design stops at a report an admin acts on.
   */
  abstract list(prefix: string): Promise<readonly string[]>;
}

/**
 * Validated, normalised bytes and the identity the application chose for them.
 *
 * `publicId` is supplied by the application rather than derived by the adapter
 * so that the folder convention (MEDIA-MODEL.md §6) is one rule in one place
 * rather than a rule each adapter reimplements.
 */
export interface MediaUploadRequest {
  readonly publicId: string;
  readonly bytes: Buffer;
  /** `jpeg` / `png` / `webp` — the format of `bytes`, established by sniffing. */
  readonly format: string;
}

/**
 * What the store reports back — and therefore what is persisted.
 *
 * MEDIA-MODEL.md §4: the browser is never the authority for media metadata. The
 * store is asked what it holds rather than told, so the recorded dimensions
 * describe the stored object even if the adapter transformed it on the way in.
 *
 * A rendered URL is deliberately ABSENT (ADR-MEDIA-002). URLs are derived at
 * read time from `publicId` + `version`; persisting one turns a CDN change into
 * a data migration, which is exactly what it did in the legacy system.
 */
export interface StoredMediaAsset {
  readonly publicId: string;
  /** Bumped on any re-upload to the same id, so a CDN cache busts deterministically. */
  readonly version: number;
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}
