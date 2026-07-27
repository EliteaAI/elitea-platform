import { describe, expect, it } from 'vitest';

import { buildErrorMessage, isNotFoundError } from './http-error';

describe('isNotFoundError', () => {
  it.each([
    [{ status: 404 }, true],
    [{ status: 400 }, true],
    [{ status: 500 }, false],
    [{ status: 403 }, false],
    [undefined, false],
    [null, false],
    ['not an object', false],
    [{}, false],
  ])('isNotFoundError(%j) -> %j', (input, expected) => {
    expect(isNotFoundError(input)).toBe(expected);
  });
});

describe('buildErrorMessage', () => {
  it('returns the fixed "not found" message for originalStatus 404', () => {
    expect(buildErrorMessage({ originalStatus: 404 })).toBe('The requested resource was not found!');
  });

  it('builds a 403 message with the supplied project name', () => {
    expect(buildErrorMessage({ status: 403 }, { projectName: 'Acme' })).toBe(
      'Insufficient permissions to perform this action\non Acme project.',
    );
  });

  it('builds a 403 message falling back to "Private" for a personal project with no name', () => {
    expect(buildErrorMessage({ status: 403 }, { hasPersonalProject: true })).toBe(
      'Insufficient permissions to perform this action\non Private project.',
    );
  });

  it('builds a 403 message falling back to "this project" with no context supplied', () => {
    expect(buildErrorMessage({ status: 403 })).toBe(
      'Insufficient permissions to perform this action\non this project.',
    );
  });

  it('returns data.message when present', () => {
    expect(buildErrorMessage({ data: { message: 'boom' } })).toBe('boom');
  });

  it('returns data.error when it is a string', () => {
    expect(buildErrorMessage({ data: { error: 'string error' } })).toBe('string error');
  });

  it('returns the first array-error msg when data.error is an array', () => {
    expect(buildErrorMessage({ data: { error: [{ msg: 'first' }, { msg: 'second' }] } })).toBe('first');
  });

  it('falls back to "Unknown error occurred" for an empty data.error array', () => {
    expect(buildErrorMessage({ data: { error: [] } })).toBe('Unknown error occurred');
  });

  it('returns data.error verbatim when it is neither a string nor an array (non-string return, N4)', () => {
    const errorObject = { code: 'X1', detail: 'nested' };
    expect(buildErrorMessage({ data: { error: errorObject } })).toBe(errorObject);
  });

  it('joins data.errors object values with newlines', () => {
    expect(buildErrorMessage({ data: { errors: { field1: 'bad', field2: 'also bad' } } })).toBe('bad\nalso bad');
  });

  it('joins Pydantic-style validation-error arrays, including loc when present', () => {
    const result = buildErrorMessage({
      data: [
        { msg: 'required', loc: ['body', 'name'] },
        { msg: 'no loc' },
      ],
    });
    expect(result).toBe('required at body, name,\nno loc');
  });

  it('filters out entries whose msg is null/undefined from a validation-error array', () => {
    const result = buildErrorMessage({ data: [{ msg: null }, { msg: 'kept' }] });
    expect(result).toBe('kept');
  });

  it('falls through past an empty-after-filter validation array to the final fallback', () => {
    const result = buildErrorMessage({ data: [{ msg: null }] });
    expect(result).toEqual([{ msg: null }]);
  });

  it('returns err itself when err is a plain string', () => {
    expect(buildErrorMessage('plain string error')).toBe('plain string error');
  });

  it('returns err.data as the final fallback for an unrecognised shape', () => {
    expect(buildErrorMessage({ data: 42 })).toBe(42);
  });

  it('returns undefined for a bare unrecognised object with no data', () => {
    expect(buildErrorMessage({})).toBeUndefined();
  });
});
