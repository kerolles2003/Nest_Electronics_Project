import { Controller, Get, Header } from '@nestjs/common';
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
import { AdminDashboardStatsResponseDto } from './dto/admin-dashboard-stats.dto';

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
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminDashboardStatsResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  async stats(@RequestLocale() locale: Locale): Promise<AdminDashboardStatsResponseDto> {
    const data = await this.dashboardService.getStats(locale);
    return { data };
  }
}
