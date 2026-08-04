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

  // Regression test for the confirmed [blocker] finding: a field whose ONLY
  // secret marker is nested inside `anyOf` (the standard Pydantic
  // `Optional[SecretStr]` shape) and whose key name does NOT match the
  // crude name heuristic must still be classified as secret — otherwise it
  // renders the user's real secret value in an unmasked plain-text input.
  it('matches a password format nested inside anyOf (Optional[SecretStr] shape), even with a non-secret-looking key', () => {
    expect(
      isLikelySecretField('credentials', {
        anyOf: [{ type: 'string', format: 'password' }, { type: 'null' }],
      }),
    ).toBe(true);
  });

  it('matches secret: true nested inside oneOf, even with a non-secret-looking key', () => {
    expect(
      isLikelySecretField('credentials', {
        oneOf: [{ type: 'string', secret: true }, { type: 'null' }],
      }),
    ).toBe(true);
  });

  it('does not false-positive on an anyOf/oneOf branch with no secret marker', () => {
    expect(
      isLikelySecretField('base_url', {
        anyOf: [{ type: 'string' }, { type: 'null' }],
      }),
    ).toBe(false);
  });

  it('ignores non-array/non-object anyOf/oneOf values instead of throwing', () => {
    expect(isLikelySecretField('base_url', { anyOf: 'not-an-array' })).toBe(false);
  });
});

describe('classifySchemaField', () => {
  it('classifies secret before type-based checks', () => {
    expect(classifySchemaField('password', { type: 'string' })).toBe('secret');
  });

  it('classifies a nested anyOf secret (Optional[SecretStr]) as secret even though its own type looks like a plain string', () => {
    expect(
      classifySchemaField('credentials', {
        type: 'string',
        anyOf: [{ type: 'string', format: 'password' }, { type: 'null' }],
      }),
    ).toBe('secret');
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
  it('prefers the schema default for a non-secret field', () => {
    expect(initialValueForSchemaField('label', { default: 'x' })).toBe('x');
    expect(initialValueForSchemaField('enabled', { type: 'boolean', default: true })).toBe(true);
  });

  it('defaults boolean to false', () => {
    expect(initialValueForSchemaField('enabled', { type: 'boolean' })).toBe(false);
  });

  it('defaults number/string/undefined to empty string', () => {
    expect(initialValueForSchemaField('port', { type: 'number' })).toBe('');
    expect(initialValueForSchemaField('base_url', { type: 'string' })).toBe('');
    expect(initialValueForSchemaField('base_url', undefined)).toBe('');
  });

  // Regression test for the confirmed [warning] finding: a secret-typed
  // field must never be pre-filled from the schema's own `default` — it
  // must always start empty so the masked SecretManagementInput never
  // silently shows a schema-authored value as if it were the user's own.
  it('forces an empty initial value for a format: password field, ignoring a non-null default', () => {
    expect(initialValueForSchemaField('api_key', { format: 'password', default: 'sk-leaked-default' })).toBe('');
  });

  it('forces an empty initial value for a secret: true field, ignoring a non-null default', () => {
    expect(initialValueForSchemaField('token', { secret: true, default: 'leaked-default' })).toBe('');
  });

  it('forces an empty initial value for a name-heuristic secret field, ignoring a non-null default', () => {
    expect(initialValueForSchemaField('api_key', { type: 'string', default: 'leaked-default' })).toBe('');
  });

  it('forces an empty initial value for a nested anyOf secret field, ignoring a non-null default', () => {
    expect(
      initialValueForSchemaField('credentials', {
        anyOf: [{ type: 'string', format: 'password' }, { type: 'null' }],
        default: 'leaked-default',
      }),
    ).toBe('');
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

  // Regression test tying both findings together: a newly-selected
  // credential type whose schema declares a secret field only via a nested
  // `anyOf` marker, with a non-null schema `default`, must seed that
  // field's initial `data` entry as empty — never the classifier-missed
  // plain value, and never the leaked default.
  it('never seeds a secret-shaped (anyOf-nested) field from its schema default', () => {
    const result = initialDataForSchema({
      properties: {
        credentials: {
          anyOf: [{ type: 'string', format: 'password' }, { type: 'null' }],
          default: 'sk-leaked-default',
        },
        base_url: { type: 'string', default: 'https://api.example.com' },
      },
    });
    expect(result).toEqual({ credentials: '', base_url: 'https://api.example.com' });
  });
});
