import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { parseAcceptLanguage, type Locale } from '../localization/locale';

/**
 * Resolves the request locale from `Accept-Language`.
 *
 * Authority: docs/architecture/API-STANDARDS.md §5; API-CONTRACT.md §9.2 — the
 * client sends the header and receives resolved strings; there is no implicit
 * locale and no per-locale URL.
 */
export const RequestLocale = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Locale =>
    parseAcceptLanguage(context.switchToHttp().getRequest<Request>().headers['accept-language']),
);
