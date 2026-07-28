import { describe, expect, it } from 'vitest';

import { getArrayOptions, getPropValue } from './getPropValue';

describe('getPropValue', () => {
  it('returns null for a password-format string field', () => {
    expect(getPropValue({ schema: undefined, name: 'secret', type: 'string', format: 'password' })).toBeNull();
  });

  it('falls back to empty string for a plain string field with no default', () => {
    expect(getPropValue({ schema: undefined, name: 'label', type: 'string' })).toBe('');
  });

  it('prefers prefillValue over defaultValue for a string field', () => {
    expect(
      getPropValue({
        schema: undefined,
        name: 'url',
        type: 'string',
        defaultValue: 'https://default.example',
        prefillValue: 'https://prefill.example',
      }),
    ).toBe('https://prefill.example');
  });

  it('returns the raw default for an integer field', () => {
    expect(getPropValue({ schema: undefined, name: 'limit', type: 'integer', defaultValue: 5 })).toBe(5);
  });

  it('returns undefined for an integer field with no default', () => {
    expect(getPropValue({ schema: undefined, name: 'limit', type: 'integer' })).toBeUndefined();
  });

  it('defaults a non-selected_tools array field to an empty array', () => {
    expect(getPropValue({ schema: undefined, name: 'scopes', type: 'array' })).toEqual([]);
  });

  it('resolves selected_tools from items.enum', () => {
    expect(
      getPropValue({
        schema: undefined,
        name: 'selected_tools',
        type: 'array',
        items: { enum: ['read', 'write'] },
      }),
    ).toEqual(['read', 'write']);
  });

  it('resolves selected_tools from items.const as a single-item array', () => {
    expect(
      getPropValue({ schema: undefined, name: 'selected_tools', type: 'array', items: { const: 'only' } }),
    ).toEqual(['only']);
  });

  it('resolves selected_tools from items.itemRef via the schema', () => {
    const schema = { properties: { defs: { enum: ['a', 'b'] } } } as never;
    expect(
      getPropValue({
        schema,
        name: 'selected_tools',
        type: 'array',
        items: { itemRef: '#/properties/defs' },
      }),
    ).toEqual(['a', 'b']);
  });

  it('defaults boolean to false', () => {
    expect(getPropValue({ schema: undefined, name: 'cloud', type: 'boolean' })).toBe(false);
  });

  it('defaults object to an empty object', () => {
    expect(getPropValue({ schema: undefined, name: 'headers', type: 'object' })).toEqual({});
  });

  it('defaults embedding_model to empty string', () => {
    expect(getPropValue({ schema: undefined, name: 'embedding_model', type: 'embedding_model' })).toBe('');
  });

  it('returns null for a configuration_types field with no default', () => {
    expect(
      getPropValue({
        schema: undefined,
        name: 'jira_configuration',
        type: undefined,
        configuration_types: ['jira'],
      }),
    ).toBeNull();
  });

  it('returns null when the default is explicitly null (default type branch)', () => {
    expect(getPropValue({ schema: undefined, name: 'x', type: undefined, defaultValue: null })).toBeNull();
  });

  it('falls back to empty string for an unrecognized type with a non-null default', () => {
    expect(getPropValue({ schema: undefined, name: 'x', type: 'unknown-type' })).toBe('');
  });
});

describe('getArrayOptions', () => {
  it('resolves a #/ path against the schema and returns its enum', () => {
    const schema = { properties: { kind: { enum: ['x', 'y'] } } } as never;
    expect(getArrayOptions(schema, '#/properties/kind')).toEqual(['x', 'y']);
  });

  it('returns an empty array when the path does not resolve', () => {
    const schema = { properties: {} } as never;
    expect(getArrayOptions(schema, '#/properties/missing')).toEqual([]);
  });

  it('returns an empty array when schema is undefined', () => {
    expect(getArrayOptions(undefined, '#/properties/missing')).toEqual([]);
  });
});
