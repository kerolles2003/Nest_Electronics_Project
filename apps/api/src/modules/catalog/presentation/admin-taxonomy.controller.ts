import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Forensics, type ForensicContext } from '../../../common/decorators/forensics.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import { BrandAdminService } from '../application/brand-admin.service';
import { CategoryAdminService } from '../application/category-admin.service';
import { EntityIdParamDto } from './dto/admin-catalog-shared.dto';
import {
  AdminBrandDto,
  AdminBrandListResponseDto,
  AdminBrandResponseDto,
  AdminCategoryDto,
  AdminCategoryListResponseDto,
  AdminCategoryResponseDto,
  CreateBrandDto,
  CreateCategoryDto,
  TaxonomyListQueryDto,
  UpdateBrandDto,
  UpdateCategoryDto,
} from './dto/admin-taxonomy.dto';

const NO_STORE = 'no-store';

/**
 * Category and brand CRUD for staff.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §6, §2, §9.
 *
 * ## One controller for both, because they are one screen's worth of work
 *
 * A brand is a category with the hierarchy taken out. Two controllers would
 * duplicate every decorator, every error description and the whole
 * authorization block to vary `parentId`.
 *
 * ## Neither list is paginated
 *
 * 27 categories and 17 brands, and the tree endpoint already reads all of them
 * in one `find()`. Paginating a collection an operator wants to see as a tree
 * would mean assembling a tree from a page, which is not a tree.
 */
