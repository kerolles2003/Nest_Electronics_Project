import 'server-only';

import { redirect } from 'next/navigation';
import { tryApi } from './client';
import * as api from './endpoints';
import { readSession } from './session';
import type { Role } from './types';

/**
 * WHO is operating this console, resolved from the server on every render.
 *
 * ## The identity is never fabricated
 *
 * `AdminHeader` used to render the string "Admin User" and "admin@nest.com",
 * hard-coded, on every page. That is not a placeholder — it is a lie on a
 * console that confirms orders, dispatches goods and marks cash collected. An
 * operator who believes they are signed in as themselves, and is not, will
 * attribute their own actions to somebody else in their own head.
 *
 * So there are exactly two outcomes here and no third: a real identity fetched
 * from `GET /auth/me`, or `null`. When it is `null` the header says so and
 * names nobody. `test/…/admin-identity.spec.ts` asserts that a failed fetch
 * renders no name at all.
 */

export interface AdminIdentity {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: Role;
  /** Up to two letters, derived on the SERVER so it cannot mismatch on hydration. */
  readonly initials: string;
}

/** The two roles that may operate this console. Nothing else, ever. */
const STAFF_ROLES: readonly Role[] = ['ADMIN', 'SUPER_ADMIN'];

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

/**
 * Resolves the signed-in operator, or `null`.
 *
 * Returns `null` for no session, for a session the API rejects, AND for a
 * signed-in account whose role is not staff. All three are the same thing from
 * a rendering point of view: there is no operator to name.
 *
 * **Never throws.** The header renders on every page including error pages, and
 * an unreachable API must degrade to "not signed in" rather than take the
 * console down. The guarded pages answer the question properly, with a
 * redirect — see `requireAdmin`.
 */
export async function readAdminIdentity(): Promise<AdminIdentity | null> {
  if ((await readSession()) === null) return null;

  const result = await tryApi(() => api.currentUser());

  if (!result.ok) return null;

  const user = result.data.data;

  /*
   * The role is checked HERE, against what the server just said, and not
   * against anything decoded from a token. A `role` claim read client-side is a
   * request, not an authorisation — the legacy admin decided what to render
   * from a Supabase `profiles.role` lookup performed with a service-role key,
   * which was at least server-side; a JWT decoded in the browser would be
   * strictly worse.
   *
   * This is still only about RENDERING. The API's `RolesGuard` refuses a
   * non-staff token on every `admin/*` route regardless of what this returns,
   * and that is the enforcement.
   */
  if (!isStaff(user.role)) return null;

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    initials: initialsOf(user.fullName),
  };
}

/**
 * The server-side guard every dashboard route runs through.
 *
 * ## Why the role check lives here and not in `proxy.ts`
 *
 * The proxy checks for the PRESENCE of a session cookie and nothing else. It
 * cannot do this check honestly, for a reason that is about correctness rather
 * than taste: the access token lives fifteen minutes and the refresh token
 * ROTATES on every use, so a proxy that called `/auth/me` would have to refresh
 * — and a proxy runs on every request including the parallel ones a single page
 * load makes. Several concurrent refreshes on one rotating token is how a valid
 * session gets destroyed, and the failure looks like a random sign-out.
 *
 * The dashboard layout is a server component that renders once per navigation,
 * already needs the identity to draw the header, and can write cookies through
 * the same session module the client uses. So the check is free here and is
 * performed against the SERVER's answer, which is what the requirement is
 * actually about.
 *
 * Callers that only need the guard can ignore the return value.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const identity = await readAdminIdentity();

  if (identity === null) {
    /*
     * One destination for both "no session" and "not staff".
     *
     * They are different facts, and telling them apart in the URL would be an
     * oracle: `/unauthorized` for a valid non-staff session confirms to
     * somebody holding a customer token that the address they guessed is a real
     * console. `/login` is the honest instruction in both cases — sign in as
     * somebody who may be here.
     */
    redirect('/login');
  }

  return identity;
}

/**
 * Up to two letters, derived once on the server.
 *
 * Derived here rather than in the component so it cannot come out differently
 * on the server and the client and produce a hydration mismatch over an avatar.
 */
function initialsOf(fullName: string): string {
  const letters = fullName
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  return letters.slice(0, 2) === '' ? '?' : letters.slice(0, 2);
}
