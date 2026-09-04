import { describe, expect, it } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../../src/common/errors/app.exception';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { RolesGuard } from '../../src/modules/auth/guards/roles.guard';
import type { CredentialRepository } from '../../src/modules/auth/infrastructure/repositories/credential.repository';
import type { AuthenticatedUser } from '../../src/modules/auth/domain/authenticated-user';
import { Role } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * `RolesGuard` decides two things, and the second one used to be decided by
 * nobody.
 *
 * The first is the role comparison: is the principal's claim in the route's
 * list. The second is the TOKEN VERSION comparison —
 * `AUTHORIZATION-MODEL.md` §2's escape hatch, which says "incrementing
 * `user.tokenVersion` invalidates all existing access tokens immediately for
 * security-critical changes … The guard compares `tv` against the user record
 * **only** for privileged operations, so the common path stays lookup-free."
 *
 * **That comparison did not exist.** `tokenVersion` was on the schema and named
 * as the escape hatch in three separate docstrings, and nothing ever read it,
 * so incrementing it did nothing at all. Part 6's role change is the first
 * operation that depends on it working: without the check, demoting an admin
 * leaves them holding working admin credentials for the remainder of their
 * fifteen minutes.
 *
 * No HTTP and no database here — the guard's job is a metadata lookup, one
 * integer comparison and a membership test, and all three are testable
 * directly. The end-to-end version, where a real demoted token stops working
 * against a real route, is in `test/users/admin-customers.spec.ts`.
 */

