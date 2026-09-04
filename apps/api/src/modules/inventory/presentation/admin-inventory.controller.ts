import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Forensics, type ForensicContext } from '../../../common/decorators/forensics.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { PaginationMetaDto } from '../../../common/dto/pagination-meta.dto';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../../../common/dto/pagination-query.dto';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import {
  InventoryAdminService,
  type OperatorEventType,
} from '../application/inventory-admin.service';
import {
  AdjustStockDto,
  AdjustmentResponseDto,
  InventoryEventDto,
  InventoryHistoryResponseDto,
  ProductIdParamDto,
  ReconciliationReportDto,
  ReconciliationResponseDto,
  StockLevelDto,
  StockLevelListResponseDto,
  StockLevelQueryDto,
  StockState,
} from './dto/admin-inventory.dto';

const NO_STORE = 'no-store';

/**
 * Stock operations for staff.
 *
 * Authority: docs/architecture/INVENTORY-MODEL.md §5.3, §5.4, §6, §7;
 *            PLAN.md §14, Phase 7.
 *
 * ## What this replaces, and the two facts about it worth stating
 *
 * The admin console's inventory screen writes to Supabase's
 * `inventory_transactions` through `adjust_stock_v2`. Two things are true about
 * that function, and both are in the frozen record:
 *
 *  1. **`EXECUTE` was granted to `anon`** — F-CRIT-1. Anybody who could reach
 *     the database could move stock.
 *  2. **Zero `adjustment` events exist in production**, so it never once
 *     completed successfully.
 *
 * Its SEMANTICS are preserved here because they were well designed: a signed
 * delta rather than an absolute value, a required reason, a floor at zero. The
 * execution path is new because the old one never worked, and the
 * authorization is `ADMIN`/`SUPER_ADMIN` on every route in this file.
 *
 * ## Stock cannot be moved anywhere else
 *
 * `CATALOG-MODEL.md` §4 makes InventoryModule the sole writer of `stock`, and
 * the product write DTOs reject the field — sending it is a 400 UNKNOWN_FIELD.
 * So every movement in the system passes through either an order's transaction
 * or this controller, and both write a ledger event in the same transaction as
 * the stock change. That is what makes `Σ quantityDelta == stock.onHand` an
 * invariant, and `GET /admin/inventory/reconciliation` is what proves it still
 * holds.
 */
