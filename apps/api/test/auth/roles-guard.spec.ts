import { describe, expect, it } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../../src/common/errors/app.exception';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { RolesGuard } from '../../src/modules/auth/guards/roles.guard';
import type { AuthenticatedUser } from '../../src/modules/auth/domain/authenticated-user';
import { Role } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * `RolesGuard` is registered globally but no route carries `@Roles()` yet — the
 * admin surface arrives later. That makes it exactly the kind of code that
 * ships subtly broken and is only discovered when the first admin endpoint is
 * written, so its behaviour is pinned here instead.
 *
 * No HTTP, no database: the guard's whole job is a metadata lookup and a
 * membership test, and both are testable directly.
 */

function contextFor(user: AuthenticatedUser | undefined): ExecutionContext {
  const handler = (): void => undefined;

  return {
    getHandler: () => handler,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardRequiring(roles: Role[] | undefined): RolesGuard {
  const reflector = new Reflector();
  // getAllAndOverride reads handler then class; stubbing it directly keeps the
  // test about the guard rather than about decorator plumbing.
  jestStub(reflector, roles);
  return new RolesGuard(reflector);
}

function jestStub(reflector: Reflector, roles: Role[] | undefined): void {
  (reflector as unknown as { getAllAndOverride: (key: string) => unknown }).getAllAndOverride = (
    key: string,
  ) => (key === ROLES_KEY ? roles : undefined);
}

const customer: AuthenticatedUser = { id: 'a'.repeat(24), role: Role.CUSTOMER, tokenVersion: 1 };
const admin: AuthenticatedUser = { id: 'b'.repeat(24), role: Role.ADMIN, tokenVersion: 1 };
const superAdmin: AuthenticatedUser = {
  id: 'c'.repeat(24),
  role: Role.SUPER_ADMIN,
  tokenVersion: 1,
};

describe('RolesGuard', () => {
  it('allows any authenticated principal when no role is required', () => {
    // The role decision is separate from the authentication decision, which
    // JwtAuthGuard has already made.
    expect(guardRequiring(undefined).canActivate(contextFor(customer))).toBe(true);
    expect(guardRequiring([]).canActivate(contextFor(customer))).toBe(true);
  });

  it('allows a principal holding a listed role', () => {
    expect(guardRequiring([Role.ADMIN, Role.SUPER_ADMIN]).canActivate(contextFor(admin))).toBe(true);
    expect(
      guardRequiring([Role.ADMIN, Role.SUPER_ADMIN]).canActivate(contextFor(superAdmin)),
    ).toBe(true);
  });

  it('rejects a customer on an admin route with 403 FORBIDDEN', () => {
    const guard = guardRequiring([Role.ADMIN, Role.SUPER_ADMIN]);

    expect(() => guard.canActivate(contextFor(customer))).toThrow(AppException);
    try {
      guard.canActivate(contextFor(customer));
    } catch (error) {
      expect((error as AppException).code).toBe('FORBIDDEN');
      expect((error as AppException).getStatus()).toBe(403);
    }
  });

  it('does NOT treat ADMIN as SUPER_ADMIN', () => {
    // Legacy declared both roles and enforced the distinction in none of the
    // three places it appeared. Role management and user deletion are
    // SUPER_ADMIN alone, so an ADMIN must be refused.
    const guard = guardRequiring([Role.SUPER_ADMIN]);

    expect(() => guard.canActivate(contextFor(admin))).toThrow(AppException);
    expect(guard.canActivate(contextFor(superAdmin))).toBe(true);
  });

  it('rejects an unauthenticated caller with 401, not 403', () => {
    // Nothing has been identified yet, so there is nothing to forbid. A 403
    // here would also confirm the route exists to an anonymous prober.
    const guard = guardRequiring([Role.ADMIN]);

    try {
      guard.canActivate(contextFor(undefined));
      throw new Error('expected the guard to reject');
    } catch (error) {
      expect((error as AppException).code).toBe('UNAUTHENTICATED');
      expect((error as AppException).getStatus()).toBe(401);
    }
  });
});
