import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Types } from 'mongoose';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../../../common/decorators/idempotency-key.decorator';
import { RequestLocale } from '../../../common/decorators/locale.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { PaginationMetaDto } from '../../../common/dto/pagination-meta.dto';
import type { Locale } from '../../../common/localization/locale';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import { CheckoutService } from '../application/checkout.service';
import { OrderLifecycleService } from '../application/order-lifecycle.service';
import { OrdersService } from '../application/orders.service';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { PlaceOrderDto } from './dto/checkout-request.dto';
import { OrderHistoryQueryDto, OrderIdParamDto } from './dto/order-query.dto';
import { OrderDto, OrderResponseDto } from './dto/order-response.dto';
import { OrderHistoryResponseDto, OrderSummaryDto } from './dto/order-summary.dto';

const NO_STORE = 'no-store';

/**
 * The customer's own orders: place one, list them, read one.
 *
 * Authority: docs/architecture/API-CONTRACT.md §5.4; ORDER-LIFECYCLE.md §7, §13.
 *
 * THREE properties hold across every route here:
 *
 *  1. **`userId` comes from the token.** No DTO has such a field and no query
 *     parameter accepts one, so there is nothing for a caller to forge.
 *  2. **Ownership is a query condition, not a check.** A foreign order is never
 *     selected, rather than selected and then rejected — so it answers `404`,
 *     identically to an order that does not exist. A `403` would confirm the id.
 *  3. **Reads never touch the catalogue.** Every figure and every product
 *     detail comes from the order's own immutable snapshot.
 *
 * Still deliberately absent: `POST /orders/track` from the frozen contract, and
 * every admin route. Tracking is a PUBLIC, rate-limited surface with its own
 * minimal projection; admin operations reuse `OrderLifecycleService.transition`
 * but need their own authorization surface and DTOs.
 */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
