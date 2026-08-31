import { Controller, Get, Header, Param } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestLocale } from '../../../common/decorators/locale.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { SlugParamDto } from '../../../common/dto/slug-param.dto';
import type { Locale } from '../../../common/localization/locale';
import { BrandsService } from '../application/brands.service';
import { BrandDetailResponseDto, BrandDto, BrandListResponseDto } from './dto/brand-response.dto';

const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

/**
 * Public brand surface.
 *
 * Authority: docs/architecture/API-CONTRACT.md §5.2.
 */
@ApiTags('catalog · brands')
@Controller('brands')
@Public()
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({
    summary: 'List all brands',
    description:
      'Flat alphabetical list. Brands are a filter dimension, not a required taxonomy — most ' +
      'products have none, so never require one in the UI.',
  })
  @ApiOkResponse({ type: BrandListResponseDto })
  async list(@RequestLocale() locale: Locale): Promise<BrandListResponseDto> {
    return { data: BrandDto.fromList(await this.brands.listAll(), locale) };
  }

  @Get(':slug')
  @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({
    summary: 'Brand detail',
    description:
      'To list this brand’s products, call `GET /products?brand={slug}`.',
  })
  @ApiOkResponse({ type: BrandDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'BRAND_NOT_FOUND' })
  async detail(
    @Param() params: SlugParamDto,
    @RequestLocale() locale: Locale,
  ): Promise<BrandDetailResponseDto> {
    return { data: BrandDto.from(await this.brands.findBySlug(params.slug), locale) };
  }
}
