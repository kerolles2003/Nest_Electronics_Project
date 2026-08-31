import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../errors/app.exception';

/**
 * RFC 4122 textual form. Any version is accepted; the contract asks for v4
 * because that is what a client generates, but rejecting a v7 key would be
 * pedantry that breaks a caller for no safety gain.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * Injects the `Idempotency-Key` header, validated.
 *
 * Authority: docs/architecture/API-STANDARDS.md §5 (the header is **required**
 * on `POST /orders`) and §2 (`MISSING_IDEMPOTENCY_KEY`);
 * docs/architecture/CROSS-CUTTING-STANDARDS.md §32, which names this file.
 *
 * It is a DECORATOR rather than a guard or an interceptor because the key is an
 * INPUT to the placement command, not a policy applied around it: the service
 * needs the value, and `DTO-STRATEGY.md` §77 lists "an idempotency key from a
 * header" as the canonical example of data the controller adds to a command
 * because it is not in the request body.
 *
 * Absent is `400 MISSING_IDEMPOTENCY_KEY`, malformed is `400 VALIDATION_ERROR`:
 * two different client bugs with two different fixes. A missing key means the
 * client never implemented retry safety at all, which is the one worth naming
 * with its own code.
 *
 * Whitespace is trimmed and the value lower-cased, so a client that echoes a
 * key back with different casing on a retry is treated as the same attempt
 * rather than creating a second order.
 */
export const IdempotencyKey = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<Request>();
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';

  if (value.length === 0) {
    throw AppException.missingIdempotencyKey();
  }

  if (!UUID_PATTERN.test(value)) {
    throw AppException.validation([
      {
        field: 'Idempotency-Key',
        message: 'Idempotency-Key must be a UUID, e.g. 3f6c1e1e-6f3a-4a5f-9f0a-2b8f5c1d7e90',
        code: 'MATCHES',
      },
    ]);
  }

  return value.toLowerCase();
});
