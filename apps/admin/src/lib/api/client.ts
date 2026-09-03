import 'server-only';

import { ApiError, toApiError, toNetworkError } from './errors';
import { clearSession, readSession, writeSession } from './session';
import type { SessionTokens } from './types';

/**
 * THE single way this console talks to the NestJS API.
 *
 * Authority: `docs/architecture/API-CONTRACT.md` §1 (envelope, base path,
 * headers) and `API-STANDARDS.md` §1 (error envelope).
 *
 * Every call goes through here, which is what makes the cross-cutting rules
 * enforceable in ONE place instead of being re-remembered per screen: the base
 * URL, the bearer header, the JSON envelope, the error translation, and the
 * silent 401 refresh.
 *
 * It is SERVER-ONLY by construction. The tokens live in httpOnly cookies that
 * client JavaScript cannot read (see `session.ts`), so there is no way to make
 * an authenticated call from the browser even by accident — which is the whole
 * reason the admin's mutations are server actions.
 */

/**
 * The API base URL.
 *
 * SERVER-ONLY (`API_BASE_URL`), not `NEXT_PUBLIC_API_BASE_URL`. Next.js INLINES
 * every `NEXT_PUBLIC_` variable into the bundle at BUILD time, so a build would
 * be permanently bound to one API address and promoting the identical artifact
 * from staging to production would be impossible. A server-side variable is
 * read at RUNTIME, so one image runs everywhere.
 *
 * This file is `server-only`, so nothing in the browser could have read it
 * anyway.
 */
function baseUrl(): string {
  const raw = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3002/api/v1';

  return raw.replace(/\/+$/, '');
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Send the bearer token. Default true. */
  auth?: boolean;
}

interface RawResponse {
  status: number;
  body: unknown;
}

async function send(
  path: string,
  options: RequestOptions,
  accessToken: string | null,
): Promise<RawResponse> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  let response: Response;

  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      /*
       * NEVER cached, and there is deliberately no option to.
       *
       * This is an operations console: the work queue, an order's status and
       * the moves available on it are live state that another operator may
       * have changed a second ago. The storefront's client takes a
       * `revalidate` because a catalogue page can be stale for an hour; here a
       * stale read means confirming an order somebody else already shipped.
       */
      cache: 'no-store',
    });
  } catch (cause) {
    // The request never produced a response: the API is down, DNS failed, the
    // connection was refused. This is NOT an API error envelope, so it must not
    // be reported as one.
    throw toNetworkError(cause);
  }

  // 204 and empty bodies are legitimate; asking for JSON would throw.
  const text = await response.text();
  const body: unknown = text.length === 0 ? null : safeJson(text);

  return { status: response.status, body };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // A non-JSON body from a non-application layer (proxy, gateway HTML).
    // `toApiError` turns this into an honest server failure.
    return null;
  }
}

/**
 * Exchanges the refresh token for a new pair.
 *
 * The API ROTATES on every refresh: the old refresh token is burned and a new
 * one is issued, so the result must always be persisted. Reusing a burned token
 * returns `REFRESH_TOKEN_REUSED`, which the API treats as suspected theft and
 * which is terminal — the session is cleared rather than retried.
 */
async function refreshSession(refreshToken: string): Promise<SessionTokens | null> {
  const { status, body } = await send(
    '/auth/refresh',
    { method: 'POST', body: { refreshToken }, auth: false },
    null,
  );

  if (status !== 200) return null;

  return (body as { data?: SessionTokens } | null)?.data ?? null;
}

/**
 * Performs one API call, refreshing ONCE on an expired access token.
 *
 * The retry is deliberately limited to a single attempt and to the
 * authentication failures a refresh can actually fix. A second 401 means the
 * session is genuinely over, and looping would just burn refresh tokens — each
 * rotation invalidates the last, so a retry storm is how a valid session gets
 * destroyed.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const wantsAuth = options.auth !== false;
  const session = wantsAuth ? await readSession() : null;

  let result = await send(path, options, session?.accessToken ?? null);

  const expired = result.status === 401 && wantsAuth && session !== null && isRenewable(result.body);

  if (expired) {
    const renewed = await refreshSession(session.refreshToken);

    if (renewed === null) {
      // The refresh token is gone, revoked, or reused. Nothing here can recover
      // it, and keeping the cookies would make every later request repeat this.
      await clearSession();
      throw toApiError(401, result.body);
    }

    await writeSession({
      accessToken: renewed.accessToken,
      refreshToken: renewed.refreshToken,
    });

    result = await send(path, options, renewed.accessToken);
  }

  if (result.status >= 400) throw toApiError(result.status, result.body);

  return result.body as T;
}

/**
 * Only these two 401s are worth a refresh.
 *
 * `UNAUTHENTICATED` means no credential was presented at all, and
 * `REFRESH_TOKEN_REUSED` is terminal by design — refreshing either would be
 * pointless work that also destroys a valid rotation chain.
 */
function isRenewable(body: unknown): boolean {
  const code = (body as { error?: { code?: string } } | null)?.error?.code;

  return code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID';
}

/**
 * Runs an API call and returns the error instead of throwing.
 *
 * For server actions and page loads that must RENDER a failure rather than
 * crash into an error boundary. An operations console showing a stack trace
 * where an order should be is worse than one showing why the order is missing.
 */
export async function tryApi<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
  try {
    return { ok: true, data: await run() };
  } catch (cause) {
    if (cause instanceof ApiError) return { ok: false, error: cause };
    throw cause;
  }
}
