import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedRequest } from '../domain/authenticated-user';
import { TokenService } from '../application/token.service';

const BEARER_PREFIX = 'Bearer ';

/**
 * Authentication, applied GLOBALLY.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §1, §8 — one request
 * pipeline with no privileged bypass, and authentication on by default.
 *
 * Registered as an `APP_GUARD`, so a new controller is protected the moment it
 * is written. Opting out requires the explicit `@Public()` decorator. The
 * direction is the point: forgetting the decorator makes a route INACCESSIBLE,
 * not unprotected. Legacy protected its admin API with a route matcher and no
 * in-handler check, so a matcher regression would silently have exposed
 * everything behind it (M6).
 *
 * Transport is `Authorization: Bearer <jwt>`. The frozen contract also allows
 * an httpOnly cookie for the web client; that is additive and arrives with the
 * Next.js integration — Flutter needs no cookie jar, and API-CONTRACT.md §9.4
 * guarantees bearer tokens are first-class.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Handler first, then controller: a public controller may still contain a
    // protected route and vice versa.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
      throw AppException.unauthenticated();
    }

    // Throws TOKEN_EXPIRED or TOKEN_INVALID — the client behaviour differs, so
    // the two are never collapsed into one code.
    request.user = this.tokens.verifyAccessToken(header.slice(BEARER_PREFIX.length).trim());

    return true;
  }
}
