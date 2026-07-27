import { describe, expect, it } from 'vitest';

import {
  asymmetry,
  evalPaletteModule,
  flattenPalette,
  keyTree,
  renderTypeLiteral,
} from './brand-tokens-core.mjs';

/** Table-driven coverage of every decision this module makes (unit T1: same
 * 100%-of-decision-logic floor F2's scripts/lib/*-core.mjs modules carry). */

describe('evalPaletteModule', () => {
  it('de-modules a palette source with an import and injected names, and evaluates it', () => {
    const source = `
import { white } from './darkPalette';

export const red = '#ff0000';
export const blue = '#0000ff';

const palette = {
  mode: 'light',
  primary: { main: red },
  secondary: { main: blue },
  base: white,
};

export default palette;
`;
    const result = evalPaletteModule(source, { white: '#ffffff' });
    expect(result).toEqual({
      palette: {
        mode: 'light',
        primary: { main: '#ff0000' },
        secondary: { main: '#0000ff' },
        base: '#ffffff',
      },
      consts: { red: '#ff0000', blue: '#0000ff' },
    });
  });

  it('defaults injected to {} when the module needs no injected names', () => {
    const source = `
export const green = '#00ff00';
const palette = { mode: 'dark', accent: green };
export default palette;
`;
    expect(evalPaletteModule(source)).toEqual({
      palette: { mode: 'dark', accent: '#00ff00' },
      consts: { green: '#00ff00' },
    });
  });

  it('strips every import line, including more than one', () => {
    const source = `
import { a } from './a';
import { b } from './b';
export const c = 'literal';
const palette = { mode: 'dark', c };
export default palette;
`;
    // If either import line survived de-moduling, `new Function` would throw
    // a SyntaxError (import declarations are illegal inside a function body)
    // instead of evaluating — a successful, correct result proves both lines
    // were stripped, not just the first.
    expect(evalPaletteModule(source)).toEqual({
      palette: { mode: 'dark', c: 'literal' },
      consts: { c: 'literal' },
    });
  });

  it('throws when the module has no `export default <identifier>;`', () => {
    const source = `export const x = '#fff';`;
    expect(() => evalPaletteModule(source)).toThrow(
      'palette module has no `export default <identifier>;`',
    );
  });
});

describe('flattenPalette', () => {
  it('flattens nested string leaves to dot-joined ids', () => {
    const result = flattenPalette({ a: { b: '1', c: '2' }, d: '3' });
    expect(result).toEqual({ 'a.b': '1', 'a.c': '2', d: '3' });
  });

  it('flattens more than two levels deep', () => {
    expect(flattenPalette({ a: { b: { c: '1' } } })).toEqual({ 'a.b.c': '1' });
  });

  it('skips only the listed keys, and only at the top level', () => {
    const result = flattenPalette({ mode: 'dark', a: { mode: 'x', b: '1' } }, ['mode']);
    expect(result).toEqual({ 'a.mode': 'x', 'a.b': '1' });
  });

  it('defaults skipTopLevel to [] (nothing skipped) when omitted', () => {
    expect(flattenPalette({ mode: 'dark', a: '1' })).toEqual({ mode: 'dark', a: '1' });
  });

  it('throws on a non-string, non-object leaf (e.g. a number)', () => {
    expect(() => flattenPalette({ a: 5 })).toThrow('non-string leaf at a: 5');
  });

  it('throws on a null leaf (typeof null is "object", but null is excluded first)', () => {
    expect(() => flattenPalette({ a: { b: null } })).toThrow('non-string leaf at a.b: null');
  });

  it('throws on a boolean leaf', () => {
    expect(() => flattenPalette({ a: true })).toThrow('non-string leaf at a: true');
  });
});

describe('asymmetry', () => {
  it('returns empty arrays when both sides share the same key set', () => {
    expect(asymmetry({ a: '1', b: '2' }, { a: '9', b: '8' })).toEqual({ lightOnly: [], darkOnly: [] });
  });

  it('finds ids unique to each side', () => {
    expect(asymmetry({ a: '1', b: '2' }, { a: '1', c: '3' })).toEqual({
      lightOnly: ['b'],
      darkOnly: ['c'],
    });
  });

  it('handles two empty records', () => {
    expect(asymmetry({}, {})).toEqual({ lightOnly: [], darkOnly: [] });
  });
});

describe('keyTree', () => {
  it('builds a nested tree from dot-joined ids, mixing flat and nested', () => {
    expect(keyTree(['a', 'b.c', 'b.d'])).toEqual({ a: true, b: { c: true, d: true } });
  });

  it('reuses an existing group node for a shared prefix rather than recreating it', () => {
    expect(keyTree(['b.c', 'b.d'])).toEqual({ b: { c: true, d: true } });
  });

  it('is idempotent for the exact same leaf id repeated', () => {
    expect(keyTree(['a', 'a'])).toEqual({ a: true });
  });

  it('throws when a leaf id collides with an already-built group of the same name', () => {
    expect(() => keyTree(['a.b', 'a'])).toThrow('token id a collides with a group of the same name');
  });

  it('throws when an id tries to nest under an already-built leaf', () => {
    expect(() => keyTree(['a', 'a.b'])).toThrow('token id a.b nests under the leaf a');
  });

  it('returns {} for an empty id list', () => {
    expect(keyTree([])).toEqual({});
  });
});

describe('renderTypeLiteral', () => {
  it('renders a leaf-only node as `key: string;` members', () => {
    expect(renderTypeLiteral({ a: true, b: true })).toBe('{\n  a: string;\n  b: string;\n}');
  });

  it('recurses into nested group nodes', () => {
    expect(renderTypeLiteral({ a: { b: true } })).toBe('{\n  a: {\n    b: string;\n  };\n}');
  });

  it('quotes a key that is not a valid bare identifier', () => {
    expect(renderTypeLiteral({ 'a-b': true })).toBe('{\n  "a-b": string;\n}');
  });

  it('leaves a valid identifier key ($/_ and digits after the first char) unquoted', () => {
    expect(renderTypeLiteral({ $a_1: true })).toBe('{\n  $a_1: string;\n}');
  });

  it('honours an explicit indent level, and defaults to 2 when omitted', () => {
    const explicit = renderTypeLiteral({ a: true }, 4);
    const implicit = renderTypeLiteral({ a: true });
    expect(explicit).toBe('{\n    a: string;\n  }');
    expect(implicit).toBe('{\n  a: string;\n}');
  });

  it('renders an empty node as an empty block', () => {
    expect(renderTypeLiteral({})).toBe('{\n\n}');
  });
});
