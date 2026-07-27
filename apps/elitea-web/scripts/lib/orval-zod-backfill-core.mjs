/**
 * orval-zod-backfill-core.mjs — pure decision logic for the orval zod-model
 * backfill (unit S4). No fs/network access here (see orval-zod-backfill.mjs
 * for the I/O wrapper that calls this and is wired into `orval.config.ts`'s
 * `hooks.afterAllFilesWrite`).
 *
 * WHY THIS EXISTS (verified empirically, not guessed — see the S4 report and
 * orval.config.ts's own header for the isolated A/B diff that proved it):
 * `output.schemas: { type: 'zod' }` converts every named
 * `#/components/schemas/*` into a zod schema, and
 * `override.zod.generate.{param,query,header,body,response}` (all `true` in
 * this repo's `orval.config.ts`) ADDITIONALLY makes most per-operation
 * derived types (query-param combiners, request bodies) generate as zod
 * too — it is a real, load-bearing 24-file difference (152 vs 128 files),
 * not the inert flag an earlier version of this comment wrongly claimed.
 * Even with both of those on, two DERIVED shapes still dangle:
 *
 *  1. Named `#/components/responses/*` entries (e.g. the spec's shared
 *     400/401/403/404/409/500 error responses) — orval sanitises a
 *     numeric-leading key with an `N` prefix (`400` -> `N400Response`) and
 *     the operation files import that name, but no `model/n400Response.zod.ts`
 *     gets written.
 *  2. A handful of per-operation query-parameter combiner types
 *     (`<PascalOperationId>Params`) — specifically the ones combining
 *     parameters shared/`$ref`'d ACROSS MULTIPLE operations
 *     (`#/components/parameters/{Limit,Offset,DateFrom,DateTo,Search,
 *     SortBy,SortOrder}`), plus one (`GetBrandingBootstrapParams`) whose
 *     root cause traces to its operation's non-JSON response rather than
 *     its param shape. Purely-inline, single-operation combiners (e.g.
 *     `ListApplicationsParams`) generate correctly on their own and are
 *     NOT part of this gap.
 *
 * This module computes, from the spec alone, the FULL candidate set for both
 * categories (whether or not orval already covers a given one — the I/O
 * wrapper is what checks "does the file already exist?" and only backfills
 * what's actually missing), so this stays correct if a future orval release
 * closes part of the gap: the wrapper backfills less, this module doesn't
 * need to change.
 */

const RESPONSE_REF_RE = /^#\/components\/schemas\/([^/]+)$/;
const PARAM_REF_RE = /^#\/components\/parameters\/(.+)$/;
const OPENAPI_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'];

/** orval sanitises a numeric-leading component key by prefixing `N` (`400` -> `N400`). */
export function sanitizeComponentKey(key) {
  const s = String(key);
  return /^[0-9]/.test(s) ? `N${s}` : s;
}

