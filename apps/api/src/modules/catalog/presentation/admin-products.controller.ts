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
  Put,
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
import { PaginationMetaDto } from '../../../common/dto/pagination-meta.dto';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import { ProductAdminService } from '../application/product-admin.service';
import { ProductImageService } from '../application/product-image.service';
import { EntityIdParamDto } from './dto/admin-catalog-shared.dto';
import {
  AdminProductQueryDto,
  CreateProductDto,
  UpdateProductDto,
} from './dto/admin-product-request.dto';
import {
  ArrangeImagesDto,
  AttachImageDto,
  DetachImageQueryDto,
  HardDeleteResponseDto,
} from './dto/admin-product-image.dto';
import {
  AdminProductDto,
  AdminProductListResponseDto,
  AdminProductResponseDto,
} from './dto/admin-product-response.dto';

/** A catalogue an operator is editing is never a cacheable document. */
const NO_STORE = 'no-store';

/**
 * Product CRUD for staff.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md; PLAN.md Phase 7.
 *
 * ## The thing this endpoint closes
 *
 * Until now the admin console wrote products to **Supabase** while the
 * storefront and the Flutter client read products from **Mongo** (F-09, D-6).
 * Two catalogues, and every edit an operator made was invisible to every
 * customer. This is the write half of closing that: the console's product
 * actions re-point here, and there stops being a second catalogue.
 *
 * ## Every write is audited, and the audit is not optional
 *
 * `AUDIT-MODEL.md` §3 lists price changes, publication state and destructive
 * catalogue operations as audited. The record is written post-commit by the
 * service (§5 rule 2) and cannot fail the write.
 *
 * ## Ids, not slugs
 *
 * §2: "Public reads by `slug`; admin operations by `_id`." A slug is editable,
 * so addressing an admin operation by one means the URL an operator has open
 * stops resolving the moment they rename the thing they are editing.
 */
