import { describe, expect, it } from 'vitest';

import { validateToolkitForm } from './toolkitChat.helpers';

describe('validateToolkitForm', () => {
  it('is valid when there are no required fields', () => {
    expect(validateToolkitForm({}, {})).toBe(true);
  });

  it('is invalid when a required field is missing', () => {
    expect(validateToolkitForm({ required: ['index_name'], properties: { index_name: {} } }, {})).toBe(false);
  });

  it('is invalid when a required field is an empty string, null, undefined, or 0', () => {
    const schema = { required: ['x'], properties: { x: {} } };
    expect(validateToolkitForm(schema, { x: '' })).toBe(false);
    expect(validateToolkitForm(schema, { x: null })).toBe(false);
    expect(validateToolkitForm(schema, { x: undefined })).toBe(false);
    expect(validateToolkitForm(schema, { x: 0 })).toBe(false);
  });

  it('is invalid for an empty array value', () => {
    expect(validateToolkitForm({ required: ['tags'], properties: { tags: {} } }, { tags: [] })).toBe(false);
  });

  it('is valid for a non-empty array value', () => {
    expect(validateToolkitForm({ required: ['tags'], properties: { tags: {} } }, { tags: ['a'] })).toBe(true);
  });

  it('is invalid when the field property itself is flagged with an error', () => {
    expect(validateToolkitForm({ required: ['x'], properties: { x: { error: 'bad' } } }, { x: 'value' })).toBe(false);
  });

  it('is valid when every required field is present, non-empty, and error-free', () => {
    const schema = { required: ['a', 'b'], properties: { a: {}, b: {} } };
    expect(validateToolkitForm(schema, { a: 'x', b: 1 })).toBe(true);
  });

  it('treats an undefined variables object as empty', () => {
    expect(validateToolkitForm({ required: ['x'], properties: { x: {} } }, undefined)).toBe(false);
  });
});
