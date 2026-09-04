import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, Matches } from 'class-validator';
import { OBJECT_ID_PATTERN } from '../../../../common/dto/object-id';
import { PaginationMetaDto } from '../../../../common/dto/pagination-meta.dto';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import { AuditAction, AuditEntityType } from '../../domain/audit-action';
import type { AuditLogLean } from '../../infrastructure/schemas/audit-log.schema';

/**
 * The query surface, exactly as AUDIT-MODEL.md §8 names it.
 *
 * ```
 * ?actorId=&action=&entityType=&entityId=&from=&to=&page=&limit=
 * ```
 *
 * Every one of these matches a frozen index. There is deliberately no `q`: no
 * index answers an unanchored pattern, so a text search would be a collection
 * scan over two years of records on a screen an operator types into.
 */
export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: '652f1a9b3c4d5e6f7a8b9c0d',
    description: 'Everything one person did. Served by `audit_actor_history`.',
  })
  @IsOptional()
  @Matches(OBJECT_ID_PATTERN, { message: 'actorId must be a 24-character hex id' })
  actorId?: string;

  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction, { message: 'action is not one this system records' })
  action?: AuditAction;

  @ApiPropertyOptional({ enum: AuditEntityType })
  @IsOptional()
  @IsEnum(AuditEntityType, { message: 'entityType is not one this system records' })
  entityType?: AuditEntityType;

  @ApiPropertyOptional({
    example: '652f1a9b3c4d5e6f7a8b9c0d',
    description:
      'Everything that happened to one thing. Pass `entityType` with it — the index leads on ' +
      'the type, so an id alone cannot seek.',
  })
  @IsOptional()
  @Matches(OBJECT_ID_PATTERN, { message: 'entityId must be a 24-character hex id' })
  entityId?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from must be an ISO-8601 date' })
  from?: Date;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.999Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to must be an ISO-8601 date' })
  to?: Date;
}

export class AuditActorDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' }) id!: string;
  @ApiProperty({ example: 'ADMIN' }) role!: string;
  @ApiProperty({ example: 'Mina Sobhy' }) name!: string;
  @ApiProperty({ example: 'mina@example.test' }) email!: string;
}

export class AuditEntityDto {
  @ApiProperty({ enum: AuditEntityType }) type!: AuditEntityType;
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' }) id!: string;

  @ApiProperty({
    example: 'ESP32-WROOM-32',
    description: 'Snapshotted, so the record stays readable after the entity is gone.',
  })
  label!: string;
}

/**
 * One audited action.
 *
 * ## The actor is a SNAPSHOT and is returned as one
 *
 * §4: "the record must remain readable after the actor is deleted or renamed."
 * There is no join here and no `userId` to follow — the name and email are what
 * they were at the time, which is the only thing that stays true.
 */
export class AuditLogDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' }) id!: string;
  @ApiProperty({ enum: AuditAction }) action!: AuditAction;
  @ApiProperty({ type: AuditActorDto }) actor!: AuditActorDto;
  @ApiProperty({ type: AuditEntityDto }) entity!: AuditEntityDto;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      'Only the fields that changed, as `{ before, after }`. Never whole documents, and values ' +
      'that must not be stored are already replaced by a marker at write time.',
  })
  changes!: { before: Record<string, unknown>; after: Record<string, unknown> } | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ example: '203.0.113.7', nullable: true, type: String }) ip!: string | null;

  @ApiProperty({
    example: 'Mozilla/5.0',
    nullable: true,
    type: String,
    description: 'The exact field whose absence silently broke the legacy audit trail.',
  })
  userAgent!: string | null;

  @ApiProperty({
    example: 'e5e95c05-cf9a-4a6b-80c8-26ad30792c70',
    description: 'Correlates this record with the request log line and the error response.',
  })
  requestId!: string;

  @ApiProperty({ example: '2026-09-03T09:14:00.000Z' }) createdAt!: string;

  static from(log: AuditLogLean): AuditLogDto {
    return {
      id: log._id.toHexString(),
      action: log.action,
      actor: {
        id: log.actor.id.toHexString(),
        role: log.actor.role,
        name: log.actor.name,
        email: log.actor.email,
      },
      entity: {
        type: log.entity.type,
        id: log.entity.id.toHexString(),
        label: log.entity.label,
      },
      changes:
        log.changes === null
          ? null
          : { before: log.changes.before, after: log.changes.after },
      metadata: log.metadata,
      ip: log.ip,
      userAgent: log.userAgent,
      requestId: log.requestId,
      createdAt: log.createdAt.toISOString(),
    };
  }
}

export class AuditLogListResponseDto {
  @ApiProperty({ type: [AuditLogDto] }) data!: AuditLogDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
}

export class AuditActionsResponseDto {
  @ApiProperty({
    type: [String],
    example: ['ORDER_CONFIRMED', 'PRODUCT_UPDATED'],
    description:
      'The actions actually PRESENT in the trail, not the whole vocabulary. A filter offering ' +
      'thirty options that match nothing is a filter nobody uses.',
  })
  data!: string[];
}