@ApiTags('admin · catalogue')
@ApiBearerAuth()
@Controller('admin/catalog/products')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class AdminProductsController {
  constructor(
    private readonly catalogue: ProductAdminService,
    private readonly images: ProductImageService,
  ) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'The catalogue, as an operator sees it',
    description: [
      'Every product including **drafts** — `isActive: false` rows a customer cannot see. Soft-',
      'deleted products are EXCLUDED unless `?state=deleted` asks for them: a recoverable',
      'deletion has to be findable, but mixing deleted rows into the working list is how',
      'somebody edits a product no customer can reach and does not notice for a week.',
      '',
      '`?q=` matches SKU, slug and English name anywhere in the value — an operator typing',
      '"esp32" expects "ESP32-WROOM-32", which a tokenised text index would not return. The',
      'term is escaped before it reaches the database.',
      '',
      '`?lowStock=true` lists products at or below their own threshold, which is a per-product',
      'number and not one global constant.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminProductListResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR / UNKNOWN_FIELD.' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  async list(@Query() query: AdminProductQueryDto): Promise<AdminProductListResponseDto> {
    const page = await this.catalogue.list(query);

    return {
      data: page.items.map((product) => AdminProductDto.from(product)),
      meta: PaginationMetaDto.of(page.page, page.limit, page.total),
    };
  }

  @Get(':id')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'One product, in any state',
    description: [
      'The editor’s view: both language fields unresolved, `costPrice` present, `deletedAt`',
      'present. This is `ProductAdminDto` in CATALOG-MODEL.md §5 — a SEPARATE type from the',
      'public one, which is what guarantees a margin can never reach a customer. No runtime',
      'field-stripping is involved, so there is no option anyone can get wrong.',
      '',
      'A soft-deleted product resolves normally here. It must: the restore action is reached',
      'from its own page.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminProductResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR — `id` is not a 24-character hex id.' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'PRODUCT_NOT_FOUND.' })
  async detail(@Param() params: EntityIdParamDto): Promise<AdminProductResponseDto> {
    return { data: AdminProductDto.from(await this.catalogue.findById(new Types.ObjectId(params.id))) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a product',
    description: [
      '**Created UNPUBLISHED by default.** `isActive` defaults to `false` here, against the',
      'schema default of `true`, because a product created through this endpoint has no images',
      'and no stock yet — publishing it at the instant it is named puts a bare row in a',
      'customer’s search results. Publish is a separate, separately audited action.',
      '',
      '**`stock` is not accepted, and sending it is a 400.** InventoryModule is the sole writer',
      'of stock (CATALOG-MODEL.md §4) because every movement must produce a ledger event. A',
      'generic product write that could set `stock.onHand` is legacy defect M7 exactly. New',
      'products start at zero and receive stock through an inventory adjustment, which ledgers it.',
      '',
      'Also rejected, each for its own reason: `effectivePrice` (maintained — `salePrice ??',
      'basePrice`; a caller that could set it independently could make the sortable price',
      'disagree with the charged one), `rating` and `salesCount` (owned by other modules), and',
      '`images` (attaching an asset is reference-counted and has its own endpoint — a descriptor',
      'accepted here would point a product at an asset nothing had retained, which is exactly',
      'the state that lets a live image be deleted).',
      '',
      'The category and brand SNAPSHOTS are built server-side from the referenced documents.',
      'They are not accepted from the caller: a snapshot a client could write is one that can',
      'disagree with its source.',
    ].join('\n'),
  })
  @ApiCreatedResponse({ type: AdminProductResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_ERROR — a malformed field, or `salePrice` at or above `basePrice`. ' +
      'UNKNOWN_FIELD — a field this endpoint does not accept, including `stock`.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'CATEGORY_NOT_FOUND / BRAND_NOT_FOUND — including a soft-deleted one.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'DUPLICATE_SKU or DUPLICATE_SLUG. `details[0].field` names which, so the form marks the ' +
      'right box. A soft-deleted product still holds both.',
  })
  async create(
    @Body() body: CreateProductDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminProductResponseDto> {
    const created = await this.catalogue.create(body, {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminProductDto.from(created) };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a product',
    description: [
      'A PARTIAL update. An absent key means "leave it"; an explicit `null`, where the field is',
      'nullable, means "clear it" — which is how a sale is ended (`salePrice: null`) and how a',
      'brand is removed.',
      '',
      '**`sku` is not accepted.** CATALOG-MODEL.md §2 makes it immutable after creation: it is',
      'the warehouse identifier, printed on labels and quoted in supplier correspondence, and a',
      'system that lets it change is one where two people are holding different names for one',
      'part.',
      '',
      '**`isActive` is not accepted either.** Publishing has its own endpoints because it has',
      'its own audit codes — a visibility flip buried inside a general edit would be recorded as',
      '`PRODUCT_UPDATED`, and "when did this go live" would stop being answerable from the',
      'action index.',
      '',
      '**Renaming the slug writes a redirect.** The old slug is recorded in `slugRedirects` and',
      '`GET /products/{oldSlug}` answers `301` thereafter (§2 rules 3–5). Chains are collapsed',
      'at write time: rename A→B then B→C and A points straight at C, so resolution is always',
      'one hop with no cycle to guard.',
      '',
      '`salePrice` is validated against the RESULTING pair, not against what was sent — lowering',
      '`basePrice` below an untouched `salePrice` is refused, because both fields are',
      'individually valid and the product would end up "on sale" above list.',
      '',
      'Editing a soft-deleted product is refused with `409 PRODUCT_DELETED`: restore it first.',
      'An edit nobody can see is the same problem as the deleted rows the listing keeps out of',
      'its default view.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminProductResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_ERROR — a malformed field, or a resulting `salePrice` at or above ' +
      '`basePrice`. UNKNOWN_FIELD — `sku`, `isActive`, `stock`, `images` or any other field ' +
      'this endpoint does not accept.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'PRODUCT_NOT_FOUND / CATEGORY_NOT_FOUND / BRAND_NOT_FOUND.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'DUPLICATE_SLUG — another entity holds it. PRODUCT_DELETED — restore it first.',
  })
  async update(
    @Param() params: EntityIdParamDto,
    @Body() body: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminProductResponseDto> {
    const updated = await this.catalogue.update(new Types.ObjectId(params.id), body, {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminProductDto.from(updated) };
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Make a product publicly visible',
    description: [
      'Sets `isActive: true` and audits it as `PRODUCT_PUBLISHED`.',
      '',
      'Its own endpoint rather than a field, because AUDIT-MODEL.md §3 audits publication state',
      'separately from an ordinary edit. That is what makes "when did this go live, and who put',
      'it there" one indexed query rather than a scan of every product update ever made.',
      '',
      'Idempotent, and SILENT when it is a no-op: publishing an already-published product',
      'succeeds and writes no audit row, because a row recording that nothing changed is noise',
      'in a log kept for two years.',
      '',
      'A soft-deleted product is refused — restore is the operation that means "put this back",',
      'and it is audited as one.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminProductResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'PRODUCT_NOT_FOUND.' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'PRODUCT_DELETED — restore it first.' })
  async publish(
    @Param() params: EntityIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminProductResponseDto> {
    const updated = await this.catalogue.setPublished(new Types.ObjectId(params.id), true, {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminProductDto.from(updated) };
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hide a product from customers',
    description: [
      'Sets `isActive: false` and audits it as `PRODUCT_UNPUBLISHED`. The product keeps its',
      'slug, its SKU and its stock; it simply stops being publicly readable, along with its',
      'images and specs — CATALOG-MODEL.md §9, "child resources inherit the parent’s',
      'visibility", which is legacy defect Z6 where seven child tables leaked unreleased',
      'products.',
      '',
      'This is NOT deletion, and the difference matters to an operator: an unpublished product',
      'is still in the working list, still editable, and still counted. A deleted one is not.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminProductResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'PRODUCT_NOT_FOUND.' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'PRODUCT_DELETED.' })
  async unpublish(
    @Param() params: EntityIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminProductResponseDto> {
    const updated = await this.catalogue.setPublished(new Types.ObjectId(params.id), false, {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminProductDto.from(updated) };
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a product (soft)',
    description: [
      'Sets `deletedAt` **and** `isActive: false`, per CATALOG-MODEL.md §9. Both, because they',
      'answer different questions and a restore has to tell them apart: after this, "was it',
      'published" is unambiguously no, so bringing it back in front of customers becomes a',
      'separate, separately audited decision rather than something a restore does silently.',
      '',
      'The deletion is SOFT and the reasons are §9’s: analytics, reviews and reporting still',
      'resolve the product id; SKUs and slugs must not become silently reusable, because reusing',
      'one repoints every existing link at a different product; and an accidental deletion is',
      'recoverable.',
      '',
      'The product keeps its slug, and its `slugRedirects` rows are KEPT. Dropping them would',
      'make a restore silently lose every old URL that worked the day before.',
      '',
      'Deleting an already-deleted product is `409`, not `200`. A caller that receives success',
      'twice cannot tell whether it deleted once or twice, and the second answer would carry a',
      '`deletedAt` belonging to somebody else’s action.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminProductResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'PRODUCT_NOT_FOUND.' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'PRODUCT_DELETED — already deleted.' })
  async remove(
    @Param() params: EntityIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminProductResponseDto> {
    const deleted = await this.catalogue.softDelete(new Types.ObjectId(params.id), {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminProductDto.from(deleted) };
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Undo a soft delete',
    description: [
      'Clears `deletedAt`. The product comes back as a **draft** — `isActive` stays false.',
      '',
      'Restoring does not republish, and that is deliberate. Putting a product back in front of',
      'customers is a publication decision that AUDIT-MODEL.md §3 audits separately; a restore',
      'that also republished would record "restored" while doing the thing the',
      '`PRODUCT_PUBLISHED` index exists to be the record of. It also means the operator gets to',
      'look at the product before customers do, which is usually why it was deleted.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminProductResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR — the product is not deleted, so there is nothing to restore.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'PRODUCT_NOT_FOUND.' })
  async restore(
    @Param() params: EntityIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminProductResponseDto> {
    const restored = await this.catalogue.restore(new Types.ObjectId(params.id), {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminProductDto.from(restored) };
  }

  // --- images ---------------------------------------------------------------

  @Post(':id/images')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Attach an uploaded image to a product',
    description: [
      'Takes a `publicId` from `POST /admin/media` and, at most, an `alt`. **Every other field',
      'comes from the ledger** — width, height, format, bytes and version. MEDIA-MODEL.md §4:',
      'the browser is never the authority for media metadata. A client that could send',
      'dimensions could make a product page reserve the wrong space; one that could send a',
      'version could point the delivery URL at a generation the CDN has replaced.',
      '',
      '**This is what makes the image undeletable while it is in use.** The attach increments the',
      'asset’s reference count, and `DELETE /admin/media` refuses any asset whose count is above',
      'zero. Before this endpoint existed nothing had ever called `retain()`, so every count in',
      'the system sat at zero — harmless while no product had an image, and a live defect the',
      'moment one did.',
      '',
      'The first image on a product becomes its primary automatically: §8 requires exactly one',
      'when the array is non-empty, and leaving the first upload non-primary would render a',
      'placeholder on every grid until somebody noticed a radio button.',
      '',
      'Attaching the same asset twice is a `409`, not a no-op. A silent second attach would',
      'either double-count the reference — leaving the asset undeletable forever — or skip the',
      'retain and leave the count one short, making it deletable while a live page shows it.',
      'Both are silent; this is not.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminProductResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR / UNKNOWN_FIELD.' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'PRODUCT_NOT_FOUND. MEDIA_ASSET_NOT_FOUND — the id is not in the ledger.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'PRODUCT_IMAGE_LIMIT — eight already. PRODUCT_IMAGE_ALREADY_ATTACHED. ' +
      'PRODUCT_DELETED — restore it first.',
  })
  async attachImage(
    @Param() params: EntityIdParamDto,
    @Body() body: AttachImageDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminProductResponseDto> {
    const updated = await this.images.attach(
      new Types.ObjectId(params.id),
      body.publicId,
      body.alt ?? null,
      { actorId: new Types.ObjectId(user.id), forensics },
    );

    return { data: AdminProductDto.from(updated) };
  }

  @Delete(':id/images')
  @ApiOperation({
    summary: 'Remove an image from a product',
    description: [
      'Releases the reference and removes the descriptor. **It never destroys the asset.** One',
      'that falls to zero references is a CANDIDATE for cleanup, reported by',
      '`GET /admin/media/reconciliation` — MEDIA-MODEL.md §9 is explicit that reconciliation',
      'reports rather than deletes, because an automated deleter that misreads state destroys',
      'production assets irreversibly. The same asset may also still be attached elsewhere.',
      '',
      'If the image removed was the primary, the first remaining one becomes primary. Leaving a',
      'product with images and no primary renders a placeholder on every grid — K10’s symptom,',
      'reached by a different route.',
      '',
      '`publicId` is a query parameter rather than a path segment because it contains slashes:',
      'a path segment would have to be double-encoded by every caller, and a caller that forgot',
      'would silently address a different route.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminProductResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR.' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'PRODUCT_NOT_FOUND. PRODUCT_IMAGE_NOT_FOUND — not on this product.',
  })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'PRODUCT_DELETED.' })
  async detachImage(
    @Param() params: EntityIdParamDto,
    @Query() query: DetachImageQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminProductResponseDto> {
    const updated = await this.images.detach(new Types.ObjectId(params.id), query.publicId, {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminProductDto.from(updated) };
  }

  @Put(':id/images')
  @ApiOperation({
    summary: 'Reorder, re-caption and choose the primary — in one atomic write',
    description: [
      'Two legacy defects disappear together here, and both were "the array was written in',
      'pieces":',
      '',
      '- **K9** — reordering was an N+1 update loop, one statement per image, so an interrupted',
      '  reorder left an order that was neither the old one nor the new.',
      '- **K10** — "make this the primary" was two statements, unset then set, so an interruption',
      '  between them left a product with NO primary image and every grid rendering a placeholder.',
      '',
      'The whole array is written in a single `$set`. CATALOG-MODEL.md §8 asks for exactly this.',
      '',
      'The request must name exactly the images the product already has. That restriction is what',
      'makes this operation incapable of changing a reference count — attach and detach are the',
      'only two endpoints that touch the ledger, so there is one place to be right about it',
      'rather than three.',
      '',
      'POSITION is the order. `sortOrder` is assigned from the index rather than accepted, because',
      'two entries a client numbered identically would produce an order the database resolves',
      'arbitrarily.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminProductResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_ERROR — the list does not match the product’s images, repeats one, or names ' +
      'more than one primary.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Staff only.' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'PRODUCT_NOT_FOUND. PRODUCT_IMAGE_NOT_FOUND.',
  })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'PRODUCT_DELETED.' })
  async arrangeImages(
    @Param() params: EntityIdParamDto,
    @Body() body: ArrangeImagesDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<AdminProductResponseDto> {
    const updated = await this.images.arrange(new Types.ObjectId(params.id), body.images, {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return { data: AdminProductDto.from(updated) };
  }

  // --- hard delete ----------------------------------------------------------

  @Delete(':id/permanent')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Destroy a product permanently, and its images with it',
    description: [
      'CATALOG-MODEL.md §9: "Hard delete exists only as a `SUPER_ADMIN` operation for a product',
      '**never referenced by any order**, and it destroys the associated Cloudinary assets."',
      'Every clause of that sentence is a separate guard.',
      '',
      '**SUPER_ADMIN only** — an ADMIN gets 403 here and 200 on the soft delete beside it.',
      '',
      '**Never ordered.** Orders embed product snapshots, so the commercial record survives',
      'regardless — but every line keeps `productId` for traceability and reorder, and destroying',
      'the document turns that into a dangling id that analytics and the reorder button both',
      'follow to nothing. A referenced product is refused with a count, and soft delete is the',
      'answer for it. That is what soft delete is for.',
      '',
      '**The images are destroyed — except the ones another product is showing.** Each is',
      'released; only those that fall to zero references are destroyed in the store. Legacy',
      'destroyed the object regardless of who else pointed at it, and the surviving product',
      'rendered a broken image with no indication of why (W4). The response names both lists.',
      '',
      'The product’s `slugRedirects` rows are removed here and ONLY here: a soft delete keeps',
      'them because the product is coming back, and this is the one operation after which the',
      'destination genuinely no longer exists.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: HardDeleteResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'FORBIDDEN — SUPER_ADMIN only. An ADMIN may soft-delete and nothing more.',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'PRODUCT_NOT_FOUND.' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'PRODUCT_HAS_ORDERS — `details` names how many. Use the soft delete.',
  })
  async hardDelete(
    @Param() params: EntityIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
    @Forensics() forensics: ForensicContext,
  ): Promise<HardDeleteResponseDto> {
    const outcome = await this.catalogue.hardDelete(new Types.ObjectId(params.id), {
      actorId: new Types.ObjectId(user.id),
      forensics,
    });

    return {
      data: {
        sku: outcome.sku,
        slug: outcome.slug,
        imagesDestroyed: [...outcome.imagesDestroyed],
        imagesKept: [...outcome.imagesKept],
      },
    };
  }
}