@ApiTags('admin · catalogue')
@ApiBearerAuth()
@Controller('admin/catalog')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class AdminTaxonomyController {
  constructor(
    private readonly categories: CategoryAdminService,
    private readonly brands: BrandAdminService,
  ) {}

  // --- categories -----------------------------------------------------------

  @Get('categories')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Every category, flat, shallowest first',
    description: [
      'Flat rather than nested, because this is the editor’s list: each row carries its own',
      '`parentId`, `path` and `depth`, so a console can assemble whatever shape it wants without',
      'a second request. The nested version customers see is `GET /categories/tree`.',
      '',
      'Inactive categories are always included — an operator has to be able to find the one they',
      'hid. Soft-deleted ones need `?includeDeleted=true`.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminCategoryListResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  async listCategories(@Query() query: TaxonomyListQueryDto): Promise<AdminCategoryListResponseDto> {
    const rows = await this.categories.list(query.includeDeleted ?? false);

    return { data: rows.map((row) => AdminCategoryDto.from(row)) };
  }

  @Get('categories/:id')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({ summary: 'One category, in any state' })
  @ApiOkResponse({ type: AdminCategoryResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'CATEGORY_NOT_FOUND.' })
  async categoryDetail(@Param() params: EntityIdParamDto): Promise<AdminCategoryResponseDto> {
    return {
      data: AdminCategoryDto.from(await this.categories.findById(new Types.ObjectId(params.id))),
    };
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a category',
    description: [
      '`path` and `depth` are computed from `parentId` and are NOT accepted. `path` is the',
      'materialised ancestor chain that makes "every product in this subtree" one indexed match',
      '(ADR-CATALOG-004); a caller-supplied one is a chain that can disagree with `parentId`,',
      'and every subtree query would then be answering from the disagreement.',
      '',
      'The depth limit is `3` — MONGODB-DESIGN.md §5. CATALOG-MODEL.md §6 phrases the same limit',
      'as "max 3 levels"; the two reconcile because §6’s own table records the live tree at',
      '**depth** 2, so "levels" there is loose phrasing for the depth §5 names. The reading is',
      'recorded rather than assumed.',
    ].join('\n'),
  })
  @ApiCreatedResponse({ type: AdminCategoryResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR — a malformed field, or a parent that would exceed the depth limit.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'CATEGORY_NOT_FOUND — the parent, including a soft-deleted one.',
  })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'DUPLICATE_SLUG.' })
  async createCategory(
    @Body() body: CreateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminCategoryResponseDto> {
    const created = await this.categories.create(body, {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminCategoryDto.from(created) };
  }

  @Patch('categories/:id')
  @ApiOperation({
    summary: 'Edit or reparent a category',
    description: [
      '**Three things move when one category does, and this endpoint moves all three.**',
      '',
      '1. The category’s own `path` and `depth`, and every descendant’s. `path[]` is materialised',
      '   because MongoDB has no recursive CTE; the price is that a reparent rewrites the subtree',
      '   by hand.',
      '2. Every product’s `category` snapshot — name, slug and the subtree `path`. §6 names the',
      '   mechanism (`updateMany({"category.id": X}, …)`) and calls the staleness window one',
      '   operation on a display label. A rename that skipped this would leave every product card',
      '   showing the old name until something else rewrote it, and nothing else does.',
      '3. The cached category list, which is otherwise fifteen minutes stale.',
      '',
      '**Cycle detection is mandatory** (§6). A category cannot become its own parent, and cannot',
      'be moved underneath one of its own subcategories. A cycle makes `path[]` unwritable —',
      'there is no finite ancestor chain — and every tree read afterwards either loops or',
      'silently drops the branch.',
      '',
      'The depth limit is checked against the **deepest descendant**, not against this category:',
      'moving a two-level subtree down one level is legal only if the bottom of it still fits.',
      '',
      'Renaming the slug writes a `slugRedirects` row, exactly as a product rename does.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminCategoryResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_ERROR — a malformed field, a move that would create a cycle, or one that ' +
      'would push a descendant past the depth limit.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'CATEGORY_NOT_FOUND.' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'DUPLICATE_SLUG. CATEGORY_DELETED — restore it first.',
  })
  async updateCategory(
    @Param() params: EntityIdParamDto,
    @Body() body: UpdateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminCategoryResponseDto> {
    const updated = await this.categories.update(new Types.ObjectId(params.id), body, {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminCategoryDto.from(updated) };
  }

  @Delete('categories/:id')
  @ApiOperation({
    summary: 'Delete an EMPTY category (soft)',
    description: [
      'Refused with `409 CATEGORY_NOT_EMPTY` while products or live subcategories still point at',
      'it, and the message names both counts so the refusal is a work list rather than a wall.',
      '',
      'A cascade was rejected. It would soft-delete a subtree in one click with no way for the',
      'operator to know what went with it — and every product left behind would be filed under a',
      'category that renders nowhere, which is the exact state `POST /admin/catalog/products`',
      'already refuses to create. Allowing it here would make that state reachable by another door.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminCategoryResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'CATEGORY_NOT_FOUND.' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'CATEGORY_NOT_EMPTY — products or subcategories still belong to it. ' +
      'CATEGORY_DELETED — already deleted.',
  })
  async deleteCategory(
    @Param() params: EntityIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminCategoryResponseDto> {
    const deleted = await this.categories.softDelete(new Types.ObjectId(params.id), {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminCategoryDto.from(deleted) };
  }

  // --- brands ---------------------------------------------------------------

  @Get('brands')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({ summary: 'Every brand, alphabetically' })
  @ApiOkResponse({ type: AdminBrandListResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  async listBrands(@Query() query: TaxonomyListQueryDto): Promise<AdminBrandListResponseDto> {
    const rows = await this.brands.list(query.includeDeleted ?? false);

    return { data: rows.map((row) => AdminBrandDto.from(row)) };
  }

  @Get('brands/:id')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({ summary: 'One brand, in any state' })
  @ApiOkResponse({ type: AdminBrandResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'BRAND_NOT_FOUND.' })
  async brandDetail(@Param() params: EntityIdParamDto): Promise<AdminBrandResponseDto> {
    return { data: AdminBrandDto.from(await this.brands.findById(new Types.ObjectId(params.id))) };
  }

  @Post('brands')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a brand' })
  @ApiCreatedResponse({ type: AdminBrandResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR / UNKNOWN_FIELD.' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'DUPLICATE_SLUG.' })
  async createBrand(
    @Body() body: CreateBrandDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminBrandResponseDto> {
    const created = await this.brands.create(body, {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminBrandDto.from(created) };
  }

  @Patch('brands/:id')
  @ApiOperation({
    summary: 'Edit a brand',
    description:
      'A rename rewrites the `brand` snapshot on every product that references it (§6), and a ' +
      'slug change writes a `slugRedirects` row. Without the first, every product card keeps ' +
      'showing the old brand name — nothing else ever rewrites that snapshot.',
  })
  @ApiOkResponse({ type: AdminBrandResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR / UNKNOWN_FIELD.' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'BRAND_NOT_FOUND.' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'DUPLICATE_SLUG. BRAND_DELETED — restore it first.',
  })
  async updateBrand(
    @Param() params: EntityIdParamDto,
    @Body() body: UpdateBrandDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminBrandResponseDto> {
    const updated = await this.brands.update(new Types.ObjectId(params.id), body, {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminBrandDto.from(updated) };
  }

  @Delete('brands/:id')
  @ApiOperation({
    summary: 'Delete a brand (soft), un-branding its products',
    description: [
      'Unlike a category, this is NOT refused when products reference the brand — and the',
      'asymmetry is the design, not an oversight. `product.brand` is nullable: 53 of 85 live',
      'products have no brand and every listing already renders without one, so a product whose',
      'brand goes away lands in a state the whole system handles.',
      '',
      'Their `brand` snapshot is therefore CLEARED. Leaving it would put a filter in the brand',
      'facet that returns products whose brand page 404s. How many products were un-branded is',
      'recorded in the audit metadata, because it is the consequence the operator did not',
      'explicitly ask for.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminBrandResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'BRAND_NOT_FOUND.' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'BRAND_DELETED — already deleted.' })
  async deleteBrand(
    @Param() params: EntityIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminBrandResponseDto> {
    const deleted = await this.brands.softDelete(new Types.ObjectId(params.id), {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminBrandDto.from(deleted) };
  }
}
