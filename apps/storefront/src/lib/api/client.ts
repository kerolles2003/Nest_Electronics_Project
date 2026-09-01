import 'server-only';

import { ApiError, toApiError, toNetworkError } from './errors';
import { clearSession, readSession, writeSession } from './session';
import type { SessionTokens } from './types';

/**
 * THE single way this app talks to the NestJS API.
 *
 * Authority: `docs/architecture/API-CONTRACT.md` §1 (envelope, base path,
 * headers) and `API-STANDARDS.md` §1 (error envelope).
 *
 * Every call in the API-backed slice goes through here, which is what makes the
 * cross-cutting rules enforceable in ONE place instead of being re-remembered
 * per page: the base URL, the bearer header, the JSON envelope, the error
 * translation, and the silent 401 refresh.
 *
 * It is SERVER-ONLY by construction. The tokens live in httpOnly cookies that
 * client JavaScript cannot read (see `session.ts`), so there is no way to make
 * an authenticated call from the browser even by accident.
 */

/**
 * The API base URL.
 *
 * SERVER-ONLY (`API_BASE_URL`), not `NEXT_PUBLIC_API_BASE_URL`, and the
 * distinction is a deployment property rather than a security one — the URL is
 * not a secret.
 *
 * Next.js INLINES every `NEXT_PUBLIC_` variable into the bundle at BUILD time.
 * A build is therefore permanently bound to one API address, so promoting the
 * identical artifact from staging to production would be impossible: it would
 * need a rebuild whose only difference is a hostname, and the thing tested in
 * staging would not be the thing that ships. A server-side variable is read at
 * RUNTIME, so one image runs in every environment.
 *
 * This file is `server-only`, so nothing in the browser could have read it
 * anyway. If a client component ever genuinely needs the address, that is when
 * a `NEXT_PUBLIC_` variable should be introduced — for that use, deliberately.
 */
function baseUrl(): string {
  const raw = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3002/api/v1';

  return raw.replace(/\/+$/, '');
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Extra headers. `Idempotency-Key` for `POST /orders` goes here. */
  headers?: Record<string, string>;
  /** Send the bearer token. Default true; catalogue reads set it false. */
  auth?: boolean;
  /**
   * Next.js fetch caching. Defaults to `no-store` — this is live commerce data.
   *
   * Ignored when `revalidate` is set: the two are opposite instructions and
   * sending both silently discards the revalidation (see `send`).
   */
  cache?: RequestCache;
  /**
   * Seconds a cached response may be reused for. Setting this makes the route
   * that calls it statically renderable; leaving it unset does not.
   */
  revalidate?: number;
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
       * ONE of the two, never both.
       *
       * `cache: 'no-store'` and `next: { revalidate }` are opposite
       * instructions — Next's own docs give `{ cache: 'no-store', next: {
       * revalidate: 0 } }` as the definition of `force-dynamic` — and when both
       * are sent, `no-store` wins. This previously sent both, so `revalidate`
       * was accepted, documented, and silently ignored on every call that used
       * it.
       *
       * It cost nothing while every caller was a `force-dynamic` page. It
       * became fatal the moment the ROOT LAYOUT made one of these calls: a
       * no-store fetch in a layout opts every route in the application out of
       * static rendering, and `next build` then failed to prerender pages that
       * have nothing to do with the catalogue — `/account`, `/blog`,
       * `/_not-found` — each with "Route ... couldn't be rendered statically
       * because it used no-store fetch .../categories/tree".
       *
       * Uncached remains the DEFAULT. This is live commerce data, and a caller
       * has to ask for caching explicitly by naming how stale it may be.
       */
      ...(options.revalidate === undefined
        ? { cache: options.cache ?? 'no-store' }
        : { next: { revalidate: options.revalidate } }),
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

  const tokens = (body as { data?: SessionTokens } | null)?.data;

  return tokens ?? null;
}

/**
 * Performs one API call, refreshing ONCE on an expired access token.
 *
 * The retry is deliberately limited to a single attempt and to the
 * authentication failures that a refresh can actually fix. A second 401 means
 * the session is genuinely over, and looping would just burn refresh tokens —
 * each rotation invalidates the last, so a retry storm is how a valid session
 * gets destroyed.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const wantsAuth = options.auth !== false;
  const session = wantsAuth ? await readSession() : null;

  let result = await send(path, options, session?.accessToken ?? null);

  const expired =
    result.status === 401 &&
    wantsAuth &&
    session !== null &&
    isRenewable(result.body);

  if (expired) {
    const renewed = await refreshSession(session.refreshToken);

    if (renewed === null) {
      // The refresh token is gone, revoked, or reused. Nothing here can
      // recover it, and keeping the cookies would make every later request
      // repeat this dance.
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
 * crash into an error boundary.
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
