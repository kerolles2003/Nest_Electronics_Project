import { Body, Controller, Header, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestLocale } from '../../../common/decorators/locale.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import type { Locale } from '../../../common/localization/locale';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import { CheckoutService } from '../application/checkout.service';
import { CheckoutQuoteDto } from './dto/checkout-request.dto';
import { CheckoutQuoteResponseDto, CheckoutQuoteViewDto } from './dto/quote-response.dto';

/** Per-customer and recomputed every request. Nothing may cache a quote. */
const NO_STORE = 'no-store';

/**
 * The checkout quote.
 *
 * Authority: docs/architecture/API-CONTRACT.md §5.4; CART-MODEL.md §9.
 *
 * Separate from `/orders` because a quote and a placement are different
 * operations with different guarantees, and merging them is how a "preview"
 * ends up creating something.
 */
@ApiTags('checkout')
@ApiBearerAuth()
@Controller('checkout')
@Roles(Role.CUSTOMER)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Quote the current cart',
    description: [
      'Returns the **authoritative** money breakdown for the signed-in customer’s cart, with',
      'per-line status flags. Every figure is recomputed from live catalogue data on this',
      'request; nothing stored is returned, and the client never adds anything up itself.',
      '',
      '### What this is NOT',
      '',
      '- **Not a reservation.** No stock is held. Another customer may buy the last unit one',
      '  millisecond later.',
      '- **Not a lock, and not a payment authorisation.**',
      '- **Not a promise that `POST /orders` will succeed.** Placement independently revalidates',
      '  everything inside a transaction and may still return `409 OUT_OF_STOCK`.',
      '- **Not persisted.** There is no quote id and nothing to send back. Placement ignores any',
      '  totals a client might have kept.',
      '',
      '### Reading the result',
      '',
      '- `canPlaceOrder` — whether placement would be accepted right now. Use it for the button.',
      '- `pricing.grandTotal` — the cash amount due on delivery. **Never compute this locally.**',
      '- `pricing.shippingFee` is computed by the server. Pass `addressId` and it is quoted',
      '  against that address governorate — the same calculation `POST /orders` applies, so the',
      '  two agree. Omit it before the customer has chosen an address. `discountTotal` is always',
      '  `0` in this release: no coupon domain exists yet.',
      '- A `PRICE_CHANGED` line is included at the NEW price — compare `unitPrice` with',
      '  `previousUnitPrice` to tell the customer before they commit.',
      '',
      'POST rather than GET because the frozen contract shapes this as a body-carrying request.',
      'It has **no side effects** and writes nothing.',
      '',
      'The body accepts `addressId` and nothing else. Sending `couponCode` returns',
      '`400 UNKNOWN_FIELD` rather than being silently ignored, so a client is never left believing',
      'it applied a discount that was never validated; a raw `governorate` is refused for a second',
      'reason — the saved address is the authority for it, and accepting free text would let a',
      'client shop for a cheaper delivery fee.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: CheckoutQuoteResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_ERROR — `addressId` is not a 24-character hex string. ' +
      'UNKNOWN_FIELD — the body carried a field this endpoint does not accept, such as a price, ' +
      'a total, `governorate`, `couponCode` or `userId`.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'UNAUTHENTICATED, TOKEN_EXPIRED or TOKEN_INVALID',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'FORBIDDEN — checkout belongs to CUSTOMER accounts.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'ADDRESS_NOT_FOUND — `addressId` is not one of your saved addresses. The same answer for ' +
      'an address belonging to another customer and one that does not exist.',
  })
  async quote(
    @Body() body: CheckoutQuoteDto,
    @CurrentUser() principal: AuthenticatedUser,
    @RequestLocale() locale: Locale,
  ): Promise<CheckoutQuoteResponseDto> {
    const quote = await this.checkout.quote(
      new Types.ObjectId(principal.id),
      body.addressId === undefined ? null : new Types.ObjectId(body.addressId),
    );

    return { data: CheckoutQuoteViewDto.from(quote, locale) };
  }
}
