import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route out of the globally-applied authentication guard.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §8 — authentication is
 * GLOBAL BY DEFAULT and public routes opt out explicitly.
 *
 * The direction matters. Forgetting this decorator makes a route inaccessible,
 * not unprotected. Legacy's admin handlers relied on a route MATCHER with no
 * in-handler check (M6), so a matcher regression would silently have exposed
 * every one of them.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
