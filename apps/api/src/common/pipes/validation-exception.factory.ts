import type { ValidationError } from 'class-validator';
import { AppException, type FieldError } from '../errors/app.exception';

/** class-validator's constraint key for a property rejected by `forbidNonWhitelisted`. */
const WHITELIST_CONSTRAINT = 'whitelistValidation';

/** Flattens nested validation errors into dotted field paths. */
function flatten(errors: readonly ValidationError[], prefix = ''): FieldError[] {
  const flattened: FieldError[] = [];

  for (const error of errors) {
    const field = prefix === '' ? error.property : `${prefix}.${error.property}`;

    for (const [constraint, message] of Object.entries(error.constraints ?? {})) {
      flattened.push({ field, message, code: constraint.toUpperCase() });
    }

    if (error.children !== undefined && error.children.length > 0) {
      flattened.push(...flatten(error.children, field));
    }
  }

  return flattened;
}

function isWhitelistRejection(errors: readonly ValidationError[]): boolean {
  return errors.some(
    (error) =>
      Object.hasOwn(error.constraints ?? {}, WHITELIST_CONSTRAINT) ||
      (error.children !== undefined && isWhitelistRejection(error.children)),
  );
}

/**
 * Turns class-validator output into the frozen error envelope.
 *
 * Authority: docs/architecture/API-STANDARDS.md §1, §2, §4.
 *
 * Without this, ValidationPipe throws a BadRequestException whose body is a
 * bare `string[]` — a second response shape, which is exactly what the single
 * envelope exists to prevent, and unusable for form binding in Flutter.
 *
 * A rejection caused by `forbidNonWhitelisted` is reported as UNKNOWN_FIELD
 * rather than VALIDATION_ERROR because it is a distinct SECURITY signal: it
 * fires when a client attempts to inject a field the DTO does not accept.
 */
export function validationExceptionFactory(errors: ValidationError[]): AppException {
  const details = flatten(errors);

  return isWhitelistRejection(errors)
    ? AppException.unknownField(details)
    : AppException.validation(details);
}
