import { describe, expect, it } from 'vitest';

import { toolkitFormErrorMessage } from './errorMessage';

describe('toolkitFormErrorMessage', () => {
  it('returns Error.message for a real Error', () => {
    expect(toolkitFormErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-Error value', () => {
    expect(toolkitFormErrorMessage('plain string')).toBe('plain string');
    expect(toolkitFormErrorMessage(42)).toBe('42');
    expect(toolkitFormErrorMessage(undefined)).toBe('undefined');
  });
});
