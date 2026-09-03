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
import { RequestLocale } from '../../../common/decorators/locale.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { PaginationMetaDto } from '../../../common/dto/pagination-meta.dto';
import type { Locale } from '../../../common/localization/locale';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import { OrderLifecycleService } from '../application/order-lifecycle.service';
import { OrdersService } from '../application/orders.service';
import { parseOrderSearch } from '../domain/order-search';
import { OrderStatus } from '../domain/order-status';
import {
  ConfirmOrderDto,
  DeliverOrderDto,
  DeliveryFailedDto,
  RetryShipmentDto,
  ReturnOrderDto,
  ShipOrderDto,
} from './dto/admin-order-request.dto';
import { AdminOrderDto, AdminOrderResponseDto } from './dto/admin-order-response.dto';
import { AdminOrderQueueQueryDto, OrderIdParamDto } from './dto/order-query.dto';
import {
  OrderQueueStatsDto,
  OrderQueueStatsResponseDto,
} from './dto/order-queue-stats.dto';
import { OrderHistoryResponseDto, OrderSummaryDto } from './dto/order-summary.dto';

const NO_STORE = 'no-store';

/** Every lifecycle route answers the same four failures. Declared once. */
const LIFECYCLE_ERRORS = {
  badRequest:
    'VALIDATION_ERROR — `id` is not a 24-character hex id, or the body failed validation. ' +
    'UNKNOWN_FIELD — the body carried a field this operation does not accept, including any ' +
    'attempt to send a `status`.',
  forbidden: 'FORBIDDEN — lifecycle operations require an ADMIN or SUPER_ADMIN account.',
  notFound: 'ORDER_NOT_FOUND — no order with that id.',
  conflict:
    'INVALID_STATE_TRANSITION — the order is not in a status this operation can move it from; ' +
    '`details` names the current status and the requested one. This includes REPEATING an ' +
    'operation that already succeeded. Do NOT retry — it never succeeds. ' +
    'CONCURRENT_MODIFICATION — another operator changed the order during this request; re-read ' +
    'it and decide again.',
};

/**
 * Staff order operations: the work queue, and the six lifecycle actions that
 * move an order from `PLACED` to `DELIVERED` and through the recovery paths.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §5 (transition matrix),
 *            §13 (access rules).
 *
 * ## Explicit actions, never a status field
 *
 * There is no `PATCH /admin/orders/:id` and no `PATCH /admin/orders/:id/status`.
 * Each edge of the state machine is its own endpoint with its own DTO carrying
 * exactly that edge's required input — `ship` cannot be called without a carrier
 * and a tracking number, because the DTO for shipping is the only body that
 * route accepts. A generic status endpoint would have to accept every input
 * optionally and then validate combinations at runtime, which is how legacy
 * ended up able to "ship" an order with no tracking at all.
 *
 * ## One state machine
 *
 * Every handler here does the same thing: resolve the caller, name a target
 * status, and hand off to `OrderLifecycleService.transitionByStaff`. NO
 * transition rule, no side effect and no inventory logic lives in this file.
 * The matrix is in `domain/order-transitions.ts` and is the only authority; a
 * controller that disagreed with it could not take effect, because the guarded
 * update is evaluated inside the engine.
 *
 * ## No ownership scope
 *
 * Unlike `OrdersController`, nothing here filters by `userId`. Staff act on any
 * customer's order — that IS the operation — so a missing order is a plain 404
 * with no oracle to protect: an operator is already authorised to see every
 * order, so "this id does not exist" tells them nothing they could not learn
 * from the queue.
 */
