import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { AppException } from '../../../common/errors/app.exception';
import type { Role } from '../../users/infrastructure/schemas/user.schema';
import type { AuthenticatedRequest } from '../domain/authenticated-user';

/**
 * Role authorization — the second axis, after authentication.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §1, §3.
 *
 * The role is read from the JWT claim rather than from the database, which is
 * what removes the per-request lookup that made `profiles_pkey` the hottest
 * index in the legacy system (2,719 scans). The accepted trade-off is that a
 * role change takes effect at the next refresh, at most 15 minutes; when that
 * is not acceptable, incrementing `user.tokenVersion` invalidates every
 * outstanding access token immediately.
 *
 * A route with no `@Roles()` is open to any authenticated principal — the
 * ROLE decision is separate from the AUTHENTICATION decision, which
 * `JwtAuthGuard` has already made.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required === undefined || required.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;

    // Unauthenticated on a role-restricted route is 401, not 403: the caller
    // has not been identified at all, so there is nothing to forbid yet.
    if (user === undefined) {
      throw AppException.unauthenticated();
    }

    if (!required.includes(user.role)) {
      throw AppException.forbidden();
    }

    return true;
  }
}
