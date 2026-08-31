import { ApiProperty } from '@nestjs/swagger';
import { Matches, MaxLength } from 'class-validator';

/** Lowercase kebab-case, the public URL identifier for every catalogue entity. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A validated slug path parameter.
 *
 * Authority: docs/architecture/DTO-STRATEGY.md §7 — `SlugParamDto` is one of the
 * five shared transport DTOs. Validating the shape here means a malformed slug
 * is a 400 with a field-level message, never a database round trip.
 */
export class SlugParamDto {
  @ApiProperty({
    example: 'esp32-devkit-v1',
    pattern: SLUG_PATTERN.source,
    description: 'Lowercase kebab-case public identifier.',
  })
  @MaxLength(140, { message: 'slug must not exceed 140 characters' })
  @Matches(SLUG_PATTERN, { message: 'slug must be lowercase kebab-case' })
  slug!: string;
}
