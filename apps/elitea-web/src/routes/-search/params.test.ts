import { describe, expect, it } from 'vitest';

import { PARAM_KEYS, paramSchemas, pickParams } from './params';

describe('paramSchemas registry', () => {
  it('has exactly one schema per distinct manifest key, with an explicit default for the missing case', () => {
    expect(PARAM_KEYS.length).toBeGreaterThan(0);
    for (const key of PARAM_KEYS) {
      const result = paramSchemas[key].safeParse(undefined);
      expect(result.success, `${key} must resolve a default when absent`).toBe(true);
    }
  });

  it('pickParams builds a partial object schema from a subset of keys', () => {
    const schema = pickParams('destTab', 'sort_order');
    const parsed = schema.parse({});
    expect(parsed).toEqual({ destTab: '', sort_order: 'desc' });
  });

  // Router-parser normalisation (params.ts header): a JSON-parseable raw
  // value (numbers, booleans, arrays) must be coerced back to the string
  // shape every text/flag schema expects, exactly as it would arrive from
  // TanStack Router's default `JSON.parse`-based search parser.
  it('normalises a JSON-parsed NUMBER scalar (e.g. ?bucket=123) back to a string', () => {
    expect(paramSchemas.bucket.parse(123)).toBe('123');
  });

  it('normalises a JSON-parsed BOOLEAN scalar back to a string on a free-text field', () => {
    expect(paramSchemas.name.parse(true)).toBe('true');
  });

  it('a normalised boolean on a strict enum/flag field falls back to the default, not a throw (only "0"/"1" survive; R1 adversarial-verification CRASH-SAFETY fix — see params.ts header)', () => {
    const result = paramSchemas.forceCustom.safeParse(true);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toBe('0');
  });

  it('takes the first element when a scalar param arrives as an array', () => {
    expect(paramSchemas.name.parse(['first', 'second'])).toBe('first');
  });

  it('an empty array normalises to the field default (undefined -> default), not an empty string', () => {
    expect(paramSchemas.name.parse([])).toBe('');
  });

  it('list() coerces a lone scalar into a one-element string array', () => {
    expect(paramSchemas.statuses.parse('active')).toEqual(['active']);
    expect(paramSchemas['tags[]'].parse(42)).toEqual(['42']);
  });

  it('list() passes an already-string array through unchanged', () => {
    expect(paramSchemas.statuses.parse(['a', 'b'])).toEqual(['a', 'b']);
  });

  // R2 adversarial-verification fix: object/array/null entries used to be
  // unconditionally `String(entry)`-coerced into garbage like
  // `"[object Object]"`, which then passed `z.array(z.string().max(256))`
  // as if it were legitimate data — so `.catch([])` never fired and the
  // resolved value was mangled instead of the documented `[]` default.
  // Reproduces the exact probe: `?statuses=<url-encoded JSON object>`,
  // i.e. the raw value the router's `JSON.parse`-based parser would hand
  // `validateSearch` for that query string, is a plain object.
  it('list() treats an object-shaped entry as malformed and falls back to [], not a stringified "[object Object]"', () => {
    const objectEntry = { statuses: 'not-an-array' };
    const result = paramSchemas.statuses.safeParse(objectEntry);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual([]);
    // Explicitly guard against the regression shape.
    expect(result.success && result.data).not.toEqual(['[object Object]']);
  });

  it('list() treats an array containing an object entry as malformed and falls back to []', () => {
    const result = paramSchemas['tags[]'].safeParse(['ok', { nested: true }]);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual([]);
  });

  it('list() treats a null entry inside an array as malformed and falls back to []', () => {
    const result = paramSchemas.statuses.safeParse(['ok', null]);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual([]);
  });

  it('list() caps array length: an over-limit array falls back to [] via .catch()', () => {
    const overLimit = Array.from({ length: 101 }, (_, i) => `tag-${i}`);
    const result = paramSchemas['tags[]'].safeParse(overLimit);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual([]);
  });

  it('list() accepts an array right at the 100-element cap', () => {
    const atLimit = Array.from({ length: 100 }, (_, i) => `tag-${i}`);
    const result = paramSchemas['tags[]'].safeParse(atLimit);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toHaveLength(100);
  });
});
