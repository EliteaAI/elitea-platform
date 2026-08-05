import { describe, expect, it } from 'vitest';

import {
  buildApplicationValidationKey,
  parseApplicationValidationMessage,
  subApplicationTools,
  subApplicationValidationKey,
} from './validationStatus';

describe('buildApplicationValidationKey', () => {
  it('joins projectId, applicationId, versionId with underscores', () => {
    expect(buildApplicationValidationKey('p1', 42, 7)).toBe('p1_42_7');
  });

  it('stringifies undefined segments rather than throwing', () => {
    expect(buildApplicationValidationKey(undefined, undefined, undefined)).toBe('undefined_undefined_undefined');
  });
});

describe('subApplicationValidationKey', () => {
  it('is null for a non-application tool', () => {
    expect(subApplicationValidationKey('p1', { type: 'github' })).toBeNull();
  });

  it('is null when application_id or application_version_id is missing', () => {
    expect(subApplicationValidationKey('p1', { type: 'application', settings: {} })).toBeNull();
  });

  it('builds the sub-agent key when both ids are present', () => {
    const tool = { type: 'application', settings: { application_id: 5, application_version_id: 9 } };
    expect(subApplicationValidationKey('p1', tool)).toBe('p1_5_9');
  });
});

describe('subApplicationTools', () => {
  it('returns an empty array for undefined/empty input', () => {
    expect(subApplicationTools(undefined)).toEqual([]);
    expect(subApplicationTools([])).toEqual([]);
  });

  it('keeps only application-type tools with both ids', () => {
    const tools = [
      { type: 'github' },
      { type: 'application', settings: { application_id: 1, application_version_id: 2 } },
      { type: 'application', settings: {} },
    ];
    expect(subApplicationTools(tools)).toEqual([
      { type: 'application', settings: { application_id: 1, application_version_id: 2 } },
    ]);
  });
});

describe('parseApplicationValidationMessage', () => {
  it('returns falsy input unchanged', () => {
    expect(parseApplicationValidationMessage(undefined)).toBeUndefined();
    expect(parseApplicationValidationMessage('')).toBe('');
  });

  it('returns a plain string unchanged', () => {
    expect(parseApplicationValidationMessage('Something went wrong')).toBe('Something went wrong');
  });

  it('parses a "Value error, {json}" message with error_type into an object', () => {
    const message = 'Value error, {"error_type": "private_credential_not_found", "field": "token"}';
    expect(parseApplicationValidationMessage(message)).toEqual({
      error_type: 'private_credential_not_found',
      field: 'token',
    });
  });

  it('leaves a "Value error, {json}" message without error_type as the original string', () => {
    const message = 'Value error, {"foo": "bar"}';
    expect(parseApplicationValidationMessage(message)).toBe(message);
  });

  it('leaves invalid JSON after the prefix as the original string', () => {
    const message = 'Value error, not json at all';
    expect(parseApplicationValidationMessage(message)).toBe(message);
  });
});
