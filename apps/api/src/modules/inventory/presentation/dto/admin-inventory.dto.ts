import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OBJECT_ID_PATTERN } from '../../../../common/dto/object-id';
import { PaginationMetaDto } from '../../../../common/dto/pagination-meta.dto';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import type { ProductLean } from '../../../catalog/infrastructure/schemas/product.schema';
import type {
  ReconciliationDiscrepancy,
  ReconciliationReport,
} from '../../application/inventory-admin.service';
import {
  InventoryEventType,
  type InventoryEvent,
} from '../../infrastructure/schemas/inventory-event.schema';

/**
 * The event types this endpoint accepts.
 *
 * A DTO-local enum rather than the schema's, and that is the point: the schema
 * declares the whole frozen vocabulary including `SALE`, `CANCELLATION` and
 * `RETURN`, which are consequences of an order and written inside the order's
 * transaction. An operator able to hand-write a `SALE` could move stock with no
 * order behind it, and the ledger would stop reconciling against `orders`.
 *
 * `OPENING_BALANCE` is excluded for a different reason — INVENTORY-MODEL.md §9
 * makes initial stock a SEED, "not a migration". An opening balance an operator
 * can post at any time is an adjustment wearing another name, and reporting
 * that told them apart would be lying.
 */
export enum AdjustmentTypeDto {
  /** "We received 100 units." */
  RESTOCK = InventoryEventType.RESTOCK,
  /** "The count was wrong." */
  ADJUSTMENT = InventoryEventType.ADJUSTMENT,
  /** "Three were broken in storage." */
  DAMAGE = InventoryEventType.DAMAGE,
}

function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === '1' || value === true) return true;
  if (value === 'false' || value === '0' || value === false) return false;
  return value;
}

export class ProductIdParamDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d', pattern: OBJECT_ID_PATTERN.source })
  @Matches(OBJECT_ID_PATTERN, { message: 'productId must be a 24-character hex id' })
  productId!: string;
}

export class AdjustStockDto {
  @ApiProperty({
    example: -3,
    description:
      'A SIGNED, non-zero integer — how much stock MOVES, not what it should become. Preserved ' +
      'from `adjust_stock_v2`, whose semantics were correct even though it never once ran ' +
      'successfully. An absolute value would silently overwrite a concurrent sale; a delta ' +
      'composes with one.',
  })
  @Type(() => Number)
  @IsInt({ message: 'delta must be a whole number of units' })
  delta!: number;

  @ApiProperty({
    example: 'Damaged in storage — water ingress on the top shelf',
    minLength: 3,
    maxLength: 500,
    description:
      'Why. Required, and at least 3 characters — preserved from the legacy Zod rule, which the ' +
      'database never enforced. This is the field that makes the ledger readable a year later.',
  })
  @IsString()
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500)
  reason!: string;

  @ApiProperty({
    enum: AdjustmentTypeDto,
    description:
      '`RESTOCK` — goods arrived. `ADJUSTMENT` — the count was wrong. `DAMAGE` — units were ' +
      'destroyed. Distinct types because they are different business events and reporting has ' +
      'to tell them apart, not because the mechanism differs.',
  })
  @IsEnum(AdjustmentTypeDto, {
    message: `type must be one of: ${Object.values(AdjustmentTypeDto).join(', ')}`,
  })
  type!: AdjustmentTypeDto;
}

export class StockLevelQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'esp32', maxLength: 100, description: 'Matches SKU and English name.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'At or below the product’s OWN threshold. Per-product, not one global constant: a reel of ' +
      'resistors and an oscilloscope do not reorder at the same number.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  lowStock?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Exactly zero on hand.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  outOfStock?: boolean;

  @ApiPropertyOptional({ example: '652f1a9b3c4d5e6f7a8b9c0d', description: 'The category SUBTREE.' })
  @IsOptional()
  @Matches(OBJECT_ID_PATTERN, { message: 'categoryId must be a 24-character hex id' })
  categoryId?: string;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description:
      'Include unpublished products. Excluded by default because a stock list is a work list, ' +
      'and a draft is not something anybody is about to run out of.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeInactive?: boolean;
}

// --- responses --------------------------------------------------------------

export enum StockState {
  IN_STOCK = 'IN_STOCK',
  LOW_STOCK = 'LOW_STOCK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}

export class StockLevelDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' }) productId!: string;
  @ApiProperty({ example: 'ESP32-WROOM-32' }) sku!: string;
  @ApiProperty({ example: 'esp32-devkit-v1' }) slug!: string;
  @ApiProperty({ example: 'ESP32 DevKit V1' }) name!: string;
  @ApiProperty({ example: 42 }) onHand!: number;
  @ApiProperty({ example: 5 }) lowStockThreshold!: number;

