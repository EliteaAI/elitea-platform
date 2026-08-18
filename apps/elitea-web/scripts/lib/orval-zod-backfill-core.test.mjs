import { describe, expect, it } from 'vitest';

import {
  computeParamsCandidates,
  computeResponseAliasCandidates,
  pascalCase,
  patchEmptyUrlParamForEach,
  planBackfill,
  renderParamsFile,
  renderResponseAliasFile,
  sanitizeComponentKey,
  schemaToZodExpr,
  toFileBase,
} from './orval-zod-backfill-core.mjs';

/** Table-driven coverage of every decision this module makes (unit S4: same
 * 100%-of-decision-logic floor F2's scripts/lib/*-core.mjs modules carry). */

describe('sanitizeComponentKey', () => {
  it.each([
    ['400', 'N400'],
    ['500', 'N500'],
    ['ErrorResponse', 'ErrorResponse'],
    ['a400', 'a400'],
  ])('sanitizeComponentKey(%s) -> %s', (input, expected) => {
    expect(sanitizeComponentKey(input)).toBe(expected);
  });
});

describe('pascalCase', () => {
  it.each([
    ['roleList', 'RoleList'],
    ['listApplications', 'ListApplications'],
    ['', ''],
  ])('pascalCase(%s) -> %s', (input, expected) => {
    expect(pascalCase(input)).toBe(expected);
  });

  it('passes non-string input through unchanged', () => {
    expect(pascalCase(undefined)).toBeUndefined();
  });
});

describe('toFileBase', () => {
  it.each([
    ['ErrorResponse', 'errorResponse'],
    ['N400Response', 'n400Response'],
    ['', ''],
  ])('toFileBase(%s) -> %s', (input, expected) => {
    expect(toFileBase(input)).toBe(expected);
  });

  it('passes non-string input through unchanged', () => {
    expect(toFileBase(null)).toBeNull();
  });
});

describe('schemaToZodExpr', () => {
  it.each([
    [{ type: 'integer' }, 'zod.number().int()'],
    [{ type: 'integer', minimum: 1 }, 'zod.number().int().min(1)'],
    [{ type: 'integer', minimum: 1, maximum: 1000 }, 'zod.number().int().min(1).max(1000)'],
    [{ type: 'number', minimum: 0.5 }, 'zod.number().min(0.5)'],
    [{ type: 'number' }, 'zod.number()'],
    [{ type: 'boolean' }, 'zod.boolean()'],
    [{ type: 'string' }, 'zod.string()'],
    [{ type: 'string', format: 'date' }, 'zod.string()'], // deliberately unconstrained, see module doc
    [{ type: 'string', enum: ['asc', 'desc'] }, 'zod.enum(["asc","desc"])'],
  ])('schemaToZodExpr(%j) -> %s', (schema, expected) => {
    const { expr, warning } = schemaToZodExpr(schema, 'field');
    expect(expr).toBe(expected);
    expect(warning).toBeUndefined();
  });

  it('falls back to zod.unknown() with a warning for a missing schema', () => {
    const { expr, warning } = schemaToZodExpr(undefined, 'X.y');
    expect(expr).toBe('zod.unknown()');
    expect(warning).toMatch(/^X\.y: no schema/);
  });

  it('falls back to zod.unknown() with a warning for a null schema', () => {
    const { expr, warning } = schemaToZodExpr(null, 'X.y');
    expect(expr).toBe('zod.unknown()');
    expect(warning).toMatch(/^X\.y: no schema/);
  });

  it('falls back to zod.unknown() with a warning for an unsupported type (array)', () => {
    const { expr, warning } = schemaToZodExpr({ type: 'array', items: { type: 'string' } }, 'X.tags');
    expect(expr).toBe('zod.unknown()');
    expect(warning).toMatch(/^X\.tags: unsupported schema shape/);
  });

  it('falls back to zod.unknown() with a warning when type is absent entirely', () => {
    const { expr, warning } = schemaToZodExpr({}, 'X.mystery');
    expect(expr).toBe('zod.unknown()');
    expect(warning).toMatch(/unsupported schema shape/);
  });
});