@ApiTags('admin · inventory')
@ApiBearerAuth()
@Controller('admin/inventory')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class AdminInventoryController {
  constructor(private readonly inventory: InventoryAdminService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Stock levels, scarcest first',
    description: [
      'The work list. Ordered by what runs out next, because the list exists to be acted on.',
      '',
      '`?lowStock=true` and `?outOfStock=true` are INVENTORY-MODEL.md §7’s two reports as',
      'filters rather than as separate endpoints — they are the same list with a different',
      'predicate, and an operator moves between them constantly.',
      '',
      'Low stock is **per product**: `onHand <= lowStockThreshold`, never one global constant.',
      'A reel of resistors and an oscilloscope do not reorder at the same number. Legacy loaded',
      'every product and filtered in JavaScript (Phase 0 P3); this is a database predicate.',
      '',
      '`state` is derived server-side so no client re-implements the threshold rule — the legacy',
      'shape where five call sites computed availability five different ways.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: StockLevelListResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR / UNKNOWN_FIELD.' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  async levels(@Query() query: StockLevelQueryDto): Promise<StockLevelListResponseDto> {
    const page = await this.inventory.levels(query);

    return {
      data: page.items.map((product) => StockLevelDto.from(product)),
      meta: PaginationMetaDto.of(page.page, page.limit, page.total),
    };
  }

  @Get('reconciliation')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Does the ledger still add up to the stock',
    description: [
      'For every product with ledger history, `Σ quantityDelta` must equal `stock.onHand`.',
      'INVENTORY-MODEL.md §7 lists this as **"New. Impossible in legacy."** — legacy had no',
      '`balanceBefore`/`balanceAfter` and no invariant, which is why Phase 0.5 could not explain',
      'a single stock number.',
      '',
      'A non-zero `difference` proves an out-of-band mutation: stock moved without an event, or',
      'an event was written without stock moving. Neither is detectable any other way.',
      '',
      '**It reports; it does not correct.** Same rule as the media reconciliation and for the',
      'same reason — an automated corrector that misreads state writes a wrong number into the',
      'only record anyone could have used to find the right one. The remedy is an `ADJUSTMENT`',
      'with a reason, which leaves a trail.',
      '',
      '**A caveat that is not a false positive:** a product seeded with stock and no',
      '`OPENING_BALANCE` event reports a discrepancy equal to its whole balance, because the',
      'ledger genuinely does not account for it. That is the seed’s omission, correctly reported.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: ReconciliationResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  async reconcile(): Promise<ReconciliationResponseDto> {
    return { data: ReconciliationReportDto.from(await this.inventory.reconcile()) };
  }

  @Get(':productId/events')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Movement history for one product, newest first',
    description: [
      'Every event carries `balanceBefore` and `balanceAfter`, which is what makes the ledger',
      '**self-verifying**: any single entry can be checked without replaying history, and a gap',
      'between one event’s `balanceAfter` and the next one’s `balanceBefore` proves an',
      'out-of-band mutation. Legacy had neither field.',
      '',
      '`actorName` is snapshotted at the time of the movement. Legacy left `created_by` NULL on',
      'every sale event (F-MED-2), so no stock movement could be attributed to anybody at all.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: InventoryHistoryResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR.' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'PRODUCT_NOT_FOUND.' })
  async history(
    @Param() params: ProductIdParamDto,
    @Query() query: PaginationQueryDto,
  ): Promise<InventoryHistoryResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const result = await this.inventory.history(new Types.ObjectId(params.productId), page, limit);

    return {
      data: result.items.map((event) => InventoryEventDto.from(event)),
      meta: PaginationMetaDto.of(page, limit, result.total),
    };
  }

  @Post(':productId/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move stock by a signed delta, and ledger it',
    description: [
      'The only way stock changes outside an order. `CATALOG-MODEL.md` §4 makes InventoryModule',
      'the sole writer of `stock` and the product write DTOs reject the field, so there is no',
      'second door — which is legacy defect M7 closed, where an admin could change stock through',
      'a generic product update with no ledger entry behind it.',
      '',
      '**`delta` is a signed movement, not a target.** `-3` removes three; it does not set the',
      'balance to three. Preserved from `adjust_stock_v2`, whose semantics were right even',
      'though it never once completed successfully in production — zero `adjustment` events',
      'exist. An absolute value would silently overwrite a sale that landed between the',
      'operator reading the screen and pressing save; a delta composes with it.',
      '',
      '`delta: 0` is a 400 (legacy F-MED-9 permitted a ledger row recording nothing happening).',
      '',
      '**The floor is enforced inside the update**, not by a read and a comparison: two',
      'operators removing stock at the same moment would both pass an application-level check',
      'and the second would take the balance negative. A refusal is `409` naming what is',
      'actually there.',
      '',
      '**The actor comes from the token.** There is no actor field on this DTO and no request',
      'shape that could carry one — the legacy `p_admin_id` forgery vector, where the caller',
      'named who had done it. The role and name are read from the database profile rather than',
      'the JWT claim, so a token minted before a demotion cannot move stock as an admin.',
      '',
      'The stock change and the ledger entry are written in ONE transaction. Legacy wrote them',
      'from different code paths, which is why they diverged and why nothing could be',
      'reconciled.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdjustmentResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_ERROR — `delta` is zero or not an integer, `reason` is under 3 characters, or ' +
      '`type` is not one of RESTOCK / ADJUSTMENT / DAMAGE. UNKNOWN_FIELD — including any ' +
      'attempt to name the actor.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'PRODUCT_NOT_FOUND.' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'INSUFFICIENT_STOCK_FOR_ADJUSTMENT — the removal is larger than the balance. `details` ' +
      'names both numbers, because the next action is to post the difference actually counted.',
  })
  async adjust(
    @Param() params: ProductIdParamDto,
    @Body() body: AdjustStockDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdjustmentResponseDto> {
    const outcome = await this.inventory.adjust({
      productId: new Types.ObjectId(params.productId),
      delta: body.delta,
      reason: body.reason,
      type: body.type as unknown as OperatorEventType,
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    const { onHand, lowStockThreshold } = outcome.product.stock;

    return {
      data: {
        productId: outcome.product._id.toHexString(),
        sku: outcome.product.sku,
        balanceBefore: outcome.balanceBefore,
        balanceAfter: outcome.balanceAfter,
        state:
          onHand === 0
            ? StockState.OUT_OF_STOCK
            : onHand <= lowStockThreshold
              ? StockState.LOW_STOCK
              : StockState.IN_STOCK,
      },
    };
  }
}
