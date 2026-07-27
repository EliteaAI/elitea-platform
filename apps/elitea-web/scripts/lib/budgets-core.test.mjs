import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIMITS,
  checkComponents,
  checkFile,
  checkFileLength,
  checkHookDeps,
  checkSlicePublicApi,
  countExports,
  isGeneratedFile,
  isSliceIndex,
  isTestFile,
  parseSource,
  walk,
} from './budgets-core.mjs';

/** Table-driven coverage of every §3.5 decision this module makes (unit F2:
 * 100% of the script's decision logic). */

const lines = (n, body = 'export const x = 1;') => Array.from({ length: n }, () => body).join('\n');

const component = (propCount, effectCount, depCount) => {
  const props = Array.from({ length: propCount }, (_, i) => `p${i}`).join(', ');
  const effects = Array.from(
    { length: effectCount },
    () => 'useEffect(() => {}, []);',
  ).join('\n  ');
  const deps = Array.from({ length: depCount }, (_, i) => `p${i}`).join(', ');
  return `
import { useEffect, useMemo } from 'react';
export function Card({ ${props} }: Record<string, unknown>) {
  ${effects}
  const memo = useMemo(() => 1, [${deps}]);
  return memo;
}`;
};

describe('file classification', () => {
  it.each([
    ['src/features/x/ui/A.test.tsx', true],
    ['src/features/x/__tests__/a.ts', true],
    ['src/features/x/__mocks__/a.ts', true],
    ['src/test/setup.ts', true],
    ['src/features/x/ui/A.stories.tsx', true],
    ['src/features/x/ui/A.tsx', false],
  ])('isTestFile(%s) -> %s', (file, expected) => {
    expect(isTestFile(file)).toBe(expected);
  });

  it.each([
    ['src/shared/api/generated/endpoints.ts', true],
    ['src/routeTree.gen.ts', true],
    ['src/shared/types/api.d.ts', true],
    ['src/features/x/ui/A.tsx', false],
  ])('isGeneratedFile(%s) -> %s', (file, expected) => {
    expect(isGeneratedFile(file)).toBe(expected);
  });

  it.each([
    ['src/features/foo/index.ts', true],
    ['src/entities/bar/index.ts', true],
    ['src/widgets/w/index.tsx', true],
    ['src/processes/chat/index.ts', true],
    ['src/shared/ui/index.ts', false],
    ['src/features/foo/ui/index.ts', false],
  ])('isSliceIndex(%s) -> %s', (file, expected) => {
    expect(isSliceIndex(file)).toBe(expected);
  });
});

describe('file-length budget', () => {
  it('passes at exactly 400 lines', () => {
    expect(checkFileLength('src/a.ts', lines(400))).toEqual([]);
  });

  it('does not count the trailing newline as a line (wc -l semantics)', () => {
    expect(checkFileLength('src/a.ts', `${lines(400)}\n`)).toEqual([]);
    expect(checkFileLength('src/a.ts', `${lines(401)}\n`)).toHaveLength(1);
  });

  it('fails at 401 lines with the rule id file-length', () => {
    const findings = checkFileLength('src/a.ts', lines(401));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('file-length');
  });

  it('exempts test files and generated files', () => {
    expect(checkFileLength('src/a.test.ts', lines(500))).toEqual([]);
    expect(checkFileLength('src/shared/api/generated/e.ts', lines(500))).toEqual([]);
  });

  it('honours a custom limit', () => {
    expect(checkFileLength('src/a.ts', lines(11), { ...DEFAULT_LIMITS, fileLength: 10 })).toHaveLength(1);
  });
});

describe('component budgets', () => {
  it('passes a component at the 12-prop / 3-effect boundary', () => {
    const ast = parseSource('src/A.tsx', component(12, 3, 2));
    expect(checkComponents('src/A.tsx', ast)).toEqual([]);
  });

  it('fails a 13-prop component (component-props)', () => {
    const ast = parseSource('src/A.tsx', component(13, 1, 2));
    const findings = checkComponents('src/A.tsx', ast);
    expect(findings.map((f) => f.rule)).toContain('component-props');
  });

  it('counts TSTypeLiteral members when they exceed the destructured count', () => {
    const source = `
export function Wide(props: { a: 1; b: 2; c: 3; d: 4; e: 5; f: 6; g: 7; h: 8; i: 9; j: 10; k: 11; l: 12; m: 13 }) {
  return null;
}`;
    const findings = checkComponents('src/A.tsx', parseSource('src/A.tsx', source));
    expect(findings.map((f) => f.rule)).toContain('component-props');
  });

  it('fails a component with 4 useEffect calls (use-effects)', () => {
    const ast = parseSource('src/A.tsx', component(2, 4, 2));
    const findings = checkComponents('src/A.tsx', ast);
    expect(findings.map((f) => f.rule)).toContain('use-effects');
  });

  it('ignores lowercase (non-component) functions entirely', () => {
    const source = `
import { useEffect } from 'react';
export function useThing({ a, b, c, d, e, f, g, h, i, j, k, l, m }: Record<string, unknown>) {
  useEffect(() => {}, []);
  useEffect(() => {}, []);
  useEffect(() => {}, []);
  useEffect(() => {}, []);
  return null;
}`;
    expect(checkComponents('src/u.ts', parseSource('src/u.ts', source))).toEqual([]);
  });

  it('attributes effects to arrow components assigned to const', () => {
    const source = `
import { useEffect } from 'react';
export const Panel = () => {
  useEffect(() => {}, []);
  useEffect(() => {}, []);
  useEffect(() => {}, []);
  useEffect(() => {}, []);
  return null;
};`;
    const findings = checkComponents('src/P.tsx', parseSource('src/P.tsx', source));
    expect(findings.map((f) => f.rule)).toEqual(['use-effects']);
  });
});

