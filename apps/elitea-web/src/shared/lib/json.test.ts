import { describe, expect, it } from 'vitest';

import { convertJsonToString, convertToJson } from './json';

describe('convertToJson', () => {
  it('parses valid JSON', () => {
    expect(convertToJson('{"a":1}')).toEqual({ a: 1 });
    expect(convertToJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('returns {} (not null/throw) for invalid JSON — parity (N4)', () => {
    expect(convertToJson('{not json')).toEqual({});
    expect(convertToJson('')).toEqual({});
  });

  it('parses primitive JSON values', () => {
    expect(convertToJson('42')).toBe(42);
    expect(convertToJson('"hi"')).toBe('hi');
  });
});

describe('convertJsonToString', () => {
  it('passes strings through unchanged', () => {
    expect(convertJsonToString('already a string')).toBe('already a string');
  });

  it('pretty-prints objects with 2-space indent by default', () => {
    expect(convertJsonToString({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  it('wraps in a ```json code fence when inBlock is true', () => {
    const result = convertJsonToString({ a: 1 }, true);
    expect(result.startsWith('```json\n ')).toBe(true);
    expect(result.endsWith('\n```')).toBe(true);
    expect(result).toContain(JSON.stringify({ a: 1 }, null, 2));
  });

  it('falls back to String(content) when JSON.stringify throws (circular ref)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    // Plain object's default stringification, spelled out rather than
    // re-deriving it via String(circular) in the assertion itself.
    expect(convertJsonToString(circular)).toBe('[object Object]');
  });

  it('stringifies numbers and booleans', () => {
    expect(convertJsonToString(42)).toBe('42');
    expect(convertJsonToString(true)).toBe('true');
  });
});
