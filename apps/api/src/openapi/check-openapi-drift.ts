import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';
import { buildOpenApiDocumentConfig } from './openapi.document';

/**
 * The contract drift gate.
 *
 * Authority: PLAN.md Phase 3 — "CI job diffing generated vs frozen (breaking =
 * fail, additive = update artifact in the same PR)".
 *
 * ## What it protects
 *
 * A mobile client is written against `docs/api/openapi.v1.json`. Once that file
 * is frozen, an endpoint that quietly changes shape is a broken app in a store
 * somewhere, discovered by users. This job makes that change impossible to land
 * unnoticed: the document is regenerated from the live decorators and compared
 * to the committed artifact.
 *
 * ## Any difference fails the build, deliberately
 *
 * Even a purely additive change fails, because an artifact that lags behind the
 * API is not a contract — it is a stale file people trust. The remedy is one
 * command and the artifact lands in the same pull request as the change that
 * caused it, where a reviewer sees both.
 *
 * The two outcomes are reported differently because the required human response
 * differs: an additive drift is "commit the regenerated file", a breaking drift
 * is "you are about to break every shipped client, stop".
 *
 * ## What counts as BREAKING
 *
 * Anything a client could already depend on that has disappeared or changed
 * meaning: a removed path, a removed operation, a removed schema, a removed
 * property, a retyped property, or a property that has newly become required.
 *
 * The last is conservative. Newly-required is harmless in a response and fatal
 * in a request body, and this gate does not try to tell which it is looking at.
 * Over-reporting a breaking change costs a conversation; under-reporting one
 * costs a release.
 */

const FROZEN = resolve(__dirname, '../../../../docs/api/openapi.v1.json');

/** Must match `export-openapi.ts`, or every run would report false drift. */
const LOCAL_SERVER_PORT = 3002;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

/** Every breaking difference found, each as a sentence a human can act on. */
function findBreakingChanges(frozen: Json, generated: Json): string[] {
  const breaking: string[] = [];

  const frozenPaths = isObject(frozen['paths']) ? frozen['paths'] : {};
  const generatedPaths = isObject(generated['paths']) ? generated['paths'] : {};

  for (const [path, frozenItem] of Object.entries(frozenPaths)) {
    const generatedItem = generatedPaths[path];

    if (generatedItem === undefined) {
      breaking.push(`path removed: ${path}`);
      continue;
    }

    if (!isObject(frozenItem) || !isObject(generatedItem)) continue;

    for (const method of HTTP_METHODS) {
      if (frozenItem[method] !== undefined && generatedItem[method] === undefined) {
        breaking.push(`operation removed: ${method.toUpperCase()} ${path}`);
      }
    }
  }

  const frozenComponents = isObject(frozen['components']) ? frozen['components'] : {};
  const generatedComponents = isObject(generated['components']) ? generated['components'] : {};

  const frozenSchemas = isObject(frozenComponents['schemas']) ? frozenComponents['schemas'] : {};
  const generatedSchemas = isObject(generatedComponents['schemas'])
    ? generatedComponents['schemas']
    : {};

  for (const [name, frozenSchema] of Object.entries(frozenSchemas)) {
    const generatedSchema = generatedSchemas[name];

    if (generatedSchema === undefined) {
      breaking.push(`schema removed: ${name}`);
      continue;
    }

    if (!isObject(frozenSchema) || !isObject(generatedSchema)) continue;

    const frozenProps = isObject(frozenSchema['properties']) ? frozenSchema['properties'] : {};
    const generatedProps = isObject(generatedSchema['properties'])
      ? generatedSchema['properties']
      : {};

    for (const [prop, frozenProp] of Object.entries(frozenProps)) {
      const generatedProp = generatedProps[prop];

      if (generatedProp === undefined) {
        breaking.push(`property removed: ${name}.${prop}`);
        continue;
      }

      if (isObject(frozenProp) && isObject(generatedProp)) {
        const before = frozenProp['type'] ?? frozenProp['$ref'];
        const after = generatedProp['type'] ?? generatedProp['$ref'];

        if (before !== undefined && before !== after) {
          breaking.push(
            `property retyped: ${name}.${prop} was ${String(before)}, now ${String(after)}`,
          );
        }
      }
    }

    const frozenRequired = new Set(
      Array.isArray(frozenSchema['required']) ? (frozenSchema['required'] as string[]) : [],
    );
    const generatedRequired = Array.isArray(generatedSchema['required'])
      ? (generatedSchema['required'] as string[])
      : [];

    for (const prop of generatedRequired) {
      if (!frozenRequired.has(prop)) {
        breaking.push(`property newly required: ${name}.${prop}`);
      }
    }
  }

  return breaking;
}

async function main(): Promise<void> {
  let frozenRaw: string;

  try {
    frozenRaw = readFileSync(FROZEN, 'utf8');
  } catch {
    process.stderr.write(
      `drift gate: no frozen artifact at ${FROZEN}\n` +
        'Generate it with: pnpm --filter api openapi:export\n',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.create(AppModule, { logger: false });

  // Must match main.ts, or every path would be missing its /api/v1 and the
  // gate would report a total rewrite of the contract on every run.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  await app.init();

  const generated = SwaggerModule.createDocument(
    app,
    buildOpenApiDocumentConfig(LOCAL_SERVER_PORT),
  ) as unknown as Json;

  await app.close();

  const generatedRaw = `${JSON.stringify(generated, null, 2)}\n`;

  if (generatedRaw === frozenRaw) {
    process.stdout.write('drift gate: OK, the API matches docs/api/openapi.v1.json\n');
    return;
  }

  const frozen = JSON.parse(frozenRaw) as Json;
  const breaking = findBreakingChanges(frozen, generated);

  if (breaking.length > 0) {
    const list = breaking.map((line) => `  - ${line}`).join('\n');

    process.stderr.write(
      'drift gate: BREAKING CHANGE. This removes or changes something clients already use.\n\n' +
        `${list}\n\n` +
        'The v1 contract is additive-only. Add a new optional field or a new endpoint\n' +
        'instead, or version the API. Do NOT regenerate the artifact to make this pass:\n' +
        'that hides the break rather than fixing it.\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stderr.write(
    'drift gate: the API changed additively, but docs/api/openapi.v1.json is stale.\n\n' +
      '  Run:  pnpm --filter api openapi:export\n' +
      '  Then: commit the regenerated artifact in THIS pull request.\n\n' +
      'No breaking change was detected: nothing was removed, retyped or newly required.\n',
  );
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`drift gate failed to run: ${String(error)}\n`);
  process.exitCode = 1;
});
