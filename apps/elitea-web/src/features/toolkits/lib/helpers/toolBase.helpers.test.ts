import { describe, expect, it } from 'vitest';

import {
  adjustLabel,
  getIntegerConstraints,
  isIntegerType,
  isSecretField,
  validateIntegerConstraints,
  validateRequiredFields,
} from './toolBase.helpers';

describe('isSecretField', () => {
  it('is true when format is password', () => {
    expect(isSecretField('key', 'password', undefined)).toBe(true);
  });

  it('is true when secret is truthy', () => {
    expect(isSecretField('key', undefined, true)).toBe(true);
  });

  it('is false with no format/secret/fullSchema', () => {
    expect(isSecretField('key', undefined, undefined)).toBe(false);
  });

  it('is true when an anyOf branch carries format: password', () => {
    expect(isSecretField('key', undefined, undefined, { anyOf: [{ type: 'string' }, { format: 'password' }] })).toBe(true);
  });

  it('is true when a oneOf branch carries secret: true', () => {
    expect(isSecretField('key', undefined, undefined, { oneOf: [{ secret: true }] })).toBe(true);
  });

  it('is false when neither top-level nor branches carry a secret marker', () => {
    expect(isSecretField('key', undefined, undefined, { anyOf: [{ type: 'string' }] })).toBe(false);
  });
});

describe('adjustLabel', () => {
  it('title-cases a snake_case label', () => {
    expect(adjustLabel('api_key')).toBe('Api Key');
  });

  it('applies the special-case override only when the label matches the map key ("cache ttl", space-separated) after lowercasing', () => {
    // The override map is keyed on the RAW lowercased label, not the
    // underscore-split one — `adjustLabel('cache_ttl')` (the realistic
    // snake_case field-name shape) does NOT match `'cache ttl'` and falls
    // through to the normal split/capitalize path instead. Ported
    // verbatim from the baseline's own `specialLabelMap[label.toLowerCase()]`
    // lookup, not a bug introduced by this port.
    expect(adjustLabel('cache_ttl')).toBe('Cache Ttl');
    expect(adjustLabel('cache ttl')).toBe('Cache TTL');
    expect(adjustLabel('CACHE TTL')).toBe('Cache TTL');
  });

  it('title-cases a single word', () => {
    expect(adjustLabel('url')).toBe('Url');
  });
});

describe('getIntegerConstraints', () => {
  it('returns null for an undefined schema', () => {
    expect(getIntegerConstraints(undefined)).toBeNull();
  });

  it('returns null when no bound is declared anywhere', () => {
    expect(getIntegerConstraints({ type: 'integer' })).toBeNull();
  });

  it('extracts top-level minimum/maximum', () => {
    expect(getIntegerConstraints({ minimum: 1, maximum: 10 })).toEqual({ minimum: 1, maximum: 10 });
  });

  it('falls back to an anyOf integer branch for a field the top level leaves undefined', () => {
    expect(getIntegerConstraints({ anyOf: [{ type: 'integer', minimum: 0, maximum: 100 }, { type: 'null' }] })).toEqual({
      minimum: 0,
      maximum: 100,
    });
  });

  it('prefers the top-level bound over the anyOf branch when both are present', () => {
    expect(getIntegerConstraints({ minimum: 5, anyOf: [{ type: 'integer', minimum: 0 }] })).toEqual({ minimum: 5 });
  });

  it('only includes the bounds that are actually present (no undefined-valued keys)', () => {
    const result = getIntegerConstraints({ minimum: 1 });
    expect(result).toEqual({ minimum: 1 });
    expect(result).not.toHaveProperty('maximum');
  });
});

