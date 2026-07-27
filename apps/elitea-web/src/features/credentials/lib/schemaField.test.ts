import { describe, expect, it } from 'vitest';

import { classifySchemaField, initialDataForSchema, initialValueForSchemaField, isLikelySecretField } from './schemaField';

describe('isLikelySecretField', () => {
  it('matches format: password', () => {
    expect(isLikelySecretField('anything', { format: 'password' })).toBe(true);
  });

  it('matches secret: true', () => {
    expect(isLikelySecretField('anything', { secret: true })).toBe(true);
  });

  it('matches a secret-shaped key name', () => {
    expect(isLikelySecretField('api_key', undefined)).toBe(true);
    expect(isLikelySecretField('access_token', undefined)).toBe(true);
  });

  it('does not match an ordinary field', () => {
    expect(isLikelySecretField('base_url', { type: 'string' })).toBe(false);
  });
});

describe('classifySchemaField', () => {
  it('classifies secret before type-based checks', () => {
    expect(classifySchemaField('password', { type: 'string' })).toBe('secret');
  });

  it('classifies boolean', () => {
    expect(classifySchemaField('enabled', { type: 'boolean' })).toBe('boolean');
  });

  it('classifies number/integer', () => {
    expect(classifySchemaField('port', { type: 'number' })).toBe('number');
    expect(classifySchemaField('port', { type: 'integer' })).toBe('number');
  });

  it('classifies a non-empty enum', () => {
    expect(classifySchemaField('region', { type: 'string', enum: ['us', 'eu'] })).toBe('enum');
  });

  it('falls back to string', () => {
    expect(classifySchemaField('base_url', { type: 'string' })).toBe('string');
    expect(classifySchemaField('base_url', undefined)).toBe('string');
  });
});

describe('initialValueForSchemaField', () => {
  it('prefers the schema default', () => {
    expect(initialValueForSchemaField({ default: 'x' })).toBe('x');
    expect(initialValueForSchemaField({ type: 'boolean', default: true })).toBe(true);
  });

  it('defaults boolean to false', () => {
    expect(initialValueForSchemaField({ type: 'boolean' })).toBe(false);
  });

  it('defaults number/string/undefined to empty string', () => {
    expect(initialValueForSchemaField({ type: 'number' })).toBe('');
    expect(initialValueForSchemaField({ type: 'string' })).toBe('');
    expect(initialValueForSchemaField(undefined)).toBe('');
  });
});

describe('initialDataForSchema', () => {
  it('builds one entry per property', () => {
    const result = initialDataForSchema({
      properties: { api_key: { type: 'string' }, enabled: { type: 'boolean' } },
    });
    expect(result).toEqual({ api_key: '', enabled: false });
  });

  it('returns an empty object for a schema with no properties', () => {
    expect(initialDataForSchema(undefined)).toEqual({});
    expect(initialDataForSchema({})).toEqual({});
  });
});
