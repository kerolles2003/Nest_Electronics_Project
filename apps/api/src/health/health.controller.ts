import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthResponseDto } from './health.response.dto';

/**
 * Liveness only.
 *
 * Deliberately has NO dependencies: it proves the HTTP runtime is up and
 * answering, nothing more. Readiness (`GET /health/ready`, asserting Mongo
 * — including replica-set availability — and Cloudinary via @nestjs/terminus)
 * arrives with those dependencies in a later phase.
 *
 * Authority: docs/architecture/API-STANDARDS.md §10;
 *            docs/architecture/NESTJS-MODULE-MAP.md §4.15.
 */
@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Returns 200 while the HTTP runtime is accepting requests. Requires no authentication.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  check(): HealthResponseDto {
    return { status: 'ok' };
  }
}
