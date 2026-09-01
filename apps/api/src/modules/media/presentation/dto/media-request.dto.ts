import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { MEDIA_ENTITIES, type MediaEntity } from '../../application/media.service';

/** A 24-character ObjectId hex string. */
const OBJECT_ID = /^[0-9a-f]{24}$/;

/**
 * Which entity an upload belongs to.
 *
 * Both fields end up in the stored `publicId` as path segments (MEDIA-MODEL.md
 * §6), which is the whole reason they are validated this strictly rather than
 * accepted as text. `entity` is a closed list and `entityId` must be an
 * ObjectId, so no caller-supplied value can contain a `/`, a `..`, or anything
 * else that would place an asset outside the folder it claims to be in.
 *
 * The referenced entity is deliberately NOT looked up. Phase 4 ships the
 * pipeline with no catalogue write path (Phase 7 owns that), so an upload names
 * where its asset will live rather than attaching it to something. Checking
 * that a product exists would be a promise this phase cannot keep, because
 * nothing yet stops the product being deleted a second later — the reference
 * ledger, not a lookup at upload time, is what keeps that honest.
 */
export class UploadMediaDto {
  @ApiProperty({
    enum: MEDIA_ENTITIES,
    example: 'products',
    description: 'The kind of entity this asset is for. Becomes a folder segment.',
  })
  @IsIn(MEDIA_ENTITIES, { message: `entity must be one of: ${MEDIA_ENTITIES.join(', ')}` })
  entity!: MediaEntity;

  @ApiProperty({
    example: '68b000000000000000000001',
    description: 'The id of that entity. Becomes a folder segment.',
  })
  @IsString()
  @Matches(OBJECT_ID, { message: 'entityId must be a 24-character hex ObjectId' })
  entityId!: string;
}

/**
 * The asset to destroy.
 *
 * A query parameter rather than a path segment because a `publicId` CONTAINS
 * slashes — `nest/products/<id>/<random>` — and a path parameter cannot carry
 * one. Express decodes `%2F` before routing, so even a percent-encoded id would
 * be split into segments that no route matches. Naming it in the query is the
 * honest way to pass a value with that shape; the alternative is a
 * catch-all route whose matching rules nobody can predict.
 */
export class DestroyMediaDto {
  @ApiProperty({
    example: 'nest/products/68b000000000000000000001/kK3nQ8vRb2Xf',
    description: 'The provider-relative identifier, exactly as it was returned by the upload.',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9/_-]+$/, {
    message: 'publicId may contain only letters, digits, slashes, underscores and hyphens',
  })
  publicId!: string;
}

/** How much of the reconciliation report to return. */
export class ReconcileQueryDto {
  @ApiPropertyOptional({
    example: '100',
    description: 'Maximum entries per section. A report is read by a person, so it is bounded.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([1-9]\d{0,2}|1000)$/, { message: 'limit must be a whole number between 1 and 1000' })
  limit?: string;
}
