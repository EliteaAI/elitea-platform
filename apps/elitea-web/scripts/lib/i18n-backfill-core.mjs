/**
 * i18n-backfill-core.mjs — pure decision logic for the `en.json` sync
 * backfill + CI gate (issue #44). No fs/network access here (see
 * i18n-backfill.mjs for the I/O wrapper that globs `src/**​/*.{ts,tsx}`,
 * calls this, and either writes the merge or `--check`s it).
 *
 * Reuses `walk()` from budgets-core.mjs (unit F2) rather than forking a new
 * AST utility — same generic ESTree-ish walker, same @babel/parser.
 *
 * WHY a two-function split (extractCallSites / planBackfill), not one:
 * extraction is per-file (what does this ONE file's `t()` call sites say),
 * planning is cross-file (does every call site for a given key agree). The
 * I/O wrapper concatenates extractCallSites' output across the whole tree
 * before calling planBackfill once — that boundary is also where a future
 * consumer (e.g. an oxlint rule, per issue #44's "out of scope" list) could
 * reuse just the per-file half without needing the cross-file merge.
 */
import { posix } from 'node:path';

import { parse } from '@babel/parser';

import { walk } from './budgets-core.mjs';

/**
 * Both are real sources of truth for "which keys will eventually need
 * entries" until issue #45's stub migration lands — `@/shared/ui/lib/t`'s
 * `t(key, fallback)` shim has the identical two-required-argument contract
 * (see that file's own header), so its call sites extract identically.
 *
 * `@/shared/i18n` is a directory import (resolves to its `index.ts`
 * barrel); `@/shared/ui/lib/t` is a single file. Targets are repo-relative,
 * extension-less, matching `filename`'s own shape (the I/O wrapper passes
 * paths like `src/shared/ui/lib/t.ts` — see resolveImportSource below,
 * which strips the extension the same way before comparing).
 */
const T_MODULE_TARGETS = new Set(['src/shared/i18n', 'src/shared/ui/lib/t']);

function parseSource(source) {
  return parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
}

/**
 * Resolves an import specifier to a repo-relative, extension-less module
 * path — `@/x` -> `src/x` (this repo's tsconfig `paths` alias), `./x`/`../x`
 * -> resolved against the importing file's own directory. `null` for a bare
 * package specifier (e.g. `'react'`), which can never be one of our two
 * targets. Both call sites this repo actually uses (`@/shared/i18n` and the
 * relative `../lib/t` some `shared/ui/**` components use instead of the
 * `@/shared/ui/lib/t` alias — same file, different spelling) resolve here.
 */
function resolveImportSource(filename, source) {
  if (source.startsWith('@/')) return posix.join('src', source.slice(2));
  if (source.startsWith('.')) return posix.join(posix.dirname(filename), source);
  return null;
}

/** Local identifier name(s) bound to `t` imported from a T_MODULE_TARGETS module, e.g. `{t}` or `{t as translate}`. */
function boundTNames(ast, filename) {
  const names = new Set();
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    const resolved = resolveImportSource(filename, statement.source.value);
    if (resolved === null || !T_MODULE_TARGETS.has(resolved)) continue;
    for (const specifier of statement.specifiers) {
      // Default (`import Foo from 'x'`) and namespace (`import * as ns`)
      // specifiers are skipped — only a named `{ t }` binds this codebase's
      // `t()`; a string-named import (`{ "t" as x }`) is grammar this repo
      // never emits, so `.imported` is always an Identifier here.
      if (specifier.type !== 'ImportSpecifier') continue;
      if (specifier.imported.name === 't') names.add(specifier.local.name);
    }
  }
  return names;
}

/** A plain string literal, or a template literal with no `${}` expressions (a static string written with backticks). */
function staticStringValue(node) {
  if (!node) return { isStatic: false };
  if (node.type === 'StringLiteral') return { isStatic: true, value: node.value };
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return { isStatic: true, value: node.quasis[0].value.cooked };
  }
  return { isStatic: false };
}

