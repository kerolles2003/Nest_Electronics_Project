import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequestLocale } from '../../../common/decorators/locale.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { PaginationMetaDto } from '../../../common/dto/pagination-meta.dto';
import { SlugParamDto } from '../../../common/dto/slug-param.dto';
import type { Locale } from '../../../common/localization/locale';
import { ProductsService } from '../application/products.service';
import { ProductQueryDto } from './dto/product-query.dto';
import { SuggestQueryDto } from './dto/suggest-query.dto';
import {
  PriceRangeDto,
  ProductDetailDto,
  ProductDetailResponseDto,
  ProductListItemDto,
  ProductListResponseDto,
  ProductSuggestionDto,
  ProductSuggestionListResponseDto,
  RelatedProductListResponseDto,
  SpecFacetDto,
  TermFacetDto,
} from './dto/product-response.dto';

/** Public catalogue responses are cacheable; nothing here is user-specific. */
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

/**
 * The public product surface. No authentication.
 *
 * Authority: docs/architecture/API-CONTRACT.md §5.2; SEARCH-MODEL.md §4, §10.
 *
 * ONE listing endpoint. Search is a PARAMETER (`q`), not a different resource —
 * category and brand pages are this same endpoint with a filter pre-applied.
 * Legacy shipped `/products` and `/search` as two pages running the same query
 * with duplicated URL-to-filter mapping.
 */
@ApiTags('catalog · products')
@Controller('products')
@Public()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({
    summary: 'List, search and filter products',
    description: [
      'The main discovery endpoint. Returns a page of products, the TRUE total match count and',
      'server-computed facets — all in one round trip.',
      '',
      '**Filters combine with AND.** `brand` is repeatable and ORs within itself; `spec` is',
      'repeatable and ANDs across keys while ORing within one key.',
      '',
      '**`category` matches the whole subtree**, so a parent category includes every descendant',
      "category's products. An unknown category slug returns 404; an unknown brand slug simply",
      'narrows the result set to nothing.',
      '',
      '**Facet counts reflect the filters currently applied**, because they are computed over the',
      'filtered set. `facets.priceRange` is the range across all matches, not the current page.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: ProductListResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR, UNKNOWN_FIELD or UNSUPPORTED_SORT.',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'CATEGORY_NOT_FOUND — unknown `category` slug.' })
  async list(
    @Query() query: ProductQueryDto,
    @RequestLocale() locale: Locale,
  ): Promise<ProductListResponseDto> {
    const { result, page, limit } = await this.products.search(query);

    // Facet money uses the catalogue currency; a second currency does not exist.
    const currency = result.items[0]?.currency ?? 'EGP';

    return {
      data: ProductListItemDto.fromList(result.items, locale),
      meta: PaginationMetaDto.of(page, limit, result.total),
      facets: {
        categories: TermFacetDto.fromList(result.categories, locale),
        brands: TermFacetDto.fromList(result.brands, locale),
        priceRange: PriceRangeDto.from(result.priceRange, currency),
        specs: SpecFacetDto.fromList(result.specs),
      },
    };
  }

  /**
   * Declared BEFORE `:slug` — Nest matches routes in declaration order, so the
   * literal path must win over the parameter.
   */
  @Get('suggest')
  @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({
    summary: 'Autocomplete suggestions',
    description:
      'Up to 8 lightweight results for a search-as-you-type box. Anchored PREFIX match on ' +
      'product name and SKU — makers search by part number, so SKU is matched first-class.',
  })
  @ApiOkResponse({ type: ProductSuggestionListResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async suggest(
    @Query() query: SuggestQueryDto,
    @RequestLocale() locale: Locale,
  ): Promise<ProductSuggestionListResponseDto> {
    const suggestions = await this.products.suggest(query.q);

    return { data: suggestions.map((product) => ProductSuggestionDto.from(product, locale)) };
  }

  @Get(':slug')
  @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({
    summary: 'Product detail',
    description:
      'Full detail by public slug, including every image and every spec. Inactive and ' +
      'soft-deleted products return 404 — identical to a slug that never existed, so an id ' +
      'can never become an existence oracle.',
  })
  @ApiOkResponse({ type: ProductDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'PRODUCT_NOT_FOUND' })
  async detail(
    @Param() params: SlugParamDto,
    @RequestLocale() locale: Locale,
  ): Promise<ProductDetailResponseDto> {
    const product = await this.products.findBySlug(params.slug);

    return { data: ProductDetailDto.fromProduct(product, locale) };
  }

  @Get(':slug/related')
  @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({
    summary: 'Related products',
    description: 'Up to 8 products in the same category, excluding this one, ordered by sales.',
  })
  @ApiOkResponse({ type: RelatedProductListResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'PRODUCT_NOT_FOUND' })
  async related(
    @Param() params: SlugParamDto,
    @RequestLocale() locale: Locale,
  ): Promise<RelatedProductListResponseDto> {
    const related = await this.products.findRelated(params.slug);

    return { data: ProductListItemDto.fromList(related, locale) };
  }
}
