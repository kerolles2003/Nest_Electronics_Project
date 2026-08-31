import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../modules/auth/domain/authenticated-user';
import type { AuthenticatedUser } from '../../modules/auth/domain/authenticated-user';

/**
 * Injects the authenticated principal, as established by `JwtAuthGuard`.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §4 — "`userId` is ALWAYS
 * taken from the JWT, never from the request. No DTO in the system contains a
 * `userId` field."
 *
 * This decorator is the only supported way to learn who is calling. It is the
 * structural fix for F-CRIT-2, where the legacy order RPC accepted `p_user_id`
 * as a parameter and never compared it to the caller.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.user === undefined) {
      // Unreachable through a guarded route; a loud failure beats a silent
      // undefined if someone ever adds @CurrentUser() to a @Public() handler.
      throw new Error('@CurrentUser() used on a route that is not authenticated');
    }

    return request.user;
  },
);
