/**
 * orval-zod-backfill.mjs — I/O wrapper around orval-zod-backfill-core.mjs,
 * wired into `orval.config.ts`'s `hooks.afterAllFilesWrite` (unit S4).
 *
 * Runs after every `npx orval` (before `prettier --write`, so the files it
 * writes get formatted in the same pass as orval's own output). See
 * orval-zod-backfill-core.mjs's header for why the model backfill exists.
 *
 * The empty-`forEach`-body fix (see `patchEmptyUrlParamForEach`'s doc in the
 * core module) needs a second mechanism, `scheduleUrlParamForEachFixup`,
 * because of an orval lifecycle fact verified empirically (debug-traced,
 * reproduced on 5+ clean runs, never flaky): orval rewrites tag/operation
 * files (`<tag>/<tag>.ts`) a SECOND time, unconditionally, strictly AFTER
 * `afterAllFilesWrite` hooks resolve — a patch applied from inside the hook
 * itself is silently clobbered by that later rewrite every time, not just
 * occasionally. There is no later hook to attach to (`Hook` in
 * `@orval/core` has exactly one member, `'afterAllFilesWrite'`), so the fix
 * cannot live in the hook's own call stack. Instead it's deferred to
 * Node's `beforeExit` event, which fires once the event loop has otherwise
 * drained — i.e. strictly after that later rewrite has completed, since
 * that rewrite is itself just more queued async work the orval CLI's
 * process must finish before it can go idle.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import { patchEmptyUrlParamForEach, planBackfill } from './orval-zod-backfill-core.mjs';

const require = createRequire(import.meta.url);

function loadYaml(specPath) {
  const yaml = require('js-yaml');
  return yaml.load(readFileSync(specPath, 'utf8'));
}

function existingFileBases(modelDir) {
  let entries;
  try {
    entries = readdirSync(modelDir);
  } catch {
    return new Set();
  }
  return new Set(
    entries.filter((f) => f.endsWith('.zod.ts')).map((f) => f.slice(0, -'.zod.ts'.length)),
  );
}

/** Appends `export * from './<fileBase>.zod';` lines for newly-written files, sorted, de-duplicated. */
function patchIndexBarrel(modelDir, newFileBases) {
  const indexPath = path.join(modelDir, 'index.ts');
  let current;
  try {
    current = readFileSync(indexPath, 'utf8');
  } catch {
    return; // orval didn't write an index.ts (e.g. schemas.type isn't 'zod') — nothing to patch
  }
  const existingLines = new Set(current.match(/^export \* from ".*";$/gm) ?? []);
  const additions = newFileBases
    .map((fileBase) => `export * from "./${fileBase}.zod";`)
    .filter((line) => !existingLines.has(line));
  if (additions.length === 0) return;
  const separator = current.endsWith('\n') ? '' : '\n';
  writeFileSync(indexPath, `${current}${separator}${additions.join('\n')}\n`);
}

/** Lists `.ts` files directly under each tag directory of `generatedDir` (skips `model/` and any `.msw.ts`). */
export function tagEndpointFiles(generatedDir) {
  let entries;
  try {
    entries = readdirSync(generatedDir);
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (entry === 'model') continue;
    const full = path.join(generatedDir, entry);
    if (!statSync(full).isDirectory()) continue;
    for (const file of readdirSync(full)) {
      if (file.endsWith('.ts') && !file.endsWith('.msw.ts')) out.push(path.join(full, file));
    }
  }
  return out;
}

/**
 * One synchronous scan-and-fix pass over every generated tag endpoint
 * file's empty-body URL-param `forEach` (see `patchEmptyUrlParamForEach`'s
 * doc). Returns the count of files actually changed. Idempotent — a second
 * call against already-fixed files changes nothing.
 */
export function patchEmptyUrlParamForEachOnce(generatedDir) {
  let patchedFiles = 0;
  for (const file of tagEndpointFiles(generatedDir)) {
    const { text, count } = patchEmptyUrlParamForEach(readFileSync(file, 'utf8'));
    if (count > 0) {
      writeFileSync(file, text);
      patchedFiles += 1;
    }
  }
  return patchedFiles;
}

/**
 * Registers the `beforeExit` fallback pass described in this file's header
 * comment. `process.once` — safe to call every `backfillMissingZodModels`
 * invocation without stacking duplicate listeners across repeated calls
 * within one process (e.g. this module's own test suite).
 */
function scheduleUrlParamForEachFixup(generatedDir) {
  process.once('beforeExit', () => {
    const patched = patchEmptyUrlParamForEachOnce(generatedDir);
    if (patched > 0) {
      process.stdout.write(`orval-zod-backfill: fixed ${patched} empty-body URL-param forEach loop(s)\n`);
    }
  });
}

function writeBackfilledModels(modelDir, files) {
  for (const file of files) {
    writeFileSync(path.join(modelDir, `${file.fileBase}.zod.ts`), file.content);
  }
  if (files.length > 0) {
    patchIndexBarrel(modelDir, files.map((f) => f.fileBase));
  }
}

function reportBackfillResult({ files, warnings, skipped }) {
  if (files.length > 0 || warnings.length > 0) {
    process.stdout.write(
      `orval-zod-backfill: wrote ${files.length} model file(s) orval's zod-schema writer left ` +
        `undefined (${files.map((f) => f.name).join(', ') || 'none'})\n`,
    );
  }
  for (const w of warnings) process.stdout.write(`orval-zod-backfill: WARNING ${w}\n`);
  for (const s of skipped) {
    process.stdout.write(`orval-zod-backfill: skipped ${s.name} — ${s.reason}\n`);
  }
}

/**
 * The `hooks.afterAllFilesWrite` entry point. `specPath`/`modelDir`/
 * `generatedDir` default to this unit's real paths, both relative to
 * `orval.config.ts`'s directory (orval's cwd when it invokes the hook) —
 * overridable for tests.
 */
export async function backfillMissingZodModels({
  specPath = path.join('..', '..', 'services', 'elitea-main', 'api', 'openapi', 'v2.yaml'),
  modelDir = path.join('src', 'shared', 'api', 'generated', 'model'),
  generatedDir = path.join('src', 'shared', 'api', 'generated'),
} = {}) {
  const doc = loadYaml(specPath);
  const existing = existingFileBases(modelDir);
  const plan = planBackfill(doc, existing);

  writeBackfilledModels(modelDir, plan.files);
  reportBackfillResult(plan);

  // Best-effort immediate pass (fixes it here if this orval version/run
  // doesn't hit the later-rewrite lifecycle quirk), PLUS the beforeExit
  // fallback that reliably wins the race described in this file's header.
  patchEmptyUrlParamForEachOnce(generatedDir);
  scheduleUrlParamForEachFixup(generatedDir);

  return plan;
}
