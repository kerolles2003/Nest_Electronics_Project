import { Body, Controller, Header, HttpCode, HttpStatus, Patch } from '@nestjs/common';
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
import { Roles } from '../../../common/decorators/roles.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user';
import { UsersService } from '../application/users.service';
import { Role } from '../infrastructure/schemas/user.schema';
import { UpdateProfileDto } from './dto/profile-request.dto';
import { UserProfileDto, UserProfileResponseDto } from './dto/profile-response.dto';

/** Never cache a response about the signed-in person. */
const NO_STORE = 'no-store';

/**
 * The signed-in customer's own profile.
 *
 * Authority: PLAN.md §9 — `PATCH /users/me`, without which `/account/profile`
 * cannot migrate off Supabase.
 *
 * ## There is no `GET`, on purpose
 *
 * `GET /auth/me` already returns exactly this and is what every client already
 * calls. A second read endpoint would be a second thing to keep in step for no
 * new capability — the write is what was missing.
 *
 * ## The subject is always the token
 *
 * There is no `:id`. `userId` comes from the JWT and never from a DTO or a path
 * (AUTHORIZATION-MODEL.md §11, the fix for the legacy ownership-forgery defect
 * F-CRIT-2). An endpoint that took an id would need an ownership check, and the
 * check that is never written is the one that is never needed.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me')
@Roles(Role.CUSTOMER)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch()
  @Header('Cache-Control', NO_STORE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update my profile',
    description: [
      'Partial update of the signed-in customer. Returns the whole profile as it now stands.',
      '',
      '**Omitting a key leaves that field unchanged.** For `phone`, `null` is a different',
      'instruction from omission: it removes the number.',
      '',
      '`email`, `role` and verification state are **not** editable here. Sending any of them',
      'returns `400 UNKNOWN_FIELD` — changing a login identifier requires proving the new',
      'address, and role is server-owned.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: UserProfileResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR, or UNKNOWN_FIELD for a field that is not editable.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'UNAUTHENTICATED, TOKEN_EXPIRED or TOKEN_INVALID',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'FORBIDDEN — a profile belongs to a CUSTOMER account.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'RESOURCE_NOT_FOUND — the account was deleted while the token was still valid.',
  })
  async updateProfile(
    @CurrentUser() principal: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileResponseDto> {
    // The DTO IS the patch. Spreading it into a fresh object literal would make
    // every optional field explicitly `undefined`, which under
    // `exactOptionalPropertyTypes` is a different thing from absent -- and
    // absent is exactly what "leave this field alone" means here.
    const updated = await this.users.updateProfile(new Types.ObjectId(principal.id), dto);

    /*
     * Reachable with a perfectly valid token: access tokens live 15 minutes and
     * are not revocable, so an account soft-deleted a minute ago still presents
     * one. 404 rather than 401 — the token is genuine, the subject is gone.
     */
    if (updated === null) {
      throw AppException.resourceNotFound();
    }

    return { data: UserProfileDto.from(updated) };
  }
}
