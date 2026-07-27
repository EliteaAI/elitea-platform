import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';

import {
  backfillMissingZodModels,
  patchEmptyUrlParamForEachOnce,
  tagEndpointFiles,
} from './orval-zod-backfill.mjs';

/**
 * I/O-level coverage of the `orval-zod-backfill.mjs` wrapper — everything
 * `orval-zod-backfill-core.test.mjs` doesn't reach because it's pure-logic
 * only. Every test works against a scratch directory tree
 * (`mkdtempSync`/`rmSync`), the same isolation pattern
 * `check-gates-selftest.mjs`'s R-M4 case uses, so nothing here ever touches
 * the real `src/shared/api/generated/**`.
 */

const SPEC_YAML = [
  'components:',
  '  responses:',
  "    '400':",
  '      content:',
  '        application/json:',
  '          schema:',
  '            $ref: "#/components/schemas/ErrorResponse"',
  '  parameters:',
  '    Limit:',
  '      name: limit',
  '      in: query',
  '      schema: { type: integer, minimum: 1 }',
  'paths:',
  '  /roles:',
  '    get:',
  '      operationId: roleList',
  '      parameters:',
  "        - $ref: '#/components/parameters/Limit'",
].join('\n');

/** Response-only spec (no paths at all) — used to prove existingFileBases's
 * readdirSync-ENOENT branch without also producing a Params file, which
 * would otherwise try to writeFileSync into the deliberately-absent modelDir. */
const SPEC_YAML_RESPONSE_ONLY = [
  'components:',
  '  responses:',
  "    '400':",
  '      content:',
  '        application/json:',
  '          schema:',
  '            $ref: "#/components/schemas/ErrorResponse"',
  'paths: {}',
].join('\n');

/** A query param with a JSON-Schema shape schemaToZodExpr doesn't support
 * (array), so renderParamsFile surfaces a warning while still writing the
 * zod.unknown() fallback field. */
const SPEC_YAML_WARNING_PARAM = [
  'components:',
  '  parameters:',
  '    Blob:',
  '      name: blob',
  '      in: query',
  '      schema:',
  '        type: array',
  'paths:',
  '  /roles:',
  '    get:',
  '      operationId: roleList',
  '      parameters:',
  "        - $ref: '#/components/parameters/Blob'",
].join('\n');

let dirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('tagEndpointFiles', () => {
  it('lists .ts files under each tag directory, skipping model/ and .msw.ts', () => {
    const root = makeTempDir('s4-tagfiles-');
    mkdirSync(join(root, 'admin'), { recursive: true });
    mkdirSync(join(root, 'model'), { recursive: true });
    writeFileSync(join(root, 'admin', 'admin.ts'), '// ops');
    writeFileSync(join(root, 'admin', 'admin.msw.ts'), '// mocks');
    writeFileSync(join(root, 'model', 'application.zod.ts'), '// model');
    writeFileSync(join(root, 'mutator.ts'), '// not a tag dir, a file at root'); // must not crash statSync

    const files = tagEndpointFiles(root);
    expect(files).toEqual([join(root, 'admin', 'admin.ts')]);
  });

  it('returns [] when the directory does not exist', () => {
    expect(tagEndpointFiles(join(tmpdir(), 'definitely-does-not-exist-s4'))).toEqual([]);
  });
});

describe('patchEmptyUrlParamForEachOnce', () => {
  it('fixes the broken empty forEach body in place and returns the patched-file count', () => {
    const root = makeTempDir('s4-patch-');
    mkdirSync(join(root, 'default'), { recursive: true });
    const file = join(root, 'default', 'default.ts');
    writeFileSync(file, 'Object.entries(params || {}).forEach(([key, value]) => {});');

    expect(patchEmptyUrlParamForEachOnce(root)).toBe(1);
    expect(readFileSync(file, 'utf8')).toContain("normalizedParams.append(key, value === null ? 'null' : String(value));");
  });

  it('is a no-op (0 files patched) once already fixed — idempotent', () => {
    const root = makeTempDir('s4-patch-idempotent-');
    mkdirSync(join(root, 'default'), { recursive: true });
    const file = join(root, 'default', 'default.ts');
    writeFileSync(file, 'Object.entries(params || {}).forEach(([key, value]) => {});');
    patchEmptyUrlParamForEachOnce(root);
    expect(patchEmptyUrlParamForEachOnce(root)).toBe(0);
  });
});

