import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import { SlugService } from '../application/slug.service';
import {
  SlugAvailabilityQueryDto,
  SlugAvailabilityResponseDto,
} from './dto/slug-availability.dto';

/** Never cached: an answer about uniqueness is stale the moment it is given. */
const NO_STORE = 'no-store';

/**
 * Admin catalogue helpers that are not CRUD.
 *
 * Currently one endpoint: is this slug free. It exists because the admin form
 * asks before it submits, and because the version it replaces was wrong in a
 * way that only showed up under failure.
 */
@ApiTags('admin · catalogue')
@Controller('admin/catalog')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class AdminCatalogController {
  constructor(private readonly slugs: SlugService) {}

  @Get('slug-availability')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Is this slug free',
    description: [
      'Answers whether a slug is available for a product, category or brand, and offers the',
      'next free alternative when it is not — `esp32-devkit-2`, per CATALOG-MODEL.md §2.',
      '',
      'Pass `excludeId` when EDITING an existing entity, or it will report its own slug as',
      'taken and every save of an unchanged product will be refused.',
      '',
      '**This endpoint fails closed.** The admin route it replaces answered "available" on',
      'every failure path — a database error, a missing service, any exception — so a check',
      'that could not reach the database told the operator their slug was free. The form is',
      'built to trust this answer, which makes a wrong "available" worse than no check at all.',
      'A failure here is a 5xx.',
      '',
      'A soft-deleted entity still holds its slug. Reusing it would silently repoint every',
      'existing link to a different product.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: SlugAvailabilityResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_ERROR — a malformed slug or an unknown `type`. ' +
      'UNKNOWN_FIELD — an undocumented query parameter.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  async slugAvailability(
    @Query() query: SlugAvailabilityQueryDto,
  ): Promise<SlugAvailabilityResponseDto> {
    /*
     * No try/catch, deliberately. See the description above: swallowing a
     * failure here is the exact defect this replaces.
     */
    return {
      data: await this.slugs.check(
        query.type,
        query.slug,
        query.excludeId === undefined ? undefined : new Types.ObjectId(query.excludeId),
      ),
    };
  }
}