function snippet(source, node) {
  return source.slice(node.start, node.end);
}

/**
 * One file's `t()` call sites, classified. Never silently drops a call —
 * every CallExpression bound to `t` becomes either a captured `entries[]`
 * item (key AND fallback both statically known) or a `flagged[]` item
 * (`dynamic-key`: first argument isn't a string literal, so the key can't
 * be checked against en.json at all; `interpolated-fallback`: the key IS a
 * string literal but the fallback isn't a static string — e.g. a template
 * literal with `${}` expressions — and needs a hand-written
 * i18next-interpolation-style fallback, see ParticipantWarning.tsx's
 * `checkThe` call site for the pattern).
 */
export function extractCallSites(filename, source) {
  const entries = [];
  const flagged = [];

  let ast;
  try {
    ast = parseSource(source);
  } catch (error) {
    flagged.push({ filename, line: 1, reason: 'parse-error', detail: error.message });
    return { entries, flagged };
  }

  const tNames = boundTNames(ast, filename);
  if (tNames.size === 0) return { entries, flagged };

  walk(ast.program, (node) => {
    if (node.type !== 'CallExpression') return;
    if (node.callee.type !== 'Identifier' || !tNames.has(node.callee.name)) return;

    const [keyArg, fallbackArg] = node.arguments;
    const line = node.loc.start.line;

    if (!keyArg || keyArg.type !== 'StringLiteral') {
      flagged.push({ filename, line, reason: 'dynamic-key', detail: snippet(source, node) });
      return;
    }

    const fallback = staticStringValue(fallbackArg);
    if (!fallback.isStatic) {
      flagged.push({ filename, line, key: keyArg.value, reason: 'interpolated-fallback', detail: snippet(source, node) });
      return;
    }

    entries.push({ key: keyArg.value, fallback: fallback.value, filename, line });
  });

  return { entries, flagged };
}

/**
 * The full plan: given `en.json`'s current contents and every extracted
 * `entries[]` item across the tree (concatenated by the I/O wrapper), compute
 * exactly what's safe to add. Pure — no fs access.
 *
 *   - A key not yet in `existingEn`, where every call site agrees on the
 *     exact same fallback text, goes into `toAdd` (key -> fallback).
 *   - A key not yet in `existingEn`, where call sites disagree, is a
 *     `conflicts` entry — reported with every distinct fallback and its
 *     call sites, never auto-resolved by picking one.
 *   - A key already in `existingEn` is NEVER overwritten. If any call
 *     site's fallback has since drifted from the shipped value, that's a
 *     separate `drifted` entry (shipped-key-text-drifted) — also surfaced,
 *     also never silently fixed.
 */
export function planBackfill(existingEn, allEntries) {
  const byKey = new Map();
  for (const entry of allEntries) {
    let variants = byKey.get(entry.key);
    if (!variants) {
      variants = new Map();
      byKey.set(entry.key, variants);
    }
    let sites = variants.get(entry.fallback);
    if (!sites) {
      sites = [];
      variants.set(entry.fallback, sites);
    }
    sites.push({ filename: entry.filename, line: entry.line });
  }

  const toAdd = {};
  const conflicts = [];
  const drifted = [];

  for (const [key, variants] of byKey) {
    const variantList = [...variants].map(([fallback, sites]) => ({ fallback, sites }));

    if (Object.hasOwn(existingEn, key)) {
      const shipped = existingEn[key];
      const driftedVariants = variantList.filter((v) => v.fallback !== shipped);
      if (driftedVariants.length > 0) {
        drifted.push({ key, shipped, variants: driftedVariants });
      }
      continue;
    }

    if (variantList.length === 1) {
      toAdd[key] = variantList[0].fallback;
    } else {
      conflicts.push({ key, variants: variantList });
    }
  }

  return { toAdd, conflicts, drifted };
}
