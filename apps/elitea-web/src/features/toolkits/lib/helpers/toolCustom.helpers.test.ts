import { describe, expect, it } from 'vitest';

import { validationSettings } from './toolCustom.helpers';

describe('validationSettings', () => {
  it('is valid when every required field is present and typed-valid', () => {
    const schema = { required: ['token'], properties: { token: { type: 'string' } } };
    expect(validationSettings({ token: 'x' }, schema, undefined, false)).toEqual({ isValid: true });
  });

  it('is invalid with a message naming the missing required field', () => {
    const schema = { required: ['token'], properties: { token: { type: 'string' } } };
    const result = validationSettings({}, schema, undefined, false);
    expect(result.isValid).toBe(false);
    expect((result as { errorMessage: string }).errorMessage).toBe('These settings are required: token');
  });

  it('treats a field with a schema default as always satisfied', () => {
    const schema = { required: ['limit'], properties: { limit: { type: 'integer', default: 10 } } };
    expect(validationSettings({}, schema, undefined, false)).toEqual({ isValid: true });
  });

  it('an integer field with value 0 is valid (not treated as falsy/missing)', () => {
    const schema = { required: ['count'], properties: { count: { type: 'integer' } } };
    expect(validationSettings({ count: 0 }, schema, undefined, false)).toEqual({ isValid: true });
  });

  it('a boolean field with value false is valid (presence, not truthiness, is checked)', () => {
    const schema = { required: ['flag'], properties: { flag: { type: 'boolean' } } };
    expect(validationSettings({ flag: false }, schema, undefined, false)).toEqual({ isValid: true });
  });

  it('validates section-required-OR-of-fields alongside the schema check', () => {
    const schema = {
      properties: {},
      metadata: {
        sections: {
          auth: {
            required: true,
            subsections: [{ fields: ['token'] }, { fields: ['username', 'password'] }],
          },
        },
      },
    };
    expect(validationSettings({ token: 'x' }, schema, undefined, true)).toEqual({ isValid: true });
    expect(validationSettings({ username: 'u', password: 'p' }, schema, undefined, true)).toEqual({ isValid: true });
    expect(validationSettings({}, schema, undefined, true).isValid).toBe(false);
  });

  it('skips the sections check when needToCheckSection is false, even if no subsection is satisfied', () => {
    const schema = {
      properties: {},
      metadata: { sections: { auth: { required: true, subsections: [{ fields: ['token'] }] } } },
    };
    expect(validationSettings({}, schema, undefined, false)).toEqual({ isValid: true });
  });

  it('is valid when only the configurationSchema validates, even if the primary schema does not', () => {
    const schema = { required: ['token'], properties: { token: { type: 'string' } } };
    const configurationSchema = { required: ['api_key'], properties: { api_key: { type: 'string' } } };
    expect(validationSettings({ api_key: 'k' }, schema, configurationSchema, false)).toEqual({ isValid: true });
  });

  it('names the configurationSchema required fields when configuration_title is set and both schemas fail', () => {
    const schema = { required: ['token'], properties: { token: { type: 'string' } } };
    const configurationSchema = { required: ['api_key'], properties: { api_key: { type: 'string' } } };
    const result = validationSettings({ configuration_title: 'my-config' }, schema, configurationSchema, false);
    expect(result).toEqual({ isValid: false, errorMessage: 'These settings are required: api_key' });
  });

  it('falls back to the section-required fields (joined by "or") when the schema has no top-level required array', () => {
    const schema = {
      properties: {},
      metadata: {
        sections: { auth: { required: true, subsections: [{ fields: ['token'] }, { fields: ['username'] }] } },
      },
    };
    const result = validationSettings({}, schema, undefined, true);
    expect(result).toEqual({ isValid: false, errorMessage: 'These settings are required: token or username' });
  });

  it('joins more than two required fields with commas and a trailing connector', () => {
    const schema = { required: ['a', 'b', 'c'], properties: {} };
    const result = validationSettings({}, schema, undefined, false);
    expect((result as { errorMessage: string }).errorMessage).toBe('These settings are required: a, b and c');
  });
});
