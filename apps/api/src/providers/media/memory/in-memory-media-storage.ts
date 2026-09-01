import { Injectable, Logger } from '@nestjs/common';
import {
  MediaStoragePort,
  type MediaUploadRequest,
  type StoredMediaAsset,
} from '../../../modules/media/application/ports/media-storage.port';

/**
 * The media counterpart of `ConsoleEmailSender`.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §4 — the development
 * adapter is a first-class implementation of the port, not a mock.
 *
 * ## Why this exists rather than "the endpoint is disabled without credentials"
 *
 * D-4 confirms Cloudinary, but the account is an owner deliverable that has not
 * arrived. Without a development adapter, everything in front of the port — the
 * size and MIME rules, magic-byte sniffing, EXIF stripping, orientation
 * correction, dimension capture, `publicId` generation, the reference ledger,
 * the ordering invariant — would be unreachable and therefore untested until
 * somebody pastes an API key in. That is precisely the rot Phase 4's risk note
 * warns about: "an upload endpoint with no real content can rot unnoticed."
 *
 * With this adapter the entire pipeline runs, end to end, on a machine with no
 * account at all. What remains unproven is narrow and named: whether Cloudinary
 * answers the way its documentation says.
 *
 * ## Why it keeps the bytes
 *
 * A stub that discarded them would let the port's contract drift — `version`
 * monotonicity, "destroy is idempotent", "list returns what was uploaded" are
 * all statements about a store that remembers. Holding the buffers makes those
 * testable. It is also why `MEDIA_PROVIDER=memory` is refused in production by
 * the env schema: a store that lives in one process is a store that empties on
 * restart.
 */
@Injectable()
export class InMemoryMediaStorage extends MediaStoragePort {
  private readonly logger = new Logger(InMemoryMediaStorage.name);
  private readonly assets = new Map<string, StoredMediaAsset & { bytes_: Buffer }>();

  /**
   * A monotonic counter standing in for Cloudinary's upload timestamp.
   *
   * `version` exists so a re-upload to the same id busts a CDN cache
   * deterministically (§3). Seeded from the clock so two runs do not produce
   * colliding versions, incremented so two uploads in the same millisecond do
   * not either — a wall-clock read would fail exactly the case the field is for.
   */
  private nextVersion = Math.floor(Date.now() / 1000);

  upload(request: MediaUploadRequest): Promise<StoredMediaAsset> {
    // Mirrors `overwrite: false`. The in-memory adapter is only useful as a
    // stand-in if it refuses the same things the real one refuses.
    if (this.assets.has(request.publicId)) {
      return Promise.reject(new Error(`${request.publicId} already exists and overwrite is off`));
    }

    const dimensions = readDimensions(request.bytes, request.format);

    const stored: StoredMediaAsset = {
      publicId: request.publicId,
      version: (this.nextVersion += 1),
      format: request.format,
      width: dimensions.width,
      height: dimensions.height,
      bytes: request.bytes.length,
    };

    this.assets.set(request.publicId, { ...stored, bytes_: request.bytes });

    this.logger.log(
      `[memory] stored ${request.publicId}  ${String(stored.width)}x${String(stored.height)}  ` +
        `${String(stored.bytes)} bytes — NOT sent to any provider`,
    );

    return Promise.resolve(stored);
  }

  /** Idempotent, per the port contract: "already gone" is success. */
  destroy(publicId: string): Promise<void> {
    this.assets.delete(publicId);
    return Promise.resolve();
  }

  list(prefix: string): Promise<readonly string[]> {
    return Promise.resolve([...this.assets.keys()].filter((id) => id.startsWith(prefix)).sort());
  }

  /** Test-facing: the exact bytes that were stored, for asserting on them. */
  read(publicId: string): Buffer | undefined {
    return this.assets.get(publicId)?.bytes_;
  }

  /** Test-facing: forget everything, so one suite cannot see another's uploads. */
  clear(): void {
    this.assets.clear();
  }
}

/**
 * Dimensions straight out of the file header.
 *
 * The service has already run sharp over these bytes, so it KNOWS the
 * dimensions — but passing them through the port would mean the store reports
 * numbers it was told rather than numbers it measured, and MEDIA-MODEL.md §4 is
 * that the store is asked, never told. Reading them here keeps this adapter
 * honest in the same way the Cloudinary one is honest: both answer from the
 * object they hold.
 *
 * Three formats, three fixed header layouts — the same allow-list
 * `image-format.ts` sniffs, and the same reason no library is involved.
 */
function readDimensions(buffer: Buffer, format: string): { width: number; height: number } {
  switch (format) {
    case 'png':
      // IHDR is always the first chunk: 8-byte signature, 4-byte length,
      // 4-byte type, then width and height as big-endian 32-bit integers.
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };

    case 'jpeg':
      return readJpegDimensions(buffer);

    case 'webp':
      return readWebpDimensions(buffer);

    /* istanbul ignore next -- unreachable: format comes from the sniffer. */
    default:
      throw new Error(`cannot read dimensions of ${format}`);
  }
}

/**
 * Walks the JPEG marker chain to the first Start-Of-Frame.
 *
 * JPEG has no fixed header: dimensions live in an SOFn segment that can appear
 * anywhere after an arbitrary number of application and quantisation segments,
 * so finding it means walking. The excluded markers are the ones whose value is
 * encoded in the marker itself and which therefore carry no length field.
 */
function readJpegDimensions(buffer: Buffer): { width: number; height: number } {
  let offset = 2; // past the SOI marker

  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1] ?? 0;
    const length = buffer.readUInt16BE(offset + 2);

    // SOF0..SOF15, excluding DHT (c4), DAC (cc) and the RSTn markers (d0-d7).
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xcc;

    if (isStartOfFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }

    offset += 2 + length;
  }

  throw new Error('no JPEG start-of-frame segment found');
}

/** VP8, VP8L and VP8X each encode the size differently; all three are in use. */
function readWebpDimensions(buffer: Buffer): { width: number; height: number } {
  const chunk = buffer.toString('ascii', 12, 16);

  if (chunk === 'VP8X') {
    // 24-bit little-endian, stored as (value - 1).
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    };
  }

  if (chunk === 'VP8 ') {
    // Lossy: a 3-byte start code, then 14-bit dimensions.
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunk === 'VP8L') {
    // Lossless: 14 bits each, packed across four bytes after the signature.
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }

  throw new Error(`unrecognised WebP chunk ${chunk}`);
}
