import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from '../../app.module';
import { appConfig, type AppConfig } from '../../config/app.config';
import { mediaConfig, type MediaConfig } from '../../config/media.config';
import { Brand } from '../../modules/catalog/infrastructure/schemas/brand.schema';
import { Category } from '../../modules/catalog/infrastructure/schemas/category.schema';
import { Product } from '../../modules/catalog/infrastructure/schemas/product.schema';
import { ImportRunner } from './import-runner';
import { countByOutcome, renderReport } from './import-report';
import { ProfileError, validateProfile } from './mapping-profile';
import { ImageImporter } from './image-importer';
import { MediaService } from '../../modules/media/application/media.service';

/**
 * The catalogue import tool.
 *
 * Authority: PLAN.md Phase 4 item 1; D-6 (the real catalogue is entered fresh).
 *
 *   pnpm --filter api catalogue:import -- --file <path> --profile <path> [--dry-run]
 *
 * ## What it is for
 *
 * The owner has no catalogue yet. When one arrives — from a supplier feed or
 * another external source whose columns nobody can predict — this turns it into
 * products without waiting for the admin UI (Phase 7) and without anybody
 * typing 4,000 rows by hand.
 *
 * It is **kept after launch**, not thrown away. There is no legacy catalogue to
 * migrate (D-6), so it was never a migration aid; it is how bulk additions are
 * made, permanently.
 *
 * ## Why it refuses to run in production
 *
 * It does not. This one deliberately CAN run in production — unlike the seed,
 * which is development data and refuses. Loading the real catalogue is the
 * entire purpose, and a tool that cannot touch the live shop cannot do it.
 *
 * The protections are different in kind, and both are about the operator being
 * able to see what will happen before it happens:
 *   · `--dry-run` reads, validates and reports without writing a single
 *     document, so the first run of any new file can be free of consequence;
 *   · nothing is ever DELETED. A row absent from the file leaves its product
 *     alone. An import that could delete would mean a truncated export silently
 *     emptying a shop.
 */

const logger = new Logger('CatalogueImport');

interface Arguments {
  readonly file: string;
  readonly profile: string;
  readonly dryRun: boolean;
  readonly withImages: boolean;
}

function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  let dryRun = false;
  let withImages = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';

    if (argument === '--') {
      // pnpm forwards the end-of-options marker itself, so the documented
      // invocation arrives with a literal `--` in argv. Ignoring it is the
      // conventional reading and the only one that makes the command in
      // CATALOGUE-IMPORT.md work — which is how this was found.
      continue;
    }

    if (argument === '--dry-run') {
      dryRun = true;
    } else if (argument === '--images') {
      withImages = true;
    } else if (argument.startsWith('--')) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${argument} needs a value`);
      }
      values.set(argument.slice(2), next);
      index += 1;
    }
  }

  const file = values.get('file');
  const profile = values.get('profile');

  if (file === undefined || profile === undefined) {
    throw new Error(
      'usage: pnpm --filter api catalogue:import -- --file <catalogue.csv> --profile <profile.json> [--dry-run]',
    );
  }

  return { file: resolve(file), profile: resolve(profile), dryRun, withImages };
}

async function main(): Promise<void> {
  let args: Arguments;

  try {
    args = parseArguments(process.argv.slice(2));
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const config = app.get<AppConfig>(appConfig.KEY);
    const media = app.get<MediaConfig>(mediaConfig.KEY);

    /*
     * Images are OPT-IN, and still refused outright on the in-memory store.
     *
     * With `MEDIA_PROVIDER=memory` the uploaded bytes live in THIS process and
     * are gone when it exits, so every imported product would reference an
     * asset that does not exist — worse than importing no images at all, and
     * worse silently. It is refused rather than warned about.
     *
     * The flag itself is implemented now that a real account exists (D-4).
     * Every file goes through `MediaService`, so a supplier's photograph is
     * sniffed, size-capped, EXIF-stripped and ledgered exactly like one an
     * operator drags into the admin.
     */
    if (args.withImages && media.provider === 'memory') {
      logger.error(
        'refusing --images: MEDIA_PROVIDER=memory stores uploads in this process only, so ' +
          'every imported product would reference an image that vanishes when it exits. ' +
          'Configure Cloudinary first.',
      );
      process.exitCode = 1;
      return;
    }

    let profile;
    try {
      profile = validateProfile(JSON.parse(readFileSync(args.profile, 'utf8')));
    } catch (error) {
      logger.error(
        error instanceof ProfileError
          ? `the mapping profile is not usable: ${error.message}`
          : `could not read the mapping profile ${args.profile}: ${
              error instanceof Error ? error.message : String(error)
            }`,
      );
      process.exitCode = 1;
      return;
    }

    const extension = extname(args.file).toLowerCase();
    const format = extension === '.json' ? 'json' : 'csv';

    if (extension !== '.json' && extension !== '.csv') {
      logger.warn(`${extension || 'no extension'} — reading ${args.file} as CSV`);
    }

    const content = readFileSync(args.file, 'utf8');

    logger.log(
      `importing ${args.file} with profile "${profile.name}"` +
        `${args.dryRun ? ' (DRY RUN — nothing will be written)' : ''}` +
        `${args.withImages ? ' with images' : ''}` +
        ` against ${config.nodeEnv}`,
    );

    if (args.withImages && !('imagePaths' in profile.fields)) {
      // Asked for images, and the profile has no column to take them from.
      // Silently importing nothing would look like the images failed.
      logger.warn(
        `--images was passed but the profile "${profile.name}" does not map an ` +
          '`imagePaths` column, so no images will be imported.',
      );
    }

    /*
     * The importer is constructed only when it is wanted. That keeps the
     * default path free of any dependency on a media provider being reachable:
     * an import without `--images` never resolves `MediaService` and so cannot
     * fail because of it.
     */
    const images = args.withImages
      ? new ImageImporter(app.get(MediaService), media, args.file)
      : undefined;

    const runner = new ImportRunner(
      {
        products: app.get<Model<Product>>(getModelToken(Product.name)),
        categories: app.get<Model<Category>>(getModelToken(Category.name)),
        brands: app.get<Model<Brand>>(getModelToken(Brand.name)),
      },
      images,
    );

    const report = await runner.run({
      content,
      format,
      profile,
      file: args.file,
      dryRun: args.dryRun,
    });

    // `process.stdout` rather than the logger: the report is the OUTPUT of this
    // command, not a log line about it, and a reader piping it to a file should
    // get the report without timestamps and severities threaded through it.
    process.stdout.write(renderReport(report));

    const counts = countByOutcome(report);

    // A non-zero exit when rows failed, so this is usable in a script without
    // the caller having to parse the report. Skipped rows count: they are rows
    // the operator asked to import that are not in the catalogue.
    if (counts.errored > 0 || counts.skipped > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    logger.error(`import failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
