import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
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
import { Roles } from '../../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { RequestLocale } from '../../../common/decorators/locale.decorator';
import type { Locale } from '../../../common/localization/locale';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import { CartService } from '../application/cart.service';
import { AddCartItemDto, CartItemParamDto, UpdateCartItemDto } from './dto/cart-request.dto';
import { CartDto, CartResponseDto } from './dto/cart-response.dto';

/** A cart is per-customer and re-priced every request. Nothing may cache it. */
const NO_STORE = 'no-store';

/**
 * The authenticated customer's cart.
 *
 * Authority: docs/architecture/CART-MODEL.md; API-CONTRACT.md §5.3.
 *
 * Three properties hold across every route here:
 *
 *  1. **`userId` comes from the JWT.** No DTO has such a field and no route
 *     takes a cart id, so there is nothing for a caller to forge — the direct
 *     structural fix for the legacy defect where an order RPC accepted
 *     `p_user_id` and never compared it to the caller.
 *  2. **Every response is the WHOLE cart**, in one shape. A client replaces its
 *     state after any mutation and never merges a partial response.
 *  3. **The client sends only a product id and a quantity.** Price, currency,
 *     availability and stock are read from the database on every call.
 */
@ApiTags('cart')
@ApiBearerAuth()
@Controller('cart')
@Roles(Role.CUSTOMER)
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Get the cart',
    description: [
      'Returns the cart, **re-priced and re-checked against live catalogue data on every**',
      '**request**. Stored numbers are never returned.',
      '',
      'A customer who has never added anything gets an empty cart, not a 404 — the underlying',
      'document is created lazily on the first add.',
      '',
      'Lines whose product went out of stock or was delisted are KEPT and flagged rather than',
      'deleted, so the customer can see why the total changed. They are excluded from',
      '`itemsSubtotal` and set `hasBlockingIssues`.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'UNAUTHENTICATED, TOKEN_EXPIRED or TOKEN_INVALID' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'FORBIDDEN — carts belong to CUSTOMER accounts.' })
  async get(
    @CurrentUser() principal: AuthenticatedUser,
    @RequestLocale() locale: Locale,
  ): Promise<CartResponseDto> {
    return { data: CartDto.from(await this.cart.getCart(new Types.ObjectId(principal.id)), locale) };
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Add a product to the cart',
    description: [
      '`quantity` is **additive**: sending 2 for a product already at 3 gives 5. There is never',
      'more than one line per product, under any amount of concurrency.',
      '',
      'The result is capped at `min(99, available stock)`. A cap is **not silent** — the response',
      'carries the resulting `quantity` and flags the line `REDUCED_STOCK` when stock was the',
      'binding constraint, so the client can tell the customer.',
      '',
      'Returns 200 with the whole cart rather than 201: the resource being returned is the cart,',
      'which already existed or was created implicitly, not a separately addressable line.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR, or UNKNOWN_FIELD if the body carries a price, currency or userId.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'FORBIDDEN' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'PRODUCT_NOT_FOUND' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'OUT_OF_STOCK — nothing on hand; `details` names the SKU and the available quantity. ' +
      'PRODUCT_UNAVAILABLE — the product is delisted or deleted.',
  })
  async add(
    @Body() dto: AddCartItemDto,
    @CurrentUser() principal: AuthenticatedUser,
    @RequestLocale() locale: Locale,
  ): Promise<CartResponseDto> {
    const cart = await this.cart.addItem(
      new Types.ObjectId(principal.id),
      new Types.ObjectId(dto.productId),
      dto.quantity,
    );

    return { data: CartDto.from(cart, locale) };
  }

  @Patch('items/:productId')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Set a line to an exact quantity',
    description: [
      '`quantity` here is **absolute**, not a delta, and is clamped to available stock.',
      '',
      '`0` is rejected by validation: removing a line is `DELETE`, which is idempotent, whereas',
      'a 0 would quietly overload this endpoint with two different meanings.',
      '',
      'Returns `404 CART_ITEM_NOT_FOUND` when the product is not already in the cart — use',
      '`POST /cart/items` to add it.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR or UNKNOWN_FIELD' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'FORBIDDEN' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'PRODUCT_NOT_FOUND, or CART_ITEM_NOT_FOUND when the product is not in this cart.',
  })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'OUT_OF_STOCK or PRODUCT_UNAVAILABLE' })
  async update(
    @Param() params: CartItemParamDto,
    @Body() dto: UpdateCartItemDto,
    @CurrentUser() principal: AuthenticatedUser,
    @RequestLocale() locale: Locale,
  ): Promise<CartResponseDto> {
    const cart = await this.cart.updateQuantity(
      new Types.ObjectId(principal.id),
      new Types.ObjectId(params.productId),
      dto.quantity,
    );

    return { data: CartDto.from(cart, locale) };
  }

  @Delete('items/:productId')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Remove a line',
    description:
      '**Idempotent**: removing a product that is not in the cart still returns 200 with the ' +
      'cart, because the caller’s intent is already satisfied. Returns the whole cart rather ' +
      'than 204 so the client gets the recomputed subtotal without a second round trip.',
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'FORBIDDEN' })
  async remove(
    @Param() params: CartItemParamDto,
    @CurrentUser() principal: AuthenticatedUser,
    @RequestLocale() locale: Locale,
  ): Promise<CartResponseDto> {
    const cart = await this.cart.removeItem(
      new Types.ObjectId(principal.id),
      new Types.ObjectId(params.productId),
    );

    return { data: CartDto.from(cart, locale) };
  }

  @Delete()
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Empty the cart',
    description: 'Idempotent, including for a customer who has never had a cart.',
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'FORBIDDEN' })
  async clear(
    @CurrentUser() principal: AuthenticatedUser,
    @RequestLocale() locale: Locale,
  ): Promise<CartResponseDto> {
    return {
      data: CartDto.from(await this.cart.clear(new Types.ObjectId(principal.id)), locale),
    };
  }
}
