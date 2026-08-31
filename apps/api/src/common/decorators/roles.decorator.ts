import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../modules/users/infrastructure/schemas/user.schema';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the listed roles.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §3. Legacy declared ADMIN
 * and SUPER_ADMIN but `is_admin()` and `requireAdmin()` treated them
 * identically — the distinction existed in three places and was enforced in
 * none. `RolesGuard` enforces exactly what is written here.
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
