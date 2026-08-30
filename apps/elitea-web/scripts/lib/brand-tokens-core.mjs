/**
 * Decision logic for scripts/gen-brand-tokens.mjs (unit T1) — the mechanical
 * conversion of the baseline palettes into brand-pack scheme records.
 *
 * Pure functions only: (source text | plain objects) -> plain objects.
 * The driver script does the filesystem work.
 */

/**
 * Evaluate one of the baseline palette modules without a module loader.
 *
 * `darkPalette.js` / `lightPalette.js` are plain ESM data modules: a run of
 * `const` colour declarations followed by one object literal and a default
 * export. `lightPalette.js` HISTORICALLY imported `white` from `darkPalette`,
 * and stopped at baseline 20b23c42, where it declares its own. So `injected`
 * is a best-effort supply, not an override: a name the module body already
 * declares is skipped, because emitting both produced
 * `SyntaxError: Identifier 'white' has already been declared` and broke the
 * generator against every baseline newer than that commit.
 * Node cannot import them directly (extensionless relative specifier, and
 * the baseline is outside this package), so the text is de-moduled and run
 * through `new Function`:
 *
 *   - `import { … } from './darkPalette';`  -> dropped (injected instead)
 *   - `export const X = …`                  -> `const X = …`
 *   - `export default NAME;`                -> `return NAME;`
 *
 * This is a syntactic transform of data-only modules — no evaluation of
 * baseline application code ever happens.
 *
 * @param {string} source raw module text
 * @param {Record<string,string>} injected names the module imports
 * @returns {{ palette: Record<string, unknown>, consts: Record<string, unknown> }}
 */
export function evalPaletteModule(source, injected = {}) {
  const withoutImports = source.replace(/^\s*import\s[^;]*;\s*$/gm, '');
  const defaultExport = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/.exec(withoutImports);
  if (!defaultExport) {
    throw new Error('palette module has no `export default <identifier>;`');
  }
  const exportedNames = [...withoutImports.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)].map(
    (m) => m[1],
  );
  const body = withoutImports
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+default\s+[A-Za-z_$][\w$]*\s*;/, '');

  const selfDeclared = new Set(
    [...body.matchAll(/(?:^|\n)\s*const\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  );
  const preamble = Object.entries(injected)
    .filter(([name]) => !selfDeclared.has(name))
    .map(([name, value]) => `const ${name} = ${JSON.stringify(value)};`)
    .join('\n');
  const epilogue = `return { palette: ${defaultExport[1]}, consts: { ${exportedNames.join(', ')} } };`;

  // eslint-disable-next-line no-new-func -- deliberate: see the doc comment
  return new Function(`${preamble}\n${body}\n${epilogue}`)();
}

/**
 * Flatten a nested palette object into `a.b.c` -> value entries.
 * Only string leaves become tokens (the baseline has no numeric leaves).
 *
 * @param {Record<string, unknown>} obj
 * @param {string[]} skipTopLevel keys dropped at depth 0
 * @returns {Record<string,string>}
 */
export function flattenPalette(obj, skipTopLevel = []) {
  const out = {};
  const skip = new Set(skipTopLevel);
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      if (path.length === 0 && skip.has(key)) continue;
      const next = [...path, key];
      if (value !== null && typeof value === 'object') {
        walk(value, next);
      } else if (typeof value === 'string') {
        out[next.join('.')] = value;
      } else {
        throw new Error(`non-string leaf at ${next.join('.')}: ${String(value)}`);
      }
    }
  };
  walk(obj, []);
  return out;
}

/** Token ids present in one record but not the other, both directions. */
export function asymmetry(light, dark) {
  const lightOnly = Object.keys(light).filter((k) => !(k in dark));
  const darkOnly = Object.keys(dark).filter((k) => !(k in light));
  return { lightOnly, darkOnly };
}

/**
 * Build the nested key tree (union of both schemes) used to emit the
 * TypeScript module augmentation. Leaves are `true`.
 * @param {string[]} tokenIds
 */
export function keyTree(tokenIds) {
  const root = {};
  for (const id of tokenIds) {
    const parts = id.split('.');
    let node = root;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        if (node[part] && node[part] !== true) {
          throw new Error(`token id ${id} collides with a group of the same name`);
        }
        node[part] = true;
      } else {
        if (node[part] === true) {
          throw new Error(`token id ${id} nests under the leaf ${parts.slice(0, i + 1).join('.')}`);
        }
        node[part] ??= {};
        node = node[part];
      }
    });
  }
  return root;
}

/** Render a key tree as an inline TypeScript object type. */
export function renderTypeLiteral(node, indent = 2) {
  const pad = ' '.repeat(indent);
  const inner = Object.entries(node)
    .map(([key, value]) => {
      const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
      return value === true
        ? `${pad}${name}: string;`
        : `${pad}${name}: ${renderTypeLiteral(value, indent + 2)};`;
    })
    .join('\n');
  return `{\n${inner}\n${' '.repeat(indent - 2)}}`;
}