describe('computeResponseAliasCandidates', () => {
  it('extracts every components.responses entry with its $ref target', () => {
    const doc = {
      components: {
        responses: {
          400: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          401: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    };
    expect(computeResponseAliasCandidates(doc)).toEqual([
      { name: 'N400Response', target: 'ErrorResponse', sourceKey: '400' },
      { name: 'N401Response', target: 'ErrorResponse', sourceKey: '401' },
    ]);
  });

  it('a non-$ref (inline) response schema has a null target', () => {
    const doc = {
      components: {
        responses: {
          422: { content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
    };
    expect(computeResponseAliasCandidates(doc)).toEqual([{ name: 'N422Response', target: null, sourceKey: '422' }]);
  });

  it('a response with no application/json content has a null target', () => {
    const doc = { components: { responses: { 302: { headers: {} } } } };
    expect(computeResponseAliasCandidates(doc)).toEqual([{ name: 'N302Response', target: null, sourceKey: '302' }]);
  });

  it('returns [] when the spec has no components.responses at all', () => {
    expect(computeResponseAliasCandidates({})).toEqual([]);
    expect(computeResponseAliasCandidates({ components: {} })).toEqual([]);
  });

  it('a $ref response schema pointing outside #/components/schemas/ has a null target (regex miss)', () => {
    const doc = {
      components: {
        responses: {
          303: { content: { 'application/json': { schema: { $ref: '#/components/responses/Other' } } } },
        },
      },
    };
    expect(computeResponseAliasCandidates(doc)).toEqual([{ name: 'N303Response', target: null, sourceKey: '303' }]);
  });
});

describe('computeParamsCandidates', () => {
  const componentParameters = {
    Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000 } },
    ProjectId: { name: 'project_id', in: 'path', schema: { type: 'string' } },
  };

  it('combines $ref query params (skipping $ref path params) into one candidate', () => {
    const doc = {
      components: { parameters: componentParameters },
      paths: {
        '/roles/{project_id}': {
          get: {
            operationId: 'roleList',
            parameters: [{ $ref: '#/components/parameters/ProjectId' }, { $ref: '#/components/parameters/Limit' }],
          },
        },
      },
    };
    expect(computeParamsCandidates(doc)).toEqual([
      {
        name: 'RoleListParams',
        operationId: 'roleList',
        fields: [{ propName: 'limit', schema: { type: 'integer', minimum: 1, maximum: 1000 } }],
      },
    ]);
  });

  it('skips a dangling $ref parameter (no matching components.parameters entry)', () => {
    const doc = {
      components: { parameters: {} },
      paths: {
        '/x': { get: { operationId: 'opX', parameters: [{ $ref: '#/components/parameters/Missing' }] } },
      },
    };
    expect(computeParamsCandidates(doc)).toEqual([]);
  });

  it('combines path-item-level and operation-level parameters', () => {
    const doc = {
      components: { parameters: {} },
      paths: {
        '/x': {
          parameters: [{ name: 'a', in: 'query', schema: { type: 'string' } }],
          get: { operationId: 'opX', parameters: [{ name: 'b', in: 'query', schema: { type: 'string' } }] },
        },
      },
    };
    expect(computeParamsCandidates(doc)[0]?.fields.map((f) => f.propName)).toEqual(['a', 'b']);
  });

  it('an inline path param is excluded, an inline query param is kept', () => {
    const doc = {
      components: { parameters: {} },
      paths: {
        '/x/{id}': {
          get: {
            operationId: 'opX',
            parameters: [
              { name: 'id', in: 'path', schema: { type: 'string' } },
              { name: 'v', in: 'query', schema: { type: 'string' } },
            ],
          },
        },
      },
    };
    expect(computeParamsCandidates(doc)).toEqual([
      { name: 'OpXParams', operationId: 'opX', fields: [{ propName: 'v', schema: { type: 'string' } }] },
    ]);
  });

  it('an operation with zero non-path parameters produces no candidate at all', () => {
    const doc = {
      components: { parameters: {} },
      paths: { '/x/{id}': { get: { operationId: 'opX', parameters: [{ name: 'id', in: 'path', schema: {} }] } } },
    };
    expect(computeParamsCandidates(doc)).toEqual([]);
  });

  // A header parameter belongs to orval's own `<Op>Headers` type. Repeating it
  // in `Params` writes a duplicate file, and a hyphenated header name makes
  // that file a TypeScript parse error (the `X-SECRET` case, spec issue 336).
  it('a header parameter is excluded, so a header-only operation produces no candidate', () => {
    const doc = {
      components: { parameters: {} },
      paths: {
        '/apps/{id}': {
          patch: {
            operationId: 'getApplicationVersionDetailExpanded',
            parameters: [
              { name: 'id', in: 'path', schema: { type: 'string' } },
              { name: 'X-SECRET', in: 'header', required: true, schema: { type: 'string' } },
            ],
          },
        },
      },
    };
    expect(computeParamsCandidates(doc)).toEqual([]);
  });

  it('a cookie parameter is excluded too, and a query param alongside one is kept', () => {
    const doc = {
      components: { parameters: {} },
      paths: {
        '/x': {
          get: {
            operationId: 'opX',
            parameters: [
              { name: 'elitea_session', in: 'cookie', schema: { type: 'string' } },
              { name: 'v', in: 'query', schema: { type: 'string' } },
            ],
          },
        },
      },
    };
    expect(computeParamsCandidates(doc)).toEqual([
      { name: 'OpXParams', operationId: 'opX', fields: [{ propName: 'v', schema: { type: 'string' } }] },
    ]);
  });

  it('excludes a $ref header parameter as well as an inline one', () => {
    const doc = {
      components: {
        parameters: { Secret: { name: 'X-SECRET', in: 'header', schema: { type: 'string' } } },
      },
      paths: {
        '/x': { get: { operationId: 'opX', parameters: [{ $ref: '#/components/parameters/Secret' }] } },
      },
    };
    expect(computeParamsCandidates(doc)).toEqual([]);
  });

  it('an operation with no operationId is ignored', () => {
    const doc = { paths: { '/x': { get: { parameters: [{ name: 'v', in: 'query', schema: {} }] } } } };
    expect(computeParamsCandidates(doc)).toEqual([]);
  });

  it('a path item with no matching HTTP method verbs is ignored', () => {
    const doc = { paths: { '/x': { summary: 'not an operation' } } };
    expect(computeParamsCandidates(doc)).toEqual([]);
  });

  it('handles multiple methods on the same path independently', () => {
    const doc = {
      components: { parameters: {} },
      paths: {
        '/x': {
          get: { operationId: 'opGet', parameters: [{ name: 'a', in: 'query', schema: {} }] },
          post: { operationId: 'opPost', parameters: [{ name: 'b', in: 'query', schema: {} }] },
        },
      },
    };
    expect(computeParamsCandidates(doc).map((c) => c.name)).toEqual(['OpGetParams', 'OpPostParams']);
  });

  it('returns [] for a spec with no paths', () => {
    expect(computeParamsCandidates({})).toEqual([]);
  });

  it('falls back to [] for an operation object with no `parameters` key at all', () => {
    const doc = {
      components: { parameters: {} },
      paths: {
        '/x': {
          parameters: [{ name: 'a', in: 'query', schema: { type: 'string' } }],
          get: { operationId: 'opX' }, // no `parameters` key on the operation itself
        },
      },
    };
    expect(computeParamsCandidates(doc)).toEqual([
      { name: 'OpXParams', operationId: 'opX', fields: [{ propName: 'a', schema: { type: 'string' } }] },
    ]);
  });

  it('a $ref parameter pointing outside #/components/parameters/ resolves to undefined (regex miss) and is dropped', () => {
    const doc = {
      components: { parameters: {} },
      paths: {
        '/x': {
          get: { operationId: 'opX', parameters: [{ $ref: '#/components/schemas/NotAParam' }] },
        },
      },
    };
    expect(computeParamsCandidates(doc)).toEqual([]);
  });

  it('skips a falsy entry mixed into a parameters array without crashing', () => {
    const doc = {
      components: { parameters: {} },
      paths: {
        '/x': {
          get: { operationId: 'opX', parameters: [null, { name: 'v', in: 'query', schema: { type: 'string' } }] },
        },
      },
    };
    expect(computeParamsCandidates(doc)).toEqual([
      { name: 'OpXParams', operationId: 'opX', fields: [{ propName: 'v', schema: { type: 'string' } }] },
    ]);
  });

  it('ignores a non-object path item value (e.g. null) instead of throwing', () => {
    const doc = { components: { parameters: {} }, paths: { '/weird': null } };
    expect(computeParamsCandidates(doc)).toEqual([]);
  });
});

describe('renderResponseAliasFile', () => {
  it('renders a re-export alias importing the target zod schema by file-based path', () => {
    const content = renderResponseAliasFile({ name: 'N400Response', target: 'ErrorResponse' });
    expect(content).toContain("import { ErrorResponse } from './errorResponse.zod';");
    expect(content).toContain('export const N400Response = ErrorResponse;');
    expect(content).toContain('export type N400Response = zod.input<typeof N400Response>;');
    expect(content).toContain('export type N400ResponseOutput = zod.output<typeof N400Response>;');
  });
});

describe('renderParamsFile', () => {
  it('renders one optional zod field per param, in field order', () => {
    const { content, warnings } = renderParamsFile({
      name: 'RoleListParams',
      fields: [
        { propName: 'limit', schema: { type: 'integer', minimum: 1, maximum: 1000 } },
        { propName: 'offset', schema: { type: 'integer', minimum: 0 } },
      ],
    });
    expect(warnings).toEqual([]);
    expect(content).toContain('export const RoleListParams = zod.object({');
    expect(content).toContain('limit: zod.number().int().min(1).max(1000).optional(),');
    expect(content).toContain('offset: zod.number().int().min(0).optional(),');
    expect(content).toContain('export type RoleListParams = zod.input<typeof RoleListParams>;');
  });

  // OpenAPI parameter names are free-form, so a bare object key is only safe
  // when the name is a valid JS identifier. An unquoted `X-SECRET:` key is a
  // TypeScript parse error, not a lint nit.
  it('quotes a property name that is not a valid JS identifier', () => {
    const { content } = renderParamsFile({
      name: 'WeirdParams',
      fields: [
        { propName: 'X-Trace-Id', schema: { type: 'string' } },
        { propName: 'filter[name]', schema: { type: 'string' } },
        { propName: '2fa', schema: { type: 'boolean' } },
      ],
    });
    expect(content).toContain('"X-Trace-Id": zod.string().optional(),');
    expect(content).toContain('"filter[name]": zod.string().optional(),');
    expect(content).toContain('"2fa": zod.boolean().optional(),');
  });

  it('leaves a valid identifier property name unquoted', () => {
    const { content } = renderParamsFile({
      name: 'PlainParams',
      fields: [
        { propName: 'limit', schema: { type: 'integer' } },
        { propName: '_private', schema: { type: 'string' } },
        { propName: '$dollar', schema: { type: 'string' } },
        { propName: 'sort_by2', schema: { type: 'string' } },
      ],
    });
    expect(content).toContain('  limit: zod.number().int().optional(),');
    expect(content).toContain('  _private: zod.string().optional(),');
    expect(content).toContain('  $dollar: zod.string().optional(),');
    expect(content).toContain('  sort_by2: zod.string().optional(),');
    expect(content).not.toContain('"limit"');
  });

  it('surfaces per-field warnings without failing the render', () => {
    const { content, warnings } = renderParamsFile({
      name: 'WeirdParams',
      fields: [{ propName: 'blob', schema: { type: 'array' } }],
    });
    expect(content).toContain('blob: zod.unknown().optional(),');
    expect(warnings).toEqual(['WeirdParams.blob: unsupported schema shape {"type":"array"} — falling back to zod.unknown()']);
  });
});

describe('patchEmptyUrlParamForEach', () => {
  it('replaces the broken empty-body forEach with the standard serialisation body', () => {
    const source = [
      'export const getGetBrandingBootstrapUrl = (params) => {',
      '  const normalizedParams = new URLSearchParams();',
      '',
      '  Object.entries(params || {}).forEach(([key, value]) => {});',
      '',
      '  return normalizedParams.toString();',
      '};',
    ].join('\n');
    const { text, count } = patchEmptyUrlParamForEach(source);
    expect(count).toBe(1);
    expect(text).toContain("normalizedParams.append(key, value === null ? 'null' : String(value));");
    expect(text).not.toContain('forEach(([key, value]) => {});');
  });

  it('is a no-op (count 0, text unchanged) when the broken pattern is absent', () => {
    const source = 'export const getListApplicationsUrl = () => "/x";';
    const { text, count } = patchEmptyUrlParamForEach(source);
    expect(count).toBe(0);
    expect(text).toBe(source);
  });

  it('patches every occurrence when the broken pattern appears more than once', () => {
    const one = 'Object.entries(params || {}).forEach(([key, value]) => {});';
    const source = `${one}\n---\n${one}`;
    const { count } = patchEmptyUrlParamForEach(source);
    expect(count).toBe(2);
  });
});

describe('planBackfill', () => {
  const doc = {
    components: {
      responses: {
        400: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        422: { content: { 'application/json': { schema: { type: 'object' } } } }, // inline -> no target
      },
      parameters: {
        Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1 } },
      },
    },
    paths: {
      '/roles': {
        get: { operationId: 'roleList', parameters: [{ $ref: '#/components/parameters/Limit' }] },
      },
    },
  };

  it('backfills a response alias whose target model file already exists', () => {
    const existing = new Set(['errorResponse']);
    const { files, skipped } = planBackfill(doc, existing);
    const alias = files.find((f) => f.name === 'N400Response');
    expect(alias).toBeDefined();
    expect(alias?.fileBase).toBe('n400Response');
    expect(skipped.some((s) => s.name === 'N422Response')).toBe(true); // inline, no target -> skipped
  });

  it('skips a response alias whose target has no model file either', () => {
    const existing = new Set(); // errorResponse NOT present
    const { files, skipped } = planBackfill(doc, existing);
    expect(files.find((f) => f.name === 'N400Response')).toBeUndefined();
    expect(skipped).toContainEqual({ name: 'N400Response', reason: 'alias target "ErrorResponse" has no model file either' });
  });

  it('does not re-backfill a response alias orval already wrote', () => {
    const existing = new Set(['errorResponse', 'n400Response']);
    const { files } = planBackfill(doc, existing);
    expect(files.find((f) => f.name === 'N400Response')).toBeUndefined();
  });

  it('backfills a missing Params combiner and does not re-backfill an existing one', () => {
    const missing = planBackfill(doc, new Set(['errorResponse', 'n400Response']));
    expect(missing.files.find((f) => f.name === 'RoleListParams')).toBeDefined();

    const present = planBackfill(doc, new Set(['errorResponse', 'n400Response', 'roleListParams']));
    expect(present.files.find((f) => f.name === 'RoleListParams')).toBeUndefined();
  });

  it('collects field-render warnings from Params candidates into the top-level warnings array', () => {
    const weirdDoc = {
      components: { parameters: {} },
      paths: {
        '/x': { get: { operationId: 'opX', parameters: [{ name: 'blob', in: 'query', schema: { type: 'array' } }] } },
      },
    };
    const { warnings } = planBackfill(weirdDoc, new Set());
    expect(warnings).toEqual(['OpXParams.blob: unsupported schema shape {"type":"array"} — falling back to zod.unknown()']);
  });
});
