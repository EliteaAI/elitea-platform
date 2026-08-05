import { describe, expect, it } from 'vitest';

import { toolkitValidationErrors } from './validationStatus';

describe('toolkitValidationErrors', () => {
  it('returns an empty array for undefined input', () => {
    expect(toolkitValidationErrors(undefined)).toEqual([]);
  });

  it('passes settings_errors through unchanged', () => {
    const body = { settings_errors: [{ loc: ['token'], msg: 'Required' }] };
    expect(toolkitValidationErrors(body)).toEqual([{ loc: ['token'], msg: 'Required' }]);
  });

  it('reshapes connection_errors into the settings_errors entry shape', () => {
    const body = {
      connection_errors: [
        { message: 'Cannot connect', configuration_title: 'My GitHub', requires_authorization: true },
      ],
    };
    expect(toolkitValidationErrors(body)).toEqual([
      { type: 'connection_error', msg: 'Cannot connect', loc: ['My GitHub'], requires_authorization: true },
    ]);
  });

  it('falls back to configuration_type when configuration_title is absent', () => {
    const body = { connection_errors: [{ message: 'Cannot connect', configuration_type: 'github' }] };
    expect(toolkitValidationErrors(body)).toEqual([{ type: 'connection_error', msg: 'Cannot connect', loc: ['github'] }]);
  });

  it('combines settings_errors and connection_errors, settings first', () => {
    const body = {
      settings_errors: [{ loc: ['token'], msg: 'Required' }],
      connection_errors: [{ message: 'Cannot connect', configuration_title: 'My GitHub' }],
    };
    const result = toolkitValidationErrors(body);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ loc: ['token'], msg: 'Required' });
    expect(result[1]).toEqual({ type: 'connection_error', msg: 'Cannot connect', loc: ['My GitHub'] });
  });
});
