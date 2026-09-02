import 'server-only';

import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { readSession } from '@/lib/api/session';
import type { Viewer } from '@/components/providers/SiteProviders';

/**
 * Resolves who is signed in, for a server component to hand to the client.
 *
 * Returns `null` for an anonymous visitor AND for a session the API rejects.
 * Those are the same thing from the page's point of view: a refresh token that
 * has expired or been revoked is not a session, and the header must not draw a
 * name for it. The guarded pages answer the question properly, with a redirect.
 *
 * Never throws. The header renders on every page, including error pages, and an
 * unreachable API must degrade to "signed out" rather than take the site down.
 */
export async function readViewer(): Promise<Viewer | null> {
  if ((await readSession()) === null) return null;

  const result = await tryApi(() => api.currentUser());

  if (!result.ok) return null;

  const user = result.data.data;

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    initials: initialsOf(user.fullName),
  };
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

  return letters.slice(0, 2) === '' ? 'U' : letters.slice(0, 2);
}
