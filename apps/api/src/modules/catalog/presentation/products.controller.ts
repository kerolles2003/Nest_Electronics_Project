import { Controller, Get, Header, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequestLocale } from '../../../common/decorators/locale.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { PaginationMetaDto } from '../../../common/dto/pagination-meta.dto';
import { SlugParamDto } from '../../../common/dto/slug-param.dto';
import type { Locale } from '../../../common/localization/locale';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-code.enum';
import { SlugRedirectService } from '../application/slug-redirect.service';
import { ProductsService } from '../application/products.service';
import { SlugRedirectEntityType } from '../infrastructure/schemas/slug-redirect.schema';
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
  ProductMovedResponseDto,
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
  constructor(
    private readonly products: ProductsService,
    private readonly redirects: SlugRedirectService,
  ) {}

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
    description: [
      'Full detail by public slug, including every image and every spec. Inactive and',
      'soft-deleted products return 404 — identical to a slug that never existed, so an id can',
      'never become an existence oracle.',
      '',
      '**A slug that has been renamed answers `301` with a `Location` header** pointing at the',
      'current one (CATALOG-MODEL.md §2 rule 4, ADR-CATALOG-005). The redirect is a FALLBACK:',
      'a live slug is resolved first and never consults the redirect table, so a slug that has',
      'been re-used by a different product resolves to that product rather than to wherever the',
      'previous holder went.',
      '',
      'Legacy wrote these redirect rows on every rename and **nothing ever read one**, so every',
      'rename produced a permanent 404 with a database row recording exactly where the page had',
      'gone. That is defect K4, and this lookup is the half that was missing.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: ProductDetailResponseDto })
  @ApiResponse({
    status: 301,
    description:
      'The slug was renamed. `Location` carries the current URL; the body repeats the target ' +
      'slug so a client that does not follow redirects can still act on it.',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'PRODUCT_NOT_FOUND' })
  async detail(
    @Param() params: SlugParamDto,
    @RequestLocale() locale: Locale,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponseDto | ProductMovedResponseDto> {
    try {
      const product = await this.products.findBySlug(params.slug);

      return { data: ProductDetailDto.fromProduct(product, locale) };
    } catch (error) {
      /*
       * Only a genuine miss falls through to the redirect table. Anything else
       * — a database failure, a validation error — propagates, because
       * answering "moved" to a request that failed for another reason would
       * send a customer to a different product on the strength of an error
       * nobody looked at.
       */
      if (!(error instanceof AppException) || error.code !== ErrorCode.PRODUCT_NOT_FOUND) {
        throw error;
      }

      const target = await this.redirects.resolve(SlugRedirectEntityType.PRODUCT, params.slug);

      if (target === null) throw error;

      /*
       * The Location is derived from the URL that was actually requested, so it
       * stays correct under any global prefix or version the app is mounted
       * with. Building it from a constant would break the first time either
       * changes, and it would break silently — a 301 to a 404.
       */
      const path = request.originalUrl.split('?')[0] ?? '';

      response.status(301);
      response.setHeader('Location', path.replace(/[^/]+$/, encodeURIComponent(target)));

      return { data: { movedTo: target } };
    }
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
