import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MAX_PRODUCT_IMAGES } from '../../application/product-image.service';

/**
 * Attaching, detaching and arranging a product's images.
 *
 * ## What a client is allowed to say about an image, and what it is not
 *
 * It may say WHICH asset (`publicId`), what it is a picture of (`alt`), where
 * it sits (position in the array) and whether it is the primary. That is the
 * complete list.
 *
 * It may not say how wide it is, how tall, what format, how many bytes, or what
 * version. Those come from the ledger. MEDIA-MODEL.md §4: the browser is never
 * the authority for media metadata — it was in legacy, which is why 22 rows
 * carried absolute URLs and no dimensions at all, and every product grid shifted
 * as the images loaded.
 */

/**
 * A Cloudinary public id as this system generates them:
 * `<root>/<entity>/<entityId>/<random>` (MEDIA-MODEL.md §6).
 *
 * Validated as a shape rather than merely as a string, because it is compared
 * against ledger rows and appears in log lines. The characters permitted are
 * exactly those the generator can produce — lowercase words, digits, `/`, `-`
 * and `_` (base64url). No dots, so nothing resembling a path traversal or a
 * file extension can arrive here at all.
 */
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9_-]+)+$/;

export class AttachImageDto {
  @ApiProperty({
    example: 'nest/products/652f1a9b3c4d5e6f7a8b9c0d/kK3nQ8vRb2Xf',
    description:
      'The identifier `POST /admin/media` returned. It must already be in the ledger — an ' +
      'unknown one is a 404, because attaching a descriptor for an object this system cannot ' +
      'manage is how an image ends up impossible to delete or impossible to keep.',
  })
  @IsString()
  @MaxLength(300)
  @Matches(PUBLIC_ID_PATTERN, { message: 'publicId is not a well-formed media identifier' })
  publicId!: string;

  @ApiPropertyOptional({
    example: 'ESP32 DevKit V1, front view',
    nullable: true,
    maxLength: 200,
    description:
      'Alternative text. A property of this USE of the asset, not of the asset — two products ' +
      'sharing one photograph caption it differently, which is why it lives on the product and ' +
      'not in the ledger.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  alt?: string | null;
}

export class DetachImageQueryDto {
  @ApiProperty({ example: 'nest/products/652f1a9b3c4d5e6f7a8b9c0d/kK3nQ8vRb2Xf' })
  @IsString()
  @MaxLength(300)
  @Matches(PUBLIC_ID_PATTERN, { message: 'publicId is not a well-formed media identifier' })
  publicId!: string;
}

export class ArrangeImageEntryDto {
  @ApiProperty({ example: 'nest/products/652f1a9b3c4d5e6f7a8b9c0d/kK3nQ8vRb2Xf' })
  @IsString()
  @MaxLength(300)
  @Matches(PUBLIC_ID_PATTERN, { message: 'publicId is not a well-formed media identifier' })
  publicId!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 200, description: 'Omit to leave the caption alone.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  alt?: string | null;

  @ApiPropertyOptional({
    example: true,
    description:
      'At most one entry may set this. If none does, the FIRST entry becomes the primary — the ' +
      '"exactly one primary" invariant is not optional, and a client that omits the flag must ' +
      'not be able to produce a product with none.',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class ArrangeImagesDto {
  @ApiProperty({
    type: [ArrangeImageEntryDto],
    description:
      'The product’s images, IN THE ORDER THEY SHOULD APPEAR. The list must name exactly the ' +
      'images the product already has — no additions, no removals. That restriction is what ' +
      'makes this operation incapable of changing a reference count: attach and detach are the ' +
      'only two endpoints that touch the ledger.',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'send the images in order; to remove one, use detach' })
  @ArrayMaxSize(MAX_PRODUCT_IMAGES)
  @ValidateNested({ each: true })
  @Type(() => ArrangeImageEntryDto)
  images!: ArrangeImageEntryDto[];
}

/** What a hard delete destroyed. */
export class HardDeleteResultDto {
  @ApiProperty({ example: 'ESP32-WROOM-32' }) sku!: string;
  @ApiProperty({ example: 'esp32-devkit-v1' }) slug!: string;

  @ApiProperty({
    type: [String],
    description: 'Assets that fell to zero references and were destroyed in the store.',
  })
  imagesDestroyed!: string[];

  @ApiProperty({
    type: [String],
    description:
      'Assets ANOTHER product still shows, and which were therefore left alone. This is what ' +
      'reference counting is for — legacy destroyed the object regardless and the other ' +
      'product rendered a broken image with no indication of why (W4).',
  })
  imagesKept!: string[];
}

export class HardDeleteResponseDto {
  @ApiProperty({ type: HardDeleteResultDto })
  data!: HardDeleteResultDto;
}
