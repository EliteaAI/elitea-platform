import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { dumpYaml } from './dumpYaml.helpers';

describe('dumpYaml', () => {
  it('round-trips a plain object through YAML', () => {
    const input = { state: { input: { type: 'str' } }, nodes: [{ id: 'n1', type: 'tool' }] };
    const output = dumpYaml(input);
    expect(load(output)).toEqual(input);
  });

  it('reorders a node object so id comes first, then type', () => {
    const output = dumpYaml({ nodes: [{ transition: 'x', id: 'n1', type: 'tool', name: 'Foo' }] });
    const idLine = output.indexOf('id:');
    const typeLine = output.indexOf('type:');
    const nameLine = output.indexOf('name:');
    expect(idLine).toBeGreaterThanOrEqual(0);
    expect(idLine).toBeLessThan(typeLine);
    expect(typeLine).toBeLessThan(nameLine);
  });

  it('orders top-level keys as state -> entry_point -> interrupt_after -> interrupt_before -> nodes', () => {
    const output = dumpYaml({
      nodes: [],
      interrupt_before: [],
      entry_point: 'a',
      state: {},
      interrupt_after: [],
    });
    const order = ['state', 'entry_point', 'interrupt_after', 'interrupt_before', 'nodes'].map((key) =>
      output.indexOf(`${key}:`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('sorts unrecognised top-level keys alphabetically after the known ones', () => {
    const output = dumpYaml({ zeta: 1, state: {}, alpha: 2 });
    const stateIdx = output.indexOf('state:');
    const alphaIdx = output.indexOf('alpha:');
    const zetaIdx = output.indexOf('zeta:');
    expect(stateIdx).toBeLessThan(alphaIdx);
    expect(alphaIdx).toBeLessThan(zetaIdx);
  });

  it('does not wrap long lines (lineWidth: -1)', () => {
    const longValue = 'x'.repeat(500);
    const output = dumpYaml({ instructions: longValue });
    const line = output.split('\n').find((l) => l.includes(longValue));
    expect(line).toBeDefined();
  });

  it('drops non-serializable values (functions/symbols) instead of throwing', () => {
    const output = dumpYaml({ state: {}, fn: () => 1, sym: Symbol('x'), keep: 'yes' });
    expect(output).toContain('keep:');
    expect(output).not.toContain('fn:');
    expect(output).not.toContain('sym:');
  });

  it('handles arrays of nodes, reordering each element', () => {
    const output = dumpYaml([{ b: 1, id: 'n1', type: 'tool' }]);
    const idLine = output.indexOf('id:');
    const bLine = output.indexOf('b:');
    expect(idLine).toBeLessThan(bLine);
  });

  it('returns a non-throwing error string when dumping fails', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const output = dumpYaml(circular);
    expect(output).toContain('Error dumping YAML:');
  });

  it('passes through primitives and null unchanged', () => {
    expect(load(dumpYaml('hello'))).toBe('hello');
    expect(load(dumpYaml(42))).toBe(42);
    expect(load(dumpYaml(null))).toBeNull();
  });
});
