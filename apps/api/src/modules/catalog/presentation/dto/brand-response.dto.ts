import { ApiProperty } from '@nestjs/swagger';
import { resolveOptionalText, resolveText, type Locale } from '../../../../common/localization/locale';
import type { BrandLean } from '../../infrastructure/schemas/brand.schema';
import { ProductImageDto } from './product-response.dto';

/**
 * A brand.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §6 — a flat list, no hierarchy.
 * 17 brands live, and 53 of 85 products have none, so this is a filter
 * dimension rather than a required taxonomy.
 */
export class BrandDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0e' })
  id!: string;

  @ApiProperty({ example: 'espressif' })
  slug!: string;

  @ApiProperty({ example: 'Espressif' })
  name!: string;

  @ApiProperty({ example: 'Wi-Fi and Bluetooth SoC manufacturer.', nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ type: ProductImageDto, nullable: true, description: 'Optional; 0 of 17 legacy brands had one.' })
  logo!: ProductImageDto | null;

  @ApiProperty({ example: 'https://www.espressif.com', nullable: true, type: String })
  website!: string | null;

  @ApiProperty({ example: 8, description: 'Active products carrying this brand.' })
  productCount!: number;

  static from(brand: BrandLean, locale: Locale): BrandDto {
    return {
      id: brand._id.toHexString(),
      slug: brand.slug,
      name: resolveText(brand.name, locale),
      description: resolveOptionalText(brand.description, locale),
      logo: brand.logo === null ? null : ProductImageDto.from(brand.logo),
      website: brand.website,
      productCount: brand.productCount,
    };
  }

  static fromList(brands: readonly BrandLean[], locale: Locale): BrandDto[] {
    return brands.map((brand) => BrandDto.from(brand, locale));
  }
}

export class BrandListResponseDto {
  @ApiProperty({ type: [BrandDto] })
  data!: BrandDto[];
}

export class BrandDetailResponseDto {
  @ApiProperty({ type: BrandDto })
  data!: BrandDto;
}