function contextFor(user: AuthenticatedUser | undefined): ExecutionContext {
  const handler = (): void => undefined;

  return {
    getHandler: () => handler,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

/**
 * A credential repository that answers one question.
 *
 * `undefined` means "answer with whatever version the caller claims", which is
 * the ordinary case — the token has not been superseded. A number pins the
 * stored version so a mismatch can be arranged; `null` is a deleted account.
 */
function credentials(stored?: number | null): CredentialRepository {
  return {
    currentTokenVersion: (): Promise<number | null> =>
      Promise.resolve(stored === undefined ? CLAIMED_VERSION : stored),
  } as unknown as CredentialRepository;
}

const CLAIMED_VERSION = 1;

function guardRequiring(roles: Role[] | undefined, stored?: number | null): RolesGuard {
  const reflector = new Reflector();
  // getAllAndOverride reads handler then class; stubbing it directly keeps the
  // test about the guard rather than about decorator plumbing.
  stubReflector(reflector, roles);

  return new RolesGuard(reflector, credentials(stored));
}

function stubReflector(reflector: Reflector, roles: Role[] | undefined): void {
  (reflector as unknown as { getAllAndOverride: (key: string) => unknown }).getAllAndOverride = (
    key: string,
  ) => (key === ROLES_KEY ? roles : undefined);
}

const customer: AuthenticatedUser = {
  id: 'a'.repeat(24),
  role: Role.CUSTOMER,
  tokenVersion: CLAIMED_VERSION,
};
const admin: AuthenticatedUser = {
  id: 'b'.repeat(24),
  role: Role.ADMIN,
  tokenVersion: CLAIMED_VERSION,
};
const superAdmin: AuthenticatedUser = {
  id: 'c'.repeat(24),
  role: Role.SUPER_ADMIN,
  tokenVersion: CLAIMED_VERSION,
};

describe('RolesGuard — the role decision', () => {
  it('allows any authenticated principal when no role is required', async () => {
    // The role decision is separate from the authentication decision, which
    // JwtAuthGuard has already made.
    expect(await guardRequiring(undefined).canActivate(contextFor(customer))).toBe(true);
    expect(await guardRequiring([]).canActivate(contextFor(customer))).toBe(true);
  });

  it('allows a principal holding a listed role', async () => {
    expect(
      await guardRequiring([Role.ADMIN, Role.SUPER_ADMIN]).canActivate(contextFor(admin)),
    ).toBe(true);
    expect(
      await guardRequiring([Role.ADMIN, Role.SUPER_ADMIN]).canActivate(contextFor(superAdmin)),
    ).toBe(true);
  });

  it('rejects a customer on an admin route with 403 FORBIDDEN', async () => {
    const guard = guardRequiring([Role.ADMIN, Role.SUPER_ADMIN]);

    await expect(guard.canActivate(contextFor(customer))).rejects.toThrow(AppException);

    try {
      await guard.canActivate(contextFor(customer));
    } catch (error) {
      expect((error as AppException).code).toBe('FORBIDDEN');
      expect((error as AppException).getStatus()).toBe(403);
    }
  });

  it('does NOT treat ADMIN as SUPER_ADMIN', async () => {
    // Legacy declared both roles and enforced the distinction in none of the
    // three places it appeared. Role management and user deletion are
    // SUPER_ADMIN alone, so an ADMIN must be refused.
    const guard = guardRequiring([Role.SUPER_ADMIN]);

    await expect(guard.canActivate(contextFor(admin))).rejects.toThrow(AppException);
    expect(await guard.canActivate(contextFor(superAdmin))).toBe(true);
  });

  it('rejects an unauthenticated caller with 401, not 403', async () => {
    // Nothing has been identified yet, so there is nothing to forbid. A 403
    // here would also confirm the route exists to an anonymous prober.
    const guard = guardRequiring([Role.ADMIN]);

    try {
      await guard.canActivate(contextFor(undefined));
      throw new Error('expected the guard to reject');
    } catch (error) {
      expect((error as AppException).code).toBe('UNAUTHENTICATED');
      expect((error as AppException).getStatus()).toBe(401);
    }
  });
});

describe('RolesGuard — the token-version check that was never implemented', () => {
  it('rejects a token whose version the account has moved past', async () => {
    // The account's stored version is 2; the token claims 1. That is what a
    // role change, a password change or a forced logout leaves behind.
    const guard = guardRequiring([Role.ADMIN], 2);

    try {
      await guard.canActivate(contextFor(admin));
      throw new Error('expected the guard to reject');
    } catch (error) {
      expect((error as AppException).code).toBe('TOKEN_EXPIRED');
      expect((error as AppException).getStatus()).toBe(401);
    }
  });

  it('answers TOKEN_EXPIRED, whose contract is the correct client behaviour', async () => {
    /*
     * Deliberately not a new code. `TOKEN_EXPIRED` means "refresh ONCE and
     * retry", which is exactly right: a demoted admin's refresh mints a token
     * carrying the new role, the retry reaches this guard again, and the role
     * check answers 403 — the honest end state. A more literal new code would
     * have broken the retry logic of every client that does not know it yet,
     * including the Flutter one.
     */
    const guard = guardRequiring([Role.ADMIN], 7);

    await expect(guard.canActivate(contextFor(admin))).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });

  it('rejects a token for an account that no longer exists or is disabled', async () => {
    // `null` is what the repository answers for a deleted account — `deletedAt`
    // is in the FILTER, so a disabled account cannot resolve to a version.
    const guard = guardRequiring([Role.ADMIN], null);

    await expect(guard.canActivate(contextFor(admin))).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });

  it('checks the version BEFORE the role, so the client is told to refresh', async () => {
    /*
     * A superseded token must answer "refresh and try again" whether or not the
     * role it carries would have been sufficient. Checked with a principal
     * whose role would be REFUSED anyway: if the order were reversed the answer
     * would be FORBIDDEN, and a demoted admin would be told their role is wrong,
     * refresh nothing, and never discover that a refresh is what they need.
     */
    const guard = guardRequiring([Role.SUPER_ADMIN], 2);

    await expect(guard.canActivate(contextFor(admin))).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });

  it('does NOT look the version up on a route with no @Roles()', async () => {
    /*
     * §2: "The guard compares `tv` against the user record **only** for
     * privileged operations, so the common path stays lookup-free." That is the
     * whole reason the role is a JWT claim — legacy looked it up on EVERY
     * request and made `profiles_pkey` the hottest index in the database at
     * 2,719 scans.
     *
     * The repository here THROWS if called, so a lookup on an unprivileged
     * route fails the test rather than merely costing something nobody measures.
     */
    let called = false;
    const exploding = {
      currentTokenVersion: (): Promise<number | null> => {
        called = true;
        throw new Error('the guard must not look up a token version on an unprivileged route');
      },
    } as unknown as CredentialRepository;

    const reflector = new Reflector();
    stubReflector(reflector, undefined);

    expect(await new RolesGuard(reflector, exploding).canActivate(contextFor(customer))).toBe(true);
    expect(called).toBe(false);
  });

  it('does NOT look the version up on a route requiring only CUSTOMER', async () => {
    let called = false;
    const exploding = {
      currentTokenVersion: (): Promise<number | null> => {
        called = true;
        throw new Error('the guard must not look up a token version on a customer route');
      },
    } as unknown as CredentialRepository;

    const reflector = new Reflector();
    stubReflector(reflector, [Role.CUSTOMER]);

    expect(await new RolesGuard(reflector, exploding).canActivate(contextFor(customer))).toBe(true);
    expect(called).toBe(false);
  });
});
