import { Body, Controller, Delete, Get, Header, Param, Patch, Query } from '@nestjs/common';
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
import { PaginationMetaDto } from '../../../common/dto/pagination-meta.dto';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user';
import { CustomersAdminService } from '../application/customers-admin.service';
import { Role } from '../infrastructure/schemas/user.schema';
import {
  AdminCustomerDetailDto,
  AdminCustomerDto,
  AdminCustomerListResponseDto,
  AdminCustomerResponseDto,
  ChangeRoleDto,
  CustomerIdParamDto,
  CustomerQueryDto,
} from './dto/admin-customer.dto';

const NO_STORE = 'no-store';

/**
 * The people list, and the two operations only a `SUPER_ADMIN` may perform.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §3; PLAN.md Phase 7.
 *
 * ## The separation legacy declared and never enforced
 *
 * §3's table gives four operations as `SUPER_ADMIN` only, and two of them are
 * here: **change a user's role** and **delete a user**. Legacy declared both
 * roles and then treated them identically in `is_admin()` and
 * `requireAdmin()` — the distinction existed in three places and was enforced
 * in none. Here it is a decorator on the route, so it is visible in the route
 * table rather than buried in a branch.
 *
 * ## Called "customers" because that is almost all of it
 *
 * Staff accounts are in the same collection and the same list; `?role=` finds
 * them. A separate staff screen would be a second view of one collection with
 * its own filters to drift.
 */
@ApiTags('admin · customers')
@ApiBearerAuth()
@Controller('admin/customers')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class AdminCustomersController {
  constructor(private readonly customers: CustomersAdminService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Every account, newest first',
    description: [
      'Each row carries its order count and its lifetime spend, computed in ONE aggregation for',
      'the whole page rather than two queries per row — the shape that made the legacy customer',
      'screen slow enough to notice.',
      '',
      'The two numbers follow different rules on purpose. `orderCount` counts every order the',
      'account placed, whatever became of it. `totalSpent` counts only what was PAID, which',
      'under COD means DELIVERED — a cancelled order is not spending, and neither is one still',
      'out with a courier.',
      '',
      'Search matches email, name, and phone by digits. Accounts that have never ordered are in',
      'the list: an operator looking for a customer who has not bought anything yet is a',
      'completely ordinary thing, and aggregating first would have excluded all of them.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminCustomerListResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR / UNKNOWN_FIELD.' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  async list(@Query() query: CustomerQueryDto): Promise<AdminCustomerListResponseDto> {
    const page = await this.customers.list(query);

    return {
      data: page.items.map((item) => AdminCustomerDto.from(item)),
      meta: PaginationMetaDto.of(page.page, page.limit, page.total),
    };
  }

  @Get(':id')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'One account, with its address book',
    description:
      'The address book is on the detail and not on the list, because a list of accounts each ' +
      'carrying up to ten addresses is a page of data nobody reads. `passwordHash` is absent ' +
      'from this type by construction — see the DTO.',
  })
  @ApiOkResponse({ type: AdminCustomerResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'RESOURCE_NOT_FOUND.' })
  async detail(@Param() params: CustomerIdParamDto): Promise<AdminCustomerResponseDto> {
    const summary = await this.customers.findById(new Types.ObjectId(params.id));

    return { data: AdminCustomerDetailDto.fromDetail(summary) };
  }

  @Patch(':id/role')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Change an account’s role',
    description: [
      '**`SUPER_ADMIN` only** — AUTHORIZATION-MODEL.md §3. An ADMIN gets 403 here and 200 on',
      'every other admin route, which is the separation legacy declared in three places and',
      'enforced in none.',
      '',
      '**Every access token the account holds stops working immediately.** `role` is a JWT claim,',
      'carried so the guard needs no per-request lookup — legacy looked it up on EVERY request',
      'and made `profiles_pkey` the hottest index in the database at 2,719 scans. The cost of',
      'that design is that a demoted admin would keep a working admin token for up to fifteen',
      'minutes; incrementing `tokenVersion` is the escape hatch the schema documents for exactly',
      'this case, and it happens in the SAME update as the role change so there is no window',
      'between them.',
      '',
      'Three refusals: you cannot change your own role (the one role change with no reviewer);',
      'you cannot demote the last SUPER_ADMIN (§3 — "the last super-admin must always exist",',
      'and no endpoint can grant the role without already holding it); and setting the role an',
      'account already has writes no audit row, because a row recording that nothing changed is',
      'noise in a log kept for two years.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminCustomerResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR / UNKNOWN_FIELD.' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'FORBIDDEN — SUPER_ADMIN only. An ADMIN may read this list and change nothing in it.',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'RESOURCE_NOT_FOUND.' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'CANNOT_MODIFY_OWN_ACCOUNT — you cannot change your own role. ' +
      'LAST_SUPER_ADMIN — promote somebody else first.',
  })
  async changeRole(
    @Param() params: CustomerIdParamDto,
    @Body() body: ChangeRoleDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminCustomerResponseDto> {
    const summary = await this.customers.changeRole(new Types.ObjectId(params.id), body.role, {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminCustomerDetailDto.fromDetail(summary) };
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Delete an account (soft)',
    description: [
      '**`SUPER_ADMIN` only.** Sets `deletedAt` and increments `tokenVersion`, so the account',
      'stops being able to authenticate immediately rather than in a quarter of an hour.',
      '',
      'A soft-deleted account can never log in, and the check happens AFTER password',
      'verification so the response cannot be used to enumerate accounts.',
      '',
      '**Their orders are untouched.** An order is an immutable commercial record carrying its',
      'own customer snapshot, so it still reads correctly after the account is gone — which is',
      'the whole reason the snapshot exists rather than a join.',
      '',
      'You cannot delete your own account, and you cannot delete the last SUPER_ADMIN.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminCustomerResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'FORBIDDEN — SUPER_ADMIN only.' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'RESOURCE_NOT_FOUND — no such account, or it is already deleted.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'CANNOT_MODIFY_OWN_ACCOUNT. LAST_SUPER_ADMIN.',
  })
  async remove(
    @Param() params: CustomerIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminCustomerResponseDto> {
    const summary = await this.customers.softDelete(new Types.ObjectId(params.id), {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminCustomerDetailDto.fromDetail(summary) };
  }
}
