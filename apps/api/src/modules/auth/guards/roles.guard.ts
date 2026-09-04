import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import type { AuthenticatedRequest } from '../domain/authenticated-user';
import { CredentialRepository } from '../infrastructure/repositories/credential.repository';

/**
 * Role authorization — the second axis, after authentication.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §1, §2, §3.
 *
 * The role is read from the JWT claim rather than from the database, which is
 * what removes the per-request lookup that made `profiles_pkey` the hottest
 * index in the legacy system (2,719 scans). The accepted trade-off is that a
 * role change takes effect at the next refresh, at most 15 minutes.
 *
 * ## The `tv` check, and the gap it closes
 *
 * §2 does not leave that trade-off unqualified. It says: "incrementing
 * `user.tokenVersion` invalidates all existing access tokens immediately for
 * security-critical changes (role change, password change, forced logout). The
 * guard compares `tv` against the user record **only** for privileged
 * operations, so the common path stays lookup-free."
 *
 * **That comparison did not exist.** `tokenVersion` was declared on the schema,
 * documented in three places as the escape hatch, written by nothing and read
 * by nothing — so incrementing it did precisely nothing, and a demoted admin
 * kept working admin credentials for the remainder of their fifteen minutes.
 * It is the same shape as `slugRedirects` written and never read, and
 * `retain()` never called: a mechanism whose documentation was the only place
 * it existed.
 *
 * It is implemented here, in the position §2 specifies. The lookup happens
 * ONLY on a route carrying `@Roles()` — that is what "privileged operations"
 * means, and it is why the customer-facing hot path is untouched. A shop's
 * admin traffic is a rounding error beside its catalogue traffic, so one
 * indexed `_id` fetch of a single integer is the right price for a demotion
 * that takes effect now rather than eventually.
 *
 * ## Why the answer is `TOKEN_EXPIRED`
 *
 * Because it is the code whose CONTRACT is exactly the correct client
 * behaviour: refresh once, then retry. A demoted admin's refresh mints a token
 * carrying the new role, the retry reaches this guard again, and the role check
 * answers 403 — which is the honest end state. A new code would have been more
 * literal and would have broken the retry logic of every client that does not
 * know it yet, including the Flutter one.
 *
 * A route with no `@Roles()` is open to any authenticated principal — the ROLE
 * decision is separate from the AUTHENTICATION decision, which `JwtAuthGuard`
 * has already made.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly credentials: CredentialRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    /*
     * §2: "The guard compares `tv` against the user record only for privileged
     * operations, so the common path stays lookup-free." Privileged operations
     * are those requiring ADMIN or SUPER_ADMIN.
     *
     * Ordered before the role comparison deliberately. A superseded token must
     * answer "refresh and try again" whether or not the role it carries would
     * have been sufficient — otherwise a demoted admin would get a 403 telling
     * them their role is wrong, refresh nothing, and never discover that a
     * refresh is what they need.
     */
    const isPrivileged = required.some((role) => role === Role.ADMIN || role === Role.SUPER_ADMIN);

    if (isPrivileged) {
      const current = await this.credentials.currentTokenVersion(new Types.ObjectId(user.id));

      if (current === null || current !== user.tokenVersion) {
        throw AppException.tokenExpired();
      }
    }

    if (!required.includes(user.role)) {
      throw AppException.forbidden();
    }

    return true;
  }
}
