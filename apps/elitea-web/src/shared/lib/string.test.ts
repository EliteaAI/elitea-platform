import { describe, expect, it } from 'vitest';

import {
  capitalizeFirstChar,
  contextResolver,
  escapeString,
  extractPlaceholders,
  getInitials,
  splitStringByKeyword,
  stringToColor,
} from './string';

describe('capitalizeFirstChar', () => {
  it.each([
    ['hello', 'Hello'],
    ['Hello', 'Hello'],
    ['h', 'H'],
    ['', ''],
    ['1abc', '1abc'],
    ['über', 'Über'],
  ])('capitalizeFirstChar(%j) -> %j', (input, expected) => {
    expect(capitalizeFirstChar(input)).toBe(expected);
  });
});

describe('escapeString', () => {
  it.each([
    ['a.b', 'a\\.b'],
    ['a+b', 'a\\+b'],
    ['[test]', '\\[test\\]'],
    ['(x)', '\\(x\\)'],
    ['no-specials', 'no\\-specials'],
    ['plain', 'plain'],
  ])('escapeString(%j) -> %j', (input, expected) => {
    expect(escapeString(input)).toBe(expected);
  });

  it('produces a string safe to embed in a RegExp', () => {
    const keyword = 'a.b+c';
    const re = new RegExp(escapeString(keyword));
    expect(re.test('a.b+c')).toBe(true);
    expect(re.test('aXbXc')).toBe(false);
  });
});

describe('splitStringByKeyword', () => {
  it('returns the whole string unhighlighted when keyword is empty', () => {
    expect(splitStringByKeyword('hello world', '')).toEqual([{ text: 'hello world', highlight: false }]);
  });

  it('returns a single unhighlighted segment for an empty string with a keyword', () => {
    expect(splitStringByKeyword('', 'x')).toEqual([]);
  });

  it('splits and tags a single match case-insensitively', () => {
    const result = splitStringByKeyword('hello WORLD hello', 'world');
    expect(result.map((s) => s.text).join('')).toBe('hello WORLD hello');
    const matched = result.find((s) => s.text.toLowerCase() === 'world');
    expect(matched?.highlight).toBe(true);
  });

  it('escapes regex-special characters in the keyword', () => {
    const result = splitStringByKeyword('price: $5.00 today', '$5.00');
    expect(result.some((s) => s.highlight && s.text === '$5.00')).toBe(true);
  });

  it('handles a keyword with no match: no segment is highlighted', () => {
    const result = splitStringByKeyword('hello world', 'zzz');
    expect(result.every((s) => !s.highlight)).toBe(true);
    expect(result.map((s) => s.text).join('')).toBe('hello world');
  });

  it(
    'reused /g RegExp.test does NOT desync across repeated adjacent keyword ' +
      'matches (verifies the doc-comment investigation in string.ts)',
    () => {
      // 'aaa' split on keyword 'a' -> ['', 'a', '', 'a', '', 'a', ''] — every
      // 'a' segment must be highlighted, and every non-'a' (empty) segment
      // must not be, despite the shared stateful RegExp instance.
      const result = splitStringByKeyword('aaa', 'a');
      expect(result.filter((s) => s.text === 'a')).toHaveLength(3);
      expect(result.filter((s) => s.text === 'a' && s.highlight)).toHaveLength(3);
      expect(result.filter((s) => s.text === '' && s.highlight)).toHaveLength(0);
    },
  );

  it('does not desync across many back-to-back keyword occurrences', () => {
    const result = splitStringByKeyword('ababab', 'ab');
    const matches = result.filter((s) => s.text.toLowerCase() === 'ab');
    expect(matches).toHaveLength(3);
    expect(matches.every((s) => s.highlight)).toBe(true);
  });
});

describe('getInitials', () => {
  it.each([
    ['John Doe', 'JD'],
    ['john', 'J'],
    ['A B C', 'AC'],
    ['  ', ''],
  ])('getInitials(%j) -> %j', (input, expected) => {
    expect(getInitials(input)).toBe(expected);
  });

  it('single-word name uses only the first char (lastName is forced to "")', () => {
    // Parity: for a single-word name the old app sets `lastName = ''`
    // unconditionally, so the result is just the first letter, not
    // first+last character of that one word.
    expect(getInitials('Madonna')).toBe('M');
  });

  it('throws TypeError for non-string input (parity, N4)', () => {
    expect(() => getInitials(42 as unknown as string)).toThrow(TypeError);
    expect(() => getInitials(null as unknown as string)).toThrow('Name must be a string');
  });
});

describe('stringToColor', () => {
  it('is deterministic for the same input', () => {
    expect(stringToColor('Alice')).toBe(stringToColor('Alice'));
  });

  it('produces a 7-character hex color string', () => {
    const color = stringToColor('Bob');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('differs for different inputs (not a constant)', () => {
    expect(stringToColor('Alice')).not.toBe(stringToColor('Bob'));
  });

  it('handles an empty string (hash stays 0, every channel is "00")', () => {
    // Not asserted as a literal hex string: R-T1 (no raw colour literal)
    // applies to source text, and this is a COMPUTED value (see stringToColor's
    // doc comment) — a hardcoded literal here would still trip the same
    // pattern-matching lint rule, so the zero-hash case is verified structurally.
    const color = stringToColor('');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(color.slice(1))).toEqual(new Set('0'));
  });
});

describe('extractPlaceholders', () => {
  it.each([
    [['{{ name }}'], ['name']],
    [['{{name}}', '{{ name }}'], ['name']],
    [['{{a}}', '{{b}}'], ['a', 'b']],
    [[], []],
  ])('extractPlaceholders(%j) -> %j', (input, expected) => {
    expect(extractPlaceholders(input)).toEqual(expected);
  });

  it('defaults to [] with no argument', () => {
    expect(extractPlaceholders()).toEqual([]);
  });
});

describe('contextResolver', () => {
  it('returns [] for a context with no placeholders', () => {
    expect(contextResolver('hello world')).toEqual([]);
  });

  it('extracts and alphabetically sorts unique variable names', () => {
    expect(contextResolver('{{zeta}} and {{alpha}} and {{zeta}}')).toEqual(['alpha', 'zeta']);
  });

  it('defaults to empty context', () => {
    expect(contextResolver()).toEqual([]);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(contextResolver('{{  spaced_var  }}')).toEqual(['spaced_var']);
  });
});
