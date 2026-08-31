import { ApiProperty } from '@nestjs/swagger';
import { resolveOptionalText, resolveText, type Locale } from '../../../../common/localization/locale';
import type { CategoryLean } from '../../infrastructure/schemas/category.schema';
import { ProductImageDto } from './product-response.dto';

/**
 * A category node.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §6; MONGODB-DESIGN.md §5.
 *
 * `parentId` and `depth` are exposed so a client can render the tree from the
 * flat list without a second call; `/categories/tree` returns the assembled
 * form for clients that would rather not.
 */
export class CategoryDto {
  @ApiProperty({ example: '652f1a9b3c4d5e6f7a8b9c0d' })
  id!: string;

  @ApiProperty({ example: 'microcontrollers' })
  slug!: string;

  @ApiProperty({ example: 'Microcontrollers' })
  name!: string;

  @ApiProperty({ example: 'Boards and MCUs for embedded projects.', nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ example: null, nullable: true, type: String, description: 'Parent category id; null for a root.' })
  parentId!: string | null;

  @ApiProperty({ example: 0, description: 'Number of ancestors. Roots are 0; the tree is capped at depth 2.' })
  depth!: number;

  @ApiProperty({ type: ProductImageDto, nullable: true })
  image!: ProductImageDto | null;

  @ApiProperty({ example: 12, description: 'Active products in this category AND its descendants.' })
  productCount!: number;

  @ApiProperty({ example: 0 })
  sortOrder!: number;

  static from(category: CategoryLean, locale: Locale): CategoryDto {
    return {
      id: category._id.toHexString(),
      slug: category.slug,
      name: resolveText(category.name, locale),
      description: resolveOptionalText(category.description, locale),
      parentId: category.parentId === null ? null : category.parentId.toHexString(),
      depth: category.depth,
      image: category.image === null ? null : ProductImageDto.from(category.image),
      productCount: category.productCount,
      sortOrder: category.sortOrder,
    };
  }

  static fromList(categories: readonly CategoryLean[], locale: Locale): CategoryDto[] {
    return categories.map((category) => CategoryDto.from(category, locale));
  }
}

/**
 * The assembled tree.
 *
 * Built with ONE find() over all categories plus in-memory assembly, and cached.
 * Legacy queried this on every page render because the root layout rendered an
 * async navbar — 1,664 sequential scans (Phase 0 P1).
 */
export class CategoryTreeNodeDto extends CategoryDto {
  @ApiProperty({ type: () => [CategoryTreeNodeDto] })
  children!: CategoryTreeNodeDto[];
}

/** Category detail plus the breadcrumb trail, root first, excluding the category itself. */
export class CategoryDetailDto extends CategoryDto {
  @ApiProperty({ type: [CategoryDto], description: 'Ancestors, root first. Empty for a root category.' })
  breadcrumb!: CategoryDto[];
}

export class CategoryListResponseDto {
  @ApiProperty({ type: [CategoryDto] })
  data!: CategoryDto[];
}

export class CategoryTreeResponseDto {
  @ApiProperty({ type: [CategoryTreeNodeDto] })
  data!: CategoryTreeNodeDto[];
}

export class CategoryDetailResponseDto {
  @ApiProperty({ type: CategoryDetailDto })
  data!: CategoryDetailDto;
}
