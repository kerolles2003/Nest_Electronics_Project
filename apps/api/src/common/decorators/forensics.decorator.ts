import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { resolveRequestId, type RequestWithId } from '../interceptors/request-id.interceptor';

/**
 * The forensic context of a request: who it came from and how it was made.
 *
 * Authority: docs/architecture/AUDIT-MODEL.md §4 — `ip`, `userAgent` and
 * `requestId` are the fields that let an audit record be correlated with the
 * request log line and the error response.
 *
 * ## Why a decorator rather than reading the request in the service
 *
 * Because the service must not depend on there being an HTTP request at all.
 * A seed script, a background job or a future queue consumer can audit an
 * action too, and each of those has an actor and no user agent. Passing the
 * context in keeps the service honest about what it needs.
 *
 * ## Never from the body
 *
 * Every field here is taken from the transport, not from anything a caller
 * wrote. `userAgent` is the exact field whose absence silently broke the legacy
 * audit trail; letting a client choose its value would make it worse than
 * absent.
 */

export interface ForensicContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string;
}

export const Forensics = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ForensicContext => {
    const request = context.switchToHttp().getRequest<RequestWithId>();
    const agent = request.headers['user-agent'];

    return {
      /*
       * `req.ip` honours Express's trust-proxy setting, so behind a load
       * balancer it is the client rather than the hop. Null rather than a
       * placeholder when it cannot be determined: an audit record that invents
       * an address is worse than one that admits it has none.
       */
      ip: request.ip ?? null,
      userAgent: typeof agent === 'string' && agent.length > 0 ? agent.slice(0, 512) : null,
      requestId: resolveRequestId(request),
    };
  },
);
