import { Controller, Get, Header, Param } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestLocale } from '../../../common/decorators/locale.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { SlugParamDto } from '../../../common/dto/slug-param.dto';
import type { Locale } from '../../../common/localization/locale';
import { CategoriesService, type TreeNode } from '../application/categories.service';
import {
  CategoryDetailResponseDto,
  CategoryDto,
  CategoryListResponseDto,
  CategoryTreeNodeDto,
  CategoryTreeResponseDto,
} from './dto/category-response.dto';

const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';
/** The tree is navigation furniture; it changes rarely and is read constantly. */
const TREE_CACHE = 'public, max-age=900';

function toTreeDto(node: TreeNode, locale: Locale): CategoryTreeNodeDto {
  return {
    ...CategoryDto.from(node.category, locale),
    children: node.children.map((child) => toTreeDto(child, locale)),
  };
}

/**
 * Public category surface.
 *
 * Authority: docs/architecture/API-CONTRACT.md §5.2.
 */
@ApiTags('catalog · categories')
@Controller('categories')
@Public()
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({
    summary: 'List all categories',
    description:
      'Flat list of every visible category, ordered by depth then sort order. Each row carries ' +
      '`parentId` and `depth`, so a client can assemble the tree itself if it prefers.',
  })
  @ApiOkResponse({ type: CategoryListResponseDto })
  async list(@RequestLocale() locale: Locale): Promise<CategoryListResponseDto> {
    return { data: CategoryDto.fromList(await this.categories.listAll(), locale) };
  }

  /** Declared before `:slug` so the literal path wins. */
  @Get('tree')
  @Header('Cache-Control', TREE_CACHE)
  @ApiOperation({
    summary: 'Category tree',
    description:
      'The nested navigation tree, roots first. Assembled in memory from a single read and ' +
      'cached for 15 minutes. Maximum depth is 3.',
  })
  @ApiOkResponse({ type: CategoryTreeResponseDto })
  async tree(@RequestLocale() locale: Locale): Promise<CategoryTreeResponseDto> {
    const roots = await this.categories.tree();

    return { data: roots.map((node) => toTreeDto(node, locale)) };
  }

  @Get(':slug')
  @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({
    summary: 'Category detail with breadcrumb',
    description:
      'Detail plus the ancestor trail, root first. To list this category’s products — including ' +
      'every descendant category’s — call `GET /products?category={slug}`.',
  })
  @ApiOkResponse({ type: CategoryDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'CATEGORY_NOT_FOUND' })
  async detail(
    @Param() params: SlugParamDto,
    @RequestLocale() locale: Locale,
  ): Promise<CategoryDetailResponseDto> {
    const { category, breadcrumb } = await this.categories.findBySlug(params.slug);

    return {
      data: {
        ...CategoryDto.from(category, locale),
        breadcrumb: CategoryDto.fromList(breadcrumb, locale),
      },
    };
  }
}
