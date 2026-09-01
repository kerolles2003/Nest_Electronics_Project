import { ApiProperty } from '@nestjs/swagger';
import type { StoredMediaAsset } from '../../application/ports/media-storage.port';
import type { MediaReconciliation } from '../../application/media.service';

/**
 * A stored asset, as a client receives it.
 *
 * **There is no `url` field, and there will not be one** (ADR-MEDIA-002).
 * Clients build a delivery URL from `publicId` and `version`:
 *
 * ```
 * https://res.cloudinary.com/<cloud>/image/upload/<transformation>/v<version>/<publicId>
 * ```
 *
 * That is not an inconvenience passed to the client — it is what keeps a CDN
 * change a configuration change. Legacy persisted the absolute URL into 22 rows
 * and into `next.config.ts`, so moving provider meant a data migration, and
 * deleting an image meant splitting a URL on `/products/` to recover the key.
 *
 * `width` and `height` are returned so a client can reserve space before the
 * image loads. Legacy stored neither, which guaranteed layout shift on every
 * product grid.
 */
export class MediaAssetDto {
  @ApiProperty({
    example: 'nest/products/68b000000000000000000001/kK3nQ8vRb2Xf',
    description: 'Provider-relative identifier. Build the delivery URL from this; never store one.',
  })
  publicId!: string;

  @ApiProperty({
    example: 1756700000,
    description: 'Bumped on re-upload. Include it in the URL so a CDN cache busts deterministically.',
  })
  version!: number;

  @ApiProperty({ example: 'webp', enum: ['jpeg', 'png', 'webp'] })
  format!: string;

  @ApiProperty({ example: 1200, description: 'Of the STORED image, after any downscale.' })
  width!: number;

  @ApiProperty({ example: 1200 })
  height!: number;

  @ApiProperty({ example: 84213, description: 'Of the stored image, in bytes.' })
  bytes!: number;

  static from(asset: StoredMediaAsset): MediaAssetDto {
    return {
      publicId: asset.publicId,
      version: asset.version,
      format: asset.format,
      width: asset.width,
      height: asset.height,
      bytes: asset.bytes,
    };
  }
}

export class MediaAssetResponseDto {
  @ApiProperty({ type: MediaAssetDto })
  data!: MediaAssetDto;
}

/** One unreferenced asset in the reconciliation report. */
export class UnreferencedAssetDto {
  @ApiProperty({ example: 'nest/products/68b000000000000000000001/kK3nQ8vRb2Xf' })
  publicId!: string;

  @ApiProperty({ example: 84213 })
  bytes!: number;

  @ApiProperty({ example: '2026-09-01T12:00:00.000Z' })
  createdAt!: string;
}

/**
 * The orphan report (MEDIA-MODEL.md §9.3).
 *
 * A REPORT. Nothing here is deleted, and no endpoint deletes from it in bulk —
 * "an automated deleter that misreads state destroys production assets
 * irreversibly". Each section is a different kind of disagreement between the
 * store and the ledger, and each has a different correct response, which is
 * precisely why they are not merged into one list of "problems".
 */
export class MediaReconciliationDto {
  @ApiProperty({
    type: [String],
    description:
      'In the store, absent from the ledger — an upload whose database write failed. Safe to ' +
      'delete from the store once confirmed; nothing can reference it.',
  })
  inStoreOnly!: string[];

  @ApiProperty({
    type: [String],
    description:
      'In the ledger, absent from the store — destroyed out of band. The DANGEROUS direction: ' +
      'documents may still reference these, and those pages are already showing a broken image.',
  })
  inLedgerOnly!: string[];

  @ApiProperty({
    type: [UnreferencedAssetDto],
    description:
      'Known to both, referenced by nothing. Not an error — an upload nobody attached — and the ' +
      'ordinary thing an operator cleans up. Oldest first.',
  })
  unreferenced!: UnreferencedAssetDto[];

  static from(report: MediaReconciliation): MediaReconciliationDto {
    return {
      inStoreOnly: [...report.inStoreOnly],
      inLedgerOnly: [...report.inLedgerOnly],
      unreferenced: report.unreferenced.map((asset) => ({ ...asset })),
    };
  }
}

export class MediaReconciliationResponseDto {
  @ApiProperty({ type: MediaReconciliationDto })
  data!: MediaReconciliationDto;
}
