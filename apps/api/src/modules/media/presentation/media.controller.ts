import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
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
import { Roles } from '../../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { AppException } from '../../../common/errors/app.exception';
import { mediaConfig, type MediaConfig } from '../../../config/media.config';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import { MediaService } from '../application/media.service';
import { DestroyMediaDto, ReconcileQueryDto, UploadMediaDto } from './dto/media-request.dto';
import {
  MediaAssetDto,
  MediaAssetResponseDto,
  MediaReconciliationDto,
  MediaReconciliationResponseDto,
} from './dto/media-response.dto';

const NO_STORE = 'no-store';

/**
 * Kept in step with `mediaConfig.maxBytes` by the module's own spec, not by
 * hope: a decorator is evaluated at class-definition time, before any config
 * namespace exists, so this cannot read the injected value. The spec asserts
 * the two are equal, which turns a silent divergence into a failing test.
 */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Managed media, staff-only.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §2 (ADR-MEDIA-001), §9.
 *
 * ## The endpoint ships EMPTY, on purpose
 *
 * No product has an image, nothing is migrated, and no admin screen calls this
 * (the upload UI is Phase 7). That is the Phase 4 decision: land the pipeline
 * early so Phase 7 and Phase 8's blog covers do not wait on it, and let its
 * tests be the only thing exercising it in the meantime.
 *
 * The risk that follows is named in the plan — "an upload endpoint with no real
 * content can rot unnoticed" — and the answer is that its tests cover the
 * REJECTION paths, not just the happy one: bad magic bytes, oversize, a
 * mismatched MIME, an image below the minimum, a destroy of something still
 * referenced.
 *
 * ## Why the guard order matters
 *
 * `@Roles` runs before `FileInterceptor` reads the body, so an unauthorised
 * caller is refused *before a single byte is accepted* — the first line of
 * ADR-MEDIA-001's flow, and the reason it is a flow rather than a list.
 */
@ApiTags('media')
@ApiBearerAuth()
@Controller('admin/media')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'UNAUTHENTICATED.' })
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'FORBIDDEN — media operations require an ADMIN or SUPER_ADMIN account.',
})
export class MediaController {
  constructor(
    private readonly media: MediaService,
    @Inject(mediaConfig.KEY) private readonly config: MediaConfig,
  ) {}

  /**
   * `memoryStorage` is Multer's default when no `storage` is given, and it is
   * the one this design requires: nothing untrusted is ever written to the
   * API's filesystem, so there is no temporary file to clean up, no disk to
   * fill, and no window in which an unvalidated file sits on a server.
   *
   * `limits.fileSize` makes Multer abort the stream mid-upload rather than
   * buffering the whole of an oversize file and rejecting it afterwards. The
   * service checks the size again — the rule belongs to the rule, not to the
   * framework wiring, and a future caller that does not pass through this
   * interceptor must still be refused.
   *
   * `files: 1` because the port stores one asset per call. A multi-file upload
   * that half-succeeds is a partial-failure story with no correct answer at
   * this scale, and refusing the shape is cheaper than inventing one.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 8 } }),
  )
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', NO_STORE)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload one image',
    description: [
      'Accepts `multipart/form-data` with a `file` part and the `entity` / `entityId` fields',
      'naming what the asset is for.',
      '',
      '**The server sees every byte** (ADR-MEDIA-001). It is checked against the size limit and',
      'the MIME allow-list, then **sniffed** — a file declaring `image/png` whose contents are',
      'not PNG is refused. It is then decoded, its EXIF orientation baked into the pixels, its',
      'metadata stripped, its long edge capped and its real dimensions read, before anything is',
      'stored. **The client is never the authority for any of it.**',
      '',
      '**The response has no `url` and never will.** Build the delivery URL from `publicId` and',
      '`version`; storing a rendered URL turns a CDN change into a data migration.',
      '',
      '**The original filename is discarded.** The server generates the identifier.',
    ].join('\n'),
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'entity', 'entityId'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'JPEG, PNG or WebP, at most 5 MB.' },
        entity: { type: 'string', enum: ['products', 'categories', 'brands', 'blog'] },
        entityId: { type: 'string', example: '68b000000000000000000001' },
      },
    },
  })
  @ApiCreatedResponse({ type: MediaAssetResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'INVALID_UPLOAD — no file part, an empty file, over the size limit, a MIME type outside ' +
      'the allow-list, contents that contradict the declared type, or an image whose shorter ' +
      'edge is under 200px. `details[0].message` says which. VALIDATION_ERROR — `entity` or ' +
      '`entityId` is malformed.',
  })
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadMediaDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MediaAssetResponseDto> {
    if (file === undefined) {
      throw AppException.invalidUpload('the request carried no `file` part');
    }

    const stored = await this.media.upload({
      buffer: file.buffer,
      declaredMimeType: file.mimetype,
      owner: { entity: body.entity, entityId: body.entityId },
      uploadedBy: new Types.ObjectId(user.id),
    });

    return { data: MediaAssetDto.from(stored) };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Destroy an unreferenced image',
    description: [
      'Permanently removes the asset from the store. **Refused with `409` while anything still',
      'references it** — the reference count is consulted first, and the error names how many',
      'documents would break.',
      '',
      'That refusal is the point of the reference ledger. Legacy duplication copied image URLs,',
      'so two products shared one storage object and deleting from either destroyed it for both.',
      '',
      '`publicId` is a **query parameter**, not a path segment, because it contains slashes.',
    ].join('\n'),
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'MEDIA_ASSET_NOT_FOUND.' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'MEDIA_ASSET_IN_USE — still referenced; `details[0].message` gives the count.',
  })
  async destroy(@Query() query: DestroyMediaDto): Promise<void> {
    await this.media.destroy(query.publicId);
  }

  @Get('reconciliation')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    summary: 'Orphan reconciliation report',
    description: [
      'Compares the store against the reference ledger in both directions and **reports**.',
      '',
      '**Nothing is deleted, by design** (MEDIA-MODEL.md §9.3). An automated deleter that',
      'misreads state destroys assets irreversibly; a report an admin acts on is the right trade',
      'at this scale. Revisit above ~10,000 assets.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: MediaReconciliationResponseDto })
  async reconcile(@Query() query: ReconcileQueryDto): Promise<MediaReconciliationResponseDto> {
    const report = await this.media.reconcile(
      query.limit === undefined ? 100 : Number(query.limit),
    );

    return { data: MediaReconciliationDto.from(report) };
  }
}
