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
 * The last depends on WHERE the schema is used, and the gate works that out
 * rather than assuming the worst everywhere.
 *
 *   in a REQUEST body   fatal      every shipped client now sends an invalid
 *                                  payload, because it does not know the field
 *   in a RESPONSE       additive   clients receive one more field, which the
 *                                  ones already shipped ignore
 *
 * Classification is by reachability through `$ref`, transitively: a request
 * body naming one DTO drags in every nested DTO with it, and a newly-required
 * field on a nested one breaks exactly as hard as on the outer one.
 *
 * A schema is exempt ONLY if it is reachable from a response and not from a
 * request. Reached by both is fatal, and so is reached by NEITHER — an
 * unreferenced schema is one this analysis does not understand, and the safe
 * reading of "I cannot tell" is the fatal one. Over-reporting a breaking change
 * costs a conversation; under-reporting one costs a release, and that asymmetry
 * is deliberately unchanged. What has gone is only the over-report the document
 * itself carries enough information to avoid.
 */

const FROZEN = resolve(__dirname, '../../../../docs/api/openapi.v1.json');

/** Must match `export-openapi.ts`, or every run would report false drift. */
const LOCAL_SERVER_PORT = 3002;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

const SCHEMA_REF_PREFIX = '#/components/schemas/';

/** Which half of an operation a schema was reached from. */
type Side = 'request' | 'response';

/** Every `#/components/schemas/X` name mentioned anywhere inside `node`. */
function refsIn(node: unknown, found: Set<string>): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) refsIn(item, found);
    return found;
  }

  if (!isObject(node)) return found;

  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith(SCHEMA_REF_PREFIX)) {
      found.add(value.slice(SCHEMA_REF_PREFIX.length));
      continue;
    }

    refsIn(value, found);
  }

  return found;
}

/**
 * The schema names reachable from one side of every operation in the document.
 *
 * `request` seeds from `requestBody` and `parameters` — the two places a
 * client's own payload is described. `response` seeds from `responses`. Both
 * then close transitively over the schema graph, because a nested DTO is as
 * much part of the contract as the one that names it.
 */
export function reachableSchemas(document: Json, side: Side): Set<string> {
  const components = isObject(document['components']) ? document['components'] : {};
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  const paths = isObject(document['paths']) ? document['paths'] : {};

  const seeds = new Set<string>();

  for (const item of Object.values(paths)) {
    if (!isObject(item)) continue;

    if (side === 'request') refsIn(item['parameters'], seeds);

    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!isObject(operation)) continue;

      if (side === 'request') {
        refsIn(operation['requestBody'], seeds);
        refsIn(operation['parameters'], seeds);
      } else {
        refsIn(operation['responses'], seeds);
      }
    }
  }

  const reachable = new Set<string>();
  const queue = [...seeds];

  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || reachable.has(name)) continue;
    reachable.add(name);

    for (const nested of refsIn(schemas[name], new Set<string>())) {
      if (!reachable.has(nested)) queue.push(nested);
    }
  }

  return reachable;
}

/**
 * Every breaking difference found, each as a sentence a human can act on.
 *
 * Exported for `check-openapi-drift.spec.ts`. The rule this encodes is the only
 * thing standing between a contract change and every shipped client, so it is
 * tested in both directions — that it still fails what it always failed, and
 * that the response-only exemption cannot be reached from a request.
 */
export function findBreakingChanges(frozen: Json, generated: Json): string[] {
  const breaking: string[] = [];

  /*
   * Classified from the GENERATED document, not the frozen one. A schema that
   * moves INTO a request body as part of this very change must be judged by
   * where it is used now — reading the old document would classify it as
   * response-only and wave the break straight through.
   */
  const requestSide = reachableSchemas(generated, 'request');
  const responseSide = reachableSchemas(generated, 'response');

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
      if (frozenRequired.has(prop)) continue;

      // Exempt only when the document PROVES the schema is response-only. A
      // client cannot be broken by being sent a field it does not read. Used in
      // a request, used in both, or referenced by nothing at all: all fatal.
      if (responseSide.has(name) && !requestSide.has(name)) continue;

      const where = requestSide.has(name) ? 'used in a request' : 'not reachable from any response';
      breaking.push(`property newly required: ${name}.${prop} (${where})`);
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

/*
 * Only when RUN, never when imported. The spec imports this module for
 * `findBreakingChanges`, and without this guard that import would execute the
 * whole gate — reading the artifact, hitting the filesystem, and setting
 * `process.exitCode = 1` on a test run that had passed.
 */
if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`drift gate failed to run: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
