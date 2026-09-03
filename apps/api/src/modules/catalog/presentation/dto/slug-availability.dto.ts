import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { OBJECT_ID_PATTERN } from '../../../../common/dto/object-id';
import { MAX_SLUG_LENGTH } from '../../domain/slug';

/** The three things in this catalogue that have a slug. */
export enum SluggableTypeDto {
  PRODUCT = 'product',
  CATEGORY = 'category',
  BRAND = 'brand',
}

/**
 * A slug, validated to the shape CATALOG-MODEL.md §2 generates.
 *
 * Validated rather than normalised, and that is the important half: an
 * admin-editable slug (§2 rule 6) that gets silently rewritten leaves the
 * operator looking at one value in the form and another in the URL, and neither
 * is wrong enough to notice. A malformed slug is a 400.
 *
 * The pattern is also what makes the availability query safe: the value is
 * already `[a-z0-9-]+` before it reaches a regular expression, so no character
 * in it can mean anything to the engine.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class SlugAvailabilityQueryDto {
  @ApiProperty({ enum: SluggableTypeDto, example: SluggableTypeDto.PRODUCT })
  @IsEnum(SluggableTypeDto, {
    message: `type must be one of: ${Object.values(SluggableTypeDto).join(', ')}`,
  })
  type!: SluggableTypeDto;

  @ApiProperty({
    example: 'esp32-devkit-v1',
    maxLength: MAX_SLUG_LENGTH,
    pattern: SLUG_PATTERN.source,
    description:
      'Lowercase alphanumerics separated by single hyphens, no leading or trailing hyphen.',
  })
  @IsString()
  @MaxLength(MAX_SLUG_LENGTH)
  @Matches(SLUG_PATTERN, {
    message: 'slug must be lowercase alphanumerics separated by single hyphens',
  })
  slug!: string;

  @ApiPropertyOptional({
    example: '652f1a9b3c4d5e6f7a8b9c0d',
    pattern: OBJECT_ID_PATTERN.source,
    description:
      'The entity being EDITED. Without it, saving an unchanged product reports its own slug ' +
      'as taken and the save is refused.',
  })
  @IsOptional()
  @IsString()
  @Matches(OBJECT_ID_PATTERN, { message: 'excludeId must be a 24-character hex id' })
  excludeId?: string;
}

export class SlugAvailabilityDto {
  @ApiProperty({ example: 'esp32-devkit-v1' })
  slug!: string;

  @ApiProperty({ example: false })
  available!: boolean;

  @ApiProperty({
    example: 'esp32-devkit-v1-2',
    nullable: true,
    type: String,
    description:
      'The next free alternative, or `null` when the requested slug is already free. Numeric ' +
      'suffixes start at 2, because the unsuffixed slug is the first one.',
  })
  suggestion!: string | null;
}

export class SlugAvailabilityResponseDto {
  @ApiProperty({ type: SlugAvailabilityDto })
  data!: SlugAvailabilityDto;
}
