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
 * So the identity is a real one fetched from `GET /auth/me`, or it is stated to
 * be unknown. There is no third option and no default. `e2e/admin-identity.spec.ts`
 * drives the console against a dead API and asserts that no fabricated name
 * appears anywhere on the page.
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
 * WHY there is no identity, when there is none.
 *
 * The three cases need different responses and were originally collapsed into
 * one `null`, which produced a real bug: a transient API failure looked
 * identical to "not signed in", so `requireAdmin` redirected — and an operator
 * whose API hiccuped for one request was thrown to the sign-in page and would
 * sign in again to fix a problem that was never theirs.
 */
export type IdentityOutcome =
  | { readonly status: 'ok'; readonly identity: AdminIdentity }
  /** No session, a rejected session, or an account that may not be here. */
  | { readonly status: 'unauthenticated' }
  /** The API could not be asked. This is NOT the same as "not signed in". */
  | { readonly status: 'unavailable'; readonly reason: string };

/**
 * Resolves the signed-in operator.
 *
 * **Never throws.** The header renders on every page including error pages, and
 * an unreachable API must degrade to a stated unknown rather than take the
 * console down.
 */
export async function readIdentity(): Promise<IdentityOutcome> {
  if ((await readSession()) === null) return { status: 'unauthenticated' };

  const result = await tryApi(() => api.currentUser());

  if (!result.ok) {
    /*
     * A network failure or a 5xx means the question was not answered. Saying
     * "not signed in" would be a guess, and it is the expensive guess: it signs
     * somebody out who is not signed out.
     */
    if (result.error.kind === 'network' || result.error.kind === 'server') {
      return { status: 'unavailable', reason: result.error.message };
    }

    return { status: 'unauthenticated' };
  }

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
   * non-staff token on every `admin/*` route regardless of what this returns.
   */
  if (!isStaff(user.role)) return { status: 'unauthenticated' };

  return {
    status: 'ok',
    identity: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      initials: initialsOf(user.fullName),
    },
  };
}

/**
 * The identity, or `null` when there is not one to show.
 *
 * For the HEADER, which must render either a real person or an explicit
 * "unavailable" — never a placeholder name.
 */
export async function readAdminIdentity(): Promise<AdminIdentity | null> {
  const outcome = await readIdentity();

  return outcome.status === 'ok' ? outcome.identity : null;
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
 * ## It returns `null` rather than redirecting when the API is UNREACHABLE
 *
 * Only `unauthenticated` is grounds for the sign-in page. When the API cannot
 * be asked, this returns `null` and lets the page render its own error state —
 * every guarded page fetches from the same API and will fail the same way, so
 * it will say so properly. Redirecting instead would sign an operator out over
 * a hiccup, which is both wrong and indistinguishable from their session
 * genuinely ending.
 */
export async function requireAdmin(): Promise<AdminIdentity | null> {
  const outcome = await readIdentity();

  if (outcome.status === 'ok') return outcome.identity;

  if (outcome.status === 'unauthenticated') {
    /*
     * One destination for both "no session" and "not staff".
     *
     * They are different facts, and telling them apart in the URL would be an
     * oracle: `/unauthorized` for a valid non-staff session confirms to
     * somebody holding a customer token that the address they guessed is a real
     * console. `/login` is the honest instruction in both cases.
     */
    redirect('/login');
  }

  return null;
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

/**
 * The acting operator, for a MUTATION. Never null.
 *
 * A server action changes something, and an action whose actor is unknown must
 * not run — "I could not establish who you are, so I did it anyway" is not an
 * acceptable sentence about a console that adjusts stock and moves orders.
 *
 * So this is stricter than `requireAdmin`: an unreachable API throws here where
 * it merely returns `null` there. A page with an unknown actor renders an error
 * and shows nothing; an action with an unknown actor does nothing at all. The
 * difference is that one of them writes.
 */
export async function requireAdminActor(): Promise<AdminIdentity> {
  const outcome = await readIdentity();

  if (outcome.status === 'ok') return outcome.identity;
  if (outcome.status === 'unauthenticated') redirect('/login');

  throw new Error(
    `Refusing to act: the API could not confirm who is signed in (${outcome.reason}). ` +
      'Nothing was changed.',
  );
}
