import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';

/** Clients may supply this header; the server generates one when absent. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** An Express request carrying the correlation id resolved for it. */
export type RequestWithId = Request & { requestId?: string };

/**
 * Returns the correlation id for a request, generating and memoising one on
 * first call.
 *
 * Idempotent by design: the interceptor calls it on the normal path, and
 * AllExceptionsFilter calls it on paths where no handler runs (an unmatched
 * route never reaches an interceptor), so both always report the same id.
 *
 * Authority: docs/architecture/API-STANDARDS.md §5, §9.
 */
export function resolveRequestId(request: RequestWithId): string {
  if (request.requestId !== undefined) {
    return request.requestId;
  }

  const supplied = request.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(supplied) ? supplied[0] : supplied;
  const requestId = candidate !== undefined && candidate.length > 0 ? candidate : randomUUID();

  request.requestId = requestId;
  return requestId;
}

/**
 * Resolves the correlation id and echoes it on every response.
 *
 * Authority: docs/architecture/API-CONTRACT.md §3 — "Every response carries
 * X-Request-Id"; docs/architecture/CROSS-CUTTING-STANDARDS.md §C2 — request id
 * runs first so every later log line and error carries it.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const requestId = resolveRequestId(http.getRequest<RequestWithId>());

    http.getResponse<Response>().setHeader(REQUEST_ID_HEADER, requestId);

    return next.handle();
  }
}
