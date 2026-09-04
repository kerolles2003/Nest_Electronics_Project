import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
} from '@nestjs/common';
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
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import { ShippingRatesAdminService } from '../application/shipping-rates-admin.service';
import {
  AdminShippingRateDto,
  AdminShippingRateListResponseDto,
  AdminShippingRateResponseDto,
  ShippingRateGovernorateParamDto,
  UpdateShippingRateDto,
} from './dto/admin-shipping-rate.dto';

const NO_STORE = 'no-store';

/**
 * Staff management of delivery fees by governorate.
 *
 * Authority: docs/architecture/MONEY-MODEL.md §6; PLAN.md Phase 7, D-8 second half.
 *
 * ## The D-8 invariants
 *
 * 1. 27 rows, one per Egyptian governorate, with no default/fallback row.
 * 2. Lookup miss at checkout raises 500, so row deletion is refused.
 * 3. Editing a rate is audited under `SHIPPING_RATE_CHANGED`.
 * 4. Free shipping is configured by setting `fee: 0`.
 */
@ApiTags('admin · shipping-rates')
@ApiBearerAuth()
@Controller('admin/shipping-rates')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class AdminShippingRatesController {
  constructor(private readonly shippingAdmin: ShippingRatesAdminService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'List all shipping rates',
    description: 'Returns all 27 Egyptian governorates and their current delivery fees, sorted by governorate name.',
  })
  @ApiOkResponse({ type: AdminShippingRateListResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  async list(): Promise<AdminShippingRateListResponseDto> {
    const rates = await this.shippingAdmin.list();
    return { data: rates.map((rate) => AdminShippingRateDto.from(rate)) };
  }

  @Get(':governorate')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Get shipping rate for one governorate',
    description: 'Returns the delivery fee for a specific governorate.',
  })
  @ApiOkResponse({ type: AdminShippingRateResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Unknown governorate.' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'RESOURCE_NOT_FOUND.' })
  async findByGovernorate(
    @Param() params: ShippingRateGovernorateParamDto,
  ): Promise<AdminShippingRateResponseDto> {
    const rate = await this.shippingAdmin.findByGovernorate(params.governorate);
    return { data: AdminShippingRateDto.from(rate) };
  }

  @Patch(':governorate')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Update delivery fee for a governorate',
    description: [
      'Updates the delivery fee for the specified governorate.',
      'The fee must be an integer >= 0 in minor units (piastres).',
      'Emits a `SHIPPING_RATE_CHANGED` audit record.',
      'Subsequent quotes during customer checkout will immediately use the new fee.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminShippingRateResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR / UNKNOWN_FIELD.' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'RESOURCE_NOT_FOUND.' })
  async update(
    @Param() params: ShippingRateGovernorateParamDto,
    @Body() body: UpdateShippingRateDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminShippingRateResponseDto> {
    const updated = await this.shippingAdmin.updateFee(params.governorate, body.fee, {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminShippingRateDto.from(updated) };
  }

  @Delete(':governorate')
  @ApiOperation({
    summary: 'Delete a shipping rate (refused)',
    description:
      'Always refused with 409 CANNOT_DELETE_SHIPPING_RATE. Every Egyptian governorate must have an explicit ' +
      'rate configured because checkout misses raise. To offer free shipping, set fee to 0.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'CANNOT_DELETE_SHIPPING_RATE — deletion is refused by invariant D-8.',
  })
  delete(@Param() params: ShippingRateGovernorateParamDto): never {
    void params;
    return this.shippingAdmin.delete();
  }
}