@Roles(Role.CUSTOMER)
export class OrdersController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly orders: OrdersService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  @Post()
  @Header('Cache-Control', NO_STORE)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'A UUID identifying THIS checkout attempt. **Required.** Generate one when the customer ' +
      'opens the confirmation screen, and send the SAME value on every retry of that attempt — ' +
      'after a timeout, a dropped connection or a double tap. Generate a NEW one only for a ' +
      'genuinely new order.',
    schema: { type: 'string', format: 'uuid', example: '3f6c1e1e-6f3a-4a5f-9f0a-2b8f5c1d7e90' },
  })
  @ApiOperation({
    summary: 'Place an order',
    description: [
      'Creates one order from the signed-in customer cart, atomically: stock is decremented, the',
      'inventory ledger is written, the order is stored and the cart is emptied — **all in a',
      'single MongoDB transaction**. Any failure rolls back every part of it, so there is no state',
      'in which stock moved but no order exists, or the cart emptied but placement failed.',
      '',
      '### The client is authoritative for nothing that costs money',
      '',
      'The body carries the **id of one of your saved addresses** and an optional note. That is',
      'all. There is no `items`, no `price`, no `total`, no `currency`, no `status`, no `userId`',
      'and no `shippingAddress` field, and sending one returns `400 UNKNOWN_FIELD`. The item list',
      'comes from the server cart, prices from the catalogue, shipping from the server rate',
      'policy, identity from the token, and the status from the server.',
      '',
      '### The delivery address',
      '',
      'Send `addressId` from `GET /users/me/addresses`. It is resolved **inside the placement',
      'transaction**, through a query that names your account as well as the address, so an',
      'address belonging to somebody else is never selected — it returns `404 ADDRESS_NOT_FOUND`,',
      'the same answer an id that exists nowhere gets.',
      '',
      'The address is then **copied onto the order**. Editing or deleting the saved address',
      'afterwards does not change this order by one character, and the order stays fully',
      'renderable even after the address is gone.',
      '',
      '### Idempotency — read this before implementing retries',
      '',
      '`Idempotency-Key` is **mandatory**; without it the request is rejected `400`. A timeout does',
      'not tell you whether the server committed, so retry with the SAME key and one of two things',
      'happens, both correct:',
      '',
      '- the original attempt had committed — you receive **200** with that exact order;',
      '- it had not — the retry places the order and you receive **201**.',
      '',
      '**The response body is identical in both cases**, so treat any 2xx as success and parse one',
      'model. Two concurrent requests with one key produce **one** order; the loser receives the',
      'winner result. A key is bound to the account that first used it and to the request body it',
      'was first used with — replaying it with a different address returns `409`, and a key',
      'belonging to another account is refused without revealing anything about it.',
      '',
      'Keys are remembered for 24 hours. Beyond that a replay still cannot create a second order:',
      '`orders.idempotencyKey` is unique permanently.',
      '',
      '### Failures worth handling explicitly',
      '',
      '- `422 CART_EMPTY` — nothing to order.',
      '- `409 OUT_OF_STOCK` — someone bought it first. `details` names the SKU and what is left.',
      '  Nothing was reserved and nothing was charged; refresh the quote.',
      '- `409 PRODUCT_UNAVAILABLE` — a line was delisted or removed.',
      '- `409 CONCURRENT_MODIFICATION` — retrying with the same key is safe.',
      '',
      '`pricing.shippingFee` is computed by the server from the chosen address and the order',
      'value. It is `0` under the current configuration, which is the honest number rather than a',
      'promotional one — the per-governorate rate table is unresolved business input. Payment is',
      'Cash on Delivery: nothing is charged now, and `payment.status` stays `PENDING` until the',
      'courier collects.',
    ].join('\n'),
  })
  @ApiCreatedResponse({ type: OrderResponseDto, description: 'The order was created by THIS request.' })
  @ApiOkResponse({
    type: OrderResponseDto,
    description:
      'IDEMPOTENT REPLAY — this key had already created an order, which is returned unchanged. ' +
      'Identical body to the 201.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'MISSING_IDEMPOTENCY_KEY — the header was absent. VALIDATION_ERROR — the key is not a UUID, ' +
      'or `addressId` is not a 24-character hex string. UNKNOWN_FIELD — the body carried a price, ' +
      'total, item list, status, userId, or an inline `shippingAddress` object.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'FORBIDDEN — orders are placed by CUSTOMER accounts. ACCOUNT_DISABLED.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'OUT_OF_STOCK — insufficient stock; `details` names the SKU and the available quantity. ' +
      'PRODUCT_UNAVAILABLE — a line is delisted or deleted. ' +
      'IDEMPOTENCY_KEY_REUSED — this key was already used for a different request, or by another ' +
      'account. CONCURRENT_MODIFICATION — a transient race; retry with the same key.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'ADDRESS_NOT_FOUND — `addressId` is not one of your saved addresses. Deliberately the same ' +
      'answer for an address that belongs to another customer and one that does not exist.',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'CART_EMPTY — there is nothing in the cart to order.',
  })
  async place(
    @Body() dto: PlaceOrderDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() principal: AuthenticatedUser,
    @RequestLocale() locale: Locale,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OrderResponseDto> {
    const outcome = await this.checkout.placeOrder({
      // From the TOKEN. `PlaceOrderDto` has no userId field, so there is nothing
      // to forge — the structural fix for the legacy RPC that accepted
      // `p_user_id` and never compared it to the caller.
      userId: new Types.ObjectId(principal.id),
      idempotencyKey,
      // An ID, not an address. Ownership is enforced by the query that resolves
      // it inside the placement transaction, so a foreign id never reaches an
      // order — and the client has no field with which to describe a delivery
      // address at all.
      addressId: new Types.ObjectId(dto.addressId),
      customerNote: dto.customerNote ?? null,
    });

    // 201 on creation, 200 on a replay — the frozen contract
    // (CONSISTENCY-MODEL.md §4: "a replay returns the original order with 200").
    // The BODY is identical either way, which is the property that makes a safe
    // client retry easy to write: any 2xx is success, one model to parse.
    response.status(outcome.replayed ? HttpStatus.OK : HttpStatus.CREATED);

    return { data: OrderDto.from(outcome.order, locale) };
  }

  @Get()
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'List my orders',
    description: [
      'The signed-in customer’s own order history, **newest first**, paginated. Never anybody',
      'else’s: the account is taken from the token and is part of the database query, so there',
      'is no parameter that could widen it.',
      '',
      '### Ordering and pagination',
      '',
      'Sorted by `placedAt` descending, with the order id as a tie-breaker. That second key',
      'matters: two orders placed in the same millisecond would otherwise have no defined',
      'relative order, and a row could appear on two pages or on none. The ordering here is',
      'stable across requests, so paging through it is safe.',
      '',
      'Standard offset pagination: `?page=1&limit=24` (`limit` 1–100). `meta.total` is the TRUE',
      'match count across all pages — use `meta.hasNext` to decide whether to load more.',
      '',
      '### Filtering',
      '',
      '`?status=` is repeatable and matches ANY of the given values, so one request backs an',
      '"active orders" tab: `?status=PLACED&status=CONFIRMED&status=SHIPPED`. Omit it for every',
      'status. An unrecognised value is a `400`, never a silently empty page.',
      '',
      '### What a row contains',
      '',
      'A deliberately compact card: id, order number, status, payment, the full money breakdown,',
      'item counts, a thumbnail and the date. Line items, the delivery address and the customer',
      'block are on the detail endpoint — call `GET /orders/{id}` for those.',
      '',
      'Every value comes from the order’s own immutable snapshot. Nothing here is read from the',
      'catalogue, so a product that was renamed, repriced or deleted after the order cannot',
      'change this list.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: OrderHistoryResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_ERROR — a bad `page`, `limit` or `status` value. ' +
      'UNKNOWN_FIELD — an undocumented query parameter, including any attempt to send `userId`.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'FORBIDDEN — order history belongs to CUSTOMER accounts.',
  })
  async list(
    @Query() query: OrderHistoryQueryDto,
    @CurrentUser() principal: AuthenticatedUser,
  ): Promise<OrderHistoryResponseDto> {
    const outcome = await this.orders.listForCustomer(new Types.ObjectId(principal.id), {
      ...(query.status !== undefined ? { statuses: query.status } : {}),
      ...(query.page !== undefined ? { page: query.page } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });

    return {
      data: outcome.items.map((row) => OrderSummaryDto.from(row)),
      meta: PaginationMetaDto.of(outcome.page, outcome.limit, outcome.total),
    };
  }

  @Get(':id')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Get one of my orders',
    description: [
      'The complete customer-facing detail for ONE of the signed-in customer’s orders: line',
      'items, the money breakdown, payment, and the delivery address the goods were sent to.',
      '',
      'The response is the **same `OrderDto`** that `POST /orders` returns, so the order-success',
      'screen and the order-detail screen generate and share a single Dart model.',
      '',
      '### 404 covers two cases on purpose',
      '',
      'An order that does not exist and an order belonging to another customer return exactly the',
      'same response. There is no way to tell them apart, which is the point — a `403` would',
      'confirm that an id is real and turn this endpoint into an oracle for other people’s orders.',
      '',
      '### Everything is a snapshot',
      '',
      'The line items are what was actually sold: the name, SKU, slug, image and unit price AS OF',
      'the moment the order was placed. They are stored on the order and no product is read to',
      'serve this request. **Never re-fetch a product to render an order** — a catalogue price is',
      'not what the customer agreed to pay, and a deleted product must not break their receipt.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR — `id` is not a 24-character hex id.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'FORBIDDEN' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'ORDER_NOT_FOUND — no such order, OR it belongs to another customer. Deliberately the ' +
      'same answer for both.',
  })
  async detail(
    @Param() params: OrderIdParamDto,
    @CurrentUser() principal: AuthenticatedUser,
    @RequestLocale() locale: Locale,
  ): Promise<OrderResponseDto> {
    const order = await this.orders.findForCustomer(
      new Types.ObjectId(principal.id),
      new Types.ObjectId(params.id),
    );

    return { data: OrderDto.from(order, locale) };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Cancel one of my orders',
    description: [
      'Cancels an order the signed-in customer placed, and **returns its stock to the catalogue**',
      '— the status change, the history entry, the stock restoration and the inventory ledger',
      'entries all commit in a **single MongoDB transaction**, or none of them do.',
      '',
      '### Only before dispatch',
      '',
      'Cancellation is possible while the order is `PLACED` or `CONFIRMED`. Once it is `SHIPPED`',
      'the goods are with the courier and the answer is `409 ORDER_NOT_CANCELLABLE`; the correct',
      'path from there is a failed delivery or a return, both driven by the shop. Show the cancel',
      'button only for those two statuses, and treat the 409 as the authority rather than trusting',
      'a status the client may have been holding for a while.',
      '',
      '### Sending it twice is safe',
      '',
      'The second request returns `409 ORDER_NOT_CANCELLABLE` with `details` naming the current',
      'status — **not** a second cancellation. Stock is restored exactly once no matter how many',
      'times the request arrives, or how many arrive simultaneously. There is no',
      '`Idempotency-Key` here and none is needed: unlike placement, a repeat cannot create a',
      'second anything.',
      '',
      '### Response',
      '',
      'The canonical `OrderDto` — the same model `POST /orders` and `GET /orders/{id}` return —',
      'with `status: "CANCELLED"` and the `cancellation` block populated. Re-render from it',
      'directly rather than re-fetching.',
    ].join('\n'),
  })
  @ApiOkResponse({
    type: OrderResponseDto,
    description: 'Cancelled. `status` is `CANCELLED` and `cancellation` is populated.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_ERROR — `id` is not a 24-character hex id, or `reason` is missing, too short ' +
      'or too long. UNKNOWN_FIELD — the body carried a field other than `reason`, including any ' +
      'attempt to send a `status`.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'FORBIDDEN — cancellation is a CUSTOMER action. ACCOUNT_DISABLED.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'ORDER_NOT_FOUND — no such order, OR it belongs to another customer. Deliberately the ' +
      'same answer for both.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'ORDER_NOT_CANCELLABLE — the order has already been dispatched, delivered, returned, or ' +
      'was already cancelled. `details` names the current status. Do NOT retry — this never ' +
      'succeeds. CONCURRENT_MODIFICATION — the order changed status during this request; re-read ' +
      'it and decide again.',
  })
  async cancel(
    @Param() params: OrderIdParamDto,
    @Body() dto: CancelOrderDto,
    @CurrentUser() principal: AuthenticatedUser,
    @RequestLocale() locale: Locale,
  ): Promise<OrderResponseDto> {
    const order = await this.lifecycle.cancelForCustomer(
      // From the TOKEN, and it becomes a condition of BOTH the lookup and the
      // guarded update — never a comparison performed after loading the order.
      new Types.ObjectId(principal.id),
      new Types.ObjectId(params.id),
      dto.reason,
    );

    return { data: OrderDto.from(order, locale) };
  }
}