  @ApiProperty({
    enum: StockState,
    description:
      'Derived once, on the server, so no client re-implements the threshold rule — the legacy ' +
      'shape where five call sites computed availability five ways.',
  })
  state!: StockState;

  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ example: 'Microcontrollers' }) categoryName!: string;

  @ApiProperty({
    example: 9800,
    nullable: true,
    type: Number,
    description: 'ADMIN ONLY, minor units. Present so a stock-value report needs no second request.',
  })
  costPrice!: number | null;

  static from(product: ProductLean): StockLevelDto {
    const { onHand, lowStockThreshold } = product.stock;

    return {
      productId: product._id.toHexString(),
      sku: product.sku,
      slug: product.slug,
      name: product.name.en,
      onHand,
      lowStockThreshold,
      state:
        onHand === 0
          ? StockState.OUT_OF_STOCK
          : onHand <= lowStockThreshold
            ? StockState.LOW_STOCK
            : StockState.IN_STOCK,
      isActive: product.isActive,
      categoryName: product.category.name.en,
      costPrice: product.pricing.costPrice,
    };
  }
}

export class StockLevelListResponseDto {
  @ApiProperty({ type: [StockLevelDto] }) data!: StockLevelDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
}

export class InventoryEventDto {
  @ApiProperty({ example: 'RESTOCK', enum: InventoryEventType }) type!: string;

  @ApiProperty({
    example: -3,
    description: 'SIGNED. Negative when stock left. A `SALE` is always negative.',
  })
  quantityDelta!: number;

  @ApiProperty({ example: 45 }) balanceBefore!: number;
  @ApiProperty({ example: 42 }) balanceAfter!: number;
  @ApiProperty({ example: 'Damaged in storage' }) reason!: string;

  @ApiProperty({
    example: 'NE-20260830-0001',
    nullable: true,
    type: String,
    description: 'The order id this movement belongs to, or null for a manual adjustment.',
  })
  referenceId!: string | null;

  @ApiProperty({
    example: 'Mina Sobhy',
    nullable: true,
    type: String,
    description:
      'Snapshotted at the time. Legacy left `created_by` NULL on every sale event (F-MED-2), so ' +
      'no movement could be attributed to anyone.',
  })
  actorName!: string | null;

  @ApiProperty({ example: '2026-09-03T09:14:00.000Z' }) createdAt!: string;

  static from(event: InventoryEvent & { createdAt?: Date }): InventoryEventDto {
    return {
      type: event.type,
      quantityDelta: event.quantityDelta,
      balanceBefore: event.balanceBefore,
      balanceAfter: event.balanceAfter,
      reason: event.reason,
      referenceId: event.reference?.id.toHexString() ?? null,
      actorName: event.actor?.name ?? null,
      createdAt: (event.createdAt ?? new Date(0)).toISOString(),
    };
  }
}

export class InventoryHistoryResponseDto {
  @ApiProperty({ type: [InventoryEventDto] }) data!: InventoryEventDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
}

export class AdjustmentResultDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' }) productId!: string;
  @ApiProperty({ example: 'ESP32-WROOM-32' }) sku!: string;
  @ApiProperty({ example: 45 }) balanceBefore!: number;
  @ApiProperty({ example: 42 }) balanceAfter!: number;

  @ApiProperty({
    enum: StockState,
    description: 'The state AFTER the movement, so a client can re-render without asking again.',
  })
  state!: StockState;
}

export class AdjustmentResponseDto {
  @ApiProperty({ type: AdjustmentResultDto }) data!: AdjustmentResultDto;
}

export class ReconciliationDiscrepancyDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' }) productId!: string;
  @ApiProperty({ example: 'ESP32-WROOM-32' }) sku!: string;
  @ApiProperty({ example: 42, description: 'What the product document says.' }) onHand!: number;

  @ApiProperty({ example: 39, description: 'Σ quantityDelta over every event for this product.' })
  ledgerSum!: number;

  @ApiProperty({
    example: 3,
    description:
      '`onHand - ledgerSum`. Non-zero proves an out-of-band mutation: stock moved without an ' +
      'event, or an event was written without stock moving.',
  })
  difference!: number;

  static from(row: ReconciliationDiscrepancy): ReconciliationDiscrepancyDto {
    return { ...row };
  }
}

export class ReconciliationReportDto {
  @ApiProperty({ example: 84, description: 'Products with any ledger history.' })
  checked!: number;

  @ApiProperty({ type: [ReconciliationDiscrepancyDto] })
  discrepancies!: ReconciliationDiscrepancyDto[];

  static from(report: ReconciliationReport): ReconciliationReportDto {
    return {
      checked: report.checked,
      discrepancies: report.discrepancies.map((row) => ReconciliationDiscrepancyDto.from(row)),
    };
  }
}

export class ReconciliationResponseDto {
  @ApiProperty({ type: ReconciliationReportDto }) data!: ReconciliationReportDto;
}
