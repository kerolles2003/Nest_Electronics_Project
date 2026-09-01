import { describe, expect, it } from '@jest/globals';
import {
  findBreakingChanges,
  reachableSchemas,
} from '../../src/openapi/check-openapi-drift';

/**
 * The drift gate's own rules.
 *
 * Authority: docs/api/INTEGRATION.md — the v1 contract is additive-only.
 *
 * ## Why this file exists
 *
 * The gate is the only thing standing between a contract change and every
 * shipped client, and it had no test. It has now been taught a distinction it
 * did not previously make — a newly-required property is fatal in a request
 * body and harmless in a response — which makes it more useful and also gives
 * it a new way to be wrong.
 *
 * So the cases below are weighted towards the direction that costs a release.
 * Every category the gate caught before must still be caught; the exemption
 * must be unreachable from anything a client sends.
 */

/** A minimal but structurally real OpenAPI document. */
function doc(options: {
  request?: string;
  response?: string;
  schemas: Record<string, unknown>;
}): Record<string, unknown> {
  const operation: Record<string, unknown> = {
    responses: {
      '200': {
        content: {
          'application/json': {
            schema:
              options.response === undefined
                ? { type: 'string' }
                : { $ref: `#/components/schemas/${options.response}` },
          },
        },
      },
    },
  };

  if (options.request !== undefined) {
    operation['requestBody'] = {
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${options.request}` },
        },
      },
    };
  }

  return {
    paths: { '/things': { post: operation } },
    components: { schemas: options.schemas },
  };
}

/** `{ properties: {a, b}, required: [...] }` in one line. */
function schema(properties: string[], required: string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(properties.map((name) => [name, { type: 'string' }])),
    required,
  };
}

describe('reachableSchemas', () => {
  it('separates the request side from the response side', () => {
    const document = doc({
      request: 'CreateThingDto',
      response: 'ThingDto',
      schemas: { CreateThingDto: schema(['name']), ThingDto: schema(['id']) },
    });

    expect([...reachableSchemas(document, 'request')]).toEqual(['CreateThingDto']);
    expect([...reachableSchemas(document, 'response')]).toEqual(['ThingDto']);
  });

  it('follows $ref transitively, so a NESTED request DTO is still a request DTO', () => {
    /*
     * The case that makes a shallow implementation dangerous. `AddressDto` is
     * named by nothing in `paths` — only by another schema that a request body
     * uses. A newly-required field on it breaks every client just as hard.
     */
    const document = doc({
      request: 'CreateOrderDto',
      response: 'OrderDto',
      schemas: {
        CreateOrderDto: {
          type: 'object',
          properties: { address: { $ref: '#/components/schemas/AddressDto' } },
        },
        AddressDto: schema(['line1']),
        OrderDto: schema(['id']),
      },
    });

    expect(reachableSchemas(document, 'request').has('AddressDto')).toBe(true);
  });

  it('finds a $ref inside an array, not only inside an object property', () => {
    const document = doc({
      request: 'CreateOrderDto',
      schemas: {
        CreateOrderDto: {
          type: 'object',
          properties: { lines: { type: 'array', items: { $ref: '#/components/schemas/LineDto' } } },
        },
        LineDto: schema(['sku']),
      },
    });

    expect(reachableSchemas(document, 'request').has('LineDto')).toBe(true);
  });

  it('treats a query parameter as the request side', () => {
    const document = {
      paths: {
        '/things': {
          get: {
            parameters: [{ name: 'filter', in: 'query', schema: { $ref: '#/components/schemas/FilterDto' } }],
            responses: {},
          },
        },
      },
      components: { schemas: { FilterDto: schema(['q']) } },
    };

    expect(reachableSchemas(document, 'request').has('FilterDto')).toBe(true);
  });
});

describe('findBreakingChanges — what must still be fatal', () => {
  it('a removed path', () => {
    const before = doc({ response: 'ThingDto', schemas: { ThingDto: schema(['id']) } });
    const after = { paths: {}, components: { schemas: { ThingDto: schema(['id']) } } };

    expect(findBreakingChanges(before, after)).toEqual(['path removed: /things']);
  });

  it('a removed operation', () => {
    const before = doc({ response: 'ThingDto', schemas: { ThingDto: schema(['id']) } });
    const after = { paths: { '/things': { get: {} } }, components: { schemas: { ThingDto: schema(['id']) } } };

    expect(findBreakingChanges(before, after)).toContain('operation removed: POST /things');
  });

  it('a removed schema', () => {
    const before = doc({ response: 'ThingDto', schemas: { ThingDto: schema(['id']) } });
    const after = doc({ response: 'ThingDto', schemas: {} });

    expect(findBreakingChanges(before, after)).toContain('schema removed: ThingDto');
  });

  it('a removed property, even on a response', () => {
    const before = doc({ response: 'ThingDto', schemas: { ThingDto: schema(['id', 'name']) } });
    const after = doc({ response: 'ThingDto', schemas: { ThingDto: schema(['id']) } });

    expect(findBreakingChanges(before, after)).toContain('property removed: ThingDto.name');
  });

  it('a retyped property, even on a response', () => {
    const before = doc({ response: 'ThingDto', schemas: { ThingDto: schema(['id']) } });
    const after = doc({
      response: 'ThingDto',
      schemas: { ThingDto: { type: 'object', properties: { id: { type: 'number' } }, required: [] } },
    });

    expect(findBreakingChanges(before, after)).toContain(
      'property retyped: ThingDto.id was string, now number',
    );
  });

  it('a newly-required property on a REQUEST body', () => {
    const before = doc({
      request: 'CreateThingDto',
      schemas: { CreateThingDto: schema(['name', 'sku'], ['name']) },
    });
    const after = doc({
      request: 'CreateThingDto',
      schemas: { CreateThingDto: schema(['name', 'sku'], ['name', 'sku']) },
    });

    expect(findBreakingChanges(before, after)).toEqual([
      'property newly required: CreateThingDto.sku (used in a request)',
    ]);
  });

  it('a newly-required property on a NESTED request DTO', () => {
    const schemas = (required: string[]) => ({
      CreateOrderDto: {
        type: 'object',
        properties: { address: { $ref: '#/components/schemas/AddressDto' } },
      },
      AddressDto: schema(['line1', 'postcode'], required),
    });

    const breaking = findBreakingChanges(
      doc({ request: 'CreateOrderDto', schemas: schemas(['line1']) }),
      doc({ request: 'CreateOrderDto', schemas: schemas(['line1', 'postcode']) }),
    );

    expect(breaking).toEqual(['property newly required: AddressDto.postcode (used in a request)']);
  });

  it('a newly-required property on a schema used in BOTH directions', () => {
    /*
     * The exemption is not "appears in a response"; it is "appears in a
     * response and nowhere else". A DTO round-tripped through both halves of an
     * operation is a request DTO for this purpose, because that is the reading
     * under which a client breaks.
     */
    const document = (required: string[]) => ({
      paths: {
        '/things': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ThingDto' } } },
            },
            responses: {
              '200': {
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/ThingDto' } },
                },
              },
            },
          },
        },
      },
      components: { schemas: { ThingDto: schema(['id', 'note'], required) } },
    });

    expect(findBreakingChanges(document([]), document(['note']))).toEqual([
      'property newly required: ThingDto.note (used in a request)',
    ]);
  });

  it('a newly-required property on a schema NOTHING references', () => {
    /*
     * "I cannot tell" resolves to fatal. An orphan schema may be reached by a
     * composition keyword this walk does not model, or by a client generated
     * from the whole components block; either way the gate must not vouch for
     * it.
     */
    const orphan = (required: string[]) => ({
      paths: {},
      components: { schemas: { OrphanDto: schema(['a', 'b'], required) } },
    });

    expect(findBreakingChanges(orphan(['a']), orphan(['a', 'b']))).toEqual([
      'property newly required: OrphanDto.b (not reachable from any response)',
    ]);
  });
});

describe('findBreakingChanges — the response-only exemption', () => {
  it('allows a newly-required property on a response-only schema', () => {
    /*
     * The change that prompted this: readiness grew a `checks.indexes` field it
     * always sends. A client cannot be broken by receiving a field it does not
     * read, and reporting this as breaking taught people to regenerate the
     * artifact past the gate — which is how a real break eventually gets
     * through.
     */
    const before = doc({ response: 'ReadinessChecksDto', schemas: { ReadinessChecksDto: schema(['mongo'], ['mongo']) } });
    const after = doc({
      response: 'ReadinessChecksDto',
      schemas: { ReadinessChecksDto: schema(['mongo', 'indexes'], ['mongo', 'indexes']) },
    });

    expect(findBreakingChanges(before, after)).toEqual([]);
  });

  it('still reports a REMOVED property on that same response-only schema', () => {
    // The exemption is narrow: it covers one category, not the schema.
    const before = doc({
      response: 'ReadinessChecksDto',
      schemas: { ReadinessChecksDto: schema(['mongo', 'indexes'], ['mongo']) },
    });
    const after = doc({
      response: 'ReadinessChecksDto',
      schemas: { ReadinessChecksDto: schema(['mongo'], ['mongo']) },
    });

    expect(findBreakingChanges(before, after)).toContain('property removed: ReadinessChecksDto.indexes');
  });

  it('allows a newly-required property on a NESTED response-only schema', () => {
    const schemas = (required: string[]) => ({
      ReadinessResponseDto: {
        type: 'object',
        properties: { checks: { $ref: '#/components/schemas/ReadinessChecksDto' } },
      },
      ReadinessChecksDto: schema(['mongo', 'indexes'], required),
    });

    expect(
      findBreakingChanges(
        doc({ response: 'ReadinessResponseDto', schemas: schemas(['mongo']) }),
        doc({ response: 'ReadinessResponseDto', schemas: schemas(['mongo', 'indexes']) }),
      ),
    ).toEqual([]);
  });
});
