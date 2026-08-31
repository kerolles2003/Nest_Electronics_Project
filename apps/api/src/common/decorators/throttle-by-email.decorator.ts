import { SetMetadata } from '@nestjs/common';

export const THROTTLE_BY_EMAIL_KEY = 'throttleByEmail';

/**
 * Scopes a route's rate-limit counter to the submitted email as well as the IP.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §7, which specifies
 * `IP + email` for login and verification resend, and `IP` alone for
 * registration.
 *
 * The distinction is not cosmetic. Keying login on IP alone lets one attacker
 * exhaust a shared NAT's budget for every legitimate user behind it. Keying it
 * on email alone lets a botnet spread an attack across addresses. Registration
 * deliberately stays IP-only: adding the email there would let an attacker
 * create unlimited accounts simply by varying the address.
 */
export const ThrottleByEmail = (): MethodDecorator & ClassDecorator =>
  SetMetadata(THROTTLE_BY_EMAIL_KEY, true);
