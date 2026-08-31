import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AppException, type FieldError } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-code.enum';
import { resolveRequestId, type RequestWithId } from '../interceptors/request-id.interceptor';

/**
 * Framework exceptions this runtime can produce, mapped to their stable codes.
 * Anything raised deliberately by domain code is an AppException and carries
 * its own code, so this table only covers what Nest itself throws.
 */
const CODE_BY_STATUS: ReadonlyMap<number, ErrorCode> = new Map([
  [HttpStatus.BAD_REQUEST, ErrorCode.MALFORMED_REQUEST],
  [HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED],
  [HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN],
  [HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND],
  [HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMIT_EXCEEDED],
  [HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.SERVICE_UNAVAILABLE],
]);

/** Codes worth a warn-level line: each one is somebody probing the boundary. */
const SECURITY_SIGNAL_CODES: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.UNKNOWN_FIELD,
  ErrorCode.REFRESH_TOKEN_REUSED,
  ErrorCode.RATE_LIMIT_EXCEEDED,
]);

/** Safe, human-readable text. Never derived from the exception. */
const MESSAGE_BY_CODE: Readonly<Record<string, string>> = {
  [ErrorCode.MALFORMED_REQUEST]: 'The request could not be parsed.',
  [ErrorCode.UNAUTHENTICATED]: 'Authentication is required for this endpoint.',
  [ErrorCode.FORBIDDEN]: 'You do not have permission to perform this action.',
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Too many requests. Try again later.',
  [ErrorCode.RESOURCE_NOT_FOUND]: 'The requested resource was not found.',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'A required service is temporarily unavailable.',
  [ErrorCode.INTERNAL_ERROR]: 'An unexpected error occurred.',
};

/**
 * The ONLY place an error becomes an HTTP response.
 *
 * Enforces the leakage rule: no driver message, stack trace, collection name,
 * index name or file path may reach a client. Full detail is logged against the
 * requestId, which is the bridge between a client's screenshot and the cause.
 *
 * Authority: docs/architecture/API-STANDARDS.md §1, §3;
 *            docs/architecture/CROSS-CUTTING-STANDARDS.md §B1, §B3.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();

    const requestId = resolveRequestId(request);
    const status = this.resolveStatus(exception);

    // An AppException has already decided both its code and a message that is
    // safe to display; everything else is translated by status.
    const code =
      exception instanceof AppException
        ? exception.code
        : (CODE_BY_STATUS.get(status) ?? ErrorCode.INTERNAL_ERROR);

    const message =
      exception instanceof AppException
        ? exception.safeMessage
        : (MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE[ErrorCode.INTERNAL_ERROR]);

    const details = exception instanceof AppException ? exception.details : undefined;

    this.log(exception, status, code, requestId, request);

    response.setHeader('x-request-id', requestId);
    response.status(status).json({
      error: {
        code,
        message,
        ...(details !== undefined && details.length > 0 ? { details: details as FieldError[] } : {}),
        requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  private resolveStatus(exception: unknown): number {
    return exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private log(
    exception: unknown,
    status: number,
    code: string,
    requestId: string,
    request: RequestWithId,
  ): void {
    const context = `${request.method} ${request.url} -> ${String(status)} ${code} [${requestId}]`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Full detail, server-side only.
      this.logger.error(context, exception instanceof Error ? exception.stack : String(exception));
      return;
    }

    // Injection attempts and credential-adjacent failures are security signals,
    // not routine traffic. Logged at warn so they are visible in a quiet log.
    if (SECURITY_SIGNAL_CODES.has(code as ErrorCode)) {
      this.logger.warn(context);
      return;
    }

    this.logger.log(context);
  }
}
