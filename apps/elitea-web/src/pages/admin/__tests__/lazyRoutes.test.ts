/**
 * Every admin page named by `router.tsx`'s `lazyRouteComponent` calls really
 * exports the symbol the call asks for (issue #493).
 *
 * WHY THIS IS NOT ALREADY COVERED. `lazyRouteComponent(() => import('./Users'),
 * 'AdminUsers')` resolves the module at NAVIGATION time and reads
 * `module['AdminUsers']`. A typo, a renamed export or a moved file produces
 * `undefined`, and React then throws "Element type is invalid" — on the screen,
 * in the browser, for that one page only. Nothing before this test looked:
 *
 *  - `Users.test.tsx` and its nine siblings import each page component
 *    DIRECTLY. They prove the export exists; they never read the router.
 *  - `AdminNav.test.tsx` mounts the real router, but at three paths (`/`,
 *    `/users`, `/roles`). The other eight pages are never rendered.
 *  - `adminVisualIndex.test.ts` reads `routesById` keys only, which are path
 *    strings and say nothing about the component behind them.
 *  - `preload()` cannot be used as the check either: it CATCHES the import
 *    failure into a module-scoped variable and resolves anyway
 *    (`lazyRouteComponent.js`), so `await component.preload()` passes on a
 *    broken binding. A green await there would be the emptiest kind of pass.
 *
 * The pairs are read out of `router.tsx`'s own source rather than listed here,
 * so a page added to the router is checked without anyone remembering to add a
 * line to this file — the same discipline `routeWiring.test.ts` uses.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROUTER_FILE = 'src/pages/admin/router.tsx';

/**
 * Every sibling module of `router.tsx`, as vite resolves them at build time.
 * A static glob, not `await import(variable)`: the glob is typed, so the test
 * asserts against `Record<string, unknown>` rather than `any`, and a specifier
 * that names no file surfaces as a missing key instead of a rejected promise.
 */
const adminModules = import.meta.glob<Record<string, unknown>>('../*.tsx');

interface LazyBinding {
  /** The specifier passed to `import()`, e.g. `./Users`. */
  readonly specifier: string;
  /** The export name the second argument asks for, e.g. `AdminUsers`. */
  readonly exportName: string;
}

function lazyBindings(): LazyBinding[] {
  const source = readFileSync(join(process.cwd(), ROUTER_FILE), 'utf8');
  const call = /lazyRouteComponent\(\s*\(\)\s*=>\s*import\(\s*'([^']+)'\s*\)\s*,\s*'([^']+)'\s*,?\s*\)/g;
  const out: LazyBinding[] = [];
  for (const match of source.matchAll(call)) {
    const specifier = match[1];
    const exportName = match[2];
    if (specifier === undefined || exportName === undefined) continue;
    out.push({ specifier, exportName });
  }
  return out;
}

describe('admin lazy route components', () => {
  const bindings = lazyBindings();

  it('finds the lazy bindings to check (guards against a regex that stopped matching)', () => {
    // Ten pages are lazy; the index route shares `AdminUsers` with `/users`.
    // Ten is a floor, not the count, so an eleventh page does not churn this.
    expect(bindings.length).toBeGreaterThanOrEqual(10);
  });

  it.each(bindings.map((binding) => [binding.specifier, binding.exportName] as const))(
    'import("%s") exports %s',
    async (specifier, exportName) => {
      // `router.tsx` sits one directory up from this file, so `./Users` there
      // is `../Users.tsx` here.
      const key = `../${specifier.replace('./', '')}.tsx`;
      const load = adminModules[key];
      expect(load, `${ROUTER_FILE} imports '${specifier}', which resolves to no file`).toBeTypeOf(
        'function',
      );

      const loaded = await load!();
      expect(
        typeof loaded[exportName],
        `${ROUTER_FILE} asks import('${specifier}') for '${exportName}', which it does not export`,
      ).toBe('function');
    },
  );
});
