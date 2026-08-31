import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Autocomplete input.
 *
 * Authority: docs/architecture/SEARCH-MODEL.md §10 — `GET /products/suggest?q=`.
 * `q` is REQUIRED here (unlike on the listing endpoint, where its absence means
 * browse mode): a suggestion request without a term has no meaning.
 */
export class SuggestQueryDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 100,
    example: 'esp',
    description: 'Prefix to match against product name and SKU.',
  })
  @IsString()
  @MinLength(1, { message: 'q must not be empty' })
  @MaxLength(100, { message: 'q must not exceed 100 characters' })
  q!: string;
}
