import { describe, expect, it } from 'vitest';

import { stripJsonc } from './jsonc.mjs';

/**
 * The stripper feeds two gates that read commented configuration
 * (.oxlintrc.json and knip.json). A stripper that eats one byte too many turns
 * a real config into a parse error, and a stripper that eats one byte too few
 * leaves a comment in the JSON. Both end as a red gate nobody can explain, so
 * every state of the scanner is pinned here.
 */
describe('stripJsonc', () => {
  it('leaves plain JSON untouched', () => {
    expect(stripJsonc('{"a":1}')).toBe('{"a":1}');
  });

  it('removes a line comment and keeps the newline', () => {
    expect(stripJsonc('{\n// note\n"a":1}')).toBe('{\n\n"a":1}');
  });

  it('removes a block comment', () => {
    expect(stripJsonc('{/* note */"a":1}')).toBe('{"a":1}');
  });

  it('keeps a comment introducer that sits inside a string', () => {
    expect(stripJsonc('{"a":"http://x // y /* z */"}')).toBe('{"a":"http://x // y /* z */"}');
  });

  it('keeps an escaped quote inside a string', () => {
    expect(stripJsonc('{"a":"he said \\" then // stopped"}')).toBe('{"a":"he said \\" then // stopped"}');
  });

  it('tolerates a trailing backslash at the very end of the text', () => {
    expect(stripJsonc('"a\\')).toBe('"a\\');
  });

  it('parses the shape both gates actually read', () => {
    const source = '{\n  // globs\n  "project": ["src/**/*.ts"] /* trailing */\n}';
    expect(JSON.parse(stripJsonc(source))).toEqual({ project: ['src/**/*.ts'] });
  });

  it('drops the comma a removed comment left before a closing bracket', () => {
    // knip.json's real shape: last entry, then comment lines, then `]`.
    const source = '{"a":[\n  "x",\n  // the rest landed a consumer\n]}';
    expect(JSON.parse(stripJsonc(source))).toEqual({ a: ['x'] });
  });

  it('drops the same comma before a closing brace', () => {
    expect(JSON.parse(stripJsonc('{"a":1,\n// note\n}'))).toEqual({ a: 1 });
  });

  it('keeps a separating comma', () => {
    expect(JSON.parse(stripJsonc('{"a":1, "b":2}'))).toEqual({ a: 1, b: 2 });
  });

  it('keeps a comma inside a string', () => {
    expect(JSON.parse(stripJsonc('{"a":"x, y"}'))).toEqual({ a: 'x, y' });
  });

  it('keeps an escaped quote when it looks for trailing commas', () => {
    expect(JSON.parse(stripJsonc('{"a":"say \\", ok"}'))).toEqual({ a: 'say ", ok' });
  });

  it('leaves a comma at the very end of the text alone', () => {
    expect(stripJsonc('1,')).toBe('1,');
  });
});
