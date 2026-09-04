import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequestLocale } from '../../../common/decorators/locale.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import type { Locale } from '../../../common/localization/locale';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import { DashboardAdminService } from '../application/dashboard-admin.service';
import {
  AdminDashboardStatsResponseDto,
  DashboardStatsQueryDto,
} from './dto/admin-dashboard-stats.dto';

const NO_STORE = 'no-store';

/**
 * Administrative dashboard statistics endpoint.
 *
 * Authority: docs/architecture/API-CONTRACT.md §5.4;
 *            ORDER-LIFECYCLE.md §"Payment status";
 *            ADR-ORDER-002;
 *            MONEY-MODEL.md §8.
 *
 * Replaces disparate queries with a unified server-side aggregation.
 * Revenue is counted at DELIVERY (COD payment event), with pipeline value
 * tracked alongside.
 *
 * Order figures are bounded by a trailing window, 30 days by default. That is
 * the better answer to an operator's question and it is what stops this
 * endpoint reading the whole `orders` collection on every load — see
 * `orders/domain/dashboard-window.ts`.
 */
@ApiTags('admin · dashboard')
@ApiBearerAuth()
@Controller('admin/dashboard')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class AdminDashboardController {
  constructor(private readonly dashboardService: DashboardAdminService) {}

  @Get('stats')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Administrative dashboard aggregate statistics',
    description: [
      'Returns consolidated system metrics for the admin console dashboard:',
      '- Revenue recognised at DELIVERY (where payment.status = PAID).',
      '- Pipeline value for orders in-flight (PLACED, CONFIRMED, SHIPPED, DELIVERY_FAILED).',
      '- Orders count breakdown across all 7 lifecycle statuses.',
      '- Products summary: active total, low-stock count, and top low-stock items.',
      '- Customers summary: total registered, new accounts this week, and count with orders.',
      '',
      'Every ORDER figure is bounded by a trailing window — **30 days by default**, with',
      '`?window=90d` and `?window=all` available. The window comes back in `data.window`,',
      'whose `label` is what a console should print: the bound is on `placedAt`, so it',
      'reads "orders placed in the last 30 days" rather than implying the delivery date',
      'it is not.',
      '',
      'Product and customer TOTALS are current-state and are NOT windowed — a trailing',
      '30-day version of "how many active products are there" is not a question.',
      '`customers.withOrdersCount` does move with the window.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminDashboardStatsResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  async stats(
    @RequestLocale() locale: Locale,
    @Query() query: DashboardStatsQueryDto,
  ): Promise<AdminDashboardStatsResponseDto> {
    const data = await this.dashboardService.getStats(locale, query.window);
    return { data };
  }
}