describe('validateIntegerConstraints', () => {
  it('is false (valid) when there are no constraints', () => {
    expect(validateIntegerConstraints(5, null)).toBe(false);
  });

  it('requires a value when a minimum is declared and the value is empty', () => {
    expect(validateIntegerConstraints('', { minimum: 0 })).toBe('Field is required');
    expect(validateIntegerConstraints(undefined, { minimum: 0 })).toBe('Field is required');
    expect(validateIntegerConstraints(null, { minimum: 0 })).toBe('Field is required');
  });

  it('allows an empty value when no minimum bound is declared', () => {
    expect(validateIntegerConstraints('', { maximum: 10 })).toBe(false);
  });

  it('rejects a non-numeric string as required', () => {
    expect(validateIntegerConstraints('abc', { minimum: 0 })).toBe('Field is required');
  });

  it('enforces exclusiveMinimum', () => {
    expect(validateIntegerConstraints(5, { exclusiveMinimum: 5 })).toBe('Value must be greater than 5');
    expect(validateIntegerConstraints(6, { exclusiveMinimum: 5 })).toBe(false);
  });

  it('enforces minimum (inclusive)', () => {
    expect(validateIntegerConstraints(4, { minimum: 5 })).toBe('Value must be at least 5');
    expect(validateIntegerConstraints(5, { minimum: 5 })).toBe(false);
  });

  it('enforces exclusiveMaximum', () => {
    expect(validateIntegerConstraints(10, { exclusiveMaximum: 10 })).toBe('Value must be less than 10');
  });

  it('enforces maximum (inclusive)', () => {
    expect(validateIntegerConstraints(11, { maximum: 10 })).toBe('Value must be at most 10');
    expect(validateIntegerConstraints(10, { maximum: 10 })).toBe(false);
  });

  it('parses a string value before comparing', () => {
    expect(validateIntegerConstraints('4', { minimum: 5 })).toBe('Value must be at least 5');
    expect(validateIntegerConstraints('5', { minimum: 5 })).toBe(false);
  });
});

describe('isIntegerType', () => {
  it('is false for undefined', () => {
    expect(isIntegerType(undefined)).toBe(false);
  });

  it('is true for a direct integer type', () => {
    expect(isIntegerType({ type: 'integer' })).toBe(true);
  });

  it('is true for an anyOf integer branch (Optional[int] shape)', () => {
    expect(isIntegerType({ anyOf: [{ type: 'integer' }, { type: 'null' }] })).toBe(true);
  });

  it('is false for a string type with no integer branch', () => {
    expect(isIntegerType({ type: 'string' })).toBe(false);
  });
});

describe('validateRequiredFields', () => {
  it('flags a missing required string field', () => {
    const errors = validateRequiredFields({ required: ['name'], properties: { name: { type: 'string' } } }, {});
    expect(errors).toEqual({ name: true });
  });

  it('does not flag a present required field', () => {
    const errors = validateRequiredFields({ required: ['name'], properties: { name: { type: 'string' } } }, { name: 'x' });
    expect(errors).toEqual({ name: false });
  });

  it('never flags a boolean-typed required field (its own value decides truthiness elsewhere)', () => {
    const errors = validateRequiredFields({ required: ['flag'], properties: { flag: { type: 'boolean' } } }, { flag: false });
    expect(errors).toEqual({ flag: false });
  });

  it('never flags a required field with no schema entry at all', () => {
    const errors = validateRequiredFields({ required: ['ghost'], properties: {} }, {});
    expect(errors).toEqual({ ghost: false });
  });

  it('skips elitea_title unless enableEditEliteaTitle is set', () => {
    const schema = { required: ['elitea_title'], properties: { elitea_title: { type: 'string' } } };
    expect(validateRequiredFields(schema, {})).toEqual({});
    expect(validateRequiredFields(schema, {}, [], true)).toEqual({ elitea_title: true });
  });

  it('skips fields already owned by a metadata section', () => {
    const schema = { required: ['name', 'sectioned'], properties: { name: { type: 'string' }, sectioned: { type: 'string' } } };
    expect(validateRequiredFields(schema, {}, ['sectioned'])).toEqual({ name: true });
  });
});
