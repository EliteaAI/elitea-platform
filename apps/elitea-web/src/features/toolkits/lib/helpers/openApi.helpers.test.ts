import { describe, expect, it } from 'vitest';

import { generateOperationId, openAPIExtract } from './openApi.helpers';

describe('generateOperationId', () => {
  it('builds get_<path>', () => {
    expect(generateOperationId('GET', '/users')).toBe('get_users');
  });

  it('builds get_..._by_<param> for a path parameter', () => {
    expect(generateOperationId('GET', '/users/{id}')).toBe('get_users_by_id');
  });

  it('maps POST to the create_ action', () => {
    expect(generateOperationId('POST', '/users')).toBe('create_users');
  });

  it('maps PUT and PATCH to the same update_ action', () => {
    expect(generateOperationId('PUT', '/users/{id}')).toBe('update_users_by_id');
    expect(generateOperationId('PATCH', '/users/{id}')).toBe('update_users_by_id');
  });

  it('builds a multi-segment id for a nested path with a param', () => {
    expect(generateOperationId('DELETE', '/api/v1/items/{itemId}')).toBe('delete_api_v1_items_by_itemId');
  });

  it('falls back to <action>_root for the bare root path', () => {
    expect(generateOperationId('GET', '/')).toBe('get_root');
  });

  it('is case-insensitive on the HTTP method', () => {
    expect(generateOperationId('get', '/users')).toBe('get_users');
  });

  it('replaces non-alphanumeric path characters with underscores', () => {
    expect(generateOperationId('GET', '/users-list/v2.0')).toBe('get_users_list_v2_0');
  });

  it('prefixes a leading underscore when the id would start with a digit', () => {
    // A digit-leading id can only occur when the ACTION segment itself
    // starts with a digit — `action` is normally a fixed word
    // (get/create/update/...), so this exercises the fallback path where an
    // unmapped, non-standard method name is used as the action verbatim.
    expect(generateOperationId('9pin', '/foo')).toBe('_9pin_foo');
  });

  it('does not prefix an underscore for the realistic case (action is always alphabetic)', () => {
    expect(generateOperationId('GET', '/2fa/verify')).toBe('get_2fa_verify');
  });

  it('truncates at a word boundary when the id exceeds the 64-char limit', () => {
    const longPath = '/' + Array.from({ length: 10 }, (_, i) => `segment${i}`).join('/');
    const id = generateOperationId('GET', longPath);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id.endsWith('_')).toBe(false);
  });
});

describe('openAPIExtract', () => {
  it('returns an empty array for falsy input', () => {
    expect(openAPIExtract(undefined)).toEqual([]);
  });

  it('returns an empty array when there are no paths', () => {
    expect(openAPIExtract({})).toEqual([]);
  });

  it('extracts one entry per HTTP operation, using the declared operationId when present', () => {
    const result = openAPIExtract({
      paths: {
        '/users': {
          get: { operationId: 'listUsers', summary: 'List users' },
          post: { description: 'Create a user' },
        },
      },
    });

    expect(result).toEqual([
      { name: 'listUsers', path: '/users', method: 'get', description: 'List users' },
      { name: 'create_users', path: '/users', method: 'post', description: 'Create a user' },
    ]);
  });

  it('skips non-operation keys like parameters/summary at the path-item level', () => {
    const result = openAPIExtract({
      paths: {
        '/users': {
          get: { operationId: 'listUsers' },
          parameters: { operationId: 'not-a-real-operation' },
          summary: { operationId: 'also-not-real' },
        },
      },
    });

    expect(result).toEqual([{ name: 'listUsers', path: '/users', method: 'get', description: undefined }]);
  });

  it('falls back to summary when description is absent', () => {
    const result = openAPIExtract({ paths: { '/x': { get: { summary: 'a summary' } } } });
    expect(result[0]?.description).toBe('a summary');
  });

  it('falls back to a generated operationId when operationId is an empty string (does not treat empty string as defined)', () => {
    const result = openAPIExtract({ paths: { '/users': { get: { operationId: '' } } } });
    expect(result[0]?.name).toBe('get_users');
  });

  it('falls back to summary when description is an empty string (does not treat empty string as defined)', () => {
    const result = openAPIExtract({ paths: { '/x': { get: { description: '', summary: 'a summary' } } } });
    expect(result[0]?.description).toBe('a summary');
  });
});
