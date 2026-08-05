import { describe, expect, it } from 'vitest';

import { CONFIGURATION_VIEW_OPTIONS as EntitiesConfigViewOptions } from '@/entities/toolkit';

import { CONFIGURATION_VIEW_OPTIONS, parseValidationError, parseValidationErrors } from './toolkitForm.helpers';

describe('CONFIGURATION_VIEW_OPTIONS re-export', () => {
  it('re-exports entities/toolkit.CONFIGURATION_VIEW_OPTIONS by identity', () => {
    expect(CONFIGURATION_VIEW_OPTIONS).toBe(EntitiesConfigViewOptions);
  });
});

describe('parseValidationError', () => {
  it('falls back to the raw msg keyed by loc[1] when the body is not structured JSON', () => {
    expect(parseValidationError({ msg: 'field is required', loc: ['settings', 'api_key'] })).toEqual({
      fieldKey: 'api_key',
      message: 'field is required',
    });
  });

  it('returns null when there is neither a parseable body nor a usable loc[1]', () => {
    expect(parseValidationError({ msg: 'oops', loc: ['settings'] })).toBeNull();
  });

  it('unwraps a "Value error, {...}" body and maps configuration_model_not_found to a friendly message', () => {
    const msg = "Value error, {'error_type': 'configuration_model_not_found', 'model_name': 'gpt-4'}";
    expect(parseValidationError({ msg, loc: ['settings', 'model'] })).toEqual({
      fieldKey: 'model',
      message: 'Model "gpt-4" is no longer available in project configurations.',
    });
  });

  it('maps credential_not_found to its friendly message', () => {
    const msg = "Value error, {'error_type': 'credential_not_found'}";
    expect(parseValidationError({ msg, loc: ['settings', 'credentials'] })?.message).toBe(
      'Your configuration does not match any available configurations.',
    );
  });

  it('maps private_credential_not_found to its friendly message', () => {
    const msg = "Value error, {'error_type': 'private_credential_not_found'}";
    expect(parseValidationError({ msg, loc: ['settings', 'credentials'] })?.message).toBe(
      'Your private configuration does not match any available configurations.',
    );
  });

  it('surfaces a connection error, overriding fieldKey with configuration_type-derived key', () => {
    const msg = "Value error, {'__connection_errors__': [{'message': 'timeout', 'configuration_type': 'jira'}]}";
    expect(parseValidationError({ msg, loc: ['settings', 'unrelated'] })).toEqual({
      fieldKey: 'jira_configuration',
      message: 'timeout',
    });
  });

  it('falls back to a generic "Connection error" message when the connection error has no message', () => {
    const msg = "Value error, {'__connection_errors__': [{}]}";
    expect(parseValidationError({ msg, loc: ['settings', 'x'] })?.message).toBe('Connection error');
  });

  it('falls back to a generic "Connection error" message when the connection error message is an empty string (does not treat empty string as defined)', () => {
    const msg = "Value error, {'__connection_errors__': [{'message': '', 'configuration_type': 'jira'}]}";
    expect(parseValidationError({ msg, loc: ['settings', 'x'] })?.message).toBe('Connection error');
  });

  it('falls back to the raw msg when the body parses but matches no known handler', () => {
    const msg = "Value error, {'error_type': 'something_else'}";
    expect(parseValidationError({ msg, loc: ['settings', 'x'] })).toEqual({ fieldKey: 'x', message: msg });
  });

  it('handles a msg with no "Value error, " prefix directly as the body', () => {
    const msg = "{'error_type': 'credential_not_found'}";
    expect(parseValidationError({ msg, loc: ['settings', 'x'] })?.message).toBe(
      'Your configuration does not match any available configurations.',
    );
  });
});

describe('parseValidationErrors', () => {
  it('reduces multiple entries into a fieldKey -> message map', () => {
    const errors = parseValidationErrors([
      { msg: 'required', loc: ['settings', 'a'] },
      { msg: 'invalid', loc: ['settings', 'b'] },
    ]);
    expect(errors).toEqual({ a: 'required', b: 'invalid' });
  });

  it('drops entries that resolve to no fieldKey', () => {
    const errors = parseValidationErrors([{ msg: 'oops', loc: ['settings'] }]);
    expect(errors).toEqual({});
  });

  it('defaults to an empty map for undefined input', () => {
    expect(parseValidationErrors()).toEqual({});
  });
});
