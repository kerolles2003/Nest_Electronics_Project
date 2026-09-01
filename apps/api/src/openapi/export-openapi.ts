import 'reflect-metadata';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';
import { buildOpenApiDocumentConfig } from './openapi.document';

/**
 * Writes the frozen OpenAPI v1 artifact.
 *
 * Authority: PLAN.md Phase 3; docs/architecture/API-CONTRACT.md §8.
 *
 * ## What this is for
 *
 * The mobile developer integrates against a document, not against a running
 * server they cannot see. `docs/api/openapi.v1.json` is that document, checked
 * into git so a change to the contract appears in a diff and has to be
 * approved by a person, rather than arriving in production unannounced.
 *
 * ## Why it builds the real application
 *
 * The document is generated from the same decorators that perform runtime
 * validation, so it cannot describe an endpoint the API does not have. That
 * guarantee only holds if the whole module graph is constructed — which means
 * this script needs the same environment the API needs, including a reachable
 * MongoDB. That is a feature: an artifact generated from a half-booted
 * application would be a fiction.
 *
 * The app is created but NEVER listens. Nothing binds a port and no request is
 * served.
 *
 * ## Determinism
 *
 * The port in the `servers` block is pinned to `LOCAL_SERVER_PORT` rather than
 * read from configuration. Otherwise a developer with `PORT=3005` would
 * regenerate an artifact that differs from CI's in one irrelevant line, and the
 * drift gate would report a contract change where none happened.
 */

/** Pinned so the artifact does not depend on the generating machine's PORT. */
const LOCAL_SERVER_PORT = 3002;

const OUTPUT = resolve(__dirname, '../../../../docs/api/openapi.v1.json');

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });

  // The prefix and versioning MUST match main.ts, or every path in the
  // artifact would be missing its `/api/v1`.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  await app.init();

  const document = SwaggerModule.createDocument(app, buildOpenApiDocumentConfig(LOCAL_SERVER_PORT));

  mkdirSync(dirname(OUTPUT), { recursive: true });

  // Two spaces and a trailing newline: the artifact is reviewed as a DIFF, and
  // a single-line JSON blob makes an additive change indistinguishable from a
  // breaking one at a glance.
  writeFileSync(OUTPUT, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  await app.close();

  process.stdout.write(`openapi: wrote ${OUTPUT}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`openapi export failed: ${String(error)}\n`);
  process.exitCode = 1;
});