describe('hook-deps budget', () => {
  it('passes at exactly 8 dependencies', () => {
    const source = 'export const x = useMemo(() => 1, [a, b, c, d, e, f, g, h]);';
    expect(checkHookDeps('src/a.ts', parseSource('src/a.ts', source))).toEqual([]);
  });

  it('fails at 9 dependencies, for any use* hook', () => {
    const source = 'export const x = useDerivedThing(() => 1, [a, b, c, d, e, f, g, h, i]);';
    const findings = checkHookDeps('src/a.ts', parseSource('src/a.ts', source));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('hook-deps');
  });

  it('ignores non-hook calls with long arrays', () => {
    const source = 'export const x = pickAll(() => 1, [a, b, c, d, e, f, g, h, i, j]);';
    expect(checkHookDeps('src/a.ts', parseSource('src/a.ts', source))).toEqual([]);
  });
});

describe('slice public API budget', () => {
  const exportsOf = (n) => Array.from({ length: n }, (_, i) => `export const s${i} = ${i};`).join('\n');

  it('passes 20 exports on a slice index', () => {
    const ast = parseSource('src/features/foo/index.ts', exportsOf(20));
    expect(checkSlicePublicApi('src/features/foo/index.ts', ast)).toEqual([]);
  });

  it('fails 21 exports on a slice index', () => {
    const ast = parseSource('src/features/foo/index.ts', exportsOf(21));
    const findings = checkSlicePublicApi('src/features/foo/index.ts', ast);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('slice-public-api');
  });

  it('does not apply outside slice index files', () => {
    const ast = parseSource('src/shared/lib/util.ts', exportsOf(30));
    expect(checkSlicePublicApi('src/shared/lib/util.ts', ast)).toEqual([]);
  });

  it('counts named specifiers, default exports and declarations', () => {
    const source = `
const a = 1; const b = 2;
export { a, b };
export function c() {}
export const d = 4, e = 5;
export default a;
`;
    expect(countExports(parseSource('i.ts', source))).toBe(6);
  });

  it('treats export * as unbounded (fails the budget outright)', () => {
    const ast = parseSource('src/features/foo/index.ts', "export * from './lib';");
    const findings = checkSlicePublicApi('src/features/foo/index.ts', ast);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('unbounded');
  });
});

describe('checkFile orchestration', () => {
  it('aggregates findings across checks', () => {
    const source = `${component(13, 4, 9)}\n${lines(400, '// padding line')}`;
    const findings = checkFile('src/features/foo/ui/Big.tsx', source);
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain('file-length');
    expect(rules).toContain('component-props');
    expect(rules).toContain('use-effects');
    expect(rules).toContain('hook-deps');
  });

  it('reports unparseable source as a finding instead of crashing', () => {
    const findings = checkFile('src/a.ts', 'const = broken(');
    expect(findings.map((f) => f.rule)).toContain('parse-error');
  });

  it('returns no findings for a clean file', () => {
    expect(checkFile('src/features/foo/ui/Ok.tsx', component(3, 1, 2))).toEqual([]);
  });
});

describe('walk', () => {
  it('visits nested nodes with ancestor chains and tolerates non-nodes', () => {
    // The comment and the numeric literal exercise the skipped-key branches
    // (leadingComments / extra) in the walker.
    // Comment + numeric literal exercise the skipped-key branches; the array
    // hole ([1, , 2]) exercises the null-element guard.
    const ast = parseSource('src/a.ts', '// header comment\nexport const x = { deep: [1, , { y: 2 }] };');
    const seen = [];
    walk(ast.program, (node, ancestors) => seen.push([node.type, ancestors.length]));
    expect(seen.some(([type]) => type === 'ObjectProperty' || type === 'Property')).toBe(true);
    expect(seen[0][1]).toBe(0);
    walk(null, () => {
      throw new Error('must not visit null');
    });
  });
});
