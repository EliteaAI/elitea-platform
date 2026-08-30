import { describe, expect, it } from 'vitest';

import { compareGenerated } from './generated-drift.mjs';

/** Table-driven coverage of every decision this module makes (issue #490:
 * same 100%-of-decision-logic floor the other scripts/lib modules carry). */

describe('compareGenerated', () => {
  it('passes when every committed file matches the generator output', () => {
    const result = compareGenerated([
      { path: 'parity/new-app-routes.json', expected: '["/"]\n', actual: '["/"]\n' },
      { path: 'src/shared/api/socket/events.ts', expected: 'export {};\n', actual: 'export {};\n' },
    ]);

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it('fails and names the file when the committed copy drifted', () => {
    const result = compareGenerated([
      { path: 'parity/brand-hue-preview.html', expected: '<p>a</p>', actual: '<p>b</p>' },
    ]);

    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('parity/brand-hue-preview.html');
    expect(result.failures[0]).toContain('differs from the generator output');
  });

  it('fails when the committed file is absent (null)', () => {
    const result = compareGenerated([
      { path: 'src/shared/brand/tokens/default.pack.json', expected: '{}\n', actual: null },
    ]);

    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain('src/shared/brand/tokens/default.pack.json');
    expect(result.failures[0]).toContain('is absent');
  });

  it('fails when the committed file is absent (undefined)', () => {
    const result = compareGenerated([
      { path: 'parity/new-app-routes.json', expected: '[]\n', actual: undefined },
    ]);

    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain('is absent');
  });

  it('fails when the generator itself produced nothing, before it looks at the disk', () => {
    const result = compareGenerated([
      { path: 'parity/new-app-routes.json', expected: '', actual: 'stale content' },
    ]);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'parity/new-app-routes.json: the generator produced no content, so this check has no subject.',
    ]);
  });

  it('fails on an empty subject list — a check with no subject cannot fail (#426)', () => {
    const result = compareGenerated([]);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'no subject was checked, so this drift check could not report a failure. Point it at the committed file(s).',
    ]);
  });

  it('reports every offending file, not only the first', () => {
    const result = compareGenerated([
      { path: 'a.ts', expected: 'a', actual: 'x' },
      { path: 'b.ts', expected: 'b', actual: null },
      { path: 'c.ts', expected: 'c', actual: 'c' },
    ]);

    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toContain('a.ts');
    expect(result.failures[1]).toContain('b.ts');
  });
});
