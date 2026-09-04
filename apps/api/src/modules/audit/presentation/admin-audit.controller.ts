import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { PaginationMetaDto } from '../../../common/dto/pagination-meta.dto';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import { AuditReaderService } from '../application/audit-reader.service';
import {
  AuditActionsResponseDto,
  AuditLogDto,
  AuditLogListResponseDto,
  AuditLogQueryDto,
} from './dto/admin-audit.dto';

const NO_STORE = 'no-store';

/**
 * Reading the security audit trail.
 *
 * Authority: docs/architecture/AUDIT-MODEL.md §8, which specifies this route and
 * its query parameters verbatim.
 *
 * ## Why this did not exist until now, and why it does
 *
 * `AuditModule` has carried the note since it was written: *"There is also no
 * controller yet. Reading the log is an admin screen and belongs with the rest
 * of the admin surface; writing it correctly is the part that had to exist
 * first."* Writing has existed for several phases, and every catalogue,
 * inventory, order and role change since then has been recorded — into a
 * collection nothing could read.
 *
 * The console meanwhile had an Audit Log screen reading Supabase
 * `admin_audit_logs`, a table that held **zero rows** and, since the acting
 * admin became an API account, cannot receive any: its `admin_id` has a foreign
 * key to Supabase `profiles`. So the console showed an empty audit log while
 * the real trail filled up beside it — which is the legacy failure mode
 * (§4: "read sixty-one times in that state") reproduced by a different
 * mechanism.
 *
 * ## There is no write path here, and there never will be
 *
 * §8: *write any audit record via API — **nobody**; delete or modify —
 * **nobody***. This controller exposes two `GET`s. `AuditModule` exports the
 * writer to the modules that audit and the reader only to this file, so nothing
 * that can write the trail can also list it, and nothing anywhere can change it.
 */
@ApiTags('admin · audit')
@ApiBearerAuth()
@Controller('admin/audit-logs')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
export class AdminAuditController {
  constructor(private readonly audit: AuditReaderService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'The audit trail, newest first',
    description: [
      'Every administrative action the system recorded: who, what, to which entity, from which',
      'address, and — where the operation had a before and an after — **which fields changed**.',
      '',
      'The actor is a SNAPSHOT, not a reference. §4 requires the record to stay readable after',
      'the actor is deleted or renamed, which is exactly when it is most likely to be wanted, so',
      'there is no join and no id to follow for a name.',
      '',
      'Filters: `actorId` ("what has this person done"), `action` ("every price change"),',
      '`entityType` + `entityId` ("what happened to this order"), and a `from`/`to` window. Each',
      'is served by one of the four frozen indexes.',
      '',
      '**There is no text search.** No index answers an unanchored pattern, so one would be a',
      'collection scan over two years of records on a screen an operator types into. The',
      'Supabase screen this replaces had one — against a table holding zero rows, so nobody ever',
      'discovered what it cost.',
      '',
      'The collection is APPEND-ONLY (§5 rule 4) and a two-year TTL is the only thing that ever',
      'removes a record. There is no write, update or delete route here or anywhere.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AuditLogListResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR / UNKNOWN_FIELD.',
  })
  async list(@Query() query: AuditLogQueryDto): Promise<AuditLogListResponseDto> {
    const page = await this.audit.list(query);

    return {
      data: page.items.map((log) => AuditLogDto.from(log)),
      meta: PaginationMetaDto.of(page.page, page.limit, page.total),
    };
  }

  @Get('actions')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'The actions actually present in the trail',
    description: [
      'For a filter dropdown. The vocabulary has thirty-odd members and most of them will never',
      'appear in a small shop’s log — offering all of them makes an operator choose between',
      'options that match nothing, which is how a filter becomes decoration.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AuditActionsResponseDto })
  async actions(): Promise<AuditActionsResponseDto> {
    return { data: await this.audit.actionsPresent() };
  }
}
