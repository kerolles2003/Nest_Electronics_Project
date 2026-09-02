import { Body, Controller, Header, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { Public } from '../../../common/decorators/public.decorator';
import { RequestLocale } from '../../../common/decorators/locale.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import type { Locale } from '../../../common/localization/locale';
import { CartService } from '../application/cart.service';
import { PreviewGuestCartDto } from './dto/cart-request.dto';
import { CartDto, CartResponseDto } from './dto/cart-response.dto';

/** Nothing here is stored, but the answer is per-basket. Never cache it. */
const NO_STORE = 'no-store';

/**
 * The anonymous half of the cart.
 *
 * ## Why it is a separate controller
 *
 * `CartController` carries `@Roles(Role.CUSTOMER)` on the class, which is what
 * makes every route on it require a signed-in customer. This route must NOT,
 * and the honest way to say so is a different controller rather than a
 * decorator on one handler quietly overriding the class it sits in — an
 * "except this one" hidden inside a guarded controller is exactly the kind of
 * thing a reader skims past.
 *
 * ## Why it exists at all
 *
 * A visitor with no account still has a basket, and it lives in their browser
 * holding `{productId, quantity}` — no price, no name, no stock. A price that
 * round-trips through `localStorage` is a price the customer can edit, so the
 * browser stores none, and something has to turn those ids into a cart it can
 * render. That has to be the server, and this is the route that does it.
 *
 * ## What it does not do
 *
 * It writes nothing, reserves nothing, and creates no cart document. Signing in
 * is what moves a basket into a real cart, and that path is the merge in the
 * storefront, not this endpoint.
 */
@ApiTags('cart')
@Controller('cart')
export class GuestCartController {
  constructor(private readonly cart: CartService) {}

  @Post('preview')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  /*
   * Public, unauthenticated and it reads the catalogue, so it gets a limit of
   * its own rather than the default allowance. Generous for a person — a
   * basket changes a handful of times a minute at most — and low enough that
   * it is not a free way to hammer the product collection.
   */
  @Throttle({ global: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Price an anonymous basket',
    description: [
      'Prices a visitor’s browser-held basket and returns it in **the same shape as**',
      '`GET /cart`, so a client renders one component for signed-in and anonymous visitors.',
      '',
      'Nothing is stored. No cart document is created, no stock is reserved, and calling it',
      'twice leaves no trace of either call.',
      '',
      '### Same resolution as a real cart',
      '',
      'Prices, names, images and availability are read from the catalogue on every request, and',
      'quantities are clamped to live stock with the same status ladder — so a basket does not',
      'change shape when its owner signs in.',
      '',
      '### Except that no line can be `PRICE_CHANGED`',
      '',
      'That status compares the live price against the price the customer was shown when they',
      'added the line, which a stored cart keeps as a snapshot. A browser basket has no such',
      'snapshot, so the comparison genuinely cannot be made and is not faked. Lines are',
      '`OK`, `REDUCED_STOCK`, `OUT_OF_STOCK` or `UNAVAILABLE`.',
      '',
      'Duplicate products in `items` are summed, matching what posting the same product twice',
      'to a real cart does. An empty array returns an empty cart rather than an error.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR (a malformed id, a quantity out of range, too many lines).',
  })
  async preview(
    @Body() dto: PreviewGuestCartDto,
    @RequestLocale() locale: Locale,
  ): Promise<CartResponseDto> {
    const view = await this.cart.previewGuestCart(
      dto.items.map((item) => ({
        productId: new Types.ObjectId(item.productId),
        quantity: item.quantity,
      })),
    );

    return { data: CartDto.from(view, locale) };
  }
}
