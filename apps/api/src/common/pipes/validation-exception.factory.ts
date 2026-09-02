import type { ValidationError } from 'class-validator';
import { AppException, type FieldError } from '../errors/app.exception';

/** class-validator's constraint key for a property rejected by `forbidNonWhitelisted`. */
const WHITELIST_CONSTRAINT = 'whitelistValidation';

/**
 * Constraints that mean the value is ABSENT or of the wrong kind, most
 * fundamental first.
 *
 * ## Why this ordering exists
 *
 * A field the client did not send fails every rule declared on it at once. Omit
 * `reason` from a cancellation and class-validator returns three messages:
 *
 *   reason must not exceed 500 characters
 *   reason must be at least 3 characters
 *   reason must be a string
 *
 * `INTEGRATION.md` tells clients that the useful sentence is
 * `details[0].message` — and the first of those is the least useful one in the
 * set. A developer who sent no `reason` at all reads "must not exceed 500
 * characters" about a field they never wrote, which points them at exactly the
 * wrong problem. This was found by walking the sandbox guide end to end as a
 * new integrator, which is the only way that kind of defect surfaces: every
 * test in the suite already knew what it had sent.
 *
 * So the structural failure is reported first. "must be a string" is the honest
 * answer to "I sent nothing"; the length rules describe a string that exists.
 *
 * The order within this list matters too: presence before type, because
 * `undefined` is more fundamental than `123`.
 */
const STRUCTURAL_CONSTRAINTS: readonly string[] = [
  'isDefined',
  'isNotEmpty',
  'isNotEmptyObject',
  'isString',
  'isInt',
  'isNumber',
  'isBoolean',
  'isArray',
  'isObject',
  'isEnum',
  'isDate',
  'isDateString',
  'isMongoId',
];

/**
 * Where a constraint sorts. Structural constraints keep their relative order
 * above; everything else follows, in the order class-validator reported it.
 */
function severityOf(constraint: string): number {
  const index = STRUCTURAL_CONSTRAINTS.indexOf(constraint);

  return index === -1 ? STRUCTURAL_CONSTRAINTS.length : index;
}

/**
 * Flattens nested validation errors into dotted field paths.
 *
 * Within ONE field the messages are ordered most-fundamental-first, so
 * `details[0]` is the sentence worth showing. Across fields the original order
 * is preserved: which field a client hears about first is arbitrary either way,
 * and a stable order is easier to test against than a clever one.
 */
function flatten(errors: readonly ValidationError[], prefix = ''): FieldError[] {
  const flattened: FieldError[] = [];

  for (const error of errors) {
    const field = prefix === '' ? error.property : `${prefix}.${error.property}`;

    const constraints = Object.entries(error.constraints ?? {}).sort(
      ([a], [b]) => severityOf(a) - severityOf(b),
    );

    for (const [constraint, message] of constraints) {
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