@ApiTags('admin · orders')
@ApiBearerAuth()
@Controller('admin/orders')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class AdminOrdersController {
  constructor(
    private readonly lifecycle: OrderLifecycleService,
    private readonly orders: OrdersService,
  ) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'The order work queue',
    description: [
      'Every order in the system, **newest first**, paginated — the screen an operator works',
      'from. Same page shape, same pagination contract and same card model as the customer’s own',
      'history, so there is one order-summary type rather than two that drift.',
      '',
      'Filter by lifecycle status to get a work list: `?status=PLACED` is the confirmation queue,',
      '`?status=CONFIRMED` is ready-to-ship, `?status=DELIVERY_FAILED` is the exception queue.',
      '`?status=` is repeatable and matches ANY of the given values.',
      '',
      'Search with `?q=`. It matches the order number and the customer SNAPSHOT recorded on',
      'the order — name, email and phone — so an order is still findable by the name on its',
      'delivery note after that customer has changed their name. The term is ESCAPED before',
      'it reaches the database: regular-expression syntax in it matches itself.',
      '',
      'Narrow by date with `?placedFrom=` and `?placedTo=`. A date with no time as `placedTo`',
      'means the END of that day in UTC, so `?placedTo=2026-09-03` includes the third.',
      '',
      'Ordering is `?sort=`: `newest` (the default), `oldest`, `total_high`, `total_low`.',
      'Every option is served by an index and every one breaks ties on the order id, so',
      'paging is stable and a row cannot appear on two pages or on none.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: OrderHistoryResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_ERROR — a bad `page`, `limit` or `status` value. ' +
      'UNKNOWN_FIELD — an undocumented query parameter.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.forbidden })
  async list(@Query() query: AdminOrderQueueQueryDto): Promise<OrderHistoryResponseDto> {
    /*
     * The raw string becomes escaped patterns HERE, at the boundary, and the
     * repository is typed to accept only the parsed form. That is what makes
     * "no client string becomes part of a query expression" a property of the
     * types rather than a habit — there is no overload that takes the text.
     *
     * A whitespace-only term parses to `null` and is not a filter, because an
     * empty pattern matches everything: treating `?q=%20` as a search would
     * return the unfiltered queue while the caller believed it was narrowed.
     */
    const search = query.q === undefined ? null : parseOrderSearch(query.q);

    const outcome = await this.orders.listForStaff({
      ...(query.status !== undefined ? { statuses: query.status } : {}),
      ...(query.page !== undefined ? { page: query.page } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(search !== null ? { search } : {}),
      ...(query.placedFrom !== undefined ? { placedFrom: query.placedFrom } : {}),
      ...(query.placedTo !== undefined ? { placedTo: query.placedTo } : {}),
      ...(query.sort !== undefined ? { sort: query.sort } : {}),
    });

    return {
      data: outcome.items.map((row) => OrderSummaryDto.from(row)),
      meta: PaginationMetaDto.of(outcome.page, outcome.limit, outcome.total),
    };
  }

  /**
   * Declared BEFORE `:id`, and that ordering is load-bearing.
   *
   * Nest matches routes in declaration order, so with `@Get(':id')` first this
   * path would bind `id = 'stats'`, fail the 24-hex-character check, and answer
   * a documented endpoint with a validation error about an order id.
   */
  @Get('stats')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'How many orders are in each status',
    description: [
      'One row of numbers for the queue tiles, in a single request.',
      '',
      'It replaces asking for seven pages of one order each and reading `meta.total` off every',
      'response. That cost seven index scans to draw one row — but the real defect was that the',
      'seven numbers were taken at seven different instants, so an order confirmed midway',
      'through could be counted twice or not at all, and the tiles would not add up to the',
      'total beside them. This is one aggregation at one instant, so they always do.',
      '',
      'Every lifecycle status is present, including the ones nothing is in: a status with no',
      'orders has a count of `0` rather than being omitted. A console cannot otherwise tell',
      '"no cancelled orders" from "the count could not be read", and on a fulfilment screen',
      'those are very different sentences.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: OrderQueueStatsResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.forbidden })
  async stats(): Promise<OrderQueueStatsResponseDto> {
    return { data: OrderQueueStatsDto.from(await this.orders.countByStatusForStaff()) };
  }

  @Get(':id')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Read any order',
    description: [
      'The full order, for any customer. Returns **`AdminOrderDto`** — the canonical `OrderDto`',
      'that `POST /orders` and `GET /orders/{id}` return, plus the two things only an operator',
      'needs: `allowedTransitions` and `statusHistory`. Every lifecycle action below returns the',
      'same model, so an admin client generates and shares one order type.',
      '',
      '**Render the available actions from `allowedTransitions`, never from a transition map held',
      'in the client.** It is computed by the same function the engine calls before it writes, so',
      'the buttons a console draws and the requests this API will accept cannot drift apart.',
      '',
      'This exists because the queue alone is not operable: confirming a Cash-on-Delivery order',
      'means phoning the customer and reading back the delivery address, and shipping one means',
      'putting that address on a label.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminOrderResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR — `id` is not a 24-character hex id.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.forbidden })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.notFound })
  async detail(
    @Param() params: OrderIdParamDto,
    @RequestLocale() locale: Locale,
  ): Promise<AdminOrderResponseDto> {
    const order = await this.orders.findForStaff(new Types.ObjectId(params.id));

    return { data: AdminOrderDto.from(order, locale) };
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Confirm an order (PLACED → CONFIRMED)',
    description: [
      'Records that the order has been verified — in practice, that somebody called the customer',
      'and they confirmed they want it. This is the real Cash-on-Delivery business step: an',
      'unverified COD order has a material refusal rate, so confirmation is what makes it safe to',
      'pick and pack.',
      '',
      'Touches no stock — stock was committed at placement. The customer can still cancel from',
      '`CONFIRMED`; that stops being true once the order ships.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminOrderResponseDto, description: 'Confirmed. `status` is `CONFIRMED`.' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.badRequest })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.forbidden })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.notFound })
  @ApiConflictResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.conflict })
  async confirm(
    @Param() params: OrderIdParamDto,
    @Body() dto: ConfirmOrderDto,
    @CurrentUser() principal: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
    @RequestLocale() locale: Locale,
  ): Promise<AdminOrderResponseDto> {
    return this.run(params, principal, forensics, locale, OrderStatus.CONFIRMED, { note: dto.note ?? null });
  }

  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Dispatch an order (CONFIRMED → SHIPPED)',
    description: [
      'Hands the order to a courier. **`carrier` and `trackingNumber` are required** — they are a',
      'precondition of the state, not a decoration, so an order that has shipped can always be',
      'tracked. Sending the request without them is a `400`.',
      '',
      'Populates the `shipment` block on the order, which the customer can then see on',
      '`GET /orders/{id}`. Touches no stock.',
      '',
      'Once an order is `SHIPPED` it can no longer be cancelled by anyone — the goods are with the',
      'courier. The paths from here are delivery, or a failed attempt followed by a return.',
    ].join('\n'),
  })
  @ApiOkResponse({
    type: AdminOrderResponseDto,
    description: 'Dispatched. `status` is `SHIPPED` and `shipment` is populated.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_ERROR — `carrier` or `trackingNumber` missing or malformed, or `id` is not a ' +
      '24-character hex id. UNKNOWN_FIELD — an unaccepted body field.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.forbidden })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.notFound })
  @ApiConflictResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.conflict })
  async ship(
    @Param() params: OrderIdParamDto,
    @Body() dto: ShipOrderDto,
    @CurrentUser() principal: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
    @RequestLocale() locale: Locale,
  ): Promise<AdminOrderResponseDto> {
    return this.run(params, principal, forensics, locale, OrderStatus.SHIPPED, {
      note: dto.note ?? null,
      shipment: { carrier: dto.carrier, trackingNumber: dto.trackingNumber },
    });
  }

  @Post(':id/deliver')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Complete delivery (SHIPPED → DELIVERED)',
    description: [
      'The customer received the goods **and paid the courier**.',
      '',
      '### Delivering collects the cash, atomically',
      '',
      'Under Cash on Delivery, delivery IS the payment event — the courier does not hand over',
      'goods without collecting. This operation therefore sets `payment.status` to `PAID` and',
      '`payment.collectedAt` in the **same atomic write** as the status change, which is what',
      'makes "delivered but unpaid" impossible to represent rather than merely discouraged.',
      '',
      'If cash was NOT collected, the order was not delivered — use `delivery-failed` instead.',
      '',
      '`DELIVERED` is terminal apart from a return. Touches no stock.',
    ].join('\n'),
  })
  @ApiOkResponse({
    type: AdminOrderResponseDto,
    description: 'Delivered. `status` is `DELIVERED` and `payment.status` is `PAID`.',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.badRequest })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.forbidden })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.notFound })
  @ApiConflictResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.conflict })
  async deliver(
    @Param() params: OrderIdParamDto,
    @Body() dto: DeliverOrderDto,
    @CurrentUser() principal: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
    @RequestLocale() locale: Locale,
  ): Promise<AdminOrderResponseDto> {
    return this.run(params, principal, forensics, locale, OrderStatus.DELIVERED, { note: dto.note ?? null });
  }

  @Post(':id/delivery-failed')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Record a failed delivery attempt (SHIPPED → DELIVERY_FAILED)',
    description: [
      'The courier tried and could not deliver — customer unreachable, delivery refused, wrong',
      'address. This is the most common Cash-on-Delivery exception, and legacy had no way to',
      'express it at all: the only options were to leave the order "shipped" forever or to mark it',
      '"delivered" untruthfully.',
      '',
      '`reason` is required and is recorded on the status history entry.',
      '`shipment.deliveryAttempts` increments; it is never reset, so the count reflects what the',
      'courier actually attempted.',
      '',
      'From here the order can be re-dispatched (`retry-shipment`) or written off as a return',
      '(`return`, which restores stock). Touches no stock itself — the goods have not come back yet.',
    ].join('\n'),
  })
  @ApiOkResponse({
    type: AdminOrderResponseDto,
    description: 'Recorded. `status` is `DELIVERY_FAILED` and `shipment.deliveryAttempts` grew by one.',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.badRequest })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.forbidden })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.notFound })
  @ApiConflictResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.conflict })
  async deliveryFailed(
    @Param() params: OrderIdParamDto,
    @Body() dto: DeliveryFailedDto,
    @CurrentUser() principal: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
    @RequestLocale() locale: Locale,
  ): Promise<AdminOrderResponseDto> {
    // The failure reason IS the note on this edge — there is no separate
    // cancellation-style record for a failed attempt.
    return this.run(params, principal, forensics, locale, OrderStatus.DELIVERY_FAILED, { note: dto.reason });
  }

  @Post(':id/retry-shipment')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Re-dispatch after a failed delivery (DELIVERY_FAILED → SHIPPED)',
    description: [
      'Sends the parcel out again. `carrier` and `trackingNumber` are **optional here and only',
      'here** — the order already has a shipment, so omitting them re-dispatches with the current',
      'carrier. Supply either to replace it, which is the usual case when a failed parcel is',
      'handed to a different courier.',
      '',
      '`shipment.shippedAt` is refreshed and `shipment.deliveredAt` is cleared.',
      '`shipment.deliveryAttempts` is **deliberately not reset** — it counts what the courier',
      'attempted, and zeroing it would erase the reason this order is going out again.',
      '',
      'Touches no stock.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminOrderResponseDto, description: 'Re-dispatched. `status` is `SHIPPED`.' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.badRequest })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.forbidden })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.notFound })
  @ApiConflictResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.conflict })
  async retryShipment(
    @Param() params: OrderIdParamDto,
    @Body() dto: RetryShipmentDto,
    @CurrentUser() principal: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
    @RequestLocale() locale: Locale,
  ): Promise<AdminOrderResponseDto> {
    return this.run(params, principal, forensics, locale, OrderStatus.SHIPPED, {
      note: dto.note ?? null,
      shipment: { carrier: dto.carrier, trackingNumber: dto.trackingNumber },
    });
  }

  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Record a return (DELIVERY_FAILED | DELIVERED → RETURNED)',
    description: [
      'The goods came back — either given up on after failed delivery attempts, or returned by a',
      'customer who had already received them.',
      '',
      '### This restores stock',
      '',
      'The ordered quantities go back to the catalogue, `salesCount` is reversed, and a positive',
      '`RETURN` entry is written to the inventory ledger — **all in one transaction with the',
      'status change**. Stock is restored exactly once no matter how many times this is called or',
      'how many calls arrive at once; a repeat returns `409`, never a second restoration.',
      '',
      '`RETURNED` is terminal. If the customer had already paid on delivery, `payment.status`',
      'stays `PAID` — a refund is an out-of-band bank transfer recorded separately, not something',
      'this operation performs.',
    ].join('\n'),
  })
  @ApiOkResponse({
    type: AdminOrderResponseDto,
    description: 'Returned. `status` is `RETURNED` and the stock is back in the catalogue.',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.badRequest })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.forbidden })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.notFound })
  @ApiConflictResponse({ type: ErrorResponseDto, description: LIFECYCLE_ERRORS.conflict })
  async returnOrder(
    @Param() params: OrderIdParamDto,
    @Body() dto: ReturnOrderDto,
    @CurrentUser() principal: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
    @RequestLocale() locale: Locale,
  ): Promise<AdminOrderResponseDto> {
    return this.run(params, principal, forensics, locale, OrderStatus.RETURNED, { note: dto.reason });
  }

  // --- internals ------------------------------------------------------------

  /**
   * The ONLY thing every lifecycle handler above does.
   *
   * It names a target status and hands off. There is no branch here on the
   * order's current status, no side-effect decision and no inventory call —
   * those belong to the engine and to the frozen matrix, and duplicating any of
   * them in a controller is exactly how legacy ended up with rules that the
   * database did not enforce.
   */
  private async run(
    params: OrderIdParamDto,
    principal: AuthenticatedUser,
    forensics: ForensicContext,
    locale: Locale,
    to: OrderStatus,
    input: {
      note?: string | null;
      shipment?: { carrier?: string | undefined; trackingNumber?: string | undefined };
    },
  ): Promise<AdminOrderResponseDto> {
    const order = await this.lifecycle.transitionByStaff({
      // From the TOKEN. No DTO here carries an actor, so the history trail
      // cannot be forged.
      actorId: new Types.ObjectId(principal.id),
      orderId: new Types.ObjectId(params.id),
      to,
      // From the TRANSPORT, never from a body. `userAgent` is the exact field
      // whose absence silently broke the legacy audit trail.
      context: forensics,
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.shipment !== undefined ? { shipment: input.shipment } : {}),
    });

    return { data: AdminOrderDto.from(order, locale) };
  }
}