describe('backfillMissingZodModels', () => {
  function setUpTree() {
    const root = makeTempDir('s4-backfill-');
    const specPath = join(root, 'v2.yaml');
    const modelDir = join(root, 'generated', 'model');
    const generatedDir = join(root, 'generated');
    writeFileSync(specPath, SPEC_YAML);
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, 'errorResponse.zod.ts'), "export const ErrorResponse = 1;\n");
    writeFileSync(join(modelDir, 'index.ts'), 'export * from "./errorResponse.zod";\n');
    return { root, specPath, modelDir, generatedDir };
  }

  it('writes the missing response alias + Params files and appends the barrel', async () => {
    const { specPath, modelDir, generatedDir } = setUpTree();

    const result = await backfillMissingZodModels({ specPath, modelDir, generatedDir });

    expect(result.files.map((f) => f.name).sort()).toEqual(['N400Response', 'RoleListParams']);
    expect(readFileSync(join(modelDir, 'n400Response.zod.ts'), 'utf8')).toContain('export const N400Response = ErrorResponse;');
    expect(readFileSync(join(modelDir, 'roleListParams.zod.ts'), 'utf8')).toContain('export const RoleListParams = zod.object({');
    const barrel = readFileSync(join(modelDir, 'index.ts'), 'utf8');
    expect(barrel).toContain('export * from "./errorResponse.zod";'); // original line preserved
    expect(barrel).toContain('export * from "./n400Response.zod";');
    expect(barrel).toContain('export * from "./roleListParams.zod";');
  });

  it('does not duplicate a barrel line already present', async () => {
    const { specPath, modelDir, generatedDir } = setUpTree();
    writeFileSync(join(modelDir, 'n400Response.zod.ts'), 'export const N400Response = 1;\n');
    writeFileSync(
      join(modelDir, 'index.ts'),
      'export * from "./errorResponse.zod";\nexport * from "./n400Response.zod";\n',
    );

    await backfillMissingZodModels({ specPath, modelDir, generatedDir });

    const barrel = readFileSync(join(modelDir, 'index.ts'), 'utf8');
    expect(barrel.match(/n400Response\.zod/g)).toHaveLength(1);
  });

  it('does not rewrite index.ts when every newly backfilled name already has a barrel line (no-op early return)', async () => {
    const { specPath, modelDir, generatedDir } = setUpTree();
    // index.ts already carries the RoleListParams barrel line, even though
    // roleListParams.zod.ts itself isn't on disk yet — planBackfill still
    // finds it missing (it only looks at .zod.ts files), so patchIndexBarrel
    // runs, but the filtered `additions` list ends up empty.
    writeFileSync(
      join(modelDir, 'index.ts'),
      'export * from "./errorResponse.zod";\nexport * from "./roleListParams.zod";\n',
    );
    writeFileSync(join(modelDir, 'n400Response.zod.ts'), 'export const N400Response = 1;\n');

    const before = readFileSync(join(modelDir, 'index.ts'), 'utf8');
    const result = await backfillMissingZodModels({ specPath, modelDir, generatedDir });
    const after = readFileSync(join(modelDir, 'index.ts'), 'utf8');

    expect(result.files.map((f) => f.name)).toEqual(['RoleListParams']);
    expect(after).toBe(before);
  });

  it('creates a new export line and adds a leading newline when index.ts has no matching lines / no trailing newline', async () => {
    const { specPath, modelDir, generatedDir } = setUpTree();
    // No `export * from "...";` lines at all, and no trailing newline —
    // `.match()` returns null (the `?? []` fallback) and the separator must
    // be inserted rather than assumed already present.
    writeFileSync(join(modelDir, 'index.ts'), 'export const notAModelBarrel = true;');
    writeFileSync(join(modelDir, 'n400Response.zod.ts'), 'export const N400Response = 1;\n');

    await backfillMissingZodModels({ specPath, modelDir, generatedDir });

    const barrel = readFileSync(join(modelDir, 'index.ts'), 'utf8');
    expect(barrel).toBe('export const notAModelBarrel = true;\nexport * from "./roleListParams.zod";\n');
  });

  it('treats a completely missing model directory as having no existing files (readdirSync ENOENT branch)', async () => {
    const root = makeTempDir('s4-backfill-missing-modeldir-');
    const specPath = join(root, 'v2.yaml');
    const modelDir = join(root, 'generated', 'model'); // deliberately never created
    const generatedDir = join(root, 'generated');
    writeFileSync(specPath, SPEC_YAML_RESPONSE_ONLY);

    const result = await backfillMissingZodModels({ specPath, modelDir, generatedDir });

    // With no directory to read, existingFileBases is empty, so the response
    // alias is a candidate — but its target ("ErrorResponse") also isn't on
    // disk, so it's skipped rather than written (which would otherwise throw
    // trying to writeFileSync into a directory that doesn't exist).
    expect(result.files).toEqual([]);
    expect(result.skipped).toContainEqual({
      name: 'N400Response',
      reason: 'alias target "ErrorResponse" has no model file either',
    });
  });

  it('logs a per-field warning for an unsupported query-param schema, still writing the zod.unknown() fallback field', async () => {
    const root = makeTempDir('s4-backfill-warning-');
    const specPath = join(root, 'v2.yaml');
    const modelDir = join(root, 'generated', 'model');
    const generatedDir = join(root, 'generated');
    writeFileSync(specPath, SPEC_YAML_WARNING_PARAM);
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, 'index.ts'), '');

    const result = await backfillMissingZodModels({ specPath, modelDir, generatedDir });

    expect(result.warnings).toEqual([
      'RoleListParams.blob: unsupported schema shape {"type":"array"} — falling back to zod.unknown()',
    ]);
    expect(result.files.map((f) => f.name)).toEqual(['RoleListParams']);
  });

  it('writes nothing when every candidate already exists on disk', async () => {
    const { specPath, modelDir, generatedDir } = setUpTree();
    writeFileSync(join(modelDir, 'n400Response.zod.ts'), 'export const N400Response = 1;\n');
    writeFileSync(join(modelDir, 'roleListParams.zod.ts'), 'export const RoleListParams = 1;\n');

    const result = await backfillMissingZodModels({ specPath, modelDir, generatedDir });

    expect(result.files).toEqual([]);
  });

  it('tolerates a model directory with no index.ts (schemas.type not "zod") without throwing', async () => {
    const { root, specPath, generatedDir } = setUpTree();
    const bareModelDir = join(root, 'bare-model');
    mkdirSync(bareModelDir, { recursive: true }); // no index.ts, no errorResponse — alias target missing too

    await expect(backfillMissingZodModels({ specPath, modelDir: bareModelDir, generatedDir })).resolves.toBeDefined();
  });

  it('reports a skipped alias whose target has no model file (logged, not thrown)', async () => {
    const root = makeTempDir('s4-backfill-skip-');
    const specPath = join(root, 'v2.yaml');
    const modelDir = join(root, 'generated', 'model');
    const generatedDir = join(root, 'generated');
    writeFileSync(specPath, SPEC_YAML);
    mkdirSync(modelDir, { recursive: true }); // errorResponse.zod.ts deliberately absent

    const result = await backfillMissingZodModels({ specPath, modelDir, generatedDir });
    expect(result.skipped).toContainEqual({
      name: 'N400Response',
      reason: 'alias target "ErrorResponse" has no model file either',
    });
  });

  it('schedules the beforeExit fallback pass, which fixes a forEach bug the immediate pass missed', async () => {
    const { specPath, modelDir, generatedDir } = setUpTree();
    mkdirSync(join(generatedDir, 'default'), { recursive: true });
    const opFile = join(generatedDir, 'default', 'default.ts');
    // Simulate orval's later-rewrite race (see this module's header comment):
    // the file is written to disk only AFTER backfillMissingZodModels's own
    // immediate pass has already run.
    await backfillMissingZodModels({ specPath, modelDir, generatedDir });
    writeFileSync(opFile, 'Object.entries(params || {}).forEach(([key, value]) => {});');

    process.emit('beforeExit', 0); // fires the registered listener synchronously

    expect(readFileSync(opFile, 'utf8')).not.toContain('forEach(([key, value]) => {});');
  });
});
