import { describe, expect, it } from 'vitest';

import { computeDefaultConfigValues, computeIndexConfigWrapperSx, isAnyOfEntryArray, validateToolkitForm } from './IndexDetails.helpers';

describe('isAnyOfEntryArray', () => {
  it('accepts an array and rejects everything else', () => {
    expect(isAnyOfEntryArray([{ type: 'array' }])).toBe(true);
    expect(isAnyOfEntryArray(undefined)).toBe(false);
    expect(isAnyOfEntryArray({ type: 'array' })).toBe(false);
  });
});

describe('validateToolkitForm', () => {
  it('is valid when there are no required fields', () => {
    expect(validateToolkitForm({ properties: {} }, {})).toBe(true);
  });

  it('is invalid when a required field is missing, empty string, null, or 0', () => {
    const schema = { required: ['a'], properties: {} };
    expect(validateToolkitForm(schema, {})).toBe(false);
    expect(validateToolkitForm(schema, { a: '' })).toBe(false);
    expect(validateToolkitForm(schema, { a: null })).toBe(false);
    expect(validateToolkitForm(schema, { a: 0 })).toBe(false);
  });

  it('is invalid when a required array field is empty', () => {
    expect(validateToolkitForm({ required: ['a'], properties: {} }, { a: [] })).toBe(false);
  });

  it('is invalid when the property carries an error flag', () => {
    expect(validateToolkitForm({ required: ['a'], properties: { a: { error: 'bad' } } }, { a: 'x' })).toBe(false);
  });

  it('is valid when every required field has a usable value and no error', () => {
    expect(validateToolkitForm({ required: ['a', 'b'], properties: {} }, { a: 'x', b: ['y'] })).toBe(true);
  });
});

describe('computeDefaultConfigValues', () => {
  it('stores a plain property default', () => {
    const result = computeDefaultConfigValues({
      properties: { name: { default: 'hello' } },
      toolInputVariables: {},
      reset: false,
      useIndexConfigValues: false,
      indexConfigValues: undefined,
    });
    expect(result).toEqual({ defaultValues: { name: 'hello' }, hasDefaults: true });
  });

  it('skips a property that already has a usable current value, unless reset', () => {
    const params = {
      properties: { name: { default: 'hello' } },
      toolInputVariables: { name: 'already set' },
      useIndexConfigValues: false,
      indexConfigValues: undefined,
    };
    expect(computeDefaultConfigValues({ ...params, reset: false })).toEqual({ defaultValues: {}, hasDefaults: false });
    expect(computeDefaultConfigValues({ ...params, reset: true })).toEqual({ defaultValues: { name: 'hello' }, hasDefaults: true });
  });

  it('treats an empty-string or function current value as unusable (overwrites even without reset)', () => {
    const base = { properties: { name: { default: 'hello' } }, reset: false, useIndexConfigValues: false, indexConfigValues: undefined };
    expect(computeDefaultConfigValues({ ...base, toolInputVariables: { name: '' } })).toEqual({ defaultValues: { name: 'hello' }, hasDefaults: true });
  });

  it('prefers indexConfigValues over property.default when useIndexConfigValues is set', () => {
    const result = computeDefaultConfigValues({
      properties: { name: { default: 'fallback' } },
      toolInputVariables: {},
      reset: false,
      useIndexConfigValues: true,
      indexConfigValues: { name: 'from-index-config' },
    });
    expect(result).toEqual({ defaultValues: { name: 'from-index-config' }, hasDefaults: true });
  });

  /**
   * #311, the reload half. `startIndexExecution` (`../../api/indexesApi.ts`)
   * now sends a cleared field as an explicit `null` rather than letting
   * `JSON.stringify` drop the key, so a reopened index's saved
   * `index_configuration` carries `null` for a field the user cleared, not
   * a missing key. This proves the reload side of that fix: `null` must
   * survive AS `null`, not fall back to `property.default` — the exact
   * defect #311 reports, resurfacing here if this ever regressed to
   * treating `null` the way it treats a genuinely absent key.
   */
  it('keeps a persisted null from indexConfigValues rather than falling back to property.default', () => {
    const result = computeDefaultConfigValues({
      properties: { output_format: { default: 'json' } },
      toolInputVariables: {},
      reset: false,
      useIndexConfigValues: true,
      indexConfigValues: { output_format: null },
    });
    expect(result).toEqual({ defaultValues: { output_format: null }, hasDefaults: true });
  });

  it('resolves an anyOf array-typed default when no direct default exists', () => {
    const result = computeDefaultConfigValues({
      properties: { whitelist: { anyOf: [{ type: 'array', default: ['*'] }, { type: 'null' }] } },
      toolInputVariables: {},
      reset: false,
      useIndexConfigValues: false,
      indexConfigValues: undefined,
    });
    expect(result).toEqual({ defaultValues: { whitelist: ['*'] }, hasDefaults: true });
  });

  it('resolves anyOf null as the default when no array default is present', () => {
    const result = computeDefaultConfigValues({
      properties: { blacklist: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
      toolInputVariables: {},
      reset: false,
      useIndexConfigValues: false,
      indexConfigValues: undefined,
    });
    expect(result).toEqual({ defaultValues: { blacklist: null }, hasDefaults: true });
  });

  it('computes but discards a type-based fallback when no default and no anyOf resolution exist (baseline no-op, preserved)', () => {
    const result = computeDefaultConfigValues({
      properties: { count: { type: 'number' } },
      toolInputVariables: {},
      reset: false,
      useIndexConfigValues: false,
      indexConfigValues: undefined,
    });
    expect(result).toEqual({ defaultValues: {}, hasDefaults: false });
  });

  it('handles multiple properties independently', () => {
    const result = computeDefaultConfigValues({
      properties: { a: { default: 1 }, b: {}, c: { default: 'x' } },
      toolInputVariables: {},
      reset: false,
      useIndexConfigValues: false,
      indexConfigValues: undefined,
    });
    expect(result).toEqual({ defaultValues: { a: 1, c: 'x' }, hasDefaults: true });
  });
});

describe('computeIndexConfigWrapperSx', () => {
  it('collapses to a 2rem strip when full-screen chat is active', () => {
    const sx = computeIndexConfigWrapperSx(true) as Record<string, unknown>;
    expect(sx['flex']).toBe('0 0 0px');
    expect(sx['minWidth']).toBe('2rem');
    expect(sx['paddingRight']).toBe(0);
  });

  it('expands to the full 25.625rem panel when not full-screen', () => {
    const sx = computeIndexConfigWrapperSx(false) as Record<string, unknown>;
    expect(sx['flex']).toBe('0 0 25.625rem');
    expect(sx['minWidth']).toBe('25.625rem');
    expect(sx['paddingRight']).toBe('2rem');
  });
});