export function pascalCase(id) {
  if (typeof id !== 'string' || id.length === 0) return id;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** orval's own model-file naming: PascalCase schema name -> camelCase file base. */
export function toFileBase(pascalName) {
  if (typeof pascalName !== 'string' || pascalName.length === 0) return pascalName;
  return pascalName.charAt(0).toLowerCase() + pascalName.slice(1);
}

function refSchemaName(ref) {
  const m = RESPONSE_REF_RE.exec(ref ?? '');
  return m ? m[1] : null;
}

function numericZodExpr(base, schema) {
  let expr = base;
  if (typeof schema.minimum === 'number') expr += `.min(${schema.minimum})`;
  if (typeof schema.maximum === 'number') expr += `.max(${schema.maximum})`;
  return { expr };
}

/** One (type -> zod-expression-builder) entry; kept as data so `schemaToZodExpr` stays a lookup, not a branch tree. */
const ZOD_EXPR_BY_TYPE = {
  integer: (schema) => numericZodExpr('zod.number().int()', schema),
  number: (schema) => numericZodExpr('zod.number()', schema),
  boolean: () => ({ expr: 'zod.boolean()' }),
  // format: date/date-time is deliberately left as a plain string — these
  // are raw query-string values, and over-constraining risks rejecting a
  // valid value in a slightly different (but still parseable) shape.
  string: () => ({ expr: 'zod.string()' }),
};

function unsupportedSchema(schema, fieldPath) {
  return {
    expr: 'zod.unknown()',
    warning: `${fieldPath}: unsupported schema shape ${JSON.stringify(schema)} — falling back to zod.unknown()`,
  };
}

/**
 * Minimal, honest JSON-Schema -> zod-expression compiler. Scoped to the
 * primitive shapes that actually appear in this spec's query-parameter
 * schemas (integer/number with bounds, string, string enum, boolean) — NOT
 * a general JSON-Schema-to-zod translator. An unsupported shape falls back
 * to `zod.unknown()` with a loud warning rather than silently emitting a
 * wrong or overly permissive validator.
 */
export function schemaToZodExpr(schema, fieldPath) {
  if (schema === null || schema === undefined || typeof schema !== 'object') {
    return { expr: 'zod.unknown()', warning: `${fieldPath}: no schema — falling back to zod.unknown()` };
  }
  if (schema.type === 'string' && Array.isArray(schema.enum)) {
    return { expr: `zod.enum(${JSON.stringify(schema.enum)})` };
  }
  const builder = ZOD_EXPR_BY_TYPE[schema.type];
  return builder ? builder(schema) : unsupportedSchema(schema, fieldPath);
}

/** Every `#/components/responses/*` entry, as a {name, target, sourceKey} candidate. */
export function computeResponseAliasCandidates(doc) {
  const responses = doc?.components?.responses ?? {};
  const out = [];
  for (const [key, resp] of Object.entries(responses)) {
    const schema = resp?.content?.['application/json']?.schema;
    const target = schema?.$ref ? refSchemaName(schema.$ref) : null;
    out.push({ name: `${sanitizeComponentKey(key)}Response`, target, sourceKey: key });
  }
  return out;
}

function resolveOperationParams(item, op, componentParameters) {
  const raw = [...(item.parameters ?? []), ...(op.parameters ?? [])];
  const resolved = [];
  for (const p of raw) {
    if (p && typeof p === 'object' && typeof p.$ref === 'string') {
      const m = PARAM_REF_RE.exec(p.$ref);
      const target = m ? componentParameters[m[1]] : undefined;
      if (target) resolved.push(target);
      continue;
    }
    if (p) resolved.push(p);
  }
  return resolved.filter((p) => p.in !== 'path');
}

/** One path item's operations, as `{name, operationId, fields}` candidates (or `[]` if none need a Params type). */
function paramsCandidatesForPathItem(item, componentParameters) {
  if (!item || typeof item !== 'object') return [];
  const out = [];
  for (const method of OPENAPI_METHODS) {
    const op = item[method];
    if (!op || !op.operationId) continue;
    const nonPath = resolveOperationParams(item, op, componentParameters);
    if (nonPath.length === 0) continue;
    out.push({
      name: `${pascalCase(op.operationId)}Params`,
      operationId: op.operationId,
      fields: nonPath.map((p) => ({ propName: p.name, schema: p.schema })),
    });
  }
  return out;
}

/**
 * Every operation's `<PascalOperationId>Params` combiner, for operations
 * that have at least one non-path parameter (orval only emits a Params type
 * at all when there's something to put in it).
 */
export function computeParamsCandidates(doc) {
  const componentParameters = doc?.components?.parameters ?? {};
  return Object.values(doc?.paths ?? {}).flatMap((item) =>
    paramsCandidatesForPathItem(item, componentParameters),
  );
}

const FILE_HEADER = `/**\n * Backfilled by scripts/lib/orval-zod-backfill.mjs (unit S4).\n * Do not edit manually — regenerated by \`npx orval\` (hooks.afterAllFilesWrite).\n * See that file's header comment for why this exists: orval 8.23.0's\n * \`schemas.type: 'zod'\` does not cover named #/components/responses/* or\n * every per-operation query-param combiner type.\n */\n`;

export function renderResponseAliasFile(candidate) {
  const { name, target } = candidate;
  const targetFile = toFileBase(target);
  return (
    `${FILE_HEADER}` +
    `import { z as zod } from 'zod';\n\n` +
    `import { ${target} } from './${targetFile}.zod';\n\n` +
    `export const ${name} = ${target};\n` +
    `export type ${name} = zod.input<typeof ${name}>;\n` +
    `export type ${name}Output = zod.output<typeof ${name}>;\n`
  );
}

export function renderParamsFile(candidate) {
  const { name, fields } = candidate;
  const warnings = [];
  const lines = fields.map((f) => {
    const { expr, warning } = schemaToZodExpr(f.schema, `${name}.${f.propName}`);
    if (warning) warnings.push(warning);
    return `  ${f.propName}: ${expr}.optional(),`;
  });
  const content =
    `${FILE_HEADER}` +
    `import { z as zod } from 'zod';\n\n` +
    `export const ${name} = zod.object({\n${lines.join('\n')}\n});\n\n` +
    `export type ${name} = zod.input<typeof ${name}>;\n` +
    `export type ${name}Output = zod.output<typeof ${name}>;\n`;
  return { content, warnings };
}

/**
 * A second, independent orval defect on the SAME `getBrandingBootstrap`
 * operation (the spec's only non-`application/json` response — verified as
 * the common thread): its `getGetBrandingBootstrapUrl` query-serialization
 * loop is emitted with an EMPTY body, `Object.entries(params ||
 * {}).forEach(([key, value]) => {});` — meaning the `?v=` cache-busting
 * param (load-bearing for spec §4.3's immutable-caching contract) would
 * silently never be sent. Every OTHER generated `getXxxUrl` in this tree
 * uses the same well-formed body (byte-diffed from
 * `getListApplicationsUrl`); this patches any occurrence of the broken
 * empty-body form back to that standard body. Pure string transform, no fs.
 */
const BROKEN_EMPTY_FOREACH = 'Object.entries(params || {}).forEach(([key, value]) => {});';
const FIXED_FOREACH = `Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedParams.append(key, value === null ? 'null' : String(value));
    }
  });`;

export function patchEmptyUrlParamForEach(sourceText) {
  if (!sourceText.includes(BROKEN_EMPTY_FOREACH)) return { text: sourceText, count: 0 };
  const text = sourceText.split(BROKEN_EMPTY_FOREACH).join(FIXED_FOREACH);
  const count = sourceText.split(BROKEN_EMPTY_FOREACH).length - 1;
  return { text, count };
}

/**
 * The full plan: given the spec and the set of model file bases orval
 * itself already wrote (`existingFileBases`, e.g. `new Set(['application',
 * 'errorResponse', ...])`), compute exactly what's missing and render it.
 * Pure — no fs access. Returns `{ files: [{fileBase, name, content}],
 * warnings: string[], skipped: [{name, reason}] }`.
 */
export function planBackfill(doc, existingFileBases) {
  const files = [];
  const warnings = [];
  const skipped = [];

  for (const candidate of computeResponseAliasCandidates(doc)) {
    const fileBase = toFileBase(candidate.name);
    if (existingFileBases.has(fileBase)) continue; // orval already wrote it
    if (!candidate.target) {
      skipped.push({ name: candidate.name, reason: 'no named schema to alias (inline or missing response schema)' });
      continue;
    }
    if (!existingFileBases.has(toFileBase(candidate.target))) {
      skipped.push({ name: candidate.name, reason: `alias target "${candidate.target}" has no model file either` });
      continue;
    }
    files.push({ fileBase, name: candidate.name, content: renderResponseAliasFile(candidate) });
  }

  for (const candidate of computeParamsCandidates(doc)) {
    const fileBase = toFileBase(candidate.name);
    if (existingFileBases.has(fileBase)) continue; // orval already wrote it
    const { content, warnings: fieldWarnings } = renderParamsFile(candidate);
    warnings.push(...fieldWarnings);
    files.push({ fileBase, name: candidate.name, content });
  }

  return { files, warnings, skipped };
}
