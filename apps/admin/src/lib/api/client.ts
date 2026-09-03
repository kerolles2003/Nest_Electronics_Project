import 'server-only';

import { ApiError, toApiError, toNetworkError } from './errors';
import { readSession } from './session';
import type { SessionTokens } from './types';

/**
 * THE single way this console talks to the NestJS API.
 *
 * Authority: `docs/architecture/API-CONTRACT.md` §1 (envelope, base path,
 * headers) and `API-STANDARDS.md` §1 (error envelope).
 *
 * Every call goes through here, which is what makes the cross-cutting rules
 * enforceable in ONE place instead of being re-remembered per screen: the base
 * URL, the bearer header, the JSON envelope, and the error translation.
 *
 * ## It NEVER writes a cookie, and that is the point
 *
 * This used to refresh on an expired access token and store the new pair. It
 * was wrong in a way that only showed up after fifteen idle minutes:
 * `writeSession` writes cookies, **Next forbids writing cookies during a page
 * render**, and `tryApi` only catches `ApiError` — so the write threw, the page
 * 500'd, and the operator saw a stack trace where an order should be.
 *
 * The second half was worse than the crash. The refresh had already SUCCEEDED
 * server-side, so the API had rotated the refresh token and burned the old one;
 * the new pair was never persisted, so the browser kept presenting the burned
 * token, and the next attempt came back `REFRESH_TOKEN_REUSED` — which the API
 * correctly treats as theft and answers by revoking the whole family. A stack
 * trace, then a silent sign-out, from nothing but sitting still.
 *
 * So renewal lives in exactly one place that is allowed to write cookies and is
 * single-flight by construction: `app/session/renew/route.ts`, reached by one
 * redirect from `requireAdmin`. Not here, and not in `proxy.ts` — middleware
 * runs on every parallel request a page load makes, including RSC prefetches,
 * and concurrent rotations of one rotating token burn each other.
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
 *
 * EXPORTED, and called from exactly one place: the renewal route handler. It is
 * exported rather than inlined there so that the rule "every call to this API
 * goes through this module" still holds for the one call that renews the
 * session. Calling it anywhere that cannot persist the result would burn a live
 * refresh token — see the note at the top of this file.
 */
export async function renewSession(refreshToken: string): Promise<SessionTokens | null> {
  const { status, body } = await send(
    '/auth/refresh',
    { method: 'POST', body: { refreshToken }, auth: false },
    null,
  );

  if (status !== 200) return null;

  return (body as { data?: SessionTokens } | null)?.data ?? null;
}

/**
 * Performs one API call. Renews NOTHING and writes NO cookie.
 *
 * An expired access token comes back as an `ApiError` of kind `expired`, which
 * is a fact about this request rather than an instruction to sign anybody out.
 * `requireAdmin` turns it into a redirect through the renewal route; a server
 * action turns it into a message saying nothing was changed.
 *
 * The important property is that this function is now safe to call from a page
 * render, which is where most of the console's calls happen. Nothing it does
 * can rotate a refresh token, so nothing it does can leave the browser holding
 * a burned one.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const wantsAuth = options.auth !== false;
  const session = wantsAuth ? await readSession() : null;

  const result = await send(path, options, session?.accessToken ?? null);

  if (result.status >= 400) throw toApiError(result.status, result.body);

  return result.body as T;
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
